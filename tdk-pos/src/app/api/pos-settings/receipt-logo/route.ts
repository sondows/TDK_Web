import { canManageSettings } from "@/lib/permissions";
import { getManagementOwner } from "@/lib/management-auth";
import { getReceiptLogoFileName, readReceiptLogo } from "@/lib/receipt-logo-storage";

export const runtime = "nodejs";

export async function GET() {
  const staff = await getManagementOwner();
  if (!staff) return new Response(null, { status: 401 });
  if (!canManageSettings(staff.role) || staff.staffCode === "000") return new Response(null, { status: 403 });
  try {
    const fileName = await getReceiptLogoFileName();
    if (!fileName) return new Response(null, { status: 404 });
    const logo = await readReceiptLogo(fileName);
    return new Response(new Uint8Array(logo), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("receipt logo preview failed", error);
    return new Response(null, { status: 404 });
  }
}
