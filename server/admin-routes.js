'use strict';
const {HttpError} = require('./http');
const events = require('./events');
const backend = require('./backend');
const checkin = require('./checkin');
const {changeCategory}=require('./category-correction');
const {adjustAmount}=require('./amount-adjustment');
const {eventBackup} = require('./event-backup');
const {deleteReservation,deletePaidTicket} = require('./reservation-deletion');

// Routing only: existing handlers retain their own authentication, role checks,
// strict body validation, RPCs and response shapes. Never infer actions from bodies.
function dispatch(db,req,routes) {
  const action = req.query?.action ?? '';
  const key = req.method + ':' + action;
  if (typeof action !== 'string' || !Object.hasOwn(routes,key)) {
    throw new HttpError(400,'INVALID_ACTION','Choose a supported action for this request method.');
  }
  return routes[key](db,req);
}
function eventRoutes(db,req) {
  return dispatch(db,req,{
    'GET:':events.listEvents,
    'GET:backup':eventBackup,
    'GET:guest-list-pdf':(db,req)=>require('./guest-list-pdf').eventGuestList(db,req),
    'PATCH:':events.updateEvent,
    'POST:':events.createEvent,
    'POST:activate':events.activateEvent
  });
}
function paymentRoutes(db,req) {
  return dispatch(db,req,{
    'GET:ticket-qr':backend.downloadTicketQr,
    'POST:confirm-payment':(db,req)=>backend.review(db,req,'confirm_payment'),
    'POST:confirm-external-payment':(db,req)=>backend.review(db,req,'confirm_external_payment'),
    'POST:reject-payment':(db,req)=>backend.review(db,req,'reject_payment'),
    'POST:resend-ticket':backend.resendTicket,
    'POST:change-category':changeCategory,
    'POST:adjust-amount':adjustAmount,
    'POST:delete-record':deleteReservation,
    'POST:delete-paid-ticket':deletePaidTicket
  });
}
function checkinRoutes(db,req) {
  return dispatch(db,req,{
    'GET:':checkin.searchAttendees,
    'GET:presence':checkin.presence,
    'POST:':(db,req)=>checkin.checkIn(db,req),
    'POST:manual':(db,req)=>checkin.checkIn(db,req,true)
  });
}
module.exports = {eventRoutes,paymentRoutes,checkinRoutes};
