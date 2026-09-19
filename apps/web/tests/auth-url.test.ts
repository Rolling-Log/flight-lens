import assert from "node:assert/strict";
import test from "node:test";
import { consumeAuthUrl } from "../src/auth-url.js";

test("captures reset tokens in memory and removes them from the visible URL", () => {
  assert.deepEqual(
    consumeAuthUrl(new URL("https://flight-lens.test/?mode=reset-password&token=secret#account")),
    { resetToken: "secret", sanitizedPath: "/#account" },
  );
});

test("removes verification tokens and callback URLs while preserving unrelated parameters", () => {
  assert.deepEqual(
    consumeAuthUrl(new URL("https://flight-lens.test/?token=secret&callbackURL=https%3A%2F%2Fflight-lens.test&source=email")),
    { resetToken: "", sanitizedPath: "/?source=email" },
  );
});

test("leaves ordinary URLs unchanged", () => {
  assert.deepEqual(
    consumeAuthUrl(new URL("https://flight-lens.test/?source=search")),
    { resetToken: "", sanitizedPath: null },
  );
});
