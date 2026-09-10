"use client";

import { useState, useCallback, useRef } from "react";

interface CouponResult {
  code: string;
  success: boolean;
  coupon_detail_link: string | null;
  barcode_url?: string | null;
  error?: string;
  status?: "not_won";
}

function generateCampaignSlug(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `kakaotalk${yy}${mm}-input`;
}

export default function Home() {
  const [campaignSlug, setCampaignSlug] = useState(generateCampaignSlug);
  const [codesText, setCodesText] = useState("");
  const [results, setResults] = useState<CouponResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const parseCodes = useCallback((text: string): string[] => {
    return text
      .split(/[\n\r,]+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .filter((c, i, arr) => arr.indexOf(c) === i);
  }, []);

  const codeCount = parseCodes(codesText).length;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSubmit = async () => {
    const codes = parseCodes(codesText);
    if (codes.length === 0) return;

    setIsLoading(true);
    setResults([]);
    setProgress({ current: 0, total: codes.length });

    const controller = new AbortController();
    abortRef.current = controller;

    const batchSize = 5;
    const allResults: CouponResult[] = [];

    try {
      for (let i = 0; i < codes.length; i += batchSize) {
        if (controller.signal.aborted) break;

        const batch = codes.slice(i, i + batchSize);
        const res = await fetch("/api/coupons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codes: batch, campaignSlug }),
          signal: controller.signal,
        });

        if (!res.ok) {
          for (const code of batch) {
            allResults.push({
              code,
              success: false,
              coupon_detail_link: null,
              error: `API error: ${res.status}`,
            });
          }
        } else {
          const data = await res.json();
          if (data.results) {
            allResults.push(...data.results);
          }
        }

        setResults([...allResults]);
        setProgress({
          current: Math.min(i + batchSize, codes.length),
          total: codes.length,
        });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        showToast("오류가 발생했습니다");
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      setIsLoading(false);
      showToast("처리를 중지했습니다");
    }
  };

  const handleCopyLink = (link: string, idx: number) => {
    navigator.clipboard.writeText(link).then(() => {
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 1500);
    });
  };

  const handleCopyAll = () => {
    const links = results
      .filter((r) => r.success && r.coupon_detail_link)
      .map((r) => r.coupon_detail_link)
      .join("\n");
    navigator.clipboard.writeText(links).then(() => {
      showToast("모든 링크를 복사했습니다");
    });
  };

  const handleAutoGenerate = () => {
    setCampaignSlug(generateCampaignSlug());
  };

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success && r.status !== "not_won").length;
  const notWonCount = results.filter((r) => r.status === "not_won").length;
  const campaignUrl = `https://spot.petit.gift/campaigns/${campaignSlug}/`;

  return (
    <main className="container">
      {/* Header */}
      <header className="header">
        <div className="header__icon">🎫</div>
        <h1 className="header__title">Lawson Coupon</h1>
        <p className="header__subtitle">쿠폰 조회</p>
      </header>

      {/* Campaign Settings */}
      <section className="card">
        <div className="card__title">
          <span className="card__title-icon">⚙️</span>
          캠페인 설정
        </div>
        <div className="campaign-row">
          <div className="input-group">
            <label htmlFor="campaign-slug">캠페인 슬러그</label>
            <input
              id="campaign-slug"
              type="text"
              className="input-field input-field--mono"
              value={campaignSlug}
              onChange={(e) => setCampaignSlug(e.target.value)}
              placeholder="kakaotalk2608-input"
            />
          </div>
          <button
            className="btn btn--secondary btn--auto"
            onClick={handleAutoGenerate}
            title="현재 연월로 자동 생성"
          >
            🔄 자동
          </button>
        </div>
        <div className="campaign-preview">
          📎{" "}
          <a href={campaignUrl} target="_blank" rel="noopener noreferrer">
            {campaignUrl}
          </a>
        </div>
      </section>

      {/* Coupon Code Input */}
      <section className="card">
        <div className="card__title">
          <span className="card__title-icon">📝</span>
          쿠폰 코드 입력
        </div>
        <textarea
          id="coupon-codes"
          className="textarea-field"
          value={codesText}
          onChange={(e) => setCodesText(e.target.value)}
          placeholder={`쿠폰 코드를 한 줄에 하나씩 입력하세요...\n\nA1B2C3D4EF\nX9Y8Z7W6VU\nK5L6M7N8PQ\nR3S4T5U6VW`}
          disabled={isLoading}
        />
        <div className="textarea-info">
          <span>한 줄에 하나씩, 중복 자동 제거</span>
          <span className="code-count">{codeCount}개</span>
        </div>

        <div className="actions">
          <button
            id="submit-btn"
            className="btn btn--primary"
            onClick={handleSubmit}
            disabled={isLoading || codeCount === 0}
          >
            {isLoading ? (
              <>
                <span className="spinner" />
                처리 중...
              </>
            ) : (
              <>🔍 일괄 검색</>
            )}
          </button>
          {isLoading && (
            <button
              id="stop-btn"
              className="btn btn--secondary"
              onClick={handleStop}
            >
              ⏹️ 중지
            </button>
          )}
        </div>
      </section>

      {/* Progress */}
      {(isLoading || results.length > 0) && progress.total > 0 && (
        <section className="card progress-section">
          <div className="progress-header">
            <span className="progress-label">처리 현황</span>
            <span className="progress-count">
              {progress.current} / {progress.total}
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-bar__fill"
              style={{
                width: `${(progress.current / progress.total) * 100}%`,
              }}
            />
          </div>
        </section>
      )}

      {/* Results */}
      {results.length > 0 && (
        <section className="card results-card">
          <div className="results-header">
            <div className="card__title" style={{ marginBottom: 0 }}>
              <span className="card__title-icon">📋</span>
              검색 결과
            </div>
            <div className="results-stats">
              <span className="stat-badge stat-badge--success">
                ✅ {successCount}
              </span>
              <span className="stat-badge stat-badge--error">
                ❌ {failCount}
              </span>
              {notWonCount > 0 && <span className="stat-badge">미당첨 {notWonCount}</span>}
            </div>
          </div>

          <div className="result-list">
            {results.map((r, i) => (
              <div
                key={`${r.code}-${i}`}
                className={`result-item ${r.success ? "result-item--success" : "result-item--error"}`}
              >
                <div className="result-item__top">
                  <div className="result-item__code">
                    <span className="index">{i + 1}</span>
                    {r.code}
                  </div>
                  {r.success ? (
                    <span className="status-pill status-pill--success">
                      성공
                    </span>
                  ) : (
                    <span className="status-pill status-pill--error">{r.status === "not_won" ? "미당첨" : "실패"}</span>
                  )}
                </div>

                <div className="result-item__body">
                  {r.barcode_url && (
                    <div className="result-item__barcode">
                      <img src={r.barcode_url} alt="barcode" />
                      <a
                        href={r.barcode_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="result-item__barcode-link"
                      >
                        바코드 이미지 열기
                      </a>
                    </div>
                  )}

                  {r.coupon_detail_link && (
                    <div className="result-item__actions">
                      <a
                        href={r.coupon_detail_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="action-btn"
                      >
                        🔗 쿠폰 상세 보기
                      </a>
                      <button
                        className={`action-btn ${copiedIndex === i ? "action-btn--copied" : ""}`}
                        onClick={() =>
                          handleCopyLink(r.coupon_detail_link!, i)
                        }
                      >
                        {copiedIndex === i ? "✓ 복사됨" : "📋 링크 복사"}
                      </button>
                    </div>
                  )}

                  {r.error && (
                    <div className="result-item__error">{r.error}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Copy All */}
          {successCount > 0 && (
            <div className="copy-all-section">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <h4>성공한 링크 목록</h4>
                <button
                  className="btn btn--secondary btn--small"
                  onClick={handleCopyAll}
                >
                  📋 전체 복사
                </button>
              </div>
              <textarea
                className="links-text"
                readOnly
                value={results
                  .filter((r) => r.success && r.coupon_detail_link)
                  .map((r) => r.coupon_detail_link)
                  .join("\n")}
              />
            </div>
          )}
        </section>
      )}

      {/* Empty State */}
      {!isLoading && results.length === 0 && (
        <section className="card">
          <div className="empty-state">
            <div className="empty-state__icon">🎟️</div>
            <p className="empty-state__text">
              쿠폰 코드를 입력하고 「일괄 검색」을 클릭하세요.
              <br />
              결과가 여기에 표시됩니다.
            </p>
          </div>
        </section>
      )}

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* Footer */}
      <footer className="footer">
        Made by{" "}
        <a
          href="https://github.com/krazyeom"
          target="_blank"
          rel="noopener noreferrer"
        >
          krazyeom
        </a>
        , 그래염 @{" "}
        <a
          href="https://cafe.naver.com/hexenyang"
          target="_blank"
          rel="noopener noreferrer"
        >
          LTC
        </a>
      </footer>
    </main>
  );
}
