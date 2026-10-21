// =============================================
// Content Script
// Handles context-menu OCR trigger on page images
// =============================================

(function () {
  "use strict";

  // Listen for messages from the background service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "ocr-from-context-menu") {
      handleContextMenuOcr(message.imageUrl);
    }
  });

  async function handleContextMenuOcr(imageUrl) {
    // Show toast notification on the page
    showToast("⏳ Extracting text from image...", "info");

    try {
      // Get API key from chrome storage
      const { ocrApiKey } = await chrome.storage.local.get("ocrApiKey");

      if (!ocrApiKey) {
        showToast("❌ No API key found. Open the extension popup to set your OCR.space API key.", "error");
        return;
      }

      // Send to background for OCR
      chrome.runtime.sendMessage(
        { action: "perform-ocr-url", imageUrl, apiKey: ocrApiKey },
        (response) => {
          if (chrome.runtime.lastError) {
            showToast("❌ Error: " + chrome.runtime.lastError.message, "error");
            return;
          }
          if (response && response.success) {
            // Copy to clipboard
            navigator.clipboard.writeText(response.text).then(() => {
              showToast("✅ Text copied to clipboard!", "success");
              showResultPanel(response.text);
            }).catch(() => {
              showToast("✅ OCR done! (Clipboard copy failed — see panel)", "success");
              showResultPanel(response.text);
            });
          } else {
            showToast("❌ OCR Failed: " + (response?.error || "Unknown error"), "error");
          }
        }
      );
    } catch (err) {
      showToast("❌ Error: " + err.message, "error");
    }
  }

  // ----- Toast Notification -----
  function showToast(message, type) {
    // Remove existing toast
    const existing = document.getElementById("ocr-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "ocr-toast";
    toast.className = `ocr-toast ocr-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Auto-remove after 4 seconds
    setTimeout(() => toast.remove(), 4000);
  }

  // ----- Result Panel -----
  function showResultPanel(text) {
    const existing = document.getElementById("ocr-result-panel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "ocr-result-panel";
    panel.className = "ocr-result-panel";
    panel.innerHTML = `
      <div class="ocr-panel-header">
        <span>📄 OCR Result</span>
        <div class="ocr-panel-actions">
          <button id="ocr-copy-btn" class="ocr-btn ocr-btn--primary">Copy</button>
          <button id="ocr-close-btn" class="ocr-btn ocr-btn--secondary">✕</button>
        </div>
      </div>
      <textarea id="ocr-result-text" class="ocr-result-textarea" spellcheck="false">${escapeHtml(text)}</textarea>
    `;
    document.body.appendChild(panel);

    document.getElementById("ocr-copy-btn").addEventListener("click", () => {
      const textarea = document.getElementById("ocr-result-text");
      navigator.clipboard.writeText(textarea.value).then(() => {
        showToast("✅ Copied to clipboard!", "success");
      });
    });

    document.getElementById("ocr-close-btn").addEventListener("click", () => {
      panel.remove();
    });
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
