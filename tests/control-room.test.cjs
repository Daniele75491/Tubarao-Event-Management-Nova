const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),flush=()=>new Promise(resolve=>setImmediate(resolve));
const current={id:'current',name:'Current party',starts_at:'2026-10-04T18:00:00Z',is_active:true,sales_mode:'SCHEDULED',physical_capacity:130,men_paid_cap:55,early_price_cents:800,late_price_cents:1200,early_price_ends_at:null,pricing_mode:'AUTO',reservation_minutes:20,claim_hold_hours:24};
const older={...current,id:'older',name:'Previous party',is_active:false,sales_mode:'CLOSED'};
function fixture(){
  const nodes=new Map(),requests=[];let events=[current,older],allow=false,refreshes=0;
  function node(id){if(id&&nodes.has(id))return nodes.get(id);const e={children:[],events:{},open:false,value:'',hidden:false,textContent:'',
    set id(v){this.key=v;nodes.set(v,this);},get id(){return this.key;},append(...items){for(const item of items)this.appendChild(item);},appendChild(item){item.parentElement=this;this.children.push(item);},replaceChildren(){this.children=[];},addEventListener(type,fn){this.events[type]=fn;},reset(){}};if(id)e.id=id;return e;}
  const context={window:{},document:{getElementById:node,createElement:()=>node(),querySelectorAll:()=>[]},confirm:()=>allow,Intl,Date};
  vm.runInNewContext(fs.readFileSync(path.join(root,'admin-management.js'),'utf8'),context);
  const ui=context.window.TubaraoManagement;
  ui.init({request:async(...args)=>{requests.push(args);return {admin:{role:'SUPER_ADMIN'},events};},refresh:async()=>refreshes++});
  const render=event=>ui.render({event,reservations:[],non_paying_attendees:[]});
  return {node,ui,requests,render,setEvents:value=>events=value,confirm:()=>allow=true,refreshes:()=>refreshes};
}
test('control-room HTML groups actions and noninteractive metrics; create stays inside collapsed OTHER EVENTS',()=>{
  const html=fs.readFileSync(path.join(root,'admin.html'),'utf8');
  assert.match(html,/<div class="control-actions">\s*<a[^>]+href="checkin.html">CHECK-IN<\/a>\s*<div class="backup-action"><button[^>]+id="download-backup"/);
  assert.match(html,/<div class="metrics kpi-finance"[\s\S]*?id="m-revenue"[\s\S]*?<div class="v" id="manual-sales-label"><\/div>/);
  assert.equal((html.match(/id="manual-sales-label"/g)||[]).length,1);
  assert.doesNotMatch(html,/class="card sales-controls"|<(?:button|a)[^>]+id="manual-sales-label"/);
  assert.match(html,/<details class="other-events" id="other-events">/);
  assert.match(html,/id="other-events"[\s\S]*?id="event-list"[\s\S]*?id="create-event-panel"/);
  assert.ok(html.indexOf('class="active-event"')<html.indexOf('id="other-events"'));
});
test('active event renders only left; inactive count/order, accordion state and switching remain correct',async()=>{
  const f=fixture();f.render(current);await flush();
  assert.equal(f.node('active-event-details').children[0].textContent,current.name);
  assert.equal(f.node('active-event-details').children[2].textContent,'ACTIVE · SCHEDULED');
  assert.equal(f.node('active-event-details').children.some(n=>n.onclick),false);
  assert.equal(f.node('other-event-count').textContent,'1');assert.equal(f.node('other-events').open,false);
  assert.equal(f.node('event-list').children.length,1);assert.equal(f.node('event-list').children[0].children[0].textContent,older.name);
  const activate=f.node('event-list').children[0].children[2];assert.equal(activate.textContent,'SET AS ACTIVE EVENT');
  activate.onclick();await flush();assert.equal(f.requests.some(([url])=>url.includes('action=activate')),false);
  f.confirm();activate.onclick();await flush();
  const call=f.requests.find(([url])=>url.includes('action=activate'));assert.equal(call[1].event_id,older.id);assert.equal(call[2].method,'POST');assert.equal(f.refreshes(),1);
  f.node('other-events').open=true;
  f.setEvents([{...current,is_active:false},{...older,is_active:true}]);f.render({...older,is_active:true});await flush();
  assert.equal(f.node('other-events').open,true);assert.equal(f.node('active-event-details').children[0].textContent,older.name);
  assert.equal(f.node('event-list').children[0].children[0].textContent,current.name);assert.equal(f.node('other-event-count').textContent,'1');
  f.ui.reset();assert.equal(f.node('other-events').open,false);assert.equal(f.node('other-event-count').textContent,'0');assert.equal(f.node('active-event-details').children.length,0);
});
test('no active/inactive event has clear empty state while SUPER_ADMIN creation stays available',async()=>{
  const f=fixture();f.setEvents([]);f.render(null);await flush();
  assert.equal(f.node('active-event-details').children[0].textContent,'NO ACTIVE EVENT');
  assert.equal(f.node('event-list').children[0].textContent,'NO OTHER EVENTS YET');assert.equal(f.node('other-event-count').textContent,'0');
  assert.equal(f.node('create-event-panel').hidden,false);f.node('other-events').open=true;f.node('create-event-panel').open=true;
  f.node('create-name').value='New party';f.node('event-create-form').events.submit({preventDefault(){}});await flush();
  const call=f.requests.find(([url,,options])=>url==='/api/admin/events'&&options?.method==='POST');
  assert.equal(call[1].name,'New party');assert.equal(call[1].sales_mode,'CLOSED');assert.equal(call[1].early_price_cents,800);assert.equal(f.refreshes(),1);
  assert.equal(f.node('create-event-panel').open,false);assert.equal(f.node('other-events').open,true);
});

test('pricing inputs convert decimal text exactly and forced-mode cancellation makes no request',async()=>{
  const f=fixture();f.render(current);await flush();
  for(const [raw,cents] of [['12.00',1200],['8.75',875],['0.01',1],['1.1',110],['1000',100000]])assert.equal(f.ui.euroToCents(raw),cents);
  for(const raw of ['','0','-1','1.001','1e2','NaN','1000.01','12abc'])assert.throws(()=>f.ui.euroToCents(raw));
  f.node('edit-pricing_mode').value='LATE';
  f.node('event-edit-form').events.submit({preventDefault(){}});await flush();
  assert.equal(f.requests.some(([url,,o])=>url==='/api/admin/events'&&o?.method==='PATCH'),false);
  f.confirm();f.node('event-edit-form').events.submit({preventDefault(){}});await flush();
  const call=f.requests.find(([url,,o])=>url==='/api/admin/events'&&o?.method==='PATCH');assert.equal(call[1].pricing_mode,'LATE');assert.equal(call[1].late_price_cents,1200);
});

test('display checkboxes default off and save booleans without a confirmation',async()=>{
 const f=fixture();f.render(current);await flush();
 for(const key of ['show_pricing_countdown','show_late_price_before_start']){assert.equal(f.node('create-'+key).checked,false);assert.equal(f.node('edit-'+key).required,false);f.node('edit-'+key).checked=true;}
 f.node('event-edit-form').events.submit({preventDefault(){}});await flush();
 const call=f.requests.find(([url,,o])=>url==='/api/admin/events'&&o?.method==='PATCH');assert.equal(call[1].show_pricing_countdown,true);assert.equal(call[1].show_late_price_before_start,true);
});
