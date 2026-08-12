import assert from "node:assert/strict";
import test from "node:test";
import {
  isSingleSourceLiveResult,
  resultSourceStatus,
} from "../src/result-source-status.js";

test("labels production offers as live production data", () => {
  assert.deepEqual(
    resultSourceStatus(
      [{ environment: "production" }],
      [{ state: "success", notes: [] }],
    ),
    { label: "实时生产来源", productionStyle: true },
  );
});

test("does not mislabel a production connector timeout as sandbox data", () => {
  assert.deepEqual(
    resultSourceStatus([], [{ state: "timeout", notes: [] }]),
    { label: "来源超时 · 未返回报价", productionStyle: false },
  );
});

test("distinguishes provider failure from an honest empty response", () => {
  assert.equal(
    resultSourceStatus([], [{ state: "provider_error", notes: [] }]).label,
    "来源失败 · 未返回报价",
  );
  assert.equal(
    resultSourceStatus([], [{ state: "empty", notes: [] }]).label,
    "来源已完成 · 无符合报价",
  );
});

test("labels sandbox offers even when their local connectors succeed", () => {
  assert.deepEqual(
    resultSourceStatus(
      [{ environment: "sandbox" }],
      [{ state: "success", notes: ["LOCAL_SANDBOX_CONNECTOR"] }],
    ),
    { label: "Sandbox 来源 · 不代表可购买库存", productionStyle: false },
  );
});

test("detects a single successful production source", () => {
  assert.equal(
    isSingleSourceLiveResult(
      [{ environment: "production", connectorId: "source-a" }],
    ),
    true,
  );
  assert.equal(
    isSingleSourceLiveResult(
      [
        { environment: "production", connectorId: "source-a" },
        { environment: "production", connectorId: "source-b" },
      ],
    ),
    false,
  );
  assert.equal(
    isSingleSourceLiveResult(
      [{ environment: "sandbox" }],
    ),
    false,
  );
  assert.equal(
    isSingleSourceLiveResult(
      [
        { environment: "production", connectorId: "source-a" },
        { environment: "sandbox", connectorId: "sandbox-source" },
      ],
    ),
    true,
  );
});

test("discloses fresh and stale cache states before offer environment", () => {
  assert.deepEqual(
    resultSourceStatus(
      [{ environment: "production" }],
      [{ state: "success", notes: ["CACHE_HIT:120ms"] }],
    ),
    { label: "生产来源 · 已披露新鲜缓存", productionStyle: true },
  );
  assert.deepEqual(
    resultSourceStatus(
      [{ environment: "production" }],
      [{ state: "success", notes: ["CACHE_STALE_FALLBACK:1000ms"] }],
    ),
    { label: "实时来源失败 · 已披露旧缓存降级", productionStyle: false },
  );
});
