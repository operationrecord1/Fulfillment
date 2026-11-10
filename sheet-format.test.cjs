const assert=require('node:assert/strict'),F=require('./sheet-format-model.js'),C=require('./dashboard-core.js');
assert.deepEqual(C.columns.map(c=>F.defaults(c[0]).align),['left','center','center','left','left','left','center','left','left','center','center','center','center','center','center','center','center']);
let formats={};F.patch(formats,2,'order_id',{bold:true,fill:'#fff2cc',align:'right'});assert.equal(F.get(formats,2,'order_id').align,'right');assert.equal(F.get(formats,1,'order_id').align,'left');
assert.deepEqual(F.shift(formats,1,1)[3],formats[2]);assert.deepEqual(F.shift(formats,2,1,true),{});
const b={r1:1,r2:2,c1:0,c2:1},keys=['order_id','quantity','earning'];const all=F.borders({},b,keys,'all','#336699','double');assert.equal(all[1].order_id.borders.right.style,'double');assert.equal(all[1].quantity.borders.left.style,'double');assert.equal(all[2].quantity.borders.bottom.color,'#336699');
const outer=F.borders({},b,keys,'outer');assert.equal(outer[1].order_id.borders.right,undefined);assert.equal(outer[1].quantity.borders.top.color,'#000000');assert.equal(outer[2].order_id.borders.bottom.style,'thin');
const clear=F.borders(all,b,keys,'clear');assert.deepEqual(clear[1].quantity.borders,{});assert.deepEqual(clear[1].earning.borders,{});
for(const color of ['#000000','#ffffff','#336699','#ff0000','#e7ecef']){const v=F.rgbToHsv(color);assert.equal(F.hsvToHex(v.h,v.s,v.v),color);}
assert.match(F.css(formats,2,'order_id',keys),/text-align:right/);assert.equal(F.hex('#123abc'),true);assert.equal(F.hex('red;display:none'),false);
const one={r1:1,r2:1,c1:0,c2:0};const source=F.borders({1:{order_id:{fill:'#fff2cc'}}},one,keys,'outer');const moved=F.paste(source,source,one,keys,4,0,true);assert.equal(moved[2].order_id.borders.top,undefined);assert.equal(moved[4].order_id.fill,'#fff2cc');assert.equal(moved[5].order_id.borders.top.style,'thin');
const repeated=F.paste({},source,one,keys,1,0,false,2,2);assert.equal(repeated[2].quantity.fill,'#fff2cc');
console.log('PASS: 17 default alignments, range formatting metadata, row shifts, shared borders, HEX/HSV roundtrip');
