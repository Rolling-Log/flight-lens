import type { SearchIntent } from "@flight-lens/contracts";
import {
  BrowserOtaConnector,
  executeConnector,
  type BrowserOtaPlatform,
} from "../src/index.js";

const [origin = "PEK", destination = "SHA", departureDate = futureDate(30)] = process.argv.slice(2);
const platforms = (process.env.SMOKE_PLATFORMS?.split(",") ?? [
  "ctrip",
  "qunar",
  "tongcheng",
]).filter((value): value is BrowserOtaPlatform =>
  ["ctrip", "qunar", "tongcheng"].includes(value),
);

const intent: SearchIntent = {
  schemaVersion: "1",
  tripType: "one_way",
  origin: { kind: "airport", code: origin.toUpperCase() },
  destination: { kind: "airport", code: destination.toUpperCase() },
  departureDate,
  flexibleDays: 0,
  adults: 1,
  cabin: "economy",
  directOnly: false,
  maxStops: 1,
  avoidRedEye: false,
  minimumCheckedBaggageKg: 0,
  includeNearbyAirports: false,
  explicitFields: [],
  inferredFields: [],
  pendingQuestions: [],
};

const executablePath = process.env.BROWSER_EXECUTABLE_PATH ??
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
const proxyServer = process.env.BROWSER_PROXY_SERVER;
const timeoutMs = Number(process.env.BROWSER_NAVIGATION_TIMEOUT_MS ?? 25_000);

const results = [];
for (const platform of platforms) {
  const connector = new BrowserOtaConnector({
    platform,
    executablePath,
    headless: true,
    ...(proxyServer ? { proxyServer } : {}),
    navigationTimeoutMs: timeoutMs,
  });
  const execution = await executeConnector(
    connector,
    intent,
    crypto.randomUUID(),
    timeoutMs * 3,
    {
    maxRetries: 0,
    cacheTtlMs: 0,
    staleIfErrorMs: 0,
    },
  );
  results.push({
    platform,
    state: execution.report.state,
    errorCode: execution.report.errorCode ?? null,
    durationMs: execution.report.durationMs,
    offerCount: execution.result.offers.length,
    sample: execution.result.offers.slice(0, 3).map((offer) => ({
      flight: offer.segments.map((segment) =>
        `${segment.marketingCarrier}${segment.flightNumber}`,
      ).join("/"),
      departureAt: offer.legs[0]?.departureAt,
      amountCny: (offer.totalPriceCny ?? offer.totalPrice).amountMinor / 100,
      verification: offer.priceVerificationStatus ?? "unverified",
      seller: offer.seller.name,
    })),
    notes: execution.report.notes,
  });
}

console.log(JSON.stringify({ intent, checkedAt: new Date().toISOString(), results }, null, 2));

function futureDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
