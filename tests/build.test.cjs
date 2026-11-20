const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
test('public build excludes private sources and includes every page script',()=>{
  execFileSync(process.execPath,['scripts/build.cjs'],{cwd:root});
  const out=path.join(root,'dist');
  for(const name of ['server','supabase','tests','docs','.env','package.json','pnpm-lock.yaml'])assert.equal(fs.existsSync(path.join(out,name)),false,name);
  for(const page of ['index.html','checkout.html','admin.html','ticket.html','checkin.html','privacy.html']){
    const html=fs.readFileSync(path.join(out,page),'utf8');
    for(const match of html.matchAll(/<script[^>]* src="([^"]+)"/g))assert.equal(fs.existsSync(path.join(out,match[1])),true,match[1]);
  }
  for(const file of fs.readdirSync(out).filter(file=>/\.(js|html)$/.test(file)))assert.doesNotMatch(fs.readFileSync(path.join(out,file),'utf8'),/SUPABASE_SECRET_KEY|TICKET_SIGNING_SECRET|EMAIL_APP_PASSWORD|EMAIL_USER|RESEND_API_KEY|EMAIL_FROM|qr_token_hash/);
  assert.deepEqual(fs.readFileSync(path.join(out,'assets/tubarao-logo.jpeg')),fs.readFileSync(path.join(root,'assets/tubarao-logo.jpeg')));
  assert.deepEqual(fs.readFileSync(path.join(out,'assets/tubarao-hero.mp4')),fs.readFileSync(path.join(root,'assets/tubarao-hero.mp4')));
  for(const file of ['qr-scanner.min.js','qr-scanner-worker.min.js','qr-scanner-LICENSE'])assert.ok(fs.existsSync(path.join(out,'vendor',file)),file);
  assert.equal(fs.existsSync(path.join(out,'vendor/supabase.js')),false);
  for(const file of ['admin.html','checkin.html','admin.js','checkin.js','app.js'])assert.doesNotMatch(fs.readFileSync(path.join(out,file),'utf8'),/signInWithPassword|Bearer |SUPABASE_PUBLISHABLE_KEY|public-config|admin-email|admin-password/);
});
