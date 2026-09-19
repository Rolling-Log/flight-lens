"use client";

import type {
  IntentParseResponse,
  Offer,
  SearchIntent,
  SearchResponse,
} from "@flight-lens/contracts";
import { resolveLocation, searchMarket } from "@flight-lens/contracts";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ExternalLink,
  Heart,
  Info,
  Luggage,
  Plane,
  Radar,
  Search,
  ShieldCheck,
  ShoppingBasket,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolveApiBase } from "../src/api-base";
import { searchWithEdgeCompanion } from "../src/edge-companion";
import { LocationCombobox } from "../src/location-combobox";
import { resultSourceStatus } from "../src/result-source-status";
import { isOfferVisible } from "../src/offer-visibility";
import { PriceTools } from "../src/v2-panel";
import { AccountPanel } from "../src/account-panel";
import { accountFetch } from "../src/account-api";
import { LiquidGlassSurface } from "../src/liquid-glass-surface";
import {
  emptyLiquidOrigin,
  liquidOriginFromElement,
  useLiquidOverlayMotion,
} from "../src/liquid-overlay-motion";

type Mode = "agent" | "form";
type WorkspaceView = "search" | "results" | "detail";
type SortKey =
  | "recommended"
  | "price"
  | "duration"
  | "stops"
  | "baggage"
  | "flexibility";
type BusyState = "idle" | "parsing" | "searching";
type SearchProgressState = { percent: number; label: string };
type StopsFilter = "all" | "direct" | "one_or_less";
type ConnectorMeta = { id: string; name: string };
type SearchProgressSource = ConnectorMeta & { access: "本机 Edge" | "云端 API" };
type AirportReference = {
  kind?: "airport" | "city";
  code: string;
  name?: string;
};

const shortlistStorageKey = "flight-lens-shortlist-v1";

function airportPresentation(airport?: AirportReference | null) {
  if (!airport) return { name: "机场待确认", code: "---" };

  const resolved = airport.kind
    ? resolveLocation(airport.kind, airport.code)
    : resolveLocation("airport", airport.code) ?? resolveLocation("city", airport.code);
  const resolvedName = resolved
    ? resolved.kind === "city"
      ? `${resolved.cityNameZh}（所有机场）`
      : `${resolved.cityNameZh} · ${resolved.airportNameZh}`
    : undefined;
  const suppliedName = airport.name?.trim();
  const name = suppliedName && /[\u3400-\u9fff]/u.test(suppliedName)
    ? suppliedName
    : resolvedName ?? suppliedName ?? "机场待确认";

  return { name, code: airport.code };
}

function AirportLabel({ airport, className = "" }: { airport?: AirportReference | null; className?: string }) {
  const display = airportPresentation(airport);
  return (
    <span className={`airport-label ${className}`.trim()} title={`${display.name} ${display.code}`}>
      <b>{display.name}</b>
      <small>{display.code}</small>
    </span>
  );
}

function AirportRoute({ origin, destination, className = "" }: { origin?: AirportReference | null; destination?: AirportReference | null; className?: string }) {
  return (
    <span className={`airport-route ${className}`.trim()}>
      <AirportLabel airport={origin} />
      <ArrowRight aria-hidden="true" />
      <AirportLabel airport={destination} />
    </span>
  );
}

const edgeCompanionSources: SearchProgressSource[] = [
  { id: "ctrip-edge-companion", name: "携程", access: "本机 Edge" },
  { id: "qunar-edge-companion", name: "去哪儿", access: "本机 Edge" },
  { id: "tongcheng-edge-companion", name: "同程", access: "本机 Edge" },
  { id: "fliggy-edge-companion", name: "飞猪", access: "本机 Edge" },
];

const cabinLabels: Record<SearchIntent["cabin"], string> = {
  economy: "经济舱",
  premium_economy: "高端经济舱",
  business: "商务舱",
  first: "头等舱",
};

const navGlassConfig = {
  borderRadius: 26,
  borderWidth: 0.045,
  brightness: 92,
  opacity: 0.68,
  blur: 7,
  displace: 0.2,
  backgroundOpacity: 0.08,
  saturation: 1.2,
  distortionScale: -28,
  redOffset: 0,
  greenOffset: 2,
  blueOffset: 5,
  mixBlendMode: "screen",
} as const;

const actionGlassConfig = {
  borderRadius: 28,
  borderWidth: 0.05,
  brightness: 92,
  opacity: 0.72,
  blur: 7,
  displace: 0.25,
  backgroundOpacity: 0.06,
  saturation: 1.28,
  distortionScale: -34,
  redOffset: 0,
  greenOffset: 3,
  blueOffset: 6,
  mixBlendMode: "screen",
} as const;

const summaryGlassConfig = {
  borderRadius: 18,
  borderWidth: 0.04,
  brightness: 94,
  opacity: 0.66,
  blur: 8,
  displace: 0.2,
  backgroundOpacity: 0.08,
  saturation: 1.18,
  distortionScale: -24,
  redOffset: 0,
  greenOffset: 2,
  blueOffset: 4,
  mixBlendMode: "screen",
} as const;

const toolbarGlassConfig = {
  ...summaryGlassConfig,
  borderRadius: 12,
  backgroundOpacity: 0.18,
  saturation: 1.35,
  distortionScale: -20,
} as const;

const statusGlassConfig = {
  borderRadius: 31,
  borderWidth: 0.05,
  brightness: 92,
  opacity: 0.7,
  blur: 7,
  displace: 0.25,
  backgroundOpacity: 0.04,
  saturation: 1.24,
  distortionScale: -30,
  mixBlendMode: "screen",
  redOffset: 0,
  greenOffset: 2,
  blueOffset: 5,
} as const;

function apiBase(): string {
  return resolveApiBase(
    process.env.NEXT_PUBLIC_API_BASE_URL,
    typeof window === "undefined" ? "" : window.location.hostname,
  );
}

function plannedProgressSources(intent: SearchIntent, connectorMeta: ConnectorMeta[]): SearchProgressSource[] {
  const companionSources = searchMarket(intent.origin, intent.destination) === "domestic_cn"
    ? edgeCompanionSources
    : edgeCompanionSources.slice(0, 1);
  return [
    ...companionSources,
    ...connectorMeta.map((connector) => ({ ...connector, access: "云端 API" as const })),
  ];
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
    redEyeWindow: { start: "00:00", end: "06:00" },
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
    ...(draft.redEyeStart && draft.redEyeEnd
      ? { redEyeWindow: { start: draft.redEyeStart, end: draft.redEyeEnd } }
      : {}),
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
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value.amountMinor / 100);
}

function offerPriceLabel(offer: Offer): string {
  if (offer.priceVerificationStatus === "detail_verified") return "二次核验报价";
  if (offer.priceVerificationStatus === "provider_response_verified") return "来源接口核验价";
  if (offer.priceVerificationStatus === "listed_only") return "抓取时来源展示价";
  return "核验状态未确认";
}

function priceSortValue(offer: Offer): number {
  return (offer.totalPriceCny ?? offer.totalPrice).amountMinor;
}

function compareEqualDisplayedPrice(left: Offer, right: Offer): number {
  const verificationRank = (offer: Offer) => ({
    detail_verified: 3,
    provider_response_verified: 2,
    listed_only: 1,
    unverified: 0,
  })[offer.priceVerificationStatus ?? "unverified"];
  const handoffRank = (offer: Offer) =>
    Number(offer.seller.handoffPrecision === "exact_offer") * 2 +
    Number(Boolean(offer.seller.deepLink));
  return Number(right.comparable) - Number(left.comparable) ||
    verificationRank(right) - verificationRank(left) ||
    handoffRank(right) - handoffRank(left) ||
    offerJourneyMinutes(left) - offerJourneyMinutes(right) ||
    offerStops(left) - offerStops(right);
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
    return `页面诊断码：${note.slice("BROWSER_DIAGNOSTIC:".length)}`;
  }
  if (note.startsWith("UNSUPPORTED_QUERY:")) {
    const reason = note.split(":").at(-1) ?? "UNKNOWN";
    const labels: Record<string, string> = {
      TRIP_TYPE_UNSUPPORTED: "不支持当前行程类型",
      MARKET_UNSUPPORTED: "不覆盖当前国内/国际市场",
      LOCATION_KIND_UNSUPPORTED: "不支持当前地点类型",
      CABIN_UNSUPPORTED: "不支持当前舱位",
      PASSENGER_COUNT_UNSUPPORTED: "超出支持的乘客人数",
    };
    return labels[reason] ?? `不适用当前条件：${reason}`;
  }
  if (note.startsWith("CITY_AIRPORT_EXPANSION:")) {
    return `已在搜索规划中展开 ${note.split(":").at(-1)} 个机场组合`;
  }
  if (note.endsWith("_ROUND_TRIP_SPLIT_TICKET")) {
    return "去程与返程分别实时检索，按两张单程票组合";
  }
  if (note.endsWith("_EDGE_COMPANION_SESSION")) {
    return "由本机 Edge 登录会话实时核验";
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
    unsupported_query: "不适用本次查询",
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
  const [activeView, setActiveView] = useState<WorkspaceView>("search");
  const [mode, setMode] = useState<Mode>("agent");
  const [query, setQuery] = useState(
    () => `${dateFromToday(30)} 上海去东京，${dateFromToday(35)} 返回，1 位成人，经济舱，预算 3000 元，不坐红眼航班。`,
  );
  const [intent, setIntent] = useState<SearchIntent>(() => initialIntent());
  const [parseResult, setParseResult] = useState<IntentParseResponse | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [sort, setSort] = useState<SortKey>("recommended");
  const [priceDirection, setPriceDirection] = useState<"asc" | "desc">("asc");
  const [showPriceSortMenu, setShowPriceSortMenu] = useState(false);
  const [airlineFilter, setAirlineFilter] = useState("all");
  const [aircraftFilter, setAircraftFilter] = useState("all");
  const [departureAirportFilter, setDepartureAirportFilter] = useState("all");
  const [arrivalAirportFilter, setArrivalAirportFilter] = useState("all");
  const [stopsFilter, setStopsFilter] = useState<StopsFilter>("all");
  const [connectorMeta, setConnectorMeta] = useState<ConnectorMeta[]>([]);
  const [busy, setBusy] = useState<BusyState>("idle");
  const [searchProgress, setSearchProgress] = useState<SearchProgressState>({ percent: 0, label: "准备检索" });
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  const [coverageOrigin, setCoverageOrigin] = useState(emptyLiquidOrigin);
  const [navigationSplit, setNavigationSplit] = useState(false);
  const [navigationMaterialUnited, setNavigationMaterialUnited] = useState(true);
  const [shortlist, setShortlist] = useState<Offer[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = JSON.parse(localStorage.getItem(shortlistStorageKey) ?? "[]") as unknown;
      return Array.isArray(stored) ? stored as Offer[] : [];
    } catch {
      localStorage.removeItem(shortlistStorageKey);
      return [];
    }
  });
  const [showShortlist, setShowShortlist] = useState(false);
  const [shortlistOrigin, setShortlistOrigin] = useState(emptyLiquidOrigin);
  const [error, setError] = useState("");
  const [locationValidity, setLocationValidity] = useState({ origin: true, destination: true });
  const coverageDialogRef = useRef<HTMLElement>(null);
  const coverageBackdropRef = useRef<HTMLDivElement>(null);
  const coverageMorphRef = useRef<HTMLSpanElement>(null);
  const coverageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const shortlistDialogRef = useRef<HTMLElement>(null);
  const shortlistBackdropRef = useRef<HTMLDivElement>(null);
  const shortlistMorphRef = useRef<HTMLSpanElement>(null);
  const shortlistTriggerRef = useRef<HTMLButtonElement | null>(null);
  const priceSortMenuRef = useRef<HTMLDivElement>(null);

  useLiquidOverlayMotion({
    open: showCoverage,
    origin: coverageOrigin,
    backdropRef: coverageBackdropRef,
    panelRef: coverageDialogRef,
    morphRef: coverageMorphRef,
  });

  useLiquidOverlayMotion({
    open: showShortlist,
    origin: shortlistOrigin,
    backdropRef: shortlistBackdropRef,
    panelRef: shortlistDialogRef,
    morphRef: shortlistMorphRef,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBase()}/v1/meta/connectors`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("metadata unavailable")))
      .then((payload: { connectors?: ConnectorMeta[] }) => setConnectorMeta(payload.connectors ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!showPriceSortMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!priceSortMenuRef.current?.contains(event.target as Node)) {
        setShowPriceSortMenu(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowPriceSortMenu(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showPriceSortMenu]);

  useEffect(() => {
    if (activeView !== "results") return;

    let frame = 0;
    const handleScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const currentY = window.scrollY;
        if (currentY <= 24) setNavigationSplit(false);
        else if (currentY > 150) setNavigationSplit(true);
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [activeView]);

  useEffect(() => {
    if (!showCoverage) return;
    const dialog = coverageDialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      coverageTriggerRef.current?.focus();
    };
  }, [showCoverage]);

  function openCoverage(trigger: HTMLButtonElement) {
    coverageTriggerRef.current = trigger;
    setCoverageOrigin(liquidOriginFromElement(trigger));
    setShowShortlist(false);
    setShowCoverage(true);
  }

  useEffect(() => {
    if (!showShortlist) return;
    const dialog = shortlistDialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const selector = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    focusable[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowShortlist(false);
        return;
      }
      if (event.key !== "Tab" || !focusable.length) return;
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
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      shortlistTriggerRef.current?.focus();
    };
  }, [showShortlist]);

  function updateShortlist(next: Offer[]) {
    setShortlist(next);
    localStorage.setItem(shortlistStorageKey, JSON.stringify(next));
  }

  function toggleShortlist(offer: Offer) {
    const exists = shortlist.some((candidate) => candidate.id === offer.id);
    updateShortlist(exists
      ? shortlist.filter((candidate) => candidate.id !== offer.id)
      : [...shortlist, offer]);
  }

  function openShortlist(trigger: HTMLButtonElement) {
    shortlistTriggerRef.current = trigger;
    setShortlistOrigin(liquidOriginFromElement(trigger));
    setShowCoverage(false);
    setShowShortlist(true);
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
      isOfferVisible(offer) &&
      (airlineFilter === "all" || offer.segments.some((segment) => segment.marketingCarrier === airlineFilter)) &&
      (aircraftFilter === "all" || offer.segments.some((segment) => segment.aircraftCode === aircraftFilter)) &&
      (departureAirportFilter === "all" || offer.legs[0]?.origin.code === departureAirportFilter) &&
      (arrivalAirportFilter === "all" || offer.legs[0]?.destination.code === arrivalAirportFilter) &&
      (stopsFilter === "all" ||
        (stopsFilter === "direct" ? offerStops(offer) === 0 : offerStops(offer) <= offer.legs.length)),
    );
    if (effectiveSort === "price") {
      return offers.sort((left, right) => {
        const direction = priceDirection === "asc" ? 1 : -1;
        return direction * (priceSortValue(left) - priceSortValue(right)) ||
          compareEqualDisplayedPrice(left, right);
      });
    }
    if (effectiveSort === "duration") {
      return offers.sort(
        (left, right) =>
          offerJourneyMinutes(left) - offerJourneyMinutes(right) ||
          priceSortValue(left) - priceSortValue(right),
      );
    }
    if (effectiveSort === "stops") {
      return offers.sort(
        (left, right) =>
          offerStops(left) - offerStops(right) ||
          offerJourneyMinutes(left) - offerJourneyMinutes(right) ||
          priceSortValue(left) - priceSortValue(right),
      );
    }
    if (effectiveSort === "baggage") {
      return offers.sort(
        (left, right) =>
          offerCheckedBaggageKg(right) - offerCheckedBaggageKg(left) ||
          priceSortValue(left) - priceSortValue(right),
      );
    }
    if (effectiveSort === "flexibility") {
      return offers.sort(
        (left, right) =>
          offerFlexibility(right) - offerFlexibility(left) ||
          priceSortValue(left) - priceSortValue(right),
      );
    }
    return offers.sort((left, right) => {
      if (left.id === result.recommendedOfferId) return -1;
      if (right.id === result.recommendedOfferId) return 1;
      return priceSortValue(left) - priceSortValue(right);
    });
  }, [aircraftFilter, airlineFilter, arrivalAirportFilter, departureAirportFilter, effectiveSort, priceDirection, result, stopsFilter]);

  const airlines = useMemo(() => {
    if (!result) return [];
    return [...new Set(result.offers.flatMap((offer) =>
      offer.segments.map((segment) => segment.marketingCarrier),
    ))].sort();
  }, [result]);

  const aircraftTypes = useMemo(() => {
    if (!result) return [];
    return [...new Set(result.offers.flatMap((offer) => offer.segments.map((segment) => segment.aircraftCode).filter(Boolean) as string[]))].sort();
  }, [result]);

  const departureAirports = useMemo(() => {
    if (!result) return [];
    return [...new Set(result.offers.map((offer) => offer.legs[0]?.origin.code).filter(Boolean) as string[])].sort();
  }, [result]);

  const arrivalAirports = useMemo(() => {
    if (!result) return [];
    return [...new Set(result.offers.map((offer) => offer.legs[0]?.destination.code).filter(Boolean) as string[])].sort();
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
    setAircraftFilter("all");
    setDepartureAirportFilter("all");
    setArrivalAirportFilter("all");
    setStopsFilter("all");
    setError("");
    setActiveView("search");
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
    if (!locationValidity.origin || !locationValidity.destination) {
      setError("请从候选列表中选择有效的出发地和目的地。");
      return;
    }
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
    const searchStartedAt = performance.now();
    setBusy("searching");
    setSearchProgress({ percent: 8, label: "正在规划适用来源" });
    setError("");
    setResult(null);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      setSearchProgress({ percent: 24, label: "正在读取本机来源" });
      const companion = await searchWithEdgeCompanion(searchIntent);
      setSearchProgress({ percent: 56, label: "本机来源已返回" });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      setSearchProgress({ percent: 68, label: "正在核验云端来源" });
      const response = await apiRequest<SearchResponse>(
        "/v1/searches",
        companion ? { intent: searchIntent, companion } : searchIntent,
      );
      setSearchProgress({ percent: 94, label: "正在整理可比报价" });
      setResult(response);
      setSelectedOffer(null);
      setSearchProgress({ percent: 100, label: "检索完成" });
      const remainingDisplayTime = Math.max(0, 520 - (performance.now() - searchStartedAt));
      if (remainingDisplayTime > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingDisplayTime));
      }
      setActiveView("results");
      setNavigationSplit(false);
      window.scrollTo({ top: 0 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "搜索失败，请稍后重试。");
    } finally {
      setBusy("idle");
    }
  }

  async function saveOffer(offer: Offer) {
    const response = await accountFetch("/v3/me/itineraries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `${offer.segments[0]?.marketingCarrier ?? "航班"} ${offer.segments[0]?.flightNumber ?? "方案"} · ${offer.seller.name}`,
        offer,
      }),
    });
    if (!response.ok) {
      setError(response.status === 401 ? "登录后可跨设备收藏方案。" : "收藏失败，请稍后重试。");
      return;
    }
    window.dispatchEvent(new Event("flight-lens-personal-data"));
    setError("方案已收藏到账号。");
  }

  const lowest = result?.offers.find((offer) => offer.id === result.lowestComparableOfferId) ?? null;
  const lowestSplit = result?.offers.find((offer) => offer.id === result.lowestSplitOfferId) ?? null;
  const recommended = result?.offers.find((offer) => offer.id === result.recommendedOfferId) ?? null;
  const excludedOfferCount =
    result?.offers.filter((offer) => !isOfferVisible(offer)).length ?? 0;
  const usesSkyscanner = result?.offers.some(
    (offer) => ["skyscanner-live-prices", "flightapi-skyscanner"].includes(offer.connectorId),
  ) ?? false;
  const sourceStatus = result
    ? resultSourceStatus(result.offers, result.connectorReports)
    : null;
  const progressSources = plannedProgressSources(intent, connectorMeta);
  const activeNavigation = activeView === "search" ? "search" : "results";
  const navigationIsSplit = activeView === "results" && navigationSplit;

  useEffect(() => {
    const timer = window.setTimeout(
      () => setNavigationMaterialUnited(!navigationIsSplit),
      navigationIsSplit ? 0 : 520,
    );
    return () => window.clearTimeout(timer);
  }, [navigationIsSplit]);

  function openQuoteDetail(offer: Offer) {
    setSelectedOffer(offer);
    setActiveView("detail");
    window.scrollTo({ top: 0 });
  }

  return (
    <main className={navigationIsSplit ? "navigation-split" : undefined}>
      <div
        className={`adaptive-navigation ${navigationIsSplit ? "is-split" : "is-united"} ${navigationMaterialUnited && !navigationIsSplit ? "material-united" : ""}`}
        data-split={navigationIsSplit}
      >
        <LiquidGlassSurface
          label="navigation-united"
          className="united-nav-root"
          panelClassName="united-nav-panel"
          sceneClassName="topbar-scene"
          config={navGlassConfig}
          changeKey={`${activeView}-${Boolean(result)}`}
        >
          <span aria-hidden="true" />
        </LiquidGlassSurface>
        <LiquidGlassSurface
          label="navigation-brand"
          className="brand-nav-root"
          panelClassName="brand-nav-panel"
          sceneClassName="topbar-scene"
          config={navGlassConfig}
          changeKey={`${activeView}-${navigationIsSplit}`}
        >
          <button className="brand" onClick={() => { setNavigationSplit(false); setActiveView("search"); }} aria-label="航探首页">
            <span className="brand-mark"><Image src="/flight-lens-logo.svg" alt="" width={30} height={30} priority /></span>
            <span>航探 <small>Flight Lens</small></span>
          </button>
        </LiquidGlassSurface>
        <LiquidGlassSurface
          label="navigation-controls"
          className="controls-nav-root"
          panelClassName="controls-nav-panel"
          sceneClassName="topbar-scene"
          config={navGlassConfig}
          changeKey={`${activeView}-${Boolean(result)}-${navigationIsSplit}`}
        >
          <header className="topbar-controls">
            <nav aria-label="主导航">
              <div className="nav-switcher" data-active={activeNavigation}>
                <span className="nav-selection" aria-hidden="true" />
                <button className={activeNavigation === "search" ? "active" : ""} onClick={() => { setNavigationSplit(false); setActiveView("search"); }}><Search size={14} />搜索</button>
                <button className={activeNavigation === "results" ? "active" : ""} onClick={() => { if (result) { setNavigationSplit(false); setActiveView("results"); } }} disabled={!result}><SlidersHorizontal size={14} />结果</button>
              </div>
              <button className="source-nav-button" onClick={(event) => openCoverage(event.currentTarget)}><Radar size={14} />来源</button>
            </nav>
            <AccountPanel />
          </header>
        </LiquidGlassSurface>
      </div>

      {activeView === "search" && <section className="hero" id="top">
        <div className="eyebrow"><Plane size={14} /> 行程工作台</div>
        <h1>今天要飞去哪里？</h1>
        <p className="hero-copy">
          说出完整需求，或逐项设置航线、日期与偏好。检索前你始终可以检查每一项条件。
        </p>

        <div className="search-shell" id="search">
          <div className="mode-tabs" data-mode={mode} role="tablist" aria-label="搜索方式">
            <span className="mode-selection" aria-hidden="true" />
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
                    <AirportRoute origin={intent.origin} destination={intent.destination} className="intent-airport-route" />
                    {" · "}
                    {intent.departureDate}
                    {intent.returnDate ? ` 至 ${intent.returnDate}` : ""}
                    {" · "}
                    {intent.adults} 位成人 · {cabinLabels[intent.cabin]}
                  </span>
                  {parseResult.parser.kind !== "local_deterministic_zh" && (
                    <small>AI 结构化解析 · {parseResult.parser.model}</small>
                  )}
                  <button type="button" onClick={() => setMode("form")}>打开完整表单修改</button>
                </div>
              )}
            </div>
          ) : (
            <div className="form-panel" id="search-panel-form" role="tabpanel" aria-labelledby="search-tab-form">
              <section className="filter-section route-filter-section" aria-labelledby="route-filter-title">
                <div className="filter-section-heading">
                  <h2 id="route-filter-title"><Plane size={16} />航线</h2>
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
                </div>
                <div className="route-grid">
                  <LocationCombobox
                    key={`origin-${intent.origin.kind}-${intent.origin.code}`}
                    label="出发地"
                    value={intent.origin}
                    onValidityChange={(valid) => setLocationValidity((current) => ({ ...current, origin: valid }))}
                    onChange={(location) => updateIntent({ origin: { kind: location.kind, code: location.code, name: location.kind === "city" ? location.cityNameZh : location.airportNameZh } })}
                  />
                  <button
                    className="swap"
                    aria-label="交换出发地和目的地"
                    onClick={() => updateIntent({ origin: intent.destination, destination: intent.origin })}
                  >
                    ⇄
                  </button>
                  <LocationCombobox
                    key={`destination-${intent.destination.kind}-${intent.destination.code}`}
                    label="目的地"
                    value={intent.destination}
                    onValidityChange={(valid) => setLocationValidity((current) => ({ ...current, destination: valid }))}
                    onChange={(location) => updateIntent({ destination: { kind: location.kind, code: location.code, name: location.kind === "city" ? location.cityNameZh : location.airportNameZh } })}
                  />
                </div>
              </section>

              <section className="filter-section" aria-labelledby="schedule-filter-title">
                <div className="filter-section-heading"><h2 id="schedule-filter-title"><CalendarDays size={16} />日期与乘客</h2></div>
                <div className="schedule-grid">
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
                </div>
              </section>

              <section className="filter-section" aria-labelledby="preference-filter-title">
                <div className="filter-section-heading"><h2 id="preference-filter-title"><SlidersHorizontal size={16} />价格与行程偏好</h2></div>
                <div className="preference-fields">
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
                  <label>最早起飞<input type="time" value={intent.departureTime?.earliest ?? ""} onChange={(event) => updateDepartureTime("earliest", event.target.value)} /></label>
                  <label>最晚起飞<input type="time" value={intent.departureTime?.latest ?? ""} onChange={(event) => updateDepartureTime("latest", event.target.value)} /></label>
                  <label>最多中转
                    <select value={intent.directOnly ? 0 : intent.maxStops} disabled={intent.directOnly} onChange={(event) => updateIntent({ maxStops: Number(event.target.value) })}>
                      <option value={0}>直飞</option>
                      <option value={1}>最多 1 次</option>
                      <option value={2}>最多 2 次</option>
                    </select>
                  </label>
                </div>
                <div className="preference-grid">
                  <label className="preference-toggle"><span>仅直飞</span><input type="checkbox" checked={intent.directOnly} onChange={(event) => updateIntent({ directOnly: event.target.checked, maxStops: event.target.checked ? 0 : 1 })} /></label>
                  <label className="preference-select"><span>托运行李</span>
                    <select aria-label="最低托运行李额度" value={intent.minimumCheckedBaggageKg} onChange={(event) => updateIntent({ minimumCheckedBaggageKg: Number(event.target.value) })}>
                      {[0, 10, 20, 23, 30, 46].map((kg) => <option key={kg} value={kg}>{kg === 0 ? "不限" : `至少 ${kg}kg`}</option>)}
                    </select>
                  </label>
                  <label className="preference-toggle"><span>拒绝红眼</span><input type="checkbox" checked={intent.avoidRedEye} onChange={(event) => updateIntent({ avoidRedEye: event.target.checked, redEyeWindow: intent.redEyeWindow ?? { start: "00:00", end: "06:00" } })} /></label>
                  <label className="preference-toggle"><span>出发地附近机场</span><input type="checkbox" checked={intent.includeNearbyAirports} onChange={(event) => updateIntent({ includeNearbyAirports: event.target.checked })} /></label>
                  {intent.avoidRedEye && (
                    <div className="red-eye-window">
                      <span>红眼时段</span>
                      <div className="time-range">
                        <input aria-label="红眼开始时间" type="time" value={intent.redEyeWindow?.start ?? "00:00"} onChange={(event) => updateIntent({ redEyeWindow: { start: event.target.value, end: intent.redEyeWindow?.end ?? "06:00" } })} />
                        <span>至</span>
                        <input aria-label="红眼结束时间" type="time" value={intent.redEyeWindow?.end ?? "06:00"} onChange={(event) => updateIntent({ redEyeWindow: { start: intent.redEyeWindow?.start ?? "00:00", end: event.target.value } })} />
                      </div>
                    </div>
                  )}
                </div>
              </section>
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
            <LiquidGlassSurface
              label="search-primary-action"
              className="search-action-root"
              panelClassName="search-action-panel"
              sceneClassName="action-scene"
              config={actionGlassConfig}
              changeKey={`${busy}-${mode}-${Boolean(parseResult?.ready)}`}
            >
              <button className="primary-button" onClick={runSearch} disabled={busy !== "idle"}>
                {busy === "parsing" && <><span className="spinner" /> 正在解析条件</>}
                {busy === "searching" && <><span className="spinner" /> 正在核验来源</>}
                {busy === "idle" && mode === "agent" && parseResult?.ready
                  ? <>确认并检索 <ArrowRight size={16} /></>
                  : busy === "idle" && <><Search size={16} />开始检索</>}
              </button>
            </LiquidGlassSurface>
          </div>
          {busy === "searching" && (
            <div className="search-progress" role="status" aria-live="polite">
              <div className="search-progress-heading">
                <span><small>检索进度</small><strong>{searchProgress.label}</strong></span>
                <output aria-label={`检索进度 ${searchProgress.percent}%`}>{searchProgress.percent}%</output>
              </div>
              <div className="search-progress-track" role="progressbar" aria-label="航班来源检索进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={searchProgress.percent}>
                <i style={{ "--search-progress": searchProgress.percent / 100 } as CSSProperties} />
              </div>
              <div className="search-progress-note">本机来源与云端 API 分阶段核验，百分比表示当前工作流进度。</div>
              <div className="searching-sources">
                {progressSources.map((source) => (
                  <span key={source.id}>
                    <i aria-hidden="true" />
                    <b>{source.name}</b>
                    <small>{source.access}</small>
                    <em>检索中</em>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="trust-row" aria-label="检索承诺">
          <span><ShieldCheck size={15} />可核验来源</span>
          <span><Check size={15} />统一全价口径</span>
          <span><Info size={15} />逐项披露失败</span>
        </div>
      </section>}

      {activeView === "results" && (result || (error && busy === "idle")) && (
        <section className="results-section revealed" id="results" aria-live="polite">
          <div className="section-heading">
            <div>
              <div className="eyebrow"><span /> 航班检索结果</div>
              <h2><AirportRoute origin={result?.intent.origin ?? intent.origin} destination={result?.intent.destination ?? intent.destination} /></h2>
              <p>{result?.intent.departureDate ?? intent.departureDate} · {result?.intent.adults ?? intent.adults} 位成人 · {cabinLabels[result?.intent.cabin ?? intent.cabin]} · 统一 Offer 口径</p>
            </div>
            {result && (
              <>
                <div className={`demo-badge ${sourceStatus?.productionStyle ? "production-badge" : ""}`}>
                  {sourceStatus?.label}
                </div>
                <div className="result-status-stack">
                  <LiquidGlassSurface
                    label="result-price-status"
                    className="result-status-root"
                    panelClassName="result-status-glass"
                    sceneClassName="status-glass-scene"
                    config={statusGlassConfig}
                    changeKey={`${result.requestId}-${result.priceJudgment.level}`}
                  >
                    <PriceTools
                      apiBase={apiBase()}
                      intent={result.intent}
                      marketPriceInsights={result.marketPriceInsights}
                      priceJudgment={result.priceJudgment}
                    />
                  </LiquidGlassSurface>
                  <LiquidGlassSurface
                    label="result-coverage-status"
                    className="result-status-root"
                    panelClassName="result-status-glass"
                    sceneClassName="status-glass-scene"
                    config={statusGlassConfig}
                    changeKey={`${result.requestId}-${result.disclosure.successfulSources}`}
                  >
                    <button
                      className="result-status-button"
                      onClick={(event) => openCoverage(event.currentTarget)}
                      aria-label={`本次搜索覆盖：${result.disclosure.successfulSources}/${result.disclosure.plannedSources}，查看详情`}
                    >
                      <Radar size={17} />
                      <span><small>搜索覆盖</small><strong>{result.disclosure.successfulSources}/{result.disclosure.plannedSources}</strong></span>
                    </button>
                  </LiquidGlassSurface>
                </div>
              </>
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
                <LiquidGlassSurface
                  label="result-summary"
                  className="result-summary-root"
                  panelClassName="price-insight"
                  sceneClassName="result-summary-scene"
                  config={summaryGlassConfig}
                  changeKey={result.requestId}
                >
                  <div>
                    <span>综合推荐</span>
                    <strong>{recommended ? money(recommended) : "暂无"}</strong>
                    <small>{recommended ? `来自 ${recommended.seller.name}` : "没有满足完整全价口径的推荐"}</small>
                  </div>
                  <div>
                    <span>最低可核验全价</span>
                    <strong>{lowest ? money(lowest) : "暂无"}</strong>
                    <small>{lowest ? `来自 ${lowest.seller.name}` : "成功来源中没有完整可比价格"}</small>
                  </div>
                  <div>
                    <span>最低分开购买价</span>
                    <strong>{lowestSplit ? money(lowestSplit) : "暂无"}</strong>
                    <small>{lowestSplit ? "两张单程票，库存与规则分别变化" : "本次没有分开购买方案"}</small>
                  </div>
                  <div className="summary-result-count">
                    共 {groupedOffers.length} 个航班 · {orderedOffers.length} 个平台报价
                    {excludedOfferCount > 0
                      ? ` · ${excludedOfferCount} 个不符合条件的报价已隐藏`
                      : ""}
                  </div>
                </LiquidGlassSurface>

                <div className="result-toolbar">
                  <LiquidGlassSurface
                    label="result-toolbar"
                    className="result-toolbar-glass-root"
                    panelClassName="result-toolbar-glass-panel"
                    sceneClassName="result-toolbar-glass-scene"
                    config={toolbarGlassConfig}
                    changeKey={`${result.requestId}-${effectiveSort}`}
                  >
                    <span aria-hidden="true" />
                  </LiquidGlassSurface>
                  <div className="sort-tabs">
                    {([
                      ["recommended", "综合推荐"],
                      ["price", "价格"],
                      ["duration", "最短耗时"],
                      ["stops", "最少中转"],
                      ...(result.bestBaggageOfferId ? [["baggage", "最佳行李"]] as const : []),
                      ...(result.mostFlexibleOfferId ? [["flexibility", "最宽松退改"]] as const : []),
                    ] as ReadonlyArray<readonly [SortKey, string]>).map(([key, label]) => key === "price" ? (
                      <div className="price-sort-control" ref={priceSortMenuRef} key={key}>
                        <button
                          type="button"
                          className={`price-sort-trigger ${effectiveSort === key ? "selected" : ""}`}
                          onClick={() => setShowPriceSortMenu((open) => !open)}
                          aria-haspopup="menu"
                          aria-expanded={showPriceSortMenu}
                          aria-label={`价格排序，当前${priceDirection === "asc" ? "低到高" : "高到低"}`}
                        >
                          {label}
                          <ChevronDown size={13} aria-hidden="true" />
                        </button>
                        {showPriceSortMenu && (
                          <div className="price-sort-menu" role="menu" aria-label="价格排序">
                            {([[
                              "asc",
                              "低到高",
                            ], [
                              "desc",
                              "高到低",
                            ]] as const).map(([direction, directionLabel]) => (
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={priceDirection === direction}
                                className="price-sort-option"
                                key={direction}
                                onClick={() => {
                                  setPriceDirection(direction);
                                  setSort("price");
                                  setShowPriceSortMenu(false);
                                }}
                              >
                                {directionLabel}
                                <Check
                                  size={13}
                                  aria-hidden="true"
                                  className={priceDirection === direction ? "" : "sort-check-placeholder"}
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <button
                        key={key}
                        className={effectiveSort === key ? "selected" : ""}
                        onClick={() => {
                          setShowPriceSortMenu(false);
                          setSort(key);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="result-filters">
                    <label>航司
                      <select value={airlineFilter} onChange={(event) => setAirlineFilter(event.target.value)}>
                        <option value="all">全部</option>
                        {airlines.map((airline) => <option key={airline} value={airline}>{airline}</option>)}
                      </select>
                    </label>
                    <label>机型
                      <select value={aircraftFilter} onChange={(event) => setAircraftFilter(event.target.value)}>
                        <option value="all">全部</option>
                        {aircraftTypes.map((aircraft) => <option key={aircraft} value={aircraft}>{aircraft}</option>)}
                      </select>
                    </label>
                    <label>起飞机场
                      <select value={departureAirportFilter} onChange={(event) => setDepartureAirportFilter(event.target.value)}>
                        <option value="all">全部</option>
                        {departureAirports.map((airport) => <option key={airport} value={airport}>{airportPresentation({ code: airport }).name} · {airport}</option>)}
                      </select>
                    </label>
                    <label>降落机场
                      <select value={arrivalAirportFilter} onChange={(event) => setArrivalAirportFilter(event.target.value)}>
                        <option value="all">全部</option>
                        {arrivalAirports.map((airport) => <option key={airport} value={airport}>{airportPresentation({ code: airport }).name} · {airport}</option>)}
                      </select>
                    </label>
                    <label>中转
                      <select value={stopsFilter} onChange={(event) => setStopsFilter(event.target.value as StopsFilter)}>
                        <option value="all">全部</option>
                        <option value="direct">仅直飞</option>
                        <option value="one_or_less">最多一次</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="filter-reset"
                      onClick={() => {
                        setAirlineFilter("all");
                        setAircraftFilter("all");
                        setDepartureAirportFilter("all");
                        setArrivalAirportFilter("all");
                        setStopsFilter("all");
                      }}
                    >重置筛选</button>
                  </div>
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
                      const isShortlisted = shortlist.some((candidate) => candidate.id === offer.id);
                      const groupIds = new Set(group.offers.map((candidate) => candidate.id));
                      const isLowest = result.lowestComparableOfferId ? groupIds.has(result.lowestComparableOfferId) : false;
                      const isRecommended = result.recommendedOfferId ? groupIds.has(result.recommendedOfferId) : false;
                      const distinctions = [
                        ...(isLowest ? ["最低可核验全价"] : []),
                        ...(isRecommended ? ["综合推荐"] : []),
                        ...(result.lowestSplitOfferId && groupIds.has(result.lowestSplitOfferId) ? ["最低分开购买价"] : []),
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
                                : offer.purchaseMode === "split_ticket"
                                  ? "分开购买方案 · 不参与单票最低价"
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
                                      <AirportLabel airport={leg.origin} className="compact-airport" />
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
                                      <AirportLabel airport={leg.destination} className="compact-airport" />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="price"><small>{offer.purchaseMode === "split_ticket" ? "分开购买合计" : offerPriceLabel(offer)}</small><strong>{money(offer)}</strong><span className="plain-price">{offer.purchaseMode === "split_ticket" ? "两张单程票，非平台往返价" : offer.priceVerificationStatus === "listed_only" ? "税费、机建燃油待核验" : offer.seller.handoffPrecision === "search_results" ? "需在来源页重新选择" : "购买前再次核验"}</span></div>
                          </div>
                          <div className="flight-meta">
                            <div className="flight-meta-facts">
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
                            </div>
                            <div className="flight-meta-actions">
                              {offer.seller.deepLink && offer.purchaseMode !== "split_ticket" && (
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
                              {offer.purchaseMode === "split_ticket" && offer.purchaseParts?.map((part) => (
                                <a key={part.legIndex} className="handoff-link" href={part.bookingUrl} target="_blank" rel="noopener noreferrer">
                                  {part.label} {new Intl.NumberFormat("zh-CN", { style: "currency", currency: part.price.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(part.price.amountMinor / 100)} ↗
                                </a>
                              ))}
                              <button onClick={() => openQuoteDetail(offer)}>
                                查看报价详情 <ArrowRight size={13} />
                              </button>
                              <button
                                className={`shortlist-card-action ${isShortlisted ? "selected" : ""}`}
                                onClick={() => toggleShortlist(offer)}
                                aria-pressed={isShortlisted}
                              >
                                <Heart size={13} fill={isShortlisted ? "currentColor" : "none"} />
                                {isShortlisted ? "已加入心选" : "加入心选"}
                              </button>
                              <button onClick={() => saveOffer(offer)}><Star size={13} />收藏机票</button>
                            </div>
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
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          )}
        </section>
      )}

      {activeView === "detail" && selectedOffer && result && (
        <section className="quote-detail" aria-labelledby="quote-detail-title">
          <div className="quote-detail-header">
            <button className="back-button" onClick={() => setActiveView("results")}><ArrowLeft size={17} />返回结果</button>
            <div>
              <div className="eyebrow"><ShieldCheck size={14} /> 报价详情</div>
              <h1 id="quote-detail-title"><AirportRoute origin={selectedOffer.legs[0]?.origin} destination={selectedOffer.legs[0]?.destination} /></h1>
              <p>{selectedOffer.seller.name} · {offerPriceLabel(selectedOffer)} · 核验于 {new Date(selectedOffer.fetchedAt).toLocaleString("zh-CN")}</p>
            </div>
            <div className="quote-total"><span>{offerPriceLabel(selectedOffer)}</span><strong>{money(selectedOffer)}</strong><small>{selectedOffer.purchaseMode === "split_ticket" ? "两张单程票合计" : selectedOffer.priceVerificationStatus === "listed_only" ? "税费、机建燃油待核验" : "购买前再次核验"}</small></div>
          </div>

          <div className="quote-detail-grid">
            <div className="quote-main">
              <section className="detail-band dark-band">
                <div className="detail-band-title"><Plane size={18} /><h2>完整行程</h2></div>
                {selectedOffer.legs.map((leg, legIndex) => (
                  <div className="detail-leg" key={leg.id}>
                    <span>{selectedOffer.legs.length === 1 ? "单程" : legIndex === 0 ? "去程" : "返程"}</span>
                    <strong><span>{time(leg.departureAt)}</span><AirportLabel airport={leg.origin} className="detail-airport" /></strong>
                    <i />
                    <em>{duration(leg.durationMinutes)} · {leg.stopCount ? `${leg.stopCount} 次中转` : "直飞"}</em>
                    <strong><span>{time(leg.arrivalAt)}{dayOffset(leg.departureAt, leg.arrivalAt) && <sup>{dayOffset(leg.departureAt, leg.arrivalAt)}</sup>}</span><AirportLabel airport={leg.destination} className="detail-airport" /></strong>
                  </div>
                ))}
                <div className="segment-list">
                  {selectedOffer.segments.map((segment) => (
                    <div key={segment.id}>
                      <b>{segment.marketingCarrier} {segment.flightNumber}</b>
                      <span className="segment-airports">
                        <AirportLabel airport={segment.origin} className="inline-airport" />
                        <time>{time(segment.departureAt)}</time>
                        <ArrowRight size={13} aria-hidden="true" />
                        <AirportLabel airport={segment.destination} className="inline-airport" />
                        <time>{time(segment.arrivalAt)}</time>
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="detail-band">
                <div className="detail-band-title"><Luggage size={18} /><h2>行李与退改</h2></div>
                <div className="rule-grid">
                  <div><span>托运行李</span><b>{offerCheckedBaggageKg(selectedOffer) ? `含 ${offerCheckedBaggageKg(selectedOffer)}kg` : "待来源补全"}</b></div>
                  <div><span>退票</span><b>{selectedOffer.refundable === true ? "可退" : selectedOffer.refundable === false ? "不可退" : "待核验"}</b></div>
                  <div><span>改签</span><b>{selectedOffer.changeable === true ? "可改" : selectedOffer.changeable === false ? "不可改" : "待核验"}</b></div>
                  <div><span>票价品牌</span><b>{selectedOffer.fareBrand ?? cabinLabels[result.intent.cabin]}</b></div>
                </div>
                {selectedOffer.baggage.length > 0 && <div className="baggage-list">{selectedOffer.baggage.map((item, index) => <span key={`${item.type}-${index}`}>{item.type === "checked" ? "托运" : "随身"} · {item.included ? "已包含" : "需另购"}{item.weightKg ? ` · ${item.weightKg}kg` : ""}</span>)}</div>}
              </section>

              <section className="detail-band parchment-band">
                <div className="detail-band-title"><Info size={18} /><h2>证据与边界</h2></div>
                {selectedOffer.seller.handoffPrecision === "search_results" && <p className="handoff-warning">此链接返回带本次条件的 {handoffSourceName(selectedOffer)} 结果页，不是该售卖方的精确报价落点；请重新选择相同行程并核验最终价格。</p>}
                {selectedOffer.priceVerificationStatus === "listed_only" && <p className="handoff-warning">当前金额仅是来源展示价，不代表含税最终支付价；税费、机建燃油和附加服务尚未完整核验。</p>}
                {selectedOffer.purchaseMode === "split_ticket" && <p className="handoff-warning">该方案需要分别购买去程和返程。两单库存、行李与退改规则独立变化，任一单失败不会自动保护另一单。</p>}
                <p>请在来源平台再次核验库存和最终支付页。航探不售票、不代收款。</p>
              </section>
            </div>

            <aside className="quote-evidence">
              <span>价格构成</span>
              <h2>{money(selectedOffer)}</h2>
              <div className="component-list">
                {selectedOffer.priceComponents.map((component) => <div key={`${component.kind}-${component.label}`}><span>{component.label}</span><b>{new Intl.NumberFormat("zh-CN", { style: "currency", currency: component.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(component.amountMinor / 100)}</b></div>)}
              </div>
              {selectedOffer.exchangeRate && <p>1 {selectedOffer.exchangeRate.baseCurrency} = {selectedOffer.exchangeRate.rate} {selectedOffer.exchangeRate.quoteCurrency}<small>{selectedOffer.exchangeRate.source} · {new Date(selectedOffer.exchangeRate.quotedAt).toLocaleString("zh-CN")}</small></p>}
              <div className="evidence-source"><ShieldCheck size={16} /><div><b>{selectedOffer.seller.name}</b><small>{offerPriceLabel(selectedOffer)}</small></div></div>
              {selectedOffer.seller.deepLink && selectedOffer.purchaseMode !== "split_ticket" && <a className="primary-button" href={selectedOffer.seller.deepLink} target="_blank" rel="noopener noreferrer">去 {handoffSourceName(selectedOffer)} 核验 <ExternalLink size={15} /></a>}
              <button className="secondary-button" onClick={() => saveOffer(selectedOffer)}><Star size={15} />收藏机票</button>
            </aside>
          </div>
        </section>
      )}

      <footer>
        <div className="brand"><span className="brand-mark"><Image src="/flight-lens-logo.svg" alt="" width={30} height={30} /></span><span>航探 <small>Flight Lens</small></span></div>
        <p>只负责搜索与解释，不售票、不代收款。最终价格与规则以来源平台支付页为准。</p>
        <button onClick={(event) => openCoverage(event.currentTarget)}>来源与边界</button>
      </footer>

      {result && activeView !== "search" && (
        <LiquidGlassSurface
          label="shortlist"
          className="shortlist-fab-root"
          panelClassName="shortlist-fab-panel"
          sceneClassName="status-glass-scene"
          config={statusGlassConfig}
          changeKey={shortlist.length}
        >
          <button
            ref={shortlistTriggerRef}
            className="shortlist-fab"
            onClick={(event) => openShortlist(event.currentTarget)}
            aria-label={`打开心选，当前 ${shortlist.length} 个方案`}
          >
            <ShoppingBasket size={18} />
            <span>心选</span>
            <strong aria-label={`${shortlist.length} 个方案`}>{shortlist.length}</strong>
          </button>
        </LiquidGlassSurface>
      )}

      {showShortlist && typeof document !== "undefined" && createPortal(
        <div
          ref={shortlistBackdropRef}
          className="modal-backdrop liquid-overlay-backdrop"
          role="presentation"
          onMouseDown={() => setShowShortlist(false)}
        >
          <span ref={shortlistMorphRef} className="liquid-morph" aria-hidden="true" />
          <section
            ref={shortlistDialogRef}
            className="modal shortlist-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortlist-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <LiquidGlassSurface
              label="shortlist-workspace"
              className="workspace-glass-fill"
              panelClassName="workspace-glass-panel"
              config={{ ...summaryGlassConfig, borderRadius: 20, backgroundOpacity: 0.1, blur: 9 }}
              changeKey={shortlist.length}
            >
              <span aria-hidden="true" />
            </LiquidGlassSurface>
            <button className="modal-close" onClick={() => setShowShortlist(false)} aria-label="关闭心选"><X size={19} /></button>
            <div className="eyebrow"><ShoppingBasket size={14} /> 决策工作台</div>
            <h2 id="shortlist-title">心选方案</h2>
            <p>把价格、时间、机场与行李放在一起比较，最后再决定去哪个来源核验。</p>
            {shortlist.length ? (
              <div className="shortlist-table">
                <div className="shortlist-table-heading" aria-hidden="true">
                  <span>行程</span><span>时间与规则</span><span>来源</span><span>价格</span><span>操作</span>
                </div>
                {shortlist.map((offer) => {
                  const firstLeg = offer.legs[0];
                  const lastLeg = offer.legs.at(-1);
                  const canInspect = result?.offers.some((candidate) => candidate.id === offer.id);
                  return (
                    <article className="shortlist-row" key={offer.id}>
                      <div className="shortlist-route">
                        <AirportRoute origin={firstLeg?.origin} destination={firstLeg?.destination} className="shortlist-airport-route" />
                        <span>{offer.segments[0]?.marketingCarrier} {offer.segments[0]?.flightNumber}</span>
                        {offer.legs.length > 1 && <AirportRoute origin={lastLeg?.origin} destination={lastLeg?.destination} className="shortlist-return-route" />}
                      </div>
                      <div className="shortlist-rules">
                        <b>{duration(offerJourneyMinutes(offer))}</b>
                        <span>{offerStops(offer) ? `${offerStops(offer)} 次中转` : "直飞"} · {offerCheckedBaggageKg(offer) ? `${offerCheckedBaggageKg(offer)}kg 行李` : "行李待核验"}</span>
                      </div>
                      <div className="shortlist-source"><b>{offer.seller.name}</b><span>{offerPriceLabel(offer)}</span></div>
                      <div className="shortlist-price"><strong>{money(offer)}</strong><span>{offer.purchaseMode === "split_ticket" ? "分开购买" : "单票"}</span></div>
                      <div className="shortlist-actions">
                        {canInspect && <button onClick={() => { setShowShortlist(false); openQuoteDetail(offer); }}>详情</button>}
                        {offer.seller.deepLink && <a href={offer.seller.deepLink} target="_blank" rel="noopener noreferrer">核验</a>}
                        <button className="shortlist-remove" onClick={() => toggleShortlist(offer)} aria-label={`从心选移除 ${offer.segments[0]?.marketingCarrier ?? "航班"} ${offer.segments[0]?.flightNumber ?? "方案"}`}><Trash2 size={15} /></button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="shortlist-empty"><Heart size={24} /><b>还没有心选方案</b><span>在结果卡片中点“加入心选”，适合比较的航班会留在这里。</span></div>
            )}
          </section>
        </div>,
        document.body,
      )}

      {showCoverage && (
        <div
          ref={coverageBackdropRef}
          className="modal-backdrop liquid-overlay-backdrop"
          role="presentation"
          onMouseDown={() => setShowCoverage(false)}
        >
          <span ref={coverageMorphRef} className="liquid-morph" aria-hidden="true" />
          <section
            ref={coverageDialogRef}
            className="modal coverage-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="coverage-title"
            aria-describedby="coverage-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <LiquidGlassSurface
              label="coverage-workspace"
              className="workspace-glass-fill"
              panelClassName="workspace-glass-panel"
              config={{ ...summaryGlassConfig, borderRadius: 20, backgroundOpacity: 0.1, blur: 9 }}
              changeKey={result?.disclosure.successfulSources ?? 0}
            >
              <span aria-hidden="true" />
            </LiquidGlassSurface>
            <button className="modal-close" onClick={() => setShowCoverage(false)} aria-label="关闭"><ArrowLeft size={19} /></button>
            <div className="eyebrow"><Radar size={14} /> 来源覆盖中心</div>
            <h2 id="coverage-title">来源数量不等于可信度</h2>
            <p id="coverage-description">来源只有在合法配置、实际响应、字段完整并通过价格校验后，才计入本次检索覆盖。超时和失败会单独披露。</p>
            {result && (
              <section className="current-coverage" aria-label="本次搜索覆盖详情">
                <div className="current-coverage-heading">
                  <div><span>当前搜索</span><AirportRoute origin={result.intent.origin} destination={result.intent.destination} className="coverage-airport-route" /></div>
                  <strong>{result.disclosure.successfulSources}/{result.disclosure.plannedSources}</strong>
                </div>
                <div className="coverage-progress"><i style={{ width: `${result.disclosure.plannedSources ? (result.disclosure.successfulSources / result.disclosure.plannedSources) * 100 : 0}%` }} /></div>
                <p>{result.disclosure.statement}</p>
                <ul className="coverage-modal-list">
                  {result.connectorReports.map((report) => (
                    <li key={report.connectorId}>
                      <span><b>{report.connectorName}</b><small>{report.durationMs}ms · {report.offerCount} 个 Offer</small>{report.notes.map((note) => <small key={note}>{reportNote(note)}</small>)}</span>
                      <strong className={`source-state state-${report.state}`}>{connectorStateLabel(report.state)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="source-table">
              <div><b>SerpApi</b><span>Google Flights 与实际售卖方报价；跳转精度单独披露</span><em>首个生产查询已验证</em></div>
              <div><b>FlightAPI / Skyscanner</b><span>航司 / OTA 当前价格与跳转；同属一个库存族</span><em>本地实验待复核授权</em></div>
              <div><b>PKFARE / Duffel</b><span>中国航信、GDS、航司直连等发现与交叉核验</span><em>等待生产权限</em></div>
              <div><b>Edge Companion</b><span>在用户自己的浏览器会话中打开携程、去哪儿、同程和飞猪并读取公开结果</span><em>本地运行 · 登录与验证由用户完成</em></div>
              <div><b>航司 / OTA</b><span>按开放平台与商务授权逐步接入</span><em>访问失败会逐项披露</em></div>
              <div><b>Mock 数据</b><span>只用于自动测试</span><em>生产强制禁用</em></div>
            </div>
            <LiquidGlassSurface
              label="coverage-primary-action"
              className="modal-primary-glass"
              panelClassName="modal-primary-glass-panel"
              config={actionGlassConfig}
            >
              <button className="modal-primary-button" onClick={() => setShowCoverage(false)}>我知道了</button>
            </LiquidGlassSurface>
          </section>
        </div>
      )}
    </main>
  );
}
