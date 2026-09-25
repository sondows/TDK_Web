"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  tableId: number;
  tableName: string | null;
  capacity: number;
  sessionId: number | null;
  personCount: number | null;
  babyCount: number | null;
  openedAt: Date | null;
};

export default function TableCard({
  tableId,
  tableName,
  capacity,
  sessionId,
  personCount,
  babyCount,
}: Props) {
  const router = useRouter();
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [adultCount, setAdultCount] = useState(2);
  const [selectedBabyCount, setSelectedBabyCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const isOccupied = sessionId !== null;
  const displayName = tableName ?? `테이블 ${tableId}`;

  function openEntryModal() {
    setAdultCount(2);
    setSelectedBabyCount(0);
    setErrorMessage("");
    setIsEntryModalOpen(true);
  }

  function closeEntryModal() {
    if (!isSubmitting) setIsEntryModalOpen(false);
  }

  function handleClick() {
    if (isOccupied) {
      router.push(`/pos/session/${sessionId}`);
      return;
    }
    openEntryModal();
  }

  async function handleEntry() {
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/table-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId,
          personCount: adultCount,
          babyCount: selectedBabyCount,
        }),
      });
      const result = (await response.json()) as {
        success: boolean;
        message?: string;
      };

      if (!response.ok || !result.success) {
        setErrorMessage(result.message ?? "입장 처리에 실패했습니다.");
        return;
      }

      setIsEntryModalOpen(false);
      router.refresh();
    } catch {
      setErrorMessage("입장 처리 중 네트워크 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        className="min-h-36 rounded-xl border border-gray-300 bg-white p-5 text-left shadow-sm hover:bg-gray-50"
        onClick={handleClick}
        type="button"
      >
        <div className="text-2xl font-bold">{displayName}</div>
        <div className="mt-2 text-gray-500">{capacity}인 테이블</div>
        {isOccupied ? (
          <div className="mt-5 font-semibold text-red-600">
            사용 중 · 성인 {personCount ?? 0}명
            {(babyCount ?? 0) > 0 && ` · 유아 ${babyCount}명`}
          </div>
        ) : (
          <div className="mt-5 font-semibold text-green-600">빈 테이블</div>
        )}
      </button>

      {isEntryModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeEntryModal}
          role="presentation"
        >
          <div
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h2 className="text-xl font-bold">{displayName} 입장</h2>
            <div className="mt-6 space-y-4">
              <PersonCounter
                label="성인"
                onDecrease={() => setAdultCount((count) => Math.max(0, count - 1))}
                onIncrease={() => setAdultCount((count) => count + 1)}
                value={adultCount}
              />
              <PersonCounter
                label="유아"
                onDecrease={() =>
                  setSelectedBabyCount((count) => Math.max(0, count - 1))
                }
                onIncrease={() => setSelectedBabyCount((count) => count + 1)}
                value={selectedBabyCount}
              />
            </div>
            {errorMessage && (
              <p className="mt-4 text-sm font-medium text-red-600" role="alert">
                {errorMessage}
              </p>
            )}
            <div className="mt-8 flex justify-end gap-3">
              <button
                className="rounded-lg border border-gray-300 px-4 py-2 font-medium hover:bg-gray-50 disabled:cursor-not-allowed"
                disabled={isSubmitting}
                onClick={closeEntryModal}
                type="button"
              >
                취소
              </button>
              <button
                className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                disabled={isSubmitting}
                onClick={handleEntry}
                type="button"
              >
                {isSubmitting ? "저장 중..." : "입장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PersonCounter({
  label,
  value,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-medium">{label} 인원</span>
      <div className="flex items-center gap-3">
        <button
          aria-label={`${label} 인원 감소`}
          className="h-9 w-9 rounded-full border border-gray-300 text-lg hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={value === 0}
          onClick={onDecrease}
          type="button"
        >
          −
        </button>
        <span className="w-8 text-center font-semibold">{value}</span>
        <button
          aria-label={`${label} 인원 증가`}
          className="h-9 w-9 rounded-full border border-gray-300 text-lg hover:bg-gray-100"
          onClick={onIncrease}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
}
