import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ success: false, code: "EMPLOYEE_PIN_ADMIN_MANAGED", message: "직원 공통 PIN은 관리센터 직원관리에서 설정하거나 변경해 주세요." }, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  });
}
