import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
const filename = fileURLToPath(import.meta.url);
const compiled = new Module(filename);
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(ts.transpileModule(fs.readFileSync('src/lib/coupon-view.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { createViewTickets, validateViewUrl, fetchCouponImage, renderCouponPage } = compiled.exports;
const detail = 'https://coupon.petit.gift/coupons/detail?app_id=1&coupon_id=1262&enc=test';
const barcode = 'https://coupon.petit.gift/generator/barcode?code=test';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');

test('tickets cannot be changed, reused for other resource types, or opened after expiry', () => {
  const tickets = createViewTickets('test-secret');
  const ticket = tickets.seal(detail, 'detail', 1000);
  assert.equal(tickets.open(ticket, 'detail', 2000), detail);
  assert.throws(() => tickets.open(ticket, 'image', 2000));
  assert.throws(() => tickets.open(ticket, 'detail', 1000 + 31 * 86400000));
  assert.throws(() => createViewTickets('different-secret').open(ticket, 'detail', 2000));
  const bytes = Buffer.from(ticket, 'base64url'); bytes[30] ^= 1;
  assert.throws(() => tickets.open(bytes.toString('base64url'), 'detail', 2000));
});
test('viewer cannot become an arbitrary URL or API proxy', () => {
  for (const url of ['http://coupon.petit.gift/coupons/detail', 'https://127.0.0.1/coupons/detail',
    'https://coupon.petit.gift.evil.test/coupons/detail', 'https://coupon.petit.gift:8080/coupons/detail',
    'https://user:pass@coupon.petit.gift/coupons/detail', 'https://coupon.petit.gift/api/redeem']) {
    assert.throws(() => validateViewUrl(url, 'detail'));
  }
});
test('200 HTML block page and HTTP redirects are not successful images', async () => {
  await assert.rejects(fetchCouponImage({ get: async () => ({ status: 200, data: Buffer.from('Use a Japanese IP') }) }, barcode));
  await assert.rejects(fetchCouponImage({ get: async () => ({ status: 302, data: png }) }, barcode));
});
test('detail display embeds images and text without browser requests to upstream or executable content', async () => {
  const calls = [];
  const html = `<script>alert(1)</script><div class="product_barcode"><img src="${barcode}"><span>1234 5678</span></div>
    <div class="product_ticketing_text">2026年09月30日 23:59</div><div class="exchange_memo_body"><p>Mango &amp; pineapple</p><p>&lt;script&gt;bad&lt;/script&gt;</p></div>`;
  const client = { get: async (url, config) => {
    calls.push(url); assert.equal(config.maxRedirects, 0);
    return url === detail ? { status: 200, data: html } : { status: 200, data: png };
  } };
  const view = await renderCouponPage(client, detail);
  assert.deepEqual(calls, [detail, barcode]);
  assert.match(view, /src="data:image\/png;base64,/);
  assert.match(view, /Mango &amp; pineapple/);
  assert.match(view, /2026年09月30日/);
  assert.doesNotMatch(view, /<script|https?:\/\//);
});
test('a Japan-only error page with HTTP 200 cannot be displayed as a valid coupon', async () => {
  await assert.rejects(renderCouponPage({ get: async () => ({ status: 200, data: '<p>日本国内からアクセスしてください</p>' }) }, detail), /바코드/);
});
