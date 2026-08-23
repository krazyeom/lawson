import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

interface CouponResult {
  code: string;
  success: boolean;
  coupon_detail_link: string | null;
  error?: string;
}

interface LoginRequestResponse {
  success: boolean;
  message: string;
  data?: {
    status: string;
    login_process_id: string;
  };
}

interface LoginResultResponse {
  success: boolean;
  message: string;
  data?: {
    token: string;
    status: string;
    current_history?: {
      coupon?: {
        has_got: boolean;
        coupon_detail_link?: string;
      };
    };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lookupCoupon(
  code: string,
  campaignSlug: string
): Promise<CouponResult> {
  try {
    // Step 1: Login request to get login_process_id
    const loginRes = await fetch(
      `https://gw2.petit.gift/api/campaigns/${encodeURIComponent(campaignSlug)}/auth/login/request`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Origin: "https://spot.petit.gift",
          Referer: "https://spot.petit.gift/",
        },
        body: JSON.stringify({
          utm_url: null,
          login_type: 5,
          codes: [code],
        }),
      }
    );

    if (!loginRes.ok) {
      return {
        code,
        success: false,
        coupon_detail_link: null,
        error: `Login request failed: HTTP ${loginRes.status}`,
      };
    }

    const loginData: LoginRequestResponse = await loginRes.json();

    if (!loginData.success || !loginData.data?.login_process_id) {
      return {
        code,
        success: false,
        coupon_detail_link: null,
        error: loginData.message || "Login request failed",
      };
    }

    const loginProcessId = loginData.data.login_process_id;

    // Small delay before checking result
    await sleep(200);

    // Step 2: Get login result with token and coupon link
    const resultRes = await fetch(
      `https://gw2.petit.gift/api/campaigns/${encodeURIComponent(campaignSlug)}/auth/login/result?login_process_id=${encodeURIComponent(loginProcessId)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*",
          Origin: "https://spot.petit.gift",
          Referer: "https://spot.petit.gift/",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15",
        },
      }
    );

    if (!resultRes.ok) {
      return {
        code,
        success: false,
        coupon_detail_link: null,
        error: `Login result failed: HTTP ${resultRes.status}`,
      };
    }

    const resultData: LoginResultResponse = await resultRes.json();

    if (!resultData.success) {
      return {
        code,
        success: false,
        coupon_detail_link: null,
        error: resultData.message || "Login result failed",
      };
    }

    const couponLink =
      resultData.data?.current_history?.coupon?.coupon_detail_link || null;

    return {
      code,
      success: !!couponLink,
      coupon_detail_link: couponLink,
      error: couponLink ? undefined : "No coupon link found in response",
    };
  } catch (err) {
    return {
      code,
      success: false,
      coupon_detail_link: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
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
      !campaignSlug
    ) {
      return Response.json(
        { success: false, message: "codes array and campaignSlug are required" },
        { status: 400 }
      );
    }

    // Process codes sequentially with delay to avoid rate limiting
    const results: CouponResult[] = [];

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i].trim();
      if (!code) continue;

      const result = await lookupCoupon(code, campaignSlug);
      results.push(result);

      // Delay between requests (except for the last one)
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
        failed: results.filter((r) => !r.success).length,
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
