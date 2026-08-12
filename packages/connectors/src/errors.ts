import type { ConnectorReport } from "@flight-lens/contracts";

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly state: ConnectorReport["state"],
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export async function providerHttpError(
  prefix: string,
  response: Response,
): Promise<ConnectorError> {
  const body = (await response.text()).slice(0, 500);
  if ([401, 403].includes(response.status)) {
    return new ConnectorError(
      `${prefix} authentication failed.`,
      `${prefix}_AUTH`,
      "auth_error",
      false,
    );
  }
  if (response.status === 429) {
    return new ConnectorError(
      `${prefix} rate limit reached.`,
      `${prefix}_RATE_LIMIT`,
      "rate_limited",
      true,
    );
  }
  return new ConnectorError(
    `${prefix} returned HTTP ${response.status}: ${body}`,
    `${prefix}_HTTP_${response.status}`,
    "provider_error",
    response.status >= 500,
  );
}
