import { pool } from "@/db";

export async function GET() {
  try {
    const [rows] = await pool.query(
      "SELECT DATABASE() AS database_name, VERSION() AS version"
    );

    return Response.json({
      success: true,
      message: "MariaDB 연결 성공",
      result: rows,
    });
  } catch (error) {
    console.error("DB 연결 오류:", error);

    return Response.json(
      {
        success: false,
        message: "MariaDB 연결 실패",
      },
      { status: 500 }
    );
  }
}