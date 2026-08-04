export default async function searchRateLimit(_request, context) {
  return context.next();
}

export const config = {
  path: "/api/v1/searches",
  rateLimit: {
    windowLimit: 2,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
