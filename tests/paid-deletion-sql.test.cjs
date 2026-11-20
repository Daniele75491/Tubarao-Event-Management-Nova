const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {deletePaidTicket}=require('../server/reservation-deletion');
const backend=require('../server/backend'),{checkIn}=require('../server/checkin'),{eventBackup}=require('../server/event-backup');
const {headers,sessionRow}=require('./session-fixture.cjs');
const eventId='11111111-1111-4111-8111-111111111111',admin='22222222-2222-4222-8222-222222222222';
test('paid DELETE and existing check-in SQL invalidate only the selected ticket and refresh derived data',async t=>{
  const pg=new PGlite(),rpcCalls=[];
  try{
    await pg.exec(`
      create table admin_access_accounts(id uuid,role text,is_active boolean);
      insert into admin_access_accounts values('${admin}','SUPER_ADMIN',true);
      create table events(id uuid primary key,name text,starts_at timestamptz,is_active boolean,sales_mode text,created_at timestamptz,physical_capacity integer,men_paid_cap integer,early_price_cents integer,late_price_cents integer,early_price_ends_at timestamptz,pricing_mode text,show_pricing_countdown boolean not null default false,show_late_price_before_start boolean not null default false,reservation_minutes integer,claim_hold_hours integer,sales_open_at timestamptz,sales_close_at timestamptz);
      insert into events values('${eventId}','Party',null,true,'OPEN',now(),2,1,800,1200,null,'AUTO',false,false,20,24,null,null);
      create table reservations(id uuid primary key default gen_random_uuid(),event_id uuid,first_name text,last_name text,email text,category text,status text,amount_cents integer,pricing_tier text,reserved_until timestamptz,created_at timestamptz default now(),claimed_at timestamptz,paid_at timestamptz,rejected_at timestamptz,checked_in_at timestamptz,checked_in_by_access_id uuid,updated_at timestamptz,qr_token_hash text,qr_created_at timestamptz,ticket_sent_at timestamptz,ticket_email_last_attempt_at timestamptz,ticket_email_attempts integer,ticket_email_error text);
      create table non_paying_attendees(id uuid,first_name text,last_name text,email text,category text,checked_in_at timestamptz,event_id uuid);
    `);
    const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260929_admin_access_auth.sql'),'utf8');
    await pg.exec(migration.slice(migration.indexOf('create or replace function public.check_in_reservation'),migration.indexOf('-- Payment confirmation continues')));
    // Small SQL-backed PostgREST adapter: executes the handler's real DELETE
    // predicates as one statement. No email/provider mocks are used or needed.
    const db={from(table){
      if(table==='admin_sessions')return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:sessionRow('SUPER_ADMIN',admin)})};
      assert.ok(['events','reservations','non_paying_attendees'].includes(table));
      let fields='*',deleting=false,single=false,head=false,count=false,offset=0,limit=null;const where=[],args=[];
      const q={select(value,options={}){fields=value.replace(/,events\(name\)/g,'');head=options.head;count=options.count==='exact';return q;},delete(){deleting=true;return q;},
        eq(key,value){assert.match(key,/^[a-z_]+$/);args.push(value);where.push(key+'=$'+args.length);return q;},
        is(key,value){assert.equal(value,null);assert.match(key,/^[a-z_]+$/);where.push(key+' IS NULL');return q;},
        in(key,values){assert.match(key,/^[a-z_]+$/);where.push(key+' IN ('+values.map(value=>{args.push(value);return '$'+args.length;}).join(',')+')');return q;},
        order(){return q;},limit(n){limit=n;return q;},range(from,to){offset=from;limit=to-from+1;return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},
        async then(resolve,reject){try{
          const filter=where.length?' WHERE '+where.join(' AND '):'';
          const sql=deleting?'DELETE FROM '+table+filter+' RETURNING id':'SELECT '+fields+' FROM '+table+filter+(limit!==null?' LIMIT '+limit:'')+' OFFSET '+offset;
          const result=await pg.query(sql,args);
          // PostgREST serializes timestamptz as ISO strings.
          const rows=JSON.parse(JSON.stringify(result.rows));return resolve({data:head?null:single?rows[0]??null:rows,count:count?rows.length:null});
        }catch(error){return reject(error);}}
      };return q;
    },async rpc(name,args){rpcCalls.push(name);
      if(name==='read_event_pricing')return {data:{phase:'EARLY',current_price_cents:800,next_price_cents:1200,early_price_ends_at:null,server_now:new Date().toISOString()}};
      assert.ok(['check_in_ticket','check_in_reservation'].includes(name));const values=name==='check_in_ticket'?[args.p_qr_token_hash,args.p_admin_id]:[args.p_reservation_id,args.p_admin_id];
      return {data:(await pg.query('select '+name+'($1,$2) result',values)).rows[0].result};
    }};
    const tokens=['a'.repeat(43),'b'.repeat(43)],ids=[];
    for(let i=0;i<2;i++)ids.push((await pg.query("insert into reservations(event_id,first_name,last_name,email,category,status,amount_cents,pricing_tier,paid_at,qr_token_hash,qr_created_at,ticket_sent_at) values($1,'Laura','Colturi','same@example.com',$2,'PAID',$3,$4,now(),$5,now(),now()) returning id",[eventId,i?'WOMEN':'MEN',i?1200:800,i?'LATE':'EARLY',createHash('sha256').update(tokens[i]).digest('hex')])).rows[0].id);
    const req=id=>({headers,body:{reservation_id:id}});
    const beforeDuplicate=JSON.stringify((await pg.query('select * from reservations where id=$1',[ids[1]])).rows[0]);
    await t.test('hard deletion removes one duplicate, revenue/count/CSV/capacity derive from remaining rows',async()=>{
      const before=await backend.dashboard(db,{headers});assert.equal(before.kpis.revenue,20);assert.equal(before.kpis.paid,2);assert.equal((await backend.eventState(db)).women_status,'SOLD_OUT');
      await deletePaidTicket(db,req(ids[0]));
      const after=await backend.dashboard(db,{headers});assert.equal(after.kpis.revenue,12);assert.equal(after.kpis.paid,1);assert.equal(after.kpis.total,1);assert.deepEqual(after.reservations.map(r=>r.id),[ids[1]]);
      assert.equal(JSON.stringify((await pg.query('select * from reservations where id=$1',[ids[1]])).rows[0]),beforeDuplicate);
      const state=await backend.eventState(db);assert.notEqual(state.women_status,'SOLD_OUT');assert.notEqual(state.men_status,'SOLD_OUT');
      const backup=await eventBackup(db,{headers});assert.match(backup.csv,/"12\.00"/);assert.doesNotMatch(backup.csv,/"8\.00"/);assert.equal(backup.csv.split('Laura').length-1,1);
    });
    await t.test('deleted QR and manual entry are invalid at both API and SQL boundaries; remaining QR works',async()=>{
      assert.deepEqual(await checkIn(db,{headers,body:{qr_payload:'TUBARAO:'+tokens[0]}}),{result:'INVALID'});
      assert.deepEqual(await checkIn(db,req(ids[0]),true),{result:'INVALID'});
      assert.equal((await pg.query('select check_in_reservation($1,$2) r',[ids[0],admin])).rows[0].r.result,'INVALID');
      assert.equal((await pg.query('select check_in_ticket($1,$2) r',[createHash('sha256').update(tokens[0]).digest('hex'),admin])).rows[0].r.result,'INVALID');
      assert.equal((await checkIn(db,{headers,body:{qr_payload:'TUBARAO:'+tokens[1]}})).result,'CHECKED_IN');
      assert.equal((await checkIn(db,req(ids[1]),true)).result,'ALREADY_CHECKED_IN');
    });
    await t.test('check-in-first prevents deletion; delete-first prevents check-in and recovery/resend',async()=>{
      await assert.rejects(deletePaidTicket(db,req(ids[1])),e=>e.status===409);
      await assert.rejects(deletePaidTicket(db,req(ids[0])),e=>e.status===409);
      await assert.rejects(backend.ownedReservation(db,{reservation_id:ids[0],email:'same@example.com'}),e=>e.status===404);
      await assert.rejects(backend.resendTicket(db,req(ids[0])),e=>e.status===404);
      const recovered=await backend.reserve(db,{body:{first_name:'Laura',last_name:'Colturi',email:'same@example.com',category:'WOMEN'}});assert.equal(recovered.reservation_id,ids[1]);assert.equal(recovered.amount_cents,1200);
      assert.ok(rpcCalls.every(name=>['read_event_pricing','check_in_ticket','check_in_reservation'].includes(name)));
    });
  }finally{await pg.close();}
});
