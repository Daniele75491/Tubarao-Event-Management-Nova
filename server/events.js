'use strict';
const {HttpError,jsonBody} = require('./http');
const {requireAdmin,currentEvent,dbResult,allRows} = require('./backend');
const FIELDS = ['name','starts_at','physical_capacity','men_paid_cap','early_price_cents','late_price_cents','early_price_ends_at','pricing_mode','show_pricing_countdown','show_late_price_before_start','reservation_minutes','claim_hold_hours','sales_mode','sales_open_at','sales_close_at'];
const defaults = {starts_at:null,physical_capacity:120,men_paid_cap:45,early_price_cents:800,late_price_cents:1200,early_price_ends_at:null,pricing_mode:'AUTO',show_pricing_countdown:false,show_late_price_before_start:false,reservation_minutes:15,claim_hold_hours:24,sales_mode:'CLOSED',sales_open_at:null,sales_close_at:null};
const invalid = message => new HttpError(400,'INVALID_INPUT',message);
function uuid(value) { if (typeof value !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) throw invalid('Invalid record ID.'); return value; }
function eventInput(req,base=defaults) {
  const input = jsonBody(req,FIELDS);
  if (!Object.keys(input).length) throw invalid('Enter event settings.');
  for (const key of ['show_pricing_countdown','show_late_price_before_start']) {
    if (key in input && typeof input[key] !== 'boolean') throw invalid('Display settings must be booleans.');
  }
  const event = {...base,...input};
  if (typeof event.name !== 'string' || !event.name.trim() || event.name.trim().length>120 || /[\x00-\x1f\x7f]/.test(event.name)) throw invalid('Enter an event name up to 120 characters.');
  if ('name' in input) input.name=event.name.trim();
  for(const key of ['physical_capacity','men_paid_cap','reservation_minutes','claim_hold_hours']) {
    if (!Number.isInteger(event[key]) || event[key] < (['physical_capacity','reservation_minutes','claim_hold_hours'].includes(key)?1:0) || event[key]>2147483647) throw invalid('Check the numeric event settings.');
  }
  for(const key of ['early_price_cents','late_price_cents']) {
    if (!Number.isInteger(event[key]) || event[key]<1 || event[key]>100000) throw invalid('Ticket prices must be between €0.01 and €1,000.00.');
  }
  if (!['AUTO','EARLY','LATE'].includes(event.pricing_mode)) throw invalid('Choose AUTO, EARLY or LATE pricing.');
  if (event.men_paid_cap>event.physical_capacity) throw invalid('MEN paid cap cannot exceed physical capacity.');
  if (!['OPEN','CLOSED','SCHEDULED'].includes(event.sales_mode)) throw invalid('Choose OPEN, CLOSED or SCHEDULED.');
  for(const key of ['starts_at','sales_open_at','sales_close_at','early_price_ends_at']) {
    const value=event[key];
    if(value!==null && (typeof value!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))) throw invalid('Use valid date/time values with a timezone.');
    if(value!==null){const [year,month,day]=value.slice(0,10).split('-').map(Number);const date=new Date(0);date.setUTCFullYear(year,month-1,day);if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw invalid('Enter a valid calendar date.');}
  }
  if(event.sales_mode==='SCHEDULED'&&!event.sales_open_at)throw invalid('Scheduled sales require an opening time.');
  if(event.sales_open_at&&event.sales_close_at&&Date.parse(event.sales_close_at)<=Date.parse(event.sales_open_at))throw invalid('Sales closing time must be after opening time.');
  return input;
}
function result(response) {
  const messages={CAPACITY_TOO_LOW:'Physical capacity cannot be below occupied places.',MEN_CAP_TOO_LOW:'MEN paid cap cannot be below active MEN reservations.',EVENT_FULL:'No physical capacity is available.',EVENT_CHANGED:'The active event changed. Refresh before making changes.',ATTENDEE_NOT_FOUND:'Attendee not found in this event.',EVENT_NOT_FOUND:'Event not found.',INVALID_EVENT:'Check the event settings.',FORBIDDEN:'This action requires the appropriate admin role.'};
  if(response.error){const code=response.error.message;if(messages[code])throw new HttpError(code==='FORBIDDEN'?403:409,code,messages[code]);if(response.error.code==='PGRST202')throw new HttpError(503,'SETUP_REQUIRED','Event management database setup is required.');}
  return dbResult(response);
}
async function active(db,req) {
  const event=await currentEvent(db);
  if(req.headers['x-event-id'] && req.headers['x-event-id']!==event.id)throw new HttpError(409,'EVENT_CHANGED','The active event changed. Refresh before making changes.');
  return event;
}
async function updateEvent(db,req) {
  const admin=await requireAdmin(db,req),event=await active(db,req),patch=eventInput(req,event);
  return {event:result(await db.rpc('admin_update_event',{p_event_id:event.id,p_patch:patch,p_admin_id:admin.account_id}))};
}
async function listEvents(db,req) {
  const admin=await requireAdmin(db,req),events=[];
  for(let offset=0;;offset+=500){const rows=dbResult(await db.from('events').select('id,name,starts_at,is_active,sales_mode,created_at').order('created_at',{ascending:false}).order('id').range(offset,offset+499));events.push(...rows);if(rows.length<500)break;}
  return {admin,events};
}
async function createEvent(db,req) {
  const admin=await requireAdmin(db,req);
  if(admin.role!=='SUPER_ADMIN')throw new HttpError(403,'FORBIDDEN','Only SUPER_ADMIN can create events.');
  const patch=eventInput(req);
  return {event:result(await db.rpc('admin_create_event',{p_values:{...defaults,...patch},p_admin_id:admin.account_id}))};
}
async function activateEvent(db,req) {
  const admin=await requireAdmin(db,req);
  if(admin.role!=='SUPER_ADMIN')throw new HttpError(403,'FORBIDDEN','Only SUPER_ADMIN can activate events.');
  const {event_id}=jsonBody(req,['event_id']);
  return {event:result(await db.rpc('admin_activate_event',{p_event_id:uuid(event_id),p_admin_id:admin.account_id}))};
}
async function nonPaying(db,req) {
  const admin=await requireAdmin(db,req),event=await active(db,req);
  if(req.method==='GET')return {event_id:event.id,attendees:await allRows(db,'non_paying_attendees','id,first_name,last_name,email,category,checked_in_at',event.id)};
  if(req.method==='DELETE'){
    const {attendee_id}=jsonBody(req,['attendee_id']);
    return result(await db.rpc('admin_remove_non_paying',{p_event_id:event.id,p_attendee_id:uuid(attendee_id),p_admin_id:admin.account_id}));
  }
  const body=jsonBody(req,['first_name','last_name','email','category']);
  for(const key of ['first_name','last_name']){if(typeof body[key]!=='string'||!body[key].trim()||body[key].length>100||/[\x00-\x1f\x7f]/.test(body[key]))throw invalid('Enter first and last name.');body[key]=body[key].trim();}
  if(!['MEN','WOMEN'].includes(body.category))throw invalid('Select MEN or WOMEN.');
  body.email=body.email==null||body.email===''?null:body.email;
  if(body.email!==null){if(typeof body.email!=='string'||body.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))throw invalid('Enter a valid email or leave it blank.');body.email=body.email.trim().toLowerCase();}
  return {attendee:result(await db.rpc('admin_add_non_paying',{p_event_id:event.id,p_values:body,p_admin_id:admin.account_id}))};
}
module.exports={eventInput,updateEvent,listEvents,createEvent,activateEvent,nonPaying};
