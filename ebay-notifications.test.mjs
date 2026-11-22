import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign,createHash} from 'node:crypto';
import {signatureMetadata,verifyPayload,challenge} from './supabase/functions/ebay-notifications/verify.mjs';
import traffic from './ebay-traffic.js';
test('signed notifications validate and tampered payloads are rejected',()=>{
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const raw=JSON.stringify({metadata:{topic:'LISTING'},notification:{notificationId:'test',data:{listingId:'123'}}});
 const signer=createSign('sha1');signer.update(raw);signer.end();
 const signature=signer.sign(privateKey,'base64');
 const s=signatureMetadata(Buffer.from(JSON.stringify({kid:'key-1',signature})).toString('base64'));
 const pub={key:publicKey.export({type:'spki',format:'pem'}),algorithm:'ECDSA',digest:'SHA1'};
 assert.equal(verifyPayload(raw,s,pub),true);
 assert.equal(verifyPayload(raw.replace('123','456'),s,pub),false);
 assert.throws(()=>signatureMetadata('bad'));
});
test('challenge is bound to verification token and exact endpoint',()=>{
 const expected=createHash('sha256').update('code'+'token'+'https://example.test/events').digest('hex');
 assert.equal(challenge('code','token','https://example.test/events'),expected);
 assert.notEqual(challenge('code','token','https://example.test/events/'),expected);
});
test('traffic preserves real zeros and never converts missing values into zero',()=>{
 const report={header:{metrics:[{key:'VIEWS'}]},metricValues:[{value:500,applicable:true}],requestedFrom:'20261023',requestedTo:'20261121'};
 assert.equal(traffic.value(report,'VIEWS'),500);
 report.metricValues[0].value=0;assert.equal(traffic.value(report,'VIEWS'),0);
 for(const value of [null,undefined,'',false,'not a number',-1]){report.metricValues[0].value=value;assert.equal(traffic.value(report,'VIEWS'),null);}
 report.metricValues[0]={value:200,applicable:false};assert.equal(traffic.value(report,'VIEWS'),null);
 assert.equal(traffic.value(report,'IMPRESSION'),null);
 assert.equal(traffic.period(report),'2026-10-23 to 2026-11-21');
});
