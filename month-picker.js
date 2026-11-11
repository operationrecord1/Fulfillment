(function(){
'use strict';
window.mountMonthPicker=function(select,yearSelect){
 if(!('showPopover' in HTMLElement.prototype))return;
 const periodLabel=()=>select.value==='all'?'Yearly Analysis of '+yearSelect.value:select.selectedOptions[0].textContent+' '+yearSelect.value;
 const wrap=document.createElement('div'),trigger=document.createElement('button'),menu=document.createElement('div');
 wrap.className='om-month-picker';trigger.type='button';trigger.className='om-month-trigger';trigger.textContent=periodLabel();trigger.setAttribute('aria-label','Month selection');trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');
 menu.className='om-month-menu';menu.id='om-month-options';menu.setAttribute('popover','auto');menu.setAttribute('role','menu');menu.setAttribute('aria-label','Choose a month');trigger.setAttribute('aria-controls',menu.id);
 if(yearSelect){const label=document.createElement('label');label.className='om-month-year';label.append('Year ',yearSelect);menu.append(label);}
 for(const option of select.options){const b=document.createElement('button');b.type='button';b.textContent=option.value==='all'?'Yearly Analysis of '+yearSelect.value:option.textContent;b.dataset.value=option.value;b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(option.selected));if(option.value==='all')b.className='om-month-yearly';b.onclick=async()=>{menu.hidePopover();select.value=option.value;trigger.disabled=true;try{await select.onchange({target:select});}finally{if(trigger.isConnected){trigger.disabled=false;trigger.textContent=periodLabel();trigger.focus({preventScroll:true});}}};menu.append(b);}
 trigger.onclick=()=>{if(menu.matches(':popover-open')){menu.hidePopover();return;}const r=trigger.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(r.left,document.documentElement.clientWidth-288))+'px';menu.style.top=Math.max(8,Math.min(r.bottom+7,document.documentElement.clientHeight-350))+'px';menu.showPopover();menu.querySelector('[aria-checked="true"]').focus();};
 menu.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));
 menu.onkeydown=e=>{if(e.target.tagName==='SELECT')return;const options=[...menu.querySelectorAll('button')],i=options.indexOf(document.activeElement);let next;if(e.key==='ArrowRight')next=i+1;if(e.key==='ArrowLeft')next=i-1;if(e.key==='ArrowDown')next=i+3;if(e.key==='ArrowUp')next=i-3;if(e.key==='Home')next=0;if(e.key==='End')next=options.length-1;if(next!==undefined){e.preventDefault();options[(next+options.length)%options.length].focus();}if(e.key==='Escape'){menu.hidePopover();trigger.focus({preventScroll:true});}};
 select.hidden=true;select.after(wrap);wrap.append(trigger,menu);
};
})();
