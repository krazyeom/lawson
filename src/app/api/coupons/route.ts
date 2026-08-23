import { NextRequest } from "next/server";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

// Vercel 환경에서 일본(Tokyo) 리전(hnd1) 강제 지정
// 이렇게 하면 Vercel 배포 시 일본 IP를 사용하여 차단을 우회할 수 있습니다.
export const preferredRegion = ["hnd1"];
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

interface IssueRequestResponse {
  success: boolean;
  message: string;
  data?: {
    status: string;
  };
}

interface IssueResultResponse {
  success: boolean;
  message: string;
  data?: {
    status: string;
    coupon_data?: {
      cp_exchange_url?: string;
    };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 환경 변수에서 프록시 URL을 가져옵니다. (로컬/PM2 환경용)
// 예: PROXY_URL="http://username:password@proxy.example.com:8080"
const proxyUrl = process.env.PROXY_URL;
const httpsAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

// axios 인스턴스 생성 (프록시가 설정되어 있으면 적용)
const apiClient = axios.create({
  httpsAgent,
  proxy: false, // axios 기본 프록시 기능 대신 https-proxy-agent 사용
  headers: {
    Accept: "application/json",
    Origin: "https://spot.petit.gift",
    Referer: "https://spot.petit.gift/",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15",
  },
  validateStatus: () => true, // 에러 코드 발생 시에도 예외를 던지지 않고 처리
});

async function lookupCoupon(
  code: string,
  campaignSlug: string
): Promise<CouponResult> {
  try {
    // 1단계: Login request를 호출하여 login_process_id 획득
    const loginRes = await apiClient.post<LoginRequestResponse>(
      `https://gw2.petit.gift/api/campaigns/${encodeURIComponent(campaignSlug)}/auth/login/request`,
      {
        utm_url: null,
        login_type: 5,
        codes: [code],
      }
    );

    if (loginRes.status !== 200) {
      return {
        code,
        success: false,
        coupon_detail_link: null,
        error: `Login request failed: HTTP ${loginRes.status}`,
      };
    }

    const loginData = loginRes.data;

    if (!loginData.success || !loginData.data?.login_process_id) {
      return {
        code,
        success: false,
        coupon_detail_link: null,
        error: loginData.message || "Login request failed",
      };
    }

    const loginProcessId = loginData.data.login_process_id;

    // 잠시 대기 (서버 부하 방지 및 데이터 갱신 시간 확보)
    await sleep(200);

    // 2단계: login_process_id로 결과(쿠폰 상세 링크) 조회
    const resultRes = await apiClient.get<LoginResultResponse>(
      `https://gw2.petit.gift/api/campaigns/${encodeURIComponent(campaignSlug)}/auth/login/result?login_process_id=${encodeURIComponent(loginProcessId)}`
    );

    if (resultRes.status !== 200) {
      return {
        code,
        success: false,
        coupon_detail_link: null,
        error: `Login result failed: HTTP ${resultRes.status}`,
      };
    }

    const resultData = resultRes.data;

    if (!resultData.success) {
      return {
        code,
        success: false,
        coupon_detail_link: null,
        error: resultData.message || "Login result failed",
      };
    }

    const token = resultData.data?.token;
    let couponLink = resultData.data?.current_history?.coupon?.coupon_detail_link || null;

    if (!couponLink && token) {
      // 3단계: 쿠폰 발행 요청 (Issue Request)
      const issueReqRes = await apiClient.post<IssueRequestResponse>(
        `https://gw2.petit.gift/api/campaigns/${encodeURIComponent(campaignSlug)}/coupons/issue/request`,
        { coupon_ids: [], has_detail: true },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (issueReqRes.status === 200 && issueReqRes.data?.success) {
        await sleep(500); // 서버 처리 대기

        // 4단계: 쿠폰 발행 결과 (Issue Result) 조회
        const issueResRes = await apiClient.get<IssueResultResponse>(
          `https://gw2.petit.gift/api/campaigns/${encodeURIComponent(campaignSlug)}/coupons/issue/result`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (issueResRes.status === 200 && issueResRes.data?.success) {
          couponLink = issueResRes.data.data?.coupon_data?.cp_exchange_url || null;
        }
      }
    }
      
    // 링크가 언어 파라미터를 갖도록 보정할 수 있습니다 (예: &lang=ko 추가)
    const finalLink = couponLink && !couponLink.includes("lang=ko") 
        ? `${couponLink}&lang=ko` 
        : couponLink;

    // 5단계: 최종 생성된 쿠폰 링크를 일본 IP 환경(apiClient)에서 한 번 GET 호출하여 활성화
    if (finalLink) {
      try {
        const activationRes = await apiClient.get(finalLink);
        
        // 만약 응답 HTML에 자바스크립트 리다이렉트가 있다면 (미사용 쿠폰의 경우)
        // 예: var url = 'https://spot.petit.gift/...'; window.location.href = url;
        const html = activationRes.data;
        if (typeof html === 'string') {
          const redirectMatch = html.match(/var\s+url\s*=\s*['"](https:\/\/spot\.petit\.gift[^'"]+)['"]/);
          if (redirectMatch && redirectMatch[1]) {
            const redirectUrl = redirectMatch[1];
            // 추출한 리다이렉트 URL로 한 번 더 요청을 보내어 실제 활성화(발급) 처리를 완료합니다.
            await apiClient.get(redirectUrl, {
              headers: {
                Referer: finalLink
              }
            });
          }
        }
        // 짧은 대기 추가 (순차 처리 안정성을 위해)
        await sleep(100);
      } catch (activationError) {
        // 활성화 호출 실패 시 에러 로깅만 하고 계속 진행
        console.error(`Failed to activate coupon link: ${finalLink}`, activationError);
      }
    }

    return {
      code,
      success: !!finalLink,
      coupon_detail_link: finalLink,
      error: finalLink ? undefined : "No coupon link found in response",
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

    const results: CouponResult[] = [];

    // 속도 제한(Rate Limiting) 방지를 위해 순차 처리
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i].trim();
      if (!code) continue;

      const result = await lookupCoupon(code, campaignSlug);
      results.push(result);

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
