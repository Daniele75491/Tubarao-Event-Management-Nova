'use strict';
const {createHash} = require('node:crypto');
const {HttpError,jsonBody} = require('./http');
const {reviewInput} = require('./validation');
const {requireAdmin,currentEvent,allRows,dbResult} = require('./backend');
const SEARCH_FIELDS = 'id,first_name,last_name,email,category,status,checked_in_at';

function parsePayload(payload) {
  // Version-one tickets contain exactly one opaque 32-byte base64url token.
  const match = typeof payload === 'string' && /^TUBARAO:([A-Za-z0-9_-]{43})$/.exec(payload);
  return match ? match[1] : null;
}
function checkinResult(data) {
  if (data?.result === 'INVALID') return {result:'INVALID'};
  if (!['CHECKED_IN','ALREADY_CHECKED_IN'].includes(data?.result)
    || typeof data.first_name !== 'string' || typeof data.last_name !== 'string'
    || !['MEN','WOMEN'].includes(data.category) || typeof data.checked_in_at !== 'string'
    || !Number.isFinite(Date.parse(data.checked_in_at))) throw new Error('Invalid check-in response.');
  return {result:data.result,first_name:data.first_name,last_name:data.last_name,category:data.category,checked_in_at:data.checked_in_at};
}
async function checkIn(db,req,manual = false) {
  const admin = await requireAdmin(db,req,['SUPER_ADMIN','ADMIN']);
  let key, value;
  if (manual) { key = 'id'; value = reviewInput(req).reservation_id; }
  else {
    const {qr_payload} = jsonBody(req,['qr_payload']);
    const token = parsePayload(qr_payload);
    if (!token) return {result:'INVALID'};
    key = 'qr_token_hash'; value = createHash('sha256').update(token).digest('hex');
  }
  const event = await currentEvent(db);
  // Refuse old-event tickets and unpaid reservations before calling the atomic RPC.
  // The RPC must recheck PAID and unused status under its database lock.
  const row = dbResult(await db.from('reservations').select('id,status').eq(key,value).eq('event_id',event.id).maybeSingle());
  if (!row || row.status !== 'PAID') return {result:'INVALID'};
  const args = manual ? {p_reservation_id:row.id,p_admin_id:admin.account_id} : {p_qr_token_hash:value,p_admin_id:admin.account_id};
  return checkinResult(dbResult(await db.rpc(manual ? 'check_in_reservation' : 'check_in_ticket',args)));
}
async function searchAttendees(db,req) {
  await requireAdmin(db,req,['SUPER_ADMIN','ADMIN']);
  const q = req.query?.q ?? '';
  if (typeof q !== 'string' || q.length > 100 || /[\u0000-\u001f\u007f]/.test(q)) throw new HttpError(400,'INVALID_INPUT','Use up to 100 characters to search.');
  const event = await currentEvent(db), search = q.trim().toLocaleLowerCase('en');
  // Literal matching avoids interpolating user text into a PostgREST filter expression.
  // All pages are read server-side; only a bounded matching projection is returned.
  const rows = search ? await allRows(db,'reservations',SEARCH_FIELDS,event.id) : [];
  const matches = rows.filter(row => [row.first_name,row.last_name,row.email,row.first_name+' '+row.last_name].some(value => String(value).toLocaleLowerCase('en').includes(search)));
  return {event:{id:event.id,name:event.name},attendees:matches.slice(0,30).map(row => ({reservation_id:row.id,first_name:row.first_name,last_name:row.last_name,email:row.email,category:row.category,status:row.status,checked_in_at:row.checked_in_at})),more:matches.length>30};
}
async function presence(db,req) {
  await requireAdmin(db,req,['SUPER_ADMIN','ADMIN']);
  const event = await currentEvent(db);
  async function arrived(table,paid) {
    const rows=[];
    for(let offset=0;;offset+=500){
      let query=db.from(table).select('first_name,last_name,category,checked_in_at').eq('event_id',event.id).not('checked_in_at','is',null);
      if(paid)query=query.eq('status','PAID');
      const page=dbResult(await query.order('id').range(offset,offset+499));rows.push(...page);
      if(page.length<500)return rows.map(row=>({firstName:row.first_name,lastName:row.last_name,category:row.category,type:paid?'PAID':'NON-PAYING',checkedInAt:row.checked_in_at}));
    }
  }
  const [paid,nonPaying]=await Promise.all([arrived('reservations',true),arrived('non_paying_attendees',false)]);
  const attendees=[...paid,...nonPaying],total=attendees.length;
  const men=attendees.filter(row=>row.category==='MEN').length,women=attendees.filter(row=>row.category==='WOMEN').length;
  return {generatedAt:new Date().toISOString(),stats:{total,men,women,menPercentage:total?Math.round(men/total*1000)/10:0,womenPercentage:total?Math.round(women/total*1000)/10:0},attendees};
}
module.exports = {parsePayload,checkinResult,checkIn,searchAttendees,presence};
