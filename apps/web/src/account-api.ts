import { resolveApiBase } from "./api-base";

export function accountApiBase(hostname: string): string {
  if (["127.0.0.1", "localhost"].includes(hostname)) {
    return resolveApiBase(process.env.NEXT_PUBLIC_API_BASE_URL, hostname);
  }
  return "/api/backend";
}

export async function accountFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const hostname = typeof window === "undefined" ? "" : window.location.hostname;
  return fetch(`${accountApiBase(hostname)}${path}`, { ...init, credentials: "include" });
}
