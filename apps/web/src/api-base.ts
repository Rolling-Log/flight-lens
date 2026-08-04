export function resolveApiBase(
  configuredBase: string | undefined,
  hostname: string,
): string {
  if (configuredBase) return configuredBase.replace(/\/$/, "");
  if (["127.0.0.1", "localhost"].includes(hostname)) {
    return "http://127.0.0.1:4000";
  }
  return "/api";
}
