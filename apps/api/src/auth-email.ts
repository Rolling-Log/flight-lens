export type AuthEmail = {
  to: string;
  subject: string;
  text: string;
};

export type AuthEmailSender = {
  send(message: AuthEmail): Promise<void>;
};

export function createAuthEmailSender(apiKey?: string, from?: string): AuthEmailSender | null {
  if (!apiKey || !from) return null;
  return {
    async send(message) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("AUTH_EMAIL_DELIVERY_FAILED");
    },
  };
}
