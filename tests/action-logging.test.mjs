import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actionLocators, actionLogLines} from '../bridge/action-logging.mjs';
import {SecretGuard} from '../bridge/security.mjs';
import {Runtime} from '../bridge/runtime.mjs';

const guard = new SecretGuard([]);

test('extracts the exact action receiver from fork-generated code', () => {
  const code = "await page.locator('#slCode').fill('private-value');";
  assert.deepEqual(actionLocators(code), ["page.locator('#slCode')"]);
  assert.deepEqual(actionLogLines('browser_type','page1',code,undefined,
    {text:'private-value'},guard,true), [
    '[ACTION] fill', '[PAGE] page1', "[LOCATOR] page.locator('#slCode')", '[VALUE] <masked>']);
});

test('disabled locator logging omits the locator while masking fill values', () => {
  const lines = actionLogLines('browser_type','page1',
    "await page.locator('#password').fill('private-value');",undefined,
    {text:'private-value'},guard,false);
  assert.equal(lines.some(line => line.startsWith('[LOCATOR]')),false);
  assert.equal(lines.includes('[VALUE] <masked>'),true);
  assert.equal(lines.join('\n').includes('private-value'),false);
});

test('role fallback is logged verbatim, and sensitive selector values are redacted', () => {
  const role = "page.getByRole('tab', { name: 'SL Codes' })";
  assert.deepEqual(actionLocators(`await ${role}.click();`),[role]);
  assert.ok(actionLogLines('browser_click','page1',`await ${role}.click();`,undefined,
    {},guard,true).includes(`[LOCATOR] ${role}`));
  const sensitive = "await page.locator('[data-session-id=\"opaque-secret\"]').click();";
  assert.ok(actionLogLines('browser_click','page1',sensitive,undefined,{},guard,true)
    .includes('[LOCATOR] <redacted>'));
});

test('URL assertion has no locator to report', () => {
  const lines = actionLogLines('browser_assert','page1','',undefined,
    {kind:'url',expected:'https://example.test/'},guard,true);
  assert.equal(lines.some(line => line.startsWith('[LOCATOR]')),false);
});

test('wait actions report a real locator when the fork used one', () => {
  const locator = "page.getByText('Loaded')";
  const lines = actionLogLines('browser_wait_for','page1',`await ${locator}.waitFor();`,
    undefined,{},guard,true);
  assert.ok(lines.includes(`[LOCATOR] ${locator}`));
});

test('state URL omits query strings and masks token path segments', () => {
  const runtime = new Runtime({});
  const page = {url:() => 'https://example.test/access-token/opaque-token?session=hidden',
    isClosed:() => false};
  runtime.pages.set(page,{alias:'page',page,opener:null});
  runtime.active = page;
  const line = runtime.stateLine();
  assert.match(line,/\[STATE\] v0 page=page url=https:\/\/example\.test\/access-token\/\[REDACTED\]/);
  assert.equal(line.includes('opaque-token'),false);
  assert.equal(line.includes('hidden'),false);
});
