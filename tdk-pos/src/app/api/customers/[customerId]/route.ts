import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { validateCustomerCreate } from "@/lib/customer";
import { getCurrentAdminStaff } from "@/lib/admin-auth";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

export async function PATCH(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  try {
    if (!await getCurrentAdminStaff()) return json({ success: false, message: "로그인이 필요합니다." }, 401);

    const customerId = Number((await params).customerId);
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return json({ success: false, message: "고객 정보를 확인해 주세요." }, 400);
    }

    let body: unknown;
    try { body = await request.json(); }
    catch { return json({ success: false, message: "고객정보를 확인해 주세요." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as Record<string, unknown>).isActive !== "boolean") {
      return json({ success: false, message: "고객 정보를 확인해 주세요." }, 400);
    }

    const { values, errors } = validateCustomerCreate(body);
    if (!values) return json({ success: false, message: "고객정보를 확인해 주세요.", errors }, 400);

    const result = await db.update(customers).set({
      ...values,
      isActive: (body as Record<string, unknown>).isActive === true ? 1 : 0,
      updatedAt: new Date(),
    }).where(eq(customers.customerId, customerId));

    if (!result[0].affectedRows) return json({ success: false, message: "수정할 고객을 찾지 못했습니다." }, 404);
    return json({ success: true, customerId });
  } catch (error) {
    console.error("Failed to update customer", error);
    return json({ success: false, message: "고객 정보를 저장하지 못했습니다." }, 500);
  }
}
