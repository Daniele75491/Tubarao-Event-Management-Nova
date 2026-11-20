const {headers:sessionHeaders,sessionRow}=require('./session-fixture.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHmac,createHash} = require('node:crypto');
const tickets = require('../server/tickets');
const {deliverTicket,safeTicketError} = require('../server/ticket-delivery');
const backend = require('../server/backend');
const id='11111111-1111-4111-8111-111111111111', eventId='22222222-2222-4222-8222-222222222222';
const secret='test-only-secret-not-a-production-key-123456789';
const date='2026-09-27T12:00:00.000Z';
const options={secret,now:()=>new Date(date)};
function fixture(overrides={}) {
  const row={id,event_id:eventId,first_name:'Ana',last_name:'Silva',events:{name:'Tubarão — Garden Session'},email:'ana@example.test',category:'WOMEN',amount_cents:800,status:'PAYMENT_CLAIMED',confirmed_by:null,confirmed_by_access_id:null,qr_token_hash:null,qr_created_at:null,ticket_sent_at:null,ticket_email_last_attempt_at:null,ticket_email_attempts:0,ticket_email_error:null,...overrides};
  const writes=[],rpcCalls=[];
  let role='SUPER_ADMIN',failFinal=false,failAudit=false;
  const db={auth:{async getUser(token){return {data:{user:token==='valid' ? {id:'admin-1'} : null},error:null};}},
    from(table) {
      let patch=null,fields=null,single=false;const filters=[];
      const q={select(value){fields=value;return q;},update(value){patch=value;return q;},eq(key,value){filters.push([key,value]);return q;},is(key,value){filters.push([key,value]);return q;},in(){return q;},order(){return q;},limit(){return q;},maybeSingle(){single=true;return q;},
        then(resolve,reject){return Promise.resolve().then(()=>{
          if(table==='admin_sessions')return {data:sessionRow(role,'admin-1'),error:null};
          if(table==='events')return {data:single ? {id:eventId,claim_hold_hours:24} : [{id:eventId}],error:null};
          if(table!=='reservations')throw new Error('Unexpected table');
          const matches=row.status!=='EMPTY' && filters.every(([key,value])=>row[key]===value);
          if(patch && matches){
            if((failFinal && patch.ticket_sent_at)||(failAudit && patch.confirmed_by_access_id))return {data:null,error:{message:'private database error'}};
            writes.push(structuredClone(patch));Object.assign(row,patch);
          }
          const projected=fields ? Object.fromEntries(fields.split(',').map(key=>key==='events(name)' ? ['events',row.events] : [key,row[key]])) : null;
          return {data:single ? matches ? projected : null : fields ? matches ? [projected] : [] : null,error:null};
        }).then(resolve,reject);}
      };q.single=q.maybeSingle;return q;
    },
    async rpc(name,args){rpcCalls.push([name,args]);if(!['confirm_payment','confirm_external_payment'].includes(name))throw new Error('Unexpected RPC');
      if(!(name==='confirm_external_payment'?['PAID','PAYMENT_CLAIMED','RESERVED','EXPIRED']:['PAID','PAYMENT_CLAIMED']).includes(row.status))return {error:{message:'PAYMENT_NOT_CLAIMED'}};
      row.status='PAID';return {data:{reservation_id:id,status:'PAID'},error:null};}
  };
  const req={headers:{...sessionHeaders},body:{reservation_id:id}};
  return {row,db,req,writes,rpcCalls,setRole:value=>role=value,failFinal:()=>failFinal=true,failAudit:()=>failAudit=true};
}
test('token is a deterministic versioned HMAC and differs by reservation/event',()=>{
  const token=tickets.deriveTicketToken(id,eventId,secret);
  assert.equal(token,tickets.deriveTicketToken(id,eventId,secret));
  assert.equal(token,createHmac('sha256',secret).update('tubarao-ticket-v1:'+id+':'+eventId).digest('base64url'));
  assert.notEqual(token,tickets.deriveTicketToken(eventId,eventId,secret));
  assert.notEqual(token,tickets.deriveTicketToken(id,id,secret));
  assert.equal(tickets.hashTicketToken(token),createHash('sha256').update(token).digest('hex'));
  assert.ok(tickets.matchesTokenHash(token,tickets.hashTicketToken(token)));
  assert.equal(tickets.matchesTokenHash(token,'not-a-hash'),false);
  assert.throws(()=>tickets.deriveTicketToken(id,eventId,''));
});
test('QR payload contains only the opaque token and generates a real PNG',async()=>{
  const token=tickets.deriveTicketToken(id,eventId,secret),payload=tickets.ticketPayload(token);
  assert.match(payload,/^TUBARAO:[A-Za-z0-9_-]{43}$/);
  for(const value of [id,eventId,'Ana','ana@example.test','WOMEN','800'])assert.equal(payload.includes(value),false);
  const png=await tickets.generateQrPng(token);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),500);assert.equal(png.readUInt32BE(20),500);
  const {PNG}=require('node:module').createRequire(require.resolve('qrcode'))('pngjs');
  const decoded=PNG.sync.read(png);
  let blackPixels=0;
  for(let y=0;y<500;y++)for(let x=0;x<500;x++){
    const pixel=decoded.data.subarray((y*500+x)*4,(y*500+x)*4+4);
    assert.ok(pixel.equals(Buffer.from([0,0,0,255])) || pixel.equals(Buffer.from([255,255,255,255])));
    if(pixel[0]===0)blackPixels++;
    if(x<50 || y<50 || x>=450 || y>=450)assert.equal(pixel[0],255,'QR has a generous white quiet zone');
  }
  assert.ok(blackPixels>10000);
});
test('email uses CID PNG, escapes guest HTML and uses actual amount/category',()=>{
  const row=fixture({first_name:'<img src=x onerror=alert(1)>',last_name:'Silva & Costa',events:{name:'Garden <Party>'},category:'MEN',amount_cents:1235}).row;
  const png=Buffer.from('png');const message=tickets.ticketMessage(row,png,'sender@example.test');
  assert.equal(message.from,'sender@example.test');
  assert.equal(message.subject,'Your Tubarão ticket');
  assert.match(message.html,/&lt;img src=x onerror=alert\(1\)&gt; Silva &amp; Costa/);
  assert.match(message.html,/>MEN<\/p>/);assert.match(message.html,/>€12.35<\/p>/);assert.match(message.html,/Garden &lt;Party&gt;/);
  assert.match(message.html,/src="cid:ticket-qr@tubarao"/);assert.deepEqual(Buffer.from(message.attachments[0].content,'base64'),png);
  assert.equal(message.attachments[0].contentId,'ticket-qr@tubarao');assert.ok(message.attachments.every(a=>!a.path));
  const logo=message.attachments[1];
  assert.equal(logo.contentId,'tubarao-logo@tubarao');assert.equal(logo.contentType,'image/jpeg');
  assert.deepEqual(Buffer.from(logo.content,'base64'),require('node:fs').readFileSync(require('node:path').join(__dirname,'../assets/tubarao-logo.jpeg')));
  assert.match(message.html,/src="cid:tubarao-logo@tubarao"/);
  assert.doesNotMatch(message.html,/<style|<link|src="https?:|<script|display:(flex|grid)/);
  const standard=tickets.ticketMessage(fixture().row,png,'sender@example.test');
  assert.match(standard.html,/>€8.00<\/p>/);assert.match(standard.html,/Ana Silva/);
  assert.match(standard.text,/^Your Tubarão ticket\n\nAna, your payment has been confirmed\./);
  assert.match(standard.text,/Category: WOMEN\nTicket: €8.00\nEvent: Tubarão — Garden Session/);
});

test('ticket preview uses a synthetic location label and contains no external URLs',()=>{
  const message=tickets.ticketMessage(fixture().row,Buffer.from('png'),'sender@example.test');
  assert.match(message.html,/Classroom demo/);
  assert.match(message.text,/Tubarão classroom demo/);
  assert.doesNotMatch(message.html+message.text,/https?:\/\//);
});
test('confirm records the admin, QR hash and successful attempt without storing token',async()=>{
  const f=fixture();let sends=0;
  const result=await backend.review(f.db,f.req,'confirm_payment',{...options,send:async row=>{sends++;assert.equal(row.last_name,'Silva');assert.equal(row.events.name,'Tubarão — Garden Session');}});
  assert.equal(result.status,'PAID');assert.equal(result.ticket_email_sent,true);assert.equal(sends,1);
  assert.equal(f.row.confirmed_by_access_id,'admin-1');assert.equal(f.row.ticket_email_attempts,1);
  assert.equal(f.row.qr_created_at,date);assert.equal(f.row.ticket_sent_at,date);assert.equal(f.row.ticket_email_error,null);
  const token=tickets.deriveTicketToken(id,eventId,secret);assert.equal(f.row.qr_token_hash,tickets.hashTicketToken(token));
  assert.equal(JSON.stringify(f.writes).includes(token),false);assert.equal(JSON.stringify(result).includes(f.row.qr_token_hash),false);
});

test('external payment confirmation reuses delivery, deterministic identity and failure/retry behavior',async()=>{
  for(const status of ['RESERVED','EXPIRED','PAYMENT_CLAIMED','PAID']) {
    const f=fixture({status});let sends=0;const tokens=[];
    const config={...options,generate:async token=>{tokens.push(token);return Buffer.from('png');},send:async()=>{sends++;}};
    const result=await backend.review(f.db,f.req,'confirm_external_payment',config);
    assert.equal(result.status,'PAID');assert.equal(result.ticket_email_sent,true);assert.equal(f.row.confirmed_by_access_id,'admin-1');
    assert.equal(tokens[0],tickets.deriveTicketToken(id,eventId,secret));
    assert.deepEqual(f.rpcCalls[0],['confirm_external_payment',{p_reservation_id:id,p_admin_id:'admin-1'}]);
    await backend.review(f.db,f.req,'confirm_external_payment',config);assert.equal(sends,1);
  }
  const f=fixture({status:'RESERVED'});
  const failed=await backend.review(f.db,f.req,'confirm_external_payment',{...options,send:async()=>{throw new Error('private');}});
  assert.equal(failed.status,'PAID');assert.equal(failed.ticket_email_sent,false);assert.equal(f.row.status,'PAID');assert.equal(f.row.ticket_email_attempts,1);
  const hash=f.row.qr_token_hash;
  const resent=await backend.resendTicket(f.db,f.req,{...options,send:async()=>{}});
  assert.equal(resent.ticket_email_sent,true);assert.equal(f.row.qr_token_hash,hash);
});

test('normal, RESERVED and EXPIRED confirmations capture one identical ticket preview, including overlapping retries',async()=>{
  const payloads=[],metadata=[];
  for(const status of ['PAYMENT_CLAIMED','RESERVED','EXPIRED']) {
    const f=fixture({status});const messages=[];
    const send=async (row,png)=>{
      messages.push(tickets.ticketMessage(row,png,'sender@example.test'));
      await new Promise(resolve=>setImmediate(resolve));
    };
    const rpc=status==='PAYMENT_CLAIMED'?'confirm_payment':'confirm_external_payment';
    const config={...options,send};
    await Promise.all([backend.review(f.db,f.req,rpc,config),backend.review(f.db,f.req,rpc,config)]);
    await backend.review(f.db,f.req,rpc,config);
    assert.equal(messages.length,1);assert.equal(f.row.ticket_email_attempts,1);assert.equal(f.row.ticket_sent_at,date);
    assert.equal(f.row.ticket_email_error,null);assert.equal(f.row.ticket_email_last_attempt_at,date);
    payloads.push(messages[0]);metadata.push({hash:f.row.qr_token_hash,created:f.row.qr_created_at,sent:f.row.ticket_sent_at,attempts:f.row.ticket_email_attempts});
  }
  for(const message of payloads) {
    assert.deepEqual(message,payloads[0]); // from, to, subject, html, text and attachment bytes/structure.
    assert.deepEqual(Object.keys(message).sort(),['from','to','subject','html','text','attachments'].sort()); // No route-specific headers or Reply-To.
    assert.deepEqual(message.attachments.map(a=>[a.contentId,a.contentType]),[['ticket-qr@tubarao','image/png'],['tubarao-logo@tubarao','image/jpeg']]);
  }
  assert.deepEqual(metadata[1],metadata[0]);assert.deepEqual(metadata[2],metadata[0]);
});
test('Provider failure keeps PAID, increments attempt metadata and stores only safe error',async()=>{
  const f=fixture();
  const result=await backend.review(f.db,f.req,'confirm_payment',{...options,send:async()=>{throw new Error('Provider credential=secret recipient=private');}});
  assert.equal(result.status,'PAID');assert.equal(f.row.status,'PAID');assert.equal(result.ticket_email_sent,false);
  assert.equal(f.row.ticket_sent_at,null);assert.equal(f.row.ticket_email_attempts,1);assert.equal(f.row.ticket_email_last_attempt_at,date);
  assert.doesNotMatch(f.row.ticket_email_error,/credential|secret|recipient/);assert.doesNotMatch(JSON.stringify(result),/private/);
});
test('repeated confirms never resend and preserve the original admin',async()=>{
  const f=fixture({confirmed_by_access_id:'original-admin'});let sends=0;
  const config={...options,send:async()=>{sends++;}};
  await backend.review(f.db,f.req,'confirm_payment',config);
  await backend.review(f.db,f.req,'confirm_payment',config);
  assert.equal(sends,1);assert.equal(f.row.ticket_email_attempts,1);assert.equal(f.row.confirmed_by_access_id,'original-admin');
});
test('parallel confirms elect one sender across requests',async()=>{
  const f=fixture();let sends=0;
  const config={...options,send:async()=>{sends++;await new Promise(resolve=>setImmediate(resolve));}};
  await Promise.all([backend.review(f.db,f.req,'confirm_payment',config),backend.review(f.db,f.req,'confirm_payment',config)]);
  assert.equal(sends,1);assert.equal(f.row.ticket_email_attempts,1);assert.equal(f.row.ticket_sent_at,date);
});
test('failed automatic send is recovered only by explicit resend with the same QR',async()=>{
  const f=fixture();let fail=true,sends=0;const tokens=[];
  const config={...options,generate:async token=>{tokens.push(token);return Buffer.from('png');},send:async()=>{sends++;if(fail)throw new Error('Provider failed');}};
  await backend.review(f.db,f.req,'confirm_payment',config);
  await backend.review(f.db,f.req,'confirm_payment',config);assert.equal(sends,1);
  fail=false;const result=await backend.resendTicket(f.db,f.req,config);
  assert.equal(result.ticket_email_sent,true);assert.equal(f.row.ticket_email_attempts,2);assert.equal(f.row.ticket_email_error,null);
  assert.equal(tokens[0],tokens[1]);assert.equal(f.row.ticket_sent_at,date);
});
test('resend requires a verified admin and an already PAID reservation',async()=>{
  for(const status of ['RESERVED','PAYMENT_CLAIMED','REJECTED','EXPIRED','CANCELLED']) {
    const f=fixture({status});await assert.rejects(backend.resendTicket(f.db,f.req,options),e=>e.code==='PAYMENT_NOT_CONFIRMED');assert.equal(f.row.ticket_email_attempts,0);
  }
  for(const rpc of ['confirm','resend']){
    const f=fixture({status:'PAID'});const run=()=>rpc==='confirm'?backend.review(f.db,f.req,'confirm_payment',options):backend.resendTicket(f.db,f.req,options);
    f.req.headers.cookie='invalid';await assert.rejects(run,e=>e.status===401);
    f.req.headers.cookie=sessionHeaders.cookie;f.setRole('ADMIN');await assert.rejects(run,e=>e.status===403);assert.equal(f.row.ticket_email_attempts,0);
  }
});
test('resend rejects a changed signing secret without replacing the existing hash',async()=>{
  const hash=tickets.hashTicketToken(tickets.deriveTicketToken(id,eventId,secret));
  const f=fixture({status:'PAID',qr_token_hash:hash});let sends=0;
  const result=await backend.resendTicket(f.db,f.req,{...options,secret:secret+'changed',send:async()=>sends++});
  assert.equal(result.ticket_email_sent,false);assert.match(result.ticket_email_error,/original signing secret/);
  assert.equal(f.row.qr_token_hash,hash);assert.equal(sends,0);
});
test('in-flight resend is held; abandoned attempt can be explicitly retried after lease',async()=>{
  const f=fixture({status:'PAID',ticket_email_attempts:1,ticket_email_error:'Demo ticket is being prepared.',ticket_email_last_attempt_at:date});let sends=0;
  assert.equal((await backend.resendTicket(f.db,f.req,{...options,send:async()=>sends++})).ticket_email_pending,true);
  assert.equal(sends,0);
  await backend.resendTicket(f.db,f.req,{...options,now:()=>new Date(Date.parse(date)+120001),send:async()=>sends++});
  assert.equal(sends,1);assert.equal(f.row.ticket_email_attempts,2);
});
test('accepted provider submission with failed persistence stays PAID and reports uncertainty without automatic duplicates',async()=>{
  const f=fixture();f.failFinal();let sends=0;
  const config={...options,send:async()=>sends++};
  const result=await backend.review(f.db,f.req,'confirm_payment',config);
  assert.equal(result.status,'PAID');assert.match(result.ticket_email_error,/could not be saved/);
  await backend.review(f.db,f.req,'confirm_payment',config);assert.equal(sends,1);
});
test('audit database failure never undoes payment or sends without recording the actor',async()=>{
  const f=fixture();f.failAudit();let sends=0;
  const result=await backend.review(f.db,f.req,'confirm_payment',{...options,send:async()=>sends++});
  assert.equal(result.status,'PAID');assert.equal(result.ticket_email_sent,false);assert.equal(sends,0);
});
test('unknown historical email errors are sanitized for the admin dashboard',()=>{
  assert.equal(safeTicketError(null),null);
  assert.doesNotMatch(safeTicketError('SMTP AUTH password=private'),/SMTP|AUTH|password|private/);
});

test('legacy confirmation audit is preserved without attributing it to a new access account',async()=>{const f=fixture({confirmed_by:'legacy-user'});await backend.review(f.db,f.req,'confirm_payment',{...options,send:async()=>{}});assert.equal(f.row.confirmed_by,'legacy-user');assert.equal(f.row.confirmed_by_access_id,null);});

test('explicit resend after category correction reads the new category and reuses the same QR',async()=>{
 const token=tickets.deriveTicketToken(id,eventId,secret),hash=tickets.hashTicketToken(token);
 for(const amount_cents of [800,1200]){const f=fixture({status:'PAID',category:'WOMEN',amount_cents,qr_token_hash:hash,ticket_sent_at:date});
 f.row.category='MEN';let sends=0;const result=await backend.resendTicket(f.db,f.req,{...options,generate:async value=>{assert.equal(value,token);return Buffer.from('png');},send:async(row,png)=>{sends++;assert.equal(row.category,'MEN');assert.match(tickets.ticketMessage(row,png,'tickets@example.com').text,/Category: MEN/);}});
 assert.equal(result.ticket_email_sent,true);assert.equal(sends,1);assert.equal(f.row.amount_cents,amount_cents);assert.equal(f.row.qr_token_hash,hash);assert.ok(f.writes.every(p=>!('category' in p)&&!('amount_cents' in p)));}
});

test('manual amount correction keeps existing QR and explicit resend displays the current stored amount',async()=>{
 const token=tickets.deriveTicketToken(id,eventId,secret),hash=tickets.hashTicketToken(token);
 const f=fixture({status:'PAID',amount_cents:1200,pricing_tier:'LATE',qr_token_hash:hash,ticket_sent_at:date});f.row.amount_cents=800;let sends=0;
 await backend.resendTicket(f.db,f.req,{...options,generate:async value=>{assert.equal(value,token);return Buffer.from('png');},send:async(row,png)=>{sends++;assert.equal(row.amount_cents,800);const message=tickets.ticketMessage(row,png,'tickets@example.com');assert.match(message.text,/Ticket: €8.00/);assert.doesNotMatch(message.text,/€12.00/);}});
 assert.equal(sends,1);assert.equal(f.row.qr_token_hash,hash);assert.equal(f.row.pricing_tier,'LATE');assert.equal(f.row.status,'PAID');
});

test('demo reservation, claim, confirmation, QR download and check-in use the existing workflow without provider calls',async t=>{
 const {createRequire}=require('node:module'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 const entry=path.join(__dirname,'../api/admin/payments.js'),load=createRequire(entry);
 const saved=process.env.DEMO_TICKET_SIGNING_SECRET;
 process.env.DEMO_TICKET_SIGNING_SECRET=secret;
 t.after(()=>{if(saved===undefined)delete process.env.DEMO_TICKET_SIGNING_SECRET;else process.env.DEMO_TICKET_SIGNING_SECRET=saved;});
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Demo issuance must not call any provider'));
 for(const [tier,amount] of [['EARLY',800],['LATE',1200],['LATE',800]]){
   const f=fixture({status:'EMPTY',pricing_tier:tier,amount_cents:amount});
   const originalRpc=f.db.rpc;
   f.db.rpc=async (name,args)=>{
     if(name==='create_reservation'){
       assert.deepEqual(args,{p_event_id:eventId,p_first_name:'Ana',p_last_name:'Silva',p_email:'ana@example.test',p_category:'WOMEN'});
       Object.assign(f.row,{status:'RESERVED',reserved_until:new Date(Date.now()+1200000).toISOString()});
       return {data:{...f.row,reservation_id:id}};
     }
     if(name==='claim_payment'){
       assert.deepEqual(args,{p_reservation_id:id,p_email:'ana@example.test'});
       Object.assign(f.row,{status:'PAYMENT_CLAIMED',claimed_at:new Date().toISOString()});
       return {data:{status:f.row.status}};
     }
     if(name==='check_in_ticket'){
       assert.deepEqual(args,{p_qr_token_hash:f.row.qr_token_hash,p_admin_id:'admin-1'});
       const result=f.row.checked_in_at ? 'ALREADY_CHECKED_IN' : 'CHECKED_IN';
       f.row.checked_in_at ??= date;
       return {data:{...f.row,result}};
     }
     return originalRpc(name,args);
   };
   const reservation=await backend.reserve(f.db,{body:{first_name:'Ana',last_name:'Silva',email:f.row.email,category:'WOMEN'}});
   assert.equal(reservation.status,'RESERVED');assert.equal(reservation.amount_cents,amount);
   assert.equal('payment_url' in reservation,false);
   assert.equal((await backend.claim(f.db,{body:{reservation_id:id,email:f.row.email}})).status,'PAYMENT_CLAIMED');
   const module={exports:{}};
   vm.runInNewContext(fs.readFileSync(entry,'utf8'),{module,require:name=>name==='../../server/supabase'?{serverSupabase:()=>f.db}:load(name)});
   const call=async (method,action,headers=f.req.headers)=>{
     let status,response;const responseHeaders={};
     await module.exports({method,query:{action,reservation_id:id},headers:{...headers,'content-type':'application/json'},body:f.req.body},{
       setHeader(k,v){responseHeaders[k]=v;},status(n){status=n;return this;},json(value){response=value;},send(value){response=value;}
     });
     return {status,response,responseHeaders};
   };
   const get=()=>call('GET','ticket-qr');
   assert.equal((await get()).status,409);
   const originalStatus=f.row.status;f.row.status='PAID';assert.equal((await get()).status,404);f.row.status=originalStatus;
   const result=await call('POST','confirm-payment');
   assert.equal(result.status,200);assert.equal(result.response.status,'PAID');assert.equal(result.response.ticket_email_sent,true);
   assert.equal(f.row.confirmed_by_access_id,'admin-1');assert.equal(f.row.amount_cents,amount);assert.equal(f.row.pricing_tier,tier);
   const download=await get();
   assert.equal(download.status,200);assert.equal(download.responseHeaders['Cache-Control'],'private, no-store');
   assert.equal(download.responseHeaders['Content-Type'],'image/png');
   const token=tickets.deriveTicketToken(id,eventId,secret);
   assert.deepEqual(download.response,await tickets.generateQrPng(token));
   assert.equal(f.row.qr_token_hash,tickets.hashTicketToken(token));
   await call('POST','confirm-payment');assert.equal(f.row.ticket_email_attempts,1);
   assert.equal((await call('POST','resend-ticket')).status,200);
   assert.deepEqual((await get()).response,download.response);
   const activeEvent=f.row.event_id;f.row.event_id=id;assert.equal((await get()).status,404);f.row.event_id=activeEvent;
   const existingHash=f.row.qr_token_hash;f.row.qr_token_hash='0'.repeat(64);assert.equal((await get()).status,409);f.row.qr_token_hash=existingHash;
   f.setRole('ADMIN');assert.equal((await get()).status,403);assert.equal((await call('GET','ticket-qr',{})).status,401);
   const {checkIn}=require('../server/checkin');
   const scan=()=>checkIn(f.db,{headers:f.req.headers,body:{qr_payload:tickets.ticketPayload(token)}});
   assert.equal((await scan()).result,'CHECKED_IN');
   const duplicate=await scan();
   assert.equal(duplicate.result,'ALREADY_CHECKED_IN');assert.equal(duplicate.checked_in_at,date);
 }
});
