"use client";

import { createAuthClient } from "better-auth/react";
import { resolveApiBase } from "./api-base";

function authBase(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (["127.0.0.1", "localhost"].includes(window.location.hostname)) {
    return resolveApiBase(process.env.NEXT_PUBLIC_API_BASE_URL, window.location.hostname);
  }
  return window.location.origin;
}

export const authClient = createAuthClient({
  baseURL: authBase(),
  basePath: "/api/auth",
  fetchOptions: { credentials: "include" },
});
