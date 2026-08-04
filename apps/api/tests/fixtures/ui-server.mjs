import { Buffer } from "node:buffer";
import { createServer } from "node:http";

const port = Number(globalThis.process.env.PORT ?? 4000);
const requestId = "11111111-1111-4111-8111-111111111111";

const baseIntent = {
  schemaVersion: "1",
  tripType: "round_trip",
  origin: { kind: "airport", code: "PVG" },
  destination: { kind: "airport", code: "NRT" },
  departureDate: "2026-08-24",
  returnDate: "2026-08-29",
  flexibleDays: 3,
  adults: 1,
  cabin: "economy",
  directOnly: true,
  maxStops: 0,
  avoidRedEye: true,
  minimumCheckedBaggageKg: 23,
  includeNearbyAirports: false,
  explicitFields: [],
  inferredFields: [],
  pendingQuestions: [],
};

function offer({
  id,
  connectorId,
  seller,
  amountMinor,
  qualityScore,
  outboundFlight,
  returnFlight,
  deepLink = "https://example.com/flight-checkout",
  handoffPrecision = "exact_offer",
}) {
  const segments = [
    {
      id: `${id}-outbound`,
      legIndex: 0,
      marketingCarrier: "MU",
      flightNumber: outboundFlight,
      origin: { kind: "airport", code: "PVG", name: "上海浦东国际机场" },
      destination: { kind: "airport", code: "NRT", name: "东京成田国际机场" },
      departureAt: "2026-08-24T22:45:00+08:00",
      arrivalAt: "2026-08-25T02:35:00+09:00",
      durationMinutes: 170,
    },
    {
      id: `${id}-return`,
      legIndex: 1,
      marketingCarrier: "MU",
      flightNumber: returnFlight,
      origin: { kind: "airport", code: "NRT", name: "东京成田国际机场" },
      destination: { kind: "airport", code: "PVG", name: "上海浦东国际机场" },
      departureAt: "2026-08-29T14:20:00+09:00",
      arrivalAt: "2026-08-29T16:50:00+08:00",
      durationMinutes: 210,
    },
  ];

  return {
    schemaVersion: "1",
    id,
    sourceOfferId: `${id}-source`,
    connectorId,
    environment: "production",
    seller: {
      id: seller.toLowerCase().replaceAll(" ", "-"),
      name: seller,
      kind: "ota",
      deepLink,
      handoffPrecision,
    },
    legs: [
      {
        id: `${id}-leg-0`,
        segmentIds: [`${id}-outbound`],
        origin: segments[0].origin,
        destination: segments[0].destination,
        departureAt: segments[0].departureAt,
        arrivalAt: segments[0].arrivalAt,
        durationMinutes: 170,
        stopCount: 0,
      },
      {
        id: `${id}-leg-1`,
        segmentIds: [`${id}-return`],
        origin: segments[1].origin,
        destination: segments[1].destination,
        departureAt: segments[1].departureAt,
        arrivalAt: segments[1].arrivalAt,
        durationMinutes: 210,
        stopCount: 0,
      },
    ],
    segments,
    priceComponents: [
      {
        kind: "base",
        label: "来源平台所示含税总价",
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
    fetchedAt: "2026-07-30T09:30:00.000Z",
    evidenceRef: `qa:${id}`,
    comparable: true,
    incomparabilityReasons: [],
    qualityScore,
  };
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return json(response, 204, {});

  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, { status: "ok" });
  }

  if (request.method === "POST" && request.url === "/v1/intents/parse") {
    const body = await readJson(request);
    if (typeof body.text === "string" && body.text.includes("下个月广州")) {
      return json(response, 200, {
        ready: false,
        draft: {
          tripType: "one_way",
          originCode: "CAN",
          destinationCode: "SIN",
          departureDate: null,
          returnDate: null,
          flexibleDays: 0,
          adults: 1,
          budgetAmountCny: null,
          departureTimeEarliest: null,
          departureTimeLatest: null,
          directOnly: false,
          maxStops: 1,
          avoidRedEye: false,
          minimumCheckedBaggageKg: 0,
          includeNearbyAirports: false,
          assumptions: [],
          pendingQuestions: ["请确认下个月的具体出发日期。"],
        },
        intent: null,
        parser: { kind: "local_deterministic_zh", model: "local-zh-v1" },
      });
    }
    return json(response, 200, {
      ready: true,
      draft: {
        tripType: "round_trip",
        originCode: "PVG",
        destinationCode: "NRT",
        departureDate: "2026-08-24",
        returnDate: "2026-08-29",
        flexibleDays: 3,
        adults: 1,
        budgetAmountCny: 3000,
        departureTimeEarliest: "06:00",
        departureTimeLatest: "22:00",
        directOnly: true,
        maxStops: 0,
        avoidRedEye: true,
        minimumCheckedBaggageKg: 23,
        includeNearbyAirports: false,
        assumptions: [],
        pendingQuestions: [],
      },
      intent: {
        ...baseIntent,
        budget: { amountMinor: 300000, currency: "CNY" },
        departureTime: { earliest: "06:00", latest: "22:00" },
      },
      parser: { kind: "openai_structured_output", model: "qa-fixture" },
    });
  }

  if (request.method === "POST" && request.url === "/v1/searches") {
    const lowest = offer({
      id: "qa-skyscanner",
      connectorId: "skyscanner-live-prices",
      seller: "示例航旅",
      amountMinor: 238800,
      qualityScore: 88,
      outboundFlight: "521",
      returnFlight: "522",
    });
    const recommended = offer({
      id: "qa-serpapi",
      connectorId: "serpapi-google-flights",
      seller: "示例航空",
      amountMinor: 246000,
      qualityScore: 94,
      outboundFlight: "523",
      returnFlight: "524",
      deepLink:
        "https://www.google.com/travel/flights?hl=zh-CN&curr=CNY&tfs=qa-fixture",
      handoffPrecision: "search_results",
    });
    const excluded = {
      ...offer({
        id: "qa-over-budget",
        connectorId: "serpapi-google-flights",
        seller: "超预算示例",
        amountMinor: 320000,
        qualityScore: 91,
        outboundFlight: "525",
        returnFlight: "526",
      }),
      comparable: false,
      incomparabilityReasons: ["OVER_BUDGET"],
    };
    return json(response, 200, {
      requestId,
      intent: baseIntent,
      offers: [lowest, recommended, excluded],
      connectorReports: [
        {
          connectorId: "skyscanner-live-prices",
          connectorName: "Skyscanner Live Prices",
          state: "success",
          startedAt: "2026-07-30T09:29:58.000Z",
          finishedAt: "2026-07-30T09:30:00.000Z",
          durationMs: 2000,
          offerCount: 1,
          retryable: false,
          notes: [
            "FLEXIBLE_DATE_THREE_POINT_PROBE:2026-08-21,2026-08-24,2026-08-27",
          ],
        },
        {
          connectorId: "serpapi-google-flights",
          connectorName: "SerpApi Google Flights",
          state: "success",
          startedAt: "2026-07-30T09:29:58.000Z",
          finishedAt: "2026-07-30T09:29:59.000Z",
          durationMs: 1000,
          offerCount: 1,
          retryable: false,
          notes: [],
        },
      ],
      lowestComparableOfferId: lowest.id,
      recommendedOfferId: recommended.id,
      shortestOfferId: lowest.id,
      fewestStopsOfferId: lowest.id,
      bestBaggageOfferId: lowest.id,
      mostFlexibleOfferId: null,
      disclosure: {
        plannedSources: 2,
        successfulSources: 2,
        failedSources: 0,
        timedOutSources: 0,
        statement:
          "本次最低价仅限 2 个成功返回并通过完整性校验的实时来源，不代表未接入平台。",
      },
      audit: { configured: true, persisted: true },
    });
  }

  return json(response, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
});

server.listen(port, "127.0.0.1", () => {
  globalThis.console.log(`Flight Lens UI fixture listening on http://127.0.0.1:${port}`);
});
