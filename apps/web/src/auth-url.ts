export type ConsumedAuthUrl = {
  resetToken: string;
  sanitizedPath: string | null;
};

export function consumeAuthUrl(url: URL): ConsumedAuthUrl {
  const token = url.searchParams.get("token") ?? "";
  if (!token) return { resetToken: "", sanitizedPath: null };

  const resetToken = url.searchParams.get("mode") === "reset-password" ? token : "";
  url.searchParams.delete("token");
  url.searchParams.delete("callbackURL");
  if (resetToken) url.searchParams.delete("mode");

  return {
    resetToken,
    sanitizedPath: `${url.pathname}${url.search}${url.hash}`,
  };
}
