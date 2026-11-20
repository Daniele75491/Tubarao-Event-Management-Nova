const {headers:sessionHeaders,sessionRow}=require('./session-fixture.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {parsePayload,checkIn,searchAttendees}=require('../server/checkin');
const {endpoint}=require('../server/http');
const id='11111111-1111-4111-8111-111111111111',adminId='22222222-2222-4222-8222-222222222222';
const token='a'.repeat(43),hash=createHash('sha256').update(token).digest('hex');
const time='2026-09-28T18:00:00.000Z';
function fixture() {
  let role='ADMIN',rpcError=null;
  const rows=[{id,event_id:'current',first_name:'Ana',last_name:'Silva',email:'ana@example.test',category:'WOMEN',status:'PAID',checked_in_at:null,qr_token_hash:hash},
    {id:'old',event_id:'old',first_name:'Ana',last_name:'Old',email:'old@example.test',category:'WOMEN',status:'PAID',checked_in_at:null}];
  const calls=[],queries=[];
  const db={auth:{async getUser(value){return {data:{user:value==='valid' ? {id:adminId} : null}};}},
    from(table){let fields,filters=[],single=false,start=0,end=499;
      const q={select(value){fields=value;return q;},eq(key,value){filters.push([key,value]);return q;},in(){return q;},order(){return q;},limit(){return q;},range(a,b){start=a;end=b;return q;},maybeSingle(){single=true;return q;},
        then(resolve,reject){return Promise.resolve().then(()=>{
          queries.push({table,fields,filters});
          if(table==='admin_sessions')return {data:sessionRow(role,adminId)};
          if(table==='events')return {data:[{id:'current',name:'Garden Session'}]};
          const data=rows.filter(row=>filters.every(([key,value])=>row[key]===value)).slice(start,end+1).map(row=>Object.fromEntries(fields.split(',').map(key=>[key,row[key]])));
          return {data:single ? data[0]??null : data};
        }).then(resolve,reject);}};return q;},
    async rpc(name,args){calls.push({name,args});if(rpcError)return {error:{message:rpcError}};
      const row=rows.find(row=>name==='check_in_ticket'?row.qr_token_hash===args.p_qr_token_hash:row.id===args.p_reservation_id);
      if(!row || row.status!=='PAID')return {data:{result:'INVALID'}};
      const result=row.checked_in_at ? 'ALREADY_CHECKED_IN' : 'CHECKED_IN';row.checked_in_at ||= time;
      return {data:{...row,result,internal_secret:'must not escape'}};
    }};
  return {db,rows,calls,queries,req:{headers:{...sessionHeaders},body:{qr_payload:'TUBARAO:'+token},query:{q:'ana'}},role:value=>role=value,error:value=>rpcError=value};
}
test('QR parser accepts the existing opaque format and rejects empty, wrong or oversized payloads',()=>{
  assert.equal(parsePayload('TUBARAO:'+token),token);
  for(const value of ['',null,{},'TUBARAO:','tubarao:'+token,'https://example.test/'+token,'TUBARAO:'+token+'\n','TUBARAO:'+token+'x','TUBARAO:'+('/'.repeat(43))])assert.equal(parsePayload(value),null);
});
test('scan hashes token server-side, uses verified actor and allowlists CHECKED_IN / duplicate response',async()=>{
  const f=fixture(),first=await checkIn(f.db,f.req);
  assert.deepEqual(f.calls[0],{name:'check_in_ticket',args:{p_qr_token_hash:hash,p_admin_id:adminId}});
  assert.deepEqual(first,{result:'CHECKED_IN',first_name:'Ana',last_name:'Silva',category:'WOMEN',checked_in_at:time});
  const second=await checkIn(f.db,f.req);assert.equal(second.result,'ALREADY_CHECKED_IN');assert.equal(second.checked_in_at,time);
  assert.doesNotMatch(JSON.stringify(first),/qr_token_hash|internal_secret|email|event_id/);
});
test('check-in, manual and search require authenticated ADMIN or SUPER_ADMIN',async()=>{
  for(const action of [f=>checkIn(f.db,f.req),f=>checkIn(f.db,{...f.req,body:{reservation_id:id}},true),f=>searchAttendees(f.db,f.req)]){
    for(const auth of ['', 'Bearer forged']){const f=fixture();f.req.headers.cookie=auth;await assert.rejects(action(f),e=>e.status===401);assert.equal(f.calls.length,0);}
    for(const role of [null,'GUEST']){const f=fixture();f.role(role);await assert.rejects(action(f),e=>e.status===401);}
    const f=fixture();f.role('SUPER_ADMIN');await action(f);
  }
});
test('invalid QR returns INVALID without RPC; client hashes and forged admin IDs are rejected',async()=>{
  const f=fixture();f.req.body={qr_payload:'TUBARAO:'};assert.deepEqual(await checkIn(f.db,f.req),{result:'INVALID'});assert.equal(f.calls.length,0);
  for(const body of [{qr_token_hash:hash},{qr_payload:'TUBARAO:'+token,p_admin_id:adminId}]){
    f.req.body=body;await assert.rejects(checkIn(f.db,f.req),e=>e.status===400);
  }
});
test('manual check-in only permits current-event PAID and uses the atomic reservation RPC',async()=>{
  for(const status of ['RESERVED','PAYMENT_CLAIMED','EXPIRED','REJECTED','CANCELLED']){
    const f=fixture();f.rows[0].status=status;assert.deepEqual(await checkIn(f.db,{...f.req,body:{reservation_id:id}},true),{result:'INVALID'});assert.equal(f.calls.length,0);
  }
  const f=fixture();assert.equal((await checkIn(f.db,{...f.req,body:{reservation_id:id}},true)).result,'CHECKED_IN');
  assert.deepEqual(f.calls[0],{name:'check_in_reservation',args:{p_reservation_id:id,p_admin_id:adminId}});
  assert.equal((await checkIn(f.db,{...f.req,body:{reservation_id:id}},true)).result,'ALREADY_CHECKED_IN');
});
test('scan refuses old-event and unpaid tickets; RPC remains final authority if status changes',async()=>{
  for(const change of [{event_id:'old'},{status:'PAYMENT_CLAIMED'}]){
    const f=fixture();Object.assign(f.rows[0],change);assert.deepEqual(await checkIn(f.db,f.req),{result:'INVALID'});assert.equal(f.calls.length,0);
  }
  const f=fixture();f.db.rpc=async()=>({data:{result:'INVALID',qr_token_hash:hash}});assert.deepEqual(await checkIn(f.db,f.req),{result:'INVALID'});
});
test('search matches name/email literally, only current event and only approved fields',async()=>{
  const f=fixture();
  for(const q of ['ANA','silva','ana@example','Ana Silva']){
    f.req.query.q=q;const result=await searchAttendees(f.db,f.req);assert.equal(result.attendees.length,1);assert.deepEqual(Object.keys(result.attendees[0]).sort(),['reservation_id','first_name','last_name','email','category','status','checked_in_at'].sort());
  }
  f.req.query.q='ana%,status.eq.PAID';assert.equal((await searchAttendees(f.db,f.req)).attendees.length,0);
  f.req.query.q='';assert.equal((await searchAttendees(f.db,f.req)).attendees.length,0);
  f.req.query.q=['ana'];await assert.rejects(searchAttendees(f.db,f.req),e=>e.status===400);
});
test('search bounds results and includes unpaid status without enabling admission',async()=>{
  const f=fixture();for(let i=0;i<35;i++)f.rows.push({...f.rows[0],id:'copy'+i,status:'RESERVED'});
  const result=await searchAttendees(f.db,f.req);assert.equal(result.attendees.length,30);assert.equal(result.more,true);assert.equal(result.attendees[1].status,'RESERVED');
});
test('internal RPC errors never escape the HTTP wrapper',async()=>{
  const f=fixture();f.error('private SQL qr_token_hash secret');let status,body;
  await endpoint('POST',req=>checkIn(f.db,req))({...f.req,method:'POST',headers:{...f.req.headers,'content-type':'application/json'}},{setHeader(){},status(value){status=value;return this;},json(value){body=value;}});
  assert.equal(status,503);assert.doesNotMatch(JSON.stringify(body),/SQL|qr_token_hash|secret/);
});
