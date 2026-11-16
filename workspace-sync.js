(function(root){'use strict';
const copy=x=>structuredClone(x),canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x,same=(a,b)=>JSON.stringify(canonical(a??null))===JSON.stringify(canonical(b??null)),key=r=>r.id||r._key||r.key;
const equivalent=(a,b)=>same({rows:a.rows.map(r=>({id:key(r),position:r.position,data:r.data})).sort((a,b)=>a.position-b.position),formats:a.formats},{rows:b.rows.map(r=>({id:key(r),position:r.position,data:r.data})).sort((a,b)=>a.position-b.position),formats:b.formats});
// Apply only the local delta to a newer server snapshot. Unrelated edits survive.
function objectDelta(base,local,remote){const out=copy(remote||{});for(const k of new Set([...Object.keys(base||{}),...Object.keys(local||{})])){if(same(base?.[k],local?.[k]))continue;if(local?.[k]===undefined)delete out[k];else out[k]=copy(local[k]);}return out;}
function merge(base,local,remote){
 const bm=new Map(base.rows.map(r=>[key(r),r])),lm=new Map(local.rows.map(r=>[key(r),r])),rm=new Map(remote.rows.map(r=>[key(r),copy(r)]));
 const structural=base.rows.some(r=>!lm.has(key(r))||lm.get(key(r)).position!==r.position);
 if(structural&&base.rows.some(r=>{const rr=rm.get(key(r));return rr&&rr.position!==r.position;}))throw Error('Rows moved in another session. Your draft is protected; review before combining these row changes.');
 for(const [id,b]of bm){const l=lm.get(id),r=rm.get(id);if(!l){if(r&&!same(r.data,b.data))throw Error('A row you removed was edited in another session. Your draft is protected.');rm.delete(id);continue;}if(!r){if(!same(b.data,l.data))throw Error('A row you edited was removed in another session. Your draft is protected.');continue;}r.data=objectDelta(b.data,l.data,r.data);if(l.position!==b.position)r.position=l.position;}
 for(const [id,l]of lm)if(!bm.has(id)){const occupied=[...rm.values()].find(r=>r.position===l.position);if(occupied){occupied.data=objectDelta({},l.data,occupied.data);occupied._key=l._key||id;}else rm.set(id,copy(l));}
 // Structural edits must never accidentally delete a concurrently inserted row.
 if(structural)for(const [id,r]of rm)if(!bm.has(id)&&!lm.has(id)){const prior=base.rows.filter(b=>b.position<=r.position&&lm.has(key(b))).sort((a,b)=>b.position-a.position)[0];if(prior)r.position+=lm.get(key(prior)).position-prior.position;}
 const rows=[...rm.values()].sort((a,b)=>a.position-b.position);if(new Set(rows.map(r=>r.position)).size!==rows.length)throw Error('Concurrent row changes need review. Your draft is protected.');
 const formats=copy(remote.formats||{});for(const p of new Set([...Object.keys(base.formats||{}),...Object.keys(local.formats||{})])){const b=base.formats?.[p]||{},l=local.formats?.[p]||{};if(same(b,l))continue;const row={...(formats[p]||{})};for(const c of new Set([...Object.keys(b),...Object.keys(l)])){if(same(b[c],l[c]))continue;const value=objectDelta(b[c],l[c],row[c]);if(Object.keys(value).length)row[c]=value;else delete row[c];}if(Object.keys(row).length)formats[p]=row;else delete formats[p];}
 return {rows,formats};
}
// Merge only changed dimension leaves, preserving other sessions' sizes.
function mergePreferences(base,local,remote){const out=copy(remote||{});for(const k of new Set([...Object.keys(base||{}),...Object.keys(local||{})])){if(same(base?.[k],local?.[k]))continue;const v=local?.[k];if(v===undefined)delete out[k];else if(v&&typeof v==='object'&&!Array.isArray(v))out[k]=mergePreferences(base?.[k]||{},v,out[k]||{});else out[k]=copy(v);}return out;}
class DraftStore{
 constructor(storage,prefix){this.storage=storage;this.prefix=prefix;}
 save(year,month,value){this.storage.setItem(this.prefix+year+':'+month,JSON.stringify({version:1,...value}));this.storage.removeItem(this.prefix+year+':'+month+':editor');}
 saveEditor(year,month,editor){const key=this.prefix+year+':'+month;if(!this.storage.getItem(key))return false;this.storage.setItem(key+':editor',JSON.stringify(editor));return true;}
 read(year,month){const raw=this.storage.getItem(this.prefix+year+':'+month);if(!raw)return null;const v=JSON.parse(raw);if(v.version!==1)throw Error('A saved draft needs recovery before editing.');const editor=this.storage.getItem(this.prefix+year+':'+month+':editor');if(editor)v.editor=JSON.parse(editor);return v;}
 remove(year,month){this.storage.removeItem(this.prefix+year+':'+month);this.storage.removeItem(this.prefix+year+':'+month+':editor');}
}
const api={mergePreferences,merge,objectDelta,DraftStore,same,equivalent};root.WorkspaceSync=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
