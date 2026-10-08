var FlightLensCtripResponse = (() => {
  function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function string(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  function moneyMinor(value) {
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
    const parsed = typeof value === "number" ? value : Number(value);
    const minor = Math.round(parsed * 100);
    return Number.isFinite(parsed) && parsed >= 0 && Number.isSafeInteger(minor) ? minor : null;
  }

  function time(value) {
    return string(value).match(/(?:T|\s)((?:[01]\d|2[0-3]):[0-5]\d)/)?.[1] || "";
  }

  function date(value) {
    return string(value).match(/^(\d{4}-\d{2}-\d{2})(?:T|\s)/)?.[1] || "";
  }

  function conditionLabels(value) {
    return [...new Set((JSON.stringify(value) || "").match(/会员|新客|券后|专享|银行卡/g) || [])];
  }

  function hasStopEvidence(value) {
    if (typeof value === "string") {
      const positive = value.replace(/无经停|不经停|无需中转|不中转|无中转|经停\s*0\s*次|0\s*次经停|0\s*次中转|转\s*0\s*次/g, "");
      return /经停|中转|转机|转\s*[1-9]\d*\s*次|(?:^|\s)转\s*[\u4e00-\u9fff]|停留\s*\d+\s*(?:小时|分钟)/.test(positive);
    }
    if (Array.isArray(value)) return value.some(hasStopEvidence);
    const record = object(value);
    if (!record) return false;
    const count = typeof record.stopCount === "number" || typeof record.stopCount === "string"
      ? Number(record.stopCount) : 0;
    return (Number.isSafeInteger(count) && count > 0) || Object.values(record).some(hasStopEvidence);
  }

  function cabinCode(pageUrl) {
    try {
      const value = new URL(pageUrl).searchParams.get("cabin")?.toUpperCase();
      return { Y: "Y", S: "S", C: "C", F: "F" }[value] || "Y";
    } catch {
      return "Y";
    }
  }

  function priceFor(priceList, requestedCabin) {
    const prices = array(priceList).map(object).filter(Boolean);
    const cabinPrices = prices.filter((price) =>
      !string(price.cabin) || string(price.cabin).toUpperCase() === requestedCabin
    );
    const candidates = cabinPrices.flatMap((price) => {
      const base = moneyMinor(price.adultPrice);
      const tax = moneyMinor(price.adultTax);
      const total = base ? base + (tax ?? 0) : moneyMinor(price.sortPrice);
      if (!total || !Number.isSafeInteger(total)) return [];
      return [{
        amountMinor: total,
        conditionLabels: conditionLabels(price),
        ...(base && tax !== null ? {
          priceBreakdown: { currency: "CNY", baseFareMinor: base, taxMinor: tax },
        } : {}),
      }];
    });
    return candidates.sort((left, right) =>
      Number(left.conditionLabels.length > 0) - Number(right.conditionLabels.length > 0) ||
      left.amountMinor - right.amountMinor
    )[0] ?? null;
  }

  function airportLabel(name, terminal) {
    return [string(name), string(terminal)].filter(Boolean).join(" ");
  }

  function normalize(payload, pageUrl) {
    const data = object(object(payload)?.data);
    const itineraries = array(data?.flightItineraryList);
    const requestedCabin = cabinCode(pageUrl);
    let requestedDate;
    try { requestedDate = new URL(pageUrl).searchParams.get("depdate"); } catch { return []; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate || "")) return [];
    return itineraries.flatMap((rawItinerary) => {
      const itinerary = object(rawItinerary);
      const flightSegments = array(itinerary?.flightSegments);
      if (flightSegments.length !== 1) return [];
      const segment = object(flightSegments[0]);
      const flights = array(segment?.flightList).map(object).filter(Boolean);
      if (flights.length !== 1) return [];
      const flight = flights[0];
      const flightNumber = string(flight.flightNo) || string(itinerary?.itineraryId).split("_")[0];
      const departureTime = time(flight.departureDateTime);
      const arrivalTime = time(flight.arrivalDateTime);
      const departureDate = date(flight.departureDateTime);
      const arrivalDate = date(flight.arrivalDateTime);
      const arrivalDays = (Date.parse(`${arrivalDate}T00:00:00Z`) - Date.parse(`${departureDate}T00:00:00Z`)) / 86_400_000;
      const departureAirport = airportLabel(flight.departureAirportName, flight.departureTerminal);
      const arrivalAirport = airportLabel(flight.arrivalAirportName, flight.arrivalTerminal);
      const price = priceFor(itinerary?.priceList, requestedCabin);
      if (
        !/^[A-Z0-9]{2}\d{3,4}$/i.test(flightNumber) ||
        !departureTime || !arrivalTime || !departureAirport || !arrivalAirport || !price ||
        departureDate !== requestedDate || ![0, 1].includes(arrivalDays) ||
        (arrivalDays === 0 && arrivalTime <= departureTime)
      ) return [];
      const airlineName = string(flight.marketAirlineName) || string(flight.airlineName);
      const priceText = `¥${price.amountMinor / 100}`;
      return [{
        cardText: [
          airlineName,
          flightNumber,
          departureTime,
          departureAirport,
          arrivalTime,
          arrivalAirport,
          arrivalDays === 1 ? "+1天" : "",
          hasStopEvidence(segment) ? "经停" : "",
          priceText,
          ...price.conditionLabels,
          ...conditionLabels({ ...itinerary, priceList: undefined, flightSegments: undefined }),
          ...conditionLabels(segment),
        ].filter(Boolean).join(" "),
        flightNumberText: flightNumber,
        airlineName,
        departureTime,
        arrivalTime,
        departureAirport,
        arrivalAirport,
        priceText,
        evidenceKind: "structured_response",
        ...(price.priceBreakdown ? { priceBreakdown: price.priceBreakdown } : {}),
      }];
    }).slice(0, 500);
  }

  return { normalize };
})();
