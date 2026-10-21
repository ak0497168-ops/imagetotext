// =============================================
// Background / Service Worker
// Handles: context menu, OCR API calls,
//          screenshot region selection + crop
// =============================================

// ----- Context Menu Setup -----
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "ocr-image-text",
    title: "OCR Image Text",
    contexts: ["image"],
  });
});

// ----- Context Menu Click -----
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ocr-image-text") {
    chrome.tabs.sendMessage(tab.id, {
      action: "ocr-from-context-menu",
      imageUrl: info.srcUrl,
    });
  }
});

// ----- Message Listener -----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── OCR via URL ──────────────────────────────
  if (message.action === "perform-ocr-url") {
    handleOcrFromUrl(message.imageUrl, message.apiKey)
      .then((result) => sendResponse({ success: true, text: result }))
      .catch((err)   => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ── OCR via Base64 ───────────────────────────
  if (message.action === "perform-ocr-base64") {
    handleOcrFromBase64(message.base64, message.mimeType, message.apiKey)
      .then((result) => sendResponse({ success: true, text: result }))
      .catch((err)   => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ── Start region-selection screenshot ────────
  if (message.action === "start-screenshot-selection") {
    const tabId = message.tabId;
    // Inject the selector overlay into the active tab
    chrome.scripting.executeScript(
      { target: { tabId }, files: ["content/screen-selector.js"] },
      () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true });
        }
      }
    );
    return true;
  }

  // ── Region selected — capture + crop ─────────
  if (message.action === "screenshot-region-selected") {
    const { x, y, width, height, devicePixelRatio } = message;
    const tabId = sender.tab?.id;

    if (!tabId) {
      // Can't determine tab — nothing to do
      return false;
    }

    // 1. Capture the full visible tab
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, async (dataUrl) => {
      if (chrome.runtime.lastError) {
        await chrome.storage.session.set({
          pendingScreenshot: null,
          screenshotError: "Capture failed: " + chrome.runtime.lastError.message,
        });
        return;
      }

      try {
        // 2. Crop to selected region using OffscreenCanvas
        const croppedDataUrl = await cropScreenshot(dataUrl, x, y, width, height, devicePixelRatio);

        // 3. Store for popup to pick up on next open
        await chrome.storage.session.set({
          pendingScreenshot: croppedDataUrl,
          screenshotError: null,
        });

        // 4. Try to open the popup (Chrome 127+)
        try {
          await chrome.action.openPopup();
        } catch (_) {
          // Fallback: set badge so user knows to click the icon
          chrome.action.setBadgeText({ text: "1" });
          chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
        }
      } catch (err) {
        await chrome.storage.session.set({
          pendingScreenshot: null,
          screenshotError: "Crop failed: " + err.message,
        });
      }
    });

    return false; // no sendResponse needed
  }

  // ── Screenshot cancelled ──────────────────────
  if (message.action === "screenshot-cancelled") {
    chrome.action.setBadgeText({ text: "" });
    return false;
  }
});

// =============================================
// Screenshot Crop (OffscreenCanvas)
// =============================================
async function cropScreenshot(dataUrl, x, y, w, h, dpr) {
  // Fetch the PNG data URL as a Blob then create an ImageBitmap
  const resp   = await fetch(dataUrl);
  const blob   = await resp.blob();
  const bitmap = await createImageBitmap(blob);

  // Scale coordinates by device pixel ratio
  const sx = Math.round(x * dpr);
  const sy = Math.round(y * dpr);
  const sw = Math.round(w * dpr);
  const sh = Math.round(h * dpr);

  // Clamp to bitmap bounds
  const clampedSx = Math.max(0, Math.min(sx, bitmap.width  - 1));
  const clampedSy = Math.max(0, Math.min(sy, bitmap.height - 1));
  const clampedSw = Math.min(sw, bitmap.width  - clampedSx);
  const clampedSh = Math.min(sh, bitmap.height - clampedSy);

  const canvas = new OffscreenCanvas(clampedSw, clampedSh);
  const ctx    = canvas.getContext("2d");
  ctx.drawImage(bitmap, clampedSx, clampedSy, clampedSw, clampedSh, 0, 0, clampedSw, clampedSh);

  const croppedBlob = await canvas.convertToBlob({ type: "image/png" });

  // Convert blob → base64 data URL
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to convert cropped image"));
    reader.readAsDataURL(croppedBlob);
  });
}

// =============================================
// OCR via URL
// =============================================
async function handleOcrFromUrl(imageUrl, apiKey) {
  if (!apiKey) throw new Error("No API key set. Please enter your OCR.space API key in the extension popup.");

  const formData = new FormData();
  formData.append("url", imageUrl);
  formData.append("apikey", apiKey);
  formData.append("language", "eng");
  formData.append("isOverlayRequired", "false");
  formData.append("detectOrientation", "true");
  formData.append("scale", "true");
  formData.append("OCREngine", "2");

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) throw new Error(`OCR API HTTP error: ${response.status}`);
  return parseOcrResponse(await response.json());
}

// =============================================
// OCR via Base64
// =============================================
async function handleOcrFromBase64(base64, mimeType, apiKey) {
  if (!apiKey) throw new Error("No API key set. Please enter your OCR.space API key in the extension popup.");

  const formData = new FormData();
  formData.append("base64Image", `data:${mimeType};base64,${base64}`);
  formData.append("apikey", apiKey);
  formData.append("language", "eng");
  formData.append("isOverlayRequired", "false");
  formData.append("detectOrientation", "true");
  formData.append("scale", "true");
  formData.append("OCREngine", "2");

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) throw new Error(`OCR API HTTP error: ${response.status}`);
  return parseOcrResponse(await response.json());
}

// =============================================
// Parse OCR.space Response
// =============================================
function parseOcrResponse(data) {
  if (data.IsErroredOnProcessing) {
    const errMsg = data.ErrorMessage
      ? (Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(" ") : data.ErrorMessage)
      : "Unknown OCR processing error.";
    throw new Error(errMsg);
  }

  if (!data.ParsedResults || data.ParsedResults.length === 0) {
    throw new Error("No text found in the image.");
  }

  const text = data.ParsedResults
    .map((r) => r.ParsedText)
    .join("\n")
    .trim();

  if (!text) throw new Error("No readable text detected in the image.");
  return text;
}
