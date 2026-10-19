"use client";

import { useRouter } from "next/navigation";
import OpeningFundModal from "./OpeningFundModal";

export default function PosOpeningGate() {
  const router = useRouter();
  return <OpeningFundModal
    context="pos"
    close={() => router.replace("/pos?openingCashDismissed=1")}
    onSaved={() => router.refresh()}
  />;
}
