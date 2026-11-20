const {headers:sessionHeaders,sessionRow}=require('./session-fixture.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {endpoint}=require('../server/http');
const actual=require('../server/admin-routes');
const root=path.join(__dirname,'..');
const routes=['admin/check-in.js','admin/dashboard.js','admin/events.js','admin/non-paying-attendees.js','admin/payments.js','claim-payment.js','event-state.js','admin/auth.js','reservation-state.js','reserve.js'];
function files(dir,prefix=''){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name),prefix+entry.name+'/'):[prefix+entry.name]);}
function fixture(){const calls=[],db={};const handler=name=>(...args)=>{calls.push({name,args});return {name};};const mocks={'./amount-adjustment':{adjustAmount:handler('adjustAmount')},'./category-correction':{changeCategory:handler('changeCategory')},'./reservation-deletion':{deleteReservation:handler('deleteReservation'),deletePaidTicket:handler('deletePaidTicket')},'./http':require('../server/http'),'./event-backup':{eventBackup:handler('eventBackup')},'./events':Object.fromEntries(['listEvents','updateEvent','createEvent','activateEvent'].map(name=>[name,handler(name)])),'./backend':{review:handler('review'),resendTicket:handler('resendTicket'),downloadTicketQr:handler('downloadTicketQr')},'./checkin':{presence:handler('presence'),searchAttendees:handler('searchAttendees'),checkIn:handler('checkIn')}};const context={module:{exports:{}},require:name=>mocks[name]};vm.runInNewContext(fs.readFileSync(path.join(root,'server/admin-routes.js'),'utf8'),context);return {routes:context.module.exports,calls,db};}
const operations=[['paymentRoutes','GET','ticket-qr','downloadTicketQr'],['paymentRoutes','POST','adjust-amount','adjustAmount'],['paymentRoutes','POST','change-category','changeCategory'],['paymentRoutes','POST','delete-paid-ticket','deletePaidTicket'],['paymentRoutes','POST','delete-record','deleteReservation'],['checkinRoutes','GET','presence','presence'],['eventRoutes','GET','backup','eventBackup'],['eventRoutes','GET','','listEvents'],['eventRoutes','PATCH','','updateEvent'],['eventRoutes','POST','','createEvent'],['eventRoutes','POST','activate','activateEvent'],['paymentRoutes','POST','confirm-external-payment','review','confirm_external_payment'],['paymentRoutes','POST','confirm-payment','review','confirm_payment'],['paymentRoutes','POST','reject-payment','review','reject_payment'],['paymentRoutes','POST','resend-ticket','resendTicket'],['checkinRoutes','GET','','searchAttendees'],['checkinRoutes','POST','','checkIn'],['checkinRoutes','POST','manual','checkIn',true]];
test('exactly 10 API function entry files remain; configuration points to the bundled payment function',()=>{
assert.deepEqual(files(path.join(root,'api')).sort(),routes.slice().sort());assert.ok(routes.length<=10);
const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
assert.deepEqual(Object.keys(config.functions),['api/admin/payments.js']);assert.equal(config.functions['api/admin/payments.js'].maxDuration,60);assert.equal(config.functions['api/admin/payments.js'].includeFiles,'assets/tubarao-logo.jpeg');
});
test('every consolidated action delegates unchanged request/body to its original handler',async()=>{
const f=fixture();for(const [route,method,action,name,extra]of operations){const req={method,query:{action,q:'Ana'},headers:{...sessionHeaders,'x-event-id':'active-id'},body:{reservation_id:'id'}};await f.routes[route](f.db,req);const call=f.calls.at(-1);assert.equal(call.name,name);assert.equal(call.args[0],f.db);assert.equal(call.args[1],req);assert.equal(call.args[2],extra);}
});
test('unknown, repeated, prototype and wrong-method actions cannot fall through to mutations',()=>{
const f=fixture();for(const route of Object.keys(f.routes))for(const action of ['unknown','toString','__proto__',['activate'],{}])assert.throws(()=>f.routes[route](f.db,{method:'POST',query:{action}}),e=>e.code==='INVALID_ACTION');
for(const [route,method,action]of [['eventRoutes','GET','activate'],['eventRoutes','PATCH','activate'],['checkinRoutes','GET','manual'],['paymentRoutes','GET','confirm-payment'],['paymentRoutes','POST','']])assert.throws(()=>f.routes[route](f.db,{method,query:{action}}),e=>e.code==='INVALID_ACTION');assert.equal(f.calls.length,0);
});
test('all valid actions retain server-side authentication and role authorization',async()=>{
for(const [route,method,action]of operations){
const req={method,query:{action},headers:{},body:{}};await assert.rejects(actual[route]({},req),e=>e.status===401);
req.headers.authorization='Bearer forged';await assert.rejects(actual[route]({auth:{getUser:async()=>({data:{user:null}})}},req),e=>e.status===401);
const db={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:sessionRow('GUEST')})})};req.headers={...sessionHeaders};await assert.rejects(actual[route](db,req),e=>e.status===401);
}
});
test('create and activate still reject a verified ordinary ADMIN at the consolidated route',async()=>{
const db={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:sessionRow('ADMIN')})})};
for(const action of ['', 'activate'])await assert.rejects(actual.eventRoutes(db,{method:'POST',query:{action},headers:{...sessionHeaders},body:{}}),e=>e.status===403);
});
test('entry points preserve method, JSON and cross-origin write protection',async()=>{
for(const [file,exportName,methods]of [['events.js','eventRoutes','GET, PATCH, POST'],['payments.js','paymentRoutes','GET, POST'],['check-in.js','checkinRoutes','GET, POST']]){
let called=false;const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'api/admin',file),'utf8'),{module,require:name=>name.endsWith('/http')?{endpoint}:name.endsWith('/supabase')?{serverSupabase:()=>({})}:{[exportName]:()=>{called=true;return {};}}});
for(const [req,expected]of [[{method:'DELETE',headers:{}},405],[{method:'POST',headers:{}},415],[{method:'POST',headers:{'content-type':'application/json','sec-fetch-site':'cross-site'}},403]]){let status;const headers={};await module.exports(req,{setHeader:(key,value)=>headers[key]=value,status(value){status=value;return this;},json(){}});assert.equal(status,expected);if(expected===405)assert.equal(headers.Allow,methods);assert.equal(headers['Cache-Control'],'no-store');}
assert.equal(called,false);
}
});

test('door accounts are denied all dashboard, event, payment and non-paying handlers',async()=>{const backend=require('../server/backend'),events=require('../server/events');const db={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:sessionRow('ADMIN')})})};const req={headers:{...sessionHeaders},body:{},method:'POST'};for(const run of [()=>backend.dashboard(db,req),()=>events.nonPaying(db,req),...operations.filter(([name])=>name!=='checkinRoutes').map(([name,method,action])=>()=>actual[name](db,{...req,method,query:{action}}))])await assert.rejects(run(),e=>e.status===403);});
