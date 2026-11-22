import { qrCustomerRedirectUrl } from "@/lib/qr-customer-redirect";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const destination = qrCustomerRedirectUrl(request, `/tdkqrs/join/${encodeURIComponent(token)}`);
  destination.search = new URL(request.url).search;
  return Response.redirect(destination, 307);
}
