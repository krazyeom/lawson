import type { NextRequest } from "next/server";
import { createCouponLookup, type CouponResult } from "../../../lib/coupons";
import { createJapanClient, getProxyUrl } from "../../../lib/japan-client";
import { createViewTickets, renderCouponPage, privateHeaders } from "../../../lib/coupon-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// This read-only endpoint verifies which revision actually reached production.
export async function GET() {
  return Response.json({
    version: "japan-coupon-view-v3",
    revision: process.env.VERCEL_GIT_COMMIT_SHA || "local",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { codes, campaignSlug } = body as {
      codes: string[];
      campaignSlug: string;
    };

    if (
      !codes ||
      !Array.isArray(codes) ||
      codes.length === 0 ||
      typeof campaignSlug !== "string" || !campaignSlug.trim() ||
      codes.some((code) => typeof code !== "string")
    ) {
      return Response.json(
        { success: false, message: "codes array and campaignSlug are required" },
        { status: 400 }
      );
    }

    const client = createJapanClient();
    const lookupCoupon = createCouponLookup(client);
    const tickets = createViewTickets(process.env.COUPON_VIEW_SECRET || getProxyUrl() || "");
    const results: CouponResult[] = [];

    // 속도 제한(Rate Limiting) 방지를 위해 순차 처리
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i].trim();
      if (!code) continue;

      const result = await lookupCoupon(code, campaignSlug);
      if (result.success && result.coupon_detail_link && result.barcode_url) {
        try {
          // Success means the full page AND image bytes were read through Japan.
          await renderCouponPage(client, result.coupon_detail_link);
          result.coupon_detail_link = `/api/coupons/view?ticket=${tickets.seal(result.coupon_detail_link, "detail")}`;
          result.barcode_url = `/api/coupons/image?ticket=${tickets.seal(result.barcode_url, "image")}`;
        } catch {
          result.success = false;
          result.error = "발급 이력은 있지만 일본 프록시를 통한 상세 화면·이미지 확인에 실패했습니다. 다시 조회해 주세요.";
        }
      } else if (result.success) {
        result.success = false;
        result.error = "바코드를 확인하지 못해 쿠폰 확인이 완료되지 않았습니다.";
      }
      // Never send an upstream link that would bypass the proxy in the browser.
      if (!result.success) {
        result.coupon_detail_link = null;
        result.barcode_url = null;
      }
      results.push(result);
      if (result.status === "ip_limited") break;

      if (i < codes.length - 1) {
        await sleep(300);
      }
    }

    return Response.json({
      success: true,
      results,
      summary: {
        total: results.length,
        success: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success && r.status !== "not_won").length,
        not_won: results.filter((r) => r.status === "not_won").length,
      },
    }, { headers: privateHeaders });
  } catch (err) {
    return Response.json(
      {
        success: false,
        message: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
