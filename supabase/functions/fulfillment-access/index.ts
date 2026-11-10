import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://fulfilment.site",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-fulfillment-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string,string>;
const serviceKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const appUrl = "https://fulfilment.site";
const fromAddress = Deno.env.get("FULFILLMENT_FROM_EMAIL") ?? "Fulfillment <no-reply@mail.fulfilment.site>";
const ownerEmail = Deno.env.get("FULFILLMENT_ADMIN_EMAIL") ?? "operationrecord1@gmail.com";

function esc(v: string) { return v.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!)); }
function shell(title: string, body: string) {
  return '<!doctype html><html lang="en"><body style="margin:0;padding:0;background:#f5f6f5;font-family:Arial,Helvetica,sans-serif;color:#202420"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f6f5"><tr><td align="center" style="padding:32px 16px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#fff;border:1px solid #e7eae7;border-radius:12px"><tr><td style="padding:32px 32px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:34px;height:34px;border-radius:8px;background:#27856a;color:#fff;text-align:center;font-weight:700;font-size:20px">F</td><td style="padding-left:10px;font-size:17px;font-weight:700;letter-spacing:-.3px">Fulfillment</td></tr></table></td></tr><tr><td style="padding:28px 32px 0"><h1 style="margin:0 0 14px;font-size:26px;line-height:1.2;letter-spacing:-.5px;color:#202420">' + title + '</h1>' + body + '<p style="margin:26px 0 0;color:#808984;font-size:11px;line-height:1.5">Fulfillment account services</p></td></tr><tr><td style="padding:20px 16px;color:#8b938e;text-align:center;font-size:11px;line-height:1.5">This is an automated message from Fulfillment.</td></tr></table></td></tr></table></body></html>';
}
function button(label:string, href:string) { return '<a href="' + esc(href) + '" style="display:inline-block;margin-top:8px;background:#202020;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">' + esc(label) + '</a>'; }
async function sendMail(to:string, subject:string, htmlContent:string) {
  const key=Deno.env.get("BREVO_API_KEY"); if(!key)return false;
  const response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":key,"accept":"application/json","content-type":"application/json"},body:JSON.stringify({sender:{name:"Fulfillment",email:fromAddress.match(/<([^>]+)>/)?.[1]??fromAddress},to:[{email:to}],subject,htmlContent})});
  if(!response.ok)throw new Error("Email provider returned " + response.status);
  return true;
}
function normalizeName(v:string){return v.trim().replace(/\s+/g," ").slice(0,120);}
function nameKey(v:string){return normalizeName(v).toLocaleLowerCase("en-US");}
async function storeByName(v:string){
  const k=nameKey(v); if(k.length<2)return null;
  const {data,error}=await admin.from("stores").select("id,name").eq("name_normalized",k).maybeSingle();
  if(error)throw error;return data;
}
async function userFrom(req:Request){
  const token=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");if(!token)return null;
  const {data,error}=await admin.auth.getUser(token);if(error||!data.user)return null;return data.user;
}
async function adminUser(req:Request){
  const user=await userFrom(req);if(!user)return {error:json({error:"Authentication required."},401)};
  const {data,error}=await admin.from("profiles").select("role,is_active").eq("user_id",user.id).maybeSingle();
  if(error||!data||data.role!=="admin"||!data.is_active)return {error:json({error:"Active administrator access required."},403)};
  return {user};
}
async function findUser(email:string){
  for(let page=1;page<=20;page++){const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});if(error)throw error;const u=data.users.find(x=>x.email?.toLowerCase()===email.toLowerCase());if(u)return u;if(data.users.length<1000)break;}
  return null;
}
async function revertStatus(table:string,id:string){
  if(table==="access_requests")await admin.from(table).update({status:"pending"}).eq("id",id);
  else await admin.from(table).update({status:"pending"}).eq("id",id);
}
async function handleAccessStatus(rec:any,old:any){
  if(!rec?.id||old?.status!=="pending"||!["approved","rejected"].includes(rec.status))return;
  if(!Deno.env.get("BREVO_API_KEY")){await revertStatus("access_requests",rec.id);return;}
  const {data:r,error}=await admin.from("access_requests").select("*").eq("id",rec.id).maybeSingle();if(error)throw error;if(!r)return;
  if(rec.status==="rejected"){
    const sent=await sendMail(r.email,"Update on your Fulfillment access request",shell("Request update",'<p style="font-size:15px;line-height:1.7">Hello '+esc(r.full_name)+', your Fulfillment access request was not approved. If you believe this is a mistake, contact the Fulfillment owner.</p>'));
    if(!sent){await revertStatus("access_requests",rec.id);return;}
    const rejectedAccount=await findUser(r.email);
    if(rejectedAccount){
      const {data:rejectedProfile}=await admin.from("profiles").select("role,is_active").eq("user_id",rejectedAccount.id).maybeSingle();
      if(rejectedProfile&&!rejectedProfile.is_active&&rejectedProfile.role!=="admin"){
        const {error:deleteError}=await admin.auth.admin.deleteUser(rejectedAccount.id);
        if(deleteError)console.error("Could not remove rejected inactive account",deleteError);
      }
    }
    return;
  }
  const role=r.requested_role;if(!["staff","investor"].includes(role)){await revertStatus("access_requests",rec.id);return;}
  let store=null;if(role==="investor"){store=await storeByName(r.store_name||"");if(!store){await revertStatus("access_requests",rec.id);return;}}
  const existing=await findUser(r.email);
  let profile:any=null;
  if(existing){
    const {data:p,error:profileLookupError}=await admin.from("profiles").select("role,is_active,store_id").eq("user_id",existing.id).maybeSingle();
    if(profileLookupError)throw profileLookupError;
    profile=p;
    if(profile?.is_active){await revertStatus("access_requests",rec.id);return;}
  }
  const linkType:"invite"|"recovery"|"magiclink"=!existing?"invite":existing.email_confirmed_at?"recovery":"magiclink";
  const linkOptions:any={redirectTo:appUrl+"/#activate"};
  if(linkType==="invite")linkOptions.data={full_name:r.full_name};
  const {data:linkData,error:linkError}=await admin.auth.admin.generateLink({type:linkType,email:r.email,options:linkOptions});
  if(linkError)throw linkError;
  const account=linkData.user??existing;
  const created=!existing;
  const tokenHash=linkData.properties?.hashed_token;
  if(!account?.id||!tokenHash){
    if(created&&account?.id)await admin.auth.admin.deleteUser(account.id);
    throw new Error("Secure password setup link was not generated.");
  }
  const passwordLink=appUrl+"/#activate?token_hash="+encodeURIComponent(tokenHash)+"&type="+linkType;
  const roleLabel=role==="staff"?"Employee":"Investor";
  const storeText=store?'<p style="font-size:15px;line-height:1.7">Your approved store is <strong>'+esc(store.name)+'</strong>. Your access is view-only.</p>':"";
  const {error:profileError}=await admin.from("profiles").upsert({user_id:account.id,email:r.email,display_name:r.full_name,role,is_active:true,store_id:store?.id??profile?.store_id??null,updated_at:new Date().toISOString()},{onConflict:"user_id"});
  const rollback=async()=>{
    await admin.from("profiles").update({is_active:false,updated_at:new Date().toISOString()}).eq("user_id",account.id);
    if(created)await admin.auth.admin.deleteUser(account.id);
    await revertStatus("access_requests",rec.id);
  };
  if(profileError){if(created)await admin.auth.admin.deleteUser(account.id);await revertStatus("access_requests",rec.id);throw profileError;}
  let sent=false;
  try{
    sent=await sendMail(r.email,"Your Fulfillment access is approved",shell("Your access is approved",'<p style="font-size:15px;line-height:1.7">Hello '+esc(r.full_name)+', your <strong>'+roleLabel+'</strong> account is approved.</p>'+storeText+'<p style="font-size:15px;line-height:1.7">'+(role==="investor"?"Your account has view-only access to the approved store.":"On your first sign-in, enter your store name to connect your workspace.")+'</p><p style="font-size:15px;line-height:1.7">Use the secure link below to set your password. After setting it, sign in with this email and password. If the link expires, use <a href="'+esc(appUrl+"/#forgot-password")+'" style="color:#146b55;font-weight:700">Forgot Password</a> to request another one.</p>'+button("Set password",passwordLink)));
  }catch(e){await rollback();throw e;}
  if(!sent){await rollback();return;}
}
async function handleDeletionStatus(rec:any,old:any){
  if(!rec?.id||old?.status!=="pending"||!["approved","rejected"].includes(rec.status))return;
  if(!Deno.env.get("BREVO_API_KEY")){await revertStatus("account_deletion_requests",rec.id);return;}
  const {data:r,error}=await admin.from("account_deletion_requests").select("*").eq("id",rec.id).maybeSingle();if(error)throw error;if(!r)return;
  if(rec.status==="rejected"){
    await sendMail(r.email,"Update on your Fulfillment account request",shell("Request update",'<p style="font-size:15px;line-height:1.7">Your account deletion request was not approved. Your account remains active.</p>'));return;
  }
  if(r.user_id){const {error:de}=await admin.auth.admin.deleteUser(r.user_id);if(de){await revertStatus("account_deletion_requests",rec.id);throw de;}}
  try{await sendMail(r.email,"Your Fulfillment account was deleted",shell("Account deleted",'<p style="font-size:15px;line-height:1.7">Your request was approved and your Fulfillment account has been deleted.</p>'));}catch(e){console.error("deletion confirmation email failed",e);}
}
async function notifyRequest(r:any){
  const label=r.requested_role==="staff"?"Employee":"Investor";
  const store=r.store_name?' for <strong>'+esc(r.store_name)+'</strong>':"";
  const applicant=shell("We received your access request",'<p style="font-size:15px;line-height:1.7">Hello '+esc(r.full_name)+',</p><p style="font-size:15px;line-height:1.7">Your request for <strong>'+label+'</strong> access'+store+' is pending owner review. We’ll email you when the owner makes a decision.</p><p style="font-size:15px;line-height:1.7">No password is needed to apply. If approved, your approval email will include a secure link to set one.</p>');
  const owner=shell("New access request",'<p style="font-size:15px;line-height:1.7"><strong>'+esc(r.full_name)+'</strong> ('+esc(r.email)+') requested <strong>'+label+'</strong>'+ (r.store_name?' access to '+esc(r.store_name):'')+'.</p><p style="font-size:13px;color:#63727c">Request ID: '+r.id+'. Review in Supabase Table Editor.</p>');
  const a=await sendMail(r.email,"We received your Fulfillment access request",applicant);
  if(!a)return {email_sent:false,owner_notified:false};
  const b=await sendMail(ownerEmail,"New Fulfillment access request",owner);
  return {email_sent:true,owner_notified:b};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);
  if(!serviceKey)return json({error:"Server admin key is not configured."},503);
  try{
    const body=await req.json();const action=String(body.action||"");
    if(action==="process_database_event"){
      const token=req.headers.get("x-fulfillment-webhook-secret")||"";
      const {data,error}=await admin.rpc("verify_fulfillment_webhook",{candidate:token});
      if(error||data!==true)return json({error:"Not authorized."},401);
      if(body.table!=="access_requests"&&body.table!=="account_deletion_requests")return json({error:"Unsupported event."},400);
      try{
        if(body.table==="access_requests")await handleAccessStatus(body.record,body.old_record);
        else await handleDeletionStatus(body.record,body.old_record);
      }catch(e){
        await revertStatus(body.table,body.record?.id);
        throw e;
      }
      return json({ok:true});
    }
    if(action==="check_store"){
      const name=normalizeName(String(body.store_name||""));if(name.length<2)return json({exists:false});
      const store=await storeByName(name);return json({exists:!!store,store_name:store?.name??null});
    }
    if(action==="submit_request"){
      const full_name=String(body.full_name||"").trim();const email=String(body.email||"").trim().toLowerCase();
      const role=String(body.requested_role||"");const message=String(body.message||"").trim();
      if(!full_name||full_name.length>120||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!["staff","investor"].includes(role)||message.length>200)
        return json({error:"Please check the request details."},400);
      let storeName=null;
      if(role==="investor"){
        const input=normalizeName(String(body.store_name||""));if(!input)return json({error:"Enter the store name you are requesting access to."},400);
        const store=await storeByName(input);if(!store)return json({error:"This store doesn't exist.",store_missing:true},400);storeName=store.name;
      }
      const {data:pending,error:lookupError}=await admin.from("access_requests").select("id").eq("email",email).eq("status","pending").limit(1).maybeSingle();if(lookupError)throw lookupError;
      if(pending)return json({ok:true,already_pending:true,email_sent:false});
      const existing=await findUser(email);
      if(existing){
        const {data:p,error:profileError}=await admin.from("profiles").select("role,is_active").eq("user_id",existing.id).maybeSingle();if(profileError)throw profileError;
        if(p?.is_active){
          const roleLabel=p.role==="staff"?"Employee":p.role==="investor"?"Investor":null;
          const message=roleLabel
            ?"An "+roleLabel+" account already exists with this email. Please sign in."
            :"This email already has active access. Please sign in or contact the owner.";
          return json({error:message,code:"active_account"});
        }
      }
      const {data:slot,error:slotError}=await admin.rpc("reserve_access_request_slot",{request_email:email});if(slotError)throw slotError;
      if(!slot)return json({error:"Please wait before submitting another request."},429);
      const {data:r,error}=await admin.from("access_requests").insert({full_name,email,requested_role:role,store_name:storeName,message,status:"pending"}).select("*").single();if(error)throw error;
      let mail={email_sent:false,owner_notified:false};
      try{mail=await notifyRequest(r);}catch(e){console.error("request email failed",e);}
      if(!mail.email_sent){await admin.from("access_requests").delete().eq("id",r.id);return json({error:"We couldn't send the request acknowledgement. Please try again shortly."},503);}
      return json({ok:true,request_id:r.id,...mail});
    }
    if(action==="attach_store"){
      const user=await userFrom(req);if(!user)return json({error:"Sign in to connect a store."},401);
      const name=normalizeName(String(body.store_name||""));if(name.length<2)return json({error:"Enter a valid store name."},400);
      const {data:p,error}=await admin.from("profiles").select("role,is_active,store_id").eq("user_id",user.id).maybeSingle();
      if(error||!p||!p.is_active||p.role!=="staff")return json({error:"Active Employee access is required."},403);
      if(p.store_id){const {data:assigned}=await admin.from("stores").select("name").eq("id",p.store_id).maybeSingle();return json({ok:true,store_name:assigned?.name??name,already_assigned:true});}
      let store=await storeByName(name);let created=false;
      if(!store){const {data:newStore,error:ce}=await admin.from("stores").insert({name}).select("id,name").single();if(ce){store=await storeByName(name);if(!store)throw ce;}else{store=newStore;created=true;}}
      const {data:updated,error:ue}=await admin.from("profiles").update({store_id:store.id,updated_at:new Date().toISOString()}).eq("user_id",user.id).is("store_id",null).select("store_id").maybeSingle();if(ue)throw ue;
      if(!updated){const {data:again}=await admin.from("profiles").select("store_id").eq("user_id",user.id).maybeSingle();if(again?.store_id!==store.id)return json({error:"Your store assignment changed. Reload and contact the owner."},409);}
      return json({ok:true,store_name:store.name,created});
    }
    if(action==="submit_deletion_request"){
      const user=await userFrom(req);if(!user)return json({error:"Sign in before requesting account deletion."},401);
      const {data:p,error}=await admin.from("profiles").select("role,is_active").eq("user_id",user.id).maybeSingle();
      if(error||!p||!p.is_active||!["staff","investor"].includes(p.role))return json({error:"Only active Employee or Investor accounts can request deletion."},403);
      const {data:pending,error:pe}=await admin.from("account_deletion_requests").select("id").eq("user_id",user.id).eq("status","pending").limit(1).maybeSingle();if(pe)throw pe;
      if(pending)return json({ok:true,already_pending:true,email_sent:false});
      const reason=String(body.reason||"").trim().slice(0,500);
      const {data:r,error:ie}=await admin.from("account_deletion_requests").insert({user_id:user.id,email:user.email,reason,status:"pending"}).select("*").single();if(ie)throw ie;
      let email_sent=false,owner_notified=false;
      try{const [a,b]=await Promise.all([
        sendMail(user.email!,"We received your account deletion request",shell("Deletion request received",'<p style="font-size:15px;line-height:1.7">Your request is pending owner review. Your account remains active unless the owner approves deletion.</p>')),
        sendMail(ownerEmail,"New Fulfillment account deletion request",shell("Deletion request for review",'<p style="font-size:15px;line-height:1.7">Account '+esc(user.email||"")+' requested deletion. Request ID: '+r.id+'</p>')),
      ]);email_sent=a;owner_notified=b;}catch(e){console.error("deletion email failed",e);}
      return json({ok:true,request_id:r.id,email_sent,owner_notified});
    }
    if(action==="list_requests"){
      const auth=await adminUser(req);if(auth.error)return auth.error;
      const {data,error}=await admin.from("access_requests").select("id,full_name,email,requested_role,store_name,message,status,created_at").eq("status","pending").order("created_at",{ascending:false}).limit(100);if(error)throw error;return json({requests:data});
    }
    return json({error:"Unknown action."},400);
  }catch(error){console.error("fulfillment-access error",error);return json({error:"The request could not be completed. Please try again."},500);}
});
