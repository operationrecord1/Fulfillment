import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizationUrl,newState,hashState,exchangeCode,sellerIdentity} from './supabase/functions/ebay-connect/oauth.mjs';
test('OAuth uses existing RuName, unpredictable state and encoded scope list',async()=>{
 const a=newState(),b=newState();assert.notEqual(a,b);assert.match(a,/^[a-f0-9]{64}$/);assert.notEqual(await hashState(a),a);
 const url=new URL(authorizationUrl({clientId:'existing-app',ruName:'existing-RuName',scopes:['scope/one','scope/two'],state:a}));
 assert.equal(url.origin,'https://auth.ebay.com');assert.equal(url.searchParams.get('redirect_uri'),'existing-RuName');assert.equal(url.searchParams.get('scope'),'scope/one scope/two');
 assert.throws(()=>authorizationUrl({clientId:'app',ruName:'name',scopes:['a'],state:'predictable'}));
});
test('code exchange sends credentials only to eBay and never leaks provider error bodies',async()=>{
 const params={clientId:'test-app',clientSecret:'test-secret',ruName:'existing',code:'a+b/='};
 await exchangeCode(params,async(url,options)=>{assert.equal(url,'https://api.ebay.com/identity/v1/oauth2/token');assert.equal(options.body.get('code'),params.code);assert.equal(options.body.get('redirect_uri'),'existing');return Response.json({access_token:'access',refresh_token:'refresh',expires_in:7200,refresh_token_expires_in:100000});});
 await assert.rejects(()=>exchangeCode(params,async()=>new Response('sensitive provider body',{status:400})),/^Error: eBay token exchange failed$/);
 await assert.rejects(()=>exchangeCode(params,async()=>Response.json({access_token:'a'})),/Incomplete/);
});
test('identity requires stable seller ID, not user-supplied store name',async()=>{
 assert.deepEqual(await sellerIdentity('test',async()=>Response.json({userId:'stable',username:'shop'})),{seller_id:'stable',username:'shop'});
 await assert.rejects(()=>sellerIdentity('test',async()=>Response.json({username:'shop'})),/Missing/);
});
