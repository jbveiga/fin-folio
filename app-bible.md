# FinFolio: Master Product & Technical Architecture Bible

**Document Version:** 2.0.0  
**Status:** Authoritative Specification (Zero-Code Blueprint)  
**Target Platforms:** macOS, Windows, Linux (Phase 1) | iOS, Android (Phase 3)  
**Core Mandate:** Local-First, Zero-Knowledge, Keyboard-Driven Ingestion & Categorization

---

## 1. Executive Summary & Architectural Tenets

FinFolio is a high-performance, local-first personal finance application designed for speed, privacy, and total data ownership. It intentionally rejects Open Banking/PSD2 API integrations in favor of **deterministic manual statement ingestion** (clipboard HTML/text, CSV, TSV, XLS/XLSX, and PDF) paired with an auto-learning local categorization engine.

### Core Architectural Constraints

1. **Zero Network Dependency (Air-Gap Capable):** The application must function 100% offline. No user profiles, telemetry, or bank extracts ever leave the local machine.
2. **Zero-Float Financial Math:** All currency representations across memory, IPC boundaries, and disk storage are strictly represented as 64-bit signed integers (`i64`) in minor units (cents). Floating-point types are prohibited for monetary calculations.
3. **Sub-16ms UI Frame Budget:** Scrolling through 100,000+ historical transactions, toggling account filters, or recalculating category sums must complete within a single frame (<16.6ms for 60Hz, <8.3ms for 120Hz displays).
4. **Dual-Dimension Taxonomy:** Every transaction separates **Counterparty (Entity)** from **Purpose (Category)**.

---

## 2. System Architecture & Runtime Topology

FinFolio utilizes a dual-process model via **Tauri v2**, separating heavy data parsing, cryptography, and disk I/O (Rust Core) from the reactive presentation layer (OS-Native WebView).

### 2.1 Process Boundary & Responsibility Matrix

| Subsystem                   | Process Layer      | Technical Responsibility                                                                                                      | Memory / Threading Model                                                                   |
| :-------------------------- | :----------------- | :---------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| **UI & Virtual Grid**       | Frontend (WebView) | Renders active viewport rows (approx. 35 DOM nodes at any time), manages keyboard focus rings, and captures clipboard events. | Single-threaded UI event loop; state managed via immutable store.                          |
| **IPC Bridge**              | Tauri Core         | Serializes commands and payloads between WebView and Rust.                                                                    | Asynchronous binary message passing; zero-copy buffers for file drops.                     |
| **Ingestion & Scrubber**    | Backend (Rust)     | Parses raw bytes from CSV/PDF/Clipboard, detects character encodings, strips PII, and normalizes dates/amounts.               | Multi-threaded worker pool (`Rayon`) to process multi-year statements without blocking UI. |
| **Rule & Matching Engine**  | Backend (Rust)     | Evaluates cleaned transaction descriptions against stored user rules and fuzzy string metrics.                                | In-memory compiled Aho-Corasick / Regex automaton for $O(n)$ single-pass matching.         |
| **Storage & Crypto Engine** | Backend (Rust)     | Manages the SQLite connection pool, executes ACID transactions, and handles page-level encryption.                            | Single-writer, multi-reader WAL (Write-Ahead Logging) mode with SQLCipher.                 |

---

## 3. Data Storage, Security & Cryptography Specification

### 3.1 The `.finfolio` Vault Format

A user’s financial workspace is stored as a single, portable file with the `.finfolio` extension. Under the hood, this is an **SQLite 3 database running in WAL mode**, encrypted at the page level via **SQLCipher (AES-256-CBC)** with HMAC-SHA512 per-page authentication.

### 3.2 Key Derivation & Memory Lifecycle

- **Master Passphrase Optionality:** Users may create an unencrypted vault (instant launch) or an encrypted vault (requires passphrase on launch). Users can add, change, or remove their encryption passphrase at any time by triggering a database `rekey` operation.
- **Key Derivation Function (KDF):** Passphrases are stretched into a 256-bit cryptographic key using **Argon2id** (Memory cost: 64 MB, Iterations: 3, Parallelism: 4) with a unique 16-byte random salt stored in the unencrypted file header.
- **Memory Hygiene:** The derived 256-bit key is held strictly in locked Rust memory pages (`mlock` / `VirtualLock` to prevent OS swap-file leakage) and zeroed out immediately upon vault lock or application exit.

### 3.3 Relational Entity Dictionary (No-Code Schema Spec)

| Entity / Table         | Primary Purpose                                                                                                   | Critical Fields & Constraints                                                                                                                                                                | Relationships & Cascades                                                                                                          |
| :--------------------- | :---------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| **Vault Metadata**     | Tracks schema version, base currency, budget cycle start day (1–28), and institution import profiles.             | `schema_version`, `base_currency` (ISO-4217), `cycle_start_day`                                                                                                                              | Standalone singleton configuration table.                                                                                         |
| **Accounts**           | Represents real-world containers of money (Checking, Savings, Credit Card, Cash, Meal Card).                      | `id` (UUIDv7), `name`, `account_type`, `currency` (ISO-4217, default EUR), `anchor_balance_cents` (`i64`), `anchor_date` (ISO-8601), `is_included_in_totals` (Bool). | One-to-Many with **Transactions**. Deleting an account requires explicit confirmation and cascades to its transactions.           |
| **Entities**           | Counterparties (Merchants, Employers, Individuals, State bodies).                                                 | `id` (UUIDv7), `normalized_name` (Unique), `default_category_id` (Nullable), `tax_id_nif` (Optional).                                                                                        | One-to-Many with **Transactions** and **Import Rules**. Deleting an Entity sets `entity_id` to `NULL` on historical transactions. |
| **Categories**         | Hierarchical tree of income and expense buckets (up to 3 levels deep, e.g., `Habitação > Serviços > Água`).       | `id` (UUIDv7), `parent_id` (Nullable self-reference), `name`, `direction` (Income / Expense), `color_hex`.                                                                                   | One-to-Many with **Transaction Splits**. Cannot delete a parent category without reassigning or cascading children.               |
| **Transactions**       | The header record representing an immutable bank statement line or cash event.                                    | `id` (UUIDv7), `account_id`, `entity_id`, `date_posted` (ISO-8601), `total_amount_cents` (`i64`), `raw_bank_string`, `clean_description`, `dedup_hash` (BLAKE3), `is_reconciled` (Bool).     | Must have at least one child record in **Transaction Splits**. Sum of child splits must strictly equal `total_amount_cents`.      |
| **Transaction Splits** | The budgetary allocation of a transaction. Standard transactions have 1 split; itemized receipts have $N$ splits. | `id` (UUIDv7), `transaction_id`, `category_id` (Nullable if transfer), `transfer_peer_account_id` (Nullable), `split_amount_cents` (`i64`), `notes`.                                         | Belongs to **Transactions**. Links either to a **Category** (expense/income) or a **Peer Account** (internal transfer).           |
| **Import Rules**       | User-trained heuristics that map statement text to Entities and Categories.                                       | `id` (UUIDv7), `match_mode` (Contains, Prefix, Exact, Regex), `pattern_string`, `account_scope_id` (Nullable), `assigned_entity_id`, `assigned_category_id`, `priority_weight`, `hit_count`. | Evaluated sequentially by `priority_weight` descending during the Ingestion Pipeline.                                             |
| **Bank Profiles**      | Saved column mappings for specific banks or file structures.                                                      | `id` (UUIDv7), `profile_name`, `header_signature_hash`, `date_col_idx`, `desc_col_idx`, `amount_strategy` (SingleSigned vs. DebitCreditSplit), `decimal_separator`.                          | Automatically selected when an uploaded file matches `header_signature_hash`.                                                     |

---

## 4. The Ingestion & Sanitization Pipeline (Core Focus)

The ingestion engine converts inconsistent bank exports into clean, structured, and anonymized ledger records through a **7-Stage Deterministic Pipeline**.

### Stage 1: Multi-Format Acquisition & Encoding Normalization

- **Clipboard Listener:** Captures system clipboard buffer. Prioritizes `text/html` (preserving `<table>`, `<tr>`, `<td>` DOM hierarchy from homebanking portals) and falls back to `text/plain`.
- **File Drop Listener:** Accepts `.csv`, `.tsv`, `.txt`, `.xls`, `.xlsx`, and `.pdf`.
- **Character Encoding Detection:** Portuguese bank CSV exports frequently use legacy encodings (`ISO-8859-1` / `Windows-1252`) instead of `UTF-8`, which corrupts characters like `ç`, `ã`, `é`, and the `€` symbol. The pipeline inspects byte sequences to auto-transcode legacy encodings into valid `UTF-8` before parsing.

### Stage 2: Structural Table Extraction

- **Delimiter & Header Heuristics:** For text files, the parser scans the first 20 lines to count frequency consistency of `;`, `,`, and `\t`. It automatically discards bank metadata headers (e.g., first 6 rows of account holder name, IBAN, and export timestamp) by locating the first row containing at least two recognizable column header keywords (_Data_, _Movimento_, _Descrição_, _Valor_, _Débito_, _Crédito_, _Saldo_) or the first row matching a valid date + number pattern.
- **PDF Line Reconstruction:** For PDF statements, the engine extracts text tokens alongside their $(X, Y)$ page coordinates. Tokens sharing the same vertical $Y$-coordinate (within a 2pt tolerance) are grouped into logical rows, and horizontal $X$-gaps define column boundaries.

### Stage 3: Column Mapping & Bank Profile Matching

- The engine hashes the detected header structure (`header_signature_hash`).
- **Known Structure:** If the hash matches a saved **Bank Profile** (or a built-in preset for CGD, Millennium bcp, ActivoBank, BPI, Santander, Novo Banco, Moey!, Revolut, or Wise), columns are mapped with zero user prompts.
- **Unknown Structure:** If unrecognized, the UI presents a one-time **Column Mapper Bar** above the raw table where the user assigns dropdown tags (`Date`, `Description`, `Amount` or `Debit` + `Credit`, `Ignore`) to the columns. Saving the import saves this layout for all future uploads.

### Stage 4: Data Normalization & Cents Conversion

- **Date Resolution:** Resolves `DD-MM-YYYY`, `DD/MM/YYYY`, `YYYY/MM/DD`, and textual months (`20 Out 2026`) into strict `YYYY-MM-DD`. If a statement provides both _Data Movimento_ (Transaction Date) and _Data Valor_ (Value/Settlement Date), it defaults to _Data Movimento_.
- **Monetary Normalization:** Strips currency symbols and whitespace. Resolves European (`1.234,56`) vs. Anglo (`1,234.56`) formatting by inspecting the position of the last separator relative to the end of the string. Multiplies into integer cents.
- **Sign Resolution:** Handles three banking conventions:
    1. _Single Signed Column:_ `-45,00` is expense, `+120,00` is income.
    2. _Split Debit/Credit Columns:_ Values in the Debit column are forced negative; Credit column values are forced positive.
    3. _Value + D/C Indicator Column:_ Unsigned number `45,00` paired with an adjacent column containing `D` (Débito) or `C` (Crédito).

### Stage 5: In-Memory PII Scrubber (Anonymization)

Before a transaction’s description is passed to the Rule Engine or displayed in the UI, sensitive substrings are scrubbed in RAM:

- **Portuguese Phone Numbers:** Strips 9-digit sequences starting with `91`, `92`, `93`, `96` (and optional `+351`/`00351` prefixes) commonly injected by MB WAY transfers, replacing them with a clean token or isolating the contact name.
- **IBAN & Account Numbers:** Matches 21-to-34 character IBAN patterns (e.g., `PT50...`) and masks all but the last 4 digits.
- **Payment Card Numbers:** Masks 16-digit PAN sequences or partial bank masks down to `Card *1234`.
- **Noise Reduction:** Strips repetitive banking boilerplate prefixes that clutter descriptions (e.g., `COMPRA ELEC `, `PAGAMENTO SERVICOS `, `TRF MB WAY P/ `) into a clean secondary display field while preserving the sanitized original for rule matching.

### Stage 6: Deduplication Engine (Idempotency)

To prevent duplicate entries without relying on bank-provided transaction IDs:

- **Composite Fingerprinting:** Each transaction generates a deterministic `dedup_hash`:
  $$\text{Hash} = \text{BLAKE3}(\text{AccountID} \parallel \text{ISO\_Date} \parallel \text{AmountCents} \parallel \text{NormalizedRawDescription} \parallel \text{SameDaySequenceIndex})$$
- **The Sequence Index Rule:** If a user buys two identical coffees (`-1,20 €`) at the exact same bakery on the same day, the first occurrence in the file gets `SequenceIndex = 1`, and the second gets `SequenceIndex = 2`. If the same file is uploaded again tomorrow, both hashes match existing database entries and are flagged as **“Already Imported (Skipped)”** in the Staging Grid.

### Stage 7: Auto-Categorization & Rule Matching

Each new transaction is evaluated against the user’s **Import Rules** table:

1. **Tier 1 (Exact & Regex Rules):** User-defined explicit rules evaluated by priority weight.
2. **Tier 2 (Substring / Keyword Containment):** Longest-match wins (e.g., a rule for `"CONTINENTE BOM DIA"` beats a generic rule for `"CONTINENTE"`).
3. **Tier 3 (Historical Fuzzy Fallback):** If no explicit rule matches, the engine performs a Jaro-Winkler similarity check against historical descriptions. If similarity exceeds 92%, it suggests the historical Entity and Category with a visual _"Suggested"_ badge.

---

## 5. Categorization, Split & Transfer Mechanics

### 5.1 The Entity-Category Inheritance Model

- **Entity Assignment Triggers Category Default:** If an Entity (`Continente`) has a configured `default_category_id` (`Supermercado`), assigning the Entity in the Staging Grid automatically populates the Category cell.
- **Contextual Override:** If the user buys clothing at Continente, they keep Entity as `Continente` but change the Category cell to `Vestuário` for that specific transaction.
- **Rule Generation Prompt:** When categorizing a previously unknown merchant, an inline indicator confirms automatic rule learning. Pressing `Enter` commits both the transaction and the rule.

### 5.2 Split Transactions (Multi-Category Allocation)

- A single bank deduction (e.g., `-100,00 €` at a hypermarket or Amazon) can be expanded inline via shortcut (`Ctrl+S` / `Cmd+S`).
- The UI opens child rows beneath the parent transaction. As the user types `-30,00 €` into Split 1 (`Higiene`), Split 2 automatically populates with the remainder `-70,00 €` (`Supermercado`).
- A transaction cannot be committed until the sum of its splits equals the parent amount (Remainder = `0,00 €`).

### 5.3 Internal Transfers & Reimbursements

#### 5.3.1 Internal Account-to-Account Transfers
- **Net Worth Conservation Law:** Moving money from Checking to Savings (or paying off a Credit Card balance) is an internal asset shift. With amount $X > 0$ cents:
  $$\Delta \text{Balance}(A) = -X, \quad \Delta \text{Balance}(B) = +X, \quad \Delta \text{NetWorth} = 0$$
- **Bidirectional Linking:** Symmetrically pairs source and destination records via `linked_transfer_transaction_id`.
- **Cash Flow Isolation:** Both debit and credit sides are strictly excluded from Period Inflow and Period Outflow KPIs.
- **Auto-Mirror Generation:** Creating a transfer in Account A automatically generates or offers the reciprocal $+X$ credit record in Account B.

#### 5.3.2 Expense Reimbursements (The "MB WAY Dinner" Problem)
- **Netting Mechanics:** When a user pays $-M$ cents for a group expense (e.g., `-60,00 €` at `Restauração`) and subsequently receives $k$ friend repayments $+r_1, +r_2, \dots$ via MB WAY, linking these credits directly reduces the parent category spend:
  $$\text{Net Category Spend} = -M + \sum_{i=1}^k r_i$$
- **Gross Income Neutrality:** The incoming reimbursements do not falsely inflate gross monthly income.
- **Visual Presentation:** The parent transaction displays a sub-badge (`Reimbursed: +40,00 € • Net: -20,00 €`), and child reimbursements display a backlink pill pointing to the original expense.
- **Candidate Suggestion Engine:** Suggests candidate parent expenses from a $\pm 14$-day window for 1-click linking.

---

## 6. User Interface & Keyboard Ergonomics Specification

FinFolio is designed to be operated entirely without a mouse during statement imports and daily ledger reviews.

### 6.1 Application Layout Architecture

- **Left Navigation Rail (Collapsible, 240px):**
    - _Top Section:_ Primary Views (`Ledger`, `Import Staging`, `Categories & Entities`, `Import Rules`, `Analytics`).
    - _Middle Section (Multi-Account Switcher):_ List of all Accounts with checkboxes and live individual balances. Checking/unchecking an account filters the active view and recalculates header totals in real time (<5ms).
    - _Bottom Section:_ Vault status indicator (Encrypted/Unlocked), Quick Backup button, Settings.
- **Top Context Header (64px):**
    - Displays aggregated metrics for the currently selected accounts and date filter: `Selected Balance`, `Period Inflow`, `Period Outflow`, and `Net Cash Flow`.
- **Main Workspace Canvas:**
    - Houses the Virtualized Transaction Grid or the active module view.

### 6.2 Global Keyboard Shortcut Map

| Shortcut (Win/Linux / macOS) | Scope            | Action                                                                                                |
| :--------------------------- | :--------------- | :---------------------------------------------------------------------------------------------------- |
| `Ctrl+I` / `Cmd+I`           | Global           | Open Import Wizard / Read Clipboard immediately into Staging Grid                                     |
| `Ctrl+V` / `Cmd+V`           | Ledger / Staging | If tabular data is on clipboard, parse and append to Staging Grid                                     |
| `Ctrl+N` / `Cmd+N`           | Ledger           | Insert new manual transaction row at top of grid                                                      |
| `Tab` / `Shift+Tab`          | Staging & Ledger | Move focus horizontally between editable cells (`Date` $\to$ `Entity` $\to$ `Category` $\to$ `Notes`) |
| `Up` / `Down` Arrows         | Staging & Ledger | Move focus vertically to the same column in the adjacent row                                          |
| `Enter`                      | Staging Row      | Confirm current row categorization, commit rule, and advance to next unconfirmed row                  |
| `Ctrl+Enter` / `Cmd+Enter`   | Staging Grid     | Commit all valid staged rows to the main Ledger                                                       |
| `Ctrl+S` / `Cmd+S`           | Active Row       | Open/Add a Split line item to the focused transaction                                                 |
| `Ctrl+K` / `Cmd+K`           | Global           | Open Command Palette (jump to any account, filter by entity, trigger export)                          |
| `Space`                      | Active Row       | Toggle reconciliation/selection checkbox on focused transaction                                       |
| `Delete` / `Backspace`       | Staging Row      | Exclude/Skip focused row from being imported                                                          |

---

## 7. Phased Product Roadmap

### Phase 1: The Core Ingestion & Categorization MVP (Current Focus)

- **Goal:** Replace spreadsheets and legacy transaction tracking with a fast local ledger.
- **Deliverables:**
    1. `.finfolio` encrypted/unencrypted SQLite vault creation and management.
    2. Account management with Anchor Balance and Anchor Date logic (retroactive & forward balance calculation).
    3. Multi-format Ingestion Pipeline (Clipboard HTML/TSV, CSV, XLSX, basic PDF text) with encoding normalization.
    4. In-memory PII Scrubber (Phone, IBAN, Card PAN masking).
    5. Deduplication hashing engine (`BLAKE3`) to prevent double imports.
    6. Keyboard-first Staging Grid with inline Entity/Category creation and Auto-Rule learning.
    7. Master Virtualized Ledger with split transactions, internal transfers, and instant sidebar account filtering.
    8. Full data portability: One-click export/backup to CSV and JSON.

### Phase 2: Analytical Cash Flow & Flexible Budgeting

- **Goal:** Deliver multi-dimensional cash flow reporting and predictive budgeting.
- **Deliverables:**
    1. Custom Budget Cycle definition (e.g., month starts on day 23 or 25).
    2. Category monthly budgeting with Smart Auto-Fill helpers (_Copy last month_, _Use 6-month average_).
    3. **Fluxo de Caixa (Cash Flow Matrix):** Multi-month Category $\times$ Month pivot table with clickable cell drill-downs.
    4. **Agenda & Predictive Horizon:** Scheduled recurring bills/income and a 12-month forward balance projection chart.

### Phase 3: Portuguese Tax Intelligence & Ecosystem Polish

- **Goal:** Deep localization and multi-device convenience without sacrificing privacy.
- **Deliverables:**
    1. **IRS / e-Fatura Estimator:** Optional NIF mapping on Entities and IRS deduction cap tracking (_Despesas Gerais_, _Saúde_, _Educação_, _Habitação_, _Exigência de Fatura_ VAT return).
    2. **Legacy Migration Importer:** Direct 1-click importer for historical personal finance CSV/Excel exports, preserving existing Category hierarchies and Entities.
    3. **Zero-Knowledge Sync & Mobile Companion:** Optional E2EE encrypted blob sync via QR pairing for on-the-go expense entry.

---

## 8. Quality Assurance & Edge-Case Verification Matrix

1. **The "Same-Day Double Espresso" Test:** Importing a statement where the user bought two `1,00 €` coffees at the exact same merchant on the same day must import **both** rows on the first upload, and skip **both** rows if the exact same statement is uploaded a second time.
2. **The "Overlapping Statement" Test:** Uploading a CSV covering `Oct 1 – Oct 15`, followed a week later by a CSV covering `Oct 10 – Oct 25`, must accurately skip the `Oct 10 – Oct 15` overlap while importing `Oct 16 – Oct 25`.
3. **The "Portuguese Encoding" Test:** Uploading an `ISO-8859-1` CSV from CGD or Millennium containing `"RESTAURAÇÃO"`, `"FARMÁCIA SÃO JOÃO"`, and `"1.450,75 €"` must render zero replacement characters and parse the integer value `145075`.
4. **The "10-Year Ledger" Benchmark:** Loading a `.finfolio` vault seeded with 100,000 transactions across 8 accounts and toggling an account checkbox in the sidebar must recalculate all balances and refresh the grid in under `15ms`.
5. **The "Retroactive Anchor" Test:** Setting an account's Anchor Balance to `1.000,00 €` on `2026-10-20`, and subsequently importing a historical statement from `2026-09-01` with `-200,00 €` in expenses, must leave the `2026-10-20` balance untouched at `1.000,00 €` while accurately calculating the `2026-09-01` historical balance as `1.200,00 €`.

---

## 9. Engineering Governance & Periodic Optimization Protocol (The 5/10 Cadence)

To maintain long-term architectural integrity, performance standards (<16ms frame budget), zero-float financial math discipline, and documentation accuracy throughout rapid iterative development:

### 9.1 The 5/10 Optimization Cadence

```mermaid
flowchart LR
    M1["Milestones 1–4"] --> CP1["Minor Checkpoint (Every 5th)"]
    CP1 --> M2["Milestones 6–9"]
    M2 --> OP1["Major Optimization Sprint (Every 10th)"]
    OP1 --> Next["Next Epoch"]
```

1. **Every 5 Feature Milestones (Minor Checkpoint Sprint):**
   - **Bundle & Binary Audit:** Verify production bundle weights (`dist/` asset sizes) and Rust crate graph compile times.
   - **Compiler & Linter Hygiene:** Run `cargo clippy --all-targets -- -D warnings` and TypeScript strict typechecks (`tsc --noEmit`).
   - **Zero-Float Math Audit:** Grep codebase to ensure zero instances of floating-point arithmetic on currency values (`i64` minor units only).
   - **Brand Hygiene Scan:** Automated repository scan to verify zero occurrences of prohibited external brand mentions.

2. **Every 10 Feature Milestones (Major Architectural Optimization Sprint):**
   - **Full Architectural Refactoring:** Review monolithic store interfaces, decompose slices, and eliminate technical debt.
   - **Performance Profiling:** Validate the `<16ms` virtualized grid frame budget under 100,000+ transaction loads.
   - **Storage Engine & Data Layer Health:** Audit page encryption, WAL checkpoints, and browser IndexedDB quota health.
   - **UI/UX Consistency Audit:** Cross-device ergonomics review (desktop, tablet, mobile web, PWA safe areas).
   - **Documentation Synchronization:** Complete synchronization across `app-bible.md`, `README.md`, and design specifications.

### 9.2 Milestone Epoch History

- **Epoch 1 (Milestones 1.0 – 1.9 Completed):**
  - *M1.0:* Local-first SQLite/SQLCipher vault engine & 13 Rust core unit tests passing.
  - *M1.1:* Multi-Account Switcher editing, Web Preview sandbox reset, ledger click-to-filter.
  - *M1.2:* Cash Flow Analytics view, 1-click Date Range Presets, JSON web vault backup/restore.
  - *M1.3:* Needs Categorization Triage Inbox, multi-row selection, floating batch actions bar, taxonomy CRUD.
  - *M1.4:* Monthly Category Budgets (`BudgetsView.tsx`) & Rule Auto-Categorization engine.
  - *M1.5:* Recurring Expenses, Subscriptions & Bills Schedule (`RecurringView.tsx`) with paid vs upcoming tracking.
  - *M1.6:* Advanced CSV/TSV File Dropper & 5-Row Column Mapper Wizard with 6 bank presets.
  - *M1.7:* Monthly Financial Health Report Card (`ReportCardView.tsx`) with 100-point score & letter grades (A+ to D).
  - *M1.8:* Route-level code splitting (`React.lazy`), React Error Boundary, contextual empty states, search debounce.
  - *M1.9:* IndexedDB High-Capacity Storage Adapter (500MB+) with auto-migration from `localStorage`.

- **Epoch 2 (In Active Development):**
  - *M2.1:* Native Desktop Packaging (Tauri v2) & Automated Multi-Platform Release Pipeline (`.github/workflows/release-desktop.yml`).
  - *M2.2:* Internal Transfers & MB WAY Reimbursement Pair Linker (`finfolio_milestone_2_2_transfers_spec.md`).
  - *M2.3:* Multi-Currency Support (ISO-4217) & Integer Basis Point FX Math (`finfolio_milestone_2_3_multi_currency_spec.md`).
