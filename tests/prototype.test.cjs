const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..');
test('HTML scripts parse, public pages have no admin links or inventory explanation', () => {
  for (const name of ['index.html','checkout.html','ticket.html','admin.html']) {
    const html = fs.readFileSync(path.join(root,name),'utf8');
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1],{filename:name});
    assert.doesNotMatch(html,/\balert\s*\(/);
    if (name !== 'admin.html') {
      assert.doesNotMatch(html,/href=["']admin\.html/);
      assert.doesNotMatch(html,/Exact ticket availability is never displayed publicly/);
    }
  }
});

test('paid filters combine name, category and status across the complete list without mutations', () => {
  const view = require('../admin-attendees.js');
  const records = Array.from({length:15},(_,i) => ({first:'Guest',last:'Person '+i,cat:'men',code:'TBR-'+i,checkedIn:false}));
  records.push({first:'Élodie',last:'Silva',cat:'women',code:'TBR-X',checkedIn:true});
  const before = JSON.stringify(records);
  assert.equal(view.select(records).length,16);
  assert.equal(view.select(records,{first:' elodie ',last:'sil',category:'women',status:'checked'})[0].code,'TBR-X');
  assert.equal(view.select(records,{category:'women',status:'paid'}).length,0);
  assert.equal(view.select(records,{first:'missing'}).length,0);
  assert.equal(view.select(records,{sort:'last'})[2].last,'Person 2');
  assert.equal(view.select(records,{sort:'status'}).at(-1).code,'TBR-X');
  assert.equal(view.status({}),'Paid / Not checked in');
  assert.equal(view.status({checkedIn:true}),'Checked in');
  assert.equal(JSON.stringify(records),before);
});


test('browser scripts parse and admin starts hidden behind login', () => {
  for (const file of ['app.js','checkout.js','admin.js']) new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
  const html=fs.readFileSync(path.join(root,'admin.html'),'utf8');
  assert.match(html,/id="dashboard" hidden/); assert.match(html,/id="login-form"/);
  for (const id of ['filter-first','filter-last','filter-email','filter-category','filter-status','attendee-sort','guests','non-paying-count']) assert.equal(html.split('id="'+id+'"').length-1,1);
  assert.match(html,/<details class="card non-paying-accordion">/);
});

test('paid master list has no duplicate general view and exposes all six sorts',()=>{
  const html=fs.readFileSync(path.join(root,'admin.html'),'utf8');
  assert.doesNotMatch(html,/all-attendees|all-attendee-filter|all-attendee-count/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'admin-management.js'),'utf8'),/all-attendee/);
  assert.ok(html.indexOf('class="card paid-attendees"')<html.indexOf('class="card non-paying-accordion"'));
  for(const value of ['first','last','men','women','checked','not-checked'])assert.ok(html.includes('value="'+value+'"'));
  assert.match(fs.readFileSync(path.join(root,'styles.css'),'utf8'),/\.admin-attendees\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
});

test('paid searches combine case-insensitive email/name filters and all six sorts without mutating data',()=>{
  const view=require('../admin-attendees');
  const rows=[{id:'a',first:'Zoe',last:'Alpha',email:'Zoe@Example.com',cat:'women',checkedIn:false},{id:'b',first:'Ana',last:'Zulu',email:'ana@example.test',cat:'men',checkedIn:true},{id:'c',first:'Ben',last:'Beta',email:'ben@example.com',cat:'men',checkedIn:false}];
  const before=JSON.stringify(rows),ids=opts=>view.select(rows,opts).map(r=>r.id);
  assert.deepEqual(ids({email:' EXAMPLE.COM '}),['c','a']);
  assert.deepEqual(ids({first:'ZO',last:'AL',email:'zoe@',category:'women',status:'paid'}),['a']);
  assert.deepEqual(ids({first:'ana'}),['b']);assert.deepEqual(ids({last:'beta'}),['c']);
  assert.deepEqual(ids({category:'men'}),['b','c']);assert.deepEqual(ids({status:'checked'}),['b']);
  for(const [sort,expected] of [['first',['b','c','a']],['last',['a','c','b']],['men',['c','b','a']],['women',['a','c','b']],['checked',['b','a','c']],['not-checked',['a','c','b']]])assert.deepEqual(ids({sort}),expected);
  assert.equal(JSON.stringify(rows),before);
});
test('no browser local payment mutations or ticket generation remain', () => {
  for (const file of ['app.js','checkout.js','admin.js','ticket.html']) {
    const source=fs.readFileSync(path.join(root,file),'utf8');
    assert.doesNotMatch(source,/createReservation|updateOrder|tubarao_orders|tubarao_tickets|fakeqr|download-pdf/);
    assert.doesNotMatch(source,/SUPABASE_SECRET_KEY/);
  }
});
