import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

export function getProxyUrl() {
  return process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
}

export function createJapanClient() {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) throw new Error("일본 프록시(PROXY_URL)가 설정되지 않았습니다.");
  return axios.create({
    httpsAgent: new HttpsProxyAgent(proxyUrl),
    proxy: false,
    timeout: 15_000,
    maxContentLength: 5 * 1024 * 1024,
    headers: {
      Accept: "application/json",
      Origin: "https://spot.petit.gift",
      Referer: "https://spot.petit.gift/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15",
    },
    validateStatus: () => true,
  });
}
