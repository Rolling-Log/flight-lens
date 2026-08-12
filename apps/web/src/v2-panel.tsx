"use client";

import type { PriceAlert, PriceHistoryResponse, SearchIntent, UserPreferences } from "@flight-lens/contracts";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type V2PanelProps = {
  apiBase: string;
  intent: SearchIntent;
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
    days: String(days),
  });
  if (intent.returnDate) params.set("returnDate", intent.returnDate);
  return `${apiBase}/v2/prices/history?${params}`;
}

export function V2Panel({ apiBase, intent }: V2PanelProps) {
  const [view, setView] = useState<"history" | "alerts" | "preferences">("history");
  const [historyDays, setHistoryDays] = useState(90);
  const [history, setHistory] = useState<PriceHistoryResponse | null>(null);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [targetCny, setTargetCny] = useState(1000);
  const [intervalMinutes, setIntervalMinutes] = useState(360);
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [preferences, setPreferences] = useState<Omit<UserPreferences, "ownerToken">>({
    homeOrigin: intent.origin,
    preferredAirlines: [],
    preferredAirports: [],
    cabin: intent.cabin,
    minimumCheckedBaggageKg: intent.minimumCheckedBaggageKg,
    redEyeWindow: intent.redEyeWindow ?? { start: "00:00", end: "06:00" },
    budgetAmountCnyMinor: intent.budget?.currency === "CNY" ? intent.budget.amountMinor : null,
    ntfyTopic: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch(historyUrl(apiBase, intent, historyDays), { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("history unavailable")))
      .then((payload: PriceHistoryResponse) => setHistory(payload))
      .catch(() => setHistory(null));
    return () => controller.abort();
  }, [apiBase, historyDays, intent]);

  useEffect(() => {
    if (view !== "alerts") return;
    fetch(`${apiBase}/v2/alerts`, { headers: { "x-flight-lens-owner": ownerToken() } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("alerts unavailable")))
      .then((payload: { alerts: PriceAlert[] }) => setAlerts(payload.alerts))
      .catch(() => setAlerts([]));
  }, [apiBase, view]);

  useEffect(() => {
    if (view !== "preferences") return;
    fetch(`${apiBase}/v2/preferences`, { headers: { "x-flight-lens-owner": ownerToken() } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("preferences unavailable")))
      .then((payload: { preferences: Omit<UserPreferences, "ownerToken"> | null }) => {
        if (payload.preferences) setPreferences(payload.preferences);
      })
      .catch(() => undefined);
  }, [apiBase, view]);

  const chartSeries = useMemo(() => [...new Map((history?.observations ?? [])
    .filter((item) => item.totalAmountCnyMinor !== null)
    .map((item) => [`${item.observationKind}::${item.sellerId}`, {
      key: `${item.observationKind}::${item.sellerId}`,
      kind: item.observationKind,
      seller: item.sellerName,
    }])).values()], [history]);
  const chartData = useMemo(() => (history?.observations ?? [])
    .filter((item) => item.totalAmountCnyMinor !== null)
    .map((item) => ({
      observedAt: item.observedAt,
      label: new Date(item.observedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      [`${item.observationKind}::${item.sellerId}`]: item.totalAmountCnyMinor! / 100,
    })), [history]);

  async function createAlert() {
    setMessage("");
    const response = await fetch(`${apiBase}/v2/alerts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerToken: ownerToken(),
        intent,
        targetAmountCnyMinor: Math.round(targetCny * 100),
        checkIntervalMinutes: intervalMinutes,
        ntfyTopic: topic,
      }),
    });
    const payload = await response.json() as PriceAlert & { error?: { code?: string } };
    if (!response.ok) {
      setMessage(payload.error?.code ?? "提醒创建失败");
      return;
    }
    setAlerts((current) => [payload, ...current]);
    setMessage("提醒已创建");
  }

  async function changeAlert(alert: PriceAlert, action: "active" | "paused" | "deleted") {
    const response = await fetch(`${apiBase}/v2/alerts/${alert.id}`, {
      method: action === "deleted" ? "DELETE" : "PATCH",
      headers: {
        "content-type": "application/json",
        "x-flight-lens-owner": ownerToken(),
      },
      ...(action === "deleted" ? {} : { body: JSON.stringify({ status: action }) }),
    });
    if (!response.ok) return;
    setAlerts((current) => action === "deleted"
      ? current.filter((item) => item.id !== alert.id)
      : current.map((item) => item.id === alert.id ? { ...item, status: action } : item));
  }

  async function testAlert(alert: PriceAlert) {
    setMessage("");
    const response = await fetch(`${apiBase}/v2/alerts/${alert.id}/test`, {
      method: "POST",
      headers: { "x-flight-lens-owner": ownerToken() },
    });
    setMessage(response.ok ? "已安排立即核验；只有达到目标的可核验全价才会推送。" : "立即核验安排失败");
  }

  async function savePreferences() {
    const response = await fetch(`${apiBase}/v2/preferences`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerToken: ownerToken(), ...preferences }),
    });
    setMessage(response.ok ? "偏好已保存" : "偏好保存失败");
  }

  async function clearPreferences() {
    const token = ownerToken();
    const [preferencesResponse, alertsResponse] = await Promise.all([
      fetch(`${apiBase}/v2/preferences`, { method: "DELETE", headers: { "x-flight-lens-owner": token } }),
      fetch(`${apiBase}/v2/alerts`, { method: "DELETE", headers: { "x-flight-lens-owner": token } }),
    ]);
    if (preferencesResponse.ok && alertsResponse.ok) {
      window.localStorage.removeItem("flight-lens-owner-token");
      setAlerts([]);
      setMessage("偏好、提醒和匿名标识已清除；路线价格历史是无身份的公共观测，不属于个人数据。");
    }
  }

  return (
    <section className="v2-panel" aria-label="价格历史与提醒">
      <div className="v2-panel-head">
        <div><span>V2</span><h3>价格历史与提醒</h3></div>
        <div className="v2-tabs" role="tablist" aria-label="价格工具">
          <button className={view === "history" ? "selected" : ""} onClick={() => setView("history")} role="tab" aria-selected={view === "history"}>价格历史</button>
          <button className={view === "alerts" ? "selected" : ""} onClick={() => setView("alerts")} role="tab" aria-selected={view === "alerts"}>价格提醒</button>
          <button className={view === "preferences" ? "selected" : ""} onClick={() => setView("preferences")} role="tab" aria-selected={view === "preferences"}>偏好</button>
        </div>
      </div>

      {view === "history" ? (
        <div className="history-workspace">
          <div className="history-range" aria-label="价格历史时间范围">
            {[30, 90, 180].map((days) => <button key={days} className={historyDays === days ? "selected" : ""} onClick={() => setHistoryDays(days)}>{days} 天</button>)}
          </div>
          <div className="trend-strip">
            {(Object.keys(kindLabels) as Array<keyof typeof kindLabels>).map((kind) => {
              const trend = history?.trends[kind];
              return <div key={kind}>
                <span style={{ color: kindColors[kind] }}>{kindLabels[kind]}</span>
                <b>{trend?.direction === "rising" ? "上涨" : trend?.direction === "falling" ? "下降" : trend?.direction === "stable" ? "稳定" : "样本不足"}</b>
                <small>{trend ? `${trend.sampleCount} 个样本 · 当前 ${trend.currentAmountMinor === null ? "暂无" : `¥${Math.round(trend.currentAmountMinor / 100)}`} · 最低 ${trend.historicalLowAmountMinor === null ? "暂无" : `¥${Math.round(trend.historicalLowAmountMinor / 100)}`} · ${trend.explanation}` : "正在读取历史"}</small>
              </div>;
            })}
          </div>
          {chartData.length ? (
            <div className="history-chart" aria-label="价格历史曲线">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 12, right: 18, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="#e6ebf2" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} minTickGap={35} />
                  <YAxis tick={{ fontSize: 9 }} width={48} tickFormatter={(value) => `¥${value}`} />
                  <Tooltip formatter={(value) => [`¥${Number(value).toLocaleString("zh-CN")}`, "价格"]} />
                  {chartSeries.map((series, index) => (
                    <Line key={series.key} dataKey={series.key} name={`${kindLabels[series.kind]} · ${series.seller}`} stroke={kindColors[series.kind]} strokeDasharray={index % 3 === 1 ? "5 3" : index % 3 === 2 ? "2 3" : undefined} connectNulls strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="history-empty">当前查询还没有可绘制的历史样本。完成更多真实查询后会在这里形成趋势。</div>}
        </div>
      ) : view === "alerts" ? (
        <div className="alert-workspace">
          <div className="alert-form">
            <label>目标全价（人民币）<input type="number" min="1" value={targetCny} onChange={(event) => setTargetCny(Number(event.target.value))} /></label>
            <label>检查频率<select value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}><option value="60">每小时</option><option value="360">每 6 小时</option><option value="720">每 12 小时</option><option value="1440">每天</option></select></label>
            <label>ntfy Topic<input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="flight-lens-personal" /></label>
            <button onClick={createAlert} disabled={!topic || targetCny <= 0}>创建提醒</button>
            {message && <span role="status">{message}</span>}
          </div>
          <div className="alert-list">
            {alerts.length === 0 && <p>当前查询没有提醒。</p>}
            {alerts.map((alert) => <article key={alert.id}>
              <div><b>低于 ¥{(alert.targetAmountCnyMinor / 100).toLocaleString("zh-CN")}</b><small>{alert.checkIntervalMinutes / 60} 小时检查一次 · {alert.status === "active" ? "运行中" : "已暂停"}</small></div>
              <button onClick={() => testAlert(alert)} disabled={alert.status !== "active"}>立即核验</button>
              <button onClick={() => changeAlert(alert, alert.status === "active" ? "paused" : "active")}>{alert.status === "active" ? "暂停" : "恢复"}</button>
              <button onClick={() => changeAlert(alert, "deleted")} aria-label="删除提醒">删除</button>
            </article>)}
          </div>
        </div>
      ) : (
        <div className="preferences-workspace">
          <label>常用出发地<input value={preferences.homeOrigin?.code ?? ""} maxLength={3} onChange={(event) => setPreferences((current) => ({ ...current, homeOrigin: event.target.value ? { kind: "airport", code: event.target.value.toUpperCase() } : undefined }))} /></label>
          <label>偏好航司<input value={preferences.preferredAirlines.join(",")} placeholder="MU,CA" onChange={(event) => setPreferences((current) => ({ ...current, preferredAirlines: event.target.value.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean) }))} /></label>
          <label>偏好机场<input value={preferences.preferredAirports.join(",")} placeholder="SHA,PVG" onChange={(event) => setPreferences((current) => ({ ...current, preferredAirports: event.target.value.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean) }))} /></label>
          <label>舱位<select value={preferences.cabin} onChange={(event) => setPreferences((current) => ({ ...current, cabin: event.target.value as SearchIntent["cabin"] }))}><option value="economy">经济舱</option><option value="premium_economy">高端经济舱</option><option value="business">商务舱</option><option value="first">头等舱</option></select></label>
          <label>最低托运行李<input type="number" min="0" max="46" value={preferences.minimumCheckedBaggageKg} onChange={(event) => setPreferences((current) => ({ ...current, minimumCheckedBaggageKg: Number(event.target.value) }))} /></label>
          <label>红眼开始<input type="time" value={preferences.redEyeWindow.start} onChange={(event) => setPreferences((current) => ({ ...current, redEyeWindow: { ...current.redEyeWindow, start: event.target.value } }))} /></label>
          <label>红眼结束<input type="time" value={preferences.redEyeWindow.end} onChange={(event) => setPreferences((current) => ({ ...current, redEyeWindow: { ...current.redEyeWindow, end: event.target.value } }))} /></label>
          <label>默认预算<input type="number" min="1" value={preferences.budgetAmountCnyMinor === null ? "" : preferences.budgetAmountCnyMinor / 100} onChange={(event) => setPreferences((current) => ({ ...current, budgetAmountCnyMinor: event.target.value ? Math.round(Number(event.target.value) * 100) : null }))} /></label>
          <label>ntfy Topic<input value={preferences.ntfyTopic ?? ""} onChange={(event) => setPreferences((current) => ({ ...current, ntfyTopic: event.target.value || null }))} /></label>
          <div className="preference-actions"><button onClick={savePreferences}>保存偏好</button><button onClick={clearPreferences}>清除偏好</button></div>
          {message && <span role="status">{message}</span>}
        </div>
      )}
    </section>
  );
}
