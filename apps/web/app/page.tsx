"use client";

import type {
  IntentParseResponse,
  Offer,
  SearchIntent,
  SearchResponse,
} from "@flight-lens/contracts";
import Image from "next/image";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolveApiBase } from "../src/api-base";
import {
  isSingleSourceLiveResult,
  resultSourceStatus,
} from "../src/result-source-status";

type Mode = "agent" | "form";
type SortKey =
  | "recommended"
  | "price"
  | "duration"
  | "stops"
  | "baggage"
  | "flexibility";
type BusyState = "idle" | "parsing" | "searching";
type StopsFilter = "all" | "direct" | "one_or_less";
type ConnectorMeta = { id: string; name: string };

const cabinLabels: Record<SearchIntent["cabin"], string> = {
  economy: "经济舱",
  premium_economy: "高端经济舱",
  business: "商务舱",
  first: "头等舱",
};

function apiBase(): string {
  return resolveApiBase(
    process.env.NEXT_PUBLIC_API_BASE_URL,
    typeof window === "undefined" ? "" : window.location.hostname,
  );
}

function dateFromToday(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function initialIntent(): SearchIntent {
  return {
    schemaVersion: "1",
    tripType: "round_trip",
    origin: { kind: "airport", code: "PVG" },
    destination: { kind: "airport", code: "NRT" },
    departureDate: dateFromToday(30),
    returnDate: dateFromToday(35),
    flexibleDays: 0,
    adults: 1,
    cabin: "economy",
    budget: { amountMinor: 300_000, currency: "CNY" },
    departureTime: { earliest: "06:00", latest: "22:00" },
    directOnly: false,
    maxStops: 1,
    avoidRedEye: true,
    minimumCheckedBaggageKg: 0,
    includeNearbyAirports: false,
    explicitFields: [],
    inferredFields: [],
    pendingQuestions: [],
  };
}

function intentFromDraft(
  draft: IntentParseResponse["draft"],
  current: SearchIntent,
): SearchIntent {
  return {
    schemaVersion: "1",
    tripType: draft.tripType,
    origin: {
      kind: "airport",
      code: draft.originCode ?? "",
      ...(draft.originCode === current.origin.code && current.origin.name
        ? { name: current.origin.name }
        : {}),
    },
    destination: {
      kind: "airport",
      code: draft.destinationCode ?? "",
      ...(draft.destinationCode === current.destination.code && current.destination.name
        ? { name: current.destination.name }
        : {}),
    },
    departureDate: draft.departureDate ?? "",
    ...(draft.tripType === "round_trip"
      ? { returnDate: draft.returnDate ?? "" }
      : {}),
    flexibleDays: draft.flexibleDays,
    adults: draft.adults,
    cabin: draft.cabin,
    ...(draft.budgetAmountCny
      ? {
          budget: {
            amountMinor: draft.budgetAmountCny * 100,
            currency: "CNY" as const,
          },
        }
      : {}),
    ...(draft.departureTimeEarliest || draft.departureTimeLatest
      ? {
          departureTime: {
            ...(draft.departureTimeEarliest
              ? { earliest: draft.departureTimeEarliest }
              : {}),
            ...(draft.departureTimeLatest
              ? { latest: draft.departureTimeLatest }
              : {}),
          },
        }
      : {}),
    directOnly: draft.directOnly,
    maxStops: draft.maxStops,
    avoidRedEye: draft.avoidRedEye,
    minimumCheckedBaggageKg: draft.minimumCheckedBaggageKg,
    includeNearbyAirports: draft.includeNearbyAirports,
    explicitFields: [],
    inferredFields: draft.assumptions.map((reason, index) => ({
      path: `assumption.${index}`,
      value: true,
      confidence: 0.7,
      reason,
    })),
    pendingQuestions: draft.pendingQuestions,
  };
}

async function apiRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `请求失败（${response.status}）`);
  }
  return payload;
}

function offerJourneyMinutes(offer: Offer): number {
  return offer.legs.reduce((total, leg) => total + leg.durationMinutes, 0);
}

function offerStops(offer: Offer): number {
  return offer.legs.reduce((total, leg) => total + leg.stopCount, 0);
}

function offerCheckedBaggageKg(offer: Offer): number {
  return Math.max(
    0,
    ...offer.baggage
      .filter((allowance) => allowance.type === "checked" && allowance.included)
      .map((allowance) => allowance.weightKg ?? 0),
  );
}

function offerFlexibility(offer: Offer): number {
  return Number(offer.refundable === true) * 2 + Number(offer.changeable === true);
}

function money(offer: Offer): string {
  const value = offer.totalPriceCny ?? offer.totalPrice;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: value.currency,
    maximumFractionDigits: 0,
  }).format(value.amountMinor / 100);
}

function offerPriceLabel(offer: Offer): string {
  if (offer.priceVerificationStatus === "detail_verified") return "二次核验报价";
  if (offer.priceVerificationStatus === "provider_response_verified") return "来源接口核验价";
  if (offer.priceVerificationStatus === "listed_only") return "抓取时来源展示价";
  return "核验状态未确认";
}

function handoffSourceName(offer: Offer): string {
  if (offer.connectorId === "serpapi-google-flights") return "Google Flights";
  if (offer.connectorId === "flightapi-skyscanner") return "Skyscanner";
  return offer.seller.name;
}

function time(value: string): string {
  return value.slice(11, 16);
}

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}小时${rest ? `${rest}分` : ""}`;
}

function dayOffset(departureAt: string, arrivalAt: string): string {
  const ordinal = (value: string) => {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    return Date.UTC(year!, month! - 1, day!) / 86_400_000;
  };
  const difference = ordinal(arrivalAt) - ordinal(departureAt);
  return difference === 0 ? "" : difference > 0 ? `+${difference}` : String(difference);
}

function reportNote(note: string): string {
  if (note.startsWith("FLEXIBLE_DATE_THREE_POINT_PROBE:")) {
    return `三点日期探测：${note.split(":").slice(1).join(":")}`;
  }
  if (note.startsWith("FLEXIBLE_DATE_PROBE_UNSUPPORTED:")) {
    return "该来源仅查询基准日，未参与 ±3 天探测";
  }
  if (note.startsWith("PARTIAL_DATE_PROBE_FAILURE:")) {
    return `部分日期探测失败：${note.split(":").at(-1)}`;
  }
  if (note.startsWith("CACHE_HIT:")) {
    return `使用已标记的新鲜缓存：${note.split(":").at(-1)}`;
  }
  if (note.startsWith("CACHE_STALE_FALLBACK:")) {
    return `实时来源失败，降级使用旧缓存：${note.split(":").at(-1)}`;
  }
  if (note.startsWith("RETRY_ATTEMPTS:")) {
    return `瞬时错误重试：${note.split(":").at(-1)} 次`;
  }
  if (note.startsWith("NEARBY_ORIGIN_EXPANDED:")) {
    return `已展开出发机场：${note.split(":").at(-1)}`;
  }
  if (note.startsWith("NEARBY_ORIGIN_PROVIDER_EXPANSION:")) {
    return `已请求来源展开 ${note.split(":").at(-1)} 附近的出发机场`;
  }
  if (note.startsWith("NEARBY_ORIGIN_NO_CONFIGURED_ALTERNATIVES:")) {
    return `该来源没有 ${note.split(":").at(-1)} 的已配置附近出发机场`;
  }
  if (note.startsWith("BROWSER_DIAGNOSTIC:")) {
    return `页面诊断：${note.slice("BROWSER_DIAGNOSTIC:".length)}`;
  }
  return note;
}

function connectorStateLabel(state: SearchResponse["connectorReports"][number]["state"]): string {
  return ({
    pending: "等待中",
    searching: "检索中",
    success: "成功",
    empty: "无结果",
    timeout: "超时",
    rate_limited: "限流",
    auth_error: "凭据异常",
    login_required: "需登录",
    captcha_required: "需验证",
    page_changed: "页面变化",
    provider_error: "来源异常",
    invalid_response: "响应异常",
    unavailable: "不可用",
  } as const)[state];
}

function offerFingerprint(offer: Offer): string {
  return offer.segments.map((segment) => [
    segment.marketingCarrier,
    segment.flightNumber,
    segment.origin.code,
    segment.destination.code,
    segment.departureAt,
  ].join("|"))
    .join("::");
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("agent");
  const [query, setQuery] = useState(
    () => `${dateFromToday(30)} 上海去东京，${dateFromToday(35)} 返回，1 位成人，经济舱，预算 3000 元，不坐红眼航班。`,
  );
  const [intent, setIntent] = useState<SearchIntent>(() => initialIntent());
  const [parseResult, setParseResult] = useState<IntentParseResponse | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [sort, setSort] = useState<SortKey>("recommended");
  const [airlineFilter, setAirlineFilter] = useState("all");
  const [stopsFilter, setStopsFilter] = useState<StopsFilter>("all");
  const [connectorMeta, setConnectorMeta] = useState<ConnectorMeta[]>([]);
  const [busy, setBusy] = useState<BusyState>("idle");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  const [error, setError] = useState("");
  const coverageDialogRef = useRef<HTMLElement>(null);
  const coverageTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBase()}/v1/meta/connectors`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("metadata unavailable")))
      .then((payload: { connectors?: ConnectorMeta[] }) => setConnectorMeta(payload.connectors ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!showCoverage) return;
    const dialog = coverageDialogRef.current;
    if (!dialog) return;
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(focusableSelector),
    );
    focusable[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowCoverage(false);
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      coverageTriggerRef.current?.focus();
    };
  }, [showCoverage]);

  function openCoverage(trigger: HTMLButtonElement) {
    coverageTriggerRef.current = trigger;
    setShowCoverage(true);
  }

  function handleModeTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextMode = event.key === "ArrowLeft" || event.key === "Home" ? "agent" : "form";
    setMode(nextMode);
    window.requestAnimationFrame(() => {
      document.getElementById(`search-tab-${nextMode}`)?.focus();
    });
  }

  const effectiveSort: SortKey =
    (sort === "baggage" && !result?.bestBaggageOfferId) ||
    (sort === "flexibility" && !result?.mostFlexibleOfferId)
      ? "recommended"
      : sort;

  const orderedOffers = useMemo(() => {
    if (!result) return [];
    const offers = result.offers.filter((offer) =>
      offer.comparable &&
      (airlineFilter === "all" || offer.segments.some((segment) => segment.marketingCarrier === airlineFilter)) &&
      (stopsFilter === "all" ||
        (stopsFilter === "direct" ? offerStops(offer) === 0 : offerStops(offer) <= offer.legs.length)),
    );
    const comparableFirst = (left: Offer, right: Offer) =>
      Number(right.comparable) - Number(left.comparable);
    if (effectiveSort === "price") {
      return offers.sort((left, right) => {
        const a = left.totalPriceCny?.amountMinor ?? left.totalPrice.amountMinor;
        const b = right.totalPriceCny?.amountMinor ?? right.totalPrice.amountMinor;
        return comparableFirst(left, right) || a - b;
      });
    }
    if (effectiveSort === "duration") {
      return offers.sort(
        (left, right) =>
          comparableFirst(left, right) ||
          offerJourneyMinutes(left) - offerJourneyMinutes(right),
      );
    }
    if (effectiveSort === "stops") {
      return offers.sort(
        (left, right) =>
          comparableFirst(left, right) ||
          offerStops(left) - offerStops(right) ||
          offerJourneyMinutes(left) - offerJourneyMinutes(right),
      );
    }
    if (effectiveSort === "baggage") {
      return offers.sort(
        (left, right) =>
          comparableFirst(left, right) ||
          offerCheckedBaggageKg(right) - offerCheckedBaggageKg(left),
      );
    }
    if (effectiveSort === "flexibility") {
      return offers.sort(
        (left, right) =>
          comparableFirst(left, right) ||
          offerFlexibility(right) - offerFlexibility(left),
      );
    }
    return offers.sort((left, right) => {
      const comparableOrder = comparableFirst(left, right);
      if (comparableOrder) return comparableOrder;
      if (left.id === result.recommendedOfferId) return -1;
      if (right.id === result.recommendedOfferId) return 1;
      return 0;
    });
  }, [airlineFilter, effectiveSort, result, stopsFilter]);

  const airlines = useMemo(() => {
    if (!result) return [];
    return [...new Set(result.offers.flatMap((offer) =>
      offer.segments.map((segment) => segment.marketingCarrier),
    ))].sort();
  }, [result]);

  const groupedOffers = useMemo(() => {
    const groups = new Map<string, Offer[]>();
    for (const offer of orderedOffers) {
      const fingerprint = offerFingerprint(offer);
      const group = groups.get(fingerprint) ?? [];
      group.push(offer);
      groups.set(fingerprint, group);
    }
    return [...groups.entries()].map(([fingerprint, offers]) => ({ fingerprint, offers }));
  }, [orderedOffers]);

  function updateIntent(patch: Partial<SearchIntent>) {
    setIntent((current) => ({ ...current, ...patch }));
  }

  function updateDepartureTime(
    field: "earliest" | "latest",
    value: string,
  ) {
    const next = { ...intent.departureTime };
    if (value) next[field] = value;
    else delete next[field];
    updateIntent({
      departureTime: Object.keys(next).length ? next : undefined,
    });
  }

  function changeQuery(value: string) {
    setQuery(value);
    setParseResult(null);
    setResult(null);
    setAirlineFilter("all");
    setStopsFilter("all");
    setError("");
  }

  async function parseQuery(): Promise<SearchIntent | null> {
    if (query.trim().length < 3) {
      setError("先告诉我你想去哪里，以及大概什么时候出发。");
      return null;
    }
    setBusy("parsing");
    setError("");
    try {
      const parsed = await apiRequest<IntentParseResponse>("/v1/intents/parse", {
        text: query.trim(),
      });
      setParseResult(parsed);
      setIntent((current) => parsed.intent ?? intentFromDraft(parsed.draft, current));
      if (!parsed.ready || !parsed.intent) {
        setMode("form");
        setError(
          parsed.draft.pendingQuestions[0] ??
            "我已经提取了可确认的条件，请在精确筛选中补齐后再搜索。",
        );
        return null;
      }
      return parsed.intent;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法解析需求。");
      return null;
    } finally {
      setBusy("idle");
    }
  }

  async function runSearch() {
    let searchIntent: SearchIntent | null;
    if (mode === "agent") {
      if (parseResult?.ready && parseResult.intent) {
        // Once parsing has populated the shared form, `intent` is the
        // authoritative SearchIntent. The user may have edited it before
        // switching back to the agent tab, so reusing parseResult.intent
        // would silently discard those edits.
        searchIntent = intent;
      } else {
        await parseQuery();
        return;
      }
    } else {
      searchIntent = intent;
    }
    if (!searchIntent) return;
    setBusy("searching");
    setError("");
    setResult(null);
    try {
      const response = await apiRequest<SearchResponse>("/v1/searches", searchIntent);
      setResult(response);
      window.setTimeout(() => {
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "搜索失败，请稍后重试。");
    } finally {
      setBusy("idle");
    }
  }

  const lowest = result?.offers.find((offer) => offer.id === result.lowestComparableOfferId) ?? null;
  const excludedOfferCount =
    result?.offers.filter((offer) => !offer.comparable).length ?? 0;
  const usesSkyscanner = result?.offers.some(
    (offer) => ["skyscanner-live-prices", "flightapi-skyscanner"].includes(offer.connectorId),
  ) ?? false;
  const sourceStatus = result
    ? resultSourceStatus(result.offers, result.connectorReports)
    : null;
  const singleSourceLiveResult = result
    ? isSingleSourceLiveResult(result.offers)
    : false;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="航探首页">
          <span className="brand-mark">航</span>
          <span>航探 <small>Flight Lens</small></span>
        </a>
        <nav aria-label="主导航">
          <a className="active" href="#search">找机票</a>
          <a href="#coverage">数据覆盖</a>
          <a href="#principles">如何推荐</a>
        </nav>
        <button className="ghost-button" onClick={(event) => openCoverage(event.currentTarget)}>
          覆盖透明度 <span className="live-dot" /> V1 接入中
        </button>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span /> 中国航线优先的透明比价工具</div>
        <h1>看见本次最低价，<br /><em>也看懂它为什么便宜。</em></h1>
        <p className="hero-copy">
          核对已授权的航班数据来源，统一比较来源展示的含税报价、行李和必要服务，并明确披露成功、失败与超时来源。
        </p>

        <div className="search-shell" id="search">
          <div className="mode-tabs" role="tablist" aria-label="搜索方式">
            <button id="search-tab-agent" className={mode === "agent" ? "selected" : ""} onClick={() => setMode("agent")} onKeyDown={handleModeTabKeyDown} role="tab" aria-selected={mode === "agent"} aria-controls="search-panel-agent" tabIndex={mode === "agent" ? 0 : -1}>
              <span className="spark">✦</span> 对话找票
            </button>
            <button id="search-tab-form" className={mode === "form" ? "selected" : ""} onClick={() => setMode("form")} onKeyDown={handleModeTabKeyDown} role="tab" aria-selected={mode === "form"} aria-controls="search-panel-form" tabIndex={mode === "form" ? 0 : -1}>
              精确筛选
            </button>
          </div>

          {mode === "agent" ? (
            <div className="agent-panel" id="search-panel-agent" role="tabpanel" aria-labelledby="search-tab-agent">
              <label htmlFor="flight-query">直接说出完整需求，解析后可在表单中检查</label>
              <textarea
                id="flight-query"
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                aria-describedby={error ? "query-error" : undefined}
                disabled={busy !== "idle"}
              />
              <div className="prompt-row">
                <button onClick={() => changeQuery(`${dateFromToday(14)} 北京到成都，${dateFromToday(16)} 返回，1 位成人，预算 2500 元。`)}>周末往返</button>
                <button onClick={() => changeQuery(`${dateFromToday(30)} 上海飞东京，${dateFromToday(35)} 返回，1 位成人，直飞，不坐红眼航班。`)}>国际直飞</button>
                <button onClick={() => changeQuery(`${dateFromToday(21)} 广州飞新加坡，单程，1 位成人，允许中转 1 次。`)}>国际单程</button>
              </div>
              {parseResult?.ready && parseResult.intent && (
                <div className="intent-review agent-review" role="status">
                  <b>请确认已解析条件</b>
                  <span>
                    {intent.origin.code} → {intent.destination.code}
                    {" · "}
                    {intent.departureDate}
                    {intent.returnDate ? ` 至 ${intent.returnDate}` : ""}
                    {" · "}
                    {intent.adults} 位成人 · {cabinLabels[intent.cabin]}
                  </span>
                  <small>
                    {parseResult.parser.kind === "local_deterministic_zh"
                      ? "本地规则解析 · 未调用外部 AI"
                      : `AI 结构化解析 · ${parseResult.parser.model}`}
                  </small>
                  <button type="button" onClick={() => setMode("form")}>打开完整表单修改</button>
                </div>
              )}
            </div>
          ) : (
            <div className="form-panel" id="search-panel-form" role="tabpanel" aria-labelledby="search-tab-form">
              <div className="trip-switch" role="group" aria-label="行程类型">
                {([
                  ["one_way", "单程"],
                  ["round_trip", "往返"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    className={intent.tripType === value ? "selected" : ""}
                    onClick={() =>
                      updateIntent({
                        tripType: value,
                        returnDate:
                          value === "round_trip"
                            ? intent.returnDate ?? dateFromToday(35)
                            : undefined,
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <label>出发地 IATA<input value={intent.origin.code} maxLength={3} onChange={(event) => updateIntent({ origin: { ...intent.origin, code: event.target.value.toUpperCase() } })} /></label>
                <button
                  className="swap"
                  aria-label="交换出发地和目的地"
                  onClick={() => updateIntent({ origin: intent.destination, destination: intent.origin })}
                >
                  ⇄
                </button>
                <label>目的地 IATA<input value={intent.destination.code} maxLength={3} onChange={(event) => updateIntent({ destination: { ...intent.destination, code: event.target.value.toUpperCase() } })} /></label>
                <label>出发日期<input type="date" value={intent.departureDate} onChange={(event) => updateIntent({ departureDate: event.target.value })} /></label>
                <label>返程日期<input type="date" value={intent.returnDate ?? ""} onChange={(event) => updateIntent({ returnDate: event.target.value })} disabled={intent.tripType === "one_way"} /></label>
                <label>成人数
                  <input
                    type="number"
                    min={1}
                    max={9}
                    value={intent.adults}
                    onChange={(event) =>
                      updateIntent({ adults: Math.min(9, Math.max(1, Number(event.target.value) || 1)) })
                    }
                  />
                </label>
                <label>舱位
                  <select
                    value={intent.cabin}
                    onChange={(event) =>
                      updateIntent({ cabin: event.target.value as SearchIntent["cabin"] })
                    }
                  >
                    {Object.entries(cabinLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>总预算（人民币）
                  <input
                    type="number"
                    min={1}
                    step={100}
                    value={intent.budget ? intent.budget.amountMinor / 100 : ""}
                    placeholder="不限"
                    onChange={(event) =>
                      updateIntent({
                        budget: event.target.value
                          ? {
                              amountMinor: Math.round(Number(event.target.value) * 100),
                              currency: "CNY",
                            }
                          : undefined,
                      })
                    }
                  />
                </label>
                <label>最早起飞
                  <input
                    type="time"
                    value={intent.departureTime?.earliest ?? ""}
                    onChange={(event) => updateDepartureTime("earliest", event.target.value)}
                  />
                </label>
                <label>最晚起飞
                  <input
                    type="time"
                    value={intent.departureTime?.latest ?? ""}
                    onChange={(event) => updateDepartureTime("latest", event.target.value)}
                  />
                </label>
                <label>最多中转
                  <select
                    value={intent.directOnly ? 0 : intent.maxStops}
                    disabled={intent.directOnly}
                    onChange={(event) => updateIntent({ maxStops: Number(event.target.value) })}
                  >
                    <option value={0}>直飞</option>
                    <option value={1}>最多 1 次</option>
                    <option value={2}>最多 2 次</option>
                  </select>
                </label>
              </div>
              <div className="filter-chips">
                <label><input type="checkbox" checked={intent.directOnly} onChange={(event) => updateIntent({ directOnly: event.target.checked, maxStops: event.target.checked ? 0 : 1 })} />仅直飞</label>
                <label><input type="checkbox" checked={intent.minimumCheckedBaggageKg >= 23} onChange={(event) => updateIntent({ minimumCheckedBaggageKg: event.target.checked ? 23 : 0 })} />含 23kg 托运行李</label>
                <label><input type="checkbox" checked={intent.avoidRedEye} onChange={(event) => updateIntent({ avoidRedEye: event.target.checked })} />拒绝红眼</label>
                <label><input type="checkbox" checked={intent.includeNearbyAirports} onChange={(event) => updateIntent({ includeNearbyAirports: event.target.checked })} />出发地附近机场</label>
              </div>
              {parseResult && (
                <div className="intent-review">
                  <b>对话条件已回填</b>
                  <span>
                    {parseResult.draft.assumptions.length} 项推断 · {parseResult.draft.pendingQuestions.length} 项待确认
                    {" · "}
                    {parseResult.parser.kind === "local_deterministic_zh" ? "本地解析" : "AI 解析"}
                  </span>
                </div>
              )}
            </div>
          )}

          {error && <p className="field-error search-error" id="query-error" role="alert">{error}</p>}

          <div className="search-footer">
            <div className="search-promise">
              <span className="shield">✓</span>
              <span><strong>比较可核验来源报价</strong><small>没有实时来源时绝不展示演示价格</small></span>
            </div>
            <button className="primary-button" onClick={runSearch} disabled={busy !== "idle"}>
              {busy === "parsing" && <><span className="spinner" /> 正在解析条件</>}
              {busy === "searching" && <><span className="spinner" /> 正在核验来源</>}
              {busy === "idle" && mode === "agent" && parseResult?.ready
                ? <>确认条件并检索 <span>→</span></>
                : busy === "idle" && <>开始检索 <span>→</span></>}
            </button>
          </div>
          {busy === "searching" && (
            <div className="search-progress" role="status" aria-live="polite">
              <div><span className="spinner dark-spinner" />已并行提交所有已配置来源</div>
              {connectorMeta.length > 0 && (
                <div className="searching-sources">
                  {connectorMeta.map((connector) => (
                    <span key={connector.id}>{connector.name}<b>检索中</b></span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="trust-row">
          <span>V1 原则</span>
          <b>授权来源</b><b>统一全价</b><b>失败披露</b><b>证据可追溯</b>
          <button onClick={(event) => openCoverage(event.currentTarget)}>了解来源状态 +</button>
        </div>
      </section>

      {(result || (error && busy === "idle")) && (
        <section className="results-section revealed" id="results" aria-live="polite">
          <div className="section-heading">
            <div>
              <div className="eyebrow"><span /> 航班检索结果</div>
              <h2>{result?.intent.origin.code ?? intent.origin.code} → {result?.intent.destination.code ?? intent.destination.code}</h2>
              <p>{result?.intent.departureDate ?? intent.departureDate} · {result?.intent.adults ?? intent.adults} 位成人 · {cabinLabels[result?.intent.cabin ?? intent.cabin]} · 统一 Offer 口径</p>
            </div>
            {result && (
              <div className={`demo-badge ${sourceStatus?.productionStyle ? "production-badge" : ""}`}>
                {sourceStatus?.label}
              </div>
            )}
          </div>

          {!result ? (
            <div className="empty-state">
              <b>当前没有可展示的实时结果</b>
              <p>{error}</p>
              <span>系统没有用预设价格填补数据缺口。</span>
            </div>
          ) : (
            <div className="result-layout">
              <div className="result-main">
                <div className="price-insight">
                  <div>
                    <span>{lowest?.seller.handoffPrecision === "search_results" ? "本次最低来源展示价" : "本次最低可核验全价"}</span>
                    <strong>{lowest ? money(lowest) : "暂无"}</strong>
                    <small>{lowest ? `来自 ${lowest.seller.name}` : "成功来源中没有完整可比价格"}</small>
                  </div>
                  <div className="insight-copy">
                    <b>结论范围</b>
                    {singleSourceLiveResult && (
                      <strong className="scope-warning">
                        单来源实时搜索，尚非多来源比价
                      </strong>
                    )}
                    <p>{result.disclosure.statement}</p>
                  </div>
                  <div className="confidence">
                    <span>搜索审计</span>
                    <strong>{result.audit.persisted ? "已保存" : "未保存"}</strong>
                    <small>{result.audit.configured ? "Neon 审计状态已披露" : "数据库尚未配置"}</small>
                  </div>
                </div>

                <div className="result-toolbar">
                  <div className="sort-tabs">
                    {([
                      ["recommended", "平衡排序"],
                      ["price", "最低全价"],
                      ["duration", "最短耗时"],
                      ["stops", "最少中转"],
                      ...(result.bestBaggageOfferId ? [["baggage", "最佳行李"]] as const : []),
                      ...(result.mostFlexibleOfferId ? [["flexibility", "最宽松退改"]] as const : []),
                    ] as ReadonlyArray<readonly [SortKey, string]>).map(([key, label]) => (
                      <button key={key} className={effectiveSort === key ? "selected" : ""} onClick={() => setSort(key)}>{label}</button>
                    ))}
                  </div>
                  <div className="result-filters">
                    <label>航司
                      <select value={airlineFilter} onChange={(event) => setAirlineFilter(event.target.value)}>
                        <option value="all">全部</option>
                        {airlines.map((airline) => <option key={airline} value={airline}>{airline}</option>)}
                      </select>
                    </label>
                    <label>中转
                      <select value={stopsFilter} onChange={(event) => setStopsFilter(event.target.value as StopsFilter)}>
                        <option value="all">全部</option>
                        <option value="direct">仅直飞</option>
                        <option value="one_or_less">最多一次</option>
                      </select>
                    </label>
                  </div>
                  <span>
                    共 {groupedOffers.length} 个航班 · {orderedOffers.length} 个平台报价
                    {excludedOfferCount > 0
                      ? ` · ${excludedOfferCount} 个不符合条件的报价已隐藏`
                      : ""}
                  </span>
                </div>

                {usesSkyscanner && (
                  <a
                    className="powered-by"
                    href="https://www.skyscanner.net"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Powered by Skyscanner"
                  >
                    <Image
                      src="/skyscanner-powered-by.png"
                      width={150}
                      height={18}
                      alt="Powered by Skyscanner"
                    />
                  </a>
                )}

                {groupedOffers.length === 0 ? (
                  <div className="empty-state">
                    <b>来源已完成核验，但没有返回符合条件的报价</b>
                    <p>这与来源失败不同；你可以调整日期、直飞或行李条件后重试。</p>
                  </div>
                ) : (
                  <div className="flight-list">
                    {groupedOffers.map((group) => {
                      const offer = group.offers[0]!;
                      const groupIds = new Set(group.offers.map((candidate) => candidate.id));
                      const isLowest = result.lowestComparableOfferId ? groupIds.has(result.lowestComparableOfferId) : false;
                      const isRecommended = result.recommendedOfferId ? groupIds.has(result.recommendedOfferId) : false;
                      const distinctions = [
                        ...(isLowest ? [offer.seller.handoffPrecision === "search_results" ? "最低展示价" : "最低可核验全价"] : []),
                        ...(isRecommended ? ["平衡排序"] : []),
                        ...(offer.id === result.shortestOfferId ? ["最短耗时"] : []),
                        ...(offer.id === result.fewestStopsOfferId ? ["最少中转"] : []),
                        ...(offer.id === result.bestBaggageOfferId ? ["最佳行李"] : []),
                        ...(offer.id === result.mostFlexibleOfferId ? ["最宽松退改"] : []),
                      ];
                      return (
                        <article className="flight-card" key={group.fingerprint}>
                          <div className="flight-tag">
                            {distinctions.length
                              ? distinctions.join(" · ")
                              : offer.comparable
                                ? "可比报价"
                                : "条件不完整"}
                          </div>
                          <div className="flight-primary">
                            <div className="journey-stack">
                              {offer.legs.map((leg, legIndex) => {
                                const legSegments = offer.segments.filter(
                                  (segment) => segment.legIndex === legIndex,
                                );
                                const first = legSegments[0]!;
                                return (
                                  <div className="leg-row" key={leg.id}>
                                    <span className="leg-label">
                                      {offer.legs.length === 1 ? "单程" : legIndex === 0 ? "去程" : "返程"}
                                    </span>
                                    <div className="airline">
                                      <span className="airline-logo">{first.marketingCarrier}</span>
                                      <div>
                                        <b>{first.marketingCarrier} {first.flightNumber}</b>
                                        <small>{leg.stopCount ? `${leg.stopCount} 次中转` : "直飞"} · {offer.fareBrand ?? cabinLabels[result.intent.cabin]}</small>
                                      </div>
                                    </div>
                                    <div className="time">
                                      <strong>{time(leg.departureAt)}</strong>
                                      <small title={leg.origin.name}>{leg.origin.code}</small>
                                    </div>
                                    <div className="route-line">
                                      <span>{duration(leg.durationMinutes)}</span>
                                      <i />
                                      <small>{leg.stopCount ? `${leg.stopCount} 次中转` : "直飞"}</small>
                                    </div>
                                    <div className="time">
                                      <strong>
                                        {time(leg.arrivalAt)}
                                        {dayOffset(leg.departureAt, leg.arrivalAt) && (
                                          <sup>{dayOffset(leg.departureAt, leg.arrivalAt)}</sup>
                                        )}
                                      </strong>
                                      <small title={leg.destination.name}>{leg.destination.code}</small>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="price"><small>{offerPriceLabel(offer)}</small><strong>{money(offer)}</strong><span className="plain-price">{offer.seller.handoffPrecision === "search_results" ? "需在来源页重新选择" : "购买前再次核验"}</span></div>
                          </div>
                          <div className="flight-meta">
                            <div>
                              <span className="bag">▣</span>
                              {offerCheckedBaggageKg(offer)
                                ? `含 ${offerCheckedBaggageKg(offer)}kg 托运行李`
                                : offer.baggage.length
                                  ? `${offer.baggage.length} 项行李规则`
                                  : "行李规则待来源补全"}
                            </div>
                            <div>
                              退改：
                              {offer.refundable === true
                                ? "可退"
                                : offer.refundable === false
                                  ? "不可退"
                                  : "待核验"}
                              {" · "}
                              {offer.changeable === true
                                ? "可改"
                                : offer.changeable === false
                                  ? "不可改"
                                  : "待核验"}
                            </div>
                            <div className="source"><span>{offer.environment}</span><b>{offer.seller.name}</b><small>{new Date(offer.fetchedAt).toLocaleString("zh-CN")}</small></div>
                            {offer.seller.deepLink && (
                              <a
                                className="handoff-link"
                                href={offer.seller.deepLink}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {offer.seller.handoffPrecision === "search_results"
                                  ? `去 ${handoffSourceName(offer)} 重新选择 ↗`
                                  : `去 ${offer.seller.name} 核验 ↗`}
                              </a>
                            )}
                            <button onClick={() => setExpanded(expanded === offer.id ? null : offer.id)} aria-expanded={expanded === offer.id}>
                              {expanded === offer.id ? "收起价格构成" : "查看价格构成"} <span>⌄</span>
                            </button>
                          </div>
                          {group.offers.length > 1 && (
                            <div className="platform-quotes" aria-label="同航班平台报价">
                              {group.offers
                                .slice()
                                .sort((left, right) =>
                                  (left.totalPriceCny ?? left.totalPrice).amountMinor -
                                  (right.totalPriceCny ?? right.totalPrice).amountMinor,
                                )
                                .map((quote) => (
                                  <div key={quote.id}>
                                    <span>{quote.seller.name}</span>
                                    <b>{money(quote)}</b>
                                    <small>{offerPriceLabel(quote)}</small>
                                    {quote.seller.deepLink && <a href={quote.seller.deepLink} target="_blank" rel="noopener noreferrer">核验 ↗</a>}
                                  </div>
                                ))}
                            </div>
                          )}
                          {expanded === offer.id && (
                            <div className="price-breakdown">
                              <div className="segment-details">
                                <b>完整航段</b>
                                {offer.segments.map((segment) => (
                                  <span key={segment.id}>
                                    {segment.marketingCarrier} {segment.flightNumber} ·{" "}
                                    {segment.origin.name ?? segment.origin.code}{" "}
                                    {time(segment.departureAt)} →{" "}
                                    {segment.destination.name ?? segment.destination.code}{" "}
                                    {time(segment.arrivalAt)}
                                    {dayOffset(segment.departureAt, segment.arrivalAt)}
                                  </span>
                                ))}
                              </div>
                              {offer.priceComponents.map((component) => (
                                <span key={`${offer.id}-${component.kind}-${component.label}`}>{component.label}<b>{new Intl.NumberFormat("zh-CN", { style: "currency", currency: component.currency }).format(component.amountMinor / 100)}</b></span>
                              ))}
                              {offer.exchangeRate && (
                                <span>
                                  人民币换算汇率
                                  <b>
                                    1 {offer.exchangeRate.baseCurrency} = {offer.exchangeRate.rate} {offer.exchangeRate.quoteCurrency}
                                    {" · "}{offer.exchangeRate.source}
                                    {" · "}{new Date(offer.exchangeRate.quotedAt).toLocaleString("zh-CN")}
                                  </b>
                                </span>
                              )}
                              <span>来源记录总价<b>{money(offer)}</b></span>
                              {offer.seller.handoffPrecision === "search_results" && (
                                <p className="handoff-warning">
                                  此链接返回带本次条件的 {handoffSourceName(offer)} 结果页，不是该售卖方的精确报价落点；请重新选择相同行程并核验最终价格。
                                </p>
                              )}
                              <p>请在来源平台再次核验库存和最终支付页。航探不售票、不代收款。</p>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              <aside className="coverage-card" id="coverage">
                <div className="aside-title"><div><span className="radar">◎</span><b>本次检索覆盖</b></div><strong>{result.disclosure.successfulSources}/{result.disclosure.plannedSources}</strong></div>
                <div className="coverage-progress"><i style={{ width: `${result.disclosure.plannedSources ? (result.disclosure.successfulSources / result.disclosure.plannedSources) * 100 : 0}%` }} /></div>
                <p>{result.disclosure.statement}</p>
                <ul>
                  {result.connectorReports.map((report) => (
                    <li key={report.connectorId}>
                      <span>
                        <b>{report.connectorName}</b>
                        <small>{report.durationMs}ms · {report.offerCount} 个 Offer</small>
                        {report.notes.map((note) => (
                          <small key={note}>{reportNote(note)}</small>
                        ))}
                      </span>
                      <strong className={`source-state state-${report.state}`}>{connectorStateLabel(report.state)}</strong>
                    </li>
                  ))}
                </ul>
                <button onClick={(event) => openCoverage(event.currentTarget)}>查看来源规则</button>
                <div className="adversarial-note">
                  <b>对抗式检查</b>
                  <p>演示报价、总价构成错误、缺失汇率或没有购买落点的报价不会进入最低全价结论。</p>
                </div>
              </aside>
            </div>
          )}
        </section>
      )}

      <section className="principles" id="principles">
        <div className="section-heading">
          <div><div className="eyebrow"><span /> 推荐不是黑箱</div><h2>最低价必须经得起追问</h2></div>
        </div>
        <div className="principle-grid">
          <article><span>01</span><h3>同口径再比较</h3><p>统一税费、行李、支付手续费、机场与中转风险，拒绝用不可购买的“起价”制造错觉。</p></article>
          <article><span>02</span><h3>每个结论可追溯</h3><p>展示来源平台、核验时间、价格构成与覆盖缺口。没有证据时，不宣称“全网最低”。</p></article>
          <article><span>03</span><h3>主动寻找反例</h3><p>检查条件价、机场变化、经停、过期 Offer 与来源失败，明确告诉用户答案的边界。</p></article>
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark">航</span><span>航探 <small>Flight Lens</small></span></div>
        <p>只负责搜索与解释，不售票、不代收款。最终价格与规则以来源平台支付页为准。</p>
        <span>V1 开发版 · 2026</span>
      </footer>

      {showCoverage && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCoverage(false)}>
          <section ref={coverageDialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="coverage-title" aria-describedby="coverage-description" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCoverage(false)} aria-label="关闭">×</button>
            <div className="eyebrow"><span /> 来源透明度</div>
            <h2 id="coverage-title">来源数量不等于可信度</h2>
            <p id="coverage-description">来源只有在合法配置、实际响应、字段完整并通过价格校验后，才计入本次检索覆盖。超时和失败会单独披露。</p>
            <div className="source-table">
              <div><b>SerpApi</b><span>Google Flights 与实际售卖方报价；跳转精度单独披露</span><em>首个生产查询已验证</em></div>
              <div><b>FlightAPI / Skyscanner</b><span>航司 / OTA 当前价格与跳转；同属一个库存族</span><em>本地实验待复核授权</em></div>
              <div><b>PKFARE / Duffel</b><span>中国航信、GDS、航司直连等发现与交叉核验</span><em>等待生产权限</em></div>
              <div><b>航司 / OTA</b><span>按开放平台与商务授权逐步接入</span><em>禁止未授权绕过</em></div>
              <div><b>Mock 数据</b><span>只用于自动测试</span><em>生产强制禁用</em></div>
            </div>
            <div className="modal-warning"><b>重要边界</b><p>公开网页不等于允许稳定、合法地批量抓取。每个 Connector 都必须有授权依据、限流策略和退出方案。</p></div>
            <button className="primary-button" onClick={() => setShowCoverage(false)}>我知道了</button>
          </section>
        </div>
      )}
    </main>
  );
}
