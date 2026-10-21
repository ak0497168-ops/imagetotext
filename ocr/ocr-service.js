/**
 * ocr-service.js
 * Shared helper module — relays OCR messages to the background service worker.
 * This module never holds or transmits the API key itself.
 *
 * Clipboard image reading is handled directly in popup.js using the
 * ClipboardEvent `paste` and navigator.clipboard.read() APIs,
 * which are more reliable in the popup context.
 */

/**
 * Run OCR on a public image URL via the background service worker.
 * @param {string} imageUrl  - Publicly accessible image URL
 * @param {string} apiKey    - OCR.space API key (passed through to background)
 * @returns {Promise<string>} Extracted text
 */
export async function ocrFromUrl(imageUrl, apiKey) {
  return sendOcrMessage({ action: "perform-ocr-url", imageUrl, apiKey });
}

/**
 * Run OCR on a base64-encoded image via the background service worker.
 * @param {string} base64   - Raw base64 string (no data URI prefix)
 * @param {string} mimeType - MIME type, e.g. "image/png"
 * @param {string} apiKey   - OCR.space API key
 * @returns {Promise<string>} Extracted text
 */
export async function ocrFromBase64(base64, mimeType, apiKey) {
  return sendOcrMessage({ action: "perform-ocr-base64", base64, mimeType, apiKey });
}

/**
 * Convert a File or Blob to a base64 string + MIME type object.
 * Works with all image types: PNG, JPEG, WEBP, BMP, GIF, TIFF, AVIF.
 *
 * @param {File|Blob} blob
 * @returns {Promise<{base64: string, mimeType: string}>}
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    if (!blob || blob.size === 0) {
      reject(new Error("Empty or invalid image blob."));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = reader.result; // "data:image/png;base64,XXXXX"
      const commaIdx = dataUrl.indexOf(",");
      if (commaIdx === -1) {
        reject(new Error("Invalid data URL from FileReader."));
        return;
      }
      const header   = dataUrl.slice(0, commaIdx);       // "data:image/png;base64"
      const base64   = dataUrl.slice(commaIdx + 1);       // "XXXXX..."
      const mimeMatch = header.match(/:(.*?);/);
      const mimeType = mimeMatch ? mimeMatch[1] : (blob.type || "image/png");
      resolve({ base64, mimeType });
    };

    reader.onerror = () => reject(new Error("Failed to read image file — it may be corrupt or unsupported."));
    reader.readAsDataURL(blob);
  });
}

// ---- Internal helper ----
function sendOcrMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.success) {
        resolve(response.text);
      } else {
        reject(new Error(response?.error || "Unknown OCR error."));
      }
    });
  });
}
