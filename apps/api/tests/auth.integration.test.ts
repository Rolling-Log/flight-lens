import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  createAccountStoreWithDatabase,
  hashOwnerToken,
  schema,
  type FlightLensDatabase,
} from "@flight-lens/database";
import { drizzle } from "drizzle-orm/pglite";
import { buildApp } from "../src/app.js";
import { createAuthServiceWithDatabase } from "../src/auth.js";
import type { AuthEmail } from "../src/auth-email.js";
import type { ApiConfig } from "../src/config.js";

const config: ApiConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 4000,
  webOrigins: ["http://localhost:3000"],
  logLevel: "silent",
  authSecret: "test-only-secret-that-is-at-least-thirty-two-characters",
  authBaseUrl: "http://localhost:4000",
  openaiIntentParserEnabled: false,
  openaiModel: "test-model",
  connectorTimeoutMs: 500,
  auditTimeoutMs: 50,
  monitorBatchMax: 5,
  monitorExecutionTimeoutMs: 45_000,
  ntfyBaseUrl: "https://ntfy.sh",
  connectors: {
    skyscannerBaseUrl: "https://partners.api.skyscanner.net",
    serpApiBaseUrl: "https://serpapi.com",
    serpApiMonthlyCreditCap: 5,
    duffelBaseUrl: "https://api.duffel.com",
  },
};

async function applyMigrations(database: PGlite) {
  const files = [
    "0000_foamy_firebird.sql",
    "0001_hot_nick_fury.sql",
    "0002_domestic_connector_states.sql",
    "0003_unsupported_query_state.sql",
    "0004_big_thing.sql",
    "0005_outgoing_valeria_richards.sql",
    "0006_solid_daimon_hellstrom.sql",
  ];
  for (const file of files) {
    const url = new URL(`../../../packages/database/drizzle/${file}`, import.meta.url);
    const sql = await readFile(url, "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) {
      await database.exec(statement);
    }
  }
}

function cookieHeader(value: string | string[] | undefined): string {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

function tokenFromEmail(message: AuthEmail): string {
  const match = message.text.match(/https?:\/\/\S+/);
  assert.ok(match, "auth email must contain a link");
  const url = new URL(match[0]);
  return url.searchParams.get("token") ?? url.pathname.split("/").at(-1)!;
}

test("completes verified email auth, password reset, revocation, and account deletion", async () => {
  const pglite = new PGlite();
  await applyMigrations(pglite);
  const database = drizzle(pglite, { schema });
  const emails: AuthEmail[] = [];
  const authService = createAuthServiceWithDatabase(config, database, {
    send: async (message) => { emails.push(message); },
  }, async () => pglite.close());
  const app = await buildApp({
    config,
    connectors: [],
    auditStore: null,
    v2Store: null,
    accountStore: null,
    monitorQueue: null,
    authService,
  });
  const origin = { origin: "http://localhost:3000", "x-forwarded-for": "198.51.100.10" };

  const signUp = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: origin,
    payload: { name: "Test User", email: "user@example.test", password: "correct-horse-battery" },
  });
  assert.equal(signUp.statusCode, 200);
  assert.equal(emails.length, 1);

  const unverified = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: origin,
    payload: { email: "user@example.test", password: "correct-horse-battery" },
  });
  assert.equal(unverified.statusCode, 403);

  const verificationLink = new URL(emails[0]!.text.match(/https?:\/\/\S+/)![0]);
  const verified = await app.inject({ method: "GET", url: `${verificationLink.pathname}${verificationLink.search}`, headers: origin });
  assert.ok([200, 302].includes(verified.statusCode));

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: origin,
    payload: { email: "user@example.test", password: "correct-horse-battery" },
  });
  assert.equal(login.statusCode, 200);
  let oldCookie = cookieHeader(login.headers["set-cookie"]);
  assert.match(oldCookie, /better-auth\.session_token=/);

  const current = await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { ...origin, cookie: oldCookie } });
  assert.equal(current.statusCode, 200);
  assert.equal(current.json().user.email, "user@example.test");

  const sessions = await app.inject({ method: "GET", url: "/api/auth/list-sessions", headers: { ...origin, cookie: oldCookie } });
  assert.equal(sessions.statusCode, 200);
  assert.equal(sessions.json().length, 1);

  await pglite.query("update \"session\" set expires_at = now() - interval '1 minute'");
  const expired = await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { ...origin, cookie: oldCookie } });
  assert.equal(expired.json(), null);
  const replacementLogin = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: origin,
    payload: { email: "user@example.test", password: "correct-horse-battery" },
  });
  oldCookie = cookieHeader(replacementLogin.headers["set-cookie"]);

  const resetRequest = await app.inject({
    method: "POST",
    url: "/api/auth/request-password-reset",
    headers: origin,
    payload: { email: "user@example.test", redirectTo: "http://localhost:3000/?mode=reset-password" },
  });
  assert.equal(resetRequest.statusCode, 200);
  const resetToken = tokenFromEmail(emails.at(-1)!);
  const reset = await app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    headers: origin,
    payload: { token: resetToken, newPassword: "new-correct-horse-password" },
  });
  assert.equal(reset.statusCode, 200);
  const revokedOld = await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { ...origin, cookie: oldCookie } });
  assert.equal(revokedOld.json(), null);

  const newLogin = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: origin,
    payload: { email: "user@example.test", password: "new-correct-horse-password" },
  });
  const newCookie = cookieHeader(newLogin.headers["set-cookie"]);
  const newSessions = await app.inject({ method: "GET", url: "/api/auth/list-sessions", headers: { ...origin, cookie: newCookie } });
  const token = newSessions.json()[0].token as string;
  const revoke = await app.inject({
    method: "POST",
    url: "/api/auth/revoke-session",
    headers: { ...origin, cookie: newCookie },
    payload: { token },
  });
  assert.equal(revoke.statusCode, 200);
  const revoked = await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { ...origin, cookie: newCookie } });
  assert.equal(revoked.json(), null);

  const deviceLoginA = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: origin,
    payload: { email: "user@example.test", password: "new-correct-horse-password" },
  });
  const deviceLoginB = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { ...origin, "x-forwarded-for": "198.51.100.11" },
    payload: { email: "user@example.test", password: "new-correct-horse-password" },
  });
  const deviceCookieA = cookieHeader(deviceLoginA.headers["set-cookie"]);
  const deviceCookieB = cookieHeader(deviceLoginB.headers["set-cookie"]);
  const revokeAll = await app.inject({
    method: "POST",
    url: "/api/auth/revoke-sessions",
    headers: { ...origin, cookie: deviceCookieA },
  });
  assert.equal(revokeAll.statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { ...origin, cookie: deviceCookieA } })).json(), null);
  assert.equal((await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { ...origin, cookie: deviceCookieB } })).json(), null);

  const finalLogin = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: origin,
    payload: { email: "user@example.test", password: "new-correct-horse-password" },
  });
  const finalCookie = cookieHeader(finalLogin.headers["set-cookie"]);
  const userId = finalLogin.json().user.id as string;
  await pglite.query(
    "insert into user_preferences (owner_token_hash, user_id, preferences) values ($1, $2, '{}'::jsonb)",
    ["account-owner-hash", userId],
  );
  await pglite.query(
    "insert into price_alerts (id, owner_token_hash, user_id, intent, target_amount_cny_minor, check_interval_minutes, ntfy_topic, status, next_check_at) values ($1, $2, $3, '{}'::jsonb, 10000, 360, 'test-topic', 'active', now())",
    ["00000000-0000-4000-8000-000000000001", "account-owner-hash", userId],
  );
  await pglite.query(
    "insert into notification_settings (user_id, email_enabled, push_enabled) values ($1, true, false)",
    [userId],
  );
  await pglite.query(
    "insert into searches (id, intent, status, planned_source_count, successful_source_count) values ($1, '{}'::jsonb, 'completed', 1, 1)",
    ["00000000-0000-4000-8000-000000000003"],
  );
  await pglite.query(
    "insert into price_observations (id, search_id, dedupe_key, itinerary_fingerprint, route_key, departure_date, cabin, adults, connector_id, inventory_family, seller_id, seller_name, kind, total_amount_minor, currency, price_verification_status, observed_at) select $1, id, 'public-account-delete-proof', 'public-proof', 'PVG-NRT', '2026-09-01', 'economy', 1, 'test', 'test', 'seller', 'Seller', 'verified_all_in', 10000, 'CNY', 'detail_verified', now() from searches limit 1",
    ["00000000-0000-4000-8000-000000000002"],
  );
  const deleteUser = await app.inject({
    method: "POST",
    url: "/api/auth/delete-user",
    headers: { ...origin, cookie: finalCookie },
    payload: { password: "new-correct-horse-password" },
  });
  assert.equal(deleteUser.statusCode, 200);
  const userRows = await pglite.query<{ count: string }>("select count(*)::text as count from \"user\"");
  const sessionRows = await pglite.query<{ count: string }>("select count(*)::text as count from \"session\"");
  const preferenceRows = await pglite.query<{ count: string }>("select count(*)::text as count from user_preferences");
  const alertRows = await pglite.query<{ count: string }>("select count(*)::text as count from price_alerts");
  const notificationRows = await pglite.query<{ count: string }>("select count(*)::text as count from notification_settings");
  const observationRows = await pglite.query<{ count: string }>("select count(*)::text as count from price_observations where dedupe_key = 'public-account-delete-proof'");
  assert.equal(userRows.rows[0]!.count, "0");
  assert.equal(sessionRows.rows[0]!.count, "0");
  assert.equal(preferenceRows.rows[0]!.count, "0");
  assert.equal(alertRows.rows[0]!.count, "0");
  assert.equal(notificationRows.rows[0]!.count, "0");
  assert.equal(observationRows.rows[0]!.count, "1");

  await app.close();
});

test("rejects hostile auth origins and emits hardened production session cookies", async () => {
  const pglite = new PGlite();
  await applyMigrations(pglite);
  const database = drizzle(pglite, { schema });
  const emails: AuthEmail[] = [];
  const productionConfig: ApiConfig = {
    ...config,
    nodeEnv: "production",
    authBaseUrl: "https://api.staging.example.test",
    webOrigins: ["https://web.staging.example.test"],
  };
  const authService = createAuthServiceWithDatabase(productionConfig, database, {
    send: async (message) => { emails.push(message); },
  }, async () => pglite.close());
  const app = await buildApp({
    config: productionConfig,
    connectors: [], auditStore: null, v2Store: null, accountStore: null, monitorQueue: null, authService,
  });
  const trustedHeaders = { origin: "https://web.staging.example.test" };
  const hostile = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: "https://hostile.example.test" },
    payload: { name: "Hostile", email: "hostile@example.test", password: "correct-horse-battery" },
  });
  assert.equal(hostile.statusCode, 403);

  const signUp = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: trustedHeaders,
    payload: { name: "Cookie User", email: "cookie@example.test", password: "correct-horse-battery" },
  });
  assert.equal(signUp.statusCode, 200);
  const verificationLink = new URL(emails[0]!.text.match(/https?:\/\/\S+/)![0]);
  await app.inject({ method: "GET", url: `${verificationLink.pathname}${verificationLink.search}`, headers: trustedHeaders });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: trustedHeaders,
    payload: { email: "cookie@example.test", password: "correct-horse-battery" },
  });
  assert.equal(login.statusCode, 200);
  const setCookie = Array.isArray(login.headers["set-cookie"])
    ? login.headers["set-cookie"].join("; ")
    : login.headers["set-cookie"] ?? "";
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.doesNotMatch(setCookie, /Domain=/i);
  await app.close();
});

test("rate limits repeated sign-in failures per trusted client IP", async () => {
  const pglite = new PGlite();
  await applyMigrations(pglite);
  const database = drizzle(pglite, { schema });
  const authService = createAuthServiceWithDatabase({ ...config, nodeEnv: "development" }, database, {
    send: async () => undefined,
  }, async () => pglite.close());
  const app = await buildApp({
    config: { ...config, nodeEnv: "development" },
    connectors: [], auditStore: null, v2Store: null, accountStore: null, monitorQueue: null, authService,
  });
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: "http://localhost:3000", "x-forwarded-for": "198.51.100.20" },
      payload: { email: "missing@example.test", password: "incorrect-password" },
    });
    statuses.push(response.statusCode);
  }
  assert.equal(statuses.at(-1), 429);
  const otherClient = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: "http://localhost:3000", "x-forwarded-for": "198.51.100.21" },
    payload: { email: "missing@example.test", password: "incorrect-password" },
  });
  assert.notEqual(otherClient.statusCode, 429);
  const spoofedLeftmost = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: "http://localhost:3000", "x-forwarded-for": "203.0.113.99, 198.51.100.20" },
    payload: { email: "missing@example.test", password: "incorrect-password" },
  });
  assert.equal(spoofedLeftmost.statusCode, 429);
  await app.close();
});

test("migrates anonymous data once without overwriting newer account data or duplicating alerts", async () => {
  const pglite = new PGlite();
  await applyMigrations(pglite);
  const db = drizzle(pglite, { schema });
  const store = createAccountStoreWithDatabase({
    db,
    close: async () => pglite.close(),
  } as unknown as FlightLensDatabase);
  const userA = "migration-user-a";
  const userB = "migration-user-b";
  await pglite.query("insert into \"user\" (id, name, email, email_verified) values ($1, 'A', 'a@example.test', true), ($2, 'B', 'b@example.test', true)", [userA, userB]);
  const ownerToken = "anonymous-owner-token-1234";
  const ownerTokenHash = await hashOwnerToken(ownerToken);
  const accountOwnerTokenHash = await hashOwnerToken(`flight-lens-account:${userA}`);
  const intent = {
    schemaVersion: "1" as const,
    tripType: "one_way" as const,
    origin: { kind: "airport" as const, code: "PVG" },
    destination: { kind: "airport" as const, code: "NRT" },
    departureDate: "2026-09-01",
    flexibleDays: 0,
    adults: 1,
    cabin: "economy" as const,
    directOnly: false,
    maxStops: 1,
    avoidRedEye: false,
    minimumCheckedBaggageKg: 0,
    includeNearbyAirports: false,
    explicitFields: [],
    inferredFields: [],
    pendingQuestions: [],
  };
  const accountPreferences = { preferredAirlines: ["MU"], preferredAirports: [], cabin: "economy", minimumCheckedBaggageKg: 0, redEyeWindow: { start: "00:00", end: "06:00" }, budgetAmountCnyMinor: null, ntfyTopic: null };
  const anonymousPreferences = { ...accountPreferences, preferredAirlines: ["CA"] };
  await pglite.query("insert into user_preferences (owner_token_hash, user_id, preferences, updated_at) values ($1, null, $2::jsonb, $3), ($4, $5, $6::jsonb, $7)", [
    ownerTokenHash, JSON.stringify(anonymousPreferences), new Date("2026-08-01T00:00:00Z"),
    accountOwnerTokenHash, userA, JSON.stringify(accountPreferences), new Date("2026-08-10T00:00:00Z"),
  ]);
  const alertSql = "insert into price_alerts (id, owner_token_hash, user_id, intent, target_amount_cny_minor, check_interval_minutes, ntfy_topic, status, next_check_at, last_triggered_at, last_triggered_amount_minor, updated_at) values ($1, $2, $3, $4::jsonb, 100000, 360, 'same-topic', 'active', $5, $6, $7, $8)";
  await pglite.query(alertSql, ["00000000-0000-4000-8000-000000000010", ownerTokenHash, null, JSON.stringify(intent), new Date("2026-08-11T00:00:00Z"), new Date("2026-08-09T00:00:00Z"), 99_000, new Date("2026-08-09T00:00:00Z")]);
  await pglite.query(alertSql, ["00000000-0000-4000-8000-000000000011", accountOwnerTokenHash, userA, JSON.stringify(intent), new Date("2026-08-12T00:00:00Z"), new Date("2026-08-10T00:00:00Z"), 98_000, new Date("2026-08-10T00:00:00Z")]);

  const input = { ownerToken, idempotencyKey: "00000000-0000-4000-8000-000000000020", decision: "migrate" as const };
  const first = await store.migrateAnonymous(userA, input);
  const repeated = await store.migrateAnonymous(userA, input);
  assert.equal(first.id, repeated.id);
  assert.deepEqual(first.result, { preferences: 0, alerts: 0, duplicates: 1 });
  const preferences = await store.getPreferences(userA);
  assert.deepEqual(preferences?.preferredAirlines, ["MU"]);
  const legacyPreferences = await pglite.query<{ count: string }>("select count(*)::text as count from user_preferences where owner_token_hash = $1", [ownerTokenHash]);
  assert.equal(legacyPreferences.rows[0]!.count, "0");
  const alerts = await pglite.query<{ status: string; user_id: string | null; last_triggered_amount_minor: number | null }>("select status, user_id, last_triggered_amount_minor from price_alerts order by id");
  assert.equal(alerts.rows.filter((item) => item.status === "active" && item.user_id === userA).length, 1);
  assert.equal(alerts.rows[0]!.status, "deleted");
  assert.equal(alerts.rows[0]!.user_id, userA);
  assert.equal(alerts.rows[1]!.last_triggered_amount_minor, 98_000);
  const migratedNotifications = await pglite.query<{ push_enabled: boolean; ntfy_topic: string | null }>(
    "select push_enabled, ntfy_topic from notification_settings where user_id = $1",
    [userA],
  );
  assert.deepEqual(migratedNotifications.rows, [{ push_enabled: true, ntfy_topic: "same-topic" }]);
  await assert.rejects(
    store.migrateAnonymous(userB, { ...input, idempotencyKey: "00000000-0000-4000-8000-000000000021" }),
    /ANONYMOUS_TOKEN_ALREADY_CLAIMED/,
  );
  await store.close();
});

test("resolves alert delivery from the owning account settings and preserves anonymous topics", async () => {
  const pglite = new PGlite();
  await applyMigrations(pglite);
  const db = drizzle(pglite, { schema });
  const store = createAccountStoreWithDatabase({
    db,
    close: async () => pglite.close(),
  } as unknown as FlightLensDatabase);
  await pglite.query("insert into \"user\" (id, name, email, email_verified) values ('delivery-a', 'A', 'a@example.test', true), ('delivery-b', 'B', 'b@example.test', false)");
  await pglite.query("insert into notification_settings (user_id, email_enabled, push_enabled, ntfy_topic) values ('delivery-a', true, true, 'current-a'), ('delivery-b', true, true, 'current-b')");
  await pglite.query(
    "insert into price_alerts (id, owner_token_hash, user_id, intent, target_amount_cny_minor, check_interval_minutes, ntfy_topic, status, next_check_at) values ('00000000-0000-4000-8000-000000000040', 'owner-a', 'delivery-a', '{}'::jsonb, 10000, 360, 'stale-a', 'active', now()), ('00000000-0000-4000-8000-000000000041', 'owner-b', 'delivery-b', '{}'::jsonb, 10000, 360, 'stale-b', 'active', now()), ('00000000-0000-4000-8000-000000000042', 'anonymous', null, '{}'::jsonb, 10000, 360, 'legacy-topic', 'active', now())",
  );
  assert.deepEqual(await store.getAlertDelivery("00000000-0000-4000-8000-000000000040"), {
    userId: "delivery-a", email: "a@example.test", emailEnabled: true, pushEnabled: true, ntfyTopic: "current-a",
  });
  assert.deepEqual(await store.getAlertDelivery("00000000-0000-4000-8000-000000000041"), {
    userId: "delivery-b", email: null, emailEnabled: false, pushEnabled: true, ntfyTopic: "current-b",
  });
  assert.deepEqual(await store.getAlertDelivery("00000000-0000-4000-8000-000000000042"), {
    userId: null, email: null, emailEnabled: false, pushEnabled: true, ntfyTopic: "legacy-topic",
  });
  const created = await store.createAlert("delivery-a", {
    intent: {
      schemaVersion: "1",
      tripType: "one_way",
      origin: { kind: "airport", code: "PVG" },
      destination: { kind: "airport", code: "NRT" },
      departureDate: "2026-09-01",
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
    },
    targetAmountCnyMinor: 100_000,
    checkIntervalMinutes: 360,
    ntfyTopic: "atomic-current-topic",
  });
  assert.deepEqual(await store.getAlertDelivery(created.id), {
    userId: "delivery-a", email: "a@example.test", emailEnabled: true, pushEnabled: true, ntfyTopic: "atomic-current-topic",
  });
  const persisted = await pglite.query<{ count: string }>(
    "select count(*)::text as count from price_alerts where id = $1 and user_id = 'delivery-a' and ntfy_topic = 'atomic-current-topic'",
    [created.id],
  );
  assert.equal(persisted.rows[0]!.count, "1");
  await store.close();
});

test("keeps skipped anonymous data and physically deletes an explicit anonymous deletion", async () => {
  const pglite = new PGlite();
  await applyMigrations(pglite);
  const db = drizzle(pglite, { schema });
  const store = createAccountStoreWithDatabase({
    db,
    close: async () => pglite.close(),
  } as unknown as FlightLensDatabase);
  const userId = "migration-decisions-user";
  await pglite.query("insert into \"user\" (id, name, email, email_verified) values ($1, 'A', 'decisions@example.test', true)", [userId]);
  const skippedToken = "anonymous-owner-token-skip-1234";
  const deletedToken = "anonymous-owner-token-delete-1234";
  const skippedHash = await hashOwnerToken(skippedToken);
  const deletedHash = await hashOwnerToken(deletedToken);
  await pglite.query("insert into user_preferences (owner_token_hash, preferences) values ($1, '{}'::jsonb), ($2, '{}'::jsonb)", [skippedHash, deletedHash]);
  await pglite.query(
    "insert into price_alerts (id, owner_token_hash, intent, target_amount_cny_minor, check_interval_minutes, ntfy_topic, status, next_check_at) values ($1, $2, '{}'::jsonb, 10000, 360, 'skip-topic', 'active', now()), ($3, $4, '{}'::jsonb, 10000, 360, 'delete-topic', 'deleted', now())",
    ["00000000-0000-4000-8000-000000000030", skippedHash, "00000000-0000-4000-8000-000000000031", deletedHash],
  );

  const skipped = await store.migrateAnonymous(userId, {
    ownerToken: skippedToken,
    idempotencyKey: "00000000-0000-4000-8000-000000000032",
    decision: "skip",
  });
  const deletedInput = {
    ownerToken: deletedToken,
    idempotencyKey: "00000000-0000-4000-8000-000000000033",
    decision: "delete" as const,
  };
  const deleted = await store.migrateAnonymous(userId, deletedInput);
  const repeated = await store.migrateAnonymous(userId, deletedInput);
  assert.equal(skipped.status, "skipped");
  assert.equal(deleted.status, "deleted");
  assert.equal(deleted.id, repeated.id);
  const remaining = await pglite.query<{ owner_token_hash: string }>("select owner_token_hash from user_preferences union all select owner_token_hash from price_alerts order by owner_token_hash");
  assert.deepEqual(remaining.rows.map((item) => item.owner_token_hash), [skippedHash, skippedHash]);
  await store.close();
});

test("rehearses the additive account migration rollback and reapply", async () => {
  const pglite = new PGlite();
  await applyMigrations(pglite);
  const down = await readFile(new URL("../../../packages/database/drizzle/0006_solid_daimon_hellstrom.down.sql", import.meta.url), "utf8");
  await pglite.exec(down);
  const absent = await pglite.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_name in ('user', 'session', 'anonymous_migrations')");
  assert.equal(absent.rows.length, 0);
  const migration = await readFile(new URL("../../../packages/database/drizzle/0006_solid_daimon_hellstrom.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) {
    await pglite.exec(statement);
  }
  const restored = await pglite.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_name in ('user', 'session', 'anonymous_migrations') order by table_name");
  assert.deepEqual(restored.rows.map((row) => row.table_name), ["anonymous_migrations", "session", "user"]);
  await pglite.close();
});
