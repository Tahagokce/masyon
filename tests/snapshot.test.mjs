import test from 'node:test';
import assert from 'node:assert/strict';
import {compactSnapshot} from '../bridge/snapshot.mjs';
import {SecretGuard} from '../bridge/security.mjs';
test('large snapshots stay valid JSON, bounded and visibly marked trimmed', () => {
  const tree = [{role:'generic',children:Array.from({length:500},(_,i)=>({role:'button',name:'button '+i,ref:'e'+i}))}];
  const result=compactSnapshot(tree);
  assert.ok(result.snapshot.length<=4000); assert.equal(result.snapshotTruncated,true);
  assert.ok(JSON.parse(result.snapshot)[0].children[0].ref);
});
test('diagnostics keep class/tool/page and actual safe message without secrets', () => {
  const guard=new SecretGuard([]);
  const r=guard.diagnostic(new Error('strict mode violation; url=https://test/?access_token=secret-token password="secret phrase"'), 'browser_snapshot','page1');
  assert.match(r.error,/strict mode violation/); assert.equal(r.errorClass,'Error'); assert.equal(r.activePage,'page1');
  assert.ok(!r.error.includes('secret-token')); assert.ok(!r.error.includes('secret phrase'));
});
