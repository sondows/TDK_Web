export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  const destination = new URL(`/tdkqrs/${encodeURIComponent(identifier)}`, request.url);
  destination.search = new URL(request.url).search;
  return Response.redirect(destination, 307);
}
