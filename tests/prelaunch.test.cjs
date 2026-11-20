const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {eventBackup,csvCell,backupFilename}=require('../server/event-backup');
const {sessionRow,headers}=require('./session-fixture.cjs');
const root=path.join(__dirname,'..');
function fixture(role='SUPER_ADMIN') {
  const reads=[],event={id:'active-event',name:'Party',starts_at:'2026-10-04T18:00:00Z'};
  const paid={first_name:'João, "J"',last_name:'Two\nLines',email:'guest@example.com',category:'MEN',status:'PAID',amount_cents:1235,checked_in_at:'2026-10-04T18:05:00Z',qr_token_hash:'SECRET_HASH',qr_token:'SECRET_TOKEN',id:'INTERNAL_ID',code_hash:'CREDENTIAL_HASH'};
  const tables={reservations:[paid,{...paid,first_name:'Reserved',status:'RESERVED',amount_cents:800,checked_in_at:null}],non_paying_attendees:[{first_name:'Resident',last_name:'One',email:null,category:'WOMEN',checked_in_at:null}]};
  const db={from(table){const read={table,filters:[]};reads.push(read);const q={select(fields){read.fields=fields;return q;},eq(k,v){read.filters.push([k,v]);return q;},order(){return q;},limit(){return q;},in(){return q;},range(a,b){read.range=[a,b];return q;},maybeSingle(){return q;},then(resolve,reject){return Promise.resolve({data:table==='admin_sessions'?sessionRow(role):table==='events'?[event]:tables[table].slice(read.range[0],read.range[1]+1)}).then(resolve,reject);}};return q;}};
  return {db,reads,event,tables,req:{method:'GET',headers:{...headers},query:{action:'backup'}}};
}
function parseCsv(text){const rows=[],row=[];let cell='',quoted=false;for(let i=1;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if(c==='\r'&&text[i+1]==='\n'&&!quoted){row.push(cell);rows.push(row.splice(0));cell='';i++;}else cell+=c;}return rows;}
test('local follow simulation and minimal privacy notice use no external links',()=>{
 const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);
 assert.equal(context.window.Tubarao.config.instagram,'@casitatubarao');assert.equal(context.window.Tubarao.config.instagramUrl,undefined);
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(index,/id="ig-link" href="#follow-confirm"/);assert.doesNotMatch(index,/https?:\/\//);
 const page=fs.readFileSync(path.join(root,'privacy.html'),'utf8');for(const text of ['First name','last name','email','ticket category','payment status','check-in','classroom copy','Supabase','do not sell','delete or anonymize','synthetic guest information','href="/"'])assert.ok(page.includes(text),text);
 const checkout=fs.readFileSync(path.join(root,'checkout.html'),'utf8');assert.match(checkout,/By continuing, you acknowledge that you have read our <a href="\/privacy.html"/);assert.ok(checkout.indexOf('/privacy.html')<checkout.indexOf('id="pay"'));assert.doesNotMatch(checkout,/I agree to/);
});
test('SUPER_ADMIN export contains both sources, actual prices and only safe columns without mutations',async()=>{
 const f=fixture(),before=JSON.stringify(f.tables),result=await eventBackup(f.db,f.req),rows=parseCsv(result.csv);
 assert.equal(result.filename,'Tubarao_Party_2026-10-04_backup.csv');assert.equal(result.csv.charCodeAt(0),0xFEFF);
 assert.deepEqual(rows[0],['First Name','Last Name','Email','Category','Type','Status','Amount EUR','Checked In','Checked In At']);
 assert.deepEqual(rows[1],['João, "J"','Two\nLines','guest@example.com','MEN','PAID','PAID','12.35','YES','2026-10-04T18:05:00Z']);
 assert.equal(rows[2][5],'RESERVED');assert.equal(rows[2][7],'NO');
 assert.deepEqual(rows[3],['Resident','One','','WOMEN','NON-PAYING','NON-PAYING','0.00','NO','']);
 assert.equal(JSON.stringify(f.tables),before);assert.doesNotMatch(result.csv,/SECRET|CREDENTIAL|INTERNAL_ID|active-event/);
 for(const read of f.reads.filter(r=>['reservations','non_paying_attendees'].includes(r.table))){assert.deepEqual(read.filters,[['event_id','active-event']]);assert.doesNotMatch(read.fields,/\bid\b|qr_|token|hash|password|code/);}
});
test('export reads every page and never accepts a requested event override',async()=>{
 const f=fixture();f.tables.reservations=Array.from({length:501},()=>f.tables.reservations[0]);f.req.query.event_id='other';
 assert.equal(parseCsv((await eventBackup(f.db,f.req)).csv).length,503);assert.equal(f.reads.filter(r=>r.table==='reservations').length,2);
});
test('unauthenticated and ADMIN export requests fail before attendee/event reads',async()=>{
 for(const role of [null,'ADMIN']){const f=fixture(role);if(!role)f.req.headers={};await assert.rejects(eventBackup(f.db,f.req),e=>e.status===(role?403:401));assert.ok(f.reads.every(r=>r.table==='admin_sessions'));}
});
test('CSV escapes quotes, delimiters and newlines and neutralizes spreadsheet formulas',()=>{
 assert.equal(csvCell('a,"b"\nc'),'"a,""b""\nc"');
 for(const value of ['=1+1','+123','-2','@SUM(A1)','  =1','\t=1','\rname','\nname'])assert.ok(csvCell(value).startsWith('"\''));
 assert.equal(csvCell(null),'""');
 assert.match(backupFilename({name:'../../Tubarão "\r\n.csv',starts_at:'invalid'}),/^Tubarao_[A-Za-z0-9_]+_backup\.csv$/);
 assert.ok(backupFilename({name:'x'.repeat(1000)}).length<100);
});
test('events endpoint sends CSV attachment on success and JSON forbidden for door accounts',async()=>{
 for(const role of ['SUPER_ADMIN','ADMIN']){const f=fixture(role),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'api/admin/events.js'),'utf8'),{module,require:name=>name.endsWith('/http')?require('../server/http'):name.endsWith('/supabase')?{serverSupabase:()=>f.db}:require('../server/admin-routes')});
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.jsonBody=v;},send(v){this.csv=v;}};await module.exports(f.req,res);
 assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.headers['X-Content-Type-Options'],'nosniff');
 if(role==='SUPER_ADMIN'){assert.equal(res.code,200);assert.equal(res.headers['Content-Type'],'text/csv; charset=utf-8');assert.equal(res.headers['Content-Disposition'],'attachment; filename="Tubarao_Party_2026-10-04_backup.csv"');assert.ok(res.csv);}
 else{assert.equal(res.code,403);assert.equal(res.jsonBody.error,'FORBIDDEN');assert.equal(res.csv,undefined);assert.equal(res.headers['Content-Disposition'],undefined);}
 }
});
