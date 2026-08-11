import "dotenv/config";
import type { SearchIntent, SearchResponse } from "@flight-lens/contracts";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const [origin = "PEK", destination = "SHA", departureDate = futureDate(30)] = process.argv.slice(2);
const config = loadConfig();
const app = await buildApp({ config });

try {
  const metadata = await app.inject({ method: "GET", url: "/v1/meta/connectors" });
  const connectorPayload = metadata.json() as {
    connectors: Array<{ id: string; name: string }>;
  };
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
  const response = await app.inject({
    method: "POST",
    url: "/v1/searches",
    payload: intent,
  });
  if (response.statusCode !== 200) {
    console.log(JSON.stringify({
      connectors: connectorPayload.connectors,
      statusCode: response.statusCode,
      error: response.json(),
    }, null, 2));
    process.exitCode = 1;
  } else {
    const result = response.json() as SearchResponse;
    console.log(JSON.stringify({
      connectors: connectorPayload.connectors,
      requestId: result.requestId,
      intent: result.intent,
      reports: result.connectorReports.map((report) => ({
        connectorId: report.connectorId,
        state: report.state,
        errorCode: report.errorCode ?? null,
        durationMs: report.durationMs,
        offerCount: report.offerCount,
        notes: report.notes,
      })),
      sourceOfferCounts: Object.fromEntries(
        [...new Set(result.offers.map((offer) => offer.connectorId))].map((connectorId) => [
          connectorId,
          result.offers.filter((offer) => offer.connectorId === connectorId).length,
        ]),
      ),
      samples: result.offers.slice(0, 8).map((offer) => ({
        source: offer.connectorId,
        seller: offer.seller.name,
        flight: offer.segments.map((segment) =>
          `${segment.marketingCarrier}${segment.flightNumber}`,
        ).join("/"),
        amountCny: (offer.totalPriceCny ?? offer.totalPrice).amountMinor / 100,
        verification: offer.priceVerificationStatus ?? "unverified",
      })),
      disclosure: result.disclosure,
    }, null, 2));
  }
} finally {
  await app.close();
}

process.exit(process.exitCode ?? 0);

function futureDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
