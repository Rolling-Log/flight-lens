(() => {
  const CHANNEL = "flight-lens-ctrip-network";
  const cards = new Map();
  let fetchedAt = null;

  function isBatchSearch(url) {
    return typeof url === "string" && url.includes("/search/api/search/batchSearch");
  }

  function merge(payload) {
    const normalized = FlightLensCtripResponse.normalize(payload, location.href);
    for (const card of normalized) {
      cards.set(`${card.flightNumberText}-${card.departureTime}-${card.arrivalTime}`, card);
    }
    if (normalized.length) fetchedAt = new Date().toISOString();
    publish();
  }

  function publish() {
    window.postMessage({
      channel: CHANNEL,
      type: "CTRIP_BATCH_SEARCH_RESULT",
      pageUrl: location.href,
      fetchedAt,
      cards: [...cards.values()].slice(0, 50),
    }, location.origin);
  }

  async function consumeFetch(response, url) {
    if (!isBatchSearch(url)) return;
    try {
      merge(await response.clone().json());
    } catch {
      // A failed diagnostic tap must never affect the page's own request.
    }
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const result = originalFetch.apply(this, args);
    result.then((response) => {
      const input = args[0];
      const requestUrl = typeof input === "string" ? input : input?.url;
      void consumeFetch(response, requestUrl || response.url);
    }).catch(() => undefined);
    return result;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__flightLensUrl = String(url);
    return originalOpen.call(this, method, url, ...rest);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (isBatchSearch(this.__flightLensUrl)) {
      this.addEventListener("loadend", () => {
        try {
          const payload = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
          merge(payload);
        } catch {
          // Ignore non-JSON and blocked responses; DOM extraction remains available.
        }
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };

  window.addEventListener("message", (event) => {
    if (
      event.source === window && event.origin === location.origin &&
      event.data?.channel === CHANNEL && event.data?.type === "CTRIP_BATCH_SEARCH_REQUEST"
    ) publish();
  });
})();
