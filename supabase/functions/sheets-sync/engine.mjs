import {projectYear,valueChunks} from './model.mjs';
const sheets='https://sheets.googleapis.com/v4/spreadsheets/';
const drive='https://www.googleapis.com/drive/v3/files';
export async function mirror(claim,{google,rpc,now=Date.now,budgetMs=85000}){
 const started=now(),{target,job,token,rows}=claim;
 const base={employee_id:target.employee_id,year:job.year,version:job.version,token};
 const active=async()=>{if(!(await rpc('check',base))?.active)throw Error('Employee archived; mirror retained');};
 await active();
 let id=target.spreadsheet_id,createdNow=false;
 if(!id){
  // Find a previously created file after an ambiguous network response or DB failure.
  const query="trashed = false and appProperties has { key='fulfillmentEmployee' and value='"+target.employee_id+"' }";
  const found=await google(drive+'?'+new URLSearchParams({q:query,fields:'files(id)',pageSize:'100'}));
  if(found.files?.length>1)throw Error('Multiple employee mirrors found; owner review required');
  id=found.files?.[0]?.id;
  if(!id){
   if(target.create_started_at)throw Error('Earlier file creation is unresolved; owner review required before recreating');
   await rpc('prepare_create',base);
   const created=await google(drive+'?fields=id','POST',{name:target.store_name+' - '+target.serial,mimeType:'application/vnd.google-apps.spreadsheet',appProperties:{fulfillmentEmployee:target.employee_id}});
   id=created.id;
   createdNow=true;
  }
  if(!id)throw Error('Google spreadsheet ID missing');
  await rpc('bind',{...base,spreadsheet_id:id});
 }
 const projection=projectYear(job.year,rows);
 const current=Object.fromEntries(projection.monthly.map(m=>[m.month,m.rows.reduce((n,r)=>Math.max(n,r.position),0)]));current.yearly=projection.yearly.rows.length;
 const high=Object.fromEntries(Object.entries(current).map(([key,n])=>[key,Math.max(n,Number(job.extents[key]||0))]));
 const monthlyTitle='Monthly Statement '+job.year,yearlyTitle='Yearly Statement '+job.year;
 const metadata=await google(sheets+id+'?fields=spreadsheetId,properties(title),sheets(properties)');
 const needed=[{title:monthlyTitle,rowCount:Math.max(2001,...Object.values(high).slice(0,12).map(n=>n+1)),columnCount:303},{title:yearlyTitle,rowCount:Math.max(20001,high.yearly+1),columnCount:17}];
 const requests=[],allocated=new Set((metadata.sheets||[]).map(s=>s.properties.sheetId));
 if(metadata.properties.title!==target.store_name+' - '+target.serial)requests.push({updateSpreadsheetProperties:{properties:{title:target.store_name+' - '+target.serial},fields:'title'}});
 for(const desired of needed){
  const existing=metadata.sheets?.find(s=>s.properties.title===desired.title)?.properties;
  let sheetId=existing?.sheetId??(job.year*10+(desired.title===monthlyTitle?1:2));
  if(!existing){while(allocated.has(sheetId))sheetId++;allocated.add(sheetId);}
  if(!existing)requests.push({addSheet:{properties:{sheetId,title:desired.title,gridProperties:{rowCount:desired.rowCount,columnCount:desired.columnCount,frozenRowCount:1}}}});
  else if(existing.gridProperties.rowCount<desired.rowCount||existing.gridProperties.columnCount<desired.columnCount){
   requests.push({updateSheetProperties:{properties:{sheetId:existing.sheetId,gridProperties:{rowCount:Math.max(existing.gridProperties.rowCount,desired.rowCount),columnCount:Math.max(existing.gridProperties.columnCount,desired.columnCount)}},fields:'gridProperties.rowCount,gridProperties.columnCount'}});
  }
  if(!existing||job.completed_version===0){
   requests.push({repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:1},cell:{userEnteredFormat:{backgroundColor:{red:0.94,green:0.96,blue:0.97},textFormat:{bold:true},wrapStrategy:'WRAP',verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat'}});
   requests.push({updateDimensionProperties:{range:{sheetId,dimension:'ROWS',startIndex:0,endIndex:1},properties:{pixelSize:48},fields:'pixelSize'}});
   requests.push({updateDimensionProperties:{range:{sheetId,dimension:'COLUMNS',startIndex:0,endIndex:desired.columnCount},properties:{pixelSize:150},fields:'pixelSize'}});
  }
 }
 if(createdNow&&metadata.sheets?.length===1&&metadata.sheets[0].properties.title==='Sheet1')requests.push({deleteSheet:{sheetId:metadata.sheets[0].properties.sheetId}});
 if(requests.length)await google(sheets+id+':batchUpdate','POST',{requests});
 let steps=[];
 for(const m of projection.monthly)steps.push(...valueChunks(monthlyTitle,m.startColumn,m.header,m.rows,high[m.month]));
 steps.push(...valueChunks(yearlyTitle,0,projection.yearly.header,projection.yearly.rows.map((values,i)=>({position:i+1,values})),high.yearly));
 // Limit request size without truncating long text. Same input yields identical checkpoints.
 const split=step=>{
  if(JSON.stringify(step).length<800000||step.values.length<=1)return [step];
  const middle=Math.floor(step.values.length/2),match=step.range.match(/^(.*?)(\d+)$/);
  return [...split({...step,values:step.values.slice(0,middle)}),...split({range:match[1]+(Number(match[2])+middle),values:step.values.slice(middle)})];
 };
 const batches=[];let batch=[],size=0;
 for(const step of steps.flatMap(split)){
  const length=JSON.stringify(step).length;
  if(batch.length&&size+length>800000){batches.push(batch);batch=[];size=0;}
  batch.push(step);size+=length;
 }
 if(batch.length)batches.push(batch);
 steps=batches;
 let cursor=job.progress.version===job.version?Number(job.progress.cursor||0):0;
 await rpc('checkpoint',{...base,extents:high,progress:{version:job.version,cursor}});
 for(;cursor<steps.length;cursor++){
  if(now()-started>budgetMs){await rpc('yield',base);return {complete:false,spreadsheet_id:id};}
  await active();
  await google(sheets+id+'/values:batchUpdate','POST',{valueInputOption:'RAW',data:steps[cursor]});
  await rpc('checkpoint',{...base,extents:high,progress:{version:job.version,cursor:cursor+1}});
 }
 await rpc('finish',{...base,extents:current});
 return {complete:true,spreadsheet_id:id};
}
