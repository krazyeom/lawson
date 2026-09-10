import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const compiled = new Module(__filename);
compiled._compile(ts.transpileModule(fs.readFileSync('src/lib/coupons.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, __filename);
const { createCouponLookup } = compiled.exports;
const ok = (data) => ({ status: 200, data: { success: true, data } });
const job = (data = {}) => ok({ status: 'success', ...data });
const link = 'https://coupon.petit.gift/detail?code=test';
const login = (history = {}) => [
  ['post', '/auth/login/request', ok({ status: 'pending', login_process_id: 'id' })],
  ['get', '/auth/login/result?', job({ token: 'test-token', current_history: history })],
];
const campaign = (has_lottery = true) => ['get', '/campaign_info.json', { status: 200, data: { has_lottery, lottery_type: 2 } }];
const page = ['get', '/detail?', { status: 200, data: '<img src="https://coupon.petit.gift/generator/barcode?x=1&amp;y=2">' }];
async function run(steps) {
  const remaining = [...steps];
  const client = Object.fromEntries(['get', 'post'].map(method => [method, async (url, body) => {
    const expected = remaining.shift();
    assert.ok(expected, `unexpected ${method} ${url}`);
    assert.equal(method, expected[0]);
    assert.ok(url.includes(expected[1]), `${url} must include ${expected[1]}`);
    if (expected[3]) expected[3](body);
    return expected[2];
  }]));
  const result = await createCouponLookup(client, async () => {})('TEST', 'kakaotalk2609-input');
  assert.equal(remaining.length, 0, result.error);
  return result;
}
test('new losing draw stops before issuing and reports not_won', async () => {
  const r = await run([...login(), campaign(),
    ['post', '/lottery/request', ok({ status: 'pending' }), b => assert.equal(b.issue_on_win, true)],
    ['get', '/lottery/result', ok({ status: 'processing' })],
    ['get', '/lottery/result', job({ result: false })],
  ]);
  assert.equal(r.status, 'not_won'); assert.equal(r.success, false);
});
test('winning auto-issue polls without duplicate issue request', async () => {
  const r = await run([...login(), campaign(),
    ['post', '/lottery/request', ok({ status: 'pending' })],
    ['get', '/lottery/result', job({ result: true, coupon_requested: true })],
    ['get', '/coupons/issue/result', ok({ status: 'pending' })],
    ['get', '/coupons/issue/result', job({ coupon_data: { cp_exchange_url: link } })], page,
  ]);
  assert.equal(r.success, true); assert.equal(r.barcode_url, 'https://coupon.petit.gift/generator/barcode?x=1&y=2');
});
test('cached losing draw is not submitted again', async () => {
  const r = await run([...login({ lottery: { result: false } }), campaign()]);
  assert.equal(r.status, 'not_won');
});
test('existing coupon bypasses lottery and issuance', async () => {
  const r = await run([...login({ coupon: { coupon_detail_link: link } }), page]);
  assert.equal(r.success, true);
});
test('actual eligibility error is preserved', async () => {
  const r = await run([...login(), campaign(false),
    ['post', '/coupons/issue/request', { status: 403, data: { success: false, error: 'eligibility_incomplete_previous_step', message: 'You are not eligible to access this step.' } }],
  ]);
  assert.match(r.error, /Issue request: HTTP 403.*eligibility_incomplete_previous_step/);
});
test('polling is bounded', async () => {
  const r = await run([
    login()[0], ...Array.from({ length: 20 }, () => ['get', '/auth/login/result?', ok({ status: 'pending' })]),
  ]);
  assert.match(r.error, /처리 시간 초과/);
});
test('in-progress issuance is resumed in a non-lottery campaign', async () => {
  const r = await run([...login(), campaign(false),
    ['post', '/coupons/issue/request', { status: 409, data: { success: false, error: 'job_requesting' } }],
    ['get', '/coupons/issue/result', job({ coupon_data: { cp_exchange_url: link } })], page,
  ]);
  assert.equal(r.success, true);
});
test('second campaign uses the same flow and parses code separately from language', async () => {
  const r = await run([...login({ coupon: { coupon_detail_link: link } }),
    ['get', '/detail?', { status: 200, data: "var url = 'https://spot.petit.gift/campaigns/coffee?code=NEXT&lang=ko';" }],
    ['post', '/coffee/auth/login/request', ok({ status: 'pending', login_process_id: 'id2' }), b => assert.deepEqual(b, { utm_url: null, login_type: 1, code: 'NEXT' })],
    ['get', '/coffee/auth/login/result?', job({ token: 'test-token' })], campaign(false),
    ['post', '/coupons/issue/request', ok({ status: 'pending' })],
    ['get', '/coupons/issue/result', job({ coupon_data: { cp_exchange_url: link } })], page,
  ]);
  assert.equal(r.success, true);
});
test('coupon page HTTP errors are not reported as successful activation', async () => {
  const r = await run([...login({ coupon: { coupon_detail_link: link } }),
    ['get', '/detail?', { status: 403, data: 'Forbidden' }],
  ]);
  assert.equal(r.success, false); assert.match(r.error, /Coupon page: HTTP 403/);
});
test('JSON-escaped external redirect reaches second campaign via HTTP redirect', async () => {
  const external = 'https://coupon.petit.gift/issued-products/1/external-redirect?app_id=1';
  const r = await run([...login({ coupon: { coupon_detail_link: link } }),
    ['get', '/detail?', { status: 200, data: `var url = ${JSON.stringify(external).replaceAll('/', '\\/')}; window.location.href = url;` }],
    ['get', '/external-redirect?', { status: 200, data: '<div id="app"></div>', request: { res: { responseUrl: 'https://spot.petit.gift/campaigns/fruit?code=NEXT' } } }],
    ['post', '/fruit/auth/login/request', ok({ status: 'pending', login_process_id: 'id2' })],
    ['get', '/fruit/auth/login/result?', job({ token: 'test-token' })], campaign(false),
    ['post', '/coupons/issue/request', ok({ status: 'pending' })],
    ['get', '/coupons/issue/result', job({ coupon_data: { cp_exchange_url: link } })], page,
  ]);
  assert.equal(r.success, true); assert.ok(r.barcode_url);
});
test('IP limit is reported distinctly without retrying or issuing again', async () => {
  const r = await run([
    login()[0], ['get', '/auth/login/result?', ok({ status: 'error', error_cd: 'campaign_max_ip_limit' })],
  ]);
  assert.equal(r.success, false);
  assert.equal(r.status, 'ip_limited');
  assert.match(r.error, /campaign_max_ip_limit/);
});
test('proxy denial is distinguished from campaign eligibility without exposing response HTML', async () => {
  const r = await run([['post', '/auth/login/request', {
    status: 403, headers: { server: 'squid', 'x-squid-error': 'ERR_ACCESS_DENIED 0' },
    data: '<html>Squid ERR_ACCESS_DENIED hidden credentials</html>',
  }]]);
  assert.match(r.error, /Squid proxy: ERR_ACCESS_DENIED 0/);
  assert.doesNotMatch(r.error, /hidden credentials/);
});
