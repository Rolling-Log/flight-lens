import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Offer, SearchIntent } from "@flight-lens/contracts";
import { ConnectorError } from "./errors.js";
import type {
  ConnectorHealth,
  ConnectorMetadata,
  ConnectorSearchContext,
  ConnectorSearchResult,
  FlightConnector,
} from "./index.js";

type FlyAiConfig = {
  apiKey?: string;
  cliPath?: string;
};

type FlyAiSegment = {
  depStationCode?: unknown;
  depStationName?: unknown;
  depDateTime?: unknown;
  arrStationCode?: unknown;
  arrStationName?: unknown;
  arrDateTime?: unknown;
  duration?: unknown;
  marketingTransportName?: unknown;
  marketingTransportNo?: unknown;
  seatClassName?: unknown;
};

type FlyAiJourney = {
  journeyType?: unknown;
  segments?: unknown;
  totalDuration?: unknown;
};

type FlyAiItem = {
  adultPrice?: unknown;
  journeys?: unknown;
  jumpUrl?: unknown;
  totalDuration?: unknown;
};

type FlyAiPayload = {
  data?: { itemList?: unknown };
  message?: unknown;
  status?: unknown;
  systemMessage?: unknown;
};

function defaultCliPath(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve("@fly-ai/flyai-cli/package.json");
  return join(dirname(packageJson), "dist", "flyai-bundle.cjs");
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function minutes(value: unknown): number | undefined {
  const match = text(value)?.match(/(\d+(?:\.\d+)?)\s*(?:分钟|min)/i);
  if (!match) return undefined;
  const parsed = Math.round(Number(match[1]));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function cnyMinor(value: unknown): number | undefined {
  const normalized = text(value)?.replace(/[,，\s]/g, "");
  const match = normalized?.match(/(?:CNY|RMB|¥|￥)?(\d+(?:\.\d{1,2})?)/i);
  if (!match) return undefined;
  const parsed = Math.round(Number(match[1]) * 100);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function localDateTime(value: unknown): string | undefined {
  const normalized = text(value)?.replace(" ", "T");
  return normalized && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(normalized)
    ? normalized
    : undefined;
}

function safeHttpsUrl(value: unknown): string | undefined {
  const candidate = text(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function timeInsideWindow(value: string, intent: SearchIntent): boolean {
  const localTime = value.slice(11, 16);
  if (intent.departureTime?.earliest && localTime < intent.departureTime.earliest) return false;
  if (intent.departureTime?.latest && localTime > intent.departureTime.latest) return false;
  return true;
}

function mapFlyAiItem(
  raw: FlyAiItem,
  intent: SearchIntent,
  requestId: string,
  itemIndex: number,
): Offer | undefined {
  const perAdultMinor = cnyMinor(raw.adultPrice);
  const jumpUrl = safeHttpsUrl(raw.jumpUrl);
  if (!perAdultMinor || !jumpUrl) return undefined;

  const rawJourneys = stringArray(raw.journeys) as FlyAiJourney[];
  if (rawJourneys.length === 0) return undefined;

  const segments: Offer["segments"] = [];
  const legs: Offer["legs"] = [];
  let maximumStops = 0;

  for (const [legIndex, journey] of rawJourneys.entries()) {
    const rawSegments = stringArray(journey.segments) as FlyAiSegment[];
    if (rawSegments.length === 0) return undefined;
    const legSegmentIds: string[] = [];

    for (const [segmentIndex, rawSegment] of rawSegments.entries()) {
      const transportNo = text(rawSegment.marketingTransportNo)?.replace(/\s+/g, "").toUpperCase();
      const match = transportNo?.match(/^([A-Z0-9]{2})([A-Z]?\d{1,4})$/);
      const departureAt = localDateTime(rawSegment.depDateTime);
      const arrivalAt = localDateTime(rawSegment.arrDateTime);
      const durationMinutes = minutes(rawSegment.duration);
      const originCode = text(rawSegment.depStationCode)?.toUpperCase();
      const destinationCode = text(rawSegment.arrStationCode)?.toUpperCase();
      if (
        !match ||
        !departureAt ||
        !arrivalAt ||
        !durationMinutes ||
        !originCode ||
        !destinationCode
      ) {
        return undefined;
      }

      const segmentId = `flyai:${requestId}:${itemIndex}:${legIndex}:${segmentIndex}`;
      legSegmentIds.push(segmentId);
      segments.push({
        id: segmentId,
        legIndex,
        marketingCarrier: match[1]!,
        flightNumber: match[2]!,
        origin: {
          kind: "airport",
          code: originCode,
          ...(text(rawSegment.depStationName) ? { name: text(rawSegment.depStationName)! } : {}),
        },
        destination: {
          kind: "airport",
          code: destinationCode,
          ...(text(rawSegment.arrStationName) ? { name: text(rawSegment.arrStationName)! } : {}),
        },
        departureAt,
        arrivalAt,
        durationMinutes,
      });
    }

    const legSegments = segments.filter((segment) => segment.legIndex === legIndex);
    const first = legSegments[0];
    const last = legSegments.at(-1);
    if (!first || !last) return undefined;
    const airborneMinutes = legSegments.reduce((sum, segment) => sum + segment.durationMinutes, 0);
    const journeyMinutes = minutes(journey.totalDuration) ?? airborneMinutes;
    maximumStops = Math.max(maximumStops, rawSegments.length - 1);
    legs.push({
      id: `flyai:${requestId}:${itemIndex}:leg:${legIndex}`,
      segmentIds: legSegmentIds,
      origin: first.origin,
      destination: last.destination,
      departureAt: first.departureAt,
      arrivalAt: last.arrivalAt,
      durationMinutes: Math.max(journeyMinutes, airborneMinutes),
      stopCount: rawSegments.length - 1,
    });
  }

  const firstDeparture = legs[0]!.departureAt;
  const totalMinor = perAdultMinor * intent.adults;
  const conditionalPrice = /会员|新客|券|专享/.test(JSON.stringify(raw));
  const reasons = [
    ...(conditionalPrice ? ["CONDITIONAL_PRICE"] : []),
    ...(intent.directOnly && maximumStops > 0 ? ["MAX_STOPS_CONFLICT"] : []),
    ...(!intent.directOnly && maximumStops > intent.maxStops ? ["MAX_STOPS_CONFLICT"] : []),
    ...(timeInsideWindow(firstDeparture, intent) ? [] : ["DEPARTURE_TIME_CONFLICT"]),
    ...(intent.avoidRedEye && Number(firstDeparture.slice(11, 13)) < 6
      ? ["RED_EYE_CONFLICT"]
      : []),
    ...(intent.minimumCheckedBaggageKg > 0 ? ["CHECKED_BAGGAGE_UNVERIFIED"] : []),
  ];
  const sourceOfferId = segments
    .map((segment) => `${segment.marketingCarrier}${segment.flightNumber}-${segment.departureAt}`)
    .join("|");
  const fetchedAt = new Date().toISOString();

  return {
    schemaVersion: "1",
    id: `flyai:${requestId}:${itemIndex}`,
    sourceOfferId,
    connectorId: "fliggy-flyai",
    environment: "production",
    seller: {
      id: "fliggy",
      name: "飞猪",
      kind: "ota",
      deepLink: jumpUrl,
      handoffPrecision: "search_results",
    },
    legs,
    segments,
    priceComponents: [{
      kind: "required_service",
      label: intent.adults === 1 ? "飞猪成人展示价" : `飞猪成人展示价 × ${intent.adults}`,
      amountMinor: totalMinor,
      currency: "CNY",
      required: true,
    }],
    totalPrice: { amountMinor: totalMinor, currency: "CNY" },
    totalPriceCny: { amountMinor: totalMinor, currency: "CNY" },
    listedPrice: { amountMinor: totalMinor, currency: "CNY" },
    priceVerificationStatus: "listed_only",
    baggage: [],
    ...(text((stringArray(rawJourneys[0]?.segments)[0] as FlyAiSegment | undefined)?.seatClassName)
      ? {
          fareBrand: text(
            (stringArray(rawJourneys[0]?.segments)[0] as FlyAiSegment | undefined)?.seatClassName,
          )!,
        }
      : {}),
    refundable: null,
    changeable: null,
    eligibility: conditionalPrice ? ["CONDITIONAL_PRICE"] : [],
    fetchedAt,
    evidenceRef: jumpUrl,
    comparable: reasons.length === 0,
    incomparabilityReasons: reasons,
    qualityScore: reasons.length === 0 ? 82 : 58,
  };
}

export function mapFlyAiFlightPayload(
  payload: FlyAiPayload,
  intent: SearchIntent,
  requestId: string,
): Offer[] {
  return stringArray(payload.data?.itemList).flatMap((item, itemIndex) => {
    const mapped = mapFlyAiItem(item as FlyAiItem, intent, requestId, itemIndex);
    return mapped ? [mapped] : [];
  });
}

async function runCli(
  cliPath: string,
  apiKey: string | undefined,
  intent: SearchIntent,
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  const args = [
    cliPath,
    "search-flight",
    "--origin",
    intent.origin.code,
    "--destination",
    intent.destination.code,
    "--dep-date",
    intent.departureDate,
    "--seat-class-name",
    intent.cabin === "premium_economy" ? "premium economy" : intent.cabin,
    "--sort-type",
    "3",
  ];
  if (intent.returnDate) args.push("--back-date", intent.returnDate);
  if (intent.directOnly) args.push("--journey-type", "1");
  if (intent.budget?.currency === "CNY") {
    args.push("--max-price", String(Math.floor(intent.budget.amountMinor / 100)));
  }
  if (intent.departureTime?.earliest) {
    args.push("--dep-hour-start", String(Number(intent.departureTime.earliest.slice(0, 2))));
  }
  if (intent.departureTime?.latest) {
    args.push("--dep-hour-end", String(Number(intent.departureTime.latest.slice(0, 2))));
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        ...(apiKey ? { FLYAI_API_KEY: apiKey } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        reject(new DOMException("FlyAI search aborted.", "AbortError"));
      } else if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new ConnectorError(
          `FlyAI CLI failed: ${stderr.slice(0, 500)}`,
          /Trial limit reached|formal API Key/i.test(stderr)
            ? "FLYAI_API_KEY_REQUIRED"
            : /429/.test(stderr)
              ? "FLYAI_RATE_LIMIT"
              : "FLYAI_CLI_FAILED",
          /Trial limit reached|formal API Key/i.test(stderr)
            ? "auth_error"
            : /429/.test(stderr)
              ? "rate_limited"
              : "provider_error",
          /429/.test(stderr),
        ));
      }
    });
  });
}

export class FlyAiConnector implements FlightConnector {
  readonly metadata: ConnectorMetadata = {
    id: "fliggy-flyai",
    name: "飞猪 FlyAI",
    kind: "ota",
    environment: "production",
    authorization: "self_service_api",
    resultRole: "purchase_handoff",
    handoff: "deep_link",
    inventoryFamily: "fliggy",
    configured: true,
    supportsFlexibleDateProbe: false,
    capabilities: {
      tripTypes: ["one_way", "round_trip"],
      locationKinds: ["airport"],
      cabins: ["economy", "premium_economy", "business", "first"],
      maxAdults: 9,
      roundTripMode: "native",
      priceEvidence: ["listed"],
    },
  };
  private readonly cliPath: string;

  constructor(private readonly config: FlyAiConfig) {
    this.cliPath = config.cliPath ?? defaultCliPath();
  }

  async health(): Promise<ConnectorHealth> {
    try {
      await access(this.cliPath);
      return {
        state: this.config.apiKey ? "healthy" : "degraded",
        checkedAt: new Date().toISOString(),
        detail: this.config.apiKey
          ? "Official FlyAI CLI is installed and an API key is configured."
          : "Official FlyAI CLI is installed; anonymous trial quota may be exhausted.",
      };
    } catch {
      return {
        state: "unavailable",
        checkedAt: new Date().toISOString(),
        detail: "Official FlyAI CLI is not installed.",
      };
    }
  }

  async search(
    intent: SearchIntent,
    context: ConnectorSearchContext,
  ): Promise<ConnectorSearchResult> {
    const { stdout } = await runCli(this.cliPath, this.config.apiKey, intent, context.signal);
    let payload: FlyAiPayload;
    try {
      payload = JSON.parse(stdout.trim()) as FlyAiPayload;
    } catch {
      throw new ConnectorError(
        "FlyAI returned non-JSON output.",
        "FLYAI_INVALID_JSON",
        "invalid_response",
        false,
      );
    }
    if (payload.status !== 0 && payload.status !== "0") {
      throw new ConnectorError(
        `FlyAI returned an unsuccessful status: ${String(payload.message ?? payload.status)}`,
        "FLYAI_RESPONSE_ERROR",
        "provider_error",
        true,
      );
    }
    return {
      offers: mapFlyAiFlightPayload(payload, intent, context.requestId),
      providerRequestId: context.requestId,
      notes: [
        "FLYAI_OFFICIAL_REALTIME_INVENTORY",
        "FLYAI_LIST_PRICE_REQUIRES_SOURCE_REVALIDATION",
        ...(this.config.apiKey ? [] : ["FLYAI_ANONYMOUS_TRIAL"]),
      ],
    };
  }
}
