import {XMLParser,XMLValidator} from 'npm:fast-xml-parser@5.3.0';
const parser=new XMLParser({parseTagValue:false,ignoreAttributes:true,processEntities:true});
const array=x=>x==null?[]:Array.isArray(x)?x:[x];
export const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export async function trading(call,body,token,fetcher=fetch){
 const response=await fetcher('https://api.ebay.com/ws/api.dll',{method:'POST',headers:{'Content-Type':'text/xml','X-EBAY-API-CALL-NAME':call,'X-EBAY-API-SITEID':'0','X-EBAY-API-COMPATIBILITY-LEVEL':'1489','X-EBAY-API-IAF-TOKEN':token},body:`<${call}Request xmlns="urn:ebay:apis:eBLBaseComponents">${body}</${call}Request>`,signal:AbortSignal.timeout(20000)});
 const text=await response.text();if(XMLValidator.validate(text)!==true)throw Error('Invalid eBay Note Response');
 const data=parser.parse(text)[call+'Response'];
 if(!response.ok||!['Success','Warning'].includes(data?.Ack)){
  const codes=array(data?.Errors).filter(e=>e.SeverityCode==='Error').map(e=>e.ErrorCode).join(',');
  throw Error('eBay Note Request Failed'+(codes?' ('+codes+')':' (HTTP '+response.status+')'));
 }return data;
}
export function notesFromPage(data){
 const result=[];
 for(const group of array(data?.SoldList?.OrderTransactionArray?.OrderTransaction)){
  const transactions=group.Order?array(group.Order.TransactionArray?.Transaction):array(group.Transaction);
  for(const t of transactions){if(!t.OrderLineItemID)throw Error('Missing eBay Order Line ID');result.push({line_id:String(t.OrderLineItemID),note:String(t.Item?.PrivateNotes||'')});}
 }return result;
}
export async function readNotes(token,fetcher=fetch){
 let result=[];
 for(let page=1;page<=125;page++){
  const data=await trading('GetMyeBaySelling',`<SoldList><Include>true</Include><IncludeNotes>true</IncludeNotes><DurationInDays>60</DurationInDays><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></SoldList>`,token,fetcher);
  result.push(...notesFromPage(data));
  const total=Number(data.SoldList?.PaginationResult?.TotalNumberOfPages||0);
  if(!Number.isInteger(total)||total>125)throw Error('Invalid eBay Note Pagination');
  if(page>=total)return result;
 }throw Error('eBay Note Pagination Limit Reached');
}
export async function writeNote(lineIds,note,token,fetcher=fetch){
 if(!Array.isArray(lineIds)||!lineIds.length||lineIds.some(x=>!/^\d+-\d+$/.test(x)))throw Error('Order Line IDs Are Not Available');
 if([...note].length>255)throw Error('eBay Notes Allow Up to 255 Characters');
 for(const id of lineIds)await trading('SetUserNotes',`<Action>${note?'AddOrUpdate':'Delete'}</Action><OrderLineItemID>${xml(id)}</OrderLineItemID>${note?'<NoteText>'+xml(note)+'</NoteText>':''}`,token,fetcher);
}
