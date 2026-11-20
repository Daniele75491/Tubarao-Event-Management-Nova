const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261001_ticket_pricing.sql'),'utf8');
const event='11111111-1111-4111-8111-111111111111',admin='22222222-2222-4222-8222-222222222222',door='33333333-3333-4333-8333-333333333333';
test('pricing migration and real reservation RPC preserve transactional business rules',async t=>{
  const db=new PGlite();let sequence=0;
  const query=(sql,args=[])=>db.query(sql,args);
  const price=async()=> (await query('select read_event_pricing($1) p',[event])).rows[0].p;
  const reserve=async(category='WOMEN',email='guest'+(++sequence)+'@example.com')=>(await query('select create_reservation($1,$2,$3,$4,$5) r',[event,'Ana','Silva',email,category])).rows[0].r;
  const row=async id=>(await query('select * from reservations where id=$1',[id])).rows[0];
  const patch=async(p,actor=admin)=>(await query('select admin_update_event($1,$2,$3) r',[event,p,actor])).rows[0].r;
  try{
    await db.exec(`
      create role anon;create role authenticated;create role service_role;
      create type ticket_category as enum ('MEN','WOMEN');
      create type reservation_status as enum ('RESERVED','PAYMENT_CLAIMED','PAID','REJECTED','EXPIRED','CANCELLED');
      create type sales_mode as enum ('OPEN','CLOSED','SCHEDULED');
      create table admin_profiles(user_id uuid,role text);
      create table admin_access_accounts(id uuid primary key,label text,role text,is_active boolean,code_salt text,code_hash text,last_login_at timestamptz);
      create table admin_sessions(id uuid,account_id uuid,session_token_hash text,created_at timestamptz,last_seen_at timestamptz,expires_at timestamptz,revoked_at timestamptz);
      create table events(id uuid primary key default gen_random_uuid(),name text not null,starts_at timestamptz,physical_capacity integer default 120,men_paid_cap integer default 45,ticket_price_cents integer not null default 800,reservation_minutes integer default 20,claim_hold_hours integer default 24,sales_mode sales_mode default 'OPEN',sales_open_at timestamptz,sales_close_at timestamptz,is_active boolean default true,created_at timestamptz default now(),updated_at timestamptz default now());
      create table reservations(id uuid primary key default gen_random_uuid(),event_id uuid references events(id),first_name text,last_name text,email text,category ticket_category,status reservation_status,amount_cents integer not null,reserved_until timestamptz,claimed_at timestamptz,paid_at timestamptz,expired_at timestamptz,qr_token_hash text,checked_in_at timestamptz,checked_in_by uuid,checked_in_by_access_id uuid,confirmed_by_access_id uuid,confirmed_by uuid,updated_at timestamptz);
      create unique index reservations_one_active_email_per_event on reservations(event_id,lower(email)) where status in ('RESERVED','PAYMENT_CLAIMED','PAID');
      create table non_paying_attendees(id uuid primary key default gen_random_uuid(),event_id uuid,first_name text,last_name text,email text,category ticket_category,checked_in_at timestamptz,created_at timestamptz,updated_at timestamptz);
      create function create_reservation(p_event_id uuid,p_first_name text,p_last_name text,p_email text,p_category ticket_category) returns jsonb language sql as $$select '{}'::jsonb$$;
      create function check_in_ticket(p_qr_token_hash text,p_admin_id uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
      create function check_in_reservation(p_reservation_id uuid,p_admin_id uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
      insert into events(id,name,ticket_price_cents) values('${event}','Party',950);
      insert into admin_access_accounts(id,role,is_active) values('${admin}','SUPER_ADMIN',true),('${door}','ADMIN',true);
      insert into reservations(event_id,email,status,amount_cents,qr_token_hash) values('${event}','legacy@example.com','PAID',800,'unchanged');
    `);
    for(const file of ['20260928_admin_event_management.sql','20260929_admin_access_auth.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
    await db.exec(migration);
    await t.test('additive backfill preserves original event price, historical amount and unknown tier',async()=>{
      const e=(await query('select * from events')).rows[0],r=(await query('select * from reservations')).rows[0];
      assert.equal(e.early_price_cents,950);assert.equal(e.late_price_cents,950);assert.equal(e.ticket_price_cents,950);
      assert.equal(r.amount_cents,800);assert.equal(r.pricing_tier,null);assert.equal(r.qr_token_hash,'unchanged');
    });
    await patch({early_price_cents:800,late_price_cents:1200});
    for(const [mode,offset,phase] of [['AUTO',1,'EARLY'],['AUTO',0,'LATE'],['AUTO',-1,'LATE'],['EARLY',1,'EARLY'],['EARLY',-1,'EARLY'],['LATE',1,'LATE'],['LATE',-1,'LATE']]){
      await t.test(mode+' with deadline offset '+offset+'ms selects and stores '+phase,async()=>{
        await db.exec('begin');
        try{
          await query("update events set pricing_mode=$1,early_price_ends_at=now()+($2::text||' milliseconds')::interval where id=$3",[mode,offset,event]);
          const p=await price(),r=await reserve(),stored=await row(r.reservation_id),amount=phase==='EARLY'?800:1200;
          assert.equal(p.phase,phase);assert.equal(p.current_price_cents,amount);assert.equal(r.amount_cents,amount);assert.equal(stored.amount_cents,amount);assert.equal(stored.pricing_tier,phase);
          assert.equal(p.early_price_ends_at!==null,mode==='AUTO'&&phase==='EARLY');
        }finally{await db.exec('rollback');}
      });
    }
    await t.test('AUTO null deadline is indefinitely EARLY; no job or browser time is involved',async()=>{
      await patch({pricing_mode:'AUTO',early_price_ends_at:null});
      const original=Date.now;try{Date.now=()=>0;assert.equal((await reserve()).pricing_tier,'EARLY');}finally{Date.now=original;}
      assert.equal((await price()).phase,'EARLY');
    });
    await t.test('event edits and re-running migration never reprice RESERVED, CLAIMED or PAID amounts',async()=>{
      const early=await reserve();await patch({early_price_cents:900,late_price_cents:1250,pricing_mode:'LATE'});
      assert.equal((await row(early.reservation_id)).amount_cents,800);
      for(const status of ['PAYMENT_CLAIMED','PAID']){await query('update reservations set status=$1 where id=$2',[status,early.reservation_id]);assert.equal((await row(early.reservation_id)).amount_cents,800);}
      const late=await reserve();assert.equal(late.amount_cents,1250);
      await db.exec(migration);assert.equal((await price()).current_price_cents,1250);assert.equal((await row(early.reservation_id)).amount_cents,800);
      assert.equal((await row(early.reservation_id)).pricing_tier,'EARLY');
    });
    await t.test('expired Early recreated after deadline gets Late; duplicate active email cannot create twice',async()=>{
      await patch({early_price_cents:800,late_price_cents:1200,pricing_mode:'EARLY'});
      const email='repeat@example.com',early=await reserve('MEN',email);
      await assert.rejects(reserve('MEN',email),/ACTIVE_RESERVATION_EXISTS/);
      await query("update reservations set reserved_until=now()-interval '1 second' where id=$1",[early.reservation_id]);
      await patch({pricing_mode:'AUTO',early_price_ends_at:'2000-01-01T00:00:00Z'});
      const late=await reserve('MEN',email);assert.equal(late.amount_cents,1200);assert.notEqual(late.reservation_id,early.reservation_id);
      assert.equal((await row(early.reservation_id)).status,'EXPIRED');assert.equal((await row(early.reservation_id)).amount_cents,800);
    });
    await t.test('CLOSED and both sides of SCHEDULED block in either pricing mode',async()=>{
      for(const pricing_mode of ['EARLY','LATE'])for(const p of [{sales_mode:'CLOSED'},{sales_mode:'SCHEDULED',sales_open_at:'2099-01-01T00:00:00Z',sales_close_at:null},{sales_mode:'SCHEDULED',sales_open_at:'2000-01-01T00:00:00Z',sales_close_at:'2001-01-01T00:00:00Z'}]){await patch({...p,pricing_mode});await assert.rejects(reserve(),/SALES_CLOSED/);}
      await patch({sales_mode:'OPEN',sales_open_at:null,sales_close_at:null});
    });
    await t.test('MEN and total capacity, including non-paying places, remain enforced',async()=>{
      await db.exec('delete from reservations;delete from non_paying_attendees;');
      await patch({physical_capacity:3,men_paid_cap:1});await reserve('MEN');await assert.rejects(reserve('MEN'),/MEN_SOLD_OUT/);
      await query('select admin_add_non_paying($1,$2,$3)',[event,{first_name:'Guest',last_name:'Resident',category:'WOMEN'},admin]);
      const results=await Promise.allSettled([reserve(),reserve()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/EVENT_SOLD_OUT/);
      assert.match(migration,/pg_advisory_xact_lock\(hashtext\(p_event_id::text\)\)/); // PGlite queues; real multi-session staging remains required.
    });
    await t.test('database rejects invalid prices, modes and infinite timestamps; door cannot edit',async()=>{
      for(const key of ['early_price_cents','late_price_cents'])for(const value of [0,-1,1.2,'1200',null,100001])await assert.rejects(patch({[key]:value}),/INVALID_EVENT/);
      for(const p of [{pricing_mode:'CLOSED'},{pricing_mode:null},{early_price_ends_at:'infinity'},{ticket_price_cents:1}])await assert.rejects(patch(p),/INVALID_EVENT/);
      await assert.rejects(patch({pricing_mode:'EARLY'},door),/FORBIDDEN/);
      await patch({early_price_cents:1235});
    });
    await t.test('new events support configurable prices, independent sales and null deadline',async()=>{
      const p={name:'Next',starts_at:null,physical_capacity:120,men_paid_cap:45,early_price_cents:975,late_price_cents:1450,early_price_ends_at:null,pricing_mode:'AUTO',reservation_minutes:20,claim_hold_hours:24,sales_mode:'CLOSED',sales_open_at:null,sales_close_at:null};
      const r=(await query('select admin_create_event($1,$2) r',[p,admin])).rows[0].r;
      assert.equal(r.early_price_cents,975);assert.equal(r.late_price_cents,1450);assert.equal(r.is_active,false);assert.equal(r.sales_mode,'CLOSED');
      assert.equal((await query('select read_event_pricing($1) p',[r.id])).rows[0].p.phase,'EARLY');
    });
    await t.test('browser roles cannot execute pricing, creation or management RPCs',async()=>{
      for(const role of ['anon','authenticated'])for(const fn of ['event_pricing(public.events,timestamptz)','read_event_pricing(uuid)','create_reservation(uuid,text,text,text,ticket_category)','admin_update_event(uuid,jsonb,uuid)','admin_create_event(jsonb,uuid)']){
        assert.equal((await query('select has_function_privilege($1,$2,\'execute\') ok',[role,fn])).rows[0].ok,false);
      }
      assert.equal((await query("select has_function_privilege('service_role','read_event_pricing(uuid)','execute') ok")).rows[0].ok,true);
    });

    await t.test('display migration defaults false, preserves core SQL and amounts, validates roles and booleans',async()=>{
      const definitions=()=>query("select proname,pg_get_functiondef(oid) definition from pg_proc where proname in ('event_pricing','read_event_pricing','create_reservation') order by proname");
      const before=(await definitions()).rows;
      const snapshots=()=>query('select id,early_price_cents,late_price_cents,early_price_ends_at,pricing_mode from events order by id');
      const prior=(await snapshots()).rows;
      const display=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261002_ticket_pricing_display_controls.sql'),'utf8');
      await db.exec(display);await db.exec(display);
      assert.deepEqual((await definitions()).rows,before);assert.deepEqual((await snapshots()).rows,prior);
      const settings=(await query('select show_pricing_countdown,show_late_price_before_start from events')).rows;
      assert.ok(settings.every(r=>r.show_pricing_countdown===false&&r.show_late_price_before_start===false));
      for(const key of ['show_pricing_countdown','show_late_price_before_start']){
        for(const value of ['true',1,0,null,{},[]])await assert.rejects(patch({[key]:value}),/INVALID_EVENT/);
        await assert.rejects(patch({[key]:true},door),/FORBIDDEN/);
      }
      await patch({physical_capacity:120,men_paid_cap:45,early_price_cents:800,late_price_cents:1200,pricing_mode:'AUTO',early_price_ends_at:'2099-01-01T12:00:00Z'});
      const early=await reserve();
      for(const show_pricing_countdown of [false,true])for(const show_late_price_before_start of [false,true]){
        const r=await patch({show_pricing_countdown,show_late_price_before_start});assert.equal(r.show_pricing_countdown,show_pricing_countdown);assert.equal(r.show_late_price_before_start,show_late_price_before_start);
        assert.equal((await reserve()).amount_cents,800);assert.equal((await price()).phase,'EARLY');
      }
      await patch({pricing_mode:'LATE'});assert.equal((await reserve()).amount_cents,1200);assert.equal((await row(early.reservation_id)).amount_cents,800);
      const create={name:'Display settings',physical_capacity:120,men_paid_cap:45,early_price_cents:800,late_price_cents:1200,pricing_mode:'AUTO',reservation_minutes:20,claim_hold_hours:24,sales_mode:'CLOSED'};
      for(const flags of [{},{show_pricing_countdown:true,show_late_price_before_start:true}]){const r=(await query('select admin_create_event($1,$2) r',[{...create,...flags},admin])).rows[0].r;assert.equal(r.show_pricing_countdown,flags.show_pricing_countdown??false);assert.equal(r.show_late_price_before_start,flags.show_late_price_before_start??false);}
      for(const role of ['anon','authenticated'])for(const fn of ['admin_update_event(uuid,jsonb,uuid)','admin_create_event(jsonb,uuid)','validate_pricing_input(jsonb)'])assert.equal((await query("select has_function_privilege($1,$2,'execute') ok",[role,fn])).rows[0].ok,false);
    });

    await t.test('paid category correction preserves identity, pricing, QR, timestamps and occupancy rules',async()=>{
      await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261003_paid_category_correction.sql'),'utf8'));
      const change=async(id,category,actor=admin)=>(await query('select admin_change_paid_category($1,$2,$3) r',[id,category,actor])).rows[0].r;
      await db.exec('delete from reservations;delete from non_paying_attendees;alter table reservations add column ticket_sent_at timestamptz;');
      await patch({physical_capacity:120,men_paid_cap:1,pricing_mode:'EARLY',sales_mode:'OPEN'});
      const first=await reserve('WOMEN');await patch({pricing_mode:'LATE'});const second=await reserve('WOMEN');
      await query("update reservations set status='PAID',paid_at=now(),ticket_sent_at=now(),claimed_at=now(),updated_at=now() where id in ($1,$2)",[first.reservation_id,second.reservation_id]);
      // Simulate historical same-name/email duplicates without disabling the production index.
      await db.exec('drop index reservations_one_active_email_per_event');
      await query("update reservations set email='duplicate@example.com' where id in ($1,$2)",[first.reservation_id,second.reservation_id]);
      const {deriveTicketToken,hashTicketToken,ticketMessage}=require('../server/tickets');
      const token=deriveTicketToken(first.reservation_id,event,'s'.repeat(32)),hash=hashTicketToken(token);
      await query('update reservations set qr_token_hash=$1 where id=$2',[hash,first.reservation_id]);
      const before=await row(first.reservation_id),duplicate=await row(second.reservation_id);
      const {publicState}=require('../server/domain'),{calculate}=require('../admin-kpis');
      const stats=async()=>{const rows=(await query('select * from reservations')).rows.map(r=>({...r,reserved_until:r.reserved_until?.toISOString(),claimed_at:r.claimed_at?.toISOString(),price:r.amount_cents/100}));const e=(await query('select * from events where id=$1',[event])).rows[0];return {kpi:calculate(rows,[]),state:publicState(e,rows,0),event:e};};
      const start=await stats();assert.notEqual(start.state.men_status,'SOLD_OUT');
      assert.equal((await change(first.reservation_id,'MEN')).changed,true);
      assert.deepEqual(await row(first.reservation_id),{...before,category:'MEN'});assert.deepEqual(await row(second.reservation_id),duplicate);
      const after=await stats();assert.equal(after.kpi.paidMen,1);assert.equal(after.kpi.paidWomen,1);assert.equal(after.kpi.paidMenPercent,'50.0%');assert.equal(after.kpi.paid,start.kpi.paid);assert.equal(after.kpi.total,start.kpi.total);assert.equal(after.kpi.revenue,20);assert.equal(after.state.men_status,'SOLD_OUT');assert.equal(after.event.physical_capacity,start.event.physical_capacity);
      assert.equal((await change(first.reservation_id,'MEN')).changed,false);
      await assert.rejects(change(second.reservation_id,'MEN'),/MEN_TICKETS_FULL/);
      await assert.rejects(reserve('MEN'),/MEN_SOLD_OUT/);
      assert.equal((await change(first.reservation_id,'WOMEN')).changed,true);assert.deepEqual(await row(first.reservation_id),before);assert.notEqual((await stats()).state.men_status,'SOLD_OUT');
      // Both live reservations and claimed holds protect the last MEN slot.
      const hold=await reserve('MEN');await assert.rejects(change(first.reservation_id,'MEN'),/MEN_TICKETS_FULL/);
      await query("update reservations set status='PAYMENT_CLAIMED',claimed_at=now(),reserved_until=now()-interval '1 minute' where id=$1",[hold.reservation_id]);await assert.rejects(change(first.reservation_id,'MEN'),/MEN_TICKETS_FULL/);
      await query("update reservations set claimed_at=now()-interval '25 hours' where id=$1",[hold.reservation_id]);await change(first.reservation_id,'MEN');
      assert.equal(deriveTicketToken(first.reservation_id,event,'s'.repeat(32)),token);assert.equal((await row(first.reservation_id)).qr_token_hash,hash);
      const message=ticketMessage({...await row(first.reservation_id),events:{name:'Party'}},Buffer.from('qr'),'tickets@example.com');assert.match(message.text,/Category: MEN/);assert.match(message.text,/€8.00/);
      // Existing QR lookup and manual lookup read the corrected row category.
      assert.equal((await query('select check_in_ticket($1,$2) r',[hash,admin])).rows[0].r.category,'MEN');
      assert.equal((await query('select check_in_reservation($1,$2) r',[first.reservation_id,admin])).rows[0].r.category,'MEN');
      await assert.rejects(change(first.reservation_id,'WOMEN'),/CATEGORY_NOT_EDITABLE/);
      await patch({men_paid_cap:2});
      const lateBefore=await row(second.reservation_id);await change(second.reservation_id,'MEN');assert.deepEqual(await row(second.reservation_id),{...lateBefore,category:'MEN'});assert.equal(lateBefore.amount_cents,1200);assert.equal(lateBefore.pricing_tier,'LATE');await change(second.reservation_id,'WOMEN');
      await assert.rejects(change(second.reservation_id,'MEN',door),/FORBIDDEN/);
      await assert.rejects(change(second.reservation_id,'MEN',null),/FORBIDDEN/);
      for(const category of [null,'men','OTHER'])await assert.rejects(change(second.reservation_id,category),/INVALID_CATEGORY/);
      for(const status of ['RESERVED','PAYMENT_CLAIMED','REJECTED','EXPIRED','CANCELLED']){await query('update reservations set status=$1 where id=$2',[status,second.reservation_id]);await assert.rejects(change(second.reservation_id,'MEN'),/CATEGORY_NOT_EDITABLE/);}
      await assert.rejects(change('99999999-9999-4999-8999-999999999999','MEN'),/RESERVATION_NOT_FOUND/);
      for(const role of ['anon','authenticated'])assert.equal((await query("select has_function_privilege($1,'admin_change_paid_category(uuid,text,uuid)','execute') ok",[role])).rows[0].ok,false);
      assert.equal((await query("select has_function_privilege('service_role','admin_change_paid_category(uuid,text,uuid)','execute') ok")).rows[0].ok,true);
    });

    await t.test('manual amount correction and audit commit atomically without repricing or changing attendance',async()=>{
      await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261004_manual_amount_adjustment.sql'),'utf8'));
      const adjust=async(id,value,actor=admin)=>(await query('select admin_adjust_reservation_amount($1,$2::jsonb,$3) r',[id,JSON.stringify(value),actor])).rows[0].r;
      const audits=async()=> (await query('select * from reservation_amount_adjustments order by adjusted_at,id')).rows;
      await db.exec('delete from reservations;delete from non_paying_attendees;');
      await patch({men_paid_cap:45,physical_capacity:120,pricing_mode:'LATE',late_price_cents:1200,sales_mode:'OPEN'});
      const global=(await query('select * from events where id=$1',[event])).rows[0];
      const a=await reserve(),b=await reserve();
      await query("update reservations set status='PAID',paid_at=now(),claimed_at=now(),ticket_sent_at=now(),qr_token_hash=id::text where id in ($1,$2)",[a.reservation_id,b.reservation_id]);
      await query("update reservations set email='same@example.com' where id in ($1,$2)",[a.reservation_id,b.reservation_id]);
      const before=await row(b.reservation_id),other=await row(a.reservation_id);
      const stats=async()=>{const r=(await query('select * from reservations')).rows;return require('../admin-kpis').calculate(r.map(x=>({...x,price:x.amount_cents/100})),[]);};
      const counts=await stats();assert.equal(counts.revenue,24);
      assert.equal((await adjust(b.reservation_id,800)).changed,true);
      assert.deepEqual(await row(b.reservation_id),{...before,amount_cents:800});assert.deepEqual(await row(a.reservation_id),other);
      assert.deepEqual(await stats(),{...counts,revenue:20});assert.deepEqual((await query('select * from events where id=$1',[event])).rows[0],global);assert.equal((await price()).current_price_cents,1200);
      let log=await audits();assert.equal(log.length,1);assert.equal(log[0].reservation_id,b.reservation_id);assert.equal(log[0].previous_amount_cents,1200);assert.equal(log[0].new_amount_cents,800);assert.equal(log[0].adjusted_by_access_id,admin);assert.equal(log[0].reason,'MANUAL_ADJUSTMENT');assert.ok(log[0].adjusted_at);
      assert.equal((await adjust(b.reservation_id,800)).changed,false);assert.equal((await audits()).length,1);
      const next=await reserve();assert.equal(next.amount_cents,1200);assert.equal(next.pricing_tier,'LATE');
      for(const status of ['RESERVED','PAYMENT_CLAIMED','PAID']){await query('update reservations set status=$1,amount_cents=1200,claimed_at=now() where id=$2',[status,next.reservation_id]);const original=await row(next.reservation_id);await adjust(next.reservation_id,800);assert.deepEqual(await row(next.reservation_id),{...original,amount_cents:800});}
      for(const value of [0,-1,0.1,100001,'800',null,true,{},[]])await assert.rejects(adjust(b.reservation_id,value),/INVALID_AMOUNT/);
      await assert.rejects(adjust(b.reservation_id,900,door),/FORBIDDEN/);await assert.rejects(adjust(b.reservation_id,900,null),/FORBIDDEN/);
      for(const status of ['REJECTED','EXPIRED','CANCELLED']){await query('update reservations set status=$1 where id=$2',[status,next.reservation_id]);await assert.rejects(adjust(next.reservation_id,900),/AMOUNT_NOT_EDITABLE/);}
      // Checked-in PAID accounting corrections preserve admission and QR identity.
      await query('update reservations set checked_in_at=now() where id=$1',[a.reservation_id]);const admitted=await row(a.reservation_id);await adjust(a.reservation_id,850);assert.deepEqual(await row(a.reservation_id),{...admitted,amount_cents:850});
      const count=(await audits()).length;
      await db.exec('alter table reservation_amount_adjustments add constraint test_audit_failure check (new_amount_cents<>900)');
      await assert.rejects(adjust(b.reservation_id,900));assert.equal((await row(b.reservation_id)).amount_cents,800);assert.equal((await audits()).length,count);
      await db.exec('alter table reservation_amount_adjustments drop constraint test_audit_failure');
      await db.exec("create function test_amount_failure() returns trigger language plpgsql as $$begin if new.amount_cents=950 then raise exception 'TEST_UPDATE_FAILURE'; end if; return new; end;$$;create trigger test_amount_failure before update on reservations for each row execute function test_amount_failure();");
      await assert.rejects(adjust(b.reservation_id,950),/TEST_UPDATE_FAILURE/);assert.equal((await audits()).length,count);assert.equal((await row(b.reservation_id)).amount_cents,800);
      await db.exec('drop trigger test_amount_failure on reservations;drop function test_amount_failure()');
      await query('select admin_change_paid_category($1,$2,$3)',[b.reservation_id,'MEN',admin]);assert.equal((await row(b.reservation_id)).amount_cents,800);assert.equal((await row(b.reservation_id)).pricing_tier,'LATE');await adjust(b.reservation_id,875);assert.equal((await row(b.reservation_id)).category,'MEN');
      // The existing exact-ID PAID/no-check-in DELETE remains legal; history survives.
      const revenue=(await stats()).revenue;const history=(await audits()).length;
      await query("delete from reservations where id=$1 and status='PAID' and checked_in_at is null",[b.reservation_id]);assert.equal((await stats()).revenue,revenue-8.75);assert.equal((await audits()).length,history);await assert.rejects(adjust(b.reservation_id,800),/RESERVATION_NOT_FOUND/);
      for(const role of ['anon','authenticated']){assert.equal((await query("select has_table_privilege($1,'reservation_amount_adjustments','select') ok",[role])).rows[0].ok,false);assert.equal((await query("select has_function_privilege($1,'admin_adjust_reservation_amount(uuid,jsonb,uuid)','execute') ok",[role])).rows[0].ok,false);}
      assert.equal((await query("select relrowsecurity from pg_class where oid='reservation_amount_adjustments'::regclass")).rows[0].relrowsecurity,true);
    });
  }finally{await db.close();}
});
