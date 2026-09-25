import { NextResponse } from "next/server";
import { verifyActiveStaffCredentials } from "@/lib/auth";
import { ADMIN_GRANT_COOKIE, createAdminGrant } from "@/lib/permissions";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { staffCode?: unknown; pin?: unknown; requiredRole?: unknown };
    if (typeof body.staffCode !== "string" || typeof body.pin !== "string") return NextResponse.json({ success: false, message: "직원코드와 PIN을 입력하세요." }, { status: 400 });
    const member = await verifyActiveStaffCredentials(body.staffCode, body.pin);
    if (!member) return NextResponse.json({ success: false, message: "직원코드 또는 PIN이 올바르지 않습니다." }, { status: 401 });
    if (body.requiredRole === "OWNER" && member.role !== "OWNER") return NextResponse.json({ success: false, message: "직원 관리 권한이 없습니다." }, { status: 403 });
    const response = NextResponse.json({ success: true, name: member.name, role: member.role });
    response.cookies.set(ADMIN_GRANT_COOKIE, createAdminGrant(member.staffId), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
    return response;
  } catch { return NextResponse.json({ success: false, message: "관리자 확인에 실패했습니다." }, { status: 500 }); }
}
