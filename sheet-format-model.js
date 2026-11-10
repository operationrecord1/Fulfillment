(function(root){'use strict';
const left=new Set(['order_id','purchase_id','supplier','note','tracking','secondary_tracking']);
const styles={thin:'1px solid',medium:'2px solid',thick:'3px solid',dashed:'1px dashed',dotted:'1px dotted',double:'3px double'};
const clone=v=>structuredClone(v),hex=v=>/^#[0-9a-f]{6}$/i.test(v);
function defaults(key){return {fontSize:10,bold:false,italic:false,color:'#202124',fill:'#e7ecef',align:left.has(key)?'left':'center'};}
function get(formats,r,key){return {...defaults(key),...formats[r]?.[key]};}
function patch(formats,r,key,values){formats[r]||={};formats[r][key]={...formats[r][key],...clone(values)};}
function shift(formats,from,count,remove=false){const next={};for(const [key,value] of Object.entries(formats)){let r=+key;if(remove&&r>=from&&r<from+count)continue;if(r>=from)r+=remove?-count:count;next[r]=clone(value);}return next;}
function borders(formats,b,keys,pattern,color='#000000',style='thin'){
 const next=clone(formats);function edge(r,c,side,value){if(r<1||r>100000||c<0||c>=keys.length)return;const key=keys[c];next[r]||={};next[r][key]||={};next[r][key].borders||={};if(value)next[r][key].borders[side]=clone(value);else delete next[r][key].borders[side];}
 function put(r,c,side){const value=pattern==='clear'?null:{color,style};edge(r,c,side,value);const pair={top:[r-1,c,'bottom'],bottom:[r+1,c,'top'],left:[r,c-1,'right'],right:[r,c+1,'left']}[side];edge(...pair,value);}
 for(let r=b.r1;r<=b.r2;r++)for(let c=b.c1;c<=b.c2;c++){
  if(['all','clear'].includes(pattern)){for(const side of ['top','right','bottom','left'])put(r,c,side);continue;}
  if((pattern==='inner'||pattern==='horizontal')&&r<b.r2)put(r,c,'bottom');
  if((pattern==='inner'||pattern==='vertical')&&c<b.c2)put(r,c,'right');
  if((pattern==='outer'||pattern==='top')&&r===b.r1)put(r,c,'top');if((pattern==='outer'||pattern==='bottom')&&r===b.r2)put(r,c,'bottom');
  if((pattern==='outer'||pattern==='left')&&c===b.c1)put(r,c,'left');if((pattern==='outer'||pattern==='right')&&c===b.c2)put(r,c,'right');
 }return next;
}
function css(formats,r,key,keys){const f=get(formats,r,key),c=keys.indexOf(key),own=formats[r]?.[key]||{};let s='font-size:'+f.fontSize+'pt;font-weight:'+(f.bold?700:400)+';font-style:'+(f.italic?'italic':'normal')+';text-align:'+f.align+';';if(own.color)s+='color:'+own.color+';--cell-text-color:'+own.color+';';if(own.fill)s+='background-color:'+own.fill+';';for(const [side,b]of Object.entries(own.borders||{})){if(!styles[b.style]||!hex(b.color))continue;const shared=side==='left'&&formats[r]?.[keys[c-1]]?.borders?.right||side==='top'&&formats[r-1]?.[key]?.borders?.bottom;s+='border-'+side+':'+(shared?'0':styles[b.style]+' '+b.color)+';';}return s;}
function rgbToHsv(hexValue){const [r,g,b]=hexValue.slice(1).match(/../g).map(x=>parseInt(x,16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;if(d)h=(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)*60;return {h,s:max?d/max:0,v:max};}
function hsvToHex(h,s,v){const f=n=>{const k=(n+h/60)%6;return Math.round((v-v*s*Math.max(0,Math.min(k,4-k,1)))*255).toString(16).padStart(2,'0');};return '#'+f(5)+f(3)+f(1);}
function paste(formats,source,b,keys,r0,c0,cut=false,rr=b.r2-b.r1+1,cc=b.c2-b.c1+1){
 let next=clone(formats);if(cut){next=borders(next,b,keys,'clear');for(let r=b.r1;r<=b.r2;r++)for(let c=b.c1;c<=b.c2;c++)if(next[r])delete next[r][keys[c]];}
 next=borders(next,{r1:r0,r2:r0+rr-1,c1:c0,c2:Math.min(keys.length-1,c0+cc-1)},keys,'clear');
 for(let i=0;i<rr;i++)for(let j=0;j<cc&&c0+j<keys.length;j++){const r=r0+i,key=keys[c0+j];next[r]||={};next[r][key]=clone(source[b.r1+i%(b.r2-b.r1+1)]?.[keys[b.c1+j%(b.c2-b.c1+1)]]||{});}
 // Borders are shared edges: remove stale source edges and mirror destination edges.
 for(let i=0;i<rr;i++)for(let j=0;j<cc&&c0+j<keys.length;j++){const r=r0+i,c=c0+j;for(const [side,value]of Object.entries(next[r]?.[keys[c]]?.borders||{})){const [nr,nc,opposite]={top:[r-1,c,'bottom'],bottom:[r+1,c,'top'],left:[r,c-1,'right'],right:[r,c+1,'left']}[side];if(nr<1||nc<0||nc>=keys.length)continue;next[nr]||={};next[nr][keys[nc]]||={};next[nr][keys[nc]].borders||={};next[nr][keys[nc]].borders[opposite]=clone(value);}}
 return next;
}
const api={defaults,get,patch,shift,borders,paste,css,hex,styles,rgbToHsv,hsvToHex};root.SheetFormatModel=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
