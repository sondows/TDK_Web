/** Employee login IDs are entered directly; this endpoint no longer enumerates accounts. */
export async function GET() {
  return Response.json({ success: false, code: "EMPLOYEE_ID_LIST_DISABLED" }, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  });
}
