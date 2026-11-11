(function(root){'use strict';
class SessionHistory{
 constructor(key,storage){this.key=key;this.storage=storage;this.past=[];this.future=[];this.running=false;try{const saved=JSON.parse(storage?.getItem(key)||'null');if(saved?.version===1){this.past=saved.past;this.future=saved.future;}}catch{}}
 persist(){try{this.storage?.setItem(this.key,JSON.stringify({version:1,past:this.past,future:this.future}));}catch{/* The complete history remains available in memory if browser storage is full. */}}
 record(entry){if(this.running)return;this.past.push(structuredClone(entry));this.future=[];this.persist();}
 async travel(redo,apply){if(this.running)return false;const source=redo?this.future:this.past,target=redo?this.past:this.future;if(!source.length)return false;this.running=true;try{const entry=source[source.length-1];await apply(entry,redo);source.pop();target.push(entry);this.persist();return true;}finally{this.running=false;}}
 clear(){this.past=[];this.future=[];this.storage?.removeItem(this.key);}
}
function averageDaily(value){return value<=.66?.5:Math.max(1,Math.round(value));}
function days(year,month){return Array.from({length:new Date(year,month,0).getDate()},(_,i)=>`${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`);}
function receipt(value){if(!value.trim())return '';const u=new URL(value.trim());if(!['http:','https:'].includes(u.protocol)||!u.hostname)throw Error('Enter a valid http or https receipt link.');return u.href;}
function amountText(value){const parts=String(value).replace(/[^0-9.]/g,'').split('.');return parts[0]+(parts.length>1?'.'+parts.slice(1).join('').slice(0,2):'');}
function shortDate(iso){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');return m?Number(m[3])+' '+['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(m[2])-1]+' '+m[1]:iso||'';}
class MissingDateTracker{
 constructor(){this.rows=new Map();}
 key(row){return row.id||row._key||row.year+'-'+row.month+'-'+(row.sourcePosition||row.position);}
 observe(row,now=Date.now()){const key=this.key(row),signature=JSON.stringify(row.data);if(row.data.date||!Object.values(row.data).some(v=>v!==''&&v!=null)){this.rows.delete(key);return;}const old=this.rows.get(key);if(!old||old.signature!==signature)this.rows.set(key,{signature,at:now});}
 touch(row,now=Date.now()){if(row&&!row.data.date){this.observe(row,now);const entry=this.rows.get(this.key(row));if(entry)entry.at=now;}}
 overdue(row,now=Date.now()){return !!row&&!row.data.date&&!!this.rows.get(this.key(row))&&now-this.rows.get(this.key(row)).at>=300000;}
}
const api={SessionHistory,averageDaily,days,receipt,amountText,shortDate,MissingDateTracker};root.DashboardSession=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
