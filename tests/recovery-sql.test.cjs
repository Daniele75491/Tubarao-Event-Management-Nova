const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const superId='11111111-1111-4111-8111-111111111111',door='22222222-2222-4222-8222-222222222222',eventId='33333333-3333-4333-8333-333333333333';

test('recovery RPC executes against PostgreSQL with capacity, audit, expiry and privilege safeguards',async t=>{
  const db=new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create type ticket_category as enum ('MEN','WOMEN');
      create type reservation_status as enum ('RESERVED','PAYMENT_CLAIMED','PAID','REJECTED','EXPIRED','CANCELLED');
      create type sales_mode as enum ('OPEN','CLOSED','SCHEDULED');
      create table admin_profiles(user_id uuid,role text);
      create table admin_access_accounts(id uuid primary key,role text,is_active boolean);
      create table events(id uuid primary key default gen_random_uuid(),name text,starts_at timestamptz,physical_capacity integer default 3,men_paid_cap integer default 1,ticket_price_cents integer default 800,reservation_minutes integer default 20,claim_hold_hours integer default 24,sales_mode sales_mode default 'OPEN',sales_open_at timestamptz,sales_close_at timestamptz,is_active boolean default true,created_at timestamptz default now(),updated_at timestamptz default now());
      create table reservations(id uuid primary key default gen_random_uuid(),event_id uuid references events(id),email text default gen_random_uuid()::text,category ticket_category default 'WOMEN',status reservation_status,reserved_until timestamptz default now()+interval '20 minutes',claimed_at timestamptz,paid_at timestamptz,expired_at timestamptz,updated_at timestamptz,amount_cents integer default 800,confirmed_by uuid,confirmed_by_access_id uuid,qr_token_hash text);
      create unique index reservations_one_active_email_per_event on reservations(event_id,lower(email)) where status in ('RESERVED','PAYMENT_CLAIMED','PAID');
      create table non_paying_attendees(id uuid primary key default gen_random_uuid(),event_id uuid references events(id),first_name text,last_name text,email text,category ticket_category,checked_in_at timestamptz,created_at timestamptz,updated_at timestamptz);
      insert into admin_access_accounts values('${superId}','SUPER_ADMIN',true),('${door}','ADMIN',true);
      insert into events(id,name) values('${eventId}','Party');
      -- Same contract/deadline behavior as the supplied normal confirmation RPC.
      create function confirm_payment(p_reservation_id uuid) returns jsonb language plpgsql as $$
      declare v reservations; h integer;
      begin
        perform pg_advisory_xact_lock(hashtext(p_reservation_id::text));
        select * into v from reservations where id=p_reservation_id for update;
        if v.status='PAID' then return jsonb_build_object('reservation_id',v.id,'status','PAID'); end if;
        if v.status<>'PAYMENT_CLAIMED' then raise exception 'PAYMENT_NOT_CLAIMED'; end if;
        select claim_hold_hours into h from events where id=v.event_id;
        if v.claimed_at is null or v.claimed_at+make_interval(hours=>h)<=now() then
          update reservations set status='EXPIRED',expired_at=now() where id=v.id;
          return jsonb_build_object('reservation_id',v.id,'status','EXPIRED');
        end if;
        update reservations set status='PAID',paid_at=now() where id=v.id;
        return jsonb_build_object('reservation_id',v.id,'status','PAID');
      end; $$;
    `);
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260928_admin_event_management.sql'),'utf8'));
    const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260930_reservation_recovery.sql'),'utf8');
    await db.exec(sql);
    const reset=()=>db.exec('delete from reservations; delete from non_paying_attendees; update events set physical_capacity=3,men_paid_cap=1;');
    const add=async(status='RESERVED',category='WOMEN',hours=1,email=null)=>(await db.query('insert into reservations(event_id,status,category,reserved_until,claimed_at,email) values($1,$2,$3,now()+make_interval(hours=>$4),now()+make_interval(hours=>$4),coalesce($5,gen_random_uuid()::text)) returning id',[eventId,status,category,hours,email])).rows[0].id;
    const confirm=async(id,actor=superId)=>(await db.query('select confirm_external_payment($1,$2) result',[id,actor])).rows[0].result;
    const row=async id=>(await db.query('select * from reservations where id=$1',[id])).rows[0];
    await t.test('live RESERVED converts without counting its occupied slot twice; audit and QR identity persist',async()=>{
      await reset();const id=await add();await add('PAID');await add('RESERVED');
      await db.query("update reservations set qr_token_hash='existing-identity',amount_cents=950 where id=$1",[id]);
      assert.equal((await confirm(id)).status,'PAID');const first=await row(id);
      assert.equal(first.confirmed_by_access_id,superId);assert.equal(first.amount_cents,950);assert.equal(first.qr_token_hash,'existing-identity');
      assert.equal((await confirm(id)).status,'PAID');assert.equal((await row(id)).paid_at.getTime(),first.paid_at.getTime());
      assert.equal((await db.query('select count(*)::int n from reservations')).rows[0].n,3);
    });
    await t.test('normal live claims confirm; elapsed claims preserve normal expiry behavior',async()=>{
      await reset();const live=await add('PAYMENT_CLAIMED','WOMEN',-1);
      assert.equal((await confirm(live)).status,'PAID');
      const old=await add('PAYMENT_CLAIMED','WOMEN',-25);
      assert.equal((await confirm(old)).status,'EXPIRED');assert.equal((await row(old)).confirmed_by_access_id,null);
    });
    await t.test('expired RESERVED and EXPIRED restore only with room; non-paying attendees count',async()=>{
      for(const status of ['RESERVED','EXPIRED']) {
        await reset();const id=await add(status,'WOMEN',-1);await add('PAID');await add('PAYMENT_CLAIMED','WOMEN',-1);
        await db.query('insert into non_paying_attendees(event_id,category) values($1,\'WOMEN\')',[eventId]);
        await assert.rejects(confirm(id),/EVENT_SOLD_OUT/);assert.equal((await row(id)).status,status);
        await db.exec('delete from non_paying_attendees');assert.equal((await confirm(id)).status,'PAID');
      }
    });
    await t.test('MEN cap counts paid, live reserved and claimed MEN, but not elapsed holds',async()=>{
      for(const status of ['PAID','RESERVED','PAYMENT_CLAIMED']) {
        await reset();const id=await add('EXPIRED','MEN',-1);await add(status,'MEN',1);
        await assert.rejects(confirm(id),/MEN_SOLD_OUT/);assert.equal((await row(id)).status,'EXPIRED');
      }
      await reset();const id=await add('EXPIRED','MEN',-1),old=await add('PAYMENT_CLAIMED','MEN',-25);
      assert.equal((await confirm(id)).status,'PAID');assert.equal((await row(old)).status,'EXPIRED');
    });
    await t.test('queued simultaneous restores never exceed the last slot',async()=>{
      await reset();await db.exec('update events set physical_capacity=1');
      const ids=await Promise.all([add('EXPIRED'),add('EXPIRED')]);
      const results=await Promise.allSettled(ids.map(id=>confirm(id)));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.match(results.find(r=>r.status==='rejected').reason.message,/EVENT_SOLD_OUT/);
      assert.equal((await db.query("select count(*)::int n from reservations where status='PAID'")).rows[0].n,1);
      // PGlite serializes sessions. Live multi-session lock verification is a deployment check.
      assert.match(sql,/admin_locked_event\(v_event_id\)/);assert.match(sql,/for update/);
    });
    await t.test('rejected/cancelled cannot resurrect; duplicate active email rolls back',async()=>{
      for(const status of ['REJECTED','CANCELLED']) {await reset();await assert.rejects(confirm(await add(status)),/INVALID_RESERVATION_STATUS/);}
      await reset();const id=await add('EXPIRED','WOMEN',-1,'same@example.com');await add('PAID','WOMEN',1,'same@example.com');
      await assert.rejects(confirm(id),/reservations_one_active_email_per_event/);assert.equal((await row(id)).status,'EXPIRED');
    });
    await t.test('door, unknown, inactive actors denied; service-only grants and historical audit preserved',async()=>{
      await reset();const id=await add();
      for(const actor of [door,eventId,null])await assert.rejects(confirm(id,actor),/FORBIDDEN/);
      await db.query('update admin_access_accounts set is_active=false where id=$1',[superId]);await assert.rejects(confirm(id),/FORBIDDEN/);
      await db.query('update admin_access_accounts set is_active=true where id=$1',[superId]);
      await db.query('update reservations set confirmed_by=$1 where id=$2',[door,id]);await confirm(id);assert.equal((await row(id)).confirmed_by_access_id,null);
      for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'confirm_external_payment(uuid,uuid)','EXECUTE') ok",[role])).rows[0].ok,role==='service_role');
      await db.exec('update events set is_active=false');await assert.rejects(confirm(id),/EVENT_CHANGED/);
    });
  } finally {await db.close();}
});
