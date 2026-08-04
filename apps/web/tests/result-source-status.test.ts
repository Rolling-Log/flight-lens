import assert from "node:assert/strict";
import test from "node:test";
import { resultSourceStatus } from "../src/result-source-status.js";

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
