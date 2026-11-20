const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const admin='11111111-1111-4111-8111-111111111111',superId='22222222-2222-4222-8222-222222222222',eventId='33333333-3333-4333-8333-333333333333';
const settings={name:'Future party',starts_at:null,physical_capacity:120,men_paid_cap:45,ticket_price_cents:800,reservation_minutes:15,claim_hold_hours:24,sales_mode:'CLOSED',sales_open_at:null,sales_close_at:null};
test('event-management SQL runs against PostgreSQL and enforces transaction rules',async t=>{
const db=new PGlite();
try{
await db.exec(`
create role anon; create role authenticated; create role service_role;
create type ticket_category as enum ('MEN','WOMEN');
create type reservation_status as enum ('RESERVED','PAYMENT_CLAIMED','PAID','REJECTED','EXPIRED','CANCELLED');
create type sales_mode as enum ('OPEN','CLOSED','SCHEDULED');
create table admin_profiles(user_id uuid primary key,role text);
create table events(id uuid primary key default gen_random_uuid(),name text not null,starts_at timestamptz,physical_capacity integer not null default 120,men_paid_cap integer not null default 45,ticket_price_cents integer not null default 800,reservation_minutes integer not null default 15,claim_hold_hours integer not null default 24,sales_mode sales_mode not null default 'CLOSED',sales_open_at timestamptz,sales_close_at timestamptz,is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table reservations(id uuid primary key default gen_random_uuid(),event_id uuid references events(id),status reservation_status,category ticket_category,reserved_until timestamptz,claimed_at timestamptz,amount_cents integer default 800);
create table non_paying_attendees(id uuid primary key default gen_random_uuid(),event_id uuid references events(id),first_name text not null,last_name text not null,email text,category ticket_category not null,checked_in_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
insert into admin_profiles values('${admin}','ADMIN'),('${superId}','SUPER_ADMIN');
insert into events(id,name,physical_capacity,men_paid_cap,sales_mode) values('${eventId}','Current party',4,2,'OPEN');
insert into reservations(event_id,status,category,reserved_until,claimed_at) values
('${eventId}','PAID','MEN',now()-interval '1 day',null),
('${eventId}','RESERVED','MEN',now()+interval '1 hour',null),
('${eventId}','PAYMENT_CLAIMED','WOMEN',now()-interval '1 hour',now()-interval '1 hour'),
('${eventId}','RESERVED','MEN',now()-interval '1 minute',null),
('${eventId}','PAYMENT_CLAIMED','MEN',now()-interval '1 day',now()-interval '25 hours'),
('${eventId}','REJECTED','MEN',now()+interval '1 hour',null);
insert into non_paying_attendees(event_id,first_name,last_name,category) values('${eventId}','Resident','One','WOMEN');
`);
await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260928_admin_event_management.sql'),'utf8'));
const call=async(name,args)=>{const casts=args.map(v=>typeof v==='object'?'jsonb':'uuid');return (await db.query(`select public.${name}(${args.map((v,i)=>'$'+(i+1)+'::'+casts[i]).join(',')}) as value`,args.map(v=>typeof v==='object'?JSON.stringify(v):v))).rows[0].value;};
await t.test('lowering physical capacity or MEN cap below active occupancy fails without writes',async()=>{
await assert.rejects(call('admin_update_event',[eventId,{physical_capacity:3},admin]),/CAPACITY_TOO_LOW/);
await assert.rejects(call('admin_update_event',[eventId,{men_paid_cap:1},admin]),/MEN_CAP_TOO_LOW/);
assert.equal((await db.query('select physical_capacity from events where id=$1',[eventId])).rows[0].physical_capacity,4);
});
await t.test('schedule, cap and role checks are enforced in the database too',async()=>{
for(const patch of [{physical_capacity:0},{men_paid_cap:5},{ticket_price_cents:-1},{reservation_minutes:0},{claim_hold_hours:0},{sales_mode:'SCHEDULED'},{sales_open_at:'2026-10-02T00:00:00Z',sales_close_at:'2026-10-01T00:00:00Z'},{is_active:false}])await assert.rejects(call('admin_update_event',[eventId,patch,admin]),/INVALID_EVENT/);
await assert.rejects(call('admin_create_event',[settings,admin]),/FORBIDDEN/);
await assert.rejects(call('admin_activate_event',[eventId,admin]),/FORBIDDEN/);
});
await t.test('capacity includes live holds and non-paying guests; expired/rejected rows do not count',async()=>{
const person={first_name:'Extra',last_name:'Guest',category:'MEN',email:null};
await assert.rejects(call('admin_add_non_paying',[eventId,person,admin]),/EVENT_FULL/);
await call('admin_update_event',[eventId,{physical_capacity:5},admin]);
const added=await call('admin_add_non_paying',[eventId,person,admin]);assert.equal(added.event_id,eventId);
await assert.rejects(call('admin_add_non_paying',[eventId,person,admin]),/EVENT_FULL/);
await call('admin_remove_non_paying',[eventId,added.id,admin]);
await assert.rejects(call('admin_remove_non_paying',[eventId,added.id,admin]),/ATTENDEE_NOT_FOUND/);
assert.equal(Number((await db.query('select count(*) as n from non_paying_attendees')).rows[0].n),1);
});
await t.test('claim-window extension accounts for revived holds and price changes preserve existing amounts',async()=>{
await assert.rejects(call('admin_update_event',[eventId,{claim_hold_hours:30},admin]),/MEN_CAP_TOO_LOW/);
await call('admin_update_event',[eventId,{ticket_price_cents:1235},admin]);
assert.equal((await db.query('select amount_cents from reservations limit 1')).rows[0].amount_cents,800);
});
await t.test('create is inactive; activation preserves history and rolls back invalid switches',async()=>{
const future=await call('admin_create_event',[settings,superId]);assert.equal(future.is_active,false);
await assert.rejects(call('admin_activate_event',['44444444-4444-4444-8444-444444444444',superId]),/EVENT_NOT_FOUND/);
assert.equal((await db.query('select is_active from events where id=$1',[eventId])).rows[0].is_active,true);
await call('admin_activate_event',[future.id,superId]);
const events=(await db.query('select id,is_active from events')).rows;assert.equal(events.length,2);assert.equal(events.filter(e=>e.is_active).length,1);assert.equal(events.find(e=>e.id===future.id).is_active,true);
assert.equal(Number((await db.query('select count(*) n from reservations')).rows[0].n),6);
await assert.rejects(call('admin_update_event',[eventId,{name:'Wrong event'},admin]),/EVENT_CHANGED/);
const old=(await db.query('select id from non_paying_attendees limit 1')).rows[0].id;
await assert.rejects(call('admin_remove_non_paying',[future.id,old,admin]),/ATTENDEE_NOT_FOUND/);
});
await t.test('mutations are callable by service role but not anon/authenticated',async()=>{
for(const role of ['anon','authenticated','service_role']){const allowed=(await db.query("select has_function_privilege($1,'public.admin_update_event(uuid,jsonb,uuid)','EXECUTE') as allowed",[role])).rows[0].allowed;assert.equal(allowed,role==='service_role');}
});
}finally{await db.close();}
});
