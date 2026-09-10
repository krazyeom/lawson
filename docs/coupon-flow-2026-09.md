# 2026-09 coupon flow and Japan-proxied display

Verified on 2026-09-11 with the third user-provided code (FDB…5E). Do not store bearer tokens, complete codes, user IDs, encrypted upstream URLs, or barcode numbers in this repository.

## Reference capture (2026-08)

The user-supplied `lawson capture.txt` records:

1. `POST gw2.petit.gift/api/campaigns/kakaotalk2608-input/auth/login/request` with `login_type: 5`, `codes: [input]` → `pending`, `login_process_id`.
2. `GET …/auth/login/result?login_process_id=…` → `status: success`, token and current history.
3. `POST …/coupons/issue/request` with `coupon_ids: []`, `has_detail: false`; then `GET …/coupons/issue/result` → `coupon_data.cp_exchange_url`.
4. `GET coupon.petit.gift/coupons/detail?...` → JavaScript `var url = 'https://spot.petit.gift/campaigns/kakaotalk2608-coffee?code=…'`.
5. Second campaign login uses `login_type: 1`, singular `code`.
6. Second campaign issues with `has_detail: true`; its result returns the final detail URL.
7. The final HTML contains `.product_barcode img` with `/generator/barcode?...`.

The capture contains binary/invalid UTF-8 sections. Analysis decoded them with replacement and inspected HTTP/JSON sections without importing credentials.

## Observed September flow

The campaign is discovered from responses, not derived by changing all `2608` strings or assuming `coffee`.

- First campaign: `kakaotalk2609-input`. New codes require `/lottery/request` and `/lottery/result` before issuance. Skipping this gives HTTP 403 `eligibility_incomplete_previous_step`.
- The successful lottery response is `{success:true,data:{status:"success",result:true,coupon_requested:true}}`. In this case poll the existing issue job; do not submit a duplicate issuance.
- The first detail HTML now has a JSON-escaped URL: `var url = "https:\/\/coupon.petit.gift\/issued-products\/<id>\/external-redirect?..."`.
- That endpoint follows HTTP redirects to `spot.petit.gift/campaigns/kakaotalk2609-fruit?code=…` for the verified sample.
- Second campaign login uses `login_type:1` and the decoded `code` query parameter only. Its coupon ID is 1262 for this sample, but code never hardcodes that ID.
- The third code was already issued during earlier authorized verification. The new trace correctly returned existing detail links at both login results, skipping lottery and issuance.
- Trace for this recheck: input login request 200/pending → input login result 200/success → detail 200 → external redirect 200 → fruit login request 200/pending → fruit login result 200/success → final detail 200 with barcode.
- Final HTML contains product image, `.product_barcode img`, barcode digits in `.product_barcode span`, expiry in `.product_ticketing_text`, and conditions in `.exchange_memo_body p`.
- Sample product: mango or pineapple stick; expiry: 2026-09-30 23:59. These are extracted live, not constants in the renderer.
- A hidden `#overlay` in the HTML contains a used-coupon label even for the captured normal page. Its mere text presence must not be interpreted as actual redemption status.

## Missing browser leg and fix

Previously only Axios calls used Japan. JSON still returned raw upstream detail/barcode URLs. Clicking a link or loading `<img>` made a new request from the user's IP. Successful server activation did not guarantee browser access. In this recheck, both direct and proxied local HTTP requests returned 200; that does not reproduce the user's browser/network and does not justify leaving direct URLs in the UI.

Now:

1. All API calls share `createJapanClient`; missing proxy configuration is an explicit error.
2. Lookup only reports success after loading the final detail HTML, barcode bytes and product image through Japan. A 200 HTML block page is not an image.
3. Browser links point to `/api/coupons/view?ticket=…` and `/api/coupons/image?ticket=…` on this app.
4. View requests decrypt a purpose-bound, authenticated ticket. Targets are limited to known coupon detail and image paths; redirects are disabled for these fetches.
5. The read-only viewer extracts original product/expiry/conditions and embeds image bytes as data URLs. It does not execute upstream scripts, mark redemption, or load any upstream browser resources.
6. Images in result cards and image-open links also pass through the app's Japan client. Copied links are absolute app URLs.
7. Responses are private/no-store, no-referrer and noindex. HTML uses a restrictive CSP. Ticket lifetime is 30 days; re-querying generates fresh tickets. The upstream coupon expiry still applies independently.
8. `COUPON_VIEW_SECRET` may provide a stable server key; otherwise the existing proxy URL supplies the key material. Changing that value invalidates old viewer links. Secrets never go to the browser.

A successful display confirms retrieval of the page and barcode, not whether a shop has already redeemed the coupon. Lottery loss and campaign IP quotas remain real upstream outcomes.

## Verification results

- Production build tested locally against the designated third code: lookup HTTP 200 with both URLs on this application; detail HTTP 200; barcode HTTP 200, `image/png`, 376 bytes.
- Detail HTML embeds two data images (product and barcode) and contains no external HTTP(S) URL.
- Browser visual check confirmed product image, readable barcode, serial digits, expiry and conditions on the new viewer.
- Unit/regression suite: 16 tests, including ticket tampering/expiry/type binding, restricted targets, HTML masquerading as an image, no browser upstream URLs, delayed jobs, existing issuance, September redirects and IP limits.

Vercel's dependency installation is separated from coupon traffic: `installCommand` clears HTTP(S)_PROXY only for `npm ci`. The application environment remains unchanged and every coupon request still uses PROXY_URL. This avoids sending package installation traffic through the application proxy.

## Production verification and remaining infrastructure issue

- Vercel deployed `japan-coupon-view-v3` successfully. Its PROXY_URL was synchronized with the locally verified value with explicit user approval.
- The production lookup of the designated third code stops at `Login request: HTTP 403 (Squid proxy)`, before any campaign issuance. The same flow succeeds locally.
- The HTTP adapter is explicitly Node's `http` adapter so `HttpsProxyAgent` is used.
- Deployment completion must not be reported as end-to-end production success. Squid access policy/logs need inspection to explain why the Vercel-origin connection is rejected.
- Proxy error diagnostics retain only the gateway name and Squid ERR_* code, never the HTML body, request URLs, or credentials.
