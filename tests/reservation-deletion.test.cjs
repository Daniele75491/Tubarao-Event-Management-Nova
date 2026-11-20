const {test}=require('node:test');
const assert=require('node:assert/strict');
const {headers,sessionRow}=require('./session-fixture.cjs');
const {deleteReservation,canDeleteReservation}=require('../server/reservation-deletion');
const {deletePaidTicket}=require('../server/reservation-deletion');
const {publicState}=require('../server/domain');
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const emptyTicket={paid_at:null,checked_in_at:null,qr_token_hash:null,qr_created_at:null,ticket_sent_at:null};
function fixture(status='RESERVED',patch={}) {
  const rows=[{id,email:'same@example.com',category:'WOMEN',reserved_until:'2099-01-01',status,...emptyTicket,...patch},{id:other,email:'same@example.com',status:'PAID',category:'WOMEN'}];
  const queries=[];let role='SUPER_ADMIN',race=null,failure=false;
  const db={from(table){
    if(table==='admin_sessions')return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:sessionRow(role)})};
    const filters=[];let deleting=false;queries.push(filters);
    const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},is(k,v){filters.push([k,v]);return q;},delete(){deleting=true;return q;},maybeSingle(){return q;},then(resolve,reject){return Promise.resolve().then(()=>{
      if(deleting&&race)Object.assign(rows[0],race);
      if(failure)return {error:{message:'private database details'}};
      const matches=rows.filter(row=>filters.every(([k,v])=>row[k]===v));
      if(deleting){for(const row of matches)rows.splice(rows.indexOf(row),1);return {data:matches.map(({id})=>({id}))};}
      return {data:matches[0]?{...matches[0]}:null};
    }).then(resolve,reject);}};return q;
  }};
  return {rows,queries,db,req:{headers:{...headers},body:{reservation_id:id}},setRole:r=>role=r,race:p=>race=p,fail:()=>failure=true};
}
test('SUPER_ADMIN deletes only exact eligible ID, preserving another booking with the same email',async()=>{
  for(const status of ['RESERVED','REJECTED','EXPIRED']) {
    const f=fixture(status);
    assert.deepEqual(await deleteReservation(f.db,f.req),{reservation_id:id,deleted:true});
    assert.deepEqual(f.rows.map(row=>row.id),[other]);
    assert.ok(f.queries.every(q=>q.some(([k,v])=>k==='id'&&v===id)));
    assert.ok(f.queries.every(q=>!q.some(([k])=>k==='email')));
    for(const field of Object.keys(emptyTicket))assert.ok(f.queries[1].some(([k,v])=>k===field&&v===null));
  }
});
test('stored PAID, PAYMENT_CLAIMED, CHECKED_IN and CANCELLED are never deletable',async()=>{
  for(const status of ['PAID','PAYMENT_CLAIMED','CHECKED_IN','CANCELLED']) {
    const f=fixture(status);await assert.rejects(deleteReservation(f.db,f.req),e=>e.code==='RESERVATION_NOT_DELETABLE');assert.equal(f.rows.length,2);assert.equal(f.queries.length,1);
  }
});
test('all payment, QR, delivery and check-in evidence prevents deletion regardless of status',async()=>{
  for(const status of ['RESERVED','REJECTED','EXPIRED'])for(const field of Object.keys(emptyTicket)) {
    const f=fixture(status,{[field]:'issued'});await assert.rejects(deleteReservation(f.db,f.req),e=>e.status===409);assert.equal(f.rows.length,2);
    assert.equal(canDeleteReservation(f.rows[0]),false);
  }
  assert.equal(canDeleteReservation({status:'RESERVED'}),false,'missing safety fields fail closed');
});
test('status or ticket changes after lookup are rechecked atomically by conditional DELETE',async()=>{
  for(const patch of [{status:'PAID'},{status:'PAYMENT_CLAIMED'},...Object.keys(emptyTicket).map(k=>({[k]:'new'}))]) {
    const f=fixture();f.race(patch);await assert.rejects(deleteReservation(f.db,f.req),e=>e.code==='RESERVATION_NOT_DELETABLE');assert.equal(f.rows.length,2);
  }
});
test('deletion denies ADMIN and unauthenticated before reads; accepts only UUID body',async()=>{
  const f=fixture();f.setRole('ADMIN');await assert.rejects(deleteReservation(f.db,f.req),e=>e.status===403);assert.equal(f.queries.length,0);
  f.req.headers={};await assert.rejects(deleteReservation(f.db,f.req),e=>e.status===401);
  f.req.headers={...headers};f.setRole('SUPER_ADMIN');
  for(const body of [{email:'same@example.com'},{reservation_id:'bad'},{reservation_id:id,email:'same@example.com'}])await assert.rejects(deleteReservation(f.db,{...f.req,body}),e=>e.status===400);
});
test('deleting RESERVED releases capacity; inactive deletion leaves active occupancy unchanged',async()=>{
  const event={is_active:true,sales_mode:'OPEN',physical_capacity:2,men_paid_cap:2,claim_hold_hours:24};
  for(const status of ['RESERVED','REJECTED','EXPIRED']) {
    const f=fixture(status),before=publicState(event,f.rows,0);
    await deleteReservation(f.db,f.req);const after=publicState(event,f.rows,0);
    assert.equal(before.women_status,status==='RESERVED'?'SOLD_OUT':'FEW_TICKETS_LEFT');assert.equal(after.women_status,'FEW_TICKETS_LEFT');
  }
});
test('missing record or database failure never removes rows',async()=>{
  const f=fixture();await assert.rejects(deleteReservation(f.db,{...f.req,body:{reservation_id:'33333333-3333-4333-8333-333333333333'}}),e=>e.status===404);
  f.fail();await assert.rejects(deleteReservation(f.db,f.req),e=>!e.message.includes('private'));assert.equal(f.rows.length,2);
});

test('paid deletion targets one exact duplicate and ignores issued QR/email markers',async()=>{
  const f=fixture('PAID',{paid_at:'2026-10-01',qr_token_hash:'issued',qr_created_at:'2026-10-01',ticket_sent_at:'2026-10-01'});
  f.rows.forEach(row=>Object.assign(row,{first_name:'Laura',last_name:'Colturi'}));const otherBefore=JSON.stringify(f.rows[1]);
  assert.deepEqual(await deletePaidTicket(f.db,f.req),{reservation_id:id,deleted:true});
  assert.equal(f.rows.length,1);assert.equal(JSON.stringify(f.rows[0]),otherBefore);
  assert.deepEqual(f.queries,[[['id',id],['status','PAID'],['checked_in_at',null]]]);
});
test('paid deletion fails closed for every other state, checked-in, missing field or absent record',async()=>{
  for(const status of ['RESERVED','PAYMENT_CLAIMED','REJECTED','EXPIRED','CANCELLED']){const f=fixture(status);await assert.rejects(deletePaidTicket(f.db,f.req),e=>e.status===409);assert.equal(f.rows.length,2);}
  for(const checked_in_at of ['2026-10-01',undefined]){const f=fixture('PAID',{checked_in_at});await assert.rejects(deletePaidTicket(f.db,f.req),e=>e.status===409);assert.equal(f.rows.length,2);}
  const f=fixture('PAID');await assert.rejects(deletePaidTicket(f.db,{...f.req,body:{reservation_id:'33333333-3333-4333-8333-333333333333'}}),e=>e.status===409);
});
test('paid deletion verifies role and exact UUID body before database mutations',async()=>{
  const f=fixture('PAID');f.setRole('ADMIN');await assert.rejects(deletePaidTicket(f.db,f.req),e=>e.status===403);
  await assert.rejects(deletePaidTicket(f.db,{...f.req,headers:{}}),e=>e.status===401);assert.equal(f.queries.length,0);f.setRole('SUPER_ADMIN');
  for(const body of [{email:'same@example.com'},{reservation_id:'bad'},{reservation_id:id,role:'SUPER_ADMIN'},{reservation_id:id,email:'same@example.com'}])await assert.rejects(deletePaidTicket(f.db,{...f.req,body}),e=>e.status===400);
  assert.equal(f.queries.length,0);
});
test('concurrent check-in or status change wins over paid DELETE; errors never remove anything',async()=>{
  for(const change of [{checked_in_at:new Date().toISOString()},{status:'PAYMENT_CLAIMED'}]){const f=fixture('PAID');f.race(change);await assert.rejects(deletePaidTicket(f.db,f.req),e=>e.status===409);assert.equal(f.rows.length,2);}
  const f=fixture('PAID');f.fail();await assert.rejects(deletePaidTicket(f.db,f.req),e=>!e.message.includes('private'));assert.equal(f.rows.length,2);
});
test('paid deletion releases physical occupancy and MEN occupancy without changing capacity algorithms',async()=>{
  for(const category of ['MEN','WOMEN']){const f=fixture('PAID',{category});const event={is_active:true,sales_mode:'OPEN',physical_capacity:2,men_paid_cap:1,claim_hold_hours:24};
    assert.equal(publicState(event,f.rows,0).women_status,'SOLD_OUT');await deletePaidTicket(f.db,f.req);
    assert.equal(publicState(event,f.rows,0).women_status,'FEW_TICKETS_LEFT');assert.equal(publicState(event,f.rows,0).men_status,'FEW_TICKETS_LEFT');}
});
