(function(root){
'use strict';
const Core=root.OrderCore||(typeof require==='function'?require('./dashboard-core.js'):null);
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
const colors=['#fe8101','#01a6ff','#6eb146'];
function dateLabel(iso){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');return m?Number(m[3])+' '+months[Number(m[2])-1]+' '+m[1]:iso||'';}
function orderLabel(n){if(n==null||n==='')return '';const digits=String(n).padStart(8,'0');return 'FL-'+digits.slice(0,-4)+'-'+digits.slice(-4);}
// Reserve label space only in the drawing. Values, percentages and totals stay exact.
function sliceShares(values,minimum=0){const total=values.reduce((a,b)=>a+b,0);if(!total)return values.map(()=>0);const out=values.map(()=>0),pending=new Set(values.map((v,i)=>v>0?i:-1).filter(i=>i>=0));let remaining=1;while(pending.size){const weight=[...pending].reduce((s,i)=>s+values[i],0),small=[...pending].filter(i=>values[i]/weight*remaining<minimum);if(!small.length){for(const i of pending)out[i]=values[i]/weight*remaining;break;}for(const i of small){out[i]=minimum;remaining-=minimum;pending.delete(i);}}return out;}
function path(cx,cy,rx,ry,start,end,hole=0){const steps=Math.max(10,Math.ceil((end-start)*rx/4)),p=[];for(let i=0;i<=steps;i++){const a=start+(end-start)*i/steps;p.push([cx+rx*Math.cos(a),cy+ry*Math.sin(a)]);}if(hole){for(let i=steps;i>=0;i--){const a=start+(end-start)*i/steps;p.push([cx+rx*hole*Math.cos(a),cy+ry*hole*Math.sin(a)]);}}else p.push([cx,cy]);return'M'+p.map(x=>x.map(n=>n.toFixed(2)).join(',')).join('L')+'Z';}
function percentage(v,total){const p=v/total*100;return p>0&&p<.01?'<0.01%':number(p)+'%';}
function fittedShares(values,labels,donut){
const total=values.reduce((a,b)=>a+b,0);if(!total)return values.map(()=>0);
const ctx=typeof document!=='undefined'?document.createElement('canvas').getContext('2d'):null;if(ctx)ctx.font='650 17px Inter, Segoe UI, sans-serif';
const widths=labels.map(t=>(ctx?ctx.measureText(t).width:t.length*9)+2),mins=values.map(()=>0);let shares;
for(let iteration=0;iteration<400;iteration++){
shares=values.map((v,i)=>v?Math.max(mins[i],v/total):0);for(let k=0;k<4;k++){const fixed=shares.map((v,i)=>v<=mins[i]+1e-8),room=1-shares.reduce((a,v,i)=>a+(fixed[i]?v:0),0),weight=values.reduce((a,v,i)=>a+(fixed[i]?0:v),0);shares=shares.map((v,i)=>fixed[i]?v:Math.max(mins[i],weight?values[i]/weight*room:0));}
let angle=-Math.PI/2,changed=false;
shares.forEach((share,i)=>{if(!values[i])return;const end=angle+share*Math.PI*2,mid=(angle+end)/2,cx=125*.76*Math.cos(mid),cy=96*.76*Math.sin(mid);let fits=true;for(const dx of [-widths[i]/2,widths[i]/2])for(const dy of [-7,7]){const x=(cx+dx)/125,y=(cy+dy)/96;let a=Math.atan2(y,x);while(a<angle)a+=Math.PI*2;if(a>end+1e-8||x*x+y*y>1||(donut&&x*x+y*y<.49*.49))fits=false;}if(!fits&&share<.30){mins[i]=share+.001;changed=true;}angle=end;});if(!changed)break;
}return shares;
}
function roundChart(a,donut){const values=a.sizes.map(s=>donut?s.count:Math.max(0,s.profit)),total=values.reduce((x,y)=>x+y,0),shares=fittedShares(values,values.map(v=>donut?String(v):(v/100).toFixed(2)),donut);let svg='<svg viewBox="39 -5 262 238" role="img" aria-label="'+(donut?'Unique orders by order size':'Positive gross profit by category')+'">';if(!total)return '<div class="om-chart-empty" role="status">'+(!a.count?'No orders this period':a.sizes.some(s=>s.profit<0)?'No positive gross profit':'Gross Profit: $0.00')+'</div>';
const id=donut?'om-donut-gloss':'om-pie-gloss';
svg+='<defs><linearGradient id="'+id+'" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="white" stop-opacity=".35"/><stop offset=".45" stop-color="white" stop-opacity=".08"/><stop offset="1" stop-color="#173d10" stop-opacity=".16"/></linearGradient><radialGradient id="'+id+'-shine" gradientUnits="userSpaceOnUse" cx="112" cy="34" r="145" gradientTransform="translate(0 17) scale(1 .65)"><stop stop-color="white" stop-opacity=".72"/><stop offset=".24" stop-color="white" stop-opacity=".30"/><stop offset=".65" stop-color="white" stop-opacity="0"/></radialGradient><linearGradient id="'+id+'-rim" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="white" stop-opacity=".92"/><stop offset=".35" stop-color="white" stop-opacity=".50"/><stop offset=".65" stop-color="white" stop-opacity=".05"/><stop offset="1" stop-color="white" stop-opacity=".55"/></linearGradient><filter id="'+id+'-shadow" x="-25%" y="-100%" width="150%" height="300%"><feGaussianBlur stdDeviation="6"/></filter></defs><ellipse cx="170" cy="216" rx="112" ry="10" fill="#223921" opacity=".22" filter="url(#'+id+'-shadow)"/>';
let angle=-Math.PI/2;const seg=values.map((v,i)=>{const s={start:angle,end:angle+shares[i]*Math.PI*2,v,i};angle=s.end;return s;}).filter(s=>s.v);
for(let depth=22;depth>0;depth--)for(const s of seg)svg+='<path d="'+path(170,100+depth,125,96,s.start,s.end,donut?.49:0)+'" fill="'+colors[s.i]+'" style="filter:brightness('+(.61+(22-depth)*.012)+')"/>';
const tinyLabels=seg.filter(s=>shares[s.i]<.08).map(s=>({i:s.i,x:170+155*Math.cos((s.start+s.end)/2)})).sort((a,b)=>a.x-b.x);for(let i=1;i<tinyLabels.length;i++)tinyLabels[i].x=Math.max(tinyLabels[i].x,tinyLabels[i-1].x+48);if(tinyLabels.length&&tinyLabels.at(-1).x>308){const shift=tinyLabels.at(-1).x-308;for(const p of tinyLabels)p.x-=shift;}
for(const s of seg){const angle=(s.start+s.end)/2,tiny=false,r=.76,labelX=tiny?tinyLabels.find(p=>p.i===s.i).x:170+125*r*Math.cos(angle),tip=a.sizes[s.i].name+'\n'+(donut?s.v+(s.v===1?' order':' orders'):money(s.v)+' gross profit'),label=donut?String(s.v):(s.v/100).toFixed(2);svg+='<g class="om-chart-hit" tabindex="0" data-chart-tip="'+esc(tip)+'" aria-label="'+esc(tip.replace(/\n/g,', '))+'"><path d="'+path(170,100,125,96,s.start,s.end,donut?.49:0)+'" fill="'+colors[s.i]+'"/><path d="'+path(170,100,125,96,s.start,s.end,donut?.49:0)+'" fill="url(#'+id+')" pointer-events="none"/><path d="'+path(170,100,125,96,s.start,s.end,donut?.49:0)+'" fill="url(#'+id+'-shine)" pointer-events="none"/><path d="'+path(170,100,125,96,s.start,s.end,.968)+'" fill="url(#'+id+'-rim)" pointer-events="none"/>'+(tiny?'<path d="M'+(170+125*Math.cos(angle))+' '+(100+96*Math.sin(angle))+'L'+labelX+' '+(100+96*r*Math.sin(angle))+'" stroke="'+colors[s.i]+'" fill="none"/>':'')+'<text x="'+labelX+'" y="'+(104+96*r*Math.sin(angle))+'" text-anchor="middle" fill="'+(tiny?'#38534b':'white')+'" font-size="'+(label.length>9?13:17)+'" font-weight="650">'+esc(label)+'</text></g>';}
if(donut)svg+='<text x="170" y="104" text-anchor="middle" fill="#1b302d" font-size="32" font-weight="600">'+a.count+'</text><text x="170" y="120" text-anchor="middle" fill="#72817d" font-size="11">ORDERS</text>';
return svg+'</svg>';}
function calendarPoints(points,rows,year,month,investor=false){const yearly=month==='all',length=yearly?12:new Date(Date.UTC(year,month,0)).getUTCDate(),out=Array.from({length},(_,i)=>({index:i,label:yearly?months[i].slice(0,3):String(i+1),full:yearly?months[i]+' '+year:(i+1)+' '+months[month-1]+' '+year,value:0,orders:new Set()}));
if(yearly)return out.map(({orders,...p},i)=>{const subset=rows.filter(r=>(r.year??Number(r.data.date?.slice(0,4)))===year&&(r.month??Number(r.data.date?.slice(5,7)))===i+1),a=Core.aggregate(subset,[],investor);return {...p,value:a.gross,count:a.count};});
for(const [date,value]of points){if(Number(date.slice(0,4))!==year)continue;const m=Number(date.slice(5,7)),i=yearly?m-1:Number(date.slice(8,10))-1;if(!yearly&&m!==month)continue;if(out[i])out[i].value+=value;}
for(const row of rows){const d=row.data;if(!d.date||!d.order_id||Number(d.date.slice(0,4))!==year)continue;const m=Number(d.date.slice(5,7)),i=yearly?m-1:Number(d.date.slice(8,10))-1;if(!yearly&&m!==month)continue;out[i]?.orders.add(d.order_id);}
return out.map(({orders,...p})=>({...p,count:orders.size}));}
function niceStep(raw){const power=10**Math.floor(Math.log10(raw||1)),n=raw/power;return(n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*power;}

function profitLayout(points,width=900){
 const w=Math.max(160,Math.floor(width||900)),right=3,top=32,base=310,font=12;
 const hi=Math.max(0,...points.map(p=>p.value/100)),step=niceStep((hi||10)/4),max=hi>0?Math.ceil((hi+step*.15)/step)*step:step*4;
 const left=Math.max(...Array.from({length:Math.round(max/step)+1},(_,i)=>number(i*step).length))*6+9,slot=(w-left-right)/Math.max(1,points.length);
 let run=0,vertical=false;for(const p of points){run=p.value<0?run+1:0;if(run>=3)vertical=true;}
 const placed=[];const items=points.map((p,i)=>{const cx=left+(i+.5)*slot,yt=base-Math.max(.8,p.value/100/max*(base-top));let label=null;
 if(p.value!==0){const text=(p.value/100).toFixed(2),rotated=p.value<0&&vertical,length=text.length*font*.59,half=rotated?font/2:length/2,x=rotated?cx:Math.max(half+3,Math.min(w-half-3,cx));let y=p.value<0?(rotated?base+6+length/2:base+18):yt-9;
 
 label={text,x,y,half,vertical:rotated,font,negative:p.value<0,bottom:rotated?base+6+length:y+3};placed.push(label);}
 return {p,cx,yt,label};});
 // Profit labels stay anchored to their own candle, never to a neighbouring date.
 const measureContext=typeof document!=='undefined'?document.createElement('canvas').getContext('2d'):null;
 const textWidth=(text,size)=>{if(measureContext){measureContext.font='500 '+size+'px Inter,Segoe UI,Arial,sans-serif';return measureContext.measureText(text).width;}return text.length*size*.59;};
 for(const item of items)if(item.label&&!item.label.negative){const l=item.label;l.x=item.cx;l.font=Math.max(9,Math.min(12,Math.floor(12*(slot-1)/textWidth(l.text,12))));l.font=Math.min(l.font,12*(2*Math.min(l.x-1,w-l.x-1))/textWidth(l.text,12));l.half=textWidth(l.text,l.font)/2;}
 // A one-pixel gap, with each colliding group balanced around its original dates.
 const losses=placed.filter(l=>l.negative&&!l.vertical);
 for(const l of losses)l.half=textWidth(l.text,l.font)/2;
 if(losses.some((l,i)=>i&&l.x-losses[i-1].x<l.half+losses[i-1].half+1)){
  for(const l of losses){l.font=11;l.half=textWidth(l.text,11)/2;}
  const groups=[];
  const balance=g=>{let offset=0;const offsets=g.map((l,i)=>{if(i)offset+=g[i-1].half+l.half+1;return offset;});const origin=g.reduce((sum,l,i)=>sum+l.anchor-offsets[i],0)/g.length;g.forEach((l,i)=>{l.x=origin+offsets[i];});};
  for(const l of losses){l.anchor=l.x;groups.push([l]);while(groups.length>1){const last=groups.at(-1),prev=groups.at(-2);if(last[0].x-last[0].half>=prev.at(-1).x+prev.at(-1).half+1)break;groups.splice(-2,2,[...prev,...last]);balance(groups.at(-1));}}
 }
 const shift=Math.max(0,16-Math.min(top,...placed.filter(l=>!l.negative).map(l=>l.y)));
 for(const item of items){item.yt+=shift;if(item.label){item.label.y+=shift;item.label.bottom+=shift;}}
 const dateY=Math.max(base+shift+20,...items.filter(i=>i.label?.negative).map(i=>i.label.bottom+15));
 return {w,left,right,slot,top:top+shift,base:base+shift,max,step,items,dateY,h:dateY+(slot<18?23:9),vertical};
}
function profitCandleFit(text,width,height){
 const normal=11,minimum=normal*.7,pad=4,ratio=text.length*.62;
 const font=Math.min(normal,width-pad,(height-pad)/ratio);
 if(font>=minimum)return {font,height};
 const needed=ratio*minimum+pad;
 if(width-pad>=minimum&&needed<=height*1.2)return {font:minimum,height:Math.max(height,needed)};
 return {font:null,height};
}
function profitChart(points,yearly,width=900){
 const l=profitLayout(points,width),{w,h,left,right,slot,top,base,max,step,dateY}=l,depth=3,y=v=>base-v/max*(base-top);
 let s='<svg class="'+(yearly?'om-year-chart':'om-day-chart')+'" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+(yearly?'Monthly':'Daily')+' gross profit and loss"><defs><linearGradient id="om-profit-face"><stop stop-color="#48b48d"/><stop offset=".45" stop-color="#269875"/><stop offset="1" stop-color="#177458"/></linearGradient></defs>';
 for(let v=0;v<=max+step*.01;v+=step)s+='<line x1="'+left+'" y1="'+y(v)+'" x2="'+(w-right)+'" y2="'+y(v)+'" stroke="#e4ebe7"/><text x="'+(left-6)+'" y="'+(y(v)+3)+'" text-anchor="end" fill="#72817d" font-size="10">'+number(v)+'</text>';
 s+='<line x1="'+left+'" x2="'+(w-right)+'" y1="'+base+'" y2="'+base+'" stroke="#9aaba3"/>';
 for(const {p,cx,yt,label} of l.items){const bw=Math.min(26,slot*.7),dx=Math.min(depth,bw*.23),x=cx-bw/2,tip=p.full+'\n'+p.count+(p.count===1?' order':' orders')+'\nGross profit: '+(p.value/100).toFixed(2);
 s+='<g class="om-chart-hit om-profit-point'+(p.value<0?' is-loss':'')+'" tabindex="0" data-chart-tip="'+esc(tip)+'" aria-label="'+esc(tip.replace(/\n/g,', '))+'"><rect class="om-hover-area" x="'+(cx-slot/2)+'" y="0" width="'+slot+'" height="'+h+'" fill="transparent"/>';
 if(p.value>0){const height=base-yt,barTop=yt;s+='<path d="M'+(x+bw)+' '+barTop+'l'+dx+' -'+dx+'v'+height+'l-'+dx+' '+dx+'Z" fill="#14634d"/><path d="M'+x+' '+barTop+'l'+dx+' -'+dx+'h'+bw+'l-'+dx+' '+dx+'Z" fill="#83dc9b"/><rect x="'+x+'" y="'+barTop+'" width="'+bw+'" height="'+height+'" fill="url(#om-profit-face)"/>';}
 else if(p.value<0)s+='<rect class="om-loss-marker" x="'+x+'" y="'+(base-2)+'" width="'+bw+'" height="3" rx="1" fill="#cf4d58"/>';
 else if(p.count)s+='<circle cx="'+cx+'" cy="'+base+'" r="2.5" fill="white" stroke="#228365"/>';
 if(label)s+='<text class="'+(label.negative?'om-loss-value':'om-profit-value')+'" x="'+label.x+'" y="'+label.y+'" '+(label.vertical?'transform="rotate(-90 '+label.x+' '+label.y+')" dominant-baseline="central" ':'')+'text-anchor="middle" fill="'+(label.negative?'#bd3846':'#264b3e')+'" font-family="Inter,Segoe UI,Arial,sans-serif" font-weight="500" style="font-variant-numeric:tabular-nums" font-size="'+label.font+'">'+label.text+'</text>';
 s+='<text x="'+cx+'" y="'+(dateY+(slot<18&&p.index%2?14:0))+'" text-anchor="middle" fill="#72817d" font-size="10">'+p.label+'</text></g>';}
 return s+'</svg>';
}
function bindTooltips(host){const tip=document.createElement('div');tip.className='om-chart-tooltip';tip.role='tooltip';tip.hidden=true;host.append(tip);let active=null;
const hide=()=>{tip.hidden=true;active=null;};const show=e=>{const point=e.target.closest?.('[data-chart-tip]');if(!point)return;active=point;tip.textContent=point.dataset.chartTip;tip.hidden=false;position(e);};
const position=e=>{if(!active)return;const r=active.getBoundingClientRect(),x=e.clientX??r.left+r.width/2,y=e.clientY??r.top;tip.style.left=Math.max(8,Math.min(x+14,document.documentElement.clientWidth-tip.offsetWidth-8))+'px';tip.style.top=Math.max(8,Math.min(y+14,document.documentElement.clientHeight-tip.offsetHeight-8))+'px';};
const leave=e=>{if(active&&!active.contains(e.relatedTarget))hide();};const key=e=>{if(e.key==='Escape')hide();};
host.addEventListener('pointerover',show);host.addEventListener('pointermove',position);host.addEventListener('pointerout',leave);host.addEventListener('focusin',show);host.addEventListener('focusout',hide);host.addEventListener('click',show);host.addEventListener('keydown',key);host.addEventListener('scroll',hide,true);
return()=>{host.removeEventListener('pointerover',show);host.removeEventListener('pointermove',position);host.removeEventListener('pointerout',leave);host.removeEventListener('focusin',show);host.removeEventListener('focusout',hide);host.removeEventListener('click',show);host.removeEventListener('keydown',key);host.removeEventListener('scroll',hide,true);tip.remove();};}
const api={months,dateLabel,orderLabel,sliceShares,roundChart,calendarPoints,profitLayout,profitCandleFit,profitChart,bindTooltips};root.OrderCharts=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
