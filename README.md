# OCR Image Text Extractor — Chrome Extension

A lightweight Manifest V3 Chrome extension that extracts text from images using the **OCR.space API**. No backend required. Your API key is stored only in session memory and is never persisted.

---

## Features

| Feature | Details |
|---------|---------|
| 🖼️ Upload / Drop image | Pick a file or drag-and-drop onto the popup |
| 📋 Paste from clipboard | Paste a copied screenshot or image directly |
| 📷 Screenshot | Capture the current tab and run OCR on it |
| 🖱️ Right-click OCR | Right-click any `<img>` on a webpage → **OCR Image Text** |
| 📄 Editable result | Extracted text appears in an editable textarea |
| 📎 Auto-copy | Text is automatically copied to the clipboard after OCR |
| 🔑 API Key prompt | First-run screen asks for your OCR.space key — nothing is hard-coded |
| 🔒 Session-only storage | Key lives in `chrome.storage.session` — cleared on browser close |
| 🗑️ Clear all | One-click clear removes image, result, and status — no data retained |

---

## Project Structure

```
photointotext/
├── manifest.json                  # MV3 manifest
├── generate_icons.py              # One-time icon generator
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── background/
│   └── service-worker.js          # Context menu + OCR.space API calls
├── content/
│   ├── content-script.js          # Right-click OCR + page toast/panel
│   └── content-style.css          # Injected styles (toast, result panel)
├── ocr/
│   └── ocr-service.js             # OCR helper (base64, URL, clipboard read)
└── popup/
    ├── popup.html                 # Popup UI (two screens)
    ├── popup.css                  # Dark-themed styles
    └── popup.js                   # Popup controller
```

---

## Installation

1. **Clone / download** this folder.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle top-right).
4. Click **Load unpacked** and select the `photointotext/` folder.
5. Click the extension icon in the toolbar.

---

## Getting an OCR.space API Key

1. Visit [https://ocr.space/ocrapi](https://ocr.space/ocrapi)
2. Sign up for a **free** account (500 requests/month on free tier).
3. Copy your API key.
4. On first run of the extension, paste the key into the setup screen.

> The key is stored in `chrome.storage.session` only — it is **never** written to disk, synced, or sent anywhere except the OCR.space API endpoint.

---

## How It Works

```
User action
   │
   ├─ File / Drop / Paste / Screenshot  →  Blob loaded in popup
   │                                        │
   │                                        ▼
   │                                   blobToBase64()
   │                                        │
   └─ Right-click image on page        ─────┤
                                            ▼
                              chrome.runtime.sendMessage
                                            │
                                            ▼
                               background/service-worker.js
                                            │
                                            ▼
                               POST → api.ocr.space/parse/image
                                            │
                                            ▼
                              ParsedText  returned
                                            │
                               ┌────────────┴──────────────┐
                               │                           │
                          Popup result              Page toast + panel
                      textarea + clipboard          clipboard + panel
```

---

## Permissions Used

| Permission | Reason |
|------------|--------|
| `contextMenus` | Adds "OCR Image Text" to right-click menu |
| `clipboardRead` | Reads images pasted from clipboard |
| `clipboardWrite` | Auto-copies extracted text to clipboard |
| `activeTab` | Captures tab screenshot |
| `scripting` | Injects content script programmatically if needed |
| `storage` | Stores API key in session storage |
| `https://api.ocr.space/*` | Makes OCR API requests from the service worker |

---

## Notes

- OCR Engine 2 (paid) is used by default for better accuracy. If you have a free key, OCR Engine 1 will be automatically selected by OCR.space.
- Images are sent as Base64 directly to OCR.space — no intermediate server.
- The API key is **never** exposed to web pages or content scripts.
