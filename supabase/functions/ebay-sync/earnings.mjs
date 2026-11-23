// Only eBay's final order earnings amount is retained. No ledger arithmetic.
const DAY=86400000;
export function earningsRecord(order){
 const amount=order?.orderEarningsSummary?.orderEarnings;
 if(!order?.orderId||!amount||typeof amount.value!=='string'||!/^[-]?\d+(?:\.\d+)?$/.test(amount.value)||!Number.isFinite(Number(amount.value))||! /^[A-Z]{3}$/.test(amount.currency||''))throw Error('Invalid direct order earnings response');
 return {id:order.orderId,data:{orderId:order.orderId,orderCreationDate:order.orderCreationDate,orderLastModifiedDate:order.orderLastModifiedDate,source:'ebay_order_earnings',amount:{value:amount.value,currency:amount.currency}}};
}
export async function readEarnings(job,token,request,now=Date.now()){
 const c=job.cursor||{},end=c.end||new Date(now).toISOString(),start=c.start||new Date(now-(job.resource==='order_earnings_recent'?7:60)*DAY).toISOString(),offset=c.offset||0;
 const params=new URLSearchParams({filter:`orderCreationDate:[${start}..${end}]`,limit:'200',offset:String(offset)});
 const response=await request('https://apiz.ebay.com/sell/finances/v1/order_earnings?'+params,token);
 if(!Array.isArray(response.orders)||!Number.isInteger(response.total)||response.total<0)throw Error('Invalid direct order earnings page');
 const records=response.orders.map(earningsRecord),more=!!response.next||offset+records.length<response.total;
 if(more&&records.length===0)throw Error('Incomplete direct order earnings page');
 if(more&&offset+records.length>=10000)throw Error('Earnings window exceeds pagination limit; split date range before continuing');
 return {records,done:!more,cursor:more?{start,end,offset:offset+records.length}:{},watermark:end};
}
