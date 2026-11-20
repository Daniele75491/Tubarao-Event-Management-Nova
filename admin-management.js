'use strict';
(function(root){
  const $=id=>document.getElementById(id);
  const fields=[['name','Event name','text'],['starts_at','Event date/time','datetime-local'],['physical_capacity','Physical capacity','number'],['men_paid_cap','MEN paid cap','number'],['early_price_cents','EARLY TICKET PRICE (€)','number'],['late_price_cents','LATE TICKET PRICE (€)','number'],['early_price_ends_at','EARLY PRICE ENDS AT','datetime-local'],['pricing_mode','PRICING MODE','select'],['show_pricing_countdown','SHOW COUNTDOWN','checkbox'],['show_late_price_before_start','SHOW LATE PRICE','checkbox'],['reservation_minutes','Reservation duration (minutes)','number'],['claim_hold_hours','Payment-claim hold (hours)','number'],['sales_mode','Sales mode','select'],['sales_open_at','Sales open','datetime-local'],['sales_close_at','Sales close','datetime-local']];
  const defaults={name:'',starts_at:null,physical_capacity:120,men_paid_cap:45,early_price_cents:800,late_price_cents:1200,early_price_ends_at:null,pricing_mode:'AUTO',show_pricing_countdown:false,show_late_price_before_start:false,reservation_minutes:15,claim_hold_hours:24,sales_mode:'CLOSED',sales_open_at:null,sales_close_at:null};
  let api,data,dirty=false,editingId=null,epoch=0,busy=false,listVersion=0;
  const localDate=value=>{if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  const displayDate=value=>value?new Date(value).toLocaleString():'Date not set';
  function notice(text){$('management-message').textContent=text;$('management-message').hidden=false;}
  function schedule(prefix){const enabled=$(prefix+'sales_mode').value==='SCHEDULED';for(const key of ['sales_open_at','sales_close_at']){$(prefix+key).disabled=!enabled;$(prefix+key).parentElement.hidden=!enabled;}}
  const priceKey = key => ['early_price_cents','late_price_cents'].includes(key);
  function euroToCents(raw) {
    if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/.test(raw)) throw new Error('Invalid price.');
    const [whole,fraction=''] = raw.split('.');
    const cents = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
    if (cents<1 || cents>100000) throw new Error('Invalid price.');
    return cents;
  }
  function confirmPricing(value,previous='AUTO') {
    return value.pricing_mode==='AUTO' || value.pricing_mode===previous || confirm('Force '+value.pricing_mode+' pricing at €'+(value[value.pricing_mode==='EARLY'?'early_price_cents':'late_price_cents']/100).toFixed(2)+' for all new reservations?');
  }
  function makeForm(container,prefix,event){
    $(container).replaceChildren();
    for(const [key,label,type]of fields){const field=document.createElement('div'),caption=document.createElement('label'),input=document.createElement(type==='select'?'select':'input');field.className='field';caption.textContent=label;caption.htmlFor=prefix+key;input.id=prefix+key;input.name=key;
      if(key==='early_price_cents'){const heading=document.createElement('h3');heading.className='pricing-settings-heading';heading.textContent='TICKET PRICING';$(container).appendChild(heading);}
      if(type==='select'){for(const value of key==='pricing_mode'?['AUTO','EARLY','LATE']:['OPEN','CLOSED','SCHEDULED']){const option=document.createElement('option');option.value=value;option.textContent=key==='pricing_mode'&&value!=='AUTO'?'FORCE '+value:value;input.appendChild(option);}}
      else input.type=type;
      input.value=type==='datetime-local'?localDate(event[key]):priceKey(key)?(event[key]/100).toFixed(2):event[key];
      if(type==='number'){input.min=priceKey(key)?'0.01':key==='men_paid_cap'?'0':'1';if(priceKey(key))input.max='1000';input.step=priceKey(key)?'0.01':'1';}
      if(key==='name')input.maxLength=120;
      if(type==='checkbox'){input.checked=event[key]===true;field.className+=' pricing-display-control';}
      input.required=type!=='checkbox'&&!['starts_at','sales_open_at','sales_close_at','early_price_ends_at'].includes(key);
      field.append(caption,input);$(container).appendChild(field);
    }
    $(prefix+'sales_mode').addEventListener('change',()=>schedule(prefix));schedule(prefix);
  }
  function values(prefix){const value={};for(const [key,,type]of fields){const raw=$(prefix+key).value;value[key]=type==='checkbox'?$(prefix+key).checked:type==='datetime-local'?(raw?new Date(raw).toISOString():null):type==='number'?(priceKey(key)?euroToCents(raw):Number(raw)):raw.trim();}return value;}
  function buttons(disabled){document.querySelectorAll('#event-edit-form button,#event-create-form button,#event-list button,#non-paying-form button,#non-paying-list button').forEach(button=>button.disabled=disabled);}
  async function mutate(path,body,method='POST',done){
    if(busy||!data)return;busy=true;buttons(true);const current=epoch,eventId=editingId;notice('Saving…');
    try{await api.request(path,body,{method,eventId});if(current!==epoch)return;done?.();if((path==='/api/admin/events'&&method==='PATCH')||path.endsWith('?action=activate'))dirty=false;notice('Saved.');await api.refresh();}
    catch(error){if(current===epoch)notice(error.message);}
    finally{if(current===epoch){busy=false;buttons(false);}}
  }
  async function eventList(){const current=epoch,version=++listVersion;
    try{const result=await api.request('/api/admin/events');if(current!==epoch||version!==listVersion)return;$('event-list').replaceChildren();
      $('create-event-panel').hidden=result.admin.role!=='SUPER_ADMIN';
      // Keep the endpoint's newest-created-first order. The dashboard event is
      // authoritative for the active card; never repeat it in the inactive list.
      const inactive=result.events.filter(event=>!event.is_active&&event.id!==editingId);
      $('other-event-count').textContent=String(inactive.length);
      for(const event of inactive){const item=document.createElement('li'),name=document.createElement('strong'),detail=document.createElement('p');name.textContent=event.name;detail.textContent=displayDate(event.starts_at)+' · INACTIVE · '+event.sales_mode;item.append(name,detail);
        if(!event.is_active&&result.admin.role==='SUPER_ADMIN'){const button=document.createElement('button');button.type='button';button.className='btn secondary';button.textContent='SET AS ACTIVE EVENT';button.disabled=busy;button.onclick=()=>{if(confirm('Set '+event.name+' as the active event? Sales and check-in will switch to this event. Historical records will be kept.'))mutate('/api/admin/events?action=activate',{event_id:event.id});};item.appendChild(button);}
        $('event-list').appendChild(item);
      }
      if(!inactive.length){const item=document.createElement('li');item.textContent='NO OTHER EVENTS YET';$('event-list').appendChild(item);}
    }catch(error){if(current===epoch&&version===listVersion)notice(error.message);}
  }
  function render(next){data=next;
    const changed=editingId!==next.event?.id;editingId=next.event?.id??null;
    $('active-event-details').replaceChildren();
    if(next.event){
      const name=document.createElement('strong'),date=document.createElement('p'),status=document.createElement('p');
      name.textContent=next.event.name;date.textContent=displayDate(next.event.starts_at);status.textContent='ACTIVE · '+next.event.sales_mode;
      $('active-event-details').append(name,date,status);
      if(next.event.pricing){const summary=document.createElement('p');summary.textContent='PRICING MODE '+next.event.pricing_mode+' · CURRENT PHASE '+next.event.pricing.phase+' · CURRENT PRICE €'+(next.event.pricing.current_price_cents/100).toFixed(2);$('active-event-details').appendChild(summary);}
    }else{const empty=document.createElement('p');empty.textContent='NO ACTIVE EVENT';$('active-event-details').appendChild(empty);}
    $('event-edit-form').hidden=!next.event;$('non-paying-form').hidden=!next.event;
    if(next.event&&(!dirty||changed)){makeForm('settings','edit-',next.event);dirty=false;}
    $('sales-schedule').textContent=next.event?.sales_mode==='SCHEDULED'?'Opens '+displayDate(next.event.sales_open_at)+' · Closes '+(next.event.sales_close_at?displayDate(next.event.sales_close_at):'No closing time'):'Update sales mode in EVENT SETTINGS.';
    $('non-paying-list').replaceChildren();
    for(const person of next.non_paying_attendees){const item=document.createElement('li'),text=document.createElement('p'),remove=document.createElement('button');text.textContent=person.first_name+' '+person.last_name+' · '+person.category+' · '+(person.checked_in_at?'CHECKED IN':'NOT CHECKED IN');remove.type='button';remove.className='btn secondary';remove.textContent='REMOVE';remove.disabled=busy;remove.onclick=()=>{if(confirm('Remove '+person.first_name+' '+person.last_name+' from this event? This releases one physical place.'))mutate('/api/admin/non-paying-attendees',{attendee_id:person.id},'DELETE');};item.append(text,remove);$('non-paying-list').appendChild(item);}
    if(!next.non_paying_attendees.length){const item=document.createElement('li');item.textContent='NO NON-PAYING ATTENDEES YET';$('non-paying-list').appendChild(item);}
    eventList();
  }
  function reset(){epoch++;listVersion++;data=null;busy=false;dirty=false;editingId=null;buttons(false);['event-list','active-event-details','non-paying-list','create-settings'].forEach(id=>$(id).replaceChildren());$('other-events').open=false;$('other-event-count').textContent='0';$('create-event-panel').open=false;$('create-event-panel').hidden=true;$('management-message').hidden=true;$('non-paying-form').reset();makeForm('create-settings','create-',defaults);}
  function init(options){api=options;makeForm('create-settings','create-',defaults);$('event-timezone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone;
    $('event-edit-form').addEventListener('input',()=>dirty=true);
    $('event-edit-form').addEventListener('submit',event=>{event.preventDefault();try{const value=values('edit-');if(confirmPricing(value,data?.event?.pricing_mode))mutate('/api/admin/events',value,'PATCH');}catch{notice('Check the event dates and values.');}});
    $('event-create-form').addEventListener('submit',event=>{event.preventDefault();try{const value=values('create-');if(confirmPricing(value))mutate('/api/admin/events',value,'POST',()=>{makeForm('create-settings','create-',defaults);$('create-event-panel').open=false;});}catch{notice('Check the event dates and values.');}});
    $('non-paying-form').addEventListener('submit',event=>{event.preventDefault();mutate('/api/admin/non-paying-attendees',{first_name:$('np-first').value.trim(),last_name:$('np-last').value.trim(),email:$('np-email').value.trim(),category:$('np-category').value},'POST',()=>$('non-paying-form').reset());});
  }
  root.TubaraoManagement={init,render,reset,euroToCents};
})(window);
