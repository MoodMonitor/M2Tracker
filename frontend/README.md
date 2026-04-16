<div align="center">
  <a href="../"><b>⬅️ Back to Main M2Tracker Repository</b></a>
  <br><br>
  <a href="https://m2tracker.pages.dev/" target="_blank">
    <img src="https://img.shields.io/badge/🚀_LAUNCH_LIVE_DEMO-m2tracker.pages.dev-4f46e5?style=for-the-badge" alt="Launch Live Demo" />
  </a>
</div>

<br>

# 🚀 M2Tracker Frontend

A premium-grade platform for advanced **private Metin2 server market analysis**. The project is a modern SPA (Single Page Application) built with React 18 + TypeScript, combining a responsive user interface with an exceptional focus on **security, anti-scraping protection, and AI fully running in the browser**.

---

## 📌 Table of Contents

- [Main Features](#-main-features)
- [Security and Anti-Scraping Architecture](#%EF%B8%8F-security-and-anti-scraping-architecture)
  - [1. Web Worker - Key Isolation and Cryptography](#1-web-worker---key-isolation-and-cryptography)
  - [2. OffscreenCanvas - Charts Invisible to Bots](#2-offscreencanvas---charts-invisible-to-bots)
- [AI Calculator - In-Browser Inventory Analysis](#-ai-calculator---in-browser-inventory-analysis)
- [Dashboard - Analytics Components](#-dashboard---analytics-components)
- [Demo Mode and Mocking System](#-demo-mode-and-mocking-system)
- [Technology Stack](#-technology-stack)
- [Local Setup](#-local-setup)

---

## ✨ Main Features

- **Server Dashboards** - Advanced market dashboards with price/quantity charts, 24h statistics, and item history.
- **Items Table** - Searchable table with bonus filters, sorting, and pagination.
- **Profit Calculator** - Quick profit estimation for potential market investments.
- **AI Calculator** - Player inventory screenshot analysis with automatic item recognition and market valuation.
- **Server Voting** - Voting system for new servers secured by Cloudflare Turnstile.
- **FAQ and News Section** - Dynamically loaded news and questions from the backend.

---

## 🛡️ Security and Anti-Scraping Architecture

The biggest challenge for analytics platforms is protecting data against unauthorized bots and scrapers. M2Tracker uses a three-layer defense model where each layer complements the others.

### 1. Web Worker - Key Isolation and Cryptography

**Location:** `src/webWorker/`

Instead of keeping authentication logic and cryptographic keys in the browser main thread (which is accessible to extensions, devtools, and page JS scripts), this entire responsibility has been moved into a dedicated **Web Worker**.

#### How it works:

```
Main thread (React UI)
        │
        │  postMessage({ type: 'FETCH_API', ... }, [port2])
        ▼
┌───────────────────────────────────────────┐
│            Web Worker (worker.ts)         │
│                                           │
│  [X25519 ECDH keys never leave            │
│   this context!]                          │
│                                           │
│  • Generates X25519 key pair              │
│  • Performs ECDH + HKDF -> AES-GCM key    │
│  • Signs requests with HMAC-SHA256        │
│  • Executes fetch() with signed headers   │
│                                           │
└───────────────────────────────────────────┘
        │
        │  port.postMessage({ type: 'FETCH_API_SUCCESS', data })
        ▼
Main thread (React UI) - receives data only
```

#### Key security mechanisms:

| File | Role |
|------|------|
| `worker.ts` | Main dispatcher - validates message types against a whitelist and verifies script path integrity at startup |
| `session.ts` | Manages dashboard and chart sessions separately; X25519 ECDH keys are generated and stored **only** inside the worker |
| `webWorkerManager.ts` | Main-thread proxy; each request creates a separate `MessageChannel` with timeout - response is delivered only to the correct callback |
| `mainApiHandler.ts` | Signs requests with HMAC-SHA-256 using the active session `keySig` key, then executes `fetch()` |
| `apiHandlers.ts` | Handles item search and price history via Worker |

**Why it matters:** Session keys (`keyEnc`, `keySig`) and AI model decryption keys (`aiAssetsDecryptionKey`) **never leave the worker context**. Even if an attacker injects malicious JS into the page, they cannot read these keys via `window`, `globalThis`, or any other API available in the main thread.

---

### 2. OffscreenCanvas - Charts Invisible to Bots

**Location:** `src/components/dashboard/lineAndBarChartHandler.ts`

Standard chart libraries (for example Chart.js, Recharts) build SVG or Canvas structures directly in the DOM, where price and history text can be extracted with a single `querySelectorAll` call. M2Tracker uses a completely different approach.

#### "Ghost Chart" architecture:

```
Backend -> encrypted data (AES-GCM, per-point IV)
         │
         │  postMessage('addEncryptedData', ...)
         ▼
┌──────────────────────────────────────────────────┐
│                  Web Worker                      │
│                                                  │
│  1. Decrypts each point (AES-GCM)                │
│  2. Computes statistics and scales (Pass 1)      │
│  3. Converts to pixel positions (Pass 2)         │
│  4. Renders on OffscreenCanvas via ZRender       │
│                                                  │
└──────────────────────────────────────────────────┘
         │
         │  Bitmap (transferred as Transferable)
         ▼
Browser - sees pixel-only image
```

#### Why a scraper cannot extract anything:

- **Raw price data never reaches the DOM** - it is stored only in an encrypted queue (`animationQueue`) inside the worker.
- `SecureDataStats` stores only aggregated statistics and **pixel positions** (for example `{ x: 214, y: 87 }`), never raw numeric values ready for scraping.
- Tooltip hover decrypts exactly one point on demand, and data is one-shot - it is not written into React component state.
- A bot inspecting the DOM sees only a `<canvas>` element without any price `data-*` attributes.

---

## 🤖 AI Calculator - In-Browser Inventory Analysis

**Location:** `src/components/dashboard/calculator_ai/` + `src/webWorker/aiProcessor.ts`

The AI Calculator allows a player to paste or upload an inventory screenshot, and the app automatically identifies each item and fetches its current market value - **without uploading the screenshot to a server for analysis**.

### ML pipeline (entirely in a Web Worker):

```
[Player screenshot - PNG/JPG, max 800x800 px]
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  1. SLOT DETECTION (YOLO - yolo.onnx)               │
│                                                     │
│  • Output: list of bounding boxes in original coords│
└─────────────────────────────────────────────────────┘
         │ Crop each ROI, resize to 32x32
         ▼
┌────────────────────────────────────────────────────┐
│  2. ICON RECOGNITION (CNN - cnn.onnx)             │
│                                                    │
│  • Output: list of suggestions (itemId, name, score) |
└────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────┐
│  3. QUANTITY READING (Template Matching / OCR)    │
│                                                    │
│  • Output: item quantity for each slot            │
└────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────┐
│  4. MARKET VALUATION (API with signed request)    │
│                                                    │
│  • Output: unit price x quantity = total value    │
└────────────────────────────────────────────────────┘
```

### AI model security:

ONNX models and the embeddings database are **served in encrypted form (AES-GCM)**. Before use, the Worker fetches a decryption key from the backend using an active ECDH session and decrypts models locally. The `aiAssetsDecryptionKey` is cached in worker memory and is never visible in the main thread.

### AI Calculator UI components:

| Component | Role |
|-----------|------|
| `AIInventoryCalculator.tsx` | Main orchestrator (reducer + 4 stages: upload -> verify_slots -> verify_items -> summary) |
| `UploadStage.tsx` | Drag and drop, Ctrl+V, demo mode, file size and dimension validation |
| `VerifySlotsStage.tsx` | Preview of detected boxes on the image with manual removal support |
| `VerifyItemsStage.tsx` | Per-item verification - combobox with live API search, quantity editing |
| `SummaryStage.tsx` | Tabular summary with prices, clipboard export (TSV for Excel), feedback for model learning |
| `ItemCombobox.tsx` | Autocomplete component for searching and correcting item names |

**Effectiveness:** ~99% in tests on standard inventory screenshots.

---

## 📊 Dashboard - Analytics Components

All components from `src/components/dashboard/`:

| Component | Description |
|-----------|-------------|
| `DashboardNav.tsx` | In-dashboard server navigation (tabs) |
| `ServerInfoCard.tsx` | Server information card (name, type, population) |
| `QuickStats24h.tsx` | Widget with quick 24h statistics (prices, volume) |
| `ItemsTable.tsx` | Advanced items table with enchant/bonus handling. Supports: autocomplete search (debounced, min 3 chars), bonus filters with operators (=, >, <, >=, <=), multiple bonus filters, sorting by price/quantity/date, server-side pagination, inline `PriceCanvas` for anti-scraping price rendering |
| `PriceCalculator.tsx` | Profit calculator for market investments |
| `ShopCountChart.tsx` | Chart of active shop count using ZRender |
| `TotalItemsChart.tsx` | Chart of total market item count using ZRender |
| `lineAndBarChart.tsx` | React component mounting `OffscreenCanvas` and delegating mouse events to the worker |
| `lineAndBarChartHandler.ts` | Full OffscreenCanvas chart engine (see section above) |

---

## 🎭 Demo Mode and Mocking System

**Location:** `src/mocks/` + `public/mocks/`

Because the backend (FastAPI + MySQL + Redis) is not publicly available, the app includes a complete mocking system based on **[Mock Service Worker (MSW)](https://mswjs.io/)**. In demo mode, the app works fully without any backend - including a real cryptographic session handshake.

**Public demo:** **[https://m2tracker.pages.dev/](https://m2tracker.pages.dev/)**

---

## 💻 Technology Stack

| Category | Technologies |
|----------|--------------|
| **Core** | React 18, TypeScript, Vite |
| **Routing** | react-router-dom |
| **Styling** | TailwindCSS, Radix UI (accessibility), Lucide Icons |
| **Charts** | ZRender (OffscreenCanvas), Chart.js, Recharts |
| **AI / ML** | onnxruntime-web (WebAssembly WASM backend) |
| **Cryptography** | Web Crypto API (X25519 ECDH, HKDF, AES-256-GCM, HMAC-SHA256) |
| **Security** | Web Worker, OffscreenCanvas, Service Worker, Cloudflare Turnstile |
| **Code quality** | ESLint, TypeScript strict mode |
| **Testing** | Playwright (E2E), Vitest (unit) |

---

## 🚀 Local Setup

Requirements: **Node.js LTS** (recommended >= 20).

```bash
# 1. Install dependencies
npm install

# 2. Development server (Vite + HMR)
npm run dev
# -> App available at http://localhost:5173
```

## Environment Variables

Use `frontend/.env.example` as the base for your local `.env.local` setup.

- `VITE_API_BASE_URL`: Optional explicit API base URL. If omitted, the app uses `window.location.origin + /api/v1`.
- `VITE_MSW_ENABLED`: Enables/disables MSW mock mode (`true` or `false`). Default behavior is enabled in development and disabled in production when unset.
- `VITE_MSW_RECORD_FIXTURES`: Enables fixture recording in development (`true` or `false`).
- `VITE_TURNSTILE_SITE_KEY`: Cloudflare Turnstile site key for visible widget.
- `VITE_TURNSTILE_INVISIBLE_SITE_KEY`: Cloudflare Turnstile site key for invisible widget.
