const {test}=require('node:test'),assert=require('node:assert/strict');
const {changeCategory}=require('../server/category-correction');
const {headers,sessionRow}=require('./session-fixture.cjs');
const id='11111111-1111-4111-8111-111111111111';
function fixture(role='SUPER_ADMIN',error=null){const calls=[];return {calls,db:{from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:sessionRow(role)})};},rpc:async(name,args)=>{calls.push([name,args]);return {error,data:{reservation_id:id,category:args.p_category,changed:true}};}}};}
test('category correction authenticates SUPER_ADMIN and delegates exact ID to one atomic RPC',async()=>{
 for(const category of ['MEN','WOMEN']){const f=fixture();assert.equal((await changeCategory(f.db,{headers,body:{reservation_id:id,category}})).category,category);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'admin_change_paid_category');assert.equal(f.calls[0][1].p_reservation_id,id);assert.equal(f.calls[0][1].p_category,category);assert.ok(f.calls[0][1].p_admin_id);}
 const f=fixture('ADMIN');await assert.rejects(changeCategory(f.db,{headers,body:{reservation_id:id,category:'MEN'}}),e=>e.status===403);assert.equal(f.calls.length,0);
 await assert.rejects(changeCategory(f.db,{headers:{},body:{}}),e=>e.status===401);
});
test('strict category, exact UUID and allowlisted fields; safe database errors',async()=>{
 for(const body of [{reservation_id:id,category:'men'},{reservation_id:id,category:null},{reservation_id:'bad',category:'MEN'},{reservation_id:id,category:'MEN',role:'SUPER_ADMIN'},{reservation_id:id,category:'MEN',amount_cents:800}]){const f=fixture();await assert.rejects(changeCategory(f.db,{headers,body}),e=>e.status===400);assert.equal(f.calls.length,0);}
 for(const [message,status] of [['MEN_TICKETS_FULL',409],['CATEGORY_NOT_EDITABLE',409],['RESERVATION_NOT_FOUND',404],['FORBIDDEN',403]])await assert.rejects(changeCategory(fixture('SUPER_ADMIN',{message}).db,{headers,body:{reservation_id:id,category:'MEN'}}),e=>e.status===status);
 await assert.rejects(changeCategory(fixture('SUPER_ADMIN',{message:'private database information'}).db,{headers,body:{reservation_id:id,category:'MEN'}}),e=>e.message==='Category could not be updated.');
});
