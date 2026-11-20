const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('non-paying list excludes email, retains check-in state, add/remove requests and reset',async()=>{
  const nodes=new Map(),requests=[];let confirmed=false,refreshes=0;
  function element(id){
    if(id&&nodes.has(id))return nodes.get(id);
    const node={children:[],events:{},textContent:'',value:'',hidden:false,disabled:false,
      set id(v){this.key=v;nodes.set(v,this);},get id(){return this.key;},
      append(...items){for(const child of items)this.appendChild(child);},appendChild(child){child.parentElement=this;this.children.push(child);},replaceChildren(){this.children=[];},addEventListener(type,fn){this.events[type]=fn;},reset(){this.didReset=true;}};
    if(id)node.id=id;return node;
  }
  const context={window:{},document:{getElementById:id=>{assert.ok(!id.startsWith('all-attendee'));return element(id);},createElement:()=>element(),querySelectorAll:()=>[]},confirm:()=>confirmed,Intl,Date};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-management.js'),'utf8'),context);
  const api=context.window.TubaraoManagement;
  api.init({request:async(...args)=>{requests.push(args);return {admin:{role:'SUPER_ADMIN'},events:[]};},refresh:async()=>refreshes++});
  const data={event:{id:'event',sales_mode:'OPEN'},reservations:[],non_paying_attendees:[{id:'guest',first_name:'Ana',last_name:'Silva',email:'private@example.com',category:'WOMEN',checked_in_at:'2026-09-29T12:00:00Z'}]};
  api.render(data);await flush();
  const item=element('non-paying-list').children[0];assert.equal(item.children[0].textContent,'Ana Silva · WOMEN · CHECKED IN');assert.doesNotMatch(JSON.stringify(item.children.map(n=>n.textContent)),/private|@/);
  assert.equal(item.children[1].textContent,'REMOVE');item.children[1].onclick();await flush();assert.equal(requests.some(([p,,o])=>p==='/api/admin/non-paying-attendees'&&o.method==='DELETE'),false);
  confirmed=true;item.children[1].onclick();await flush();
  const removal=requests.find(([p,,o])=>p==='/api/admin/non-paying-attendees'&&o.method==='DELETE');assert.equal(removal[1].attendee_id,'guest');assert.equal(removal[2].eventId,'event');assert.equal(refreshes,1);
  element('np-first').value=' Bea ';element('np-last').value=' Costa ';element('np-email').value='optional@example.com';element('np-category').value='WOMEN';
  element('non-paying-form').events.submit({preventDefault(){}});await flush();
  const addition=requests.find(([p,,o])=>p==='/api/admin/non-paying-attendees'&&o.method==='POST');assert.equal(addition[1].first_name,'Bea');assert.equal(addition[1].email,'optional@example.com');assert.equal(refreshes,2);
  api.render({...data,non_paying_attendees:[]});assert.equal(element('non-paying-list').children[0].textContent,'NO NON-PAYING ATTENDEES YET');
  api.reset();assert.equal(element('non-paying-list').children.length,0);
});
