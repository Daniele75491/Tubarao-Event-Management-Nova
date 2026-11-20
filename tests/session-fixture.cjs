const {randomBytes}=require('node:crypto');
const token=randomBytes(32).toString('base64url');
const headers={cookie:'tubarao_admin_session='+token};
function sessionRow(role='SUPER_ADMIN',id='admin-user') {return {id:'session',account_id:id,expires_at:new Date(Date.now()+43200000).toISOString(),revoked_at:null,last_seen_at:new Date().toISOString(),account:role?{id,label:role==='SUPER_ADMIN'?'SUPER ADMIN':'DOOR 1',role,is_active:true}:null};}
module.exports={token,headers,sessionRow};
