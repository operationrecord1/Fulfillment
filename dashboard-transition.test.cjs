const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('dashboard.js','utf8');
const fn=source.slice(source.indexOf('async function openReport('),source.indexOf('\nreportButton.onclick='));
function setup(){
 let resolveRead;const log=[];
 const context={investor:false,reportPage:null,reportPending:false,reportRequest:0,disposed:false,reportCleanup:null,
  reportButton:{disabled:false,setAttribute(){},removeAttribute(){}},flush:async()=>true,
  state:{year:2026,month:2,rows:[],expenses:[],options:{}},rpc:()=>new Promise(r=>resolveRead=r),
  document:{createElement:()=>({})},host:{querySelector:()=>({append(){log.push('append')}})},viewport:{hidden:true},
  settingsPage:{},backWorkspace(){},navigateWorkspace(){log.push('navigate')},setSurface(name){log.push(name)},
  MonthlyReport:{open(){log.push('draw');return()=>{}}}};
 context.clearWorkspaceSurfaces=()=>{log.push('clear');context.reportRequest++;context.reportPending=false;context.reportButton.disabled=false;context.settingsPage=null;context.viewport.hidden=false;};
 vm.createContext(context);vm.runInContext(fn,context);
 return {context,log,resolve:()=>resolveRead({rows:[],expenses:[]})};
}
 (async()=>{
  const a=setup(),work=a.context.openReport();await new Promise(setImmediate);
  assert.deepEqual(a.log,[],'Previous page must remain intact while target data loads');assert.equal(a.context.viewport.hidden,true);
  a.resolve();await work;assert.deepEqual(a.log,['clear','append','target','navigate','draw']);assert.equal(a.context.viewport.hidden,true);
  const b=setup(),stale=b.context.openReport();await new Promise(setImmediate);b.context.reportRequest++;b.resolve();await stale;
  assert.deepEqual(b.log,[],'A cancelled request must never replace the newer page');
  console.log('PASS: target transition preserves previous page during fetch and ignores stale completion');
 })().catch(e=>{console.error(e);process.exitCode=1});
