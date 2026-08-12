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

  function positiveNumber(value) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function time(value) {
    return string(value).match(/(?:T|\s)([0-2]\d:[0-5]\d)/)?.[1] || "";
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
    const candidates = (cabinPrices.length ? cabinPrices : prices).flatMap((price) => {
      const base = positiveNumber(price.adultPrice);
      const tax = positiveNumber(price.adultTax) || 0;
      const total = base ? base + tax : positiveNumber(price.sortPrice);
      return total ? [total] : [];
    });
    return candidates.length ? Math.min(...candidates) : null;
  }

  function airportLabel(name, terminal) {
    return [string(name), string(terminal)].filter(Boolean).join(" ");
  }

  function normalize(payload, pageUrl) {
    const data = object(object(payload)?.data);
    const itineraries = array(data?.flightItineraryList);
    const requestedCabin = cabinCode(pageUrl);
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
      const departureAirport = airportLabel(flight.departureAirportName, flight.departureTerminal);
      const arrivalAirport = airportLabel(flight.arrivalAirportName, flight.arrivalTerminal);
      const price = priceFor(itinerary?.priceList, requestedCabin);
      if (
        !/^[A-Z0-9]{2}\d{3,4}$/i.test(flightNumber) ||
        !departureTime || !arrivalTime || !departureAirport || !arrivalAirport || !price
      ) return [];
      const airlineName = string(flight.marketAirlineName) || string(flight.airlineName);
      const priceText = `¥${Math.round(price)}`;
      return [{
        cardText: [
          airlineName,
          flightNumber,
          departureTime,
          departureAirport,
          arrivalTime,
          arrivalAirport,
          priceText,
        ].filter(Boolean).join(" "),
        flightNumberText: flightNumber,
        airlineName,
        departureTime,
        arrivalTime,
        departureAirport,
        arrivalAirport,
        priceText,
        evidenceKind: "structured_response",
      }];
    }).slice(0, 50);
  }

  return { normalize };
})();
