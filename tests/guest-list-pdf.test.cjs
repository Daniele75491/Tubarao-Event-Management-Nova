const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {headers,sessionRow} = require('./session-fixture.cjs');

const event = {id:'active-event',name:'Tubarão 3.0',starts_at:'2026-11-15T12:00:00Z',is_active:true,sales_mode:'OPEN'};
const otherEvent = {...event,id:'other-event',is_active:false};
function guest(id,first_name,last_name,extra={}) {
  return {id,event_id:event.id,first_name,last_name,status:'PAID',email:'private@example.com',
    category:'WOMEN',amount_cents:1234,qr_token_hash:'PRIVATE_QR_HASH',note:'PRIVATE_NOTE',...extra};
}
function fixture({role='SUPER_ADMIN',reservations=[],nonPaying=[],selectedEvent=event}={}) {
  const reads = [];
  let action;
  const tables = {events:[selectedEvent,otherEvent],reservations,non_paying_attendees:nonPaying};
  const db = {from(table) {
    const read = {table,filters:[]};
    reads.push(read);
    return {
      select(fields) { read.fields=fields; return this; },
      eq(key,value) { read.filters.push(row=>row[key]===value); return this; },
      gt(key,value) { read.filters.push(row=>row[key]>value); return this; },
      in(key,values) { read.filters.push(row=>values.includes(row[key])); return this; },
      order() { return this; },
      limit(max) { read.max=max; return this; },
      range(from,to) { read.from=from; read.max=to-from+1; return this; },
      async maybeSingle() {
        const session = sessionRow(role);
        if (action === 'guest-list-pdf') session.last_seen_at = '2000-01-01T00:00:00Z';
        return {data:session};
      },
      then(resolve,reject) {
        const rows = tables[table].filter(row=>read.filters.every(filter=>filter(row)))
          .sort((a,b)=>a.id.localeCompare(b.id)).slice(read.from ?? 0,(read.from ?? 0) + read.max);
        const fields = read.fields.split(',');
        return Promise.resolve({data:rows.map(row=>Object.fromEntries(fields.map(key=>[key,row[key]])))}).then(resolve,reject);
      }
    };
  }};
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../api/admin/events'),'utf8'),{
    module,require:name=>name.endsWith('/supabase') ? {serverSupabase:()=>db} : require(name.replace('../..','..'))
  });
  async function download(requestedAction='guest-list-pdf',requestHeaders=role ? headers : {}) {
    action = requestedAction;
    const res = {headers:{},setHeader(key,value){this.headers[key]=value;},status(value){this.code=value;return this;},
      json(value){this.body=value;},send(value){this.body=value;}};
    await module.exports({method:'GET',headers:requestHeaders,query:{action,event_id:otherEvent.id}},res);
    return res;
  }
  return {download,reads};
}

async function readPdf(buffer) {
  assert.ok(Buffer.isBuffer(buffer));
  assert.match(buffer.subarray(0,9).toString(),/^%PDF-/);
  const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({data:new Uint8Array(buffer)}).promise;
  try {
    const pages = [];
    for (let i=1; i<=pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const {width,height} = page.getViewport({scale:1});
      assert.ok(Math.abs(width-595.28)<0.1 && Math.abs(height-841.89)<0.1,'A4 portrait');
      const {items} = await page.getTextContent();
      let text = '';
      for (const item of items) {
        text += item.str;
        if (item.hasEOL) text += '\n';
        if (item.str.trim()) {
          assert.ok(item.transform[4]>=40 && item.transform[4]+item.width<=width-40,'text stays inside horizontal margins');
          assert.ok(item.transform[5]>=35 && item.transform[5]<=height-35,'text stays inside vertical margins');
        }
      }
      pages.push(text);
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

test('SUPER_ADMIN gets an A4 attachment with names only, ordered by surname and then first name',async()=>{
  const excluded = ['RESERVED','PAYMENT_CLAIMED','EXPIRED','REJECTED','CANCELLED'];
  const f = fixture({
    reservations:[
      guest('private-01','Sofia','da Silva'),guest('private-02','Érica','Ávila',{checked_in_at:'2026-11-15T12:32:00Z'}),
      guest('private-03','Alessandro','bianchi'),guest('private-04','Álvaro','Ávila'),
      guest('private-05','ForeignPaid','Guest',{event_id:otherEvent.id}),
      guest('private-06','Анна','Иванова'),
      ...excluded.map((status,i)=>guest('excluded-'+i,status,'Excluded',{status}))
    ],
    nonPaying:[
      guest('private-01','Sofia','da Silva',{status:undefined,checked_in_at:'2026-11-15T12:32:00Z'}),
      guest('private-07','João','da Silva',{status:undefined}),
      guest('private-08','ForeignGuest','Guest',{event_id:otherEvent.id}),
      guest('private-09','Γεώργιος','Παπαδόπουλος',{status:undefined})
    ]
  });
  const res = await f.download();
  assert.equal(res.code,200);
  assert.equal(res.headers['Cache-Control'],'private, no-store');
  assert.equal(res.headers['X-Content-Type-Options'],'nosniff');
  assert.equal(res.headers['Content-Type'],'application/pdf');
  assert.equal(res.headers['Content-Disposition'],'attachment; filename="Tubarao_3.0_Guest_List_2026-11-15.pdf"');
  const [page] = await readPdf(res.body);
  assert.match(page,/Tubarão 3\.0\s+GUEST LIST\s+Sunday, 15 November 2026\s+\|\s+Total Guests: 8/);
  assert.deepEqual([...page.matchAll(/^\d\d\s+(.+)$/gm)].map(match=>match[1]),[
    'Ávila Álvaro','Ávila Érica','bianchi Alessandro','da Silva João','da Silva Sofia','da Silva Sofia',
    'Παπαδόπουλος Γεώργιος','Иванова Анна'
  ]);
  assert.doesNotMatch(page,/Excluded|Foreign|Deleted|WOMEN|private|1234|PRIVATE_|12:32/);
  const reads = f.reads.filter(({table})=>['reservations','non_paying_attendees'].includes(table));
  assert.equal(reads.length,2);
  assert.ok(reads.every(({fields})=>fields==='id,first_name,last_name'));
  const csv = await f.download('backup');
  assert.equal(csv.headers['Content-Type'],'text/csv; charset=utf-8');
  assert.match(csv.body,/private@example\.com.*"PAYMENT_CLAIMED".*"12\.34"/);
});

test('authorization and stale event checks fail before reading names',async()=>{
  for (const [role,code] of [[null,401],['ADMIN',403]]) {
    const f = fixture({role});
    const res = await f.download();
    assert.equal(res.code,code);
    assert.equal(res.headers['Cache-Control'],'no-store');
    assert.equal(res.headers['Content-Disposition'],undefined);
    assert.ok(f.reads.every(({table})=>table==='admin_sessions'));
  }
  const f = fixture();
  const res = await f.download('guest-list-pdf',{...headers,'x-event-id':otherEvent.id});
  assert.equal(res.code,409);
  assert.equal(res.body.error,'EVENT_CHANGED');
  assert.deepEqual(f.reads.map(({table})=>table),['admin_sessions','events']);
});

test('empty export uses a safe filename and a readable zero-guest page',async()=>{
  const reservations = [guest('deleted-id','Permanently','Removed')];
  const nonPaying = [guest('removed-id','Also','Removed')];
  const f = fixture({selectedEvent:{...event,name:'../Tubarão "/\\?% Event',starts_at:null},reservations,nonPaying});
  reservations.pop();
  nonPaying.pop();
  const res = await f.download();
  assert.equal(res.headers['Content-Disposition'],'attachment; filename="Tubarao_Event_Guest_List.pdf"');
  const pages = await readPdf(res.body);
  assert.equal(pages.length,1);
  assert.match(pages[0],/Total Guests: 0\s+No guests to list\./);
  assert.doesNotMatch(pages[0],/Removed/);
});

test('all guest pages preserve consecutive numbering, long rows and the exact total across database pages',async()=>{
  const reservations = Array.from({length:503},(_,i)=>{
    const number = String(i+1).padStart(3,'0');
    return guest(number,`Guest${number}`,'Surname');
  });
  const longName = 'Alexandrina Maria Inês de Lourdes Margarida Cândida da Conceição Cristina Vitória Mariana';
  reservations[25].first_name = longName;
  reservations[25].last_name = 'Surname Alexandrescu de Andrade de Almada e Lencastre Saldaña Wójcik';
  const f = fixture({reservations});
  const res = await f.download();
  if (process.env.TUBARAO_TEST_PDF_SAMPLE) fs.writeFileSync(process.env.TUBARAO_TEST_PDF_SAMPLE,res.body);
  const pages = await readPdf(res.body);
  assert.ok(pages.length > 1);
  const numbers = [];
  pages.forEach((page,i)=>{
    assert.match(page,/Total Guests: 503/);
    assert.match(page,new RegExp('Page '+(i+1)+' of '+pages.length));
    numbers.push(...[...page.matchAll(/^(\d{3})\s+Surname\b/gm)].map(match=>Number(match[1])));
    if (page.includes('Alexandrescu')) assert.ok(page.replace(/\s+/g,' ').includes(longName));
  });
  assert.deepEqual(numbers,Array.from({length:503},(_,i)=>i+1));
  assert.equal(f.reads.filter(({table})=>table==='reservations').length,2);
});
