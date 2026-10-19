import { eq } from "drizzle-orm";
import { db } from "@/db";
import { businessSessionMutex } from "@/db/schema";

export type BusinessTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const OPENING_CASH_ENABLED_KEY = "business_opening_cash_enabled";

/** Serializes daily opening-cash registration and settlement revision creation. */
export async function lockBusinessMutex(tx: BusinessTx) {
  const [row] = await tx.select({ id: businessSessionMutex.mutexId }).from(businessSessionMutex)
    .where(eq(businessSessionMutex.mutexId, 1)).for("update").limit(1);
  if (!row) throw new Error("Business session migration is incomplete");
}
