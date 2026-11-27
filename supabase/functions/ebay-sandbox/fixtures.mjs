import {sandboxTransport,API,SandboxError,xmlEscape} from './provider.mjs';
export async function categoryOptions(token,fetcher=fetch){
 const get=async path=>{const r=await sandboxTransport(fetcher)(API+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});const d=await r.json().catch(()=>null);if(!r.ok||!d)throw new SandboxError('Sandbox category API '+r.status,r.status);return d;};
 const tree=await get('/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US');
 if(!/^\d+$/.test(String(tree.categoryTreeId)))throw Error('Category tree unavailable');
 const d=await get('/commerce/taxonomy/v1/category_tree/'+tree.categoryTreeId+'/get_category_suggestions?q=school%20notebook');
 return (d.categorySuggestions||[]).map(x=>({id:x.category?.categoryId,name:x.category?.categoryName,path:(x.categoryTreeNodeAncestors||[]).map(a=>a.categoryName).join(' > ')})).filter(x=>/^\d+$/.test(x.id)).slice(0,10);
}
export function fixture(slot,category,uuid){
 if(![1,2].includes(slot)||!/^\d{1,10}$/.test(String(category))||!/^[A-F0-9]{32}$/.test(uuid))throw Error('Invalid test fixture');
 const title='SANDBOX TEST ONLY - Creston Notebook '+slot;
 const sku='CRESTON-SANDBOX-'+uuid;
 const xml='<Item><Title>'+title+'</Title><Description>Sandbox integration test only. Simulated notebook. No physical item or real shipment.</Description><PrimaryCategory><CategoryID>'+category+'</CategoryID></PrimaryCategory><StartPrice currencyID="USD">9.99</StartPrice><ConditionID>1000</ConditionID><Country>US</Country><Currency>USD</Currency><DispatchTimeMax>3</DispatchTimeMax><ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType><Quantity>5</Quantity><PostalCode>95125</PostalCode><Location>San Jose, CA</Location><Site>US</Site><SKU>'+sku+'</SKU><InventoryTrackingMethod>SKU</InventoryTrackingMethod><UUID>'+uuid+'</UUID><PictureDetails><PictureURL>https://fulfilment.site/sandbox-test-notebook.png</PictureURL></PictureDetails><ItemSpecifics><NameValueList><Name>Brand</Name><Value>Unbranded</Value></NameValueList></ItemSpecifics><ReturnPolicy><ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption><ReturnsWithinOption>Days_30</ReturnsWithinOption><ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption></ReturnPolicy><ShippingDetails><ShippingType>Flat</ShippingType><ShippingServiceOptions><ShippingServicePriority>1</ShippingServicePriority><ShippingService>USPSGroundAdvantage</ShippingService><ShippingServiceCost currencyID="USD">0.00</ShippingServiceCost><FreeShipping>true</FreeShipping></ShippingServiceOptions></ShippingDetails></Item>';
 return {title,sku,xml};
}
export function fixtureLookup(sku){return '<SKU>'+xmlEscape(sku)+'</SKU><DetailLevel>ReturnAll</DetailLevel>';}
