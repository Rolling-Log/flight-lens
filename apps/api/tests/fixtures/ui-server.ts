import type { FlightConnector } from "@flight-lens/connectors";
import type { Offer, SearchIntent } from "@flight-lens/contracts";
import { buildApp } from "../../src/app.js";
import type { ApiConfig } from "../../src/config.js";

const port = Number(process.env.PORT ?? 4000);

const config: ApiConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port,
  webOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
  logLevel: "silent",
  openaiIntentParserEnabled: false,
  openaiModel: "gpt-5.6-luna",
  connectorTimeoutMs: 2_000,
  auditTimeoutMs: 500,
  searchRateLimitMax: 100,
  connectorMaxRetries: 0,
  connectorCacheTtlMs: 0,
  connectorStaleIfErrorMs: 0,
  connectors: {
    skyscannerBaseUrl: "https://partners.api.skyscanner.net",
    serpApiBaseUrl: "https://serpapi.com",
    serpApiMonthlyCreditCap: 200,
    amadeusBaseUrl: "https://test.api.amadeus.com",
    duffelBaseUrl: "https://api.duffel.com",
  },
};

function nextDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function airportName(code: string): string {
  return ({
    PVG: "上海浦东国际机场",
    NRT: "东京成田国际机场",
    HND: "东京羽田国际机场",
  } as Record<string, string>)[code] ?? `${code} 机场`;
}

function fixtureOffer(input: {
  intent: SearchIntent;
  id: string;
  connectorId: string;
  seller: string;
  amountMinor: number;
  qualityScore: number;
  outboundFlight: string;
  returnFlight: string;
  deepLink?: string;
  handoffPrecision?: "exact_offer" | "search_results";
}): Offer {
  const {
    intent,
    id,
    connectorId,
    seller,
    amountMinor,
    qualityScore,
    outboundFlight,
    returnFlight,
    deepLink = "https://example.com/flight-checkout",
    handoffPrecision = "exact_offer",
  } = input;
  const origin = { ...intent.origin, name: airportName(intent.origin.code) };
  const destination = {
    ...intent.destination,
    name: airportName(intent.destination.code),
  };
  const outboundArrivalDate = nextDate(intent.departureDate);
  const segments: Offer["segments"] = [
    {
      id: `${id}-outbound`,
      legIndex: 0,
      marketingCarrier: "MU",
      flightNumber: outboundFlight,
      origin,
      destination,
      departureAt: `${intent.departureDate}T21:45:00+08:00`,
      arrivalAt: `${outboundArrivalDate}T01:35:00+09:00`,
      durationMinutes: 170,
    },
  ];
  const legs: Offer["legs"] = [
    {
      id: `${id}-leg-0`,
      segmentIds: [`${id}-outbound`],
      origin,
      destination,
      departureAt: segments[0]!.departureAt,
      arrivalAt: segments[0]!.arrivalAt,
      durationMinutes: 170,
      stopCount: 0,
    },
  ];

  if (intent.tripType === "round_trip" && intent.returnDate) {
    const returnSegment: Offer["segments"][number] = {
      id: `${id}-return`,
      legIndex: 1,
      marketingCarrier: "MU",
      flightNumber: returnFlight,
      origin: destination,
      destination: origin,
      departureAt: `${intent.returnDate}T14:20:00+09:00`,
      arrivalAt: `${intent.returnDate}T16:50:00+08:00`,
      durationMinutes: 210,
    };
    segments.push(returnSegment);
    legs.push({
      id: `${id}-leg-1`,
      segmentIds: [returnSegment.id],
      origin: destination,
      destination: origin,
      departureAt: returnSegment.departureAt,
      arrivalAt: returnSegment.arrivalAt,
      durationMinutes: 210,
      stopCount: 0,
    });
  }

  return {
    schemaVersion: "1",
    id,
    sourceOfferId: `${id}-source`,
    connectorId,
    environment: "sandbox",
    seller: {
      id: seller.toLowerCase().replaceAll(" ", "-"),
      name: seller,
      kind: "ota",
      deepLink,
      handoffPrecision,
    },
    legs,
    segments,
    priceComponents: [
      {
        kind: "base",
        label: "本地验收含税总价",
        amountMinor,
        currency: "CNY",
        required: true,
      },
    ],
    totalPrice: { amountMinor, currency: "CNY" },
    totalPriceCny: { amountMinor, currency: "CNY" },
    baggage: [{ type: "checked", quantity: 1, weightKg: 23, included: true }],
    fareBrand: "Economy",
    refundable: null,
    changeable: null,
    eligibility: [],
    fetchedAt: new Date().toISOString(),
    evidenceRef: `local-fixture:${id}`,
    comparable: true,
    incomparabilityReasons: [],
    qualityScore,
  };
}

function connector(
  metadata: FlightConnector["metadata"],
  offers: (intent: SearchIntent) => Offer[],
): FlightConnector {
  return {
    metadata,
    async health() {
      return { state: "healthy", checkedAt: new Date().toISOString() };
    },
    async search(intent) {
      return { offers: offers(intent), notes: ["LOCAL_SANDBOX_CONNECTOR"] };
    },
  };
}

const connectors: FlightConnector[] = [
  connector(
    {
      id: "skyscanner-live-prices",
      name: "Skyscanner Live Prices",
      kind: "metasearch",
      environment: "sandbox",
      authorization: "partner_api",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      configured: true,
      supportsFlexibleDateProbe: false,
    },
    (intent) => [
      fixtureOffer({
        intent,
        id: "qa-skyscanner",
        connectorId: "skyscanner-live-prices",
        seller: "示例航旅",
        amountMinor: 238_800,
        qualityScore: 88,
        outboundFlight: "521",
        returnFlight: "522",
      }),
      fixtureOffer({
        intent,
        id: "qa-over-budget",
        connectorId: "skyscanner-live-prices",
        seller: "超预算示例",
        amountMinor: 320_000,
        qualityScore: 91,
        outboundFlight: "525",
        returnFlight: "526",
      }),
    ],
  ),
  connector(
    {
      id: "serpapi-google-flights",
      name: "SerpApi Google Flights",
      kind: "metasearch",
      environment: "sandbox",
      authorization: "self_service_api",
      resultRole: "purchase_handoff",
      handoff: "server_resolved",
      configured: true,
      supportsFlexibleDateProbe: false,
    },
    (intent) => [
      fixtureOffer({
        intent,
        id: "qa-serpapi",
        connectorId: "serpapi-google-flights",
        seller: "示例航空",
        amountMinor: 246_000,
        qualityScore: 94,
        outboundFlight: "523",
        returnFlight: "524",
        deepLink:
          "https://www.google.com/travel/flights?hl=zh-CN&curr=CNY&tfs=qa-fixture",
        handoffPrecision: "search_results",
      }),
    ],
  ),
];

const auditStore = {
  async persist() {},
  async close() {},
};

const app = await buildApp({ config, connectors, auditStore });

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

await app.listen({ host: config.host, port: config.port });
console.log(`Flight Lens API sandbox listening on http://${config.host}:${config.port}`);
