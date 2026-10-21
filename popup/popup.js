/**
 * popup.js
 * Main popup controller — manages API key setup, image input,
 * OCR execution, clipboard operations, and UI state.
 *
 * API key: stored in chrome.storage.local so it persists across
 * popup open/close cycles and browser restarts. Only the user can
 * clear it by clicking ⚙️ → change key.
 * Temporary data (pending screenshot) uses chrome.storage.session.
 */

import { ocrFromUrl, ocrFromBase64, blobToBase64 } from "../ocr/ocr-service.js";

// ---- State ----
let currentBlob = null;
let currentUrl  = null;
let isLoading   = false;

// ---- Accepted image MIME types ----
const ACCEPTED_TYPES = [
  "image/png", "image/jpeg", "image/jpg", "image/webp",
  "image/bmp", "image/gif", "image/tiff", "image/avif",
];

// ---- DOM ----
const setupScreen     = document.getElementById("setup-screen");
const mainScreen      = document.getElementById("main-screen");
const apiKeyInput     = document.getElementById("api-key-input");
const toggleKeyBtn    = document.getElementById("toggle-key-visibility");
const saveKeyBtn      = document.getElementById("save-key-btn");
const setupError      = document.getElementById("setup-error");
const settingsBtn     = document.getElementById("settings-btn");

const dropZone        = document.getElementById("drop-zone");
const dropPlaceholder = document.getElementById("drop-zone-placeholder");
const previewImg      = document.getElementById("preview-img");
const fileInput       = document.getElementById("file-input");

const uploadBtn       = document.getElementById("upload-btn");
const screenshotBtn   = document.getElementById("screenshot-btn");
// NOTE: paste-btn removed per requirements

const ocrBtn          = document.getElementById("ocr-btn");
const ocrBtnText      = document.getElementById("ocr-btn-text");
const ocrBtnSpinner   = document.getElementById("ocr-btn-spinner");

const statusMsg       = document.getElementById("status-msg");
const resultSection   = document.getElementById("result-section");
const resultTextarea  = document.getElementById("result-textarea");
const copyResultBtn   = document.getElementById("copy-result-btn");
const clearBtn        = document.getElementById("clear-btn");

// =============================================
// INIT
// Check for API key and any pending screenshot
// result stored by the background service worker.
// If a pending screenshot exists, load it and
// automatically run OCR without user interaction.
// =============================================
async function init() {
  const stored = await chrome.storage.session.get([
    "pendingScreenshot",
    "screenshotError",
  ]);

  // API key lives in local storage — persists across popup close/open
  const { ocrApiKey } = await chrome.storage.local.get("ocrApiKey");

  if (!ocrApiKey) {
    showScreen("setup");
    return;
  }

  showScreen("main");

  // Clear badge indicator
  chrome.action.setBadgeText({ text: "" });

  // A screenshot region was captured while popup was closed — auto-OCR it
  if (stored.pendingScreenshot) {
    await chrome.storage.session.remove(["pendingScreenshot", "screenshotError"]);
    showStatus("⏳ Screenshot captured — running OCR…", "info");
    await loadImageDataUrlAndOcr(stored.pendingScreenshot, ocrApiKey);
    return;
  }

  if (stored.screenshotError) {
    await chrome.storage.session.remove("screenshotError");
    showStatus("❌ " + stored.screenshotError, "error");
  }
}

// =============================================
// SCREEN MANAGEMENT
// =============================================
function showScreen(name) {
  setupScreen.classList.add("hidden");
  mainScreen.classList.add("hidden");
  if (name === "setup") setupScreen.classList.remove("hidden");
  if (name === "main")  mainScreen.classList.remove("hidden");
}

// =============================================
// API KEY SETUP
// =============================================
saveKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showSetupError("Please enter a valid API key.");
    return;
  }
  setupError.classList.add("hidden");
  await chrome.storage.local.set({ ocrApiKey: key });
  showScreen("main");
  showStatus("✅ API key saved. It will be remembered until you clear it via ⚙️.", "success");
});

toggleKeyBtn.addEventListener("click", () => {
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
  toggleKeyBtn.textContent = apiKeyInput.type === "password" ? "👁" : "🙈";
});

settingsBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("ocrApiKey");
  apiKeyInput.value = "";
  currentBlob = null;
  currentUrl  = null;
  resetUI();
  showScreen("setup");
});

function showSetupError(msg) {
  setupError.textContent = msg;
  setupError.className = "status-msg status-msg--error";
  setupError.classList.remove("hidden");
}

// =============================================
// IMAGE INPUT — FILE UPLOAD (all image types)
// =============================================
uploadBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!ACCEPTED_TYPES.includes(file.type) && !file.type.startsWith("image/")) {
    showStatus("⚠️ Unsupported file type. Please select an image (PNG, JPG, WEBP, BMP, etc.)", "warning");
    fileInput.value = "";
    return;
  }

  loadImageBlob(file);
  fileInput.value = ""; // allow re-selecting same file
});

// =============================================
// IMAGE INPUT — DRAG & DROP
// =============================================
dropZone.addEventListener("click", () => {
  if (!previewImg.classList.contains("hidden")) return;
  fileInput.click();
});

dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");

  const file = e.dataTransfer.files?.[0];
  if (file && file.type.startsWith("image/")) {
    loadImageBlob(file);
  } else {
    showStatus("⚠️ Please drop an image file (PNG, JPG, WEBP, BMP…)", "warning");
  }
});

// =============================================
// SCREENSHOT OCR
//
// Flow:
//   1. User clicks "Screenshot OCR"
//   2. Popup sends message to background to inject
//      the region-selection overlay (screen-selector.js)
//   3. Popup closes so the user can drag on the page
//   4. User selects a rectangle on the page
//   5. Background captures the full tab, crops to region,
//      and stores the cropped PNG in session storage
//   6. Background opens popup (Chrome 127+) or sets badge
//   7. init() reads pendingScreenshot and auto-runs OCR
//   8. Extracted text is shown and auto-copied to clipboard
// =============================================
screenshotBtn.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      showStatus("❌ Cannot access the current tab.", "error");
      return;
    }

    // Pages where content-script injection is not allowed
    const blockedPrefixes = ["chrome://", "chrome-extension://", "edge://", "about:", "data:"];
    if (blockedPrefixes.some((p) => tab.url?.startsWith(p))) {
      showStatus(
        "⚠️ Screenshot OCR requires a normal web page. Please navigate to a website first.",
        "warning"
      );
      return;
    }

    showStatus("📷 Drag to select a region on the page…", "info");

    // Tell background to inject the selection overlay
    chrome.runtime.sendMessage(
      { action: "start-screenshot-selection", tabId: tab.id },
      (resp) => {
        if (chrome.runtime.lastError || !resp?.success) {
          showStatus(
            "❌ Could not start region selector: " +
            (resp?.error || chrome.runtime.lastError?.message || "Unknown error"),
            "error"
          );
          return;
        }
        // Close popup — user must interact with the page to drag a region
        window.close();
      }
    );
  } catch (err) {
    showStatus("❌ " + err.message, "error");
  }
});

// =============================================
// IMAGE LOADERS
// =============================================

/** Load a File/Blob into the preview and enable the OCR button. */
function loadImageBlob(blob) {
  currentUrl  = null;
  currentBlob = blob;
  if (previewImg.src.startsWith("blob:")) URL.revokeObjectURL(previewImg.src);
  setPreview(URL.createObjectURL(blob));
  ocrBtn.disabled = false;
  clearResults();
}

/**
 * Load a data-URL, convert to Blob, show preview,
 * then immediately run OCR (used by the screenshot flow).
 */
async function loadImageDataUrlAndOcr(dataUrl, apiKey) {
  try {
    const blob = await fetch(dataUrl).then((r) => r.blob());
    currentUrl  = null;
    currentBlob = blob;
    setPreview(dataUrl);
    ocrBtn.disabled = false;
    clearResults();
    // Automatically extract text — no extra button click required
    await runOcr(apiKey);
  } catch (err) {
    showStatus("❌ Failed to process screenshot: " + err.message, "error");
  }
}

function setPreview(src) {
  previewImg.src = src;
  previewImg.classList.remove("hidden");
  dropPlaceholder.classList.add("hidden");
}

// =============================================
// OCR EXECUTION
// =============================================

/** Core OCR runner — called by the manual button and the auto-OCR path. */
async function runOcr(apiKey) {
  if (isLoading) return;

  if (!apiKey) {
    const stored = await chrome.storage.local.get("ocrApiKey");
    apiKey = stored.ocrApiKey;
  }

  if (!apiKey) {
    showStatus("❌ No API key. Click ⚙️ to set your OCR.space API key.", "error");
    return;
  }

  if (!currentBlob && !currentUrl) {
    showStatus("⚠️ Please load an image first.", "warning");
    return;
  }

  setLoading(true);
  showStatus("⏳ Running OCR… This may take a few seconds.", "info");

  try {
    let text;

    if (currentBlob) {
      const { base64, mimeType } = await blobToBase64(currentBlob);
      text = await ocrFromBase64(base64, mimeType, apiKey);
    } else {
      text = await ocrFromUrl(currentUrl, apiKey);
    }

    resultTextarea.value = text;
    resultSection.classList.remove("hidden");

    // Auto-copy extracted text to clipboard
    try {
      await navigator.clipboard.writeText(text);
      showStatus("✅ Text extracted and copied to clipboard!", "success");
    } catch (_) {
      showStatus("✅ Text extracted! (Auto-copy blocked — use the Copy button)", "success");
    }
  } catch (err) {
    showStatus("❌ OCR Failed: " + err.message, "error");
  } finally {
    setLoading(false);
  }
}

/** Manual OCR button click */
ocrBtn.addEventListener("click", () => runOcr(null));

// =============================================
// RESULT ACTIONS
// =============================================
copyResultBtn.addEventListener("click", async () => {
  const text = resultTextarea.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copyResultBtn.textContent = "✅ Copied!";
  } catch (_) {
    // Fallback: select all text in textarea
    resultTextarea.select();
    document.execCommand("copy");
    copyResultBtn.textContent = "✅ Copied!";
  }
  setTimeout(() => (copyResultBtn.textContent = "Copy"), 1800);
});

clearBtn.addEventListener("click", () => {
  resetUI();
  showStatus("🗑️ Cleared.", "info");
  setTimeout(() => statusMsg.classList.add("hidden"), 1800);
});

// =============================================
// HELPERS
// =============================================
function showStatus(message, type) {
  statusMsg.textContent = message;
  statusMsg.className = `status-msg status-msg--${type}`;
  statusMsg.classList.remove("hidden");
}

function clearResults() {
  resultTextarea.value = "";
  resultSection.classList.add("hidden");
  statusMsg.classList.add("hidden");
}

function resetUI() {
  currentBlob = null;
  currentUrl  = null;
  if (previewImg.src.startsWith("blob:")) URL.revokeObjectURL(previewImg.src);
  previewImg.src = "";
  previewImg.classList.add("hidden");
  dropPlaceholder.classList.remove("hidden");
  ocrBtn.disabled = true;
  clearResults();
}

function setLoading(state) {
  isLoading = state;
  ocrBtn.disabled = state;
  ocrBtnText.classList.toggle("hidden", state);
  ocrBtnSpinner.classList.toggle("hidden", !state);
}

// =============================================
// START
// =============================================
init();
