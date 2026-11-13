// Inline styles are intentional: email clients do not consistently inherit fonts.
const font = 'Arial,Helvetica,sans-serif';
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function paragraph(html) {
  return `<p style="margin:0 0 18px;font-family:${font};font-size:15px;line-height:1.7;color:#41464d;overflow-wrap:anywhere;word-break:break-word">${html}</p>`;
}
export function button(label, href) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0"><tr><td bgcolor="#171717" style="border-radius:8px;text-align:center"><a href="${escapeHtml(href)}" style="display:inline-block;border:1px solid #171717;border-radius:8px;padding:14px 24px;font-family:${font};font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;mso-padding-alt:0">${escapeHtml(label)}</a></td></tr></table>`;
}
export function notice(html) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;margin:24px 0 0"><tr><td style="padding:18px 20px;background:#f5f6f7;border:1px solid #e7e9ec;border-radius:8px;font-family:${font};font-size:13px;line-height:1.65;color:#555d66;overflow-wrap:anywhere;word-break:break-word">${html}</td></tr></table>`;
}
export function details(rows) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;margin:24px 0;border-top:1px solid #e7e9ec">${rows.map(([label,value])=>`<tr><td style="padding:13px 0;border-bottom:1px solid #e7e9ec;font-family:${font};font-size:13px;line-height:1.6;color:#626973;width:30%;vertical-align:top">${escapeHtml(label)}</td><td style="padding:13px 0 13px 14px;border-bottom:1px solid #e7e9ec;font-family:${font};font-size:14px;line-height:1.6;font-weight:700;color:#202124;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(value)}</td></tr>`).join('')}</table>`;
}
export function shell(title, body, preheader = title) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title><style>@media only screen and (max-width:600px){.email-outer{padding:20px 12px!important}.email-content{padding:30px 22px!important}.email-title{font-size:28px!important;line-height:1.2!important}.email-brand{padding-bottom:24px!important}}a:hover{opacity:.85}</style></head>
<body style="margin:0;padding:0;background:#f6f7f8;color:#202124;font-family:${font};-webkit-text-size-adjust:100%;text-size-adjust:100%">
<div style="display:none;font-size:1px;color:#f6f7f8;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;background:#f6f7f8"><tr><td class="email-outer" align="center" style="padding:40px 20px">
<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;table-layout:fixed"><tr><td class="email-brand" align="center" style="padding:0 0 28px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td width="32" height="32" bgcolor="#27856a" style="width:32px;height:32px;border-radius:8px;text-align:center;font-family:${font};font-size:20px;line-height:32px;font-weight:700;color:#ffffff">F</td><td style="padding-left:10px;font-family:${font};font-size:19px;line-height:28px;font-weight:700;letter-spacing:-.4px;color:#202124">Fulfillment</td></tr></table></td></tr>
<tr><td class="email-content" bgcolor="#ffffff" style="padding:40px;border:1px solid #e3e6e9;border-radius:12px;font-family:${font};overflow-wrap:anywhere;word-break:break-word"><h1 class="email-title" style="margin:0 0 24px;font-family:${font};font-size:32px;line-height:1.2;font-weight:700;letter-spacing:-.8px;color:#171717;overflow-wrap:anywhere;word-break:normal">${escapeHtml(title)}</h1>${body}</td></tr>
<tr><td align="center" style="padding:24px 16px 0;font-family:${font};font-size:12px;line-height:1.7;color:#737a83">Fulfillment Account Services<br>This is an automated message from Fulfillment.</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
export function acknowledgementEmail(name, role, store) {
  return shell('Your Request Is Received', paragraph(`Hello ${escapeHtml(name)},`)+paragraph(`Thank you for requesting <strong>${escapeHtml(role)}</strong> access${store?` to <strong>${escapeHtml(store)}</strong>`:''}. Your request is now waiting for the owner’s review.`)+notice('<strong>What happens next?</strong><br>We’ll email you when a decision is made. If approved, you’ll receive a secure link to set your password. No password is needed while you wait.'), 'Your access request is waiting for owner review.');
}
export function approvalEmail(name, role, store, href) {
  return shell('Your Access Is Approved', paragraph(`Hello ${escapeHtml(name)},`)+paragraph(`Your <strong>${escapeHtml(role)}</strong> access is approved. Set your password to finish setting up your account.`)+(store?details([['Store',store],['Access','View-only']]):'')+button('Set Password',href)+paragraph(store?'After setting your password, sign in with this email to view your approved store.':'After setting your password, sign in with this email and enter your store name to connect your workspace.')+notice('If the setup link expires, select <a href="https://fulfilment.site/#forgot-password" style="font-family:Arial,Helvetica,sans-serif;color:#202124;font-weight:700;text-decoration:underline">Forgot Password</a> on the sign-in page to request a new one.'), 'Your account is approved. Set your password to get started.');
}
export function ownerEmail(request, role) {
  const rows=[['Name',request.full_name],['Email',request.email],['Access',role]];
  if(request.store_name)rows.push(['Store',request.store_name]);
  rows.push(['Request ID',request.id]);
  return shell('New Access Request', paragraph('A new request is ready for your review. Review the details below before approving or declining access.')+details(rows)+paragraph('Open the access requests table in your Supabase dashboard to review this request.'), 'A new Fulfillment access request is ready for review.');
}
export function resetEmail(href) {
  return shell('Reset Your Password', paragraph('We received a request to reset your Fulfillment password. Select the button below to choose a new password.')+button('Reset Password',href)+paragraph('This link expires in <strong>30 minutes</strong>.')+notice('<strong>Didn’t request a reset?</strong><br>You can safely ignore this email. Your password will stay the same.')+`<p style="margin:24px 0 0;font-family:${font};font-size:12px;line-height:1.7;color:#737a83">For your security, only use a reset link you requested from Fulfillment. Never share this email or link.</p>`, 'Use this secure link to reset your Fulfillment password.');
}
