const {headers:sessionHeaders,sessionRow}=require('./session-fixture.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {effectiveStatus,publicState,salesOpen,reservationView} = require('../server/domain');
const backend = require('../server/backend');
const {endpoint,HttpError} = require('../server/http');
const {reservationInput,claimInput,reviewInput} = require('../server/validation');
const now = Date.parse('2026-09-26T12:00:00Z');
const id='11111111-1111-4111-8111-111111111111';
const event={id,name:'Tubarão Demo',starts_at:null,is_active:true,physical_capacity:120,men_paid_cap:45,ticket_price_cents:800,reservation_minutes:15,claim_hold_hours:24,sales_mode:'OPEN'};
const active={status:'RESERVED',category:'MEN',reserved_until:'2026-09-26T12:15:00Z'};
const claim={status:'PAYMENT_CLAIMED',category:'WOMEN',reserved_until:'2026-09-25T12:15:00Z',claimed_at:'2026-09-25T12:00:01Z'};
function mockDb(responses = [], rpcData = {}, user={id:'admin-user'}) {
  const queries=[],rpcCalls=[];
  return {queries,rpcCalls,auth:{getUser:async token => ({data:{user:token === 'valid-token' ? user : null},error:null})},
    from(table) {
      const calls=[['from',table]]; queries.push(calls);
      const query={then(resolve,reject){return Promise.resolve((()=>{const response=responses.shift() || {data:[],error:null};return table==='admin_sessions'?{data:sessionRow(response.data?.role,user?.id)}:response;})()).then(resolve,reject);}};
      for (const method of ['select','eq','in','order','limit','range','maybeSingle','single']) query[method]=(...args)=>{calls.push([method,...args]);return query;};
      return query;
    },
    async rpc(name,args){rpcCalls.push([name,args]);if(name==='read_event_pricing')return {data:{phase:'EARLY',current_price_cents:800,next_price_cents:1200,early_price_ends_at:null,server_now:new Date().toISOString()}};return rpcData.error ? rpcData : {data:rpcData,error:null};}
  };
}
const adminReq={headers:{...sessionHeaders},body:{reservation_id:id}};
test('expiry uses separate reservation and claim deadlines at exact boundaries',()=>{
  assert.equal(effectiveStatus(active,event,now),'RESERVED');
  assert.equal(effectiveStatus(active,event,now+900000),'EXPIRED');
  assert.equal(effectiveStatus(claim,event,now),'PAYMENT_CLAIMED');
  assert.equal(effectiveStatus(claim,event,now+1000),'EXPIRED');
  assert.equal(effectiveStatus({...claim,claimed_at:null},event,now),'EXPIRED');
  assert.equal(effectiveStatus({...active,status:'PAID'},event,now+1e9),'PAID');
});
test('Men cap and total capacity include holds and non-paying attendees without public counts',()=>{
  const men=Array.from({length:45},()=>active);
  const state=publicState(event,men,10,now);
  assert.equal(state.men_status,'SOLD_OUT'); assert.equal(state.women_status,'AVAILABLE');
  assert.equal(publicState(event,[...men,...Array.from({length:65},()=>claim)],10,now).women_status,'SOLD_OUT');
  assert.equal(publicState(event,[...men,...Array.from({length:65},()=>({...claim,status:'REJECTED'}))],10,now).women_status,'AVAILABLE');
  assert.equal(publicState(event,Array.from({length:110},()=>({...active,category:'WOMEN'})),10,now).men_status,'SOLD_OUT');
  assert.deepEqual(Object.keys(state).sort(),['event_id','name','starts_at','reservation_minutes','sales_status','men_status','women_status'].sort());
  assert.equal(publicState(event,Array.from({length:96},()=>({...active,category:'WOMEN'})),10,now).women_status,'FEW_TICKETS_LEFT');
});
test('sales scheduling matches existing RPC boundaries and manual override',()=>{
  const scheduled={...event,sales_mode:'SCHEDULED',sales_open_at:new Date(now).toISOString(),sales_close_at:new Date(now+1000).toISOString()};
  assert.equal(salesOpen(scheduled,now-1),false); assert.equal(salesOpen(scheduled,now),true);
  assert.equal(salesOpen(scheduled,now+1000),true); assert.equal(salesOpen(scheduled,now+1001),false);
  assert.equal(salesOpen({...scheduled,sales_mode:'OPEN'},now-1),true);
  assert.equal(salesOpen({...scheduled,sales_mode:'CLOSED'},now),false);
});
test('validation ignores no trusted browser fields and accepts normalized guest details',()=>{
  const input={first_name:' Ana ',last_name:' Silva ',email:'ANA@example.com',category:'WOMEN'};
  assert.deepEqual(reservationInput({body:input}),{first_name:'Ana',last_name:'Silva',email:'ana@example.com',category:'WOMEN'});
  for (const patch of [{category:'other'},{email:'invalid'},{first_name:' '},{last_name:'x'.repeat(101)},{amount_cents:1},{event_id:id},{role:'SUPER_ADMIN'},{reserved_until:'2099-01-01'}]) assert.throws(()=>reservationInput({body:{...input,...patch}}),HttpError);
  assert.throws(()=>claimInput({body:{reservation_id:'bad',email:input.email}}),HttpError);
  assert.deepEqual(reviewInput({body:{reservation_id:id}}),{reservation_id:id});
});
test('current event prefers open/scheduled active rows, sorts newest and falls back',async()=>{
  const db=mockDb([{data:[]},{data:[event]}]);
  assert.equal((await backend.currentEvent(db)).id,id);
  assert.ok(db.queries[0].some(c=>c[0]==='in' && c[1]==='sales_mode'));
  assert.ok(db.queries.every(q=>q.some(c=>c[0]==='eq' && c[1]==='is_active' && c[2]===true)));
  assert.ok(db.queries.every(q=>q.some(c=>c[0]==='order' && c[1]==='created_at' && c[2].ascending===false)));
  await assert.rejects(backend.currentEvent(mockDb()),e=>e.code==='EVENT_NOT_FOUND');
});
test('reserve calls exact RPC parameters and allowlists its response',async()=>{
  const data={reservation_id:id,status:'RESERVED',amount_cents:800,reserved_until:active.reserved_until,private:'must not escape'};
  const db=mockDb([{data:[event]}],data);
  const result=await backend.reserve(db,{body:{first_name:'Ana',last_name:'Silva',email:'ANA@example.com',category:'WOMEN'}});
  assert.deepEqual(db.rpcCalls,[['create_reservation',{p_event_id:id,p_first_name:'Ana',p_last_name:'Silva',p_email:'ana@example.com',p_category:'WOMEN'}]]);
  assert.equal(result.amount_cents,800); assert.equal(result.private,undefined);
});

test('same normalized identity resumes existing active states without create RPC or timer reset',async()=>{
  const until=new Date(Date.now()+600000).toISOString(),claimed=new Date().toISOString();
  for(const status of ['RESERVED','PAYMENT_CLAIMED','PAID']) {
    const row={id,event_id:id,first_name:' ANA   MARIA ',last_name:' SILVA ',email:'ana@example.com',category:'WOMEN',status,amount_cents:950,reserved_until:until,claimed_at:claimed,qr_token_hash:'secret',confirmed_by_access_id:'private'};
    const db=mockDb([{data:[{...event,sales_mode:'CLOSED'}]},{data:row}]);
    const result=await backend.reserve(db,{body:{first_name:'Ana Maria',last_name:'silva',email:' ANA@EXAMPLE.COM ',category:'WOMEN'}});
    assert.equal(result.reservation_id,id);assert.equal(result.status,status);assert.equal(result.reserved_until,until);assert.equal(result.amount_cents,950);
    assert.deepEqual(db.rpcCalls,[]); // No second insert or capacity consumption.
    assert.deepEqual(Object.keys(result).sort(),['reservation_id','category','status','amount_cents','reserved_until','claimed_at','claim_expires_at','pricing_tier'].sort());
    assert.ok(db.queries[1].some(call=>call[0]==='eq' && call[1]==='event_id' && call[2]===id));
  }
});

test('same email with a mismatched identity fails generically without leaking or creating',async()=>{
  const row={id,first_name:'Ana',last_name:'Silva',email:'ana@example.com',category:'WOMEN',status:'PAID',amount_cents:800};
  for(const patch of [{first_name:'Other'},{last_name:'Other'},{category:'MEN'},{email:'other@example.com'}]) {
    const db=mockDb([{data:[event]},{data:row}]);
    await assert.rejects(backend.reserve(db,{body:{first_name:'Ana',last_name:'Silva',email:'ana@example.com',category:'WOMEN',...patch}}),error=>error.code==='ACTIVE_RESERVATION_EXISTS'&&!JSON.stringify(error).includes(id));
    assert.equal(db.rpcCalls.length,0);
  }
});

test('expired, rejected and elapsed holds use normal capacity-checked creation',async()=>{
  for(const status of ['EXPIRED','REJECTED','CANCELLED','RESERVED','PAYMENT_CLAIMED']) {
    const row={id,status,reserved_until:'2000-01-01',claimed_at:'2000-01-01'};
    const db=mockDb([{data:[event]},{data:row}],{reservation_id:'new',status:'RESERVED',amount_cents:800,reserved_until:'future'});
    assert.equal((await backend.reserve(db,{body:{first_name:'Ana',last_name:'Silva',email:'ana@example.com',category:'WOMEN'}})).reservation_id,'new');
    assert.equal(db.rpcCalls.length,1);assert.equal(db.rpcCalls[0][0],'create_reservation');
  }
});

test('a simultaneous matching creation can be recovered after the duplicate RPC response',async()=>{
  const row={id,first_name:'Ana',last_name:'Silva',email:'ana@example.com',category:'WOMEN',status:'PAID',amount_cents:800};
  const db=mockDb([{data:[event]},{data:null},{data:row}],{error:{message:'ACTIVE_RESERVATION_EXISTS'}});
  assert.equal((await backend.reserve(db,{body:{first_name:'Ana',last_name:'Silva',email:'ana@example.com',category:'WOMEN'}})).status,'PAID');
  assert.equal(db.rpcCalls.length,1);
});

test('external confirmation uses verified actor, safe errors and fails closed before migration',async()=>{
  for(const [error,code] of [[{code:'PGRST202'},'SETUP_REQUIRED'],[{message:'FORBIDDEN'},'FORBIDDEN'],[{message:'EVENT_SOLD_OUT'},'EVENT_SOLD_OUT'],[{message:'MEN_SOLD_OUT'},'MEN_SOLD_OUT'],[{message:'EVENT_CHANGED'},'EVENT_CHANGED']]) {
    const db=mockDb([{data:{role:'SUPER_ADMIN'}}],{error});
    await assert.rejects(backend.review(db,adminReq,'confirm_external_payment'),e=>e.code===code);
    assert.deepEqual(db.rpcCalls,[['confirm_external_payment',{p_reservation_id:id,p_admin_id:'admin-user'}]]);
  }
});
test('admin APIs verify token and profile, never trusting request role',async()=>{
  await assert.rejects(backend.requireAdmin(mockDb(),{headers:{}}),e=>e.status===401);
  await assert.rejects(backend.requireAdmin(mockDb(),{headers:{authorization:'Bearer forged'}}),e=>e.status===401);
  for (const role of ['ADMIN']) await assert.rejects(backend.review(mockDb([{data:role ? {role}:null}]),adminReq,'confirm_payment'),e=>e.status===403);
  for (const role of ['SUPER_ADMIN']) {
    const db=mockDb([{data:{role}}],{reservation_id:id,status:'PAID',secret:'hidden'});
    const result=await backend.review(db,adminReq,'confirm_payment');
    assert.equal(result.reservation_id,id); assert.equal(result.status,'PAID'); assert.equal(result.secret,undefined);
    assert.deepEqual(db.rpcCalls,[['confirm_payment',{p_reservation_id:id}]]);
    assert.ok(db.queries[0].some(c=>c[0]==='eq' && c[1]==='session_token_hash'));
  }
});
test('confirm expiry and reject results are not mistaken for paid',async()=>{
  for (const [rpc,status] of [['confirm_payment','EXPIRED'],['reject_payment','REJECTED']]) {
    const db=mockDb([{data:{role:'SUPER_ADMIN'}}],{reservation_id:id,status});
    assert.equal((await backend.review(db,adminReq,rpc)).status,status);
  }
});
test('claim RPC uses email plus ID; state lookup derives effective expiry',async()=>{
  const row={...claim,id,event_id:id,amount_cents:800};
  const db=mockDb([{data:row},{data:event}],{status:'PAYMENT_CLAIMED'});
  const result=await backend.claim(db,{body:{reservation_id:id,email:'ANA@example.com'}});
  assert.deepEqual(db.rpcCalls,[['claim_payment',{p_reservation_id:id,p_email:'ana@example.com'}]]);
  assert.ok(db.queries[0].some(c=>c[0]==='eq' && c[1]==='email' && c[2]==='ana@example.com'));
  assert.equal(result.claim_expires_at,'2026-09-26T12:00:01.000Z');
  assert.equal(result.email,undefined);
});
test('dashboard totals use only paid amounts and all non-paying genders',async()=>{
  const rows=[{status:'PAID',category:'MEN',amount_cents:800},{status:'PAID',category:'WOMEN',amount_cents:900},{...active,amount_cents:1000},{status:'REJECTED',amount_cents:900}];
  const db=mockDb([{data:{role:'SUPER_ADMIN'}},{data:[event]},{data:rows},{data:[{category:'WOMEN'}]}]);
  const data=await backend.dashboard(db,adminReq);
  assert.equal(data.kpis.revenue,17); assert.equal(data.kpis.paid,2); assert.equal(data.kpis.total,3); assert.equal(data.kpis.totalWomen,2);
});

test('dashboard deletion eligibility uses stored status and ticket evidence without exposing hash',async()=>{
  const clear={paid_at:null,checked_in_at:null,qr_token_hash:null,qr_created_at:null,ticket_sent_at:null};
  const rows=[{...clear,status:'RESERVED',reserved_until:'2099-01-01'}, {...clear,status:'PAYMENT_CLAIMED',claimed_at:'2000-01-01'}, {...clear,status:'EXPIRED',qr_token_hash:'private'}, {...clear,status:'REJECTED'}];
  const db=mockDb([{data:{role:'SUPER_ADMIN'}},{data:[event]},{data:rows},{data:[]}]);
  const data=await backend.dashboard(db,adminReq);
  assert.deepEqual(data.reservations.map(row=>row.can_delete),[true,false,false,true]);
  assert.equal(data.reservations[1].status,'EXPIRED');
  assert.ok(data.reservations.every(row=>!Object.hasOwn(row,'qr_token_hash')));
  assert.doesNotMatch(JSON.stringify(data),/private/);
});
test('pagination does not silently truncate inventory at database response limit',async()=>{
  const db=mockDb([{data:Array.from({length:500},()=>active)},{data:[active]}]);
  assert.equal((await backend.allRows(db,'reservations','id',id)).length,501);
  assert.ok(db.queries[1].some(c=>c[0]==='range' && c[1]===500));
});
test('known errors map cleanly; unknown DB messages and secrets never escape',async()=>{
  for (const code of ['EVENT_SOLD_OUT','MEN_SOLD_OUT','SALES_CLOSED','ACTIVE_RESERVATION_EXISTS']) assert.throws(()=>backend.dbResult({error:{message:code}}),e=>e.code===code && e.status===409);
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}};
  await endpoint('GET',()=>{throw new Error('private SQL detail secret');})({method:'GET',headers:{}},res);
  assert.equal(res.statusCode,503); assert.doesNotMatch(JSON.stringify(res.body),/SQL|secret|stack/); assert.equal(res.headers['Cache-Control'],'no-store');
});
test('HTTP wrapper rejects cross-origin writes and wrong methods/content types',async()=>{
  const handler=endpoint('POST',()=>({ok:true}));
  for (const [req,status] of [[{method:'GET',headers:{}},405],[{method:'POST',headers:{}},415],[{method:'POST',headers:{'content-type':'application/json',origin:'https://other.test',host:'site.test'}},403]]) {
    const res={setHeader(){},status(v){this.statusCode=v;return this;},json(){}};
    await handler(req,res); assert.equal(res.statusCode,status);
  }
});
