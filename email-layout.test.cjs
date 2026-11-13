const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  const m=await import('./supabase/functions/fulfillment-access/email-layout.mjs');
  const name='<img src=x onerror="bad()">';
  for(const html of [m.acknowledgementEmail(name,'Investor',name),m.approvalEmail(name,'Investor',name,'https://fulfilment.site/#activate?token_hash=abc&type=invite'),m.ownerEmail({full_name:name,email:name,store_name:name,id:name},'Investor')]){
    assert(!html.includes('<img'));
    assert(html.includes('&lt;img'));
  }
  const approval=m.approvalEmail('Alex','Investor','Store','https://fulfilment.site/#activate?token_hash=abc&type=invite');
  assert(approval.includes('token_hash=abc&amp;type=invite'));
  assert(approval.includes('View-only'));
  assert(!approval.includes('enter your store name'));
  assert(m.approvalEmail('Alex','Employee',null,'https://fulfilment.site/#activate').includes('enter your store name'));
  const recovery=m.resetEmail('{{ .ConfirmationURL }}');
  assert(recovery.includes('href="{{ .ConfirmationURL }}"'));
  assert(recovery.includes('30 minutes'));
  assert.equal(fs.readFileSync('supabase/templates/recovery.html','utf8'),recovery);
  console.log('Email escaping, secure links, role-specific instructions and recovery artifact passed');
})().catch(e=>{console.error(e);process.exit(1)});
