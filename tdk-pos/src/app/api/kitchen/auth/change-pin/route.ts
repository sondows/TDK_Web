import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ success: false, code: "EMPLOYEE_PIN_SELF_SERVICE", message: "개인 PIN은 최초 인증 화면에서 본인 마스터 비밀번호로 변경해 주세요." }, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  });
}
