import { qrCustomerRedirectUrl } from "@/lib/qr-customer-redirect";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  const destination = qrCustomerRedirectUrl(request, `/tdkqrs/${encodeURIComponent(identifier)}`);
  destination.search = new URL(request.url).search;
  return Response.redirect(destination, 307);
}
