/**
 * screen-selector.js
 * Injected into the active tab when the user clicks "Screenshot".
 * Draws a fullscreen overlay; user drags to pick a region.
 * Sends coordinates back to the background service worker on mouseup.
 */
(function () {
  "use strict";

  // Prevent double-injection
  if (document.getElementById("ocr-sel-overlay")) return;

  /* ---- Overlay ---- */
  const overlay = document.createElement("div");
  overlay.id = "ocr-sel-overlay";
  Object.assign(overlay.style, {
    position:   "fixed",
    inset:      "0",
    zIndex:     "2147483647",
    cursor:     "crosshair",
    userSelect: "none",
    background: "rgba(0,0,0,0.35)",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  });

  /* ---- Selection box ---- */
  const selBox = document.createElement("div");
  selBox.id = "ocr-sel-box";
  Object.assign(selBox.style, {
    position:   "fixed",
    display:    "none",
    border:     "2px solid #6366f1",
    background: "rgba(99,102,241,0.08)",
    boxSizing:  "border-box",
    pointerEvents: "none",
  });

  /* ---- Corner handles ---- */
  const cornerStyle = {
    position: "absolute",
    width:    "8px",
    height:   "8px",
    background: "#6366f1",
    borderRadius: "2px",
  };
  const corners = [
    { top: "-4px", left: "-4px" },
    { top: "-4px", right: "-4px" },
    { bottom: "-4px", left: "-4px" },
    { bottom: "-4px", right: "-4px" },
  ].map((pos) => {
    const c = document.createElement("div");
    Object.assign(c.style, cornerStyle, pos);
    return c;
  });
  corners.forEach((c) => selBox.appendChild(c));

  /* ---- Dimensions label ---- */
  const dimLabel = document.createElement("div");
  Object.assign(dimLabel.style, {
    position:   "absolute",
    bottom:     "calc(100% + 6px)",
    left:       "0",
    background: "#0f172a",
    color:      "#e2e8f0",
    fontSize:   "11px",
    fontWeight: "700",
    padding:    "3px 7px",
    borderRadius: "4px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    border: "1px solid #334155",
  });
  selBox.appendChild(dimLabel);

  /* ---- Hint banner ---- */
  const hint = document.createElement("div");
  hint.id = "ocr-sel-hint";
  hint.textContent = "Drag to select a region  \u00b7  Esc to cancel";
  Object.assign(hint.style, {
    position:   "fixed",
    top:        "14px",
    left:       "50%",
    transform:  "translateX(-50%)",
    background: "#0f172a",
    color:      "#f1f5f9",
    fontSize:   "13px",
    fontWeight: "600",
    padding:    "9px 18px",
    borderRadius: "10px",
    boxShadow:  "0 4px 20px rgba(0,0,0,0.5)",
    border:     "1px solid #334155",
    pointerEvents: "none",
    zIndex:     "2147483647",
    whiteSpace: "nowrap",
  });

  overlay.appendChild(selBox);
  overlay.appendChild(hint);
  document.body.appendChild(overlay);

  /* ---- State ---- */
  let startX = 0, startY = 0, isDragging = false;

  function cleanup() {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  }

  /* ---- Mouse events ---- */
  overlay.addEventListener("mousedown", (e) => {
    e.preventDefault();
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    Object.assign(selBox.style, {
      left:    startX + "px",
      top:     startY + "px",
      width:   "0px",
      height:  "0px",
      display: "block",
    });
    dimLabel.textContent = "0 \u00d7 0";
    hint.textContent = "Release to capture";
  });

  overlay.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    Object.assign(selBox.style, {
      left:   x + "px",
      top:    y + "px",
      width:  w + "px",
      height: h + "px",
    });
    dimLabel.textContent = `${Math.round(w)} \u00d7 ${Math.round(h)}`;
  });

  overlay.addEventListener("mouseup", (e) => {
    if (!isDragging) return;
    isDragging = false;

    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    if (w < 8 || h < 8) {
      hint.textContent = "Selection too small \u2014 try again or press Esc";
      selBox.style.display = "none";
      isDragging = false;
      return;
    }

    // Flash selection before closing
    selBox.style.background = "rgba(99,102,241,0.25)";

    setTimeout(() => {
      cleanup();
      chrome.runtime.sendMessage({
        action:          "screenshot-region-selected",
        x:               Math.round(x),
        y:               Math.round(y),
        width:           Math.round(w),
        height:          Math.round(h),
        devicePixelRatio: window.devicePixelRatio || 1,
      });
    }, 80);
  });

  /* ---- Keyboard: Esc to cancel ---- */
  function onKeydown(e) {
    if (e.key === "Escape") {
      cleanup();
      chrome.runtime.sendMessage({ action: "screenshot-cancelled" });
    }
  }
  document.addEventListener("keydown", onKeydown);
})();
