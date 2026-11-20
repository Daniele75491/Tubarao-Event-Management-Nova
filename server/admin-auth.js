'use strict';
const {randomBytes,createHash,scrypt,timingSafeEqual} = require('node:crypto');
const {promisify} = require('node:util');
const {HttpError,jsonBody} = require('./http');
const derive = promisify(scrypt);
const COOKIE = 'tubarao_admin_session', TTL = 12*60*60;
const hashToken = token => createHash('sha256').update(token).digest('hex');
const checked = result => {if(result.error)throw new Error('Session service unavailable.');return result.data;};
const invalid = () => new HttpError(401,'INVALID_ACCESS_CODE','INVALID ACCESS CODE');
function tokenFrom(req) {
  const parts = (req.headers.cookie || '').split(';').map(value=>value.trim()).filter(value=>value.startsWith(COOKIE+'='));
  if(parts.length!==1)return null;
  const token=parts[0].slice(COOKIE.length+1);
  return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
}
function cookie(req,token,maxAge,env=process.env) {
  const secure=env.NODE_ENV==='production'||env.VERCEL==='1'||req.headers['x-forwarded-proto']==='https';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
async function verifyCode(code,account) {
  if(typeof account.code_salt!=='string'||!/^([a-f0-9]{2})+$/i.test(account.code_salt)||account.code_salt.length>2048||typeof account.code_hash!=='string'||!/^[a-f0-9]{64}$/i.test(account.code_hash))throw new Error('Access configuration unavailable.');
  const actual=await derive(code,Buffer.from(account.code_salt,'hex'),32,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return timingSafeEqual(actual,Buffer.from(account.code_hash,'hex'));
}
async function session(db,req,{now=Date.now(),touch=true}={}) {
  const token=tokenFrom(req);if(!token)return null;
  const row=checked(await db.from('admin_sessions').select('id,account_id,expires_at,revoked_at,last_seen_at,account:admin_access_accounts(id,label,role,is_active)').eq('session_token_hash',hashToken(token)).maybeSingle());
  if(!row||row.revoked_at||!(Date.parse(row.expires_at)>now)||!row.account?.is_active||!['ADMIN','SUPER_ADMIN'].includes(row.account.role)||row.account.id!==row.account_id)return null;
  if(touch&&(!row.last_seen_at||Date.parse(row.last_seen_at)<now-15*60*1000)){
    let update=db.from('admin_sessions').update({last_seen_at:new Date(now).toISOString()}).eq('id',row.id).is('revoked_at',null);
    update=row.last_seen_at?update.eq('last_seen_at',row.last_seen_at):update.is('last_seen_at',null);
    checked(await update);
  }
  return {account_id:row.account.id,label:row.account.label,role:row.account.role};
}
async function requireAdmin(db,req,roles=['SUPER_ADMIN'],sessionOptions) {
  const identity=await session(db,req,sessionOptions);
  if(!identity)throw new HttpError(401,'UNAUTHORIZED','Enter your access code to continue.');
  if(!roles.includes(identity.role))throw new HttpError(403,'FORBIDDEN','This account does not have access.');
  return identity;
}
async function login(db,req,res,{now=Date.now(),env=process.env}={}) {
  const body=jsonBody(req,['code']);
  if(typeof body.code!=='string'||!body.code.trim()||body.code.length>512)throw invalid();
  const code=body.code.trim();
  const accounts=checked(await db.from('admin_access_accounts').select('id,label,role,code_salt,code_hash,is_active').eq('is_active',true));
  const matches=[];
  // Compare every active account; never expose an account-specific failure.
  for(const account of accounts){const matchesCode=await verifyCode(code,account);if(matchesCode&&account.is_active&&['ADMIN','SUPER_ADMIN'].includes(account.role))matches.push(account);}
  if(matches.length!==1)throw invalid();
  const account=matches[0], timestamp=new Date(now).toISOString();
  const updated=checked(await db.from('admin_access_accounts').update({last_login_at:timestamp}).eq('id',account.id).eq('is_active',true).select('id'));
  if(!updated.length)throw invalid();
  const oldToken=tokenFrom(req);
  if(oldToken)checked(await db.from('admin_sessions').update({revoked_at:timestamp}).eq('session_token_hash',hashToken(oldToken)).is('revoked_at',null));
  const token=randomBytes(32).toString('base64url');
  checked(await db.from('admin_sessions').insert({account_id:account.id,session_token_hash:hashToken(token),created_at:timestamp,last_seen_at:timestamp,expires_at:new Date(now+TTL*1000).toISOString()}));
  res.setHeader('Set-Cookie',cookie(req,token,TTL,env));
  return {authenticated:true,label:account.label,role:account.role};
}
async function logout(db,req,res,{now=Date.now(),env=process.env}={}) {
  jsonBody(req,[]);
  res.setHeader('Set-Cookie',cookie(req,'',0,env));
  const token=tokenFrom(req);
  if(token)checked(await db.from('admin_sessions').update({revoked_at:new Date(now).toISOString()}).eq('session_token_hash',hashToken(token)).is('revoked_at',null));
  return {authenticated:false};
}
async function authRoute(db,req,res) {
  const action=req.query?.action??'';
  if(req.method==='GET'&&action===''){const identity=await session(db,req);return identity?{authenticated:true,label:identity.label,role:identity.role}:{authenticated:false};}
  if(req.method==='POST'&&action==='login')return login(db,req,res);
  if(req.method==='POST'&&action==='logout')return logout(db,req,res);
  throw new HttpError(400,'INVALID_ACTION','Choose a supported authentication action.');
}
module.exports={requireAdmin,session,login,logout,authRoute,verifyCode,hashToken,tokenFrom};
