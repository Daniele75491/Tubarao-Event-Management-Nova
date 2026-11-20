const {test}=require('node:test'),assert=require('node:assert/strict');
const {adjustAmount}=require('../server/amount-adjustment'),{reservationInput,claimInput}=require('../server/validation');
const {headers,sessionRow}=require('./session-fixture.cjs');
const id='11111111-1111-4111-8111-111111111111';
function fixture(role='SUPER_ADMIN',error=null){const calls=[];return {calls,db:{from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:sessionRow(role)})};},rpc:async(name,args)=>{calls.push([name,args]);return {error,data:{reservation_id:id,amount_cents:args.p_amount_cents,changed:true}};}}};}
test('amount adjustment requires SUPER_ADMIN and sends an exact ID, integer cents and authenticated actor to one RPC',async()=>{
 const f=fixture();assert.equal((await adjustAmount(f.db,{headers,body:{reservation_id:id,amount_cents:800}})).amount_cents,800);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'admin_adjust_reservation_amount');assert.equal(f.calls[0][1].p_reservation_id,id);assert.equal(f.calls[0][1].p_amount_cents,800);assert.ok(f.calls[0][1].p_admin_id);
 for(const role of ['ADMIN',null]){const g=fixture(role);await assert.rejects(adjustAmount(g.db,{headers:role?headers:{},body:{reservation_id:id,amount_cents:800}}),e=>e.status===(role?403:401));assert.equal(g.calls.length,0);}
});
test('amount boundary rejects strings, fractions, zero, negatives, nonfinite, excessive and extra input',async()=>{
 for(const amount_cents of [0,-1,NaN,Infinity,1.2,100001,'800',null,{},true]){const f=fixture();await assert.rejects(adjustAmount(f.db,{headers,body:{reservation_id:id,amount_cents}}),e=>e.status===400);assert.equal(f.calls.length,0);}
 for(const body of [{reservation_id:'bad',amount_cents:800},{reservation_id:id,amount_cents:800,role:'SUPER_ADMIN'},{reservation_id:id,amount_cents:800,pricing_tier:'EARLY'}])await assert.rejects(adjustAmount(fixture().db,{headers,body}),e=>e.status===400);
 for(const key of ['manualAmount','amountOverride','adjustedAmount','amount_cents']){assert.throws(()=>reservationInput({body:{first_name:'Ana',last_name:'Silva',email:'a@example.com',category:'WOMEN',[key]:800}}));assert.throws(()=>claimInput({body:{reservation_id:id,email:'a@example.com',[key]:800}}));}
});
test('safe errors hide database internals and report ineligible/missing rows',async()=>{
 for(const [message,status]of [['AMOUNT_NOT_EDITABLE',409],['RESERVATION_NOT_FOUND',404],['FORBIDDEN',403],['INVALID_AMOUNT',400]])await assert.rejects(adjustAmount(fixture('SUPER_ADMIN',{message}).db,{headers,body:{reservation_id:id,amount_cents:800}}),e=>e.status===status);
 await assert.rejects(adjustAmount(fixture('SUPER_ADMIN',{message:'private SQL error'}).db,{headers,body:{reservation_id:id,amount_cents:800}}),e=>e.message==='Amount could not be updated.');
});
