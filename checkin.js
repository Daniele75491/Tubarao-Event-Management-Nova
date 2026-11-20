import QrScanner from './vendor/qr-scanner.min.js';

const $ = id => document.getElementById(id);
const attendance = TubaraoPresence.create({document,request:path=>request(path)});
let authorized = false, scanner, cameraRunning = false, cameraUsed = false;
let busy = false, awaitingNext = false, generation = 0, cameraGeneration = 0, searchGeneration = 0;
const checkinTime = value => new Date(value).toLocaleString('en-GB',{timeZone:'Europe/Lisbon',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}) + ' · Lisbon';
function stopCamera() {
  cameraGeneration++; cameraRunning = false; scanner?.stop();
  $('start-camera').disabled = false; $('start-camera').hidden = false; $('stop-camera').hidden = true;
}
function hideTools(message = 'Sign in to continue.') {
  attendance.stop();
  generation++; searchGeneration++; authorized = false; busy = false; awaitingNext = false;
  stopCamera(); scanner?.destroy(); scanner = null;
  $('account-label').textContent='';
  cameraUsed = false; $('camera-panel').hidden = false;
  $('checkin-panel').hidden = true; $('login-panel').hidden = false; $('scan-result').hidden = true;
  $('search-results').replaceChildren(); $('search-query').value = ''; $('event-name').textContent = '';
  ['result-title','result-name','result-category','result-time','result-detail'].forEach(id => $(id).textContent = '');
  $('auth-message').hidden = false; $('auth-message').textContent = message;
}
async function request(path,body) { return Tubarao.request(path,{body}); }
function accessError(error) {
  if (![401,403].includes(error.status)) return false;
  hideTools(error.status === 403 ? 'Admin access is required.' : 'Sign in to continue.'); return true;
}
async function authorize() {
  const current = generation;
  try {
    const identity=await request('/api/admin/auth');
    if(!identity.authenticated) { const error=new Error('Enter your access code to continue.');error.status=401;throw error; }
    const data = await request('/api/admin/check-in?q=');
    if (current !== generation) return;
    $('account-label').textContent=identity.label;
    authorized = true; $('event-name').textContent = data.event.name;
    $('login-panel').hidden = true; $('checkin-panel').hidden = false; $('auth-message').hidden = true; $('logout').hidden = false;
    attendance.start();
  } catch (error) { if (current === generation) hideTools(error.message); }
}
async function startCamera() {
  if (!authorized || busy || awaitingNext || cameraRunning || document.hidden) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $('camera-message').textContent = 'Camera unavailable. Use HTTPS in Safari or Chrome, or search by name or email below.'; return;
  }
  const current = ++cameraGeneration;
  $('start-camera').disabled = true; $('camera-message').textContent = 'Allow camera access to scan tickets.';
  try {
    if (!scanner) scanner = new QrScanner($('camera'), result => {
      if (cameraRunning) submitCheck('/api/admin/check-in',{qr_payload:result.data});
    },{preferredCamera:'environment',maxScansPerSecond:8,returnDetailedScanResult:true});
    const active = scanner;
    await active.start();
    if (current !== cameraGeneration || !authorized || awaitingNext || document.hidden) { active.stop(); return; }
    cameraRunning = true; cameraUsed = true;
    $('start-camera').hidden = true; $('stop-camera').hidden = false;
    $('camera-message').textContent = 'Hold the guest’s QR inside the frame.';
  } catch {
    if (current !== cameraGeneration) return;
    stopCamera(); $('camera-message').textContent = 'Camera could not open. Allow camera access in your browser settings, then try again. You can also search below.';
  } finally { if (current === cameraGeneration) $('start-camera').disabled = false; }
}
function showResult(data,error) {
  const state = error ? 'ERROR' : data.result;
  const states = {
    CHECKED_IN:['CHECKED IN','success',''],
    ALREADY_CHECKED_IN:['ALREADY CHECKED IN','warning','This ticket has already been used.'],
    INVALID:['INVALID TICKET','invalid','No valid paid ticket for this event.'],
    ERROR:['CHECK NOT COMPLETED','error','Connection or service unavailable. Do not admit yet. Scan again or search to verify the check-in.']
  };
  const [title,style,detail] = states[state] || states.ERROR;
  const known = !error && ['CHECKED_IN','ALREADY_CHECKED_IN'].includes(state);
  $('scan-result').className = 'scan-result ' + style;
  $('result-title').textContent = title;
  $('result-name').textContent = known ? data.first_name + ' ' + data.last_name : '';
  $('result-category').textContent = known ? data.category : '';
  $('result-time').textContent = known ? (state === 'ALREADY_CHECKED_IN' ? 'First check-in: ' : 'Checked in: ') + checkinTime(data.checked_in_at) : '';
  $('result-detail').textContent = detail;
  $('scan-result').hidden = false; $('camera-panel').hidden = true;
  $('scan-next').disabled = false; $('result-title').focus(); $('scan-result').scrollIntoView({block:'start'});
}
async function submitCheck(path,body) {
  // Latch synchronously, before any await; held until the result is acknowledged.
  if (!authorized || busy || awaitingNext) return;
  busy = true; awaitingNext = true; const current = generation;
  stopCamera(); $('search-results').replaceChildren(); searchGeneration++;
  $('scan-result').hidden = false; $('camera-panel').hidden = true; $('scan-result').className = 'scan-result';
  $('result-title').textContent = 'CHECKING…';
  ['result-name','result-category','result-time','result-detail'].forEach(id => $(id).textContent = '');
  $('scan-next').disabled = true;
  try {
    const data = await request(path,body);
    if (current === generation) {
      showResult(data);
      if (['CHECKED_IN','ALREADY_CHECKED_IN'].includes(data.result)) void attendance.refresh(true);
    }
  } catch (error) {
    if (current === generation && !accessError(error)) showResult(null,error);
  } finally { if (current === generation) busy = false; }
}
function renderSearch(data) {
  $('search-results').replaceChildren();
  $('event-name').textContent = data.event.name;
  $('search-message').textContent = data.more ? 'First 30 matches. Refine your search.' : data.attendees.length ? 'Match the guest’s name and category before check-in.' : 'No matching guests.';
  for (const row of data.attendees) {
    const item = document.createElement('li'), name = document.createElement('strong'), email = document.createElement('p'), status = document.createElement('p');
    name.textContent = row.first_name + ' ' + row.last_name; email.textContent = row.email;
    status.textContent = row.category + ' · ' + row.status.replaceAll('_',' ') + (row.checked_in_at ? ' · CHECKED IN — ' + checkinTime(row.checked_in_at) : ' · NOT CHECKED IN');
    item.append(name,email,status);
    if (row.status === 'PAID' && !row.checked_in_at) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn secondary'; button.textContent = 'CHECK IN';
      button.setAttribute('aria-label','Check in ' + row.first_name + ' ' + row.last_name);
      button.disabled = busy || awaitingNext;
      button.onclick = () => submitCheck('/api/admin/check-in?action=manual',{reservation_id:row.reservation_id}); item.appendChild(button);
    }
    $('search-results').appendChild(item);
  }
}
async function search(event) {
  event?.preventDefault(); if (!authorized || busy || awaitingNext) return;
  stopCamera(); const current = generation, queryId = ++searchGeneration;
  $('search-results').replaceChildren(); $('search-message').textContent = 'Searching…';
  try {
    const data = await request('/api/admin/check-in?q=' + encodeURIComponent($('search-query').value.trim()));
    if (current === generation && queryId === searchGeneration) renderSearch(data);
  } catch (error) { if (current === generation && queryId === searchGeneration && !accessError(error)) $('search-message').textContent = error.message; }
}
$('start-camera').onclick = startCamera;
$('stop-camera').onclick = () => { stopCamera(); $('camera-message').textContent = 'Camera stopped. Open it again when ready.'; };
$('use-search').onclick = () => { stopCamera(); $('search-query').focus(); };
$('scan-next').onclick = () => {
  if (busy || !authorized) return;
  awaitingNext = false; $('scan-result').hidden = true; $('camera-panel').hidden = false;
  $('search-message').textContent = 'Search paid guests if the camera or QR isn’t available.';
  if (cameraUsed) startCamera(); else $('search-query').focus();
};
$('search-form').addEventListener('submit',search);
$('search-query').addEventListener('input',() => { searchGeneration++; $('search-results').replaceChildren(); });
$('login-form').addEventListener('submit',async event => {
  event.preventDefault(); const current=++generation;
  const code=$('access-code').value.trim();$('access-code').value='';
  $('login').disabled=true;$('auth-message').hidden=false;$('auth-message').textContent='Checking access…';
  try {await request('/api/admin/auth?action=login',{code});if(current===generation){$('logout').hidden=false;await authorize();}}
  catch(error){if(current===generation)$('auth-message').textContent=error.message;}
  finally{$('login').disabled=false;}
});
$('logout').onclick = async () => {
  hideTools('Signing out…');
  try{await request('/api/admin/auth?action=logout',{});$('logout').hidden=true;$('auth-message').textContent='Signed out.';}
  catch{$('logout').hidden=false;$('auth-message').textContent='Sign-out could not finish. Tap LOGOUT to retry.';}
};
document.addEventListener('visibilitychange',() => { if (document.hidden) stopCamera(); attendance.visibilityChanged(); });
window.addEventListener('pagehide',() => { stopCamera(); attendance.stop(); });
window.addEventListener('pageshow',() => { if (authorized) attendance.start(); });
authorize();
