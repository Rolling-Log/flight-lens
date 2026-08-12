import assert from "node:assert/strict";
import test from "node:test";
import { monitorJobOptions } from "../src/monitor-queue.js";

test("configures monitor jobs with singleton idempotency and bounded retries", () => {
  assert.deepEqual(monitorJobOptions("alert-1", 45_000), {
    singletonKey: "alert-1",
    singletonSeconds: 300,
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 45,
  });
});

test("passes a scheduled start through without changing the execution budget", () => {
  const startAfter = new Date("2026-08-12T09:00:00.000Z");
  assert.deepEqual(monitorJobOptions("alert-2", 12_100, startAfter), {
    singletonKey: "alert-2",
    singletonSeconds: 300,
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 13,
    startAfter,
  });
});
