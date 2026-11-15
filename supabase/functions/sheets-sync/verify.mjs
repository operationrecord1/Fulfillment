import {projectYear,columnName} from './model.mjs';
export async function verifyMirror(snapshot,google){
 const {target,job,rows}=snapshot,id=target.spreadsheet_id;
 if(!id)throw Error('Mirror has not been created');
 const p=projectYear(job.year,rows),ranges=[],expected=[];
 for(const m of p.monthly){
  const extent=Math.max(2000,Number(job.extents[m.month]||0),m.rows.reduce((max,r)=>Math.max(max,r.position),0));
  ranges.push("'Monthly Statement "+job.year+"'!"+columnName(m.startColumn)+'1:'+columnName(m.startColumn+16)+(extent+1));
  const byPosition=new Map(m.rows.map(r=>[r.position,r.values]));
  expected.push([m.header,...Array.from({length:extent},(_,i)=>byPosition.get(i+1)||[])]);
 }
 ranges.push("'Yearly Statement "+job.year+"'!A1:Q"+(Math.max(20000,p.yearly.rows.length,Number(job.extents.yearly||0))+1));
 expected.push([p.yearly.header,...p.yearly.rows]);
 const params=new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE'});ranges.forEach(r=>params.append('ranges',r));
 const response=await google('https://sheets.googleapis.com/v4/spreadsheets/'+id+'/values:batchGet?'+params);
 const mismatches=[];
 for(let i=0;i<ranges.length;i++){
  const actual=response.valueRanges?.[i]?.values||[],want=expected[i];
  for(let r=0;r<Math.max(want.length,actual.length);r++)for(let c=0;c<17;c++){
   if(String(actual[r]?.[c]??'')!==String(want[r]?.[c]??''))mismatches.push({block:i+1,row:r+1,column:c+1});
  }
 }
 const file=await google('https://www.googleapis.com/drive/v3/files/'+id+'?fields=owners(emailAddress),appProperties');
 const ownerMatches=file.owners?.some(o=>o.emailAddress==='operation.record1@gmail.com')===true;
 const identityMatches=file.appProperties?.fulfillmentEmployee===target.employee_id;
 return {ok:mismatches.length===0&&ownerMatches&&identityMatches,source_rows:rows.length,blocks_checked:ranges.length,mismatch_count:mismatches.length,mismatch_locations:mismatches.slice(0,10),owner_matches:ownerMatches,identity_matches:identityMatches,revision_synced:job.version===job.completed_version};
}
