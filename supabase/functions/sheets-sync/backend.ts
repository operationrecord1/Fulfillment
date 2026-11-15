export const backendUrl=Deno.env.get('SUPABASE_URL')!;
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const key=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
export async function backend(path:string,body?:unknown){
 const response=await fetch(backendUrl+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Backend request failed: HTTP '+response.status);
 const text=await response.text();return text?JSON.parse(text):null;
}
export const rpc=(action:string,payload:unknown={})=>backend('/rest/v1/rpc/sheets_worker',{action,payload});
export async function isAdmin(authorization:string|null){
 if(!authorization?.startsWith('Bearer '))return false;
 const response=await fetch(backendUrl+'/auth/v1/user',{headers:{apikey:key,Authorization:authorization},signal:AbortSignal.timeout(15000)});
 if(!response.ok)return false;
 const user=await response.json();
 const profiles=await backend('/rest/v1/profiles?user_id=eq.'+encodeURIComponent(user.id)+'&role=eq.admin&is_active=eq.true&select=user_id');
 return profiles.length===1;
}
