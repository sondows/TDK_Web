const retired = () => Response.json(
  { success: false, message: "KDS 전용 계정 관리는 종료되었습니다. 직원 관리에서 KDS 사용 권한을 설정해 주세요." },
  { status: 410, headers: { "Cache-Control": "no-store" } },
);

export async function GET() { return retired(); }
export async function POST() { return retired(); }
export async function PATCH() { return retired(); }
