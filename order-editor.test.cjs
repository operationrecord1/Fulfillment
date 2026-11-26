const {test}=require('node:test');const assert=require('node:assert/strict');const E=require('./order-editor.js');const P=require('./ebay-presentation.js');
test('tracking formats do not label ambiguous numeric codes as verified carriers',()=>{assert.equal(E.carrier('TBA123456789012'),'Amazon');assert.equal(E.carrier('1Z 999 AA1 01 2345 6784'),'UPS');assert.equal(E.carrier('9361289685070644846420'),'USPS');for(const x of ['1234567890','123456789012','TBA123','garbage'])assert.equal(E.carrier(x),'');});
test('supplier URLs reject spoofing and credentials',()=>{assert.ok(E.supplierUrl('https://www.amazon.com/dp/B09JW639MH','Amazon'));assert.equal(E.supplierUrl('https://amazon.com.evil.org/a','Amazon'),null);assert.equal(E.supplierUrl('https://user:pw@amazon.com/a','Amazon'),null);assert.equal(E.supplierUrl('https://alibaba.com/a','Amazon'),null);});
test('manual buying price changes profit without altering actual order earnings',()=>{const r={data:{},earnings:{value:-5,currency:'USD'},edit:{data:{buy_price:0,note:'',tracking:'TBA123456789012',status:'Pending'}},workspace_rows:[{data:{product_cost:99,note:'old'}}]};const m=P.order(r);assert.equal(m.cost,0);assert.equal(m.earning,-5);assert.equal(m.gross,-5);assert.deepEqual(m.note,[]);assert.deepEqual(m.tracking,['TBA123456789012']);assert.deepEqual(m.localStatus,['Pending']);});
test('add tracking accepts complete supported formats, not partial input',()=>{for(const x of ['TBA123456789012','1Z999AA10123456784','9361289685070644846420','1234567890','123456789012','123456789012345'])assert.equal(E.trackingFormat(x),true,x);for(const x of ['','TBA123','test','12345'])assert.equal(E.trackingFormat(x),false,x);});
test('empty tracking slots disappear and remaining tracking survives first removal',()=>{assert.deepEqual(E.trackingList(['','TBA123456789012','  ']),['TBA123456789012']);assert.deepEqual(E.trackingList(['','']),[]);assert.deepEqual(E.trackingList(['ABC','ABC']),['ABC']);const r={data:{},edit:{data:{tracking:''}},workspace_rows:[{data:{tracking:'OLD'}}]};assert.deepEqual(P.order(r).tracking,[]);});

// Exercise the real editor input listeners and save payload without a network write.
function editorHarness(row){
 const fs=require('node:fs'),vm=require('node:vm'),calls=[],saved=[];
 function element(){let value='';return {tagName:'INPUT',readOnly:false,events:{},style:{setProperty(){}},dataset:{},children:[],attributes:{},get value(){return value;},set value(x){value=String(x??'');},addEventListener(name,fn){(this.events[name]??=[]).push(fn);},setAttribute(name,val){this.attributes[name]=val;},focus(){},querySelectorAll(){return [];}};}
 const elements={namedItem(name){return this[name]||null;}},form={elements,addEventListener(){},querySelectorAll(){return [];},querySelector(){return submit;}},submit=element(),nodes=new Map();
 const tabs=['Order','Product','Buyer'].map(name=>Object.assign(element(),{dataset:{tab:name}}));
 const panels=tabs.map(tab=>Object.assign(element(),{id:'edit-panel-'+tab.dataset.tab}));
 const dialog={open:false,markup:'',set innerHTML(html){this.markup=html;for(const m of html.matchAll(/<(input|select|textarea)\b([^>]*\bname="([^"]+)"[^>]*)>/g)){const el=element();el.readOnly=/\breadonly\b/.test(m[2]);el.markup=m[0];elements[m[3]]=el;}},querySelector(selector){if(selector==='form')return form;if(selector==='[data-tab=Order]')return tabs[0];if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);},querySelectorAll(selector){if(selector==='[data-tab]')return tabs;if(selector==='[role=tabpanel]')return panels;if(selector==='input[readonly]')return Object.values(elements).filter(x=>x?.readOnly);if(selector==='#edit-panel-Buyer input')return ['first_name','last_name','phone','address1','address2','city','state','zip','country'].map(x=>elements[x]);return [];},showModal(){this.open=true;},close(){this.open=false;},remove(){}};
 const context={window:{EbayPresentation:P,OrderCore:{statuses:['Pending'],link:value=>({text:String(value||'')})}},document:{createElement(){return dialog;}},Intl,URL,setTimeout};
 vm.runInNewContext(fs.readFileSync(require.resolve('./order-editor.js'),'utf8'),context);
 const editor=context.window.OrderEditor.mount({container:{append(){}},client:{async rpc(name,args){calls.push({name,args});return {data:{data:{...row.edit?.data,...args.changes},revision:(row.edit?.revision||0)+1}};}},storeId:'store-a',onSave:value=>saved.push(value)});
 editor.open(row);
 return {dialog,form,elements,calls,saved,fire(name,event){for(const fn of elements[name].events[event]||[])fn();},submit:()=>form.onsubmit({preventDefault(){}})};
}

test('buying price accepts a negative amount and saves the signed value to the same order',async()=>{
 const h=editorHarness({id:'order-a',data:{},earnings:{value:-5,currency:'USD'},edit:{data:{buy_price:5},revision:4}});
 assert.doesNotMatch(h.elements.buy_price.markup,/\bmin="0"/);
 assert.match(h.elements.shipping_cost.markup,/\bmin="0"/);
 assert.match(h.elements.additional_cost.markup,/\bmin="0"/);
 assert.equal(h.elements.profit_preview.value,'-$10.00');
 h.elements.buy_price.value='-7.5';h.fire('buy_price','input');h.fire('buy_price','blur');
 assert.equal(h.elements.buy_price.value,'-7.50');assert.equal(h.elements.profit_preview.value,'$2.50');
 await h.submit();assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].name,'ebay_order_edit_save');
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args)),{target:'store-a',order_id:'order-a',changes:{buy_price:-7.5},expected_revision:4});
 assert.equal(h.saved.length,1);assert.equal(h.saved[0].edit.data.buy_price,-7.5);
});

test('explicit zero remains recorded and clearing buying price sends null',async()=>{
 for(const [input,expected,preview] of [['0',0,'-$5.00'],['',null,'Not Recorded']]){
  const h=editorHarness({id:'order-a',data:{},earnings:{value:-5,currency:'USD'},edit:{data:{buy_price:5},revision:1}});
  h.elements.buy_price.value=input;h.fire('buy_price','input');assert.equal(h.elements.profit_preview.value,preview);
  await h.submit();assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args.changes)),{buy_price:expected});
 }
});

test('negative buying price stays pending until order earnings become available',()=>{
 const r={data:{},earnings:{value:null,currency:'USD'},edit:{data:{buy_price:-5,shipping_cost:2,additional_cost:1}}};
 assert.equal(P.order(r).cost,-5);assert.equal(P.order(r).gross,null);
 r.earnings.value=10;assert.equal(P.order(r).totalCost,-2);assert.equal(P.order(r).gross,12);
});

test('status menu has no blank choice and arbitrary buy IDs survive saving',async()=>{
 for(const value of ['0','ABCD','FBA Order','1']){
  const h=editorHarness({id:'order-a',data:{},edit:{data:{},revision:1}});
  const status=h.dialog.markup.match(/<select aria-label="Status"[\s\S]*?<\/select>/)[0];assert.doesNotMatch(status,/<option value="">/);
  h.elements.purchase_id.value=value;h.fire('purchase_id','input');await h.submit();
  assert.equal(h.calls[0].args.changes.purchase_id,value);assert.equal(P.orderStatus(h.saved[0]),'Ordered');
 }
});
test('saving each buying amount advances status without persisting a derived override',async()=>{
 for(const key of ['buy_price','shipping_cost','additional_cost']){
  const h=editorHarness({id:'order-a',data:{},edit:{data:{},revision:1}});h.elements[key].value='0';await h.submit();
  assert.equal(h.calls[0].args.changes[key],0);assert.equal(Object.hasOwn(h.calls[0].args.changes,'status'),false);assert.equal(P.orderStatus(h.saved[0]),'Ordered');
 }
});
