(function(root){
'use strict';
const editable=windowSafeCore();
function windowSafeCore(){return root.OrderCore|| (typeof require==='function'?require('./dashboard-core.js'):null);}
const nonempty=data=>Object.values(data).some(v=>v!==''&&v!==null&&v!==undefined);
function rowCount(rows){return Math.max(0,...rows.filter(r=>nonempty(r.data)).map(r=>r.position))+20;}
function parseTSV(text){
 const rows=[[]];let value='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(quoted||!value)quoted=!quoted;else value+=c;}
 else if(!quoted&&(c==='\t'||c==='\n'||c==='\r')){rows.at(-1).push(value);value='';if(c!=='\t'){if(c==='\r'&&text[i+1]==='\n')i++;rows.push([]);}}else value+=c;}
 rows.at(-1).push(value);if(rows.length>1&&rows.at(-1).length===1&&rows.at(-1)[0]==='')rows.pop();return rows;
}
function toTSV(rows){return rows.map(row=>row.map(v=>{const s=String(v??'');return /[\t\n\r"]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;}).join('\t')).join('\n');}
function normalize(field,value,year,month,platforms){
 value=String(value??'').trim();if(!value)return '';
 const col=editable.columns.find(c=>c[0]===field);if(!col||col[2]==='computed')throw Error('This cell is calculated or system-generated.');
 if(['money','number'].includes(col[2])){const n=Number(value.replace(/[$,]/g,''));if(!Number.isFinite(n)||Math.abs(n)>1e9||(field!=='earning'&&n<0)||(field==='quantity'&&!Number.isInteger(n)))throw Error('Enter a valid '+(field==='quantity'?'whole number':'number')+'.');return Math.round(n*100)/100;}
 if(field==='date'){let y,m,d;const iso=value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/),slash=value.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/),named=value.match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/);
  if(iso)[,y,m,d]=iso.map(Number);else if(slash){m=Number(slash[1]);d=Number(slash[2]);y=slash[3]?Number(slash[3]):year;if(y<100)y+=2000;}else if(named){d=Number(named[1]);m=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[2].slice(0,3).toLowerCase())+1;y=Number(named[3]||year);}else throw Error('Enter a date such as '+year+'-'+String(month).padStart(2,'0')+'-01.');
  const check=new Date(Date.UTC(y,m-1,d));if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d)throw Error('Enter a valid date.');if(y!==year||m!==month)throw Error('Order date must match the selected month and year.');return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
 }
 if(field==='status'&&!editable.statuses.includes(value))throw Error('Choose an available Order Status.');
 if(field==='platform'&&!platforms.includes(value))throw Error('Choose a platform from Settings.');
 if(value.length>2000)throw Error('Maximum 2,000 characters per cell.');return value;
}
function insert(rows,at,count=1){return rows.map(r=>({...r,position:r.position>=at?r.position+count:r.position}));}
function remove(rows,from,to){const n=to-from+1;return rows.filter(r=>r.position<from||r.position>to).map(r=>({...r,position:r.position>to?r.position-n:r.position}));}
const api={nonempty,rowCount,parseTSV,toTSV,normalize,insert,remove};root.SheetModel=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
