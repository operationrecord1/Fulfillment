const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),F=require('./sheet-format-model');
const context={window:{SheetFormatModel:F},document:{activeElement:null}};
vm.runInNewContext(fs.readFileSync('sheet-format.js','utf8'),context);
let writes=0;
function control(key){let disabled=false,value='10',html='';const attrs={},styles={};return {dataset:{format:key},get disabled(){return disabled},set disabled(v){writes++;disabled=v},get value(){return value},set value(v){writes++;value=String(v)},get innerHTML(){return html},set innerHTML(v){writes++;html=v},getAttribute(k){return attrs[k]??null},setAttribute(k,v){writes++;attrs[k]=v},style:{getPropertyValue(k){return styles[k]||''},setProperty(k,v){writes++;styles[k]=v}}};}
const buttons=Object.fromEntries(['undo','redo','bold','italic','color','fill','left'].map(k=>[k,control(k)])),size=control('size');
const grid={cols:[{key:'order_id'}],selection:{r:1,c:0},editable:true,formats:{},history:[],future:[],options:{}};
const fmt=Object.create(context.window.SheetFormatting.prototype);fmt.g=grid;fmt.size=size;fmt.toolbar={querySelectorAll(){return Object.values(buttons)},querySelector(selector){return buttons[selector.slice(13,-1)]}};
fmt.paint();writes=0;fmt.paint();fmt.paint();assert.equal(writes,0,'Repeated selection paints with unchanged state must not mutate toolbar DOM');
F.patch(grid.formats,2,'order_id',{bold:true,color:'#123456',fill:'#abcdef',fontSize:18,align:'right'});grid.activeCell=()=>({r:2,c:0});fmt.paint();assert.equal(size.value,'18');assert.equal(buttons.bold.getAttribute('aria-pressed'),'true');assert.equal(buttons.color.style.getPropertyValue('--indicator'),'#123456');assert.equal(buttons.fill.style.getPropertyValue('--indicator'),'#abcdef');assert.equal(fmt.paintedAlign,'right','Toolbar must follow active cell inside retained range, not anchor');
context.document.activeElement=size;size.value='22';fmt.paint();assert.equal(size.value,'22','Active font input must not be overwritten');context.document.activeElement=null;fmt.paint();assert.equal(size.value,'18','Unfocused input must return to actual cell formatting');
grid.history.push({});fmt.paint();assert.equal(buttons.undo.disabled,false,'Undo state must update independently of active cell');grid.options.canUndo=()=>false;fmt.paint();assert.equal(buttons.undo.disabled,true);grid.editable=false;fmt.paint();assert.equal(size.disabled,true);assert.equal(buttons.bold.disabled,true);
writes=0;fmt.paint();assert.equal(writes,0);
console.log('PASS: toolbar avoids repeated DOM mutations, follows active range cell, preserves focused input, and refreshes permissions/history');
