const test=require('node:test'),assert=require('node:assert/strict'),A=require('./platform-accounts.js');
const o={platform_accounts:[{id:'a',label:'Amazon SB',name:'Amazon Sabuj',aliases:['Amazon 1']}],platforms:['Amazon SB']};
test('renamed account resolves by stable identity',()=>assert.deepEqual(A.resolve({edit:{data:{account_id:'a',platform:'Amazon 1'}}},o),{id:'a',label:'Amazon SB',name:'Amazon Sabuj',active:true}));
test('legacy label follows known alias',()=>assert.equal(A.resolve({edit:{data:{platform:'Amazon 1'}}},o).label,'Amazon SB'));
test('clear overrides stale buyer account',()=>assert.equal(A.resolve({edit:{data:{platform:'',buyer_account:'Amazon 1'}}},o).label,''));
test('custom entry does not invent identity',()=>assert.deepEqual(A.changes('Personal',o),{platform:'Personal',buyer_account:'Personal',account_id:''}));
test('known account synchronizes both fields',()=>assert.deepEqual(A.changes('amazon sb',o),{platform:'Amazon SB',buyer_account:'Amazon SB',account_id:'a'}));
