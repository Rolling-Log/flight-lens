export function resolveApiBase(
  configuredBase: string | undefined,
  hostname: string,
): string {
  if (configuredBase) return configuredBase.replace(/\/$/, "");
  if (["127.0.0.1", "localhost"].includes(hostname)) {
    return "http://127.0.0.1:4000";
  }
  throw new Error(
    "当前部署未配置 Railway API 地址，请联系维护者。",
  );
}
