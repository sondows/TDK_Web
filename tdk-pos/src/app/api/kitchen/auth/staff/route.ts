export async function GET() {
  return Response.json(
    { success: false, message: "Enter your employee ID to sign in." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
