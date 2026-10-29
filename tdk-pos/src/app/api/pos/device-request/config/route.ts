import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSecuritySettings } from "@/db/schema";

export async function GET() {
  try {
    const [row] = await db.select({ enabled: adminSecuritySettings.deviceRegistrationPasswordEnabled })
      .from(adminSecuritySettings).where(eq(adminSecuritySettings.settingsId, 1)).limit(1);
    if (!row) return Response.json({ success: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return Response.json({ success: true, passwordRequired: row.enabled === 1 }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
