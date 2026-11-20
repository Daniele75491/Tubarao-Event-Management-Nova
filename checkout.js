'use strict';
let type = new URLSearchParams(location.search).get('type');
const $ = id => document.getElementById(id);
const cacheKey = 'tubarao_reservation_recovery';
const legacyKey = 'tubarao_live_checkout_' + type;
let order = null, verified = false, busy = false, refreshing = false, lastRefresh = 0;
function clearRecovery() {
  try { localStorage.removeItem(cacheKey); } catch {}
  try { sessionStorage.removeItem(legacyKey); } catch {}
}
try {
  const saved = JSON.parse(localStorage.getItem(cacheKey) || sessionStorage.getItem(legacyKey));
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved?.reservation_id)
    && typeof saved.email === 'string' && saved.email.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(saved.email)) {
    order = {reservation_id:saved.reservation_id,email:saved.email.trim().toLowerCase()};
  } else clearRecovery();
} catch { clearRecovery(); }
function checkEntry() {
  if (!order && (!['women','men'].includes(type) || !Tubarao.followConfirmed())) location.replace('index.html#follow-gate');
}
checkEntry();
function saveOrder() {
  if (!['RESERVED','PAYMENT_CLAIMED','PAID'].includes(order?.status)) { clearRecovery(); return; }
  try {
    localStorage.setItem(cacheKey,JSON.stringify({reservation_id:order.reservation_id,email:order.email}));
    sessionStorage.removeItem(legacyKey);
  }
  catch { $('order-error').textContent = 'This browser cannot save your reservation. Keep this page open.'; }
}
function render() {
  const event = Tubarao.getEvent();
  $('kind').textContent = type + ' ticket';
  $('event-name').textContent = event?.name || 'TUBARÃO';
  $('event-details').textContent = [Tubarao.eventDate(event?.starts_at),Tubarao.eventTime(event?.starts_at)].filter(Boolean).join(' · ');
  $('form').hidden = Boolean(order); $('order-panel').hidden = !order;
  $('availability').hidden = Boolean(order);
  $('state-message').hidden = !Tubarao.getEventError() || Boolean(order);
  $('state-message').textContent = Tubarao.getEventError();
  if (!order) {
    const status = event?.[type + '_status'];
    $('price').textContent = event ? Tubarao.euro(event.ticket_price_cents,true) : '—';
    $('availability').textContent = event && event.sales_status !== 'OPEN' ? 'TICKETS NOT CURRENTLY AVAILABLE' : status ? status.replaceAll('_',' ') : 'LOADING';
    // Even closed/full sales must allow identity-based recovery. The server alone
    // decides whether a new reservation may be created.
    $('pay').disabled = busy || !event || !['women','men'].includes(type) || !Tubarao.followConfirmed();
    return;
  }
  $('price').textContent = verified ? Tubarao.euro(order.amount_cents,true) : '—';
  let status = verified ? order.status : 'CHECKING';
  if (status === 'RESERVED' && !Tubarao.remaining(order.reserved_until)) status = 'EXPIRED';
  if (status === 'PAYMENT_CLAIMED' && order.claim_expires_at && !Tubarao.remaining(order.claim_expires_at)) status = 'EXPIRED';
  const minutes = event?.reservation_minutes;
  const copy = {
    CHECKING:['CHECKING YOUR RESERVATION','Please wait while we retrieve your order.',''],
    RESERVED:['YOUR SPOT IS RESERVED',Number.isInteger(minutes) && minutes > 0 ? `Complete your payment within ${minutes} minutes.` : 'Complete your payment before the countdown ends.',''],
    PAYMENT_CLAIMED:['DEMO PAYMENT CLAIMED','Your claim is awaiting admin review.','The demo QR becomes available to the admin after confirmation and issuance.'],
    PAID:['DEMO PAYMENT CONFIRMED','The admin confirmed your simulated payment.','Ask the classroom event admin for your demo QR.'],
    EXPIRED:['RESERVATION EXPIRED','Your payment window has ended.','Start again to check availability.'],
    REJECTED:['PAYMENT REJECTED','Your payment claim was rejected.','No ticket has been issued.'],
    CANCELLED:['RESERVATION CANCELLED','This reservation is no longer active.','No ticket has been issued.']
  }[status] || ['ORDER UNAVAILABLE','Please try again.',''];
  ['order-heading','order-copy','order-detail'].forEach((id,i) => $(id).textContent = copy[i]);
  $('order-panel').setAttribute('data-state',status);
  const reserved = status === 'RESERVED';
  $('countdown').hidden = !reserved;
  $('countdown').textContent = Tubarao.countdown(order.reserved_until);
  $('claim-payment').hidden = !reserved;
  $('claim-payment').disabled = !reserved || busy || refreshing;
  $('claim-payment').textContent = reserved ? 'SIMULATE ' + Tubarao.euro(order.amount_cents) + ' & CLAIM' : 'SIMULATE PAYMENT & CLAIM';
  $('payment-note').hidden = !reserved;
  $('restart').hidden = !['EXPIRED','REJECTED','CANCELLED'].includes(status);
  $('restart').href = 'checkout.html?type=' + type;
}
async function refreshOrder(force = false, recovery = false) {
  if (!order || refreshing || busy || (!force && Date.now()-lastRefresh < 10000)) return;
  refreshing = true; lastRefresh = Date.now(); render();
  try {
    const result = await Tubarao.request('/api/reservation-state',{body:{reservation_id:order.reservation_id,email:order.email}});
    order = {...result,email:order.email}; verified = true; $('order-error').textContent = '';
    if (['MEN','WOMEN'].includes(result.category)) type = result.category.toLowerCase();
    saveOrder();
    if (recovery && !['RESERVED','PAYMENT_CLAIMED','PAID'].includes(result.status)) { order = null; checkEntry(); }
  } catch (error) {
    verified = false; $('order-error').textContent = error.message;
    if (['RESERVATION_NOT_FOUND','INVALID_INPUT'].includes(error.code)) { order = null; clearRecovery(); checkEntry(); $('form-error').textContent = error.message; }
  } finally { refreshing = false; render(); }
}
function validate() {
  let firstInvalid;
  ['first','last','email','category-confirm'].forEach(id => {
    const input = $(id);
    const valid = id === 'category-confirm' ? input.checked : input.value.trim() && input.checkValidity();
    const error = valid ? '' : id === 'category-confirm' ? 'Confirm that you selected the correct ticket category.' : 'Please enter a valid ' + (id === 'first' ? 'first name.' : id === 'last' ? 'last name.' : 'email.');
    $(id + '-error').textContent = error; input.setAttribute('aria-invalid',String(!valid));
    if (!valid && !firstInvalid) firstInvalid = input;
  });
  firstInvalid?.focus(); return !firstInvalid;
}
$('form').addEventListener('submit',async event => {
  event.preventDefault();
  render(); // Recheck the latest server sales state before accepting submission.
  if (busy || order || $('pay').disabled || !validate()) return;
  busy = true; render(); $('form-error').textContent = '';
  const email = $('email').value.trim().toLowerCase();
  try {
    const result = await Tubarao.request('/api/reserve',{body:{first_name:$('first').value.trim(),last_name:$('last').value.trim(),email,category:type.toUpperCase()}});
    order = {...result,email}; verified = true; saveOrder();
    Tubarao.refreshEvent(true); render(); $('order-heading').focus();
  } catch (error) { $('form-error').textContent = error.message; Tubarao.refreshEvent(true); }
  finally { busy = false; render(); }
});
$('claim-payment').onclick = async () => {
  if (busy || refreshing || !verified || order?.status !== 'RESERVED' || !Tubarao.remaining(order.reserved_until)) return;
  busy = true; render(); $('order-error').textContent = '';
  try {
    const result = await Tubarao.request('/api/claim-payment',{body:{reservation_id:order.reservation_id,email:order.email}});
    order = {...order,...result}; verified = true; saveOrder(); render(); $('order-heading').focus();
  } catch (error) { $('order-error').textContent = error.message; }
  finally { busy = false; render(); }
};
$('restart').onclick = clearRecovery;
Tubarao.watchEvent(render); refreshOrder(true,true);
setInterval(render,1000);
setInterval(() => { if (!document.hidden) refreshOrder(); },30000);
window.addEventListener('focus',()=>refreshOrder());
document.addEventListener('visibilitychange',()=>{ if (!document.hidden) refreshOrder(); });
