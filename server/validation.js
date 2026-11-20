'use strict';
const {HttpError, jsonBody} = require('./http');
const invalid = () => new HttpError(400, 'INVALID_INPUT', 'Check your details and try again.');

function name(value) {
  if (typeof value !== 'string') throw invalid();
  const result = value.trim();
  if (!result || result.length > 100 || /[\u0000-\u001f\u007f]/.test(result)) throw invalid();
  return result;
}
function email(value) {
  if (typeof value !== 'string') throw invalid();
  const result = value.trim().toLowerCase();
  if (result.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) || /[\u0000-\u001f\u007f]/.test(result)) throw invalid();
  return result;
}
function reservationId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw invalid();
  return value;
}
function reservationInput(req) {
  const body = jsonBody(req, ['first_name', 'last_name', 'email', 'category']);
  if (!['MEN', 'WOMEN'].includes(body.category)) throw invalid();
  return {first_name:name(body.first_name), last_name:name(body.last_name), email:email(body.email), category:body.category};
}
function claimInput(req) {
  const body = jsonBody(req, ['reservation_id', 'email']);
  return {reservation_id:reservationId(body.reservation_id), email:email(body.email)};
}
function reviewInput(req) {
  const body = jsonBody(req, ['reservation_id']);
  return {reservation_id:reservationId(body.reservation_id)};
}
module.exports = {reservationInput, claimInput, reviewInput, reservationId};
