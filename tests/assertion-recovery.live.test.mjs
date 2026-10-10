import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {Runtime, loadFork} from '../bridge/runtime.mjs';

const enabled = Boolean(process.env.PLAYWRIGHT_FORK_PATH);
let runtime;
before(async () => {
  if (!enabled) return;
  runtime = new Runtime(loadFork(process.env.PLAYWRIGHT_FORK_PATH));
  await runtime.initialize();
  assert.equal((await runtime.preflight()).idFirstVerified, true);
  await runtime.call('poc_record_start');
});
after(async () => { await runtime?.close(); });
const live = (name, fn) => test(name, {skip:!enabled}, fn);

async function tabSnapshot() {
  await runtime.active.setContent('<section role="tabpanel" aria-label="SL Codes">Codes table</section>');
  const result = await runtime.call('browser_snapshot');
  assert.equal(result.isError, false);
  const tree = JSON.parse(result.snapshot);
  const node = tree.find(item => item.role === 'tabpanel' && item.name === 'SL Codes');
  assert.ok(node?.ref, JSON.stringify(tree));
  return node.ref;
}

async function forceFirstStale(run) {
  const raw = runtime.raw.bind(runtime);
  let locatorCalls = 0;
  runtime.raw = async (name, args) => {
    if (name === 'browser_generate_locator' && ++locatorCalls === 1)
      return {isError:true,error:`Ref ${args.target} not found in the current page snapshot. Try capturing new snapshot.`};
    return raw(name,args);
  };
  try { return await run(() => locatorCalls); }
  finally { runtime.raw = raw; }
}

live('stale ref is re-resolved from saved semantic metadata', async () => {
  const oldRef = await tabSnapshot();
  const before = runtime.snapshotCount;
  const result = await forceFirstStale(() => runtime.call('browser_assert',{kind:'visible',target:oldRef}));
  assert.equal(result.isError,false,JSON.stringify(result));
  assert.equal(runtime.snapshotCount,before+1);
  assert.equal(result.assertion.targetDescriptor.role,'tabpanel');
  assert.equal(result.assertion.targetDescriptor.name,'SL Codes');
  assert.ok(result.notices.some(line => line.includes(`Snapshot ref ${oldRef} is stale`)));
  assert.ok(result.notices.some(line => line.includes('Re-resolved target to')));
});

live('stale ref retry succeeds with an explicit stable id descriptor', async () => {
  await runtime.active.setContent('<section id="sl-codes-panel" role="tabpanel" aria-label="SL Codes">Codes table</section>');
  const before = runtime.snapshotCount;
  const result = await runtime.call('browser_assert',{
    kind:'visible',target:'e999999',targetDescriptor:{id:'sl-codes-panel',role:'tabpanel',name:'SL Codes'}});
  assert.equal(result.isError,false,JSON.stringify(result));
  assert.equal(result.assertion.target,'#sl-codes-panel');
  assert.equal(runtime.snapshotCount,before+1);
  assert.ok(result.notices.includes('[ASSERT] Snapshot ref e999999 is stale'));
  assert.ok(result.notices.includes('[ASSERT] Retrying assertion'));
});

live('stale ref retry fails after exactly one retry', async () => {
  const oldRef = await tabSnapshot();
  const raw = runtime.raw.bind(runtime);
  let locatorCalls = 0;
  const before = runtime.snapshotCount;
  runtime.raw = async (name,args) => {
    if (name === 'browser_generate_locator' && ++locatorCalls === 1)
      return {isError:true,error:`Ref ${args.target} not found in the current page snapshot.`};
    if (name === runtime.runCodeName) return {isError:true,error:'Expected result assertion failed'};
    return raw(name,args);
  };
  try {
    const result = await runtime.call('browser_assert',{kind:'visible',target:oldRef});
    assert.equal(result.isError,true);
    assert.equal(locatorCalls,2);
    assert.equal(runtime.snapshotCount,before+1);
    assert.ok(result.notices.includes('[ASSERT] Retrying assertion'));
    assert.equal(result.evidenceId,undefined);
  } finally { runtime.raw = raw; }
});

live('valid ref assertion does not capture another snapshot', async () => {
  const ref = await tabSnapshot();
  const before = runtime.snapshotCount;
  const result = await runtime.call('browser_assert',{kind:'visible',target:ref});
  assert.equal(result.isError,false,JSON.stringify(result));
  assert.equal(runtime.snapshotCount,before);
  assert.equal(result.notices,undefined);
});
