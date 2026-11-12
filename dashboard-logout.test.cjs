const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('dashboard.js','utf8'),start=source.indexOf('let signingOut=false;'),end=source.indexOf('function feedback(',start);
const make=new Function('flush','logout','session','feedback',source.slice(start,end)+'return signOutWorkspace;');
(async()=>{let clears=0,calls=0,message='',button={disabled:false};const session={clear(){clears++;}};
let handler=make(async()=>true,async()=>{throw Error('offline');},session,text=>message=text);await handler({currentTarget:button});assert.equal(clears,0);assert.match(message,/Could not log out/);assert.equal(button.disabled,false);
handler=make(async()=>false,async()=>calls++,session,()=>{});await handler({currentTarget:button});assert.equal(calls,0);assert.equal(clears,0);
let resolve;handler=make(async()=>true,()=>{calls++;return new Promise(r=>resolve=r);},session,()=>{});const first=handler({currentTarget:button});await Promise.resolve();await handler({currentTarget:button});assert.equal(calls,1);assert.equal(clears,0);resolve();await first;assert.equal(clears,1);assert.equal(button.disabled,false);
console.log('PASS: failed logout preserves history, failed save blocks logout, duplicate clicks serialize, successful logout clears history');})();
