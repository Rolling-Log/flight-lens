import assert from "node:assert/strict";
import test from "node:test";
import type { SearchIntent } from "@flight-lens/contracts";
import { executeConnector, type FlightConnector } from "../src/index.js";

const intent: SearchIntent = {
  schemaVersion: "1",
  tripType: "one_way",
  origin: { kind: "airport", code: "PVG" },
  destination: { kind: "airport", code: "NRT" },
  departureDate: "2026-08-24",
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

test("classifies an empty successful source distinctly from failure", async () => {
  const connector: FlightConnector = {
    metadata: {
      id: "empty",
      name: "Empty",
      kind: "aggregator",
      environment: "sandbox",
      authorization: "self_service_api",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async () => ({ offers: [] }),
  };
  const execution = await executeConnector(connector, intent, crypto.randomUUID(), 100);
  assert.equal(execution.report.state, "empty");
});
