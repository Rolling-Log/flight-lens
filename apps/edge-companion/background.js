const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const PLATFORMS = ["ctrip", "qunar", "tongcheng", "fliggy"];
const MAINLAND_CODES = new Set([
  "BJS", "PEK", "PKX", "TSN", "SHA", "PVG", "CAN", "SZX", "CTU", "TFU",
  "CKG", "HGH", "NKG", "WUH", "XIY", "NNG", "TAO", "XMN", "KMG", "CSX",
  "DLC", "SHE", "HRB", "CGQ", "TNA", "FOC", "WNZ", "NGB", "HFE", "KHN",
  "TYN", "SJW", "KWE", "LHW", "XNN", "INC", "HET", "LXA", "KWL", "ZUH",
  "WUX", "YNT", "JJN", "BHY", "DYG", "KHG", "JHG", "LJG",
]);
const CITY_NAMES = {
  BJS: "北京", PEK: "北京", PKX: "北京",
  SHA: "上海", PVG: "上海",
  CAN: "广州", SZX: "深圳", CTU: "成都", TFU: "成都",
  CKG: "重庆", HGH: "杭州", NKG: "南京", WUH: "武汉",
  XIY: "西安", NNG: "南宁", TAO: "青岛", XMN: "厦门",
  KMG: "昆明", CSX: "长沙", DLC: "大连", TSN: "天津",
};

function cityName(location) {
  const supplied = location.name || "";
  const cleaned = supplied
    .replace(/(国际)?机场.*$/, "")
    .replace(/首都$/, "北京")
    .replace(/浦东$/, "上海")
    .trim();
  return CITY_NAMES[location.code] || cleaned || location.code;
}

function buildUrl(platform, intent) {
  const originCode = intent.origin.code.toUpperCase();
  const destinationCode = intent.destination.code.toUpperCase();
  if (platform === "ctrip") {
    const cabin = { economy: "y", premium_economy: "s", business: "c", first: "f" }[intent.cabin] || "y";
    return `https://flights.ctrip.com/online/list/oneway-${originCode.toLowerCase()}-${destinationCode.toLowerCase()}?depdate=${intent.departureDate}&cabin=${cabin}&adult=${intent.adults}&child=0&infant=0`;
  }
  if (platform === "qunar") {
    const params = new URLSearchParams({
      searchDepartureAirport: cityName(intent.origin),
      searchArrivalAirport: cityName(intent.destination),
      searchDepartureTime: intent.departureDate,
    });
    return `https://flight.qunar.com/site/oneway_list.htm?${params}`;
  }
  if (platform === "tongcheng") {
    return `https://www.ly.com/flights/itinerary/oneway/${originCode}-${destinationCode}?date=${encodeURIComponent(intent.departureDate)}`;
  }
  const params = new URLSearchParams({
    tripType: "0",
    depCity: originCode,
    arrCity: destinationCode,
    depDate: intent.departureDate,
    depCityName: cityName(intent.origin),
    arrCityName: cityName(intent.destination),
  });
  return `https://sjipiao.fliggy.com/flight_search_result.htm?${params}`;
}

function inboundIntent(intent) {
  return {
    ...intent,
    tripType: "one_way",
    origin: intent.destination,
    destination: intent.origin,
    departureDate: intent.returnDate,
  };
}

async function waitForTab(tabId, timeoutMs = 45_000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("TAB_LOAD_TIMEOUT")), timeoutMs);
    const changed = (changedId, info) => {
      if (changedId === tabId && info.status === "complete") finish();
    };
    const removed = (removedId) => {
      if (removedId === tabId) finish(new Error("TAB_CLOSED"));
    };
    const finish = (error) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(changed);
      chrome.tabs.onRemoved.removeListener(removed);
      error ? reject(error) : resolve();
    };
    chrome.tabs.onUpdated.addListener(changed);
    chrome.tabs.onRemoved.addListener(removed);
  });
}

async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
}

async function collectJourney(tabId, platform, direction, intent) {
  const bookingUrl = buildUrl(platform, intent);
  await chrome.tabs.update(tabId, { url: bookingUrl, active: false });
  try {
    await waitForTab(tabId);
    const result = await chrome.tabs.sendMessage(tabId, {
      type: "FLIGHT_LENS_COLLECT",
      platform,
    });
    const normalized = {
      direction,
      state: result?.state || "page_changed",
      bookingUrl: result?.bookingUrl || bookingUrl,
      fetchedAt: result?.fetchedAt || new Date().toISOString(),
      cards: Array.isArray(result?.cards) ? result.cards : [],
      ...(result?.errorCode ? { errorCode: result.errorCode } : {}),
    };
    if (["login_required", "captcha_required"].includes(normalized.state)) {
      await focusTab(tabId);
    }
    return normalized;
  } catch (error) {
    return {
      direction,
      state: error?.message === "TAB_LOAD_TIMEOUT" ? "timeout" : "unavailable",
      bookingUrl,
      fetchedAt: new Date().toISOString(),
      cards: [],
      errorCode: `${platform.toUpperCase()}_COMPANION_${error?.message || "UNAVAILABLE"}`,
    };
  }
}

async function runPlatform(platform, intent) {
  const firstUrl = buildUrl(platform, intent);
  const tab = await chrome.tabs.create({ url: firstUrl, active: false });
  if (!tab.id) throw new Error("TAB_CREATE_FAILED");
  const journeys = [];
  let keepTab = false;
  try {
    const outbound = await collectJourney(tab.id, platform, "outbound", intent);
    journeys.push(outbound);
    keepTab = ["login_required", "captcha_required"].includes(outbound.state);
    if (intent.tripType === "round_trip" && intent.returnDate && !keepTab) {
      const inbound = await collectJourney(tab.id, platform, "inbound", inboundIntent(intent));
      journeys.push(inbound);
      keepTab = ["login_required", "captcha_required"].includes(inbound.state);
    }
    return { platform, journeys };
  } finally {
    if (!keepTab) await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

async function searchAll(intent) {
  const domestic = MAINLAND_CODES.has(intent.origin.code) && MAINLAND_CODES.has(intent.destination.code);
  const applicablePlatforms = domestic ? PLATFORMS : ["ctrip"];
  const results = await Promise.all(applicablePlatforms.map(async (platform) => {
    try {
      return await runPlatform(platform, intent);
    } catch (error) {
      return {
        platform,
        journeys: [{
          direction: "outbound",
          state: "unavailable",
          bookingUrl: buildUrl(platform, intent),
          fetchedAt: new Date().toISOString(),
          cards: [],
          errorCode: `${platform.toUpperCase()}_COMPANION_${error?.message || "FAILED"}`,
        }],
      };
    }
  }));
  const payload = { protocolVersion: "1", extensionVersion: EXTENSION_VERSION, results };
  await chrome.storage.local.set({ lastRun: { at: new Date().toISOString(), results } });
  return payload;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FLIGHT_LENS_PING") {
    sendResponse({ ok: true, payload: { extensionVersion: EXTENSION_VERSION } });
    return false;
  }
  if (message?.type === "FLIGHT_LENS_SEARCH" && message.payload?.intent) {
    searchAll(message.payload.intent)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({
        ok: false,
        errorCode: error?.message || "COMPANION_SEARCH_FAILED",
      }));
    return true;
  }
  if (message?.type === "FLIGHT_LENS_STATUS") {
    chrome.storage.local.get("lastRun").then((value) => {
      sendResponse({ ok: true, payload: value.lastRun || null });
    });
    return true;
  }
  return false;
});
