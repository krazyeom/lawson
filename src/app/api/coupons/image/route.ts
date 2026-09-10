import type { NextRequest } from "next/server";
import { createJapanClient, getProxyUrl } from "../../../../lib/japan-client";
import { createViewTickets, privateHeaders, fetchCouponImage } from "../../../../lib/coupon-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const tickets = createViewTickets(process.env.COUPON_VIEW_SECRET || getProxyUrl() || "");
  let url: string;
  try {
    url = tickets.open(request.nextUrl.searchParams.get("ticket") || "", "image");
  } catch {
    return new Response("올바르지 않거나 만료된 이미지 링크입니다.", { status: 400, headers: privateHeaders });
  }
  try {
    const image = await fetchCouponImage(createJapanClient(), url);
    return new Response(new Uint8Array(image.bytes), { headers: { ...privateHeaders, "Content-Type": image.type } });
  } catch {
    return new Response("일본 프록시로 바코드 이미지를 확인하지 못했습니다.", { status: 502, headers: privateHeaders });
  }
}
