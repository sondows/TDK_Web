export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const destination = new URL(`/tdkqrs/join/${encodeURIComponent(token)}`, request.url);
  destination.search = new URL(request.url).search;
  return Response.redirect(destination, 307);
}
