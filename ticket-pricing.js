'use strict';
(function(){
  const $=id=>document.getElementById(id);
  let requestedDeadline=null;
  function tick(){
    const pricing=Tubarao.getEvent()?.pricing, deadline=pricing?.early_price_ends_at;
    if(!deadline || pricing.phase!=='EARLY')return;
    const seconds=Tubarao.remaining(deadline);
    const parts=[Math.floor(seconds/86400),Math.floor(seconds/3600)%24,Math.floor(seconds/60)%60,seconds%60];
    $('price-countdown').textContent=parts.map((value,i)=>String(value).padStart(2,'0')+['D','H','M','S'][i]).join(' : ');
    if(seconds===0){
      $('pricing-message').textContent='Updating ticket price… Your price is locked when you reserve.';
      // One immediate refresh per deadline. Normal polling handles failure/retry.
      if(requestedDeadline!==deadline){requestedDeadline=deadline;Tubarao.refreshEvent(true);}
    }
  }
  function render(){
    const pricing=Tubarao.getEvent()?.pricing;
    $('pricing-heading').textContent=pricing?pricing.phase+' TICKETS':'TICKETS';
    $('current-price').textContent=pricing?Tubarao.euro(pricing.current_price_cents,true):'—';
    $('price-countdown-panel').hidden=!(pricing?.phase==='EARLY'&&pricing.show_countdown===true&&pricing.early_price_ends_at);
    $('next-price').hidden=!(pricing?.phase==='EARLY');
    $('next-price-label').textContent=pricing?.phase==='EARLY'?'LATE TICKETS'+(pricing.show_late_price===true&&Number.isInteger(pricing.next_price_cents)?' · '+Tubarao.euro(pricing.next_price_cents,true):''):'';
    $('price-countdown-label').textContent=pricing?.next_price_cents>pricing?.current_price_cents?'PRICE INCREASES IN':'PRICE CHANGES IN';
    $('price-deadline').textContent=pricing?.early_price_ends_at?'Until '+new Date(pricing.early_price_ends_at).toLocaleString('en-GB',{timeZone:'Europe/Lisbon'})+' (Lisbon)':'';
    $('pricing-message').textContent=Tubarao.getEventError();
    tick();
  }
  Tubarao.watchEvent(render);
  setInterval(()=>{if(!document.hidden)tick();},1000);
})();
