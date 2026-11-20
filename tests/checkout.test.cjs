const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../checkout.js'),'utf8');
const now = Date.parse('2026-09-27T12:00:00Z');
const reserved = {reservation_id:'11111111-1111-4111-8111-111111111111',status:'RESERVED',amount_cents:800,reserved_until:new Date(now+900000).toISOString()};
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(saved, initial = reserved, initialFailure = null, entry = {}) {
  let clock = now, result = {...initial}, failure = initialFailure, requests = [];
  const store = new Map(saved ? [['tubarao_reservation_recovery',typeof saved==='string' ? saved : JSON.stringify(saved)]] : []), nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id,{id,hidden:false,disabled:false,value:'',checked:false,textContent:'',events:{},attrs:{},
      set innerHTML(value){this.html=value;this.textContent=value.replace(/<[^>]+>/g,'');},get innerHTML(){return this.html;},
      addEventListener(type,fn){this.events[type]=fn;},setAttribute(k,v){this.attrs[k]=v;},focus(){this.focused=true;},checkValidity(){return Boolean(this.value.trim());}});
    return nodes.get(id);
  };
  element('first').value='Ana'; element('last').value='Silva'; element('email').value='ana@example.com'; element('category-confirm').checked=true;
  const storage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
  const api={followConfirmed:()=>entry.follow!==false,getEvent:()=>({name:'Tubarão Demo',ticket_price_cents:800,reservation_minutes:20,sales_status:'OPEN',women_status:'AVAILABLE'}),getEventError:()=>'',eventDate:()=>'',eventTime:()=>'',euro:n=>'€'+(n/100).toFixed(2),remaining:d=>Math.max(0,Math.ceil((Date.parse(d)-clock)/1000)),
    countdown(d){const s=this.remaining(d);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');},
    async request(path,options){requests.push([path,options]);if(failure)throw failure;return {...result};},watchEvent:fn=>fn(),refreshEvent(){}};
  const context={Tubarao:api,document:{getElementById:element,addEventListener(){},hidden:false},window:{addEventListener(){},open(){}},localStorage:storage,sessionStorage:storage,location:{search:entry.search??'?type=women',replace(value){this.target=value;}},URLSearchParams,URL,Date,setInterval(){}};
  vm.createContext(context);vm.runInContext(source,context);
  return {element,store,requests,api,context,setResult:value=>result=value,setFailure:value=>failure=value,setTime:value=>clock=value,render:()=>vm.runInContext('render()',context),submit:()=>element('form').events.submit({preventDefault(){}})};
}
test('checkout reserves through API, locks server amount, stores credentials and blocks double submit',async()=>{
  const f=fixture(); await f.submit(); await f.submit();
  assert.equal(f.requests.filter(([path])=>path==='/api/reserve').length,1);
  assert.equal(f.element('countdown').textContent,'15:00'); assert.equal(f.element('order-heading').textContent,'YOUR SPOT IS RESERVED');
  assert.equal(f.element('claim-payment').disabled,false);

  const stored=JSON.parse(f.store.get('tubarao_reservation_recovery'));assert.deepEqual(stored,{reservation_id:reserved.reservation_id,email:'ana@example.com'});
});

test('demo claim displays the locked server amount and ignores any supplied payment URL',async()=>{
  for(const cents of [800,1200]){
    const f=fixture({...reserved,email:'ana@example.com'},{...reserved,amount_cents:cents,payment_url:'https://example.invalid/'});
    f.context.window.open=()=>assert.fail('Demo checkout must never open a payment destination');
    await flush();
    f.api.getEvent=()=>({ticket_price_cents:1500,pricing:{phase:'LATE',current_price_cents:1500}});f.render();
    assert.equal(f.element('claim-payment').disabled,false);
    assert.equal(f.element('claim-payment').textContent,'SIMULATE '+f.api.euro(cents)+' & CLAIM');
    f.setResult({...reserved,amount_cents:cents,status:'PAYMENT_CLAIMED'});
    await f.element('claim-payment').onclick();
    assert.equal(f.requests.at(-1)[0],'/api/claim-payment');
  }
});
test('claim uses ID/email and shows pending verification only after API success',async()=>{
  const f=fixture(); await f.submit();
  f.setResult({...reserved,status:'PAYMENT_CLAIMED',claim_expires_at:new Date(now+86400000).toISOString()});
  await f.element('claim-payment').onclick();
  assert.equal(f.element('order-heading').textContent,'DEMO PAYMENT CLAIMED');assert.equal(f.element('order-copy').textContent,'Your claim is awaiting admin review.');
  assert.equal(f.element('countdown').hidden,true);

  assert.equal(f.element('order-detail').textContent,'The demo QR becomes available to the admin after confirmation and issuance.');


  assert.equal(f.element('payment-note').hidden,true);
  assert.equal(f.element('order-panel').attrs['data-state'],'PAYMENT_CLAIMED');
  assert.equal(f.requests.at(-1)[0],'/api/claim-payment');
  assert.equal(f.requests.at(-1)[1].body.email,'ana@example.com');
});
test('failed claim keeps reservation claimable rather than pretending payment succeeded',async()=>{
  const f=fixture();await f.submit();f.setFailure(new Error('Connection unavailable.'));
  await f.element('claim-payment').onclick();
  assert.equal(f.element('order-heading').textContent,'YOUR SPOT IS RESERVED');assert.equal(f.element('claim-payment').disabled,false);
  assert.match(f.element('order-error').textContent,/Connection unavailable/);
});
test('expiry disables the demo claim and offers restart',async()=>{
  const f=fixture();await f.submit();f.setTime(now+900000);f.render();
  assert.equal(f.element('order-heading').textContent,'RESERVATION EXPIRED');assert.equal(f.element('claim-payment').disabled,true);assert.equal(f.element('restart').hidden,false);
});
test('reload does not trust a cached PAID state and verifies the server record',async()=>{
  const f=fixture({...reserved,email:'ana@example.com',status:'PAID'});
  assert.equal(f.element('order-heading').textContent,'CHECKING YOUR RESERVATION');
  await flush();assert.equal(f.element('order-heading').textContent,'YOUR SPOT IS RESERVED');
  assert.equal(f.requests[0][0],'/api/reservation-state');
});
test('claimed reload resumes pending state and later admin decisions come from server',async()=>{
  const f=fixture({...reserved,email:'ana@example.com'});await flush();
  f.setResult({...reserved,status:'PAYMENT_CLAIMED',claim_expires_at:new Date(now+86400000).toISOString()});
  await vm.runInContext('refreshOrder(true)',f.context);
  assert.equal(f.element('order-heading').textContent,'DEMO PAYMENT CLAIMED');
  f.setResult({...reserved,status:'PAID'});await vm.runInContext('refreshOrder(true)',f.context);
  assert.equal(f.element('order-heading').textContent,'DEMO PAYMENT CONFIRMED');assert.match(f.element('order-detail').textContent,/classroom event admin/);

  assert.equal(f.element('payment-note').hidden,true);
  assert.equal(f.element('order-panel').attrs['data-state'],'PAID');

});
test('stale cached data cannot keep payment controls active when state lookup fails',async()=>{
  const f=fixture({...reserved,email:'ana@example.com'});await flush();
  f.setFailure(new Error('Service unavailable.'));await vm.runInContext('refreshOrder(true)',f.context);
  assert.equal(f.element('order-heading').textContent,'CHECKING YOUR RESERVATION');assert.equal(f.element('claim-payment').disabled,true);
});

test('20-minute copy never replaces the server deadline, including unavailable event settings',async()=>{
  const f=fixture();await f.submit();
  assert.equal(f.element('order-copy').textContent,'Complete your payment within 20 minutes.');
  assert.equal(f.element('countdown').textContent,'15:00'); // Deliberately different server deadline.
  f.api.getEvent=()=>null;f.render();
  assert.equal(f.element('order-copy').textContent,'Complete your payment before the countdown ends.');
  assert.equal(f.element('countdown').textContent,'15:00');
});

test('CLOSED still permits recovery submission; server rejects new reservations',async()=>{
  const f=fixture(),event=f.api.getEvent();f.api.getEvent=()=>({...event,sales_status:'CLOSED'});
  f.setFailure(Object.assign(new Error('Ticket sales are closed.'),{code:'SALES_CLOSED'}));
  await f.submit();assert.equal(f.requests.length,1);assert.equal(f.element('pay').disabled,false);
  assert.equal(f.element('form-error').textContent,'Ticket sales are closed.');
  assert.equal(f.element('availability').textContent,'TICKETS NOT CURRENTLY AVAILABLE');
});

test('closing sales does not invalidate an existing server-verified reservation or claim',async()=>{
  const f=fixture();await f.submit();const event=f.api.getEvent();f.api.getEvent=()=>({...event,sales_status:'CLOSED'});f.render();
  assert.equal(f.element('claim-payment').disabled,false);
  f.setResult({...reserved,status:'PAYMENT_CLAIMED'});await f.element('claim-payment').onclick();
  assert.equal(f.element('order-heading').textContent,'DEMO PAYMENT CLAIMED');
});

test('local recovery restores server state, category and deadline without storing sensitive data',async()=>{
  for(const [status,heading] of [['RESERVED','YOUR SPOT IS RESERVED'],['PAYMENT_CLAIMED','DEMO PAYMENT CLAIMED'],['PAID','DEMO PAYMENT CONFIRMED']]) {
    const f=fixture({...reserved,email:'ana@example.com',status:'PAID',qr_token:'ignored',amount_cents:1},{...reserved,category:'MEN',status,claim_expires_at:new Date(now+86400000).toISOString()});
    assert.equal(f.element('order-heading').textContent,'CHECKING YOUR RESERVATION');
    await flush();assert.equal(f.element('order-heading').textContent,heading);assert.equal(f.element('kind').textContent,'men ticket');
    assert.equal(f.element('price').textContent,'€8.00');assert.equal(f.element('countdown').textContent,'15:00');
    assert.equal(f.element('claim-payment').hidden,status!=='RESERVED');
    assert.deepEqual(JSON.parse(f.store.get('tubarao_reservation_recovery')),{reservation_id:reserved.reservation_id,email:'ana@example.com'});
    assert.equal(f.requests.length,1);assert.equal(f.requests[0][0],'/api/reservation-state');
  }
});

test('expired, rejected, cancelled and invalid local recovery is removed and form restored',async()=>{
  for(const status of ['EXPIRED','REJECTED','CANCELLED']) {
    const f=fixture({...reserved,email:'ana@example.com'},{...reserved,status});await flush();
    assert.equal(f.store.size,0);assert.equal(f.element('form').hidden,false);
  }
  for(const saved of ['not json',{reservation_id:'bad',email:'ana@example.com'},{reservation_id:reserved.reservation_id,email:'bad'}]) {
    const f=fixture(saved);await flush();assert.equal(f.store.size,0);assert.equal(f.requests.length,0);
  }
  const f=fixture({...reserved,email:'ana@example.com'},reserved,Object.assign(new Error('Not found'),{code:'RESERVATION_NOT_FOUND'}));await flush();
  assert.equal(f.store.size,0);assert.equal(f.element('form').hidden,false);
});

test('transient recovery failure preserves credentials and blocks unverified payment',async()=>{
  const f=fixture({...reserved,email:'ana@example.com'},reserved,new Error('Offline'));await flush();
  assert.equal(f.store.size,1);assert.equal(f.element('claim-payment').disabled,true);
  f.setFailure(null);await vm.runInContext('refreshOrder(true,true)',f.context);
  assert.equal(f.element('order-heading').textContent,'YOUR SPOT IS RESERVED');
});

test('closed-tab recovery works without category URL or old follow session, but new checkout keeps its gate',async()=>{
  const f=fixture({reservation_id:reserved.reservation_id,email:'ana@example.com'},{...reserved,category:'WOMEN'},null,{search:'',follow:false});
  await flush();assert.equal(f.context.location.target,undefined);assert.equal(f.element('kind').textContent,'women ticket');
  assert.equal(f.element('order-heading').textContent,'YOUR SPOT IS RESERVED');
  const fresh=fixture(null,reserved,null,{search:'',follow:false});
  assert.equal(fresh.context.location.target,'index.html#follow-gate');await fresh.submit();assert.equal(fresh.requests.length,0);
});

test('resubmitting identity goes directly to claimed/paid state and never offers another payment',async()=>{
  for(const status of ['PAYMENT_CLAIMED','PAID']) {
    const f=fixture();f.setResult({...reserved,status});await f.submit();
    assert.equal(f.element('order-heading').textContent,status==='PAID'?'DEMO PAYMENT CONFIRMED':'DEMO PAYMENT CLAIMED');
    assert.equal(f.element('claim-payment').hidden,true);
  }
});
