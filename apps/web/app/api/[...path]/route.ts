import { handleApiRequest } from "@flight-lens/api/fetch-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

async function route(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return handleApiRequest(request, path);
}

export {
  route as DELETE,
  route as GET,
  route as HEAD,
  route as OPTIONS,
  route as PATCH,
  route as POST,
  route as PUT,
};
