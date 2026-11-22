import {createHash,createVerify} from 'node:crypto';
import {Buffer} from 'node:buffer';
export const challenge=(code,token,endpoint)=>createHash('sha256').update(code+token+endpoint).digest('hex');
export function signatureMetadata(header){
 if(!header||header.length>8192)throw Error('Invalid signature');
 const s=JSON.parse(Buffer.from(header,'base64').toString('utf8'));
 if(typeof s.kid!=='string'||!s.kid||s.kid.length>256||typeof s.signature!=='string')throw Error('Invalid signature');
 return s;
}
export function verifyPayload(raw,signature,key){
 const digest=String(key.digest||'').toUpperCase().replaceAll('-','');
 if(!['SHA1','SHA256'].includes(digest)||!['ECDSA','ECC'].includes(String(key.algorithm).toUpperCase()))return false;
 const bodyKey=key.key.replace('-----BEGIN PUBLIC KEY-----','').replace('-----END PUBLIC KEY-----','').replace(/\s/g,'');
 const pem='-----BEGIN PUBLIC KEY-----\n'+bodyKey.match(/.{1,64}/g).join('\n')+'\n-----END PUBLIC KEY-----';
 // eBay's SDK verifies the JSON serialization. Also accept the exact signed wire bytes.
 for(const body of new Set([raw,JSON.stringify(JSON.parse(raw))])){
  const v=createVerify(digest.toLowerCase());v.update(body);v.end();
  if(v.verify(pem,signature.signature,'base64'))return true;
 }
 return false;
}
