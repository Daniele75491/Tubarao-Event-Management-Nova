const {headers:sessionHeaders,sessionRow}=require('./session-fixture.cjs');
const {test}=require('node:test');const assert=require('node:assert/strict');
const events=require('../server/events');const {endpoint}=require('../server/http');
const id='11111111-1111-4111-8111-111111111111';
const base={id,name:'Party',starts_at:null,physical_capacity:120,men_paid_cap:45,early_price_cents:800,late_price_cents:1200,early_price_ends_at:null,pricing_mode:'AUTO',reservation_minutes:15,claim_hold_hours:24,sales_mode:'OPEN',sales_open_at:null,sales_close_at:null};
function fixture(){let role='SUPER_ADMIN',failure=null;const calls=[];const db={auth:{async getUser(token){return {data:{user:token==='valid'?{id}:null}};}},from(table){const q={select(){return q;},eq(){return q;},in(){return q;},order(){return q;},limit(){return q;},range(){return q;},maybeSingle(){return q;},then(resolve){return Promise.resolve({data:table==='admin_sessions'?sessionRow(role,id):table==='events'?[base]:[]}).then(resolve);}};return q;},async rpc(name,args){calls.push([name,args]);return failure?{error:failure}:{data:{...base,...args.p_patch,is_active:false}};}};return {db,calls,req:{headers:{...sessionHeaders},method:'POST',body:{name:'Next'}},role:value=>role=value,fail:value=>failure=value};}
test('event APIs require verified admin; creation/activation require SUPER_ADMIN',async()=>{
for(const fn of [events.updateEvent,events.listEvents,events.createEvent,events.activateEvent,events.nonPaying]){const f=fixture();f.req.headers.cookie='';await assert.rejects(fn(f.db,f.req),e=>e.status===401);f.req.headers.cookie=sessionHeaders.cookie;f.role('ADMIN');await assert.rejects(fn(f.db,f.req),e=>e.status===403);}
for(const fn of [events.createEvent,events.activateEvent]){const f=fixture();f.role('ADMIN');await assert.rejects(fn(f.db,f.req),e=>e.status===403);assert.equal(f.calls.length,0);}
});
test('event input rejects invalid values, schedules, dates and hidden control fields',()=>{
for(const patch of [{physical_capacity:0},{men_paid_cap:-1},{men_paid_cap:121},{ticket_price_cents:1.5},{reservation_minutes:0},{claim_hold_hours:0},{sales_mode:'BAD'},{sales_mode:'SCHEDULED'},{starts_at:'2026-02-31T12:00:00Z'},{starts_at:'2026-10-01T12:00'},{sales_open_at:'2026-10-02T12:00:00Z',sales_close_at:'2026-10-01T12:00:00Z'},{is_active:true},{name:''}])assert.throws(()=>events.eventInput({body:patch},base));
assert.deepEqual(events.eventInput({body:{name:' New ',sales_mode:'SCHEDULED',sales_open_at:'2026-10-01T12:00:00Z'}},base),{name:'New',sales_mode:'SCHEDULED',sales_open_at:'2026-10-01T12:00:00Z'});
});
test('update uses transactional RPC and current ID; stale event cannot be silently changed',async()=>{
const f=fixture();await events.updateEvent(f.db,f.req);assert.deepEqual(f.calls[0],['admin_update_event',{p_event_id:id,p_patch:{name:'Next'},p_admin_id:id}]);
f.req.headers['x-event-id']='other';await assert.rejects(events.updateEvent(f.db,f.req),e=>e.code==='EVENT_CHANGED');
});
test('creation defaults to CLOSED and cannot inject active flag; activation uses one RPC',async()=>{
const f=fixture();f.role('SUPER_ADMIN');await events.createEvent(f.db,f.req);assert.equal(f.calls[0][0],'admin_create_event');assert.equal(f.calls[0][1].p_values.sales_mode,'CLOSED');assert.equal('is_active' in f.calls[0][1].p_values,false);
f.req.body={event_id:id};await events.activateEvent(f.db,f.req);assert.deepEqual(f.calls[1],['admin_activate_event',{p_event_id:id,p_admin_id:id}]);
});
test('non-paying inputs validated and add/remove use current event and verified actor',async()=>{
const f=fixture();f.req.body={first_name:' Ana ',last_name:'Silva',category:'WOMEN'};await events.nonPaying(f.db,f.req);assert.equal(f.calls[0][0],'admin_add_non_paying');assert.equal(f.calls[0][1].p_values.email,null);assert.equal(f.calls[0][1].p_event_id,id);
f.req.body.category='OTHER';await assert.rejects(events.nonPaying(f.db,f.req),e=>e.status===400);
f.req.method='DELETE';f.req.body={attendee_id:id};await events.nonPaying(f.db,f.req);assert.equal(f.calls[1][0],'admin_remove_non_paying');
});
test('capacity/setup errors are actionable and unknown database errors are sanitized',async()=>{
for(const code of ['CAPACITY_TOO_LOW','MEN_CAP_TOO_LOW','EVENT_FULL']){const f=fixture();f.fail({message:code});await assert.rejects(events.updateEvent(f.db,f.req),e=>e.code===code&&e.status===409);}
const f=fixture();f.fail({code:'PGRST202',message:'private'});await assert.rejects(events.updateEvent(f.db,f.req),e=>e.code==='SETUP_REQUIRED');
});
test('PATCH and DELETE enforce JSON and same-origin just like POST',async()=>{
for(const method of ['PATCH','DELETE'])for(const [headers,expected]of [[{},415],[{'content-type':'application/json','sec-fetch-site':'cross-site'},403]]){let status;await endpoint(['GET','POST','PATCH','DELETE'],()=>({}))({method,headers},{setHeader(){},status(n){status=n;return this;},json(){}});assert.equal(status,expected);}
});
