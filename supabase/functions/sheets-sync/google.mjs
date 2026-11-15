export function googleClient(accessToken,{fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 let lastWrite=0;
 return async function request(url,method='GET',body){
  if(method!=='GET'){await wait(Math.max(0,1250-(Date.now()-lastWrite)));lastWrite=Date.now();}
  const response=await fetcher(url,{method,headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Google API HTTP '+response.status);
  return response.status===204?{}:response.json();
 };
}
export async function refreshGoogle(credentials,fetcher=fetch){
 const fields={client_id:credentials.sheets_google_client_id,client_secret:credentials.sheets_google_client_secret,refresh_token:credentials.sheets_google_refresh_token,grant_type:'refresh_token'};
 if(Object.values(fields).some(v=>!v))throw Error('Google owner authorization is not configured');
 const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(fields),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Google authorization refresh failed: HTTP '+response.status);
 const result=await response.json();if(!result.access_token)throw Error('Google access token missing');return result.access_token;
}
