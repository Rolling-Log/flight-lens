export type NotificationInput = {
  topic: string;
  title: string;
  message: string;
  clickUrl?: string;
};

export type Notifier = {
  send(input: NotificationInput, signal?: AbortSignal): Promise<void>;
};

export class NtfyNotifier implements Notifier {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken?: string,
  ) {}

  async send(input: NotificationInput, signal?: AbortSignal): Promise<void> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/${encodeURIComponent(input.topic)}`, {
      method: "POST",
      headers: {
        "content-type": "text/plain; charset=utf-8",
        title: input.title,
        ...(input.clickUrl ? { click: input.clickUrl } : {}),
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: input.message,
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`NTFY_HTTP_${response.status}`);
  }
}
