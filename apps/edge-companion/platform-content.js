const PLATFORM_SELECTORS = {
  ctrip: {
    cards: [
      ".flight-box",
      "[data-testid^='flight-item-']",
      ".flight-item.domestic",
      "[class*='flight-item']",
      "[class*='flightItem']",
    ],
    flightNumber: [".flight-airline .plane-No", ".flight-number", ".airline-name"],
    airlineName: [".flight-airline .airline-name", ".airline-item .airline-name"],
    departureTime: [".depart-box .time", ".depart-time", ".time-dep"],
    arrivalTime: [".arrive-box .time", ".arrive-time", ".time-arr"],
    departureAirport: [".depart-box .airport", ".depart-airport"],
    arrivalAirport: [".arrive-box .airport", ".arrive-airport"],
    price: [".flight-operate .flight-price .price", ".price-number", ".currency-price"],
  },
  qunar: {
    cards: [".e-airfly", ".b-airfly-item"],
    flightNumber: [".col-airline .num .n", ".air-code"],
    airlineName: [".col-airline .d-air:first-child .air span", ".airline-name"],
    departureTime: [".sep-lf h2", ".time-dep"],
    arrivalTime: [".sep-rt h2", ".time-arr"],
    departureAirport: [".sep-lf .airport", ".airport-dep"],
    arrivalAirport: [".sep-rt .airport", ".airport-arr"],
    price: [".col-price .prc[aria-label^='报价：']", ".b-airfly-price", ".price"],
  },
  tongcheng: {
    cards: [".flight-item"],
    flightNumber: [".flight-item-name"],
    airlineName: [".flight-item-name"],
    departureTime: [".f-startTime strong"],
    arrivalTime: [".f-endTime strong"],
    departureAirport: [".f-startTime em"],
    arrivalAirport: [".f-endTime em"],
    price: [".head-prices strong em", ".head-prices strong", ".price-show"],
  },
  fliggy: {
    cards: [".flight-list-item.J_FlightItem", ".flight-item-card"],
    flightNumber: [".flight-line .J_line", ".flight-line .airline-name", ".flight-no"],
    airlineName: [".flight-line .airline-name", ".airline-name"],
    departureTime: [".flight-time-deptime", ".dep-time"],
    arrivalTime: [".flight-time .s-time", ".arr-time"],
    departureAirport: [".flight-port .port-dep", ".dep-airport"],
    arrivalAirport: [".flight-port .port-arr", ".arr-airport"],
    price: [".flight-price .J_FlightListPrice", ".flight-price .pi-price", ".price-num"],
  },
};

const CTRIP_NETWORK_CHANNEL = "flight-lens-ctrip-network";
const ctripStructuredCards = new Map();
let ctripStructuredFetchedAt = null;

const FLIGHT_NUMBER_PATTERN = /(?:^|[^A-Z0-9])([A-Z0-9]{2})\s?(\d{3,4})(?![A-Z0-9])/i;
const TIME_PATTERN = /(?:^|[^\d])([0-2]?\d:[0-5]\d)(?!\d)/g;
const AIRPORT_PATTERN = /([\u4e00-\u9fff]{2,12}(?:国际)?机场(?:\s*T\d+)?)/g;
const PRICE_PATTERN = /(?:¥|￥)\s*([1-9]\d{1,5})/;
const PRICE_LIST_PATTERN = /(?:¥|￥)\s*([1-9]\d{1,5})/g;

function validStructuredCard(card) {
  return card && typeof card === "object" &&
    card.evidenceKind === "structured_response" &&
    [
      "cardText", "flightNumberText", "airlineName", "departureTime", "arrivalTime",
      "departureAirport", "arrivalAirport", "priceText",
    ].every((key) => typeof card[key] === "string" && card[key].length <= 20_000) &&
    /^[A-Z0-9]{2}\d{3,4}$/i.test(card.flightNumberText) &&
    /^\d{2}:\d{2}$/.test(card.departureTime) && /^\d{2}:\d{2}$/.test(card.arrivalTime) &&
    PRICE_PATTERN.test(card.priceText);
}

function ctripCardKey(card) {
  return `${card.flightNumberText.toUpperCase()}-${card.departureTime}-${card.arrivalTime}`;
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== window || event.origin !== location.origin ||
    message?.channel !== CTRIP_NETWORK_CHANNEL ||
    message?.type !== "CTRIP_BATCH_SEARCH_RESULT" || message?.pageUrl !== location.href
  ) return;
  for (const card of Array.isArray(message.cards) ? message.cards.slice(0, 50) : []) {
    if (validStructuredCard(card)) ctripStructuredCards.set(ctripCardKey(card), card);
  }
  if (typeof message.fetchedAt === "string") ctripStructuredFetchedAt = message.fetchedAt;
});

function requestCtripStructuredCards() {
  window.postMessage({
    channel: CTRIP_NETWORK_CHANNEL,
    type: "CTRIP_BATCH_SEARCH_REQUEST",
  }, location.origin);
}

function text(element) {
  if (!element) return "";
  return (element.getAttribute("aria-label") || element.innerText || element.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}

function first(root, selectors) {
  for (const selector of selectors) {
    try {
      const element = root.querySelector(selector);
      if (element) return element;
    } catch {
      // Ignore stale selectors and try the next verified candidate.
    }
  }
  return null;
}

function cardsFor(selectors) {
  for (const selector of selectors) {
    try {
      const matches = [...document.querySelectorAll(selector)]
        .filter((element) => element.getClientRects().length > 0);
      if (matches.length) return matches.slice(0, 50);
    } catch {
      // Ignore stale selectors and try the next verified candidate.
    }
  }
  return [];
}

function uniqueMatches(value, pattern) {
  return [...value.matchAll(pattern)].map((match) => match[1]).filter((item, index, items) =>
    items.indexOf(item) === index
  );
}

function looksLikeFlightCard(value) {
  return FLIGHT_NUMBER_PATTERN.test(value) &&
    uniqueMatches(value, TIME_PATTERN).length >= 2 &&
    uniqueMatches(value, AIRPORT_PATTERN).length >= 2 &&
    PRICE_PATTERN.test(value);
}

function actionCardRoots() {
  const actions = [...document.querySelectorAll("button, a, [role='button']")]
    .filter((element) => /订票|预订|选择/.test(text(element)))
    .filter((element) => element.getClientRects().length > 0);
  const roots = [];
  for (const action of actions) {
    let candidate = action;
    for (let depth = 0; candidate && depth < 9; depth += 1, candidate = candidate.parentElement) {
      if (!looksLikeFlightCard(text(candidate))) continue;
      roots.push(candidate);
      break;
    }
  }
  return roots.filter((candidate, index, items) =>
    items.indexOf(candidate) === index &&
    !items.some((other, otherIndex) => otherIndex !== index && candidate.contains(other))
  ).slice(0, 50);
}

function fallbackCard(card) {
  const cardText = text(card);
  const flight = cardText.match(FLIGHT_NUMBER_PATTERN);
  const times = uniqueMatches(cardText, TIME_PATTERN);
  const airports = uniqueMatches(cardText, AIRPORT_PATTERN);
  const prices = [...cardText.matchAll(PRICE_LIST_PATTERN)];
  const price = prices.at(-1);
  return {
    cardText,
    flightNumberText: flight ? `${flight[1]}${flight[2]}` : "",
    airlineName: flight ? cardText.slice(0, flight.index).trim().slice(-100) : "",
    departureTime: times[0] || "",
    arrivalTime: times[1] || "",
    departureAirport: airports[0] || "",
    arrivalAirport: airports[1] || "",
    priceText: price ? `¥${price[1]}` : "",
  };
}

function blockingState() {
  const url = location.href.toLowerCase();
  const body = text(document.body).toLowerCase();
  const hasLoginForm = Boolean(document.querySelector(
    "input[type='password'], input[autocomplete='current-password']",
  ));
  if (
    url.includes("login") || url.includes("passport") ||
    /请先登录|登录后查看|账号登录|手机号登录/.test(body) || hasLoginForm
  ) return "login_required";
  if (
    url.includes("captcha") || /验证码|安全验证|滑块|拖动验证|访问过于频繁/.test(body) ||
    document.querySelector("#nc_1_wrapper, .geetest_holder, #baxia-dialog-content")
  ) return "captcha_required";
  return null;
}

function extract(platform) {
  const selectors = PLATFORM_SELECTORS[platform];
  const selectedCards = cardsFor(selectors.cards);
  const candidateCards = [...selectedCards, ...actionCardRoots()].filter((candidate, index, items) =>
    items.indexOf(candidate) === index &&
    !items.some((other, otherIndex) => otherIndex !== index && candidate.contains(other))
  ).slice(0, 50);
  const domCards = candidateCards.map((card) => {
    const fallback = fallbackCard(card);
    let flightNumberText = text(first(card, selectors.flightNumber));
    if (platform === "ctrip" && !/[A-Z0-9]{2}\d{3,4}/i.test(flightNumberText)) {
      const coded = [...card.querySelectorAll("[id^='airlineName'], [id^='comfort-']")]
        .map((element) => element.id.match(/(?:airlineName|comfort-)([A-Z0-9]{2}\d{3,4})/i)?.[1])
        .find(Boolean);
      if (coded) flightNumberText = `${coded} ${flightNumberText}`.trim();
    }
    return {
      cardText: fallback.cardText,
      flightNumberText: flightNumberText || fallback.flightNumberText,
      airlineName: text(first(card, selectors.airlineName)) || fallback.airlineName,
      departureTime: text(first(card, selectors.departureTime)) || fallback.departureTime,
      arrivalTime: text(first(card, selectors.arrivalTime)) || fallback.arrivalTime,
      departureAirport: text(first(card, selectors.departureAirport)) || fallback.departureAirport,
      arrivalAirport: text(first(card, selectors.arrivalAirport)) || fallback.arrivalAirport,
      priceText: text(first(card, selectors.price)) || fallback.priceText,
      evidenceKind: "dom",
    };
  }).filter((card) =>
    card.flightNumberText && card.departureTime && card.arrivalTime &&
    card.departureAirport && card.arrivalAirport && card.priceText
  );
  if (platform !== "ctrip" || ctripStructuredCards.size === 0) return domCards;
  const structured = [...ctripStructuredCards.values()];
  const structuredKeys = new Set(structured.map(ctripCardKey));
  return [
    ...structured,
    ...domCards.filter((card) => !structuredKeys.has(ctripCardKey(card))),
  ].slice(0, 50);
}

async function collect(platform) {
  const startedAt = Date.now();
  if (platform === "ctrip") requestCtripStructuredCards();
  let stableCount = 0;
  let lastCount = -1;
  while (Date.now() - startedAt < 28_000) {
    const blocked = blockingState();
    if (blocked) {
      return {
        state: blocked,
        bookingUrl: location.href,
        fetchedAt: new Date().toISOString(),
        cards: [],
        errorCode: `${platform.toUpperCase()}_COMPANION_${blocked.toUpperCase()}`,
      };
    }
    const cards = extract(platform);
    if (cards.length > 0 && cards.length === lastCount) stableCount += 1;
    else stableCount = 0;
    lastCount = cards.length;
    if (cards.length > 0 && stableCount >= 2) {
      return {
        state: "success",
        bookingUrl: location.href,
        fetchedAt: platform === "ctrip" && ctripStructuredFetchedAt
          ? ctripStructuredFetchedAt
          : new Date().toISOString(),
        cards,
      };
    }
    const body = text(document.body);
    if (/暂无.{0,8}航班|没有.{0,8}航班|未查询到.{0,8}航班|无符合.{0,8}航班/.test(body)) {
      return {
        state: "empty",
        bookingUrl: location.href,
        fetchedAt: new Date().toISOString(),
        cards: [],
      };
    }
    if (platform === "ctrip" && Date.now() - startedAt < 3_000) requestCtripStructuredCards();
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return {
    state: "page_changed",
    bookingUrl: location.href,
    fetchedAt: new Date().toISOString(),
    cards: [],
    errorCode: `${platform.toUpperCase()}_COMPANION_PAGE_CHANGED`,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FLIGHT_LENS_COLLECT" || !PLATFORM_SELECTORS[message.platform]) return false;
  collect(message.platform).then(sendResponse).catch(() => sendResponse({
    state: "unavailable",
    bookingUrl: location.href,
    fetchedAt: new Date().toISOString(),
    cards: [],
    errorCode: `${message.platform.toUpperCase()}_COMPANION_EXTRACTION_FAILED`,
  }));
  return true;
});
