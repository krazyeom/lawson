import type { NextRequest } from "next/server";
import { createJapanClient, getProxyUrl } from "../../../../lib/japan-client";
import { createViewTickets, privateHeaders, renderCouponPage } from "../../../../lib/coupon-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const tickets = createViewTickets(process.env.COUPON_VIEW_SECRET || getProxyUrl() || "");
  let url: string;
  try {
    url = tickets.open(request.nextUrl.searchParams.get("ticket") || "", "detail");
  } catch {
    return new Response("쿠폰 확인 링크가 만료되었거나 올바르지 않습니다. 코드를 다시 조회해 주세요.", { status: 400, headers: privateHeaders });
  }
  try {
    const html = await renderCouponPage(createJapanClient(), url);
    return new Response(html, { headers: {
      ...privateHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
    } });
  } catch {
    return new Response("일본 프록시로 쿠폰 상세 또는 이미지를 확인하지 못했습니다. 잠시 후 다시 조회해 주세요.", { status: 502, headers: privateHeaders });
  }
}
