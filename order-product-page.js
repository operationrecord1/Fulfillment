(function(){'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.OrderProductPage={mount({container,client,storeId,orderId}){
 let disposed=false;
 container.className='order-product-page';
 container.innerHTML='<a href="#workspace/orders" class="product-back">← Back to Orders</a><h1>Edit Product</h1><p class="product-page-status" role="status">Loading Product Information…</p><div class="product-page-items"></div><button type="button" class="product-retry" hidden>Try Again</button>';
 async function load(){
  const status=container.querySelector('[role=status]'),retry=container.querySelector('.product-retry');retry.hidden=true;status.textContent='Loading Product Information…';
  try{
   const {data,error}=await client.functions.invoke('ebay-product',{body:{store_id:storeId,order_id:orderId}});if(disposed)return;if(error||data?.error)throw Error(data?.error||'Product Details Could Not Load. Please Try Again.');
   container.querySelector('.product-page-items').innerHTML=data.items.map(p=>{
    const template=document.createElement('template');template.innerHTML=p.description;template.content.querySelectorAll('script,style,noscript').forEach(x=>x.remove());template.content.querySelectorAll('br,p,div,li,h1,h2,h3').forEach(x=>x.append(document.createTextNode('\n')));const description=template.content.textContent.trim();
    let image='';try{const u=new URL(p.image);if(u.protocol==='https:'&&/(^|\.)ebayimg\.com$/.test(u.hostname))image=u.href;}catch{}
    return '<article><header>'+(image?'<img src="'+esc(image)+'" alt="">':'')+'<div><h2>'+esc(p.title)+'</h2><p>Item ID · '+esc(p.id)+'</p></div></header><dl><div><dt>Order Quantity</dt><dd>'+esc(p.order_quantity)+'</dd></div><div><dt>Listing Quantity</dt><dd>'+esc(p.quantity??'—')+'</dd></div><div><dt>Quantity Sold</dt><dd>'+esc(p.quantity_sold??'—')+'</dd></div></dl><h3>Description</h3><div class="product-description">'+esc(description||'No Description Available')+'</div></article>';
   }).join('');status.textContent='Product Information · Read Only';
  }catch(e){if(!disposed){status.textContent=e.message;retry.hidden=false;}}
 }
 container.querySelector('.product-retry').onclick=load;load();return {dispose(){disposed=true;container.remove();}};
}};
})();
