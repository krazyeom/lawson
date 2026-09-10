import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AxiosInstance } from "axios";
import { load } from "cheerio";

export type ViewKind = "detail" | "image";
const lifetime = 30 * 24 * 60 * 60 * 1000;

// Only known coupon pages/assets can be fetched; callers cannot supply proxy URLs.
export function validateViewUrl(value: string, kind: ViewKind) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.port || url.username || url.password) throw new Error("Invalid coupon URL");
  const allowed = kind === "detail"
    ? url.hostname === "coupon.petit.gift" && url.pathname === "/coupons/detail"
    : (url.hostname === "coupon.petit.gift" && url.pathname === "/generator/barcode") ||
      (url.hostname === "upload.petit.gift" && /^\/product\/[\w/-]+\.(png|jpe?g|webp)$/i.test(url.pathname));
  if (!allowed) throw new Error("Invalid coupon URL");
  return url.toString();
}

export function createViewTickets(secret: string) {
  if (!secret) throw new Error("쿠폰 확인 링크의 서버 키가 설정되지 않았습니다.");
  const key = createHash("sha256").update(`lawson-coupon-view-v1:${secret}`).digest();
  return {
    seal(url: string, kind: ViewKind, now = Date.now()) {
      validateViewUrl(url, kind);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify({ url, kind, expires: now + lifetime })), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
    },
    open(ticket: string, kind: ViewKind, now = Date.now()): string {
      try {
        if (!ticket || ticket.length > 8192) throw new Error();
        const bytes = Buffer.from(ticket, "base64url");
        const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
        if (data.kind !== kind || !Number.isFinite(data.expires) || data.expires <= now) throw new Error();
        return validateViewUrl(data.url, kind);
      } catch {
        throw new Error("쿠폰 확인 링크가 만료되었거나 올바르지 않습니다. 코드를 다시 조회해 주세요.");
      }
    },
  };
}

export const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export async function fetchCouponImage(client: Pick<AxiosInstance, "get">, url: string) {
  validateViewUrl(url, "image");
  const res = await client.get<ArrayBuffer>(url, { responseType: "arraybuffer", maxRedirects: 0 });
  const bytes = Buffer.from(res.data);
  // A 200 HTML error page must never count as a successfully loaded barcode.
  let type: string;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) type = "image/png";
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) type = "image/jpeg";
  else if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") type = "image/webp";
  else throw new Error(`쿠폰 이미지 확인 실패 (HTTP ${res.status})`);
  if (res.status !== 200) throw new Error(`쿠폰 이미지 확인 실패 (HTTP ${res.status})`);
  return { bytes, type };
}

export function parseCouponPage(html: string) {
  const $ = load(html);
  const barcode = $('.product_barcode img').attr('src');
  if (!barcode) throw new Error("쿠폰 상세 화면에서 바코드를 확인하지 못했습니다. 발급 완료로 처리하지 않습니다.");
  validateViewUrl(barcode, "image");
  const product = $('.product_image img').attr('src');
  if (product) validateViewUrl(product, "image");
  return {
    barcode,
    product,
    serial: $('.product_barcode span').text().trim(),
    expiry: $('.product_ticketing_text').text().trim(),
    paragraphs: $('.exchange_memo_body p').toArray().map(p => $(p).text().trim()).filter(Boolean),
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export async function renderCouponPage(client: Pick<AxiosInstance, "get">, url: string) {
  validateViewUrl(url, "detail");
  const res = await client.get<string>(url, { maxRedirects: 0 });
  if (res.status !== 200 || typeof res.data !== "string") throw new Error(`쿠폰 상세 확인 실패 (HTTP ${res.status})`);
  const detail = parseCouponPage(res.data);
  const barcode = await fetchCouponImage(client, detail.barcode);
  let product = "";
  if (detail.product) {
    const photo = await fetchCouponImage(client, detail.product);
    product = `<img class="product" alt="교환 상품" src="data:${photo.type};base64,${photo.bytes.toString("base64")}">`;
  }
  // Build a read-only view from text and image bytes, never upstream scripts/forms.
  // Every resource is already fetched through Japan; the browser makes no upstream requests.
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lawson 쿠폰 확인</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#171717;font:16px/1.65 system-ui,sans-serif}main{max-width:560px;margin:24px auto;padding:24px;background:#fff;border-radius:16px}h1{font-size:22px}img{display:block;max-width:100%;margin:20px auto}.product{max-height:240px;object-fit:contain}.barcode{width:242px;image-rendering:pixelated}.serial{text-align:center;font:20px monospace;letter-spacing:1px}.expiry{text-align:center;color:#b51f48;font-weight:bold}.note{font-size:13px;color:#555}hr{border:0;border-top:1px solid #ddd;margin:24px 0}p{overflow-wrap:anywhere}@media(max-width:600px){main{margin:0;border-radius:0}}
  </style></head><body><main><h1>Lawson 쿠폰</h1>${product}<img class="barcode" alt="쿠폰 바코드" src="data:${barcode.type};base64,${barcode.bytes.toString("base64")}"><p class="serial">${escapeHtml(detail.serial)}</p><p class="expiry">쿠폰 유효기한<br>${escapeHtml(detail.expiry)}</p><p class="note">쿠폰 상세와 바코드를 서버에서 확인한 화면입니다. 유효기간과 이용 조건을 확인해 주세요.</p><hr>${detail.paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join("")}</main></body></html>`;
}
