"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./admin.module.css";

export default function AdminExitButton() {
  const [showFallback, setShowFallback] = useState(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
  }, []);

  const requestExit = () => {
    setShowFallback(false);
    try {
      window.close();
    } finally {
      // Browsers only allow close() for windows opened by script. If this
      // page remains open, explain how to leave the browser/PWA explicitly.
      fallbackTimer.current = setTimeout(() => {
        if (!window.closed) setShowFallback(true);
      }, 250);
    }
  };

  return <>
    <button aria-label="관리센터 종료" className={styles.exitButton} onClick={requestExit} title="관리센터 종료" type="button">
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v9" /><path d="M6.2 6.2a8 8 0 1 0 11.6 0" /></svg>
    </button>
    {showFallback && <div className={styles.exitOverlay} onClick={() => setShowFallback(false)}>
      <section aria-labelledby="admin-exit-title" aria-modal="true" className={styles.exitDialog} onClick={event => event.stopPropagation()} role="dialog">
        <h2 id="admin-exit-title">관리센터 종료</h2>
        <p>브라우저가 이 창의 종료를 허용하지 않습니다. 브라우저 탭을 닫거나 앱 전환 화면에서 TDK 관리센터를 종료해 주세요.</p>
        <button autoFocus className={styles.exitConfirmButton} onClick={() => setShowFallback(false)} type="button">확인</button>
      </section>
    </div>}
  </>;
}
