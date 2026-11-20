const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../checkin.js'),'utf8').replace(/^import .*;\r?\n/,'');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(realPresence=false) {
  let presenceFailure=null;
  let session=null,role='ADMIN',failure=null,deferred=null,cameraFails=false,scanner;
  const requests=[],nodes=new Map();
  const row={reservation_id:'id',first_name:'Ana',last_name:'Silva',email:'ana@example.test',category:'WOMEN',status:'PAID',checked_in_at:null};
  function node(id) {
    if(id&&nodes.has(id))return nodes.get(id);
    const value={hidden:id==='checkin-panel',value:'',textContent:'',children:[],events:{},disabled:false,
      replaceChildren(...children){this.children=children;},append(...values){this.children.push(...values);},appendChild(value){this.children.push(value);},
      addEventListener(type,fn){this.events[type]=fn;},removeEventListener(type){delete this.events[type];},setAttribute(){},focus(){},scrollIntoView(){}};
    if(id)nodes.set(id,value);return value;
  }
  class Scanner {
    constructor(video,callback,options){this.callback=callback;this.options=options;this.starts=0;this.stops=0;scanner=this;}
    async start(){if(cameraFails)throw new Error('Permission denied');this.starts++;}
    stop(){this.stops++;} destroy(){this.destroyed=true;}
  }
  const api={async request(url,options){
    requests.push([url,options]);
    if(url==='/api/admin/auth?action=login'){session=true;return {authenticated:true,role,label:'DOOR 1'};}
    if(url==='/api/admin/auth?action=logout'){session=null;return {authenticated:false};}
    if(url==='/api/admin/auth')return session?{authenticated:true,role,label:role==='ADMIN'?'DOOR 1':'SUPER ADMIN'}:{authenticated:false};
    if(url==='/api/admin/check-in?action=presence'){if(presenceFailure)throw presenceFailure;return {generatedAt:'2026-10-04T18:00:00Z',stats:{total:0,men:0,women:0,menPercentage:0,womenPercentage:0},attendees:[]};}
    if(deferred)await deferred;
    if(failure)throw failure;
    if(url.startsWith('/api/admin/check-in?q='))return {event:{name:'Garden Session'},attendees:url.endsWith('q=')?[]:[row],more:false};
    const result=row.checked_in_at?'ALREADY_CHECKED_IN':'CHECKED_IN';row.checked_in_at ||= '2026-09-28T18:00:00Z';
    return {...row,result};
  }};
  const document={hidden:false,events:{},getElementById:node,createElement:()=>node(),addEventListener(type,fn){this.events[type]=fn;}};
  const presenceCalls=[];const attendance={start(){presenceCalls.push('start');},stop(){presenceCalls.push('stop');},refresh(){presenceCalls.push('refresh');},visibilityChanged(){}};
  const context={TubaraoPresence:{create:opts=>realPresence?require('../checkin-presence').create({...opts,setInterval(){return 1;},clearInterval(){}}):attendance},QrScanner:Scanner,Tubarao:api,document,window:{isSecureContext:true,addEventListener(){}},navigator:{mediaDevices:{getUserMedia(){}}},setTimeout,Date};
  vm.createContext(context);vm.runInContext(source,context);
  return {failPresence:value=>presenceFailure=value,presenceCalls,node,context,requests,row,document,setRole:value=>role=value,scanner:()=>scanner,fail:value=>failure=value,defer:value=>deferred=value,cameraFail:()=>cameraFails=true,login:()=>node('login-form').events.submit({preventDefault(){}}),search:()=>node('search-form').events.submit({preventDefault(){}})};
}
test('check-in interface stays hidden until server authorization; rejects browser-only login',async()=>{
  const f=fixture();await flush();assert.equal(f.node('checkin-panel').hidden,true);
  f.fail(Object.assign(new Error('Admin access is required.'),{status:403}));await f.login();assert.equal(f.node('checkin-panel').hidden,true);
  f.fail(null);await f.login();assert.equal(f.node('checkin-panel').hidden,false);assert.equal(f.requests.at(-1)[1].token,undefined);assert.equal(f.node('account-label').textContent,'DOOR 1');
});
test('scanner prefers rear camera, latches duplicate submissions and resumes only after SCAN NEXT',async()=>{
  const f=fixture();await flush();await f.login();await f.node('start-camera').onclick();
  const scanner=f.scanner();assert.equal(scanner.options.preferredCamera,'environment');
  scanner.callback({data:'TUBARAO:'+'a'.repeat(43)});scanner.callback({data:'TUBARAO:'+'a'.repeat(43)});await flush();
  assert.equal(f.requests.filter(([url])=>url==='/api/admin/check-in').length,1);
  assert.equal(f.node('result-title').textContent,'CHECKED IN');assert.equal(scanner.starts,1);assert.ok(f.presenceCalls.includes('refresh'));
  scanner.callback({data:'TUBARAO:'+'a'.repeat(43)});await flush();assert.equal(f.requests.filter(([url])=>url==='/api/admin/check-in').length,1);
  f.node('scan-next').onclick();await flush();assert.equal(scanner.starts,2);
  scanner.callback({data:'TUBARAO:'+'a'.repeat(43)});await flush();assert.equal(f.node('result-title').textContent,'ALREADY CHECKED IN');assert.match(f.node('result-time').textContent,/First check-in/);
});
test('camera denial gives a usable search fallback; unpaid and used rows have no action',async()=>{
  const f=fixture();await flush();await f.login();f.cameraFail();await f.node('start-camera').onclick();
  assert.match(f.node('camera-message').textContent,/search below/);assert.equal(f.node('start-camera').disabled,false);
  f.node('search-query').value='Ana';
  for(const status of ['RESERVED','PAYMENT_CLAIMED','REJECTED','EXPIRED']){
    f.row.status=status;await f.search();assert.equal(f.node('search-results').children[0].children.length,3);
  }
  f.row.status='PAID';await f.search();await f.node('search-results').children[0].children[3].onclick();
  assert.equal(f.requests.at(-1)[0],'/api/admin/check-in?action=manual');assert.ok(f.presenceCalls.includes('refresh'));assert.equal(f.node('result-title').textContent,'CHECKED IN');
  f.node('scan-next').onclick();await f.search();assert.equal(f.node('search-results').children[0].children.length,3);
});
test('network failure is never success or invalid ticket and requires explicit acknowledgement',async()=>{
  const f=fixture();await flush();await f.login();await f.node('start-camera').onclick();f.fail(new Error('Network failed'));
  f.scanner().callback({data:'TUBARAO:'+'a'.repeat(43)});await flush();assert.equal(f.node('result-title').textContent,'CHECK NOT COMPLETED');assert.match(f.node('result-detail').textContent,/Do not admit/);
  assert.equal(f.node('scan-next').disabled,false);
});
test('logout stops camera and late scan response cannot reveal private guest details',async()=>{
  const f=fixture();await flush();await f.login();await f.node('start-camera').onclick();let release;
  f.defer(new Promise(resolve=>release=resolve));f.scanner().callback({data:'TUBARAO:'+'a'.repeat(43)});await flush();
  await f.node('logout').onclick();release();await flush();assert.equal(f.node('checkin-panel').hidden,true);assert.equal(f.node('result-name').textContent,'');assert.equal(f.scanner().destroyed,true);
});
test('expired auth on scan hides tools and backgrounding stops camera',async()=>{
  const f=fixture();await flush();await f.login();await f.node('start-camera').onclick();
  f.document.hidden=true;f.document.events.visibilitychange();assert.equal(f.node('stop-camera').hidden,true);
  f.document.hidden=false;await f.node('start-camera').onclick();f.fail(Object.assign(new Error('Expired'),{status:401}));
  f.scanner().callback({data:'TUBARAO:'+'a'.repeat(43)});await flush();assert.equal(f.node('checkin-panel').hidden,true);assert.match(f.node('auth-message').textContent,/Sign in/);
});
test('stale search results are discarded when the query changes',async()=>{
  const f=fixture();await flush();await f.login();f.node('search-query').value='Ana';let release;
  f.defer(new Promise(resolve=>release=resolve));const pending=f.search();await flush();
  f.node('search-query').value='Other';f.node('search-query').events.input();release();await pending;
  assert.equal(f.node('search-results').children.length,0);
});

test('SUPER_ADMIN also has check-in access',async()=>{const f=fixture();await flush();f.setRole('SUPER_ADMIN');await f.login();assert.equal(f.node('checkin-panel').hidden,false);assert.equal(f.node('account-label').textContent,'SUPER ADMIN');});

test('real presence refresh failure never interrupts camera, search or manual check-in',async()=>{
  const f=fixture(true);await flush();f.failPresence(new Error('Presence offline'));await f.login();await flush();
  assert.equal(f.node('presence-message').textContent,'LIVE UPDATE UNAVAILABLE');assert.equal(f.node('checkin-panel').hidden,false);
  await f.node('start-camera').onclick();assert.equal(f.scanner().starts,1);
  f.node('search-query').value='Ana';await f.search();await f.node('search-results').children[0].children[3].onclick();await flush();
  assert.equal(f.node('result-title').textContent,'CHECKED IN');assert.equal(f.node('presence-message').textContent,'LIVE UPDATE UNAVAILABLE');
  assert.ok(f.requests.filter(([url])=>url.endsWith('action=presence')).length>=2);
  await f.node('logout').onclick();assert.equal(f.node('presence-list').children.length,0);
});
