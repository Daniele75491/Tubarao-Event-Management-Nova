const {test}=require('node:test'),assert=require('node:assert/strict');
const {presence}=require('../server/checkin');
const {headers,sessionRow}=require('./session-fixture.cjs');
function fixture(role='ADMIN'){
 const reads=[];const person={first_name:'Ana',last_name:'Silva',category:'WOMEN',event_id:'current',checked_in_at:'2026-10-04T18:42:00Z',id:'private-id',email:'private-email',qr_token_hash:'private-hash'};
 const tables={reservations:[{...person,status:'PAID'},{...person,status:'PAID',checked_in_at:null},{...person,status:'PAYMENT_CLAIMED'},{...person,status:'REJECTED'},{...person,status:'PAID',event_id:'old'}],non_paying_attendees:[{...person,first_name:'Ben',category:'MEN'},{...person,checked_in_at:null},{...person,event_id:'old'}]};
 const db={from(table){const read={table,filters:[]};reads.push(read);const q={select(fields){read.fields=fields;return q;},eq(k,v){read.filters.push(row=>row[k]===v);return q;},not(k,op,v){assert.equal(k,'checked_in_at');assert.equal(op,'is');assert.equal(v,null);read.filters.push(row=>row[k]!=null);return q;},in(){return q;},order(){return q;},limit(){return q;},range(a,b){read.range=[a,b];return q;},maybeSingle(){return q;},then(resolve,reject){return Promise.resolve().then(()=>({data:table==='admin_sessions'?sessionRow(role):table==='events'?[{id:'current'}]:tables[table].filter(row=>read.filters.every(fn=>fn(row))).slice(read.range[0],read.range[1]+1)})).then(resolve,reject);}};return q;}};
 return {db,reads,tables,req:{headers:{...headers}}};
}
test('both door roles receive only active-event checked-in PAID and non-paying people',async()=>{
 for(const role of ['ADMIN','SUPER_ADMIN']){const f=fixture(role),before=JSON.stringify(f.tables),data=await presence(f.db,f.req);
 assert.deepEqual(data.stats,{total:2,men:1,women:1,menPercentage:50,womenPercentage:50});assert.equal(data.attendees.length,2);
 assert.deepEqual(data.attendees[0],{firstName:'Ana',lastName:'Silva',category:'WOMEN',type:'PAID',checkedInAt:'2026-10-04T18:42:00Z'});
 assert.equal(data.attendees[1].type,'NON-PAYING');assert.doesNotMatch(JSON.stringify(data),/private-|email|hash|token|event_id|reservation_id|account_id/);
 assert.deepEqual(Object.keys(data).sort(),['attendees','generatedAt','stats']);assert.equal(JSON.stringify(f.tables),before);
 for(const read of f.reads.filter(r=>['reservations','non_paying_attendees'].includes(r.table)))assert.equal(read.fields,'first_name,last_name,category,checked_in_at');
 }
});
test('presence authentication fails before guest reads; empty totals are finite zeroes',async()=>{
 const f=fixture();await assert.rejects(presence(f.db,{headers:{}}),e=>e.status===401);assert.equal(f.reads.length,0);
 f.tables.reservations=[];f.tables.non_paying_attendees=[];assert.deepEqual((await presence(f.db,f.req)).stats,{total:0,men:0,women:0,menPercentage:0,womenPercentage:0});
});
test('presence percentages use all arrivals, and pagination includes every row',async()=>{
 const f=fixture();const row=f.tables.reservations[0];f.tables.reservations=Array.from({length:501},()=>({...row,category:'MEN'}));f.tables.non_paying_attendees=[{...row,category:'WOMEN'}];
 const data=await presence(f.db,f.req);assert.equal(data.stats.total,502);assert.equal(data.stats.men,501);assert.equal(data.stats.women,1);assert.equal(data.stats.menPercentage,99.8);assert.equal(data.stats.womenPercentage,0.2);assert.equal(f.reads.filter(r=>r.table==='reservations').length,2);
 f.tables.reservations=Array.from({length:44},()=>({...row,category:'MEN'}));f.tables.non_paying_attendees=Array.from({length:36},()=>({...row,category:'WOMEN'}));assert.deepEqual((await presence(f.db,f.req)).stats,{total:80,men:44,women:36,menPercentage:55,womenPercentage:45});
});
