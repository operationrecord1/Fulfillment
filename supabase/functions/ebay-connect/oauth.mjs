export const AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
export const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
export function authorizationUrl({clientId, ruName, scopes, state}) {
  if (!clientId || !ruName || !Array.isArray(scopes) || !scopes.length || !/^[a-f0-9]{64}$/.test(state)) throw Error('Invalid OAuth configuration');
  return AUTH_URL + '?' + new URLSearchParams({client_id:clientId, redirect_uri:ruName, response_type:'code', scope:scopes.join(' '), state});
}
export async function hashState(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
export function newState() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function exchangeCode({clientId,clientSecret,ruName,code}, fetcher=fetch) {
  const response=await fetcher(TOKEN_URL,{method:'POST',headers:{Authorization:'Basic '+btoa(clientId+':'+clientSecret),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:ruName}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('eBay token exchange failed');
  const token=await response.json();
  if(typeof token.access_token!=='string'||!token.access_token||typeof token.refresh_token!=='string'||!token.refresh_token||!Number.isFinite(token.expires_in)||token.expires_in<=0||!Number.isFinite(token.refresh_token_expires_in)||token.refresh_token_expires_in<=0)throw Error('Incomplete eBay token response');
  return token;
}
export async function sellerIdentity(accessToken,fetcher=fetch) {
  const response=await fetcher('https://apiz.ebay.com/commerce/identity/v1/user/',{headers:{Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('eBay seller identity could not be verified');
  const identity=await response.json();
  if(typeof identity.userId!=='string'||!identity.userId)throw Error('Missing eBay seller identity');
  return {seller_id:identity.userId,username:String(identity.username||identity.userId)};
}
