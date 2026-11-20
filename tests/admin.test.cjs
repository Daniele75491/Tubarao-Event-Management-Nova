const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../admin.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const nodes=new Map(),requests=[];
  let salesMode='OPEN',session=null,role='SUPER_ADMIN',denied=false,status='PAYMENT_CLAIMED',deferred=null,sent=false,resendWait=null,resendError=null,rows=null,deleteError=null,deleteWait=null,confirmSent=false;
  function node(id) {
    if (id && nodes.has(id)) return nodes.get(id);
    const result={id,open:false,hidden:id==='dashboard',value:'',textContent:'',disabled:false,children:[],events:{},attrs:{},
      classList:{add(){}},showModal(){this.open=true;},close(){this.open=false;},
      get firstChild(){return this.children[0];},replaceChildren(){this.children=[];},append(...values){this.children.push(...values);},appendChild(value){this.children.push(value);},
      addEventListener(type,fn){this.events[type]=fn;},setAttribute(k,v){this.attrs[k]=v;}};
    if(id)nodes.set(id,result);return result;
  }
  const reservation={id:'id',first_name:'Ana',last_name:'Silva',email:'ana@example.com',category:'WOMEN',amount_cents:800,created_at:'2026-09-27T12:00:00Z',claimed_at:'2026-09-27T12:01:00Z'};
  const api={euro:n=>'€'+(n/100).toFixed(2),async request(path,options){
    requests.push([path,options]);
    if(path==='/api/admin/auth?action=login'){session=true;return {authenticated:true,role,label:'SUPER ADMIN'};}
    if(path==='/api/admin/auth?action=logout'){session=null;return {authenticated:false};}
    if(path==='/api/admin/auth')return session?{authenticated:true,role,label:'SUPER ADMIN'}:{authenticated:false};
    if(denied)throw new Error('Admin access is required.');
    if(path.endsWith('confirm-payment') || path.endsWith('confirm-external-payment')) {status='PAID';if(confirmSent)sent=true;if(rows){const row=rows.find(row=>row.id===options.body.reservation_id);row.status=status;if(sent)row.ticket_sent_at='2026-10-04T12:00:00Z';}return {status,ticket_email_sent:sent};}
    if(path.endsWith('resend-ticket')) {if(resendWait)await resendWait;if(resendError)return {status:'PAID',ticket_email_sent:sent,ticket_email_error:resendError};sent=true;return {status:'PAID',ticket_email_sent:true};}
    if(path.endsWith('delete-record')||path.endsWith('delete-paid-ticket')) {if(deleteWait)await deleteWait;if(deleteError)throw deleteError;rows=(rows||[reservation]).filter(row=>row.id!==options.body.reservation_id);return {deleted:true,reservation_id:options.body.reservation_id};}
    if(path.endsWith('adjust-amount')){if(deleteWait)await deleteWait;if(deleteError)throw deleteError;const row=rows.find(row=>row.id===options.body.reservation_id);const changed=row.amount_cents!==options.body.amount_cents;row.amount_cents=options.body.amount_cents;return {reservation_id:row.id,amount_cents:row.amount_cents,changed};}
    if(path.endsWith('change-category')){if(deleteWait)await deleteWait;if(deleteError)throw deleteError;const row=rows.find(row=>row.id===options.body.reservation_id);row.category=options.body.category;return {reservation_id:row.id,category:row.category,changed:true};}
    if(path.endsWith('reject-payment')) {status='REJECTED';return {status};}
    if(deferred)await deferred;
    return {admin:{role},event:{name:'Tubarão Demo',sales_mode:salesMode,ticket_price_cents:800,physical_capacity:120,men_paid_cap:45,reservation_minutes:15,claim_hold_hours:24},reservations:rows||[{...reservation,status,can_delete:['RESERVED','REJECTED','EXPIRED'].includes(status),ticket_sent_at:sent ? '2026-09-27T12:02:00Z' : null}],non_paying_attendees:[]};
  }};
  const document={getElementById:node,createElement:()=>node(),hidden:false,querySelectorAll(selector){
    if(selector==='#payment-claims button')return node('payment-claims').children.flatMap(row=>row.children.at(-1)?.children||[]);
    if(selector==='#completed-payments button')return node('completed-payments').children.flatMap(row=>row.children.filter(child=>child.onclick));
    return [];
  }};
  const context={Tubarao:api,TubaraoKPIs:require('../admin-kpis'),TubaraoAttendees:require('../admin-attendees'),location:{replace(value){this.target=value;}},document,window:{addEventListener(){}},setTimeout,setInterval(){}};
  vm.createContext(context);vm.runInContext(source,context);
  return {node,requests,context,setSalesMode:value=>salesMode=value,setRows:value=>rows=value,failDelete:value=>deleteError=value,holdDelete:value=>deleteWait=value,sendOnConfirm:()=>confirmSent=true,setRole:value=>role=value,setStatus:value=>status=value,setSent:value=>sent=value,holdResend:value=>resendWait=value,failResend:value=>resendError=value,deny:()=>denied=true,defer:value=>deferred=value,login:()=>node('login-form').events.submit({preventDefault(){}})};
}
test('access-code login and dashboard appears only after successful authorized API response',async()=>{
  const f=fixture();await flush();assert.equal(f.node('dashboard').hidden,true);
  await f.login();assert.equal(f.node('dashboard').hidden,false);
  assert.equal(f.requests.at(-1)[1].token,undefined);assert.equal(f.node('access-code').value,'');
  assert.equal(f.node('m-revenue').textContent,'€0.00');
});
test('denied profile never displays dashboard and still allows logout',async()=>{
  const f=fixture();await flush();f.deny();await f.login();
  assert.equal(f.node('dashboard').hidden,true);assert.equal(f.node('logout').hidden,false);
  assert.match(f.node('auth-message').textContent,/Admin access/);
});
test('confirm and reject refresh server data, KPIs and ticket delivery status',async()=>{
  for(const [route,expected] of [['confirm-payment','€8.00'],['reject-payment','€0.00']]) {
    const f=fixture();await flush();await f.login();
    await vm.runInContext(`review('${route}','id')`,f.context);
    assert.equal(f.node('m-revenue').textContent,expected);
    assert.ok(f.requests.some(([path,opts])=>path==='/api/admin/payments?action='+route && opts.body.reservation_id==='id'));
    assert.equal(f.requests.find(([path])=>path==='/api/admin/payments?action='+route)[1].timeout,route==='confirm-payment'?60000:15000);
    assert.equal(f.requests.at(-1)[0],'/api/admin/dashboard');
    const actions=f.node('payment-claims').children[0].children.at(-1).children;
    if(route==='confirm-payment') {assert.equal(actions[0].textContent,'TICKET NOT ISSUED');assert.equal(actions.at(-1).textContent,'RETRY TICKET');}
    else assert.equal(actions.at(-1).textContent,'DELETE RECORD');
  }
});
test('a pending dashboard request cannot reopen private data after logout',async()=>{
  const f=fixture();await flush();await f.login();
  let release; f.defer(new Promise(resolve=>release=resolve));
  const pending=vm.runInContext('refreshDashboard()',f.context);await flush();
  await f.node('logout').onclick();release();await pending;
  assert.equal(f.node('dashboard').hidden,true);assert.equal(f.node('payment-claims').children.length,0);
});

test('admin resend refreshes the row to TICKET ISSUED',async()=>{
  const f=fixture();await flush();await f.login();
  await vm.runInContext("review('confirm-payment','id')",f.context);
  await vm.runInContext("review('resend-ticket','id')",f.context);
  assert.match(f.node('completed-payments').children[0].children[1].textContent,/TICKET ISSUED/);
  assert.equal(f.node('verification-message').textContent,'TICKET ISSUED');
});

test('SUPER_ADMIN can confirm RESERVED/EXPIRED only after Revolut warning; cancellation sends nothing',async()=>{
  for(const status of ['RESERVED','EXPIRED']) {
    const f=fixture();await flush();f.setStatus(status);await f.login();
    const button=f.node('payment-claims').children[0].children.at(-1).children[0];assert.equal(button.textContent,'CONFIRM PAID');
    const warnings=[];f.context.window.confirm=message=>{warnings.push(message);return false;};
    await button.onclick();assert.equal(f.requests.some(([p])=>p.endsWith('confirm-external-payment')),false);
    f.context.window.confirm=()=>true;
    const first=button.onclick();await button.onclick();await first;
    const calls=f.requests.filter(([p])=>p.endsWith('confirm-external-payment'));assert.equal(calls.length,1);assert.equal(calls[0][1].timeout,60000);
    assert.deepEqual(warnings,['Confirm this simulated payment? No money will move.']);assert.equal(f.node('m-revenue').textContent,'€8.00');
  }
});

test('ADMIN and unauthenticated UI cannot invoke external confirmation',async()=>{
  for(const loggedIn of [false,true]) {
    const f=fixture();await flush();f.setRole('ADMIN');if(loggedIn)await f.login();
    await vm.runInContext("review('confirm-external-payment','id')",f.context);
    assert.equal(f.requests.some(([p])=>p.endsWith('confirm-external-payment')),false);
  }
});

test('every PAID row has resend, including already sent tickets; pending double clicks send once',async()=>{
  for(const sent of [false,true]){
    const f=fixture();await flush();f.setStatus('PAID');f.setSent(sent);await f.login();
    const actions=sent?f.node('completed-payments').children[0].children:f.node('payment-claims').children[0].children.at(-1).children;
    if(sent)assert.match(actions[1].textContent,/TICKET ISSUED/);else assert.equal(actions[0].textContent,'TICKET NOT ISSUED');
    const button=actions.at(-1);assert.equal(button.textContent,'RETRY TICKET');
    let release;f.holdResend(new Promise(resolve=>release=resolve));
    const first=button.onclick();assert.equal(button.disabled,true);assert.equal(button.textContent,'ISSUING...');assert.equal(f.node('verification-message').textContent,'ISSUING...');
    await button.onclick();assert.equal(f.requests.filter(([p])=>p.endsWith('resend-ticket')).length,1);
    release();await first;assert.equal(f.node('verification-message').textContent,'TICKET ISSUED');
    assert.equal(f.node('completed-payments').children[0].children.at(-1).textContent,'RETRY TICKET');
    const request=f.requests.find(([p])=>p.endsWith('resend-ticket'));assert.equal(request[0],'/api/admin/payments?action=resend-ticket');assert.equal(request[1].body.reservation_id,'id');
  }
});

test('already-sent ticket failure reports safe error instead of false resend success',async()=>{
  const f=fixture();await flush();f.setStatus('PAID');f.setSent(true);await f.login();
  f.failResend('Ticket email could not be delivered. Check the inbox before resending.');
  await f.node('completed-payments').children[0].children.at(-1).onclick();
  assert.match(f.node('verification-message').textContent,/could not be delivered/);
});

test('non-PAID rows and door accounts cannot trigger the UI resend action',async()=>{
  for(const status of ['RESERVED','PAYMENT_CLAIMED','REJECTED','EXPIRED','CANCELLED']){
    const f=fixture();await flush();f.setStatus(status);await f.login();
    assert.equal(f.node('payment-claims').children[0].children.at(-1).children.some(n=>n.textContent==='RETRY TICKET'),false);
    await vm.runInContext("review('resend-ticket','id')",f.context);assert.equal(f.requests.some(([p])=>p.endsWith('resend-ticket')),false);
  }
  const f=fixture();await flush();f.setRole('ADMIN');f.setStatus('PAID');await f.login();await vm.runInContext("review('resend-ticket','id')",f.context);
  assert.equal(f.node('dashboard').hidden,true);assert.equal(f.requests.some(([p])=>p.endsWith('resend-ticket')),false);
});

test('door account redirects without fetching or showing dashboard',async()=>{const f=fixture();await flush();f.setRole('ADMIN');await f.login();assert.equal(f.context.location.target,'/checkin.html');assert.equal(f.node('dashboard').hidden,true);assert.equal(f.requests.some(([path])=>path==='/api/admin/dashboard'),false);});

const paymentRow=(id,status,sent=null)=>({id,first_name:id,last_name:'Guest',email:'same@example.com',category:'WOMEN',amount_cents:800,status,created_at:'2026-09-27T12:00:00Z',ticket_sent_at:sent,can_delete:['RESERVED','REJECTED','EXPIRED'].includes(status)});
test('paid attendee rows show secondary email and filter loaded records without API calls',async()=>{
  const f=fixture();await flush();f.setRows([{...paymentRow('one','PAID'),email:'One@Example.com'}, {...paymentRow('two','PAID'),email:'two@elsewhere.test'},paymentRow('pending','PAYMENT_CLAIMED')]);await f.login();
  assert.equal(f.node('guests').children.length,2);assert.equal(f.node('guests').children[0].children[2].textContent,'One@Example.com');assert.equal(f.node('guests').children[0].children[2].className,'attendee-email');
  const requests=f.requests.length;f.node('filter-email').value='ONE@EXAMPLE';f.node('filter-email').events.input();
  assert.equal(f.node('guests').children.length,1);assert.equal(f.node('guests').children[0].children[0].textContent,'one');assert.equal(f.requests.length,requests);
  f.setRows([]);await vm.runInContext('refreshDashboard()',f.context);assert.equal(f.node('guests').children[0].children[0].textContent,'NO PAYING ATTENDEES YET');
});
test('split is exclusive, completed sorts newest first and stays collapsed with 130 sent tickets',async()=>{
  const f=fixture();await flush();
  const pending=['RESERVED','PAYMENT_CLAIMED','REJECTED','EXPIRED','PAID'].map((s,i)=>paymentRow('left'+i,s));
  const completed=Array.from({length:130},(_,i)=>paymentRow('right'+i,'PAID',new Date(Date.UTC(2026,8,27,12,i)).toISOString()));
  f.setRows([...pending,...completed]);await f.login();
  assert.equal(f.node('payment-claims').children.length,5);assert.equal(f.node('completed-payments').children.length,130);assert.equal(f.node('completed-count').textContent,'130');
  assert.equal(f.node('completed-panel').open,false);assert.equal(f.node('completed-payments').children[0].children[0].textContent,'right129 Guest');
  assert.ok(f.node('payment-claims').children.every(row=>row.children[0].textContent.startsWith('left')));
  assert.ok(f.node('completed-payments').children.every(row=>row.children.at(-1).textContent==='RETRY TICKET'&&!row.children.some(c=>c.textContent==='DELETE RECORD')));
  f.node('completed-panel').open=true;await vm.runInContext('refreshDashboard()',f.context);assert.equal(f.node('completed-panel').open,true);
  assert.equal(f.requests.filter(([p])=>p==='/api/admin/dashboard').length,2); // No per-row requests.
});
test('sent confirmation moves left to right; delivery failure stays left and empty copy stays visible',async()=>{
  for(const status of ['PAYMENT_CLAIMED','RESERVED','EXPIRED'])for(const sent of [false,true]) {
    const f=fixture();await flush();f.setStatus(status);if(sent)f.sendOnConfirm();await f.login();f.context.window.confirm=()=>true;
    await vm.runInContext(`review('${status==='PAYMENT_CLAIMED'?'confirm-payment':'confirm-external-payment'}','id')`,f.context);
    assert.equal(f.node('completed-count').textContent,sent?'1':'0');assert.equal(f.node('completed-panel').open,false);
    if(sent)assert.equal(f.node('payment-claims').children[0].children[0].textContent,'NO PAYMENTS TO REVIEW');
    else {assert.equal(f.node('completed-payments').children[0].textContent,'NO TICKETS ISSUED YET');assert.equal(f.node('payment-claims').children[0].children[5].textContent,'PAID');}
  }
});
test('delete warnings, double-click latch, exact row removal and failure retention',async()=>{
  for(const status of ['RESERVED','REJECTED','EXPIRED']) {
    const f=fixture();await flush();f.setRows([paymentRow('one',status),paymentRow('two',status)]);await f.login();
    const button=f.node('payment-claims').children[0].children.at(-1).children.at(-1);assert.equal(button.textContent,'DELETE RECORD');
    let warning;f.context.window.confirm=text=>{warning=text;return false;};await button.onclick();assert.equal(f.requests.some(([p])=>p.endsWith('delete-record')),false);
    assert.equal(warning,status==='RESERVED'?'Delete this active reservation?\n\nThe reserved spot will immediately become available again.\nOnly continue if the customer should no longer keep this reservation.':'Delete this reservation record?\n\nThis action is permanent and should only be used for obsolete or duplicate records.');
    f.context.window.confirm=()=>true;let release;f.holdDelete(new Promise(resolve=>release=resolve));
    const first=button.onclick();assert.equal(button.textContent,'DELETING...');await button.onclick();assert.equal(f.requests.filter(([p])=>p.endsWith('delete-record')).length,1);
    release();await first;assert.equal(f.node('payment-claims').children.length,1);assert.equal(f.node('payment-claims').children[0].children[0].textContent,'two');assert.equal(f.node('verification-message').textContent,'RECORD DELETED');
    f.failDelete(new Error('This record cannot be deleted.'));const remaining=f.node('payment-claims').children[0].children.at(-1).children.at(-1);await remaining.onclick();
    assert.equal(f.node('payment-claims').children[0].children[0].textContent,'two');assert.equal(remaining.disabled,false);assert.equal(remaining.textContent,'DELETE RECORD');assert.match(f.node('verification-message').textContent,/cannot be deleted/);
  }
});
test('manipulated UI cannot request deletion without server eligibility or with protected status',async()=>{
  for(const row of [paymentRow('id','PAID','2026-09-27'),paymentRow('id','PAYMENT_CLAIMED'),{...paymentRow('id','EXPIRED'),can_delete:false}]) {
    const f=fixture();await flush();f.setRows([row]);await f.login();f.context.window.confirm=()=>{throw new Error('Should not offer deletion');};
    await vm.runInContext("review('delete-record','id')",f.context);assert.equal(f.requests.some(([p])=>p.endsWith('delete-record')),false);
  }
});


test('financial row keeps backend-derived revenue and all real sales-mode labels',async()=>{
  for(const mode of ['OPEN','CLOSED','SCHEDULED']){const f=fixture();await flush();f.setSalesMode(mode);f.setRows([{...paymentRow('paid','PAID'),amount_cents:950},paymentRow('hold','RESERVED')]);await f.login();assert.equal(f.node('m-revenue').textContent,'€9.50');assert.equal(f.node('manual-sales-label').textContent,mode);assert.equal(f.node('manual-sales-label').onclick,undefined);}
});


test('paid delete dialog shows locked amount, cancel is safe, double submit deletes once and clears every list/KPI',async()=>{
  const f=fixture();await flush();const base={first_name:'Laura',last_name:'Colturi',email:'same@example.com',category:'MEN',status:'PAID',checked_in_at:null,created_at:'2026-10-01',ticket_sent_at:'2026-10-01'};
  f.setRows([{...base,id:'first',amount_cents:800},{...base,id:'second',amount_cents:1200}]);await f.login();
  const buttons=()=>f.node('completed-payments').children[0].children.filter(n=>n.onclick);assert.equal(buttons().at(-1).textContent,'DELETE PAID TICKET');
  buttons().at(-1).onclick();assert.equal(f.node('delete-paid-dialog').open,true);assert.match(f.node('delete-paid-details').textContent,/Laura Colturi/);assert.match(f.node('delete-paid-details').textContent,/same@example.com/);assert.match(f.node('delete-paid-details').textContent,/Expected amount: €8.00/);
  f.node('delete-paid-cancel').onclick();assert.equal(f.requests.some(([p])=>p.endsWith('delete-paid-ticket')),false);
  let release;f.holdDelete(new Promise(r=>release=r));buttons().at(-1).onclick();f.node('delete-paid-confirm').onclick();f.node('delete-paid-confirm').onclick();await flush();assert.equal(f.requests.filter(([p])=>p.endsWith('delete-paid-ticket')).length,1);release();await flush();await flush();
  assert.equal(f.node('completed-count').textContent,'1');assert.equal(f.node('guests').children.length,1);assert.equal(f.node('m-revenue').textContent,'€12.00');assert.equal(f.node('verification-message').textContent,'PAID TICKET DELETED');assert.equal(f.requests.at(-1)[0],'/api/admin/dashboard');
  assert.equal(f.requests.some(([p])=>/resend-ticket|confirm-payment/.test(p)),false);
});
test('paid delete cannot be invoked for checked-in/non-paid or door accounts, and failure preserves row',async()=>{
  const f=fixture();await flush();const base={id:'row',first_name:'Ana',last_name:'Silva',email:'a@example.com',category:'WOMEN',amount_cents:1200,created_at:'2026-10-01',ticket_sent_at:'2026-10-01'};
  for(const patch of [{status:'PAID',checked_in_at:'2026-10-01'},{status:'RESERVED',checked_in_at:null}]){f.setRows([{...base,...patch}]);await f.login();await vm.runInContext("review('delete-paid-ticket','row',null,true)",f.context);assert.equal(f.requests.some(([p])=>p.endsWith('delete-paid-ticket')),false);}
  f.setRows([{...base,status:'PAID',checked_in_at:null}]);await f.login();f.failDelete(new Error('Ticket checked in.'));await vm.runInContext("review('delete-paid-ticket','row',null,true)",f.context);assert.equal(f.node('completed-count').textContent,'1');assert.equal(f.node('m-revenue').textContent,'€12.00');assert.match(f.node('verification-message').textContent,/Ticket checked in/);
  const count=f.requests.length;f.setRole('ADMIN');await f.login();await vm.runInContext("review('delete-paid-ticket','row',null,true)",f.context);assert.equal(f.requests.slice(count).some(([p])=>p.endsWith('delete-paid-ticket')),false);
});

test('paid category editor targets one eligible ID, guards double-submit and refreshes KPIs without email',async()=>{
 const f=fixture();await flush();const rows=[{id:'one',first_name:'Ana',last_name:'Silva',email:'same@example.com',status:'PAID',category:'WOMEN',amount_cents:800,checked_in_at:null,ticket_sent_at:'2026-10-01'},{id:'two',first_name:'Ana',last_name:'Silva',email:'same@example.com',status:'PAID',category:'WOMEN',amount_cents:1200,checked_in_at:null,ticket_sent_at:'2026-10-01'}];f.setRows(rows);await f.login();
 const button=f.node('guests').children[0].children[3].children[0];assert.equal(button.textContent,'CHANGE');button.onclick();assert.equal(f.node('category-dialog').open,true);
 f.node('category-cancel').onclick();assert.equal(f.node('category-dialog').open,false);button.onclick();
 f.node('category-value').value='MEN';let release;f.holdDelete(new Promise(resolve=>release=resolve));const first=f.node('category-form').onsubmit({preventDefault(){}});await f.node('category-form').onsubmit({preventDefault(){}});assert.equal(f.node('category-save').disabled,true);release();await first;
 const calls=f.requests.filter(([p])=>p.endsWith('change-category'));assert.equal(calls.length,1);assert.equal(calls[0][1].body.reservation_id,'one');assert.equal(rows[1].category,'WOMEN');assert.equal(f.node('m-paid-men').textContent,1);assert.equal(f.node('m-paid-women').textContent,1);assert.equal(f.node('m-revenue').textContent,'€20.00');assert.equal(f.node('m-paid-men-percent').textContent,'50.0% of paid attendees');assert.equal(f.requests.at(-1)[0],'/api/admin/dashboard');assert.ok(!f.requests.some(([p])=>p.endsWith('resend-ticket')));assert.equal(f.node('category-dialog').open,false);
});
test('category editor blocks checked-in/nonpaid/ADMIN; no-op sends nothing and errors stay actionable',async()=>{
 const f=fixture();await flush();f.setRows([{id:'one',first_name:'Ana',last_name:'Silva',email:'a@example.com',category:'WOMEN',status:'PAID',amount_cents:800,checked_in_at:null}]);await f.login();
 await vm.runInContext("editCategory('one')",f.context);await f.node('category-form').onsubmit({preventDefault(){}});assert.equal(f.requests.filter(([p])=>p.endsWith('change-category')).length,0);
 await vm.runInContext("editCategory('one')",f.context);f.node('category-value').value='MEN';f.failDelete(new Error('MEN tickets are full.'));await f.node('category-form').onsubmit({preventDefault(){}});assert.equal(f.node('category-dialog').open,true);assert.match(f.node('category-error').textContent,/full/);f.node('category-dialog').close();
 for(const patch of [{status:'PAID',checked_in_at:'2026-10-03'},{status:'RESERVED',checked_in_at:null}]){f.setRows([{id:'one',category:'WOMEN',amount_cents:800,...patch}]);await vm.runInContext('refreshDashboard()',f.context);await vm.runInContext("editCategory('one')",f.context);assert.equal(f.node('category-dialog').open,false);}
 f.setRole('ADMIN');await f.login();await vm.runInContext("editCategory('one')",f.context);assert.equal(f.node('category-dialog').open,false);
});

test('amount editor changes one claimed/paid/reserved amount and refreshes financial KPI without sending email',async()=>{
 for(const status of ['PAYMENT_CLAIMED','PAID','RESERVED']){const f=fixture();await flush();const rows=[{id:'one',first_name:'Ana',last_name:'Silva',email:'same@example.com',status,category:'WOMEN',amount_cents:1200,pricing_tier:'LATE',created_at:'2026-10-01',checked_in_at:null,ticket_sent_at:status==='PAID'?'2026-10-01':null},{id:'two',first_name:'Ana',last_name:'Silva',email:'same@example.com',status:'PAID',category:'WOMEN',amount_cents:1200,checked_in_at:null,ticket_sent_at:'2026-10-01'}];f.setRows(rows);await f.login();
 await vm.runInContext("editAmount('one')",f.context);assert.equal(f.node('amount-dialog').open,true);assert.equal(f.node('amount-current').textContent,'€12.00');f.node('amount-value').value='8.00';let release;f.holdDelete(new Promise(resolve=>release=resolve));const first=f.node('amount-form').onsubmit({preventDefault(){}});await f.node('amount-form').onsubmit({preventDefault(){}});assert.equal(f.node('amount-save').disabled,true);release();await first;
 const calls=f.requests.filter(([p])=>p.endsWith('adjust-amount'));assert.equal(calls.length,1);assert.equal(calls[0][1].body.reservation_id,'one');assert.equal(calls[0][1].body.amount_cents,800);assert.equal(rows[1].amount_cents,1200);assert.equal(rows[0].pricing_tier,'LATE');assert.equal(rows[0].status,status);assert.equal(f.node('m-revenue').textContent,status==='PAID'?'€20.00':'€12.00');assert.equal(f.requests.at(-1)[0],'/api/admin/dashboard');assert.ok(!f.requests.some(([p])=>p.endsWith('resend-ticket')));assert.equal(f.node('amount-dialog').open,false);
 if(status!=='PAID')assert.equal(f.node('payment-claims').children[0].children[4].textContent,'€8.00');
 }
});
test('amount editor validates exact decimal text, handles cancel/no-op/error, and excludes forbidden states',async()=>{
 const f=fixture();await flush();f.setRows([{id:'one',first_name:'Ana',last_name:'Silva',email:'a@example.com',category:'WOMEN',status:'PAID',amount_cents:800,created_at:'2026-10-01',checked_in_at:null}]);await f.login();
 for(const [raw,cents] of [['8',800],['8.00',800],['12.50',1250],['0.01',1],['1000',100000]])assert.equal(vm.runInContext('amountToCents('+JSON.stringify(raw)+')',f.context),cents);
 for(const raw of ['0','-1','NaN','1e2','8.001','8,00','abc','1000.01'])assert.throws(()=>vm.runInContext('amountToCents('+JSON.stringify(raw)+')',f.context));
 await vm.runInContext("editAmount('one')",f.context);f.node('amount-cancel').onclick();assert.equal(f.node('amount-dialog').open,false);await vm.runInContext("editAmount('one')",f.context);await f.node('amount-form').onsubmit({preventDefault(){}});assert.equal(f.node('verification-message').textContent,'AMOUNT UNCHANGED.');
 await vm.runInContext("editAmount('one')",f.context);f.node('amount-value').value='9';f.failDelete(new Error('Amount could not be updated.'));await f.node('amount-form').onsubmit({preventDefault(){}});assert.equal(f.node('amount-dialog').open,true);assert.match(f.node('amount-error').textContent,/could not/);f.node('amount-dialog').close();
 for(const status of ['EXPIRED','REJECTED','CANCELLED']){f.setRows([{id:'one',status,category:'WOMEN',amount_cents:800,created_at:'2026-10-01'}]);await vm.runInContext('refreshDashboard()',f.context);await vm.runInContext("editAmount('one')",f.context);assert.equal(f.node('amount-dialog').open,false);assert.equal(f.node('payment-claims').children[0].children[4].children.length,0);}
 f.setRole('ADMIN');await f.login();await vm.runInContext("editAmount('one')",f.context);assert.equal(f.node('amount-dialog').open,false);
});

test('CONFIRM PAID button still submits the exact legacy payload for Early, Late and adjusted Late',async()=>{
 for(const [tier,initial,adjusted] of [['EARLY',800,null],['LATE',1200,null],['LATE',1200,800]]){
  const f=fixture();await flush();const row={id:'one',first_name:'Ana',last_name:'Silva',email:'a@example.com',category:'WOMEN',status:'PAYMENT_CLAIMED',amount_cents:initial,pricing_tier:tier,created_at:'2026-10-04T10:00:00Z',claimed_at:'2026-10-04T10:01:00Z',checked_in_at:null,ticket_sent_at:null};f.setRows([row]);f.sendOnConfirm();await f.login();
  if(adjusted!==null){await vm.runInContext("editAmount('one')",f.context);f.node('amount-value').value='8.00';await f.node('amount-form').onsubmit({preventDefault(){}});}
  const actions=f.node('payment-claims').children[0].children.at(-1).children;await actions.find(button=>button.textContent==='CONFIRM PAID').onclick();
  const call=f.requests.find(([p])=>p.endsWith('action=confirm-payment'));assert.equal(JSON.stringify(call[1].body),JSON.stringify({reservation_id:'one'}));assert.equal(call[1].timeout,60000);assert.equal(row.status,'PAID');assert.equal(row.amount_cents,adjusted??initial);assert.equal(row.pricing_tier,tier);assert.equal(f.node('m-revenue').textContent,'€'+((adjusted??initial)/100).toFixed(2));assert.equal(f.node('verification-message').textContent,'Payment confirmed. Demo ticket issued.');assert.equal(f.requests.at(-1)[0],'/api/admin/dashboard');
 }
});
