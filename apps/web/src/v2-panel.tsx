"use client";

import type {
  MarketPriceInsight,
  PriceAlert,
  PriceHistoryResponse,
  PriceJudgment,
  SearchIntent,
} from "@flight-lens/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type PriceToolsProps = {
  apiBase: string;
  intent: SearchIntent;
  marketPriceInsights: MarketPriceInsight[];
  priceJudgment: PriceJudgment;
};

const kindLabels = {
  verified_all_in: "可核验全价",
  listed_only: "来源展示价",
  split_ticket: "分开购买价",
} as const;

const kindColors = {
  verified_all_in: "#087f5b",
  listed_only: "#1557d6",
  split_ticket: "#b54708",
} as const;

const levelDetails = [
  { id: "terrible", label: "拉完了", compact: "拉完", color: "#c44536", description: "明显高于历史常见价格" },
  { id: "npc", label: "NPC", compact: "NPC", color: "#a94f08", description: "价格偏高" },
  { id: "standard", label: "人上人", compact: "正常", color: "#735a00", description: "处于正常价格区间" },
  { id: "excellent", label: "顶级", compact: "顶级", color: "#176b50", description: "价格较低" },
  { id: "top", label: "夯", compact: "夯", color: "#087f8c", description: "处于历史低位" },
] as const;

function ownerToken(): string {
  const key = "flight-lens-owner-token";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID().replaceAll("-", "");
  window.localStorage.setItem(key, created);
  return created;
}

function historyUrl(apiBase: string, intent: SearchIntent, days: number): string {
  const params = new URLSearchParams({
    origin: intent.origin.code,
    destination: intent.destination.code,
    departureDate: intent.departureDate,
    cabin: intent.cabin,
    adults: String(intent.adults),
    days: String(days),
  });
  if (intent.returnDate) params.set("returnDate", intent.returnDate);
  return `${apiBase}/v2/prices/history?${params}`;
}

type HistoryObservation = PriceHistoryResponse["observations"][number];
type HistoryChartPoint = {
  observedAt: string;
  label: string;
  [key: string]: string | number | null;
};

function dayKey(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

function dailyWindow(windowDays: number, now: Date): Map<string, HistoryChartPoint> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - (Math.max(1, windowDays) - 1) * 86_400_000);
  const points = new Map<string, HistoryChartPoint>();
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 86_400_000) {
    const date = new Date(cursor);
    const key = dayKey(date);
    points.set(key, { observedAt: `${key}T00:00:00.000Z`, label: key.slice(5).replace("-", "/") });
  }
  return points;
}

/** Keep the requested date window visible while leaving unobserved dates blank. */
export function buildHistoryChartData(
  observations: HistoryObservation[],
  windowDays: number,
  now = new Date(),
): HistoryChartPoint[] {
  const points = dailyWindow(windowDays, now);
  for (const item of observations) {
    if (item.totalAmountCnyMinor === null) continue;
    const point = points.get(dayKey(item.observedAt));
    if (!point) continue;
    const seriesKey = `${item.observationKind}::${item.sellerId}`;
    const amount = item.totalAmountCnyMinor / 100;
    const current = point[seriesKey];
    point[seriesKey] = typeof current === "number" ? Math.min(current, amount) : amount;
  }
  return [...points.values()];
}

export function buildMarketHistoryChartData(
  insight: MarketPriceInsight | undefined,
  windowDays: number,
  now = new Date(),
): HistoryChartPoint[] {
  const points = dailyWindow(windowDays, now);
  for (const item of insight?.history ?? []) {
    const point = points.get(item.date);
    if (!point) continue;
    const amount = item.amountMinor / 100;
    const current = point.market;
    point.market = typeof current === "number" ? Math.min(current, amount) : amount;
  }
  return [...points.values()];
}

function money(amountMinor: number | null): string {
  return amountMinor === null ? "暂无" : `¥${Math.round(amountMinor / 100).toLocaleString("zh-CN")}`;
}

function formatDateTime(value: string | null): string {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "尚未检查";
}

function confidenceLabel(value: PriceJudgment["confidence"]): string {
  return value === "high" ? "高" : value === "medium" ? "中" : value === "low" ? "低" : "无";
}

function priceBasisLabel(value: PriceJudgment["currentPriceBasis"]): string {
  return value ? kindLabels[value] : "暂无可比价格";
}

function PriceLevelAxis({ judgment, detailed = false }: { judgment: PriceJudgment; detailed?: boolean }) {
  return (
    <div className={`price-level-axis ${detailed ? "detailed" : ""}`} aria-label="价格水平：从偏贵到划算">
      <div className="price-level-segments">
        {levelDetails.map((level) => (
          <span key={level.id} style={{ backgroundColor: level.color }} title={`${level.label}：${level.description}`}>
            <b>{detailed ? level.label : level.compact}</b>
          </span>
        ))}
        {judgment.status === "available" && (
          <>
            <i className="price-level-typical" title="典型价格区间" aria-hidden="true" />
            <i className="price-level-median" title={`历史中位数 ${money(judgment.quantilesMinor?.p50 ?? null)}`} aria-hidden="true" />
          </>
        )}
        {judgment.positionPercent !== null && (
          <i className="price-level-marker" style={{ left: `${judgment.positionPercent}%` }} title={`当前 ${money(judgment.currentAmountMinor)}`}>
            <em>{money(judgment.currentAmountMinor)}</em>
          </i>
        )}
      </div>
      <div className="price-level-direction"><span>偏贵</span><span>更划算</span></div>
    </div>
  );
}

export function PriceTools({ apiBase, intent, marketPriceInsights, priceJudgment }: PriceToolsProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"history" | "alerts">("history");
  const [historyDays, setHistoryDays] = useState(90);
  const [history, setHistory] = useState<PriceHistoryResponse | null>(null);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [targetCny, setTargetCny] = useState(1000);
  const [intervalMinutes, setIntervalMinutes] = useState(360);
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [monitorAvailable, setMonitorAvailable] = useState<boolean | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const insight = marketPriceInsights.find((item) =>
    item.originCode === intent.origin.code &&
    item.destinationCode === intent.destination.code &&
    item.departureDate === intent.departureDate &&
    item.returnDate === (intent.returnDate ?? null) &&
    item.tripType === intent.tripType &&
    item.cabin === intent.cabin &&
    item.adults === intent.adults,
  );
  const level = levelDetails.find((item) => item.id === priceJudgment.level);

  useEffect(() => {
    const controller = new AbortController();
    fetch(historyUrl(apiBase, intent, historyDays), { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("history unavailable")))
      .then((payload: PriceHistoryResponse) => setHistory(payload))
      .catch(() => setHistory(null));
    return () => controller.abort();
  }, [apiBase, historyDays, intent]);

  useEffect(() => {
    if (!open || view !== "alerts") return;
    fetch(`${apiBase}/v2/alerts`, { headers: { "x-flight-lens-owner": ownerToken() } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("alerts unavailable")))
      .then((payload: { alerts: PriceAlert[]; delivery?: { serverSchedulingConfigured?: boolean } }) => {
        setAlerts(payload.alerts);
        setMonitorAvailable(payload.delivery?.serverSchedulingConfigured === true);
      })
      .catch(() => { setAlerts([]); setMonitorAvailable(false); });
  }, [apiBase, open, view]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>("button, input, select, [href], [tabindex]:not([tabindex='-1'])")]
        .filter((element) => !element.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      trigger?.focus();
    };
  }, [open]);

  const siteChartData = useMemo(() => buildHistoryChartData(history?.observations ?? [], historyDays), [history, historyDays]);
  const marketChartData = useMemo(() => buildMarketHistoryChartData(insight, historyDays), [historyDays, insight]);
  const siteSeries = useMemo(() => {
    const keysWithValues = new Set(siteChartData.flatMap((point) => Object.keys(point).filter((key) => key.includes("::") && typeof point[key] === "number")));
    return [...new Map((history?.observations ?? [])
      .filter((item) => item.totalAmountCnyMinor !== null && keysWithValues.has(`${item.observationKind}::${item.sellerId}`))
      .map((item) => [`${item.observationKind}::${item.sellerId}`, { key: `${item.observationKind}::${item.sellerId}`, kind: item.observationKind, seller: item.sellerName }])).values()];
  }, [history, siteChartData]);
  const externalObservedDays = new Set((insight?.history ?? []).map((item) => item.date)).size;
  const siteObservedDays = new Set((history?.observations ?? []).filter((item) => item.totalAmountCnyMinor !== null).map((item) => dayKey(item.observedAt))).size;

  function showDrawer(nextView: "history" | "alerts") {
    setView(nextView);
    setOpen(true);
  }

  async function createAlert() {
    setMessage("");
    const response = await fetch(`${apiBase}/v2/alerts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerToken: ownerToken(), intent, targetAmountCnyMinor: Math.round(targetCny * 100), checkIntervalMinutes: intervalMinutes, ntfyTopic: topic }),
    });
    const payload = await response.json() as PriceAlert & { error?: { code?: string } };
    if (!response.ok) { setMessage(payload.error?.code ?? "提醒创建失败"); return; }
    setAlerts((current) => [payload, ...current]);
    setMessage("提醒已创建，服务端会按计划检查。");
  }

  async function changeAlert(alert: PriceAlert, action: "active" | "paused" | "deleted") {
    const response = await fetch(`${apiBase}/v2/alerts/${alert.id}`, {
      method: action === "deleted" ? "DELETE" : "PATCH",
      headers: { "content-type": "application/json", "x-flight-lens-owner": ownerToken() },
      ...(action === "deleted" ? {} : { body: JSON.stringify({ status: action }) }),
    });
    if (!response.ok) return;
    setAlerts((current) => action === "deleted" ? current.filter((item) => item.id !== alert.id) : current.map((item) => item.id === alert.id ? { ...item, status: action } : item));
  }

  async function testAlert(alert: PriceAlert) {
    setMessage("");
    const response = await fetch(`${apiBase}/v2/alerts/${alert.id}/test`, { method: "POST", headers: { "x-flight-lens-owner": ownerToken() } });
    setMessage(response.ok ? "已安排立即核验；达到目标后才会推送。" : "立即核验安排失败，可稍后重试。");
  }

  return (
    <>
      <section className="price-tools-card" aria-label="现在买贵不贵">
        <div className="price-tools-heading"><span>价格判断</span><small>{confidenceLabel(priceJudgment.confidence)}可信度</small></div>
        <div className="price-tools-current">
          <span>{priceBasisLabel(priceJudgment.currentPriceBasis)}</span>
          <strong>{money(priceJudgment.currentAmountMinor)}</strong>
        </div>
        {priceJudgment.status === "available" && level ? (
          <>
            <div className="price-level-summary"><b style={{ color: level.color }}>{level.label}</b><span>{level.description}</span></div>
            <PriceLevelAxis judgment={priceJudgment} />
            <p>{priceJudgment.typicalPriceRangeMinor ? `典型区间 ${money(priceJudgment.typicalPriceRangeMinor[0])}–${money(priceJudgment.typicalPriceRangeMinor[1])}` : `历史中位数 ${money(priceJudgment.quantilesMinor?.p50 ?? null)}`}</p>
          </>
        ) : (
          <div className="price-judgment-unavailable"><b>暂无法判断</b><p>{priceJudgment.explanation}</p></div>
        )}
        <div className="price-tools-source">
          <span>{insight?.sourceName ?? "本站观测"}</span>
          <span>{priceJudgment.observedDayCount} 个观测日{insight ? ` · 更新 ${formatDateTime(insight.fetchedAt)}` : ""}</span>
        </div>
        <div className="price-tools-actions">
          <button ref={triggerRef} onClick={() => showDrawer("history")}>查看详情</button>
          <button onClick={() => showDrawer("alerts")}>设置提醒</button>
        </div>
      </section>

      {open && (
        <div className="price-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div ref={drawerRef} className="price-drawer" role="dialog" aria-modal="true" aria-labelledby="price-drawer-title">
            <header>
              <div><span>价格工具</span><h2 id="price-drawer-title">价格历史与提醒</h2></div>
              <button ref={closeRef} className="price-drawer-close" onClick={() => setOpen(false)} aria-label="关闭价格工具">×</button>
            </header>
            <div className="price-drawer-tabs" role="tablist" aria-label="价格工具视图">
              <button role="tab" aria-selected={view === "history"} className={view === "history" ? "selected" : ""} onClick={() => setView("history")}>历史与判断</button>
              <button role="tab" aria-selected={view === "alerts"} className={view === "alerts" ? "selected" : ""} onClick={() => setView("alerts")}>价格提醒</button>
            </div>

            {view === "history" ? (
              <div className="price-history-detail">
                <section className="judgment-detail">
                  <div><span>当前判断</span><strong style={{ color: level?.color }}>{level?.label ?? "暂无法判断"}</strong><small>{priceJudgment.explanation}</small></div>
                  <PriceLevelAxis judgment={priceJudgment} detailed />
                  {priceJudgment.quantilesMinor && (
                    <div className="quantile-grid">
                      {(["p20", "p40", "p50", "p60", "p80"] as const).map((key) => <span key={key}><small>{key.toUpperCase()}</small><b>{money(priceJudgment.quantilesMinor![key])}</b></span>)}
                    </div>
                  )}
                </section>
                <div className="history-range" aria-label="价格历史时间范围">
                  {[30, 90, 180].map((days) => <button key={days} className={historyDays === days ? "selected" : ""} onClick={() => setHistoryDays(days)}>{days} 天</button>)}
                </div>
                <section className="history-source-block">
                  <div className="history-source-head"><div><span>外部市场历史</span><h3>{insight?.sourceName ?? "暂无可靠历史数据"}</h3></div><small>过去 {historyDays} 天 · {externalObservedDays} 个观测日{insight && <><br />更新 {formatDateTime(insight.fetchedAt)}</>}</small></div>
                  {insight && externalObservedDays > 0 ? (
                    <div className="history-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={marketChartData} margin={{ top: 12, right: 18, bottom: 4, left: 0 }}>
                          <CartesianGrid stroke="#e6ebf2" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 9 }} minTickGap={35} />
                          <YAxis tick={{ fontSize: 9 }} width={48} tickFormatter={(value) => `¥${value}`} />
                          <Tooltip formatter={(value) => [`¥${Number(value).toLocaleString("zh-CN")}`, "来源展示价"]} />
                          {insight.typicalPriceRangeMinor && <ReferenceArea y1={insight.typicalPriceRangeMinor[0] / 100} y2={insight.typicalPriceRangeMinor[1] / 100} fill="#1557d6" fillOpacity={0.08} />}
                          {priceJudgment.quantilesMinor && <ReferenceLine y={priceJudgment.quantilesMinor.p50 / 100} stroke="#7a8798" strokeDasharray="4 4" />}
                          <Line dataKey="market" name="外部市场历史" stroke="#1557d6" connectNulls={false} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <div className="history-empty">该来源没有返回可用的历史日期，系统不会补造历史点。</div>}
                </section>
                <section className="history-source-block">
                  <div className="history-source-head"><div><span>本站观测</span><h3>Flight Lens 查询留存</h3></div><small>过去 {historyDays} 天 · {siteObservedDays} 个观测日</small></div>
                  {siteSeries.length ? (
                    <div className="history-chart compact-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={siteChartData} margin={{ top: 12, right: 18, bottom: 4, left: 0 }}>
                          <CartesianGrid stroke="#e6ebf2" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 9 }} minTickGap={35} />
                          <YAxis tick={{ fontSize: 9 }} width={48} tickFormatter={(value) => `¥${value}`} />
                          <Tooltip formatter={(value) => [`¥${Number(value).toLocaleString("zh-CN")}`, "价格"]} />
                          {siteSeries.map((series, index) => <Line key={series.key} dataKey={series.key} name={`${kindLabels[series.kind]} · ${series.seller}`} stroke={kindColors[series.kind]} strokeDasharray={index % 2 ? "5 3" : undefined} connectNulls={false} strokeWidth={1.7} dot={{ r: 2 }} isAnimationActive={false} />)}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <div className="history-empty">当前路线尚无本站历史观测。它不会被当前一次搜索的报价分布替代。</div>}
                </section>
                <p className="history-method">缺失日期留空；同日同来源取最低观测值。外部市场历史、本站观测和当前 Offer 分布始终分开呈现。</p>
              </div>
            ) : (
              <div className="alert-workspace">
                <div className="alert-form">
                  <label>目标可核验全价（人民币）<input type="number" min="1" value={targetCny} onChange={(event) => setTargetCny(Number(event.target.value))} /></label>
                  <label>检查频率<select value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}><option value="60">每小时</option><option value="360">每 6 小时</option><option value="720">每 12 小时</option><option value="1440">每天</option></select></label>
                  <label>ntfy Topic<input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="flight-lens-personal" /></label>
                  <button onClick={createAlert} disabled={!topic || targetCny <= 0 || monitorAvailable !== true}>创建提醒</button>
                  {message && <span role="status">{message}</span>}
                </div>
                <p className={`alert-delivery-note ${monitorAvailable === false ? "unavailable" : ""}`}>
                  {monitorAvailable === true
                    ? "提醒由服务端定时检查，网页无需保持打开。达到目标的最低可核验全价后，通知会发送到你订阅的 ntfy Topic；免费托管休眠时不保证准点。"
                    : monitorAvailable === false
                      ? "当前环境尚未配置服务端调度，价格提醒不会运行，也不会发送通知。"
                      : "正在核对服务端调度状态…"}
                </p>
                <div className="alert-list">
                  {alerts.length === 0 && <p>当前查询没有已配置的提醒。</p>}
                  {alerts.map((alert) => <article key={alert.id}>
                    <div><b>低于 {money(alert.targetAmountCnyMinor)}</b><small>渠道：ntfy / {alert.ntfyTopic}</small><small>状态：{alert.status === "active" ? "运行中" : "已暂停"} · 最近检查：{formatDateTime(alert.lastCheckedAt)}</small><small>下次计划：{formatDateTime(alert.nextCheckAt)}</small>{alert.lastErrorCode && <strong>上次失败：{alert.lastErrorCode}，可立即重试</strong>}</div>
                    <div className="alert-actions"><button onClick={() => testAlert(alert)} disabled={alert.status !== "active"}>立即核验</button><button onClick={() => changeAlert(alert, alert.status === "active" ? "paused" : "active")}>{alert.status === "active" ? "暂停" : "恢复"}</button><button onClick={() => changeAlert(alert, "deleted")}>删除</button></div>
                  </article>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
