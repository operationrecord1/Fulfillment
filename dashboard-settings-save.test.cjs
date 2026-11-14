const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('dashboard-settings.js','utf8');
const start=source.indexOf(' form.onsubmit=async e=>{'),end=source.indexOf('\n if(readonly)',start);
function setup({saveError=false,renameError=false}={}){
 const calls=[],controls=[{disabled:false}],context={form:{elements:{tax_percentage:{value:'15'}},querySelectorAll:()=>controls},readonly:false,reading:false,platformBusy:false,settingsSaving:false,nameInput:{value:' New Store ',focus(){}},msg:{dataset:{}},closeColors(){},platformLock(){},lists:[['Amazon']],platformColors:{},platformTextColors:{},logo:'',options:{revision:3},storeName:'Old Store',save:async data=>{calls.push(['save',data]);if(saveError)throw Error('Save failed');return{revision:4};},renameStore:async(name,previous)=>{calls.push(['rename',name,previous]);if(renameError)throw Error('Name unavailable');return name;}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);return{context,calls,controls};
}
(async()=>{
 const a=setup();await a.context.form.onsubmit({preventDefault(){}});assert.equal(a.calls.length,2);assert.equal(a.calls[1][1],'New Store');assert.equal(a.context.storeName,'New Store');assert.equal(a.context.msg.dataset.state,'success');assert.equal(a.controls[0].disabled,false);
 const b=setup({saveError:true});await b.context.form.onsubmit({preventDefault(){}});assert.equal(b.calls.length,1);assert.equal(b.context.msg.dataset.state,'error');
 const c=setup({renameError:true});await c.context.form.onsubmit({preventDefault(){}});assert.equal(c.context.options.revision,4);assert.match(c.context.msg.textContent,/Other settings were saved/);assert.equal(c.context.storeName,'Old Store');
 console.log('PASS: unified settings save, trimmed store rename, failure ordering and partial-save feedback');
})().catch(e=>{console.error(e);process.exitCode=1;});
