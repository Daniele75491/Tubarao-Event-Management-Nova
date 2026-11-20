'use strict';
// Public presentation only; price, inventory, sales and deadlines come from the backend.
const TUBARAO_CONFIG = Object.freeze({
  instagram: '@casitatubarao',
  // The current schema has starts_at only. Do not reuse this end time for another date.
  eventClosing: Object.freeze({date:'2026-10-04',time:'22:30'}),
  followInstruction: 'Simulate the Instagram follow step to unlock demo tickets.'
});
(function(root) {
  let event = null, eventError = '', pending = null, refreshedAt = 0, clockOffset = 0;
  const listeners = new Set();
  const now = () => Date.now() + clockOffset;
  async function request(path, {body, eventId, method = body ? 'POST' : 'GET', timeout = 15000, download = false} = {}) {
    const headers = {};
    if (eventId) headers['X-Event-ID'] = eventId;
    if (body) headers['Content-Type'] = 'application/json';
    let response;
    try { response = await fetch(path,{method,headers,body:body ? JSON.stringify(body) : undefined,cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(timeout)}); }
    catch { throw new Error('Connection unavailable. Please try again.'); }
    const serverTime = Date.parse(response.headers.get('X-Server-Time'));
    if (Number.isFinite(serverTime)) clockOffset = serverTime - Date.now();
    if (download === 'pdf' && response.ok) {
      if (!/^application\/pdf(?:;|$)/i.test(response.headers.get('Content-Type') || '')) throw new Error('Guest list unavailable. Please try again.');
      const filename = /filename="([A-Za-z0-9_.-]+\.pdf)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || 'Tubarao_Guest_List.pdf';
      try { return {blob:await response.blob(),filename}; }
      catch { throw new Error('Guest list download interrupted. Please try again.'); }
    }
    if (download && response.ok) {
      if (!/^text\/csv(?:;|$)/i.test(response.headers.get('Content-Type') || '')) throw new Error('Backup unavailable. Please try again.');
      const filename = /filename="([A-Za-z0-9_.-]+\.csv)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || 'Tubarao_event_backup.csv';
      return {blob:await response.blob(),filename};
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('Service unavailable. Please try again.'); }
    if (!response.ok) {
      const error = new Error(data.message || 'Could not complete this request.');
      error.code = data.error; error.status = response.status; throw error;
    }
    const databaseTime = Date.parse(data.server_now);
    if (Number.isFinite(databaseTime)) clockOffset = databaseTime - Date.now();
    return data;
  }
  async function refreshEvent(force = false) {
    if (pending) return pending;
    if (!force && Date.now() - refreshedAt < 5000) return;
    refreshedAt = Date.now();
    pending = (async () => {
      try { event = await request('/api/event-state'); eventError = ''; }
      catch (error) { event = null; eventError = error.message; }
      finally { pending = null; listeners.forEach(render => render()); }
    })();
    return pending;
  }
  function watchEvent(render) {
    listeners.add(render); render(); refreshEvent();
    const refresh = () => { if (!document.hidden) refreshEvent(); };
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return setInterval(refresh,30000);
  }
  function followConfirmed() { try { return sessionStorage.getItem('tubarao_follow_confirmed') === '1'; } catch { return false; } }
  function setFollowConfirmed(value) { sessionStorage.setItem('tubarao_follow_confirmed',value ? '1' : '0'); }
  function euro(cents, compact = false) { const value = (cents / 100).toFixed(2); return '€' + (compact ? value.replace(/\.00$/,'') : value); }
  function eventDate(startsAt) {
    return startsAt ? new Date(startsAt).toLocaleDateString('en-GB',{timeZone:'Europe/Lisbon',weekday:'long',day:'numeric',month:'long',year:'numeric'}) : '';
  }
  function eventTime(startsAt) {
    if (!startsAt) return '';
    const date = new Date(startsAt), zone = {timeZone:'Europe/Lisbon'};
    const start = date.toLocaleTimeString('en-GB',{...zone,hour:'2-digit',minute:'2-digit'});
    const day = date.toLocaleDateString('en-CA',{...zone,year:'numeric',month:'2-digit',day:'2-digit'});
    return start + (day === TUBARAO_CONFIG.eventClosing.date ? ' – ' + TUBARAO_CONFIG.eventClosing.time : '');
  }
  function remaining(deadline) { return Math.max(0,Math.ceil((Date.parse(deadline) - now()) / 1000)) || 0; }
  function countdown(deadline) { const seconds = remaining(deadline); return String(Math.floor(seconds/60)).padStart(2,'0') + ':' + String(seconds%60).padStart(2,'0'); }
  root.Tubarao = {config:TUBARAO_CONFIG, request, refreshEvent, watchEvent, getEvent:()=>event, getEventError:()=>eventError,
    followConfirmed,setFollowConfirmed,euro,eventDate,eventTime,remaining,countdown,now};
})(window);
