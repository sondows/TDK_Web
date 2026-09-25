import { db } from "@/db";
import { diningTables } from "@/db/schema";

export async function GET() {
  try {
    const tables = await db
      .select()
      .from(diningTables)
      .orderBy(diningTables.sortOrder);

    return Response.json({
      success: true,
      count: tables.length,
      tables,
    });
  } catch (error) {
    console.error("테이블 조회 오류:", error);

    return Response.json(
      {
        success: false,
        message: "테이블 조회 실패",
      },
      { status: 500 }
    );
  }
}