import type { AxiosInstance, AxiosResponse } from "axios";

export interface CouponResult {
  code: string;
  success: boolean;
  status?: "not_won" | "ip_limited";
  coupon_detail_link: string | null;
  barcode_url?: string | null;
  error?: string;
}

interface JobData {
  status: string;
  error_cd?: string;
  login_process_id?: string;
  token?: string;
  result?: boolean;
  coupon_requested?: boolean;
  coupon_data?: { cp_exchange_url?: string };
  current_history?: {
    lottery?: { result?: boolean | null };
    coupon?: { coupon_detail_link?: string | null };
  };
}
interface JobResponse {
  success: boolean;
  error?: string;
  message?: string;
  data?: JobData;
}
interface Campaign {
  has_lottery: boolean;
  lottery_type?: number;
}

class NotWonError extends Error {}
class IpLimitError extends Error {}

function checked(response: AxiosResponse<JobResponse>, stage: string, requesting = false) {
  const body = response.data;
  if (body?.error === "campaign_max_ip_limit" || body?.data?.error_cd === "campaign_max_ip_limit") {
    throw new IpLimitError(`${stage}: 캠페인 IP 이용 한도에 도달했습니다 (campaign_max_ip_limit). 기존 발급 이력은 보존됩니다. 제한 해제 시점은 캠페인 운영처에 확인해 주세요.`);
  }
  // The official client resumes a job already in progress instead of issuing it again.
  if (requesting && body?.error === "job_requesting") return body;
  if (response.status !== 200 || !body?.success || body.data?.status === "error") {
    const detail = [body?.error, body?.data?.error_cd, body?.message]
      .filter((value) => typeof value === "string").join(": ");
    const html = typeof body === "string" ? body : "";
    const gateway = /cloudfront/i.test(html) ? "CloudFront" : /squid/i.test(html) ? "Squid proxy" : "";
    const server = String(response.headers?.server || "").replace(/[^a-zA-Z0-9 ._/-]/g, "").slice(0,60);
    const squidError = String(response.headers?.["x-squid-error"] || html.match(/ERR_[A-Z_]+/)?.[0] || "")
      .replace(/[^A-Z0-9_ -]/g, "").slice(0,80);
    const source = [gateway || server, squidError].filter(Boolean).join(": ");
    throw new Error(`${stage}: HTTP ${response.status}${source ? ` (${source})` : ""}${detail ? ` — ${detail}` : ""}`);
  }
  return body;
}

export function createCouponLookup(
  client: Pick<AxiosInstance, "get" | "post">,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  async function poll(url: string, stage: string, token?: string): Promise<JobData> {
    for (let attempt = 0; attempt < 20; attempt++) {
      await wait(500);
      const body = checked(await client.get<JobResponse>(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }), stage);
      if (body.data?.status === "success") return body.data;
      if (!["pending", "processing"].includes(body.data?.status ?? "")) {
        throw new Error(`${stage}: unexpected job status`);
      }
    }
    throw new Error(`${stage}: 처리 시간 초과 (결과 조회 20회)`);
  }

  async function resolveCampaign(slug: string, login: object): Promise<string> {
    const encoded = encodeURIComponent(slug);
    const base = `https://gw2.petit.gift/api/campaigns/${encoded}`;
    const start = checked(await client.post<JobResponse>(`${base}/auth/login/request`, login), "Login request");
    const processId = start.data?.login_process_id;
    if (!processId) throw new Error("Login request: missing login_process_id");
    const result = await poll(`${base}/auth/login/result?login_process_id=${encodeURIComponent(processId)}`, "Login result");
    const existingLink = result.current_history?.coupon?.coupon_detail_link;
    if (existingLink) return existingLink;
    const token = result.token;
    if (!token) throw new Error("Login result: missing token");
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const campaign = await client.get<Campaign>(`https://static.petit.gift/campaigns/${encoded}/campaign_info.json`);
    if (campaign.status !== 200 || typeof campaign.data?.has_lottery !== "boolean") {
      throw new Error(`Campaign info: invalid response (HTTP ${campaign.status})`);
    }

    let couponRequested = false;
    if (campaign.data.has_lottery) {
      // AFTER lotteries require a different entry flow; do not issue prematurely.
      if (campaign.data.lottery_type === 3) {
        throw new Error("이 캠페인은 사후 추첨 방식입니다. 공식 캠페인 페이지에서 진행해 주세요.");
      }
      let won = result.current_history?.lottery?.result;
      if (won == null) {
        checked(await client.post<JobResponse>(`${base}/lottery/request`, {
          coupon_ids: [], issue_on_win: true,
        }, auth), "Lottery request", true);
        const lottery = await poll(`${base}/lottery/result`, "Lottery result", token);
        won = lottery.result;
        couponRequested = lottery.coupon_requested === true;
      }
      if (won === false) throw new NotWonError("미당첨: 추첨 결과 쿠폰이 발급되지 않았습니다.");
      if (won !== true) throw new Error("Lottery result: missing result");
    }

    if (!couponRequested) {
      checked(await client.post<JobResponse>(`${base}/coupons/issue/request`, {
        coupon_ids: [], has_detail: true,
      }, auth), "Issue request", true);
    }
    const issued = await poll(`${base}/coupons/issue/result`, "Issue result", token);
    const link = issued.coupon_data?.cp_exchange_url;
    if (!link) throw new Error("Issue result: missing cp_exchange_url");
    return link;
  }

  return async function lookupCoupon(code: string, campaignSlug: string): Promise<CouponResult> {
    let finalLink: string | null = null;
    try {
      let link = await resolveCampaign(campaignSlug, { utm_url: null, login_type: 5, codes: [code] });
      // Both the input campaign and a redirected campaign use the same asynchronous flow.
      for (let step = 0; step < 6; step++) {
        const url = new URL(link);
        if (url.protocol !== "https:" || !["coupon.petit.gift", "spot.petit.gift"].includes(url.hostname)) {
          throw new Error("Coupon page: unexpected URL");
        }
        url.searchParams.set("lang", "ko");
        finalLink = url.toString();
        const page = await client.get<string>(finalLink);
        if (page.status !== 200 || typeof page.data !== "string") {
          throw new Error(`Coupon page: HTTP ${page.status}`);
        }
        // Axios follows HTTP redirects; imported coupons now pass through an
        // external-redirect endpoint before arriving at the second campaign.
        const responseUrl: string | undefined = page.request?.res?.responseUrl;
        const scriptUrl = page.data.match(/var\s+url\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
        let redirectUrl = responseUrl && responseUrl !== finalLink ? responseUrl : null;
        if (scriptUrl) {
          redirectUrl = scriptUrl[1].startsWith('"')
            ? JSON.parse(scriptUrl[1]) as string
            : scriptUrl[1].slice(1, -1).replace(/\\\//g, "/");
        }
        if (redirectUrl) {
          const destination = new URL(redirectUrl.replace(/&amp;/g, "&"));
          if (destination.protocol !== "https:" || !["coupon.petit.gift", "spot.petit.gift"].includes(destination.hostname)) {
            throw new Error("Coupon redirect: unexpected URL");
          }
          if (destination.hostname === "spot.petit.gift") {
            const slug = destination.pathname.match(/^\/campaigns\/([^/]+)\/?$/)?.[1];
            const nextCode = destination.searchParams.get("code");
            if (!slug || !nextCode) throw new Error("Coupon redirect: missing campaign or code");
            link = await resolveCampaign(slug, { utm_url: null, login_type: 1, code: nextCode });
            continue;
          }
          if (scriptUrl) {
            link = destination.toString();
            continue;
          }
          finalLink = destination.toString();
        }
        const barcode = page.data.match(/(https:\/\/coupon\.petit\.gift\/generator\/barcode\?[^"'<>\s]+)/)?.[1];
        return {
          code, success: true, coupon_detail_link: finalLink,
          barcode_url: barcode?.replace(/&amp;/g, "&") ?? null,
          error: barcode ? undefined : "바코드 이미지를 찾지 못했습니다. 쿠폰 상세 링크를 확인해 주세요.",
        };
      }
      throw new Error("Coupon redirect: too many steps");
    } catch (error) {
      return {
        code, success: false, coupon_detail_link: finalLink,
        ...(error instanceof NotWonError ? { status: "not_won" as const } : {}),
        ...(error instanceof IpLimitError ? { status: "ip_limited" as const } : {}),
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  };
}
