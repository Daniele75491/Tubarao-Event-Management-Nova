const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const out = path.join(root,'dist');
// Explicit public allowlist: server sources, tests, documents and env files never publish.
const files = ['index.html','checkout.html','privacy.html','ticket.html','admin.html','admin-management.js','admin-management.css','checkin.html','checkin.css','checkin.js','checkin-presence.js','styles.css','ticket-pricing.js','app.js','checkout.js','admin.js','admin-attendees.js','admin-kpis.js'];
fs.mkdirSync(out,{recursive:true});
for (const file of files) fs.copyFileSync(path.join(root,file),path.join(out,file));
fs.cpSync(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
fs.mkdirSync(path.join(out,'vendor'),{recursive:true});
// Remove the obsolete browser Auth bundle from incremental local builds.
fs.rmSync(path.join(out,'vendor','supabase.js'),{force:true});
const scanner = path.dirname(require.resolve('qr-scanner'));
for (const file of ['qr-scanner.min.js','qr-scanner-worker.min.js','LICENSE']) {
  fs.copyFileSync(path.join(scanner,file),path.join(out,'vendor',file === 'LICENSE' ? 'qr-scanner-LICENSE' : file));
}
console.log('Built public frontend in dist.');
