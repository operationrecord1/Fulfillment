// Pure projection: the database is authoritative; Google Sheets is a mirror.
export const columns = [
 ['order_id','Order ID'],['quantity','Quantity'],['earning','Order Earning'],
 ['purchase_id','Purchase ID'],['supplier','Supplier Reference'],['note','Note'],
 ['platform','Platform'],['tracking','Tracking'],['secondary_tracking','Secondary Tracking'],
 ['status','Order Status'],['product_cost','Product Cost'],['shipping_cost','Shipping Cost'],
 ['additional_cost','Additional Cost'],['gross','Gross Profit'],['margin','Profit Margin'],
 ['id','Unique ID'],['date','Order Date']
];
export const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export function columnName(index) {
 let name=''; for(let n=index+1;n>0;n=Math.floor((n-1)/26)) name=String.fromCharCode(65+(n-1)%26)+name;
 return name;
}
const present=v=>v!==''&&v!==null&&v!==undefined;
const cents=v=>Math.round(Number(v||0)*100);
export function orderLabel(value) {
 if(!present(value))return '';
 const digits=String(value).padStart(8,'0');return 'FL-'+digits.slice(0,-4)+'-'+digits.slice(-4);
}
export function projectYear(year, source, formats={}) {
 if(!Number.isInteger(year)||year<2000||year>2100)throw Error('Invalid year');
 const rows=source.filter(r=>!r.deleted_at).sort((a,b)=>a.month-b.month||a.position-b.position);
 const seen=new Set(), groups=[];
 for(const row of rows){
  if(row.year!==year||!Number.isInteger(row.month)||row.month<1||row.month>12||!Number.isInteger(row.position)||row.position<1||row.position>100000)throw Error('Invalid source position');
  const key=row.month+':'+row.position;if(seen.has(key))throw Error('Duplicate source position');seen.add(key);
  const prev=groups.at(-1)?.at(-1),d=row.data||{},p=prev?.data||{};
  const connected=prev&&prev.month===row.month&&prev.position+1===row.position&&((d.order_id&&d.order_id===p.order_id)||(d.purchase_id&&d.purchase_id===p.purchase_id));
  if(!connected)groups.push([]);groups.at(-1).push(row);
 }
 const computed=new Map();
 for(const group of groups){
  const revenue=group.reduce((s,r)=>s+cents(r.data.earning),0);
  const cost=group.reduce((s,r)=>s+cents(r.data.product_cost)+cents(r.data.shipping_cost)+cents(r.data.additional_cost),0);
  const valid=group.some(r=>present(r.data.earning))&&group.some(r=>present(r.data.product_cost));
  computed.set(group[0].id,{gross:valid?(revenue-cost)/100:'',margin:valid&&revenue?Math.max(-100,Math.min(100,(revenue-cost)/revenue*100)).toFixed(2)+'%':''});
 }
 const values=rows.map(row=>columns.map(([key])=>{
  if(key==='id')return orderLabel(row.display_number);
  if(key==='gross'||key==='margin')return computed.get(row.id)?.[key]??'';
  const value=row.data[key]??'';
  return key==='status'&&/^buyer cancel(?:led)?$/i.test(value)?'Cancelled':value;
 }));
 const links=rows.map(row=>columns.map(([key])=>{
  const format=formats[row.month]?.[row.position]?.[key];
  const href=format&&Object.hasOwn(format,'href')?format.href:row.data[key==='order_id'?'order_url':key==='purchase_id'?'purchase_url':''];
  if(!present(row.data[key])||!href)return '';
  try{const url=new URL(href);return ['http:','https:'].includes(url.protocol)?url.href:'';}catch{return '';}
 }));
 const monthly=months.map((name,i)=>({month:i+1,startColumn:i*26,header:columns.map(([,label])=>name+' · '+label),rows:[]}));
 rows.forEach((row,i)=>monthly[row.month-1].rows.push({position:row.position,values:values[i],links:links[i]}));
 return {year,monthly,yearly:{header:columns.map(([,label])=>label),rows:values,links},sourceRows:rows.map(r=>({month:r.month,position:r.position}))};
}
// Chunk writes explicitly include blanks, so clearing/deleting rows removes stale cells.
// RAW values prevent order text beginning with '=' from becoming a formula.
export function *valueChunks(title,startColumn,header,rows,previousExtent=0,chunkSize=300){
 const extent=rows.reduce((n,r)=>Math.max(n,r.position),Math.max(previousExtent,0));
 const byPosition=new Map(rows.map(r=>[r.position,r.values]));
 const safeTitle="'"+title.replaceAll("'","''")+"'";
 yield {range:safeTitle+'!'+columnName(startColumn)+'1',values:[header]};
 for(let start=1;start<=extent;start+=chunkSize){
  const end=Math.min(extent,start+chunkSize-1),values=[];
  for(let position=start;position<=end;position++)values.push(byPosition.get(position)||Array(columns.length).fill(''));
  yield {range:safeTitle+'!'+columnName(startColumn)+(start+1),values};
 }
}

// Clear missing links too, including deleted tails, without touching adjacent months.
export function *linkChunks(sheetId,startColumn,rows,previousExtent=0,chunkSize=300){
 const extent=rows.reduce((n,r)=>Math.max(n,r.position),previousExtent);
 const byPosition=new Map(rows.map(r=>[r.position,r.links]));
 for(let start=1;start<=extent;start+=chunkSize){
  const end=Math.min(extent,start+chunkSize-1),data=[];
  for(let pos=start;pos<=end;pos++)data.push({values:columns.map((_,c)=>({userEnteredFormat:{textFormat:byPosition.get(pos)?.[c]?{link:{uri:byPosition.get(pos)[c]}}:{}}}))});
  yield {updateCells:{start:{sheetId,rowIndex:start,columnIndex:startColumn},rows:data,fields:'userEnteredFormat.textFormat.link'}};
 }
}
