import test from 'node:test';import assert from 'node:assert/strict';import {scenarios,runScenario} from './sandbox-scenarios.mjs';
for(const [id] of scenarios)test('sandbox simulation: '+id,async()=>{const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('External network forbidden in simulation');};try{const result=await runScenario(id);assert.equal(result.passed,true);assert.equal(result.mode,'simulation');assert.ok(result.posts<=1);}finally{globalThis.fetch=original;}});
test('unknown scenario is rejected',async()=>{await assert.rejects(runScenario('production'));});
