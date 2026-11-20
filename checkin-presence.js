'use strict';
(function(root){
  const compare=(a,b)=>String(a).localeCompare(String(b),'en',{sensitivity:'base'});
  function select(rows,{sort='latest',category='ALL',type='ALL'}={}){
    const names=(a,b)=>compare(a.lastName,b.lastName)||compare(a.firstName,b.firstName);
    return rows.filter(row=>(category==='ALL'||row.category===category)&&(type==='ALL'||row.type===type)).sort((a,b)=>{
      if(sort==='first')return compare(a.firstName,b.firstName)||names(a,b);
      if(sort==='last')return names(a,b);
      if(sort==='men'||sort==='women'){const first=sort==='men'?'MEN':'WOMEN';return Number(b.category===first)-Number(a.category===first)||names(a,b);}
      return Date.parse(b.checkedInAt)-Date.parse(a.checkedInAt)||names(a,b);
    });
  }
  function create({document,request,setInterval:repeat=root.setInterval,clearInterval:cancel=root.clearInterval}){
    const $=id=>document.getElementById(id),controls=['presence-sort','presence-category','presence-type'];
    let active=false,timer=null,inFlight=null,epoch=0,rerun=false,data=null,listKey=null;
    function render(){
      const stats=data?.stats||{total:0,men:0,women:0,menPercentage:0,womenPercentage:0};
      for(const [id,value] of Object.entries({'inside-total':stats.total,'inside-men':stats.men,'inside-women':stats.women,'inside-men-percent':stats.menPercentage+'%','inside-women-percent':stats.womenPercentage+'%'}))$(id).textContent=String(value);
      const rows=select(data?.attendees||[],{sort:$('presence-sort').value||'latest',category:$('presence-category').value||'ALL',type:$('presence-type').value||'ALL'});
      $('inside-count').textContent=rows.length===stats.total?String(stats.total):rows.length+' / '+stats.total;
      $('presence-empty').textContent=stats.total?'NO MATCHING ATTENDEES':'NO ONE CHECKED IN YET';$('presence-empty').hidden=rows.length>0;
      const key=JSON.stringify(rows);if(key===listKey)return;listKey=key;
      const items=rows.map(row=>{const item=document.createElement('li'),name=document.createElement('strong'),detail=document.createElement('p'),time=document.createElement('time');
        name.textContent=row.firstName+' '+row.lastName;detail.textContent=row.category+' · '+row.type;
        time.dateTime=row.checkedInAt;time.textContent=new Date(row.checkedInAt).toLocaleTimeString('en-GB',{timeZone:'Europe/Lisbon',hour:'2-digit',minute:'2-digit'});
        item.append(name,detail,time);return item;});
      $('presence-list').replaceChildren(...items);
    }
    function refresh(afterCheckIn=false){
      if(!active||document.hidden)return Promise.resolve();
      if(inFlight){if(afterCheckIn)rerun=true;return inFlight;}
      const current=epoch;
      inFlight=(async()=>{
        try{
          const result=await request('/api/admin/check-in?action=presence');
          if(!result?.stats||!Array.isArray(result.attendees))throw new Error('Invalid attendance response');
          if(active&&current===epoch){data=result;render();$('presence-message').textContent='Updated '+new Date(result.generatedAt).toLocaleTimeString('en-GB',{timeZone:'Europe/Lisbon',hour:'2-digit',minute:'2-digit',second:'2-digit'});}
        }catch(error){if(active&&current===epoch){if([401,403].includes(error.status)){data=null;render();}$('presence-message').textContent='LIVE UPDATE UNAVAILABLE';}}
        finally{inFlight=null;if(rerun){rerun=false;if(active&&!document.hidden)void refresh();}}
      })();return inFlight;
    }
    function visibilityChanged(){
      if(timer!==null){cancel(timer);timer=null;}
      if(active&&!document.hidden){void refresh(true);timer=repeat(()=>void refresh(),5000);}
    }
    function start(){if(active)return;active=true;controls.forEach(id=>$(id).addEventListener('change',render));visibilityChanged();}
    function stop(){active=false;epoch++;rerun=false;if(timer!==null)cancel(timer);timer=null;controls.forEach(id=>$(id).removeEventListener('change',render));data=null;render();$('presence-message').textContent='Loading attendance…';}
    return {start,stop,refresh,visibilityChanged};
  }
  const api={select,create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TubaraoPresence=api;
})(typeof window!=='undefined'?window:globalThis);
