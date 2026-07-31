import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

type AppProvider = () => Promise<FastifyInstance>;
type SupportedMethod =
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT";

function requestPath(request: Request, segments: string[]): string {
  const url = new URL(request.url);
  const pathname = `/${segments.map(encodeURIComponent).join("/")}`;
  return `${pathname}${url.search}`;
}

function requestHeaders(request: Request): Record<string, string> {
  return Object.fromEntries(request.headers.entries());
}

function responseHeaders(
  values: Record<string, string | string[] | number | undefined>,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, String(value));
    }
  }
  return headers;
}

export function createFetchHandler(getApp: AppProvider) {
  return async function handleRequest(
    request: Request,
    segments: string[],
  ): Promise<Response> {
    const app = await getApp();
    const method = request.method.toUpperCase() as SupportedMethod;
    const body =
      method === "GET" || method === "HEAD" ? undefined : await request.text();
    const reply = await app.inject({
      method,
      url: requestPath(request, segments),
      headers: requestHeaders(request),
      ...(body ? { payload: body } : {}),
    });

    return new Response(
      method === "HEAD" || reply.statusCode === 204 ? null : reply.payload,
      {
        status: reply.statusCode,
        headers: responseHeaders(reply.headers),
      },
    );
  };
}

let appPromise: Promise<FastifyInstance> | undefined;

function serverlessApp(): Promise<FastifyInstance> {
  appPromise ??= buildApp({ config: loadConfig() });
  return appPromise;
}

export const handleApiRequest = createFetchHandler(serverlessApp);
