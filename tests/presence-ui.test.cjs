const {test}=require('node:test'),assert=require('node:assert/strict');
const {create,select}=require('../checkin-presence');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const rows=[
 {firstName:'Zoe',lastName:'Able',category:'WOMEN',type:'PAID',checkedInAt:'2026-10-04T18:00:00Z'},
 {firstName:'Ana',lastName:'Zulu',category:'WOMEN',type:'NON-PAYING',checkedInAt:'2026-10-04T18:02:00Z'},
 {firstName:'Ben',lastName:'Baker',category:'MEN',type:'PAID',checkedInAt:'2026-10-04T18:01:00Z'},
 {firstName:'Carl',lastName:'Able',category:'MEN',type:'NON-PAYING',checkedInAt:'2026-10-04T18:03:00Z'}
];
function fixture(){
 const nodes=new Map(),timers=new Map();let calls=0,gate=null,failure=null,data={generatedAt:'2026-10-04T18:04:00Z',stats:{total:4,men:2,women:2,menPercentage:50,womenPercentage:50},attendees:rows};
 function node(id){if(id&&nodes.has(id))return nodes.get(id);const n={value:'',textContent:'',hidden:false,children:[],events:{},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},addEventListener(type,fn){this.events[type]=fn;},removeEventListener(type){delete this.events[type];}};if(id)nodes.set(id,n);return n;}
 const document={hidden:false,getElementById:node,createElement:()=>node()};
 const controller=create({document,request:async path=>{assert.equal(path,'/api/admin/check-in?action=presence');calls++;if(gate)await gate;if(failure)throw failure;return data;},setInterval(fn,ms){assert.equal(ms,5000);timers.set(fn,ms);return fn;},clearInterval(fn){timers.delete(fn);}});
 return {node,document,controller,timers,calls:()=>calls,setData:v=>data=v,defer:v=>gate=v,fail:v=>failure=v,tick(){for(const fn of timers.keys())fn();},change(id,value){node(id).value=value;node(id).events.change();}};
}
test('all five sorts and both filters operate locally without changing input',()=>{
 const expected={latest:['Carl','Ana','Ben','Zoe'],first:['Ana','Ben','Carl','Zoe'],last:['Carl','Zoe','Ben','Ana'],men:['Carl','Ben','Zoe','Ana'],women:['Zoe','Ana','Carl','Ben']};
 for(const [sort,names]of Object.entries(expected))assert.deepEqual(select(rows,{sort}).map(r=>r.firstName),names);
 assert.equal(select(rows,{category:'MEN'}).length,2);assert.equal(select(rows,{type:'PAID'}).length,2);assert.deepEqual(select(rows,{category:'WOMEN',type:'NON-PAYING'}).map(r=>r.firstName),['Ana']);assert.equal(rows[0].firstName,'Zoe');
});
test('KPIs use full attendance; filters/sort and unchanged DOM survive refresh',async()=>{
 const f=fixture();f.controller.start();await flush();assert.equal(f.node('inside-total').textContent,'4');assert.equal(f.node('inside-men-percent').textContent,'50%');
 assert.equal(f.node('presence-list').children[0].children[0].textContent,'Carl Able');assert.equal(f.node('presence-list').children[0].children[2].textContent,'19:03');
 const n=f.calls();f.change('presence-category','WOMEN');f.change('presence-type','NON-PAYING');f.change('presence-sort','first');assert.equal(f.calls(),n);assert.equal(f.node('inside-total').textContent,'4');assert.equal(f.node('inside-count').textContent,'1 / 4');
 const item=f.node('presence-list').children[0];f.tick();await flush();assert.equal(f.node('presence-list').children[0],item);assert.equal(f.node('presence-sort').value,'first');assert.equal(f.node('presence-type').value,'NON-PAYING');assert.equal(f.node('presence-category').value,'WOMEN');f.controller.stop();
});
test('polls never overlap; check-in queues one fresh read after an in-flight request',async()=>{
 const f=fixture();let release;f.defer(new Promise(r=>release=r));f.controller.start();f.tick();f.tick();f.controller.refresh(true);f.controller.refresh(true);assert.equal(f.calls(),1);
 f.defer(null);release();await flush();assert.equal(f.calls(),2);f.controller.stop();
});
test('visibility pauses timers and resumes immediately; stop cleans listeners and late data',async()=>{
 const f=fixture();f.controller.start();await flush();const n=f.calls();f.document.hidden=true;f.controller.visibilityChanged();assert.equal(f.timers.size,0);await f.controller.refresh();assert.equal(f.calls(),n);
 f.document.hidden=false;f.controller.visibilityChanged();await flush();assert.equal(f.calls(),n+1);assert.equal(f.timers.size,1);
 let release;f.defer(new Promise(r=>release=r));f.tick();f.controller.stop();release();await flush();assert.equal(f.node('presence-list').children.length,0);assert.equal(f.timers.size,0);assert.equal(f.node('presence-sort').events.change,undefined);
});
test('temporary failure keeps data, recovers on next poll, and empty/no-match states are clear',async()=>{
 const f=fixture();f.controller.start();await flush();const item=f.node('presence-list').children[0];f.fail(new Error('offline'));f.tick();await flush();assert.equal(f.node('presence-message').textContent,'LIVE UPDATE UNAVAILABLE');assert.equal(f.node('presence-list').children[0],item);
 f.fail(null);f.change('presence-type','absent');assert.equal(f.node('presence-empty').textContent,'NO MATCHING ATTENDEES');
 f.setData({generatedAt:'2026-10-04T18:04:00Z',stats:{total:0,men:0,women:0,menPercentage:0,womenPercentage:0},attendees:[]});f.tick();await flush();assert.match(f.node('presence-message').textContent,/Updated/);assert.equal(f.node('presence-empty').textContent,'NO ONE CHECKED IN YET');assert.equal(f.node('inside-women-percent').textContent,'0%');f.controller.stop();
});
