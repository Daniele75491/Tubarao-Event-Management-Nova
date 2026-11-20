const {test} = require('node:test');
const assert = require('node:assert/strict');
const kpis = require('../admin-kpis.js');

test('paid and total composition use separate denominators', () => {
  const tickets = [...Array.from({length:32},()=>({status:'PAID',cat:'men',price:8.3})),...Array.from({length:38},()=>({status:'PAID',cat:'women',price:8.3}))];
  const nonPaying = [...Array.from({length:7},()=>({category:'Men'})),...Array.from({length:3},()=>({status:'PAID',cat:'women'}))];
  const k = kpis.calculate(tickets,nonPaying);
  assert.deepEqual([k.paid,k.nonPaying,k.total],[70,10,80]);
  assert.deepEqual([k.paidMen,k.paidWomen,k.totalMen,k.totalWomen],[32,38,39,41]);
  assert.deepEqual([k.paidMenPercent,k.paidWomenPercent,k.totalMenPercent,k.totalWomenPercent],['45.7%','54.3%','48.8%','51.2%']);
});
test('zero denominators never produce NaN or Infinity', () => {
  const k = kpis.calculate([],[]);
  for (const field of ['paidMenPercent','paidWomenPercent','totalMenPercent','totalWomenPercent']) assert.equal(k[field],'0%');
  assert.equal(k.revenue,0);
  const attendeesOnly = kpis.calculate([],[{status:'PAID',cat:'women'}]);
  assert.equal(attendeesOnly.paidWomenPercent,'0%'); assert.equal(attendeesOnly.totalWomenPercent,'100.0%');
});
test('missing categories remain unknown and all source metadata is retained unchanged', () => {
  const tickets = [{status:'PAID',cat:'women',price:8.3,checkedIn:true}];
  const nonPaying = [{id:'resident-1',name:'Name pending'},{id:'guest-1',name:'Guest',cat:'men'}];
  const before = JSON.stringify([tickets,nonPaying]);
  const k = kpis.calculate(tickets,nonPaying);
  assert.equal(k.total,3); assert.equal(k.uncategorizedNonPaying,1);
  assert.equal(k.totalMenPercent,'33.3%'); assert.equal(k.totalWomenPercent,'33.3%');
  assert.equal(JSON.stringify([tickets,nonPaying]),before);
});
test('explicitly invalid, refunded or unpaid tickets do not contribute to valid paid KPIs', () => {
  const tickets = [{price:8,status:'REFUNDED'},{price:8,status:'CANCELLED'},{price:8,valid:false},{price:8,paid:false},{price:8,status:'PENDING'},{status:'PAID',price:9,checkedIn:true}];
  const k = kpis.calculate(tickets,[]);
  assert.equal(k.paid,1); assert.equal(k.revenue,9);
});
test('summary displays monetary values, percentage context and missing-data notes', () => {
  const nodes = new Map();
  const document = {getElementById(id){ if (!nodes.has(id)) nodes.set(id,{}); return nodes.get(id); }};
  kpis.render(document,[{status:'PAID',price:8.3,cat:'women'}],[{name:'Resident'}],n=>'€'+n.toFixed(2));
  assert.equal(nodes.get('m-revenue').textContent,'€8.30');
  assert.equal(nodes.get('m-paid-women-percent').textContent,'100.0% of paid attendees');
  assert.equal(nodes.get('m-total-women-percent').textContent,'50.0% of total attendees');
  assert.equal(nodes.get('kpi-category-note').hidden,false);
});

test('only paid states count and revenue sums the actual historical prices', () => {
  const orders = ['RESERVED','PAYMENT_CLAIMED','REJECTED','EXPIRED'].map(status => ({status,price:8,cat:'men'}));
  orders.push({status:'PAID',price:8,cat:'women'},{status:'PAID',price:12.35,cat:'men'});
  const result = kpis.calculate(orders,[]);
  assert.equal(result.paid,2); assert.equal(result.revenue,20.35);
  assert.equal(result.paidMen,1); assert.equal(result.paidWomen,1);
});
