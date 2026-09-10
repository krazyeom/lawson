import type { NextRequest } from "next/server";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { createCouponLookup, type CouponResult } from "../../../lib/coupons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const proxyUrl = process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const apiClient = axios.create({
  httpsAgent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined,
  proxy: false,
  timeout: 15_000,
  headers: {
    Accept: "application/json",
    Origin: "https://spot.petit.gift",
    Referer: "https://spot.petit.gift/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15",
  },
  validateStatus: () => true,
});
const lookupCoupon = createCouponLookup(apiClient);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// This read-only endpoint verifies which revision actually reached production.
export async function GET() {
  return Response.json({
    version: "lottery-redirect-v2",
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

    const results: CouponResult[] = [];

    // 속도 제한(Rate Limiting) 방지를 위해 순차 처리
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i].trim();
      if (!code) continue;

      const result = await lookupCoupon(code, campaignSlug);
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
    });
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
