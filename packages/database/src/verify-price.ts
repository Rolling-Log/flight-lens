import {
  recordPriceVerification,
  type PriceVerificationOutcome,
} from "./index.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function amountMinor(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Amount must be a non-negative decimal with at most two places.");
  }
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("Amount exceeds the safe integer range.");
  return result;
}

const usage = [
  "Usage:",
  "pnpm --filter @flight-lens/database price:verify --",
  "--offer-id <normalized-offer-id>",
  "--outcome <observed|sold_out|landing_unavailable>",
  "--currency <CNY>",
  "--evidence <reference>",
  "[--amount <decimal>]",
].join(" ");

if (process.argv.includes("--help")) {
  process.stdout.write(`${usage}\n`);
  process.exit(0);
}

function invalidUsage(): never {
  throw new Error(usage);
}

const normalizedOfferId = argument("--offer-id");
const rawOutcome = argument("--outcome");
const currency = argument("--currency")?.toUpperCase();
const evidenceRef = argument("--evidence");
const rawAmount = argument("--amount");
if (
  !normalizedOfferId ||
  !rawOutcome ||
  !["observed", "sold_out", "landing_unavailable"].includes(rawOutcome) ||
  !currency ||
  !evidenceRef
) {
  invalidUsage();
}
const outcome = rawOutcome as PriceVerificationOutcome;
if ((outcome === "observed") !== Boolean(rawAmount)) invalidUsage();

const databaseUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required.");
}

const result = await recordPriceVerification(databaseUrl, {
  normalizedOfferId,
  outcome,
  ...(rawAmount ? { observedAmountMinor: amountMinor(rawAmount) } : {}),
  currency,
  evidenceRef,
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
