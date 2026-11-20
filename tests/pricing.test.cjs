const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const backend=require('../server/backend'),events=require('../server/events');
const {reservationInput}=require('../server/validation');
const {headers,sessionRow}=require('./session-fixture.cjs');
const {ticketMessage}=require('../server/tickets');
const {eventBackup}=require('../server/event-backup');
const id='11111111-1111-4111-8111-111111111111';
const guest={first_name:'Ana',last_name:'Silva',email:'ana@example.com',category:'WOMEN'};
const event={id,name:'Party',starts_at:null,is_active:true,physical_capacity:120,men_paid_cap:45,early_price_cents:800,late_price_cents:1200,early_price_ends_at:'2000-01-01T00:00:00Z',pricing_mode:'AUTO',reservation_minutes:20,claim_hold_hours:24,sales_mode:'OPEN',sales_open_at:null,sales_close_at:null};
function fixture(rows=[],role='SUPER_ADMIN'){
  const calls=[],pricing={phase:'LATE',current_price_cents:1200,next_price_cents:null,early_price_ends_at:null,server_now:new Date().toISOString()};
  const db={from(table){const q={then(resolve){return Promise.resolve({data:table==='admin_sessions'?sessionRow(role,id):table==='events'?(q.one?event:[event]):table==='reservations'?(q.one?rows[0]??null:rows):[],count:0}).then(resolve);}};
    for(const name of ['select','eq','in','order','limit','range'])q[name]=()=>q;
    for(const name of ['maybeSingle','single'])q[name]=()=>{q.one=true;return q;};return q;
  },async rpc(name,args){calls.push([name,args]);if(name==='read_event_pricing')return {data:pricing};if(name==='claim_payment')return {data:{status:rows[0].status='PAYMENT_CLAIMED'}};return {data:{...event,...args.p_patch}};}};
  return {db,calls,pricing};
}
test('identity recovery, state and repeated claims keep Early amount during Late pricing',async()=>{
  const row={...guest,id,event_id:id,status:'RESERVED',pricing_tier:'EARLY',amount_cents:800,reserved_until:new Date(Date.now()+1200000).toISOString(),claimed_at:new Date().toISOString()};
  const f=fixture([row]);
  const resumed=await backend.reserve(f.db,{body:guest});
  assert.equal(resumed.amount_cents,800);assert.equal(resumed.pricing_tier,'EARLY');assert.equal('payment_url' in resumed,false);assert.equal(f.calls.length,0);
  for(let i=0;i<2;i++){const claimed=await backend.claim(f.db,{body:{reservation_id:id,email:guest.email}});assert.equal(claimed.amount_cents,800);assert.equal(claimed.pricing_tier,'EARLY');assert.equal('payment_url' in claimed,false);}
  row.status='PAID';const paid=await backend.ownedReservation(f.db,{reservation_id:id,email:guest.email});assert.equal(paid.amount_cents,800);assert.equal('payment_url' in paid,false);
  row.amount_cents=1200;row.pricing_tier='LATE';assert.equal((await backend.ownedReservation(f.db,{reservation_id:id,email:guest.email})).amount_cents,1200);
});
test('reserve rejects every client-controlled pricing, time and payment field',()=>{
  for(const key of ['price','price_cents','amount','amount_cents','pricing_tier','phase','payment_url','revolut_amount','ticket_price_cents','early_price_cents','server_now','client_time','event_id'])assert.throws(()=>reservationInput({body:{...guest,[key]:1}}),e=>e.status===400);
});
test('event-state uses database pricing/time and exposes no capacity or override settings',async()=>{
  const f=fixture();const state=await backend.eventState(f.db);
  assert.equal(state.pricing.phase,'LATE');assert.equal(state.ticket_price_cents,1200);assert.equal(state.server_now,f.pricing.server_now);
  assert.doesNotMatch(JSON.stringify(state),/physical_capacity|men_paid_cap|pricing_mode|early_price_cents|late_price_cents|non_paying/);
  assert.deepEqual(f.calls,[['read_event_pricing',{p_event_id:id}]]);
});
test('pricing validation is strict and all settings remain SUPER_ADMIN-only',async()=>{
  for(const key of ['early_price_cents','late_price_cents'])for(const value of [NaN,Infinity,0,-1,0.1,'1200',null,100001])assert.throws(()=>events.eventInput({body:{[key]:value}},event));
  for(const patch of [{pricing_mode:'CLOSED'},{pricing_mode:null},{early_price_ends_at:'2026-02-30T12:00:00Z'},{early_price_ends_at:'tomorrow'},{ticket_price_cents:1}])assert.throws(()=>events.eventInput({body:patch},event));
  const patch={early_price_cents:875,late_price_cents:1225,pricing_mode:'LATE',early_price_ends_at:null};
  for(const role of ['ADMIN','SUPER_ADMIN']){const f=fixture([],role),req={headers,body:patch};if(role==='ADMIN')await assert.rejects(events.updateEvent(f.db,req),e=>e.status===403);else{await events.updateEvent(f.db,req);assert.deepEqual(f.calls[0][1].p_patch,patch);}}
  await assert.rejects(events.updateEvent(fixture().db,{headers:{},body:patch}),e=>e.status===401);
});
test('mixed paid amounts drive revenue, expected payment, CSV and ticket emails',async()=>{
  const rows=[...Array.from({length:10},()=>({...guest,status:'PAID',amount_cents:800,pricing_tier:'EARLY'})),...Array.from({length:5},()=>({...guest,status:'PAID',amount_cents:1200,pricing_tier:'LATE'})),{...guest,status:'RESERVED',amount_cents:1200,reserved_until:'2099-01-01'}];
  const f=fixture(rows),dashboard=await backend.dashboard(f.db,{headers});assert.equal(dashboard.kpis.revenue,140);assert.equal(dashboard.reservations[10].amount_cents,1200);
  const backup=await eventBackup(f.db,{headers});assert.match(backup.csv,/"8\.00"/);assert.match(backup.csv,/"12\.00"/);
  for(const cents of [800,1200]){const message=ticketMessage({...guest,amount_cents:cents,events:{name:'Party'}},Buffer.from('test'),'tickets@example.com');assert.match(message.text,new RegExp('€'+(cents/100).toFixed(2).replace('.','\\.')));}
  assert.match(fs.readFileSync(path.join(__dirname,'../admin.html'),'utf8'),/<th[^>]*>Expected amount<\/th>/);
  assert.match(fs.readFileSync(path.join(__dirname,'../admin.js'),'utf8'),/Tubarao\.euro\(reservation.amount_cents\)/);
});
test('visual countdown refetches once at zero, never selects price, hides in Late/forced modes',()=>{
  const nodes=new Map(),timers=[],requests=[];let seconds=1;
  const el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false});return nodes.get(id);};
  let state={pricing:{phase:'EARLY',current_price_cents:800,next_price_cents:1200,early_price_ends_at:'2026-10-04T19:00:00Z'}};let render;
  const api={getEvent:()=>state,getEventError:()=>'',euro:n=>'€'+n/100,remaining:()=>seconds,refreshEvent:force=>requests.push(force),watchEvent:fn=>{render=fn;fn();}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ticket-pricing.js'),'utf8'),{Tubarao:api,document:{getElementById:el,hidden:false},setInterval:fn=>timers.push(fn),Date});
  assert.equal(el('current-price').textContent,'€8');assert.equal(el('next-price').hidden,false);
  seconds=0;timers[0]();timers[0]();assert.deepEqual(requests,[true]);assert.equal(el('current-price').textContent,'€8'); // No local price transition.
  state={pricing:{phase:'LATE',current_price_cents:1200,next_price_cents:null,early_price_ends_at:null}};render();assert.equal(el('current-price').textContent,'€12');assert.equal(el('price-countdown-panel').hidden,true);assert.equal(el('next-price').hidden,true);
  state={pricing:{phase:'EARLY',current_price_cents:800,next_price_cents:1200,early_price_ends_at:null}};render();assert.equal(el('price-countdown-panel').hidden,true);
});

test('database timestamp corrects an incorrect browser clock; visibility refresh never polls each second',async()=>{
  const databaseTime='2026-10-04T18:00:00Z',intervals=[],listeners={};let fetches=0;
  class WrongClock extends Date {static now(){return Date.parse('2040-01-01T00:00:00Z');}}
  const context={window:{addEventListener:(name,fn)=>listeners[name]=fn},document:{hidden:false,addEventListener:(name,fn)=>listeners[name]=fn},Date:WrongClock,AbortSignal,
    fetch:async()=>{fetches++;return {ok:true,headers:{get:()=>null},json:async()=>({server_now:databaseTime})};},setInterval:(fn,ms)=>intervals.push(ms)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),context);
  const api=context.window.Tubarao;await api.refreshEvent(true);assert.equal(api.now(),Date.parse(databaseTime));assert.equal(api.remaining('2026-10-04T18:00:10Z'),10);
  api.watchEvent(()=>{});assert.deepEqual(intervals,[30000]);assert.equal(typeof listeners.visibilitychange,'function');assert.equal(typeof listeners.focus,'function');assert.equal(fetches,1);
});

 test('display preferences validate strictly, require SUPER_ADMIN and redact only the future price',async()=>{
  const patch={show_pricing_countdown:true,show_late_price_before_start:false};
  for(const key of Object.keys(patch))for(const value of ['true','false',0,1,null,{},[]])assert.throws(()=>events.eventInput({body:{[key]:value}},event));
  for(const role of ['ADMIN','SUPER_ADMIN']){const f=fixture([],role);if(role==='ADMIN')await assert.rejects(events.updateEvent(f.db,{headers,body:patch}),e=>e.status===403);else{await events.updateEvent(f.db,{headers,body:patch});assert.deepEqual(f.calls[0][1].p_patch,patch);}}
  await assert.rejects(events.updateEvent(fixture().db,{headers:{},body:patch}),e=>e.status===401);
  for(const key of Object.keys(patch))assert.throws(()=>reservationInput({body:{...guest,[key]:true}}));
  try{for(const countdown of [false,true])for(const late of [false,true]){
    event.show_pricing_countdown=countdown;event.show_late_price_before_start=late;
    const f=fixture();Object.assign(f.pricing,{phase:'EARLY',current_price_cents:875,next_price_cents:1325});
    const state=await backend.eventState(f.db);assert.equal(state.pricing.show_countdown,countdown);assert.equal(state.pricing.show_late_price,late);assert.equal(state.pricing.current_price_cents,875);assert.equal(state.pricing.next_price_cents,late?1325:null);
  }}finally{delete event.show_pricing_countdown;delete event.show_late_price_before_start;}
 });
 test('all display combinations preserve Early and Late active prices, including forced Early',()=>{
  const nodes=new Map();const el=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};let render,state;
  const api={getEvent:()=>state,getEventError:()=>'',euro:n=>'€'+n/100,remaining:()=>120,watchEvent:fn=>render=fn};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ticket-pricing.js'),'utf8'),{Tubarao:api,document:{getElementById:el},setInterval(){},Date});
  for(const countdown of [false,true])for(const late of [false,true])for(const phase of ['EARLY','LATE'])for(const deadline of [null,'2099-01-01T12:00:00Z']){
    state={pricing:{phase,current_price_cents:phase==='EARLY'?875:1325,next_price_cents:1325,early_price_ends_at:deadline,show_countdown:countdown,show_late_price:late}};render();
    assert.equal(el('current-price').textContent,phase==='EARLY'?'€8.75':'€13.25');
    assert.equal(el('price-countdown-panel').hidden,!(phase==='EARLY'&&countdown&&deadline));
    assert.equal(el('next-price').hidden,phase!=='EARLY');
    assert.equal(el('next-price-label').textContent,phase==='EARLY'?'LATE TICKETS'+(late?' · €13.25':''):'');
  }
 });

test('adjusted LATE amounts flow through recovery, state, claims, payment URL and CSV without changing event price',async()=>{
 for(const status of ['RESERVED','PAYMENT_CLAIMED','PAID']){
 const row={...guest,id,event_id:id,status,pricing_tier:'LATE',amount_cents:1200,reserved_until:new Date(Date.now()+1200000).toISOString(),claimed_at:new Date().toISOString()};const f=fixture([row]);const original=f.db.rpc;
 f.db.rpc=async(name,args)=>{if(name==='admin_adjust_reservation_amount'){row.amount_cents=args.p_amount_cents;return {data:{reservation_id:id,amount_cents:row.amount_cents,changed:true}};}return original(name,args);};
 await require('../server/amount-adjustment').adjustAmount(f.db,{headers,body:{reservation_id:id,amount_cents:800}});
 const recovered=await backend.reserve(f.db,{body:guest});assert.equal(recovered.amount_cents,800);assert.equal(recovered.pricing_tier,'LATE');assert.equal('payment_url' in recovered,false);assert.equal((await backend.ownedReservation(f.db,{reservation_id:id,email:guest.email})).amount_cents,800);
 if(status!=='PAID')assert.equal((await backend.claim(f.db,{body:{reservation_id:id,email:guest.email}})).amount_cents,800);
 const backup=await eventBackup(f.db,{headers});assert.match(backup.csv,/"8.00"/);assert.doesNotMatch(backup.csv,/"12.00"/);assert.equal((await backend.eventState(f.db)).pricing.current_price_cents,1200);
 }
});
