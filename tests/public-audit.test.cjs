const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
test('shared public formatting shows the real date/time and compact authoritative prices',()=>{
 const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);const api=context.window.Tubarao;
 assert.equal(api.eventDate('2026-10-04T17:00:00Z'),'Sunday, 4 October 2026');
 assert.equal(api.eventTime('2026-10-04T17:00:00Z'),'18:00 – 22:30');
 assert.equal(api.eventTime('2026-10-11T17:00:00Z'),'18:00');
 assert.equal(api.eventDate(null),'');assert.equal(api.eventTime(null),'');
 assert.equal(api.euro(800,true),'€8');assert.equal(api.euro(1235,true),'€12.35');assert.equal(api.euro(800),'€8.00');
});
test('public source has no demo/fee/instant QR or obsolete reservation copy',()=>{
 for(const file of ['index.html','checkout.html','ticket.html','privacy.html','app.js','checkout.js']){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  assert.doesNotMatch(source,/paypal|€8\.30|provider fee|processing fee|Tubarão Demo|test event|fake event|15-minute|within 15 minutes|15:00|fake QR/i,file);
 }
 assert.doesNotMatch(fs.readFileSync(path.join(root,'checkout.js'),'utf8'),/qr_token|generateQr|canvas|qrcode/i);
});
