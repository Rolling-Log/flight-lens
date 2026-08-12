const CHANNEL = "flight-lens-edge-companion";
const ALLOWED_ORIGINS = new Set([
  "https://flight-lens-staging.netlify.app",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:3100",
  "http://localhost:3100",
]);

if (ALLOWED_ORIGINS.has(window.location.origin)) {
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (
      !message ||
      message.channel !== CHANNEL ||
      message.direction !== "to-extension" ||
      !["PING", "SEARCH"].includes(message.type)
    ) return;

    chrome.runtime.sendMessage({
      type: `FLIGHT_LENS_${message.type}`,
      requestId: message.requestId,
      payload: message.payload,
    }).then((response) => {
      window.postMessage({
        channel: CHANNEL,
        direction: "to-page",
        requestId: message.requestId,
        ok: response?.ok === true,
        payload: response?.payload,
        errorCode: response?.errorCode,
      }, window.location.origin);
    }).catch(() => {
      window.postMessage({
        channel: CHANNEL,
        direction: "to-page",
        requestId: message.requestId,
        ok: false,
        errorCode: "COMPANION_RUNTIME_UNAVAILABLE",
      }, window.location.origin);
    });
  });
}
