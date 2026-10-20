# FinFolio

> **A high-performance, local-first, zero-knowledge personal finance application.**  
> Designed for speed, privacy, and keyboard-driven ledger management.

[![Live Web Demo](https://img.shields.io/badge/Live%20Demo-jbveiga.github.io%2Ffin--folio-10b981?style=for-the-badge&logo=github)](https://jbveiga.github.io/fin-folio/)
[![Local-First](https://img.shields.io/badge/Security-Local--First%20%26%20Zero--Knowledge-10b981.svg)](#core-architectural-tenets)
[![Zero-Float](https://img.shields.io/badge/Financial%20Math-Zero--Float%20(i64%20Cents)-0284c7.svg)](#core-architectural-tenets)
[![Tauri v2](https://img.shields.io/badge/Platform-Tauri%20v2%20(Rust%20%2B%20React)-8b5cf6.svg)](#technology-stack)
[![License: MIT](https://img.shields.io/badge/License-MIT-neutral.svg)](#license)

---

### 🌐 Try It Now in Your Browser

You can try FinFolio immediately without installing any software:  
👉 **[Launch Live Web Demo (https://jbveiga.github.io/fin-folio/)](https://jbveiga.github.io/fin-folio/)**

*The web demo runs client-side with full bi-directional `localStorage` persistence—all your accounts, splits, and categories remain saved in your browser.*

---

## Overview

FinFolio is a local-first personal finance application that prioritizes **data sovereignty**, **keyboard ergonomics**, and **deterministic manual statement ingestion** over fragile Open Banking/PSD2 integrations.

Every transaction, category, rule, and balance is computed entirely on your local machine using integer cents math, stored in an encrypted single-file `.finfolio` vault, and presented through a high-performance virtualized grid maintaining a strict sub-16ms frame budget (<35 active DOM nodes).

---

## Core Architectural Tenets

1. **Zero Network Dependency (Air-Gap Capable):** Functions 100% offline. No credentials, telemetry, or bank statements ever leave your machine.
2. **Zero-Float Financial Math:** All currency representations across memory, IPC boundaries, and disk storage are strictly represented as 64-bit signed integers (`i64`) in minor units (cents). Floating-point math is strictly forbidden.
3. **Sub-16ms UI Frame Budget:** Scrolling through 100,000+ historical transactions or toggling account filters executes within a single frame (<16.6ms for 60Hz, <8.3ms for 120Hz displays).
4. **Dual-Dimension Taxonomy:** Every transaction cleanly separates **Counterparty (Entity)** from **Purpose (Category)** with automatic default category inheritance.
5. **Deterministic Anchor Balances:** Account balances are anchored to a specific reference date and balance, calculating running balances forward into the future and backward into history without drift.

---

## Features

- **Multi-Account Switcher:** Instant multi-account checkbox filtering with sub-5ms reactive balance and cash flow recalculation.
- **Top Context Header & Date Presets:** Real-time KPI summary cards displaying *Selected Balance*, *Period Inflow*, *Period Outflow*, and *Net Cash Flow* with 1-click date presets (*This Month*, *Last Month*, *This Year*, *All Time*).
- **Master Virtualized Ledger:** Render 100,000+ transactions effortlessly with `@tanstack/react-virtual` at 60/120fps.
- **Inline Split Transactions (`Cmd+S`):** Expand child split rows underneath any transaction with real-time zero-float remainder balancing (`0,00 €` check).
- **Needs Categorization Inbox & Floating Batch Actions:** 1-click triage filter for unassigned transactions and a floating batch action bar for bulk categorization, bulk merchant assignment, bulk reconciliation, and deletion.
- **Monthly Category Budgets:** Track monthly spending against targets with visual progress bars (Safe, Warning, Over Budget), over-budget alerts, and *Remaining Safe-to-Spend* metrics.
- **Recurring Subscriptions & Bills Schedule:** Track recurring obligations with auto-detection of paid vs upcoming bills, monthly fixed commitments KPI, and chronological calendar timeline.
- **Monthly Financial Health Report Card:** Deterministic 100-point financial health score and letter grades (**A+** to **D**) across 4 pillars (Savings Rate, Budget Discipline, Fixed Overhead, Cash Flow Growth) with month-over-month stepper and 1-page print/PDF export.
- **Advanced CSV/TSV Importer & Column Mapper Wizard:** Drag-and-drop file dropper and raw text paste zone with live 5-row interactive column mapper and built-in bank presets (**CGD**, **Millennium bcp**, **Santander Totta**, **ActivoBank**, **Revolut**, **N26**).
- **Internal Transfers & MB WAY Reimbursements:** Account-to-account transfers preserve net worth without inflating income/expense figures; incoming reimbursements directly net down expense categories.
- **Full Taxonomy CRUD:** Complete visual hierarchy management for 3-level Categories and Counterparty Entities with default category inheritance.
- **Route-Level Code Splitting & Resilient Error Boundaries:** Instant first-paint ledger load via `React.lazy` + `<Suspense>` module chunking and self-healing `<ErrorBoundary>` recovery.
- **Dual-Runtime Persistence:**
  - **Native Desktop:** SQLCipher (AES-256-CBC + HMAC-SHA512) page-level encrypted `.finfolio` vault with Argon2id KDF and `mlock` page locking.
  - **Browser Preview:** Automatic `localStorage` bi-directional synchronization, allowing full testing in any modern web browser without native compilation.

---

## Quickstart

### Prerequisites

- **Node.js** (v20+ recommended)
- **Rust** (v1.75+ with `cargo` and `rustup`) for native desktop builds
- **Xcode Command Line Tools** (on macOS) or standard C build tools (Linux/Windows)

### 1. Interactive Web Preview (Instant Setup)

You can launch and try FinFolio directly in your web browser with zero native build prerequisites:

```bash
# Clone the repository
git clone https://github.com/jbveiga/fin-folio.git
cd fin-folio

# Install dependencies
npm install

# Start development server
npm run dev
```

Open `http://localhost:1420` in your browser. All data automatically persists to your browser's `localStorage` across page reloads.

### 2. Native Desktop Application (Tauri v2)

To run the native desktop version backed by the encrypted Rust SQLite/SQLCipher engine:

```bash
# Run desktop app in development mode
npm run tauri dev
```

### 3. Production Build

```bash
# Build native desktop installers (.dmg, .msi, .deb)
npm run tauri build
```

---

## Global Keyboard Shortcuts

FinFolio is engineered to be operated entirely without a mouse:

| Shortcut (macOS / Win-Linux) | Context | Action |
| :--- | :--- | :--- |
| `Cmd+I` / `Ctrl+I` | Global | Open Statement Import Wizard / Paste Clipboard |
| `Cmd+V` / `Ctrl+V` | Global / Grid | Ingest tabular data directly from clipboard |
| `Cmd+N` / `Ctrl+N` | Ledger | Insert new transaction at top of grid |
| `Cmd+K` / `Ctrl+K` | Global | Open Command Palette (jump to accounts, views, actions) |
| `Cmd+S` / `Ctrl+S` | Ledger Row | Expand / collapse inline Split transaction editor |
| `Space` | Ledger Row | Toggle reconciliation cleared checkbox |
| `Enter` | Staging Row | Confirm row categorization, learn rule, advance focus |
| `Cmd+Enter` / `Ctrl+Enter` | Staging Grid | Batch commit all valid staged transactions |
| `Up` / `Down` | Grids | Navigate active row up / down |
| `Delete` / `Backspace` | Staging Row | Skip / exclude focused row from import |
| `Escape` | Modals / Inputs | Close modal or cancel inline editing |

---

## Technology Stack

### Backend (Rust / Tauri v2 Core)
- **Framework:** `tauri` v2
- **Database:** `rusqlite` with `bundled-sqlcipher` (AES-256-CBC, WAL mode)
- **Cryptography:** `argon2` (Argon2id KDF), `zeroize` (secure memory erasure), `libc::mlock`
- **Hashing & Concurrency:** `blake3` composite deduplication, `rayon` multi-threaded worker pool
- **Encoding & Parsing:** `encoding_rs` (Portuguese bank character transcoding), `calamine`, `csv`, `lopdf`
- **String Matching:** `aho-corasick`, `strsim` (Jaro-Winkler metric), `regex`

### Frontend (Native WebView)
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS with dark/light design system
- **Virtualization:** `@tanstack/react-virtual`
- **State Management:** Zustand
- **Icons:** `lucide-react`
- **Date Handling:** `date-fns`

---

## Quality Assurance & Verification

The Rust core is validated against the 5 canonical edge-case criteria defined in Section 8 of the [Master Architecture Bible](app-bible.md):

```bash
# Run the Rust unit test suite
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

### Test Suite Highlights:
- **Same-Day Double Espresso Test:** Verified that two identical transactions on the same day at the same vendor both import on first upload and are both skipped on re-upload via BLAKE3 `SameDaySequenceIndex`.
- **Overlapping Statement Test:** Verified seamless deduplication across overlapping date ranges without human intervention.
- **Portuguese Character Encodings Test:** Verified `ISO-8859-1` / `Windows-1252` transcoding without replacement characters (`\uFFFD`) and exact integer cents parsing.
- **100,000 Transaction Benchmark Test:** Verified that toggling account filters on a 100k-transaction ledger recalculates balances in `<1ms` (well below the `<15ms` frame budget).
- **Retroactive Anchor Balance Test:** Verified that importing historical transactions before an anchor date updates historical balances without altering the fixed anchor.

---

## Documentation

- **[app-bible.md](./app-bible.md):** Complete architectural tenets, security model, and data structures.

---

## License

FinFolio is distributed under the MIT License. See [LICENSE](LICENSE) for details.
