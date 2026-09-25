(() => {
  if (location.pathname !== "/pos" || new URLSearchParams(location.search).get("touchDebug") !== "1") return;

  const mount = () => {
    if (document.getElementById("pos-native-touch-probe")) return;

    const panel = document.createElement("section");
    panel.id = "pos-native-touch-probe";
    panel.setAttribute("aria-label", "기본 HTML 터치 테스트");
    Object.assign(panel.style, {
      position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)",
      zIndex: "2147483647", width: "min(520px, calc(100vw - 24px))",
      boxSizing: "border-box", padding: "10px", border: "2px solid #2563eb",
      borderRadius: "10px", background: "#fff", color: "#111827",
      font: "13px Arial, sans-serif", boxShadow: "0 4px 16px #0003",
      pointerEvents: "auto", touchAction: "auto",
    });

    const title = document.createElement("div");
    title.textContent = "기본 HTML 터치 테스트 · 진단 v2 (POS와 독립)";
    title.style.fontWeight = "bold";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "기본 버튼 누르기: 0";
    Object.assign(button.style, {
      marginTop: "6px", padding: "8px 12px", border: "1px solid #2563eb",
      borderRadius: "6px", background: "#eff6ff", color: "#111827",
      font: "bold 14px Arial, sans-serif", touchAction: "auto", pointerEvents: "auto",
    });

    const eventStatus = document.createElement("span");
    eventStatus.textContent = " 입력: 없음";
    eventStatus.style.marginLeft = "8px";
    let count = 0;
    for (const type of ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "click"]) {
      button.addEventListener(type, () => {
        eventStatus.textContent = ` 입력: ${type}`;
        if (type === "click") button.textContent = `기본 버튼 누르기: ${++count}`;
      }, { passive: true });
    }

    const scroll = document.createElement("div");
    Object.assign(scroll.style, {
      width: "100%", height: "64px", boxSizing: "border-box", marginTop: "7px",
      overflowY: "auto", touchAction: "auto", overscrollBehavior: "auto",
      border: "1px solid #94a3b8", borderRadius: "4px", padding: "4px",
    });
    for (let index = 1; index <= 12; index++) {
      const row = document.createElement("div");
      row.textContent = `손가락으로 위아래 스크롤 · ${index}`;
      row.style.padding = "3px";
      scroll.appendChild(row);
    }

    const cssStatus = document.createElement("div");
    cssStatus.style.cssText = "margin-top:6px;font:10px monospace;line-height:1.25;white-space:pre-wrap;";
    const summarize = (name, element) => {
      if (!element) return `${name}: 없음`;
      const style = getComputedStyle(element);
      return `${name}: touch=${style.touchAction}, pointer=${style.pointerEvents}, over=${style.overflowX}/${style.overflowY}, pos=${style.position}, z=${style.zIndex}, overscroll=${style.overscrollBehavior}`;
    };
    const updateCss = () => {
      const pos = document.querySelector("main.h-dvh");
      const managementButton = document.querySelector('button[aria-label="관리"]');
      const rect = managementButton?.getBoundingClientRect();
      const topAtManagement = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
      cssStatus.textContent = [
        `maxTouchPoints=${navigator.maxTouchPoints}`,
        summarize("html", document.documentElement),
        summarize("body", document.body),
        summarize("root", pos?.parentElement),
        summarize("POS", pos),
        summarize("test scroll", scroll),
        `관리 버튼 위치의 최상단 요소: ${topAtManagement?.tagName.toLowerCase() ?? "없음"}${topAtManagement?.getAttribute("aria-label") ? ` · ${topAtManagement.getAttribute("aria-label")}` : ""}`,
      ].join("\n");
    };

    panel.append(title, button, eventStatus, scroll, cssStatus);
    document.body.appendChild(panel);
    updateCss();
    window.setTimeout(updateCss, 1000);

    const routeCheck = window.setInterval(() => {
      if (location.pathname === "/pos" && new URLSearchParams(location.search).get("touchDebug") === "1") return;
      panel.remove();
      window.clearInterval(routeCheck);
    }, 500);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
