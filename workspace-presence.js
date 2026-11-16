(function(root){'use strict';
function mount({client,storeId,sessionId,grid,period,onSaved}){
 let channel,joined=false,last='',timer,disposed=false;
 const peers=new Map(),colors=['#a142f4','#188038','#d56e0c','#b80672','#007b83'];
 const color=id=>colors[[...id].reduce((n,c)=>n+c.charCodeAt(0),0)%colors.length];
 function paint(){grid.host.querySelectorAll('.sheet-peer-selection').forEach(el=>el.remove());const p=period();for(const [id,peer]of peers){if(id===sessionId||peer.year!==p.year||peer.month!==p.month||!Number.isInteger(peer.r)||typeof peer.column!=='string')continue;const c=grid.cols.findIndex(col=>col.key===peer.column);if(c<0)continue;const td=grid.table.querySelector('[data-r="'+peer.r+'"][data-c="'+c+'"]');if(!td)continue;const mark=document.createElement('span');mark.className='sheet-peer-selection';mark.style.setProperty('--peer-color',color(id));mark.dataset.label='Session '+id.slice(0,4);mark.title='Another session '+id.slice(0,4)+(peer.editing?' is editing':'');mark.setAttribute('aria-label',mark.title);td.append(mark);}}
 function publish(){if(disposed||!joined)return;const p=period(),a=grid.activeCell(),value={session:sessionId,year:p.year,month:p.month,r:a.r,column:grid.cols[a.c]?.key,editing:!!grid.editor};const signature=JSON.stringify(value);if(signature===last)return;last=signature;channel.send({type:'broadcast',event:'cursor',payload:value}).catch(()=>{});}
 channel=client.channel('workspace:'+storeId,{config:{private:true,presence:{key:sessionId}}});
 channel.on('presence',{event:'sync'},()=>{const online=new Set(Object.keys(channel.presenceState()));for(const id of peers.keys())if(!online.has(id))peers.delete(id);last='';paint();publish();});
 channel.on('broadcast',{event:'cursor'},({payload})=>{if(typeof payload?.session!=='string'||payload.session.length>64)return;peers.set(payload.session,payload);paint();});
 channel.on('broadcast',{event:'saved'},()=>onSaved());
 channel.subscribe(status=>{joined=status==='SUBSCRIBED';if(joined){last='';channel.track({session:sessionId}).catch(()=>{});publish();onSaved();}});
 timer=setInterval(publish,250);
 let paintedTree=grid.table.firstElementChild;const onPaint=()=>{if(paintedTree!==grid.table.firstElementChild){paintedTree=grid.table.firstElementChild;paint();}};grid.host.addEventListener('sheet-selection',onPaint);
 return {send:message=>channel.send(message),dispose(){disposed=true;clearInterval(timer);grid.host.removeEventListener('sheet-selection',onPaint);client.removeChannel(channel);grid.host.querySelectorAll('.sheet-peer-selection').forEach(el=>el.remove());}};
}
root.WorkspacePresence={mount};
})(window);
