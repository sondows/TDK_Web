import { redirect } from "next/navigation";
import TvPlayer from "./player";

export const dynamic = "force-dynamic";

export default async function TvPage({ params }: { params: Promise<{ screenCode: string }> }) {
  const { screenCode } = await params;
  const requested = screenCode.toUpperCase();
  const legacy: Record<string, string> = { "AD-01": "DP1", "MENU-01": "DP2", "MENU-02": "DP3", "MENU-03": "DP4", "MENU-04": "DP5" };
  const canonical = legacy[requested] ?? requested;
  if (!/^DP[1-5]$/.test(canonical)) redirect("/tdkadm");
  if (canonical.toLowerCase() !== screenCode) redirect("/tdktv/" + canonical.toLowerCase());
  return <TvPlayer screenCode={canonical} />;
}
