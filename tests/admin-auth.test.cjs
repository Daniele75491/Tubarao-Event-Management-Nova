const {test}=require('node:test');const assert=require('node:assert/strict');
const {randomBytes,scryptSync}=require('node:crypto');
const auth=require('../server/admin-auth');
function fixture(){
const code=randomBytes(24).toString('base64url')+'Aa',salt=randomBytes(16),now=Date.now();
const account={id:'11111111-1111-4111-8111-111111111111',label:'DOOR 1',role:'ADMIN',is_active:true,code_salt:salt.toString('hex'),code_hash:scryptSync(code,salt,32,{N:16384,r:8,p:1}).toString('hex')};
const sessions=[],writes=[];
const db={from(table){let mode='read',value,projection,single=false;const filters=[];const q={select(v){projection=v;return q;},eq(k,v){filters.push([k,v]);return q;},is(k,v){filters.push([k,v]);return q;},maybeSingle(){single=true;return q;},insert(v){mode='insert';value=v;return q;},update(v){mode='update';value=v;return q;},then(resolve,reject){return Promise.resolve().then(()=>{
const rows=table==='admin_access_accounts'?[account]:sessions;
let matches=rows.filter(row=>filters.every(([key,v])=>row[key]===v));
if(mode==='insert'){const row={id:'session-'+sessions.length,revoked_at:null,...value};rows.push(row);writes.push(structuredClone(value));matches=[row];}
if(mode==='update'){writes.push(structuredClone(value));matches.forEach(row=>Object.assign(row,value));}
const data=table==='admin_sessions'?matches.map(row=>({...row,account:{id:account.id,label:account.label,role:account.role,is_active:account.is_active}})):matches;
return {data:single?data[0]??null:data,error:null};}).then(resolve,reject);}};return q;}};
const req={headers:{},body:{code},query:{action:'login'},method:'POST'},res={headers:{},setHeader(key,value){this.headers[key]=value;}};
return {db,account,sessions,writes,req,res,now,code,opts:{now,env:{NODE_ENV:'production'}},cookie:()=>res.headers['Set-Cookie'].split(';')[0]};
}
test('scrypt matches hex salt/32-byte stored hash; code is trimmed and otherwise case-sensitive',async()=>{
const f=fixture();assert.equal(await auth.verifyCode(f.code,f.account),true);assert.equal(await auth.verifyCode(f.code.toLowerCase(),f.account),false);
f.req.body.code='  '+f.code+'  ';const identity=await auth.login(f.db,f.req,f.res,f.opts);assert.deepEqual(identity,{authenticated:true,label:'DOOR 1',role:'ADMIN'});
});
test('wrong codes and inactive accounts fail with identical generic response and no session',async()=>{
for(const disabled of [false,true]){const f=fixture();if(disabled)f.account.is_active=false;else f.req.body.code=randomBytes(24).toString('hex');await assert.rejects(auth.login(f.db,f.req,f.res,f.opts),e=>e.status===401&&e.message==='INVALID ACCESS CODE');assert.equal(f.sessions.length,0);assert.equal(f.res.headers['Set-Cookie'],undefined);}
});
test('login stores only a hash and issues a secure HttpOnly 12-hour cookie',async()=>{
const f=fixture();const result=await auth.login(f.db,f.req,f.res,f.opts);const cookie=f.res.headers['Set-Cookie'],token=cookie.split(';')[0].split('=')[1];
assert.equal(Buffer.from(token,'base64url').length,32);assert.equal(f.sessions[0].session_token_hash,auth.hashToken(token));assert.equal(Date.parse(f.sessions[0].expires_at)-f.now,43200000);assert.equal(f.account.last_login_at,new Date(f.now).toISOString());
for(const flag of ['HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=43200'])assert.ok(cookie.includes(flag));
assert.equal(JSON.stringify(f.writes).includes(token),false);assert.equal(JSON.stringify(f.writes).includes(f.code),false);assert.equal(JSON.stringify(result).includes(token),false);
});
test('valid sessions authorize by database role; expired/revoked/inactive sessions fail closed',async()=>{
for(const failure of ['expires','revoked','inactive','none']){const f=fixture();await auth.login(f.db,f.req,f.res,f.opts);f.req.headers.cookie=f.cookie();if(failure==='expires')f.sessions[0].expires_at=new Date(f.now-1).toISOString();if(failure==='revoked')f.sessions[0].revoked_at=new Date().toISOString();if(failure==='inactive')f.account.is_active=false;
if(failure==='none'){assert.equal((await auth.requireAdmin(f.db,f.req,['ADMIN','SUPER_ADMIN'])).account_id,f.account.id);await assert.rejects(auth.requireAdmin(f.db,f.req),e=>e.status===403);f.account.role='SUPER_ADMIN';assert.equal((await auth.requireAdmin(f.db,f.req)).role,'SUPER_ADMIN');}
else await assert.rejects(auth.requireAdmin(f.db,f.req,['ADMIN','SUPER_ADMIN']),e=>e.status===401);
}
});
test('last_seen writes are throttled without extending fixed expiry',async()=>{
const f=fixture();await auth.login(f.db,f.req,f.res,f.opts);f.req.headers.cookie=f.cookie();const n=f.writes.length,expiry=f.sessions[0].expires_at;await auth.session(f.db,f.req,{now:f.now+1000});assert.equal(f.writes.length,n);await auth.session(f.db,f.req,{now:f.now+16*60000});assert.equal(f.writes.length,n+1);assert.equal(f.sessions[0].expires_at,expiry);
});
test('logout revokes the current session and clears cookie, including expired sessions',async()=>{
const f=fixture();await auth.login(f.db,f.req,f.res,f.opts);f.req.headers.cookie=f.cookie();f.req.body={};await auth.logout(f.db,f.req,f.res,f.opts);assert.equal(f.sessions[0].revoked_at,new Date(f.now).toISOString());assert.match(f.res.headers['Set-Cookie'],/Max-Age=0/);assert.equal(await auth.session(f.db,f.req),null);
});
test('session tokens in bearer headers/URLs cannot authenticate; duplicate cookies rejected',async()=>{
const f=fixture();await auth.login(f.db,f.req,f.res,f.opts);f.req.headers.authorization='Bearer '+f.cookie().split('=')[1];assert.equal(await auth.session(f.db,f.req),null);f.req.headers.cookie=f.cookie()+'; '+f.cookie();assert.equal(await auth.session(f.db,f.req),null);
});
test('GET auth exposes only public identity and never the account hashes',async()=>{
const f=fixture();f.req.method='GET';f.req.query={};assert.deepEqual(await auth.authRoute(f.db,f.req,f.res),{authenticated:false});await auth.login(f.db,f.req,f.res,f.opts);f.req.headers.cookie=f.cookie();assert.deepEqual(await auth.authRoute(f.db,f.req,f.res),{authenticated:true,label:'DOOR 1',role:'ADMIN'});
});

test('auth HTTP wrapper preserves cookie transport and rejects cross-origin login/logout before writes',async()=>{
const {endpoint}=require('../server/http');const f=fixture();
const handler=endpoint(['GET','POST'],(req,res)=>auth.authRoute(f.db,req,res));
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;return this;}});
for(const action of ['login','logout']){const res=response();await handler({...f.req,query:{action},headers:{'content-type':'application/json',host:'example.com',origin:'https://elsewhere.example'}},res);assert.equal(res.code,403);assert.equal(f.writes.length,0);}
const res=response();await handler({...f.req,headers:{'content-type':'application/json',host:'example.com',origin:'https://example.com','x-forwarded-proto':'https'}},res);
assert.equal(res.code,200);assert.match(res.headers['Set-Cookie'],/HttpOnly.*Secure/);assert.equal(res.headers['Cache-Control'],'no-store');assert.deepEqual(Object.keys(res.body).sort(),['authenticated','label','role']);
});

test('login rotates an existing session; expired session logout still revokes its row',async()=>{
const f=fixture();await auth.login(f.db,f.req,f.res,f.opts);const old=f.cookie();f.req.headers.cookie=old;
await auth.login(f.db,f.req,f.res,f.opts);assert.notEqual(f.cookie(),old);assert.ok(f.sessions[0].revoked_at);assert.equal(f.sessions.length,2);
f.req.headers.cookie=f.cookie();f.req.body={};f.sessions[1].expires_at=new Date(f.now-1).toISOString();await auth.logout(f.db,f.req,f.res,f.opts);assert.ok(f.sessions[1].revoked_at);assert.equal(await auth.session(f.db,f.req),null);
});
