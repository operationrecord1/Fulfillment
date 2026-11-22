(function(){'use strict';
window.OrderTitleTooltip={mount(container){
 const tip=document.createElement('div');tip.className='order-title-tooltip';tip.id='order-full-title-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
 let active=null,timer=null;
 const cancel=()=>{clearTimeout(timer);timer=null;};
 function hide(){cancel();active?.removeAttribute('aria-describedby');active=null;tip.hidden=true;}
 function show(el){cancel();if(active!==el)active?.removeAttribute('aria-describedby');active=el;tip.textContent=el.dataset.fullTitle;tip.hidden=false;el.setAttribute('aria-describedby',tip.id);const r=el.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;const left=Math.max(8,Math.min(innerWidth-w-8,r.left+r.width/2-w/2));const above=r.top-h-12>=70;tip.style.left=left+'px';tip.style.top=(above?r.top-h-12:Math.min(innerHeight-h-8,r.bottom+12))+'px';tip.dataset.placement=above?'top':'bottom';tip.style.setProperty('--arrow-left',Math.max(12,Math.min(w-12,r.left+r.width/2-left))+'px');}
 const later=()=>{cancel();timer=setTimeout(hide,160);};
 const over=e=>{const el=e.target.closest('[data-full-title]');if(el&&container.contains(el))show(el);};
 const out=e=>{const el=e.target.closest('[data-full-title]');if(!el||el.contains(e.relatedTarget)||tip.contains(e.relatedTarget))return;later();};
 const focus=e=>{const el=e.target.closest('[data-full-title]');if(el)show(el);};
 const blur=e=>{if(!tip.contains(e.relatedTarget)&&!tip.matches(':hover'))later();};
 const key=e=>{if(e.key==='Escape')hide();};
 const outside=e=>{if(!tip.contains(e.target)&&!active?.contains(e.target))hide();};
 tip.addEventListener('pointerenter',cancel);tip.addEventListener('pointerleave',later);tip.addEventListener('pointerdown',cancel);
 container.addEventListener('pointerover',over);container.addEventListener('pointerout',out);container.addEventListener('focusin',focus);container.addEventListener('focusout',blur);document.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);container.addEventListener('scroll',hide,{passive:true});window.addEventListener('resize',hide);
 return {hide,dispose(){hide();tip.remove();container.removeEventListener('pointerover',over);container.removeEventListener('pointerout',out);container.removeEventListener('focusin',focus);container.removeEventListener('focusout',blur);document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);container.removeEventListener('scroll',hide);window.removeEventListener('resize',hide);}};
}};
})();
