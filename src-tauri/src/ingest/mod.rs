//! 7-Stage Deterministic Ingestion & Sanitization Pipeline (Phase 2)
//!
//! Converts raw bank exports (CSV, TSV, XLSX/XLS, PDF, Clipboard HTML/Text) into
//! normalized, PII-scrubbed, deduplicated, and auto-categorized staged transactions.

use crate::models::{new_uuid_v7, AmountStrategy, BankProfile, Cents};
use crate::rules::{CategorizationMatch, HistoricalExemplar, RuleMatcherEngine};
use calamine::{open_workbook_auto_from_rs, Data, Reader};
use encoding_rs::WINDOWS_1252;
use lopdf::{Document, Object};
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::sync::OnceLock;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum IngestError {
    #[error("Empty input provided to ingestion pipeline")]
    EmptyInput,
    #[error("Failed to parse spreadsheet: {0}")]
    SpreadsheetError(String),
    #[error("Failed to parse PDF document: {0}")]
    PdfError(String),
    #[error("No tabular transaction rows found in input")]
    NoTabularDataFound,
    #[error("Invalid date string: {0}")]
    InvalidDate(String),
    #[error("Invalid monetary value: {0}")]
    InvalidAmount(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SourceFormat {
    CsvOrTsv,
    ClipboardHtml,
    ClipboardPlain,
    Excel,
    Pdf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtractedTable {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub header_signature_hash: String,
    pub detected_delimiter: Option<char>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum StagingStatus {
    /// Ready to be categorized/confirmed
    New,
    /// Matched via Tier 1 or Tier 2 explicit rule
    RuleMatched,
    /// Matched via Tier 3 Jaro-Winkler (>92% similarity) — displays "Suggested" badge
    Suggested,
    /// Matches an existing BLAKE3 dedup_hash in the database — skipped by default
    AlreadyImported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StagedTransaction {
    pub staging_id: String,
    pub account_id: String,
    pub date_posted: String,
    pub total_amount_cents: i64,
    pub raw_bank_string: String,
    pub clean_description: String,
    pub same_day_sequence_index: u32,
    pub dedup_hash: String,
    pub status: StagingStatus,
    pub entity_id: Option<String>,
    pub category_id: Option<String>,
    pub categorization_match: Option<CategorizationMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum IngestionOutcome {
    /// Known bank profile or auto-recognized layout: returns ready-to-review staged transactions
    Mapped {
        matched_profile: BankProfile,
        staged_transactions: Vec<StagedTransaction>,
    },
    /// Unrecognized column structure: prompts user with the UI Column Mapper Bar
    NeedsColumnMapping {
        header_signature_hash: String,
        headers: Vec<String>,
        sample_rows: Vec<Vec<String>>,
        all_rows: Vec<Vec<String>>,
    },
}

// =============================================================================
// STAGE 1: Multi-Format Acquisition & Encoding Normalization
// =============================================================================

/// Inspects raw byte sequence and auto-transcodes legacy Portuguese bank encodings
/// (`ISO-8859-1` / `Windows-1252`) into clean `UTF-8` with zero `\u{FFFD}` replacement characters.
pub fn decode_bytes_to_utf8(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    // Strip UTF-8 BOM if present
    let stripped = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    };

    // If strictly valid UTF-8, return directly
    if let Ok(utf8_str) = std::str::from_utf8(stripped) {
        return utf8_str.to_string();
    }

    // Otherwise transcode using Windows-1252 (a superset of ISO-8859-1 that also maps 0x80 -> '€')
    let (cow, _encoding_used, _had_errors) = WINDOWS_1252.decode(stripped);
    cow.into_owned()
}

/// Parses an HTML table from system clipboard (`text/html`) preserving `<tr>`, `<th>`, `<td>` cells.
pub fn parse_clipboard_html_table(html: &str) -> Result<ExtractedTable, IngestError> {
    static TR_RE: OnceLock<Regex> = OnceLock::new();
    static CELL_RE: OnceLock<Regex> = OnceLock::new();
    static TAG_RE: OnceLock<Regex> = OnceLock::new();

    let tr_re = TR_RE.get_or_init(|| Regex::new(r"(?is)<tr[^>]*>(.*?)</tr>").unwrap());
    let cell_re = CELL_RE.get_or_init(|| Regex::new(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>").unwrap());
    let tag_re = TAG_RE.get_or_init(|| Regex::new(r"(?is)<[^>]+>").unwrap());

    let mut raw_rows: Vec<Vec<String>> = Vec::new();
    for tr_cap in tr_re.captures_iter(html) {
        let row_html = &tr_cap[1];
        let mut row_cells = Vec::new();
        for cell_cap in cell_re.captures_iter(row_html) {
            let stripped = tag_re.replace_all(&cell_cap[1], " ");
            let decoded = stripped
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&euro;", "€")
                .replace("&#8364;", "€")
                .replace("&lt;", "<")
                .replace("&gt;", ">");
            let normalized = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
            row_cells.push(normalized);
        }
        if !row_cells.is_empty() && row_cells.iter().any(|c| !c.is_empty()) {
            raw_rows.push(row_cells);
        }
    }

    if raw_rows.is_empty() {
        return Err(IngestError::NoTabularDataFound);
    }

    extract_structured_table_from_rows(raw_rows, None)
}

/// Parses an Excel `.xlsx` / `.xls` workbook from memory bytes using `calamine`.
pub fn parse_excel_bytes(bytes: &[u8]) -> Result<ExtractedTable, IngestError> {
    let cursor = Cursor::new(bytes);
    let mut workbook = open_workbook_auto_from_rs(cursor)
        .map_err(|e| IngestError::SpreadsheetError(e.to_string()))?;

    let sheet_names = workbook.sheet_names().to_vec();
    let first_sheet = sheet_names
        .first()
        .ok_or(IngestError::NoTabularDataFound)?;

    let range = workbook
        .worksheet_range(first_sheet)
        .map_err(|e| IngestError::SpreadsheetError(e.to_string()))?;

    let mut raw_rows: Vec<Vec<String>> = Vec::new();
    for row in range.rows() {
        let cells: Vec<String> = row
            .iter()
            .map(|cell| match cell {
                Data::Empty => String::new(),
                Data::String(s) => s.trim().to_string(),
                Data::Int(i) => i.to_string(),
                Data::Float(f) => {
                    // Format workbook numeric cell with 2 decimals for deterministic integer cents parser
                    format!("{:.2}", f)
                }
                Data::Bool(b) => b.to_string(),
                Data::DateTime(dt) => dt.to_string(),
                Data::DateTimeIso(s) => s.trim().to_string(),
                Data::DurationIso(s) => s.trim().to_string(),
                Data::Error(_) => String::new(),
            })
            .collect();
        if cells.iter().any(|c| !c.is_empty()) {
            raw_rows.push(cells);
        }
    }

    extract_structured_table_from_rows(raw_rows, None)
}

/// Represents a positioned text token on a PDF page.
#[derive(Debug, Clone)]
pub struct PdfPositionedToken {
    pub x: f32,
    pub y: f32,
    pub text: String,
}

/// Groups positioned PDF tokens into logical rows (within 2.0pt Y-coordinate tolerance)
/// and splits horizontal X-gaps into columns.
pub fn reconstruct_pdf_rows_from_tokens(mut tokens: Vec<PdfPositionedToken>) -> Vec<Vec<String>> {
    // Filter empty tokens
    tokens.retain(|t| !t.text.trim().is_empty());
    if tokens.is_empty() {
        return Vec::new();
    }

    // Sort top-to-bottom (higher Y first in PDF coordinates), then left-to-right (lower X first)
    tokens.sort_by(|a, b| {
        b.y.partial_cmp(&a.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });

    // Group tokens whose Y-coordinates are within 2.0pt tolerance
    let mut logical_rows: Vec<(f32, Vec<PdfPositionedToken>)> = Vec::new();
    for token in tokens {
        if let Some((row_y, row_tokens)) = logical_rows
            .iter_mut()
            .find(|(ry, _)| (*ry - token.y).abs() <= 2.0)
        {
            let _ = row_y;
            row_tokens.push(token);
        } else {
            logical_rows.push((token.y, vec![token]));
        }
    }

    let mut table_rows = Vec::with_capacity(logical_rows.len());
    for (_, mut row_tokens) in logical_rows {
        row_tokens.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
        let mut cols: Vec<String> = Vec::new();
        let mut last_x: Option<f32> = None;

        for tok in row_tokens {
            if let Some(prev_x) = last_x {
                // Horizontal X-gap > 15pt starts a new column; smaller gap appends to current column
                if (tok.x - prev_x) > 15.0 {
                    cols.push(tok.text.trim().to_string());
                } else if let Some(last_col) = cols.last_mut() {
                    last_col.push(' ');
                    last_col.push_str(tok.text.trim());
                }
            } else {
                cols.push(tok.text.trim().to_string());
            }
            last_x = Some(tok.x);
        }

        if cols.len() >= 2 {
            table_rows.push(cols);
        }
    }

    table_rows
}

/// Extracts positioned text tokens from a PDF byte buffer using `lopdf` content operations.
pub fn parse_pdf_bytes(bytes: &[u8]) -> Result<ExtractedTable, IngestError> {
    let doc = Document::load_mem(bytes).map_err(|e| IngestError::PdfError(e.to_string()))?;
    let mut all_tokens: Vec<PdfPositionedToken> = Vec::new();

    for (page_num, page_id) in doc.get_pages() {
        if let Ok(content_bytes) = doc.get_page_content(page_id) {
            if let Ok(content) = lopdf::content::Content::decode(&content_bytes) {
                let mut cur_x: f32 = 0.0;
                let mut cur_y: f32 = 0.0;
                let page_y_offset = (page_num as f32) * -10_000.0;

                for op in content.operations {
                    match op.operator.as_str() {
                        "Tm" if op.operands.len() >= 6 => {
                            cur_x = obj_to_f32(&op.operands[4]).unwrap_or(cur_x);
                            cur_y = obj_to_f32(&op.operands[5]).unwrap_or(cur_y);
                        }
                        "Td" | "TD" if op.operands.len() >= 2 => {
                            cur_x += obj_to_f32(&op.operands[0]).unwrap_or(0.0);
                            cur_y += obj_to_f32(&op.operands[1]).unwrap_or(0.0);
                        }
                        "Tj" if !op.operands.is_empty() => {
                            if let Some(txt) = obj_to_string(&op.operands[0]) {
                                all_tokens.push(PdfPositionedToken {
                                    x: cur_x,
                                    y: page_y_offset + cur_y,
                                    text: txt,
                                });
                            }
                        }
                        "TJ" if !op.operands.is_empty() => {
                            if let Object::Array(ref arr) = op.operands[0] {
                                let mut combined = String::new();
                                for item in arr {
                                    if let Some(s) = obj_to_string(item) {
                                        combined.push_str(&s);
                                    }
                                }
                                if !combined.trim().is_empty() {
                                    all_tokens.push(PdfPositionedToken {
                                        x: cur_x,
                                        y: page_y_offset + cur_y,
                                        text: combined,
                                    });
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    let raw_rows = reconstruct_pdf_rows_from_tokens(all_tokens);
    if raw_rows.is_empty() {
        return Err(IngestError::NoTabularDataFound);
    }

    extract_structured_table_from_rows(raw_rows, None)
}

fn obj_to_f32(obj: &Object) -> Option<f32> {
    match obj {
        Object::Real(r) => Some(*r),
        Object::Integer(i) => Some(*i as f32),
        _ => None,
    }
}

fn obj_to_string(obj: &Object) -> Option<String> {
    match obj {
        Object::String(ref bytes, _) => Some(decode_bytes_to_utf8(bytes)),
        _ => None,
    }
}

// =============================================================================
// STAGE 2: Structural Table Extraction (Delimiter & Header Heuristics)
// =============================================================================

const HEADER_KEYWORDS: &[&str] = &[
    "DATA",
    "MOVIMENTO",
    "VALOR",
    "DESCRIÇÃO",
    "DESCRICAO",
    "DESCRITIVO",
    "DETALHE",
    "MONTANTE",
    "DÉBITO",
    "DEBITO",
    "CRÉDITO",
    "CREDITO",
    "SALDO",
    "DATE",
    "DESCRIPTION",
    "AMOUNT",
    "DEBIT",
    "CREDIT",
    "BALANCE",
    "IMPORTÂNCIA",
    "IMPORTANCIA",
    "LANÇAMENTO",
    "LANCAMENTO",
    "OPERAÇÃO",
    "OPERACAO",
];

/// Scans the first 20 non-empty lines to detect the most consistent delimiter (`;`, `\t`, or `,`)
/// and discards bank metadata headers before the actual transaction table.
pub fn parse_delimited_text(text: &str) -> Result<ExtractedTable, IngestError> {
    let non_empty_lines: Vec<&str> = text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    if non_empty_lines.is_empty() {
        return Err(IngestError::EmptyInput);
    }

    let sample_lines = &non_empty_lines[..non_empty_lines.len().min(20)];
    let candidates = [';', '\t', ','];
    let mut best_delim = ';';
    let mut best_score = 0usize;

    for &delim in &candidates {
        let mut counts: HashMap<usize, usize> = HashMap::new();
        for line in sample_lines {
            let c = count_delimiter_outside_quotes(line, delim);
            if c >= 2 {
                *counts.entry(c).or_insert(0) += 1;
            }
        }
        // Score is (most frequent column count * number of rows sharing that count)
        if let Some((&col_splits, &freq)) = counts.iter().max_by_key(|&(&cols, &freq)| freq * 10 + cols) {
            let score = freq * 10 + col_splits;
            if score > best_score {
                best_score = score;
                best_delim = delim;
            }
        }
    }

    let mut raw_rows: Vec<Vec<String>> = Vec::with_capacity(non_empty_lines.len());
    for line in non_empty_lines {
        let fields = split_delimited_line(line, best_delim);
        if fields.iter().any(|f| !f.is_empty()) {
            raw_rows.push(fields);
        }
    }

    extract_structured_table_from_rows(raw_rows, Some(best_delim))
}

fn count_delimiter_outside_quotes(line: &str, delim: char) -> usize {
    let mut in_quotes = false;
    let mut count = 0;
    for ch in line.chars() {
        if ch == '"' {
            in_quotes = !in_quotes;
        } else if ch == delim && !in_quotes {
            count += 1;
        }
    }
    count
}

fn split_delimited_line(line: &str, delim: char) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '"' {
            if in_quotes && chars.peek() == Some(&'"') {
                current.push('"');
                let _ = chars.next();
            } else {
                in_quotes = !in_quotes;
            }
        } else if ch == delim && !in_quotes {
            fields.push(current.trim().to_string());
            current.clear();
        } else {
            current.push(ch);
        }
    }
    fields.push(current.trim().to_string());
    fields
}

/// Locates the table header row (or first data row if headless), discards metadata preamble rows,
/// and computes the deterministic `BLAKE3` `header_signature_hash`.
pub fn extract_structured_table_from_rows(
    raw_rows: Vec<Vec<String>>,
    detected_delimiter: Option<char>,
) -> Result<ExtractedTable, IngestError> {
    let mut header_row_idx: Option<usize> = None;
    let mut is_headless_data_start = false;

    for (idx, row) in raw_rows.iter().enumerate().take(25) {
        if row.len() < 2 {
            continue;
        }

        // Check how many cells contain recognizable header keywords
        let keyword_matches = row
            .iter()
            .filter(|cell| {
                let upper = cell.to_uppercase();
                HEADER_KEYWORDS.iter().any(|kw| upper.contains(kw))
            })
            .count();

        if keyword_matches >= 2 {
            header_row_idx = Some(idx);
            is_headless_data_start = false;
            break;
        }

        // Or check if this row already matches a valid Date + Monetary Amount pattern
        let has_date = row.iter().any(|c| parse_date_to_iso(c).is_ok());
        let has_amount = row
            .iter()
            .any(|c| !c.is_empty() && parse_date_to_iso(c).is_err() && parse_monetary_to_cents(c).is_ok());

        if has_date && has_amount && row.len() >= 3 {
            header_row_idx = Some(idx);
            is_headless_data_start = true;
            break;
        }
    }

    let start_idx = header_row_idx.ok_or(IngestError::NoTabularDataFound)?;
    let (headers, data_rows_slice) = if is_headless_data_start {
        let col_count = raw_rows[start_idx].len();
        let synthetic_headers: Vec<String> =
            (1..=col_count).map(|i| format!("Column {}", i)).collect();
        (synthetic_headers, &raw_rows[start_idx..])
    } else {
        (raw_rows[start_idx].clone(), &raw_rows[start_idx + 1..])
    };

    // Keep rows that have at least 2 non-empty cells and a valid date in at least one column
    let mut clean_rows = Vec::new();
    for row in data_rows_slice {
        let non_empty_count = row.iter().filter(|c| !c.trim().is_empty()).count();
        if non_empty_count >= 2 && row.iter().any(|c| parse_date_to_iso(c).is_ok()) {
            clean_rows.push(row.clone());
        }
    }

    let header_signature_hash = compute_header_signature_hash(&headers);

    Ok(ExtractedTable {
        headers,
        rows: clean_rows,
        header_signature_hash,
        detected_delimiter,
    })
}

pub fn compute_header_signature_hash(headers: &[String]) -> String {
    let normalized = headers
        .iter()
        .map(|h| h.trim().to_uppercase())
        .collect::<Vec<_>>()
        .join("|");
    blake3::hash(normalized.as_bytes()).to_hex().to_string()
}

// =============================================================================
// STAGE 3: Column Mapping & Bank Profile Matching
// =============================================================================

/// Returns the built-in bank profile presets for Portuguese & European institutions
/// specified in Section 4 Stage 3 of `app-bible.md`:
/// CGD, Millennium bcp, ActivoBank, BPI, Santander, Novo Banco, Moey!, Revolut, Wise.
pub fn builtin_bank_profiles() -> Vec<BankProfile> {
    let presets: Vec<(&str, Vec<&str>, usize, usize, AmountStrategy, Option<usize>, Option<usize>, Option<usize>, char)> = vec![
        (
            "Caixa Geral de Depósitos (CGD - Débito/Crédito)",
            vec!["Data mov.", "Data valor", "Descrição", "Débito", "Crédito", "Saldo contabilístico"],
            0,
            2,
            AmountStrategy::DebitCreditSplit,
            None,
            Some(3),
            Some(4),
            ',',
        ),
        (
            "Caixa Geral de Depósitos (CGD - Montante)",
            vec!["Data mov.", "Data valor", "Descrição", "Montante", "Saldo"],
            0,
            2,
            AmountStrategy::SingleSigned,
            Some(3),
            None,
            None,
            ',',
        ),
        (
            "Millennium bcp",
            vec!["Data Lançamento", "Data Valor", "Descrição", "Montante", "Moeda", "Saldo"],
            0,
            2,
            AmountStrategy::SingleSigned,
            Some(3),
            None,
            None,
            ',',
        ),
        (
            "ActivoBank",
            vec!["Data Lanc.", "Data Valor", "Descrição", "Valor", "Saldo"],
            0,
            2,
            AmountStrategy::SingleSigned,
            Some(3),
            None,
            None,
            ',',
        ),
        (
            "Banco BPI",
            vec!["Data Mov.", "Data Valor", "Descrição do Movimento", "Valor em EUR", "Saldo"],
            0,
            2,
            AmountStrategy::SingleSigned,
            Some(3),
            None,
            None,
            ',',
        ),
        (
            "Santander Totta",
            vec!["Data Operação", "Data Valor", "Descrição", "Montante", "Saldo Contabilístico"],
            0,
            2,
            AmountStrategy::SingleSigned,
            Some(3),
            None,
            None,
            ',',
        ),
        (
            "Novo Banco",
            vec!["Data Movimento", "Data Valor", "Descritivo", "Débito", "Crédito", "Saldo"],
            0,
            2,
            AmountStrategy::DebitCreditSplit,
            None,
            Some(3),
            Some(4),
            ',',
        ),
        (
            "Moey!",
            vec!["Data", "Data Valor", "Descrição", "Valor", "Saldo"],
            0,
            2,
            AmountStrategy::SingleSigned,
            Some(3),
            None,
            None,
            ',',
        ),
        (
            "Revolut",
            vec!["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"],
            2,
            4,
            AmountStrategy::SingleSigned,
            Some(5),
            None,
            None,
            '.',
        ),
        (
            "Wise",
            vec!["TransferWise ID", "Date", "Amount", "Currency", "Description", "Payment Reference", "Running Balance"],
            1,
            4,
            AmountStrategy::SingleSigned,
            Some(2),
            None,
            None,
            '.',
        ),
    ];

    presets
        .into_iter()
        .map(
            |(name, cols, date_idx, desc_idx, strategy, amt_idx, deb_idx, cred_idx, sep)| {
                let header_strings: Vec<String> = cols.into_iter().map(|s| s.to_string()).collect();
                let sig = compute_header_signature_hash(&header_strings);
                BankProfile {
                    id: format!("builtin_{}", &sig[..12]),
                    profile_name: name.to_string(),
                    header_signature_hash: sig,
                    date_col_idx: date_idx,
                    desc_col_idx: desc_idx,
                    amount_strategy: strategy,
                    amount_col_idx: amt_idx,
                    debit_col_idx: deb_idx,
                    credit_col_idx: cred_idx,
                    indicator_col_idx: None,
                    decimal_separator: sep,
                }
            },
        )
        .collect()
}

/// Matches an `ExtractedTable` against saved `BankProfile` records, built-in presets,
/// or unambiguous Portuguese/English header labels.
/// Note: If both *Data Movimento* (Transaction Date) and *Data Valor* (Value Date) exist,
/// defaults to *Data Movimento* per Section 4 Stage 4 of `app-bible.md`.
pub fn match_bank_profile(
    table: &ExtractedTable,
    saved_profiles: &[BankProfile],
) -> Option<BankProfile> {
    // 1. Check user-saved profiles by exact header_signature_hash
    if let Some(saved) = saved_profiles
        .iter()
        .find(|p| p.header_signature_hash == table.header_signature_hash)
    {
        return Some(saved.clone());
    }

    // 2. Check built-in presets by exact header_signature_hash
    let builtins = builtin_bank_profiles();
    if let Some(builtin) = builtins
        .into_iter()
        .find(|p| p.header_signature_hash == table.header_signature_hash)
    {
        return Some(builtin);
    }

    // 3. Heuristic match if headers explicitly contain unambiguous Date + Description + Amount/Debit/Credit labels
    let upper_headers: Vec<String> = table.headers.iter().map(|h| h.trim().to_uppercase()).collect();

    // Prefer "DATA MOV" / "DATA LANC" / "DATA OPER" / "STARTED DATE" / "DATA" over "DATA VALOR"
    let date_col_idx = upper_headers
        .iter()
        .position(|h| {
            (h.contains("DATA") || h.contains("DATE"))
                && !h.contains("VALOR")
                && !h.contains("COMPLETED")
        })
        .or_else(|| {
            upper_headers
                .iter()
                .position(|h| h.contains("DATA") || h.contains("DATE"))
        })?;

    let desc_col_idx = upper_headers.iter().position(|h| {
        h.contains("DESCRI")
            || h.contains("DETALHE")
            || h.contains("MOVIMENTO") && h != &upper_headers[date_col_idx]
            || h.contains("HISTORICO")
            || h.contains("HISTÓRICO")
    })?;

    let debit_col_idx = upper_headers
        .iter()
        .position(|h| h.contains("DÉBITO") || h.contains("DEBITO") || h == "DEBIT");
    let credit_col_idx = upper_headers
        .iter()
        .position(|h| h.contains("CRÉDITO") || h.contains("CREDITO") || h == "CREDIT");

    if let (Some(deb), Some(cred)) = (debit_col_idx, credit_col_idx) {
        return Some(BankProfile {
            id: format!("auto_{}", &table.header_signature_hash[..12]),
            profile_name: "Auto-Detected (Débito/Crédito)".to_string(),
            header_signature_hash: table.header_signature_hash.clone(),
            date_col_idx,
            desc_col_idx,
            amount_strategy: AmountStrategy::DebitCreditSplit,
            amount_col_idx: None,
            debit_col_idx: Some(deb),
            credit_col_idx: Some(cred),
            indicator_col_idx: None,
            decimal_separator: ',',
        });
    }

    let amount_col_idx = upper_headers.iter().position(|h| {
        (h.contains("VALOR") && !h.contains("DATA"))
            || h.contains("MONTANTE")
            || h.contains("IMPORTÂNCIA")
            || h.contains("IMPORTANCIA")
            || h == "AMOUNT"
            || h.contains("QUANTIA")
    })?;

    let indicator_col_idx = upper_headers
        .iter()
        .position(|h| h == "D/C" || h == "TIPO" || h == "SINAL");

    let amount_strategy = if indicator_col_idx.is_some() {
        AmountStrategy::UnsignedWithIndicator
    } else {
        AmountStrategy::SingleSigned
    };

    Some(BankProfile {
        id: format!("auto_{}", &table.header_signature_hash[..12]),
        profile_name: "Auto-Detected Profile".to_string(),
        header_signature_hash: table.header_signature_hash.clone(),
        date_col_idx,
        desc_col_idx,
        amount_strategy,
        amount_col_idx: Some(amount_col_idx),
        debit_col_idx: None,
        credit_col_idx: None,
        indicator_col_idx,
        decimal_separator: ',',
    })
}

// =============================================================================
// STAGE 4: Data Normalization & Zero-Float Cents Conversion
// =============================================================================

/// Resolves `DD-MM-YYYY`, `DD/MM/YYYY`, `YYYY/MM/DD`, `YYYY-MM-DD`, timestamps,
/// and Portuguese/English textual months (`20 Out 2026`, `05 Fev 2026`) into strict `YYYY-MM-DD`.
pub fn parse_date_to_iso(raw: &str) -> Result<String, IngestError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(IngestError::InvalidDate("empty".to_string()));
    }

    // Take date portion if timestamp (e.g., "2026-10-20 14:22:00" or "2026-10-20T14:22:00")
    let date_token = trimmed
        .split(['T', ' '])
        .next()
        .unwrap_or(trimmed);

    // Check numeric formats separated by '-', '/', or '.'
    let parts: Vec<&str> = date_token.split(['-', '/', '.']).collect();
    if parts.len() == 3
        && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
    {
        let p0: u32 = parts[0]
            .parse()
            .map_err(|_| IngestError::InvalidDate(raw.to_string()))?;
        let p1: u32 = parts[1]
            .parse()
            .map_err(|_| IngestError::InvalidDate(raw.to_string()))?;
        let p2: u32 = parts[2]
            .parse()
            .map_err(|_| IngestError::InvalidDate(raw.to_string()))?;

        let (year, month, day) = if parts[0].len() == 4 {
            (p0, p1, p2)
        } else if parts[2].len() == 4 {
            (p2, p1, p0)
        } else if parts[2].len() == 2 {
            (2000 + p2, p1, p0)
        } else {
            return Err(IngestError::InvalidDate(raw.to_string()));
        };

        if (1970..=2100).contains(&year) && (1..=12).contains(&month) && (1..=31).contains(&day) {
            return Ok(format!("{:04}-{:02}-{:02}", year, month, day));
        }
    }

    // Check textual Portuguese / English month format: e.g. "20 Out 2026", "20-Out-2026", "20 de Outubro de 2026"
    let cleaned_upper = trimmed
        .to_uppercase()
        .replace(" DE ", " ")
        .replace(['-', '/', ','], " ");
    let words: Vec<&str> = cleaned_upper.split_whitespace().collect();
    if words.len() >= 3 {
        if let (Ok(day), Some(month), Ok(year)) = (
            words[0].parse::<u32>(),
            parse_pt_or_en_month(words[1]),
            words[2].parse::<u32>(),
        ) {
            let full_year = if year < 100 { 2000 + year } else { year };
            if (1970..=2100).contains(&full_year) && (1..=31).contains(&day) {
                return Ok(format!("{:04}-{:02}-{:02}", full_year, month, day));
            }
        }
    }

    Err(IngestError::InvalidDate(raw.to_string()))
}

fn parse_pt_or_en_month(token: &str) -> Option<u32> {
    let prefix = if token.len() >= 3 { &token[..3] } else { token };
    match prefix {
        "JAN" => Some(1),
        "FEV" | "FEB" => Some(2),
        "MAR" => Some(3),
        "ABR" | "APR" => Some(4),
        "MAI" | "MAY" => Some(5),
        "JUN" => Some(6),
        "JUL" => Some(7),
        "AGO" | "AUG" => Some(8),
        "SET" | "SEP" => Some(9),
        "OUT" | "OCT" => Some(10),
        "NOV" => Some(11),
        "DEZ" | "DEC" => Some(12),
        _ => None,
    }
}

/// Strictly zero-float parser that converts European (`1.450,75 €`, `-45,00`) or
/// Anglo (`1,450.75`, `$45.00`) monetary strings into `Cents(i64)`.
pub fn parse_monetary_to_cents(raw: &str) -> Result<Cents, IngestError> {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return Err(IngestError::InvalidAmount("empty".to_string()));
    }

    // Detect negative sign: leading '-', trailing '-', or accounting parentheses '(123,45)'
    let mut is_negative = false;
    if s.starts_with('(') && s.ends_with(')') {
        is_negative = true;
        s = s[1..s.len() - 1].to_string();
    }

    // Keep only digits, '+', '-', ',', '.'
    let filtered: String = s
        .chars()
        .filter(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | ',' | '.'))
        .collect();

    if filtered.is_empty() || !filtered.chars().any(|c| c.is_ascii_digit()) {
        return Err(IngestError::InvalidAmount(raw.to_string()));
    }

    if filtered.contains('-') {
        is_negative = true;
    }

    let unsigned: String = filtered
        .chars()
        .filter(|c| c.is_ascii_digit() || matches!(c, ',' | '.'))
        .collect();

    // Inspect position of the last separator (',' or '.') relative to the end of the string
    let last_sep_pos = unsigned.rfind([',', '.']);
    let (major_digits, minor_digits) = match last_sep_pos {
        Some(pos) => {
            let after_sep = &unsigned[pos + 1..];
            let before_sep = &unsigned[..pos];
            // If 1 or 2 digits follow the last separator, it is the decimal separator!
            // If 3 digits follow and there is only one separator (e.g. "1.000"), it's a thousands separator unless Anglo/Euro context,
            // wait: in bank exports, decimal amounts have 1 or 2 digits after the last separator (or 0).
            if after_sep.len() <= 2 {
                let clean_major: String =
                    before_sep.chars().filter(|c| c.is_ascii_digit()).collect();
                let clean_minor: String =
                    after_sep.chars().filter(|c| c.is_ascii_digit()).collect();
                (clean_major, clean_minor)
            } else {
                // All separators are thousands separators (e.g. "1.000")
                let clean_major: String = unsigned.chars().filter(|c| c.is_ascii_digit()).collect();
                (clean_major, String::new())
            }
        }
        None => (unsigned, String::new()),
    };

    let major: i64 = if major_digits.is_empty() {
        0
    } else {
        major_digits
            .parse::<i64>()
            .map_err(|_| IngestError::InvalidAmount(raw.to_string()))?
    };

    let minor: i64 = match minor_digits.len() {
        0 => 0,
        1 => {
            minor_digits
                .parse::<i64>()
                .map_err(|_| IngestError::InvalidAmount(raw.to_string()))?
                * 10
        }
        2 => minor_digits
            .parse::<i64>()
            .map_err(|_| IngestError::InvalidAmount(raw.to_string()))?,
        _ => return Err(IngestError::InvalidAmount(raw.to_string())),
    };

    let total_abs = major
        .checked_mul(100)
        .and_then(|m| m.checked_add(minor))
        .ok_or_else(|| IngestError::InvalidAmount(raw.to_string()))?;

    let signed = if is_negative { -total_abs } else { total_abs };
    Ok(Cents::new(signed))
}

/// Resolves the signed transaction amount in cents for a table row using the `BankProfile`'s `AmountStrategy`.
pub fn resolve_row_amount_cents(row: &[String], profile: &BankProfile) -> Result<Cents, IngestError> {
    match profile.amount_strategy {
        AmountStrategy::SingleSigned => {
            let idx = profile
                .amount_col_idx
                .ok_or_else(|| IngestError::InvalidAmount("Missing amount_col_idx".to_string()))?;
            let cell = row
                .get(idx)
                .ok_or_else(|| IngestError::InvalidAmount("Row shorter than amount_col_idx".to_string()))?;
            parse_monetary_to_cents(cell)
        }
        AmountStrategy::DebitCreditSplit => {
            let deb_idx = profile
                .debit_col_idx
                .ok_or_else(|| IngestError::InvalidAmount("Missing debit_col_idx".to_string()))?;
            let cred_idx = profile
                .credit_col_idx
                .ok_or_else(|| IngestError::InvalidAmount("Missing credit_col_idx".to_string()))?;

            let deb_str = row.get(deb_idx).map(|s| s.trim()).unwrap_or("");
            let cred_str = row.get(cred_idx).map(|s| s.trim()).unwrap_or("");

            if !deb_str.is_empty() {
                if let Ok(c) = parse_monetary_to_cents(deb_str) {
                    if c.as_i64() != 0 {
                        return Ok(Cents::new(-(c.as_i64().abs())));
                    }
                }
            }
            if !cred_str.is_empty() {
                if let Ok(c) = parse_monetary_to_cents(cred_str) {
                    if c.as_i64() != 0 {
                        return Ok(Cents::new(c.as_i64().abs()));
                    }
                }
            }
            Ok(Cents::ZERO)
        }
        AmountStrategy::UnsignedWithIndicator => {
            let amt_idx = profile
                .amount_col_idx
                .ok_or_else(|| IngestError::InvalidAmount("Missing amount_col_idx".to_string()))?;
            let ind_idx = profile
                .indicator_col_idx
                .ok_or_else(|| IngestError::InvalidAmount("Missing indicator_col_idx".to_string()))?;

            let amt_cell = row
                .get(amt_idx)
                .ok_or_else(|| IngestError::InvalidAmount("Missing amount cell".to_string()))?;
            let ind_cell = row
                .get(ind_idx)
                .map(|s| s.trim().to_uppercase())
                .unwrap_or_default();

            let parsed = parse_monetary_to_cents(amt_cell)?;
            let abs_val = parsed.as_i64().abs();
            if ind_cell.starts_with('D') || ind_cell.contains("DEB") {
                Ok(Cents::new(-abs_val))
            } else {
                Ok(Cents::new(abs_val))
            }
        }
    }
}

// =============================================================================
// STAGE 5: In-Memory PII Scrubber (Anonymization & Noise Reduction)
// =============================================================================

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScrubbedDescription {
    /// Sanitized raw bank string with PII masked (stored in `raw_bank_string`)
    pub scrubbed_raw: String,
    /// Clean merchant/counterparty display string with boilerplate & PII removed (`clean_description`)
    pub clean_description: String,
}

const BOILERPLATE_PREFIXES: &[&str] = &[
    "COMPRA ELEC ",
    "COMPRA CARTAO ",
    "COMPRA ",
    "PAGAMENTO SERVICOS ",
    "PAGAMENTO DE SERVICOS ",
    "PAG. SERVICOS ",
    "TRF MB WAY P/ ",
    "TRF MB WAY DE ",
    "TRF. MB WAY P/ ",
    "MB WAY P/ ",
    "MB WAY DE ",
    "TRANSFERENCIA P/ ",
    "TRANSFERENCIA DE ",
    "TRF SEPA+ P/ ",
    "TRF SEPA P/ ",
    "DEBITO DIRETO ",
    "DEB DIRETO ",
    "DD ",
    "LEVANTAMENTO ATM ",
    "LEV ATM ",
];

/// Scrubs Portuguese phone numbers (MB WAY), IBANs, and 16-digit Card PANs in RAM,
/// and strips repetitive banking boilerplate prefixes into `clean_description`.
pub fn scrub_pii_and_noise(raw_description: &str) -> ScrubbedDescription {
    static IBAN_RE: OnceLock<Regex> = OnceLock::new();
    static PAN_RE: OnceLock<Regex> = OnceLock::new();
    static PT_PHONE_RE: OnceLock<Regex> = OnceLock::new();

    // Matches 21-to-34 alphanumeric IBANs starting with 2 letters + 2 digits (contiguous or 4-char spaced blocks)
    let iban_re = IBAN_RE.get_or_init(|| {
        Regex::new(
            r"(?i)\b([A-Z]{2}\d{2}(?:[A-Z0-9]{17,30}|(?:\s+[A-Z0-9]{4}){3,7}(?:\s+\d{1,4})?))\b",
        )
        .unwrap()
    });

    // Matches 16-digit card PANs (full or partially masked with * or X)
    let pan_re = PAN_RE.get_or_init(|| {
        Regex::new(r"\b(?:\d{4}[\s\-]?[\d\*X]{4}[\s\-]?[\d\*X]{4}[\s\-]?|\*{4,12}[\s\-]?)(\d{4})\b")
            .unwrap()
    });

    // Matches Portuguese mobile numbers (91, 92, 93, 96 followed by 7 digits, with optional +351 / 00351)
    let pt_phone_re = PT_PHONE_RE.get_or_init(|| {
        Regex::new(r"(?:(?:\+351|00351)[\s\-]?)?\b(9[1236]\d[\s\-]?\d{3}[\s\-]?\d{3})\b")
            .unwrap()
    });

    // 1. Mask IBANs to `PT50...1234` (preserving first 4 and last 4 alphanumeric characters)
    let after_iban = iban_re.replace_all(raw_description.trim(), |caps: &regex::Captures| {
        let alnum: String = caps[0]
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect();
        let prefix = &alnum[..4].to_uppercase();
        let last4 = &alnum[alnum.len().saturating_sub(4)..];
        format!("{}...{}", prefix, last4)
    });

    // 2. Mask Card PANs to `Card *1234`
    let after_pan = pan_re.replace_all(&after_iban, "Card *$1");

    // 3. Mask Portuguese phone numbers to `[PHONE]` in scrubbed_raw and strip in clean_description
    let scrubbed_raw = pt_phone_re
        .replace_all(&after_pan, "[PHONE]")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    let without_phone = pt_phone_re.replace_all(&after_pan, " ");
    let mut clean = without_phone
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    // 4. Strip repetitive banking boilerplate prefixes
    let upper_clean = clean.to_uppercase();
    for prefix in BOILERPLATE_PREFIXES {
        if upper_clean.starts_with(prefix) {
            let remainder = clean[prefix.len()..].trim();
            if !remainder.is_empty() {
                clean = remainder.to_string();
                break;
            }
        }
    }

    // Strip leading/trailing separators left over after phone/prefix removal
    clean = clean
        .trim_matches(|c: char| matches!(c, '-' | '/' | ':' | ' '))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if clean.is_empty() {
        clean = scrubbed_raw.clone();
    }

    ScrubbedDescription {
        scrubbed_raw,
        clean_description: clean,
    }
}

// =============================================================================
// STAGE 6: Composite BLAKE3 Deduplication Engine
// =============================================================================

/// Generates the deterministic composite fingerprint per Section 4 Stage 6 of `app-bible.md`:
/// `Hash = BLAKE3(AccountID || ISO_Date || AmountCents || NormalizedRawDescription || SameDaySequenceIndex)`
pub fn compute_dedup_hash(
    account_id: &str,
    iso_date: &str,
    amount_cents: i64,
    normalized_raw_description: &str,
    same_day_sequence_index: u32,
) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(account_id.trim().as_bytes());
    hasher.update(b"||");
    hasher.update(iso_date.trim().as_bytes());
    hasher.update(b"||");
    hasher.update(amount_cents.to_string().as_bytes());
    hasher.update(b"||");
    let norm_desc = normalized_raw_description
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase();
    hasher.update(norm_desc.as_bytes());
    hasher.update(b"||");
    hasher.update(same_day_sequence_index.to_string().as_bytes());
    hasher.finalize().to_hex().to_string()
}

// =============================================================================
// STAGE 7: Full Pipeline Orchestration (Multi-Threaded via Rayon)
// =============================================================================

#[derive(Debug)]
struct IndexedRawCandidate {
    iso_date: String,
    amount_cents: i64,
    raw_description: String,
    sequence_index: u32,
}

/// Runs Stages 3 through 7 on an `ExtractedTable`.
pub fn process_extracted_table(
    account_id: &str,
    table: ExtractedTable,
    saved_profiles: &[BankProfile],
    explicit_profile_override: Option<BankProfile>,
    existing_dedup_hashes: &HashSet<String>,
    rule_engine: &RuleMatcherEngine,
) -> Result<IngestionOutcome, IngestError> {
    let profile = match explicit_profile_override
        .or_else(|| match_bank_profile(&table, saved_profiles))
    {
        Some(p) => p,
        None => {
            let sample_rows = table.rows.iter().take(10).cloned().collect();
            return Ok(IngestionOutcome::NeedsColumnMapping {
                header_signature_hash: table.header_signature_hash,
                headers: table.headers,
                sample_rows,
                all_rows: table.rows,
            });
        }
    };

    // Stage 4 + Stage 6 sequence index assignment (sequential pass to assign deterministic
    // SameDaySequenceIndex for identical (date, amount, description) rows within the file)
    let mut sequence_counters: HashMap<(String, i64, String), u32> = HashMap::new();
    let mut candidates: Vec<IndexedRawCandidate> = Vec::with_capacity(table.rows.len());

    for row in &table.rows {
        let Some(date_cell) = row.get(profile.date_col_idx) else {
            continue;
        };
        let Ok(iso_date) = parse_date_to_iso(date_cell) else {
            continue;
        };
        let Ok(amount) = resolve_row_amount_cents(row, &profile) else {
            continue;
        };
        let raw_description = row
            .get(profile.desc_col_idx)
            .cloned()
            .unwrap_or_default();

        let norm_desc_key = raw_description
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_uppercase();

        let seq_key = (iso_date.clone(), amount.as_i64(), norm_desc_key);
        let seq_idx = sequence_counters
            .entry(seq_key)
            .and_modify(|c| *c += 1)
            .or_insert(1);

        candidates.push(IndexedRawCandidate {
            iso_date,
            amount_cents: amount.as_i64(),
            raw_description,
            sequence_index: *seq_idx,
        });
    }

    // Parallel worker pool (`Rayon`) executing Stage 5 (PII Scrubber), Stage 6 (BLAKE3 Hash & Dedup check),
    // and Stage 7 (3-Tier Rule & Historical Fuzzy Categorization)
    let staged_transactions: Vec<StagedTransaction> = candidates
        .into_par_iter()
        .map(|cand| {
            let scrubbed = scrub_pii_and_noise(&cand.raw_description);
            let dedup_hash = compute_dedup_hash(
                account_id,
                &cand.iso_date,
                cand.amount_cents,
                &scrubbed.scrubbed_raw,
                cand.sequence_index,
            );

            let is_duplicate = existing_dedup_hashes.contains(&dedup_hash);
            let cat_match = rule_engine.evaluate(
                account_id,
                &scrubbed.clean_description,
                &scrubbed.scrubbed_raw,
            );

            let status = if is_duplicate {
                StagingStatus::AlreadyImported
            } else if let Some(ref m) = cat_match {
                if m.is_suggested {
                    StagingStatus::Suggested
                } else {
                    StagingStatus::RuleMatched
                }
            } else {
                StagingStatus::New
            };

            let (entity_id, category_id) = match &cat_match {
                Some(m) => (m.entity_id.clone(), m.category_id.clone()),
                None => (None, None),
            };

            StagedTransaction {
                staging_id: new_uuid_v7(),
                account_id: account_id.to_string(),
                date_posted: cand.iso_date,
                total_amount_cents: cand.amount_cents,
                raw_bank_string: scrubbed.scrubbed_raw,
                clean_description: scrubbed.clean_description,
                same_day_sequence_index: cand.sequence_index,
                dedup_hash,
                status,
                entity_id,
                category_id,
                categorization_match: cat_match,
            }
        })
        .collect();

    Ok(IngestionOutcome::Mapped {
        matched_profile: profile,
        staged_transactions,
    })
}

/// High-level entry point to ingest raw bytes from any supported `SourceFormat`.
pub fn run_ingestion_pipeline(
    account_id: &str,
    raw_bytes: &[u8],
    format: SourceFormat,
    saved_profiles: &[BankProfile],
    explicit_profile_override: Option<BankProfile>,
    existing_dedup_hashes: &HashSet<String>,
     (rules, entities, historical): (
        Vec<crate::models::ImportRule>,
        Vec<crate::models::Entity>,
        Vec<HistoricalExemplar>,
    ),
) -> Result<IngestionOutcome, IngestError> {
    let table = match format {
        SourceFormat::CsvOrTsv | SourceFormat::ClipboardPlain => {
            let utf8_text = decode_bytes_to_utf8(raw_bytes);
            parse_delimited_text(&utf8_text)?
        }
        SourceFormat::ClipboardHtml => {
            let utf8_html = decode_bytes_to_utf8(raw_bytes);
            parse_clipboard_html_table(&utf8_html)?
        }
        SourceFormat::Excel => parse_excel_bytes(raw_bytes)?,
        SourceFormat::Pdf => parse_pdf_bytes(raw_bytes)?,
    };

    let rule_engine = RuleMatcherEngine::new(rules, &entities, historical);
    process_extracted_table(
        account_id,
        table,
        saved_profiles,
        explicit_profile_override,
        existing_dedup_hashes,
        &rule_engine,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::VaultEngine;
    use crate::models::{AccountType, CategoryDirection};

    #[test]
    fn test_edge_case_1_same_day_double_espresso() {
        // Section 8 Edge Case 1:
        // "Importing a statement where the user bought two 1,00 € coffees at the exact same
        // merchant on the same day must import both rows on the first upload, and skip both
        // rows if the exact same statement is uploaded a second time."
        let mut vault = VaultEngine::open_in_memory().unwrap();
        let account = vault
            .create_account("ActivoBank", AccountType::Checking, 50_000, "2026-10-01", true)
            .unwrap();

        let csv_statement = "\
Data Lanc.;Data Valor;Descrição;Valor;Saldo
20-10-2026;20-10-2026;COMPRA ELEC DELTA Q CAFE;-1,00;499,00
20-10-2026;20-10-2026;COMPRA ELEC DELTA Q CAFE;-1,00;498,00
";

        // First upload
        let existing_hashes = vault.get_existing_dedup_hashes(&account.id).unwrap();
        let outcome1 = run_ingestion_pipeline(
            &account.id,
            csv_statement.as_bytes(),
            SourceFormat::CsvOrTsv,
            &[],
            None,
            &existing_hashes,
            (vec![], vec![], vec![]),
        )
        .unwrap();

        let staged1 = match outcome1 {
            IngestionOutcome::Mapped {
                staged_transactions,
                ..
            } => staged_transactions,
            _ => panic!("Expected Mapped outcome"),
        };

        assert_eq!(staged1.len(), 2);
        assert_eq!(staged1[0].same_day_sequence_index, 1);
        assert_eq!(staged1[1].same_day_sequence_index, 2);
        assert_ne!(staged1[0].dedup_hash, staged1[1].dedup_hash);
        assert_eq!(staged1[0].status, StagingStatus::New);
        assert_eq!(staged1[1].status, StagingStatus::New);

        // Commit both rows to the vault
        for st in &staged1 {
            vault
                .insert_transaction_with_splits(
                    &account.id,
                    None,
                    &st.date_posted,
                    st.total_amount_cents,
                    &st.raw_bank_string,
                    &st.clean_description,
                    &st.dedup_hash,
                    false,
                    vec![(None, None, st.total_amount_cents, None)],
                )
                .unwrap();
        }

        // Second upload of the exact same statement
        let existing_hashes_after = vault.get_existing_dedup_hashes(&account.id).unwrap();
        let outcome2 = run_ingestion_pipeline(
            &account.id,
            csv_statement.as_bytes(),
            SourceFormat::CsvOrTsv,
            &[],
            None,
            &existing_hashes_after,
            (vec![], vec![], vec![]),
        )
        .unwrap();

        let staged2 = match outcome2 {
            IngestionOutcome::Mapped {
                staged_transactions,
                ..
            } => staged_transactions,
            _ => panic!("Expected Mapped outcome"),
        };

        assert_eq!(staged2.len(), 2);
        assert_eq!(staged2[0].status, StagingStatus::AlreadyImported);
        assert_eq!(staged2[1].status, StagingStatus::AlreadyImported);
    }

    #[test]
    fn test_edge_case_2_overlapping_statement() {
        // Section 8 Edge Case 2:
        // "Uploading a CSV covering Oct 1 – Oct 15, followed a week later by a CSV covering
        // Oct 10 – Oct 25, must accurately skip the Oct 10 – Oct 15 overlap while importing Oct 16 – Oct 25."
        let mut vault = VaultEngine::open_in_memory().unwrap();
        let account = vault
            .create_account("Millennium", AccountType::Checking, 100_000, "2026-10-01", true)
            .unwrap();

        let csv_oct_1_to_15 = "\
Data Lançamento;Data Valor;Descrição;Montante;Moeda;Saldo
2026-10-03;2026-10-03;COMPRA CONTINENTE;-45,20;EUR;954,80
2026-10-10;2026-10-10;PAGAMENTO SERVICOS EDP;-62,10;EUR;892,70
2026-10-15;2026-10-15;COMPRA PINGO DOCE;-30,00;EUR;862,70
";

        let existing1 = vault.get_existing_dedup_hashes(&account.id).unwrap();
        let IngestionOutcome::Mapped {
            staged_transactions: batch1,
            ..
        } = run_ingestion_pipeline(
            &account.id,
            csv_oct_1_to_15.as_bytes(),
            SourceFormat::CsvOrTsv,
            &[],
            None,
            &existing1,
            (vec![], vec![], vec![]),
        )
        .unwrap()
        else {
            panic!("Expected mapped batch 1");
        };

        assert_eq!(batch1.len(), 3);
        for st in &batch1 {
            assert_eq!(st.status, StagingStatus::New);
            vault
                .insert_transaction_with_splits(
                    &account.id,
                    None,
                    &st.date_posted,
                    st.total_amount_cents,
                    &st.raw_bank_string,
                    &st.clean_description,
                    &st.dedup_hash,
                    false,
                    vec![(None, None, st.total_amount_cents, None)],
                )
                .unwrap();
        }

        // Now upload overlapping CSV covering Oct 10 – Oct 25
        let csv_oct_10_to_25 = "\
Data Lançamento;Data Valor;Descrição;Montante;Moeda;Saldo
2026-10-10;2026-10-10;PAGAMENTO SERVICOS EDP;-62,10;EUR;892,70
2026-10-15;2026-10-15;COMPRA PINGO DOCE;-30,00;EUR;862,70
2026-10-18;2026-10-18;COMPRA FNAC LISBOA;-19,99;EUR;842,71
2026-10-25;2026-10-25;TRF SALARIO OUTUBRO;+1.850,00;EUR;2.692,71
";

        let existing2 = vault.get_existing_dedup_hashes(&account.id).unwrap();
        let IngestionOutcome::Mapped {
            staged_transactions: batch2,
            ..
        } = run_ingestion_pipeline(
            &account.id,
            csv_oct_10_to_25.as_bytes(),
            SourceFormat::CsvOrTsv,
            &[],
            None,
            &existing2,
            (vec![], vec![], vec![]),
        )
        .unwrap()
        else {
            panic!("Expected mapped batch 2");
        };

        assert_eq!(batch2.len(), 4);
        // Oct 10 and Oct 15 must be flagged as AlreadyImported (Skipped)
        assert_eq!(batch2[0].date_posted, "2026-10-10");
        assert_eq!(batch2[0].status, StagingStatus::AlreadyImported);
        assert_eq!(batch2[1].date_posted, "2026-10-15");
        assert_eq!(batch2[1].status, StagingStatus::AlreadyImported);

        // Oct 18 and Oct 25 must be flagged as New
        assert_eq!(batch2[2].date_posted, "2026-10-18");
        assert_eq!(batch2[2].status, StagingStatus::New);
        assert_eq!(batch2[2].total_amount_cents, -1999);
        assert_eq!(batch2[3].date_posted, "2026-10-25");
        assert_eq!(batch2[3].status, StagingStatus::New);
        assert_eq!(batch2[3].total_amount_cents, 185_000);
    }

    #[test]
    fn test_edge_case_3_portuguese_encoding_iso_8859_1_and_windows_1252() {
        // Section 8 Edge Case 3:
        // "Uploading an ISO-8859-1 CSV from CGD or Millennium containing "RESTAURAÇÃO",
        // "FARMÁCIA SÃO JOÃO", and "1.450,75 €" must render zero replacement characters
        // and parse the integer value 145075."
        let utf8_source = "\
Conta: PT50003500001234567890123
Exportado em: 20/10/2026
Data mov.;Data valor;Descrição;Débito;Crédito;Saldo contabilístico
20-10-2026;20-10-2026;COMPRA ELEC RESTAURAÇÃO LISBOA;25,50;;1.425,25 €
21-10-2026;21-10-2026;FARMÁCIA SÃO JOÃO;;1.450,75 €;2.876,00 €
";

        // Encode into legacy Windows-1252 / ISO-8859-1 bytes
        let (encoded_bytes, _, _) = WINDOWS_1252.encode(utf8_source);
        // Confirm it is NOT valid UTF-8 in raw byte form
        assert!(std::str::from_utf8(&encoded_bytes).is_err());

        let vault = VaultEngine::open_in_memory().unwrap();
        let cat = vault
            .create_category(None, "Saúde", CategoryDirection::Expense, "#10b981")
            .unwrap();
        let ent = vault
            .create_entity("Farmácia São João", Some(&cat.id), None)
            .unwrap();
        let rule = vault
            .create_import_rule(
                 crate::models::MatchMode::Contains,
                "FARMÁCIA SÃO JOÃO",
                None,
                Some(&ent.id),
                None,
                100,
            )
            .unwrap();

        let IngestionOutcome::Mapped {
            matched_profile,
            staged_transactions,
        } = run_ingestion_pipeline(
            "acc_cgd",
            &encoded_bytes,
            SourceFormat::CsvOrTsv,
            &[],
            None,
            &HashSet::new(),
            (vec![rule], vec![ent], vec![]),
        )
        .unwrap()
        else {
            panic!("Expected mapped CGD statement");
        };

        assert!(matched_profile.profile_name.contains("CGD"));
        assert_eq!(staged_transactions.len(), 2);

        // Verify zero '\u{FFFD}' replacement characters and exact strings
        assert!(!staged_transactions[0].raw_bank_string.contains('\u{FFFD}'));
        assert_eq!(
            staged_transactions[0].clean_description,
            "RESTAURAÇÃO LISBOA"
        );
        assert_eq!(staged_transactions[0].total_amount_cents, -2550);

        assert!(!staged_transactions[1].raw_bank_string.contains('\u{FFFD}'));
        assert_eq!(
            staged_transactions[1].clean_description,
            "FARMÁCIA SÃO JOÃO"
        );
        assert_eq!(staged_transactions[1].total_amount_cents, 145_075);
        assert_eq!(staged_transactions[1].status, StagingStatus::RuleMatched);
        assert_eq!(
            staged_transactions[1].category_id.as_deref(),
            Some(cat.id.as_str())
        );
    }

    #[test]
    fn test_stage_5_pii_scrubber_phone_iban_and_card_pan() {
        let s1 = scrub_pii_and_noise("TRF MB WAY P/ 912 345 678 JOAO SILVA");
        assert_eq!(s1.scrubbed_raw, "TRF MB WAY P/ [PHONE] JOAO SILVA");
        assert_eq!(s1.clean_description, "JOAO SILVA");

        let s2 = scrub_pii_and_noise("TRANSFERENCIA P/ PT50 0035 0651 0001 2345 6783 3 SENHORIO");
        assert_eq!(s2.scrubbed_raw, "TRANSFERENCIA P/ PT50...7833 SENHORIO");
        assert_eq!(s2.clean_description, "PT50...7833 SENHORIO");

        let s3 = scrub_pii_and_noise("COMPRA ELEC 4532********9876 CONTINENTE COLOMBO");
        assert_eq!(s3.scrubbed_raw, "COMPRA ELEC Card *9876 CONTINENTE COLOMBO");
        assert_eq!(s3.clean_description, "Card *9876 CONTINENTE COLOMBO");
    }

    #[test]
    fn test_clipboard_html_and_pdf_coordinate_reconstruction() {
        let html = r#"
        <table>
            <tr><th>Data</th><th>Descrição</th><th>Valor</th></tr>
            <tr><td>20 Out 2026</td><td>COMPRA ELEC UBER TRIP</td><td>-12,40 €</td></tr>
        </table>
        "#;
        let table = parse_clipboard_html_table(html).unwrap();
        assert_eq!(table.rows.len(), 1);
        assert_eq!(parse_date_to_iso(&table.rows[0][0]).unwrap(), "2026-10-20");
        assert_eq!(
            parse_monetary_to_cents(&table.rows[0][2]).unwrap().as_i64(),
            -1240
        );

        // PDF coordinate grouping within 2pt Y tolerance
        let tokens = vec![
            PdfPositionedToken {
                x: 40.0,
                y: 700.0,
                text: "Data".to_string(),
            },
            PdfPositionedToken {
                x: 150.0,
                y: 701.2,
                text: "Descrição".to_string(),
            },
            PdfPositionedToken {
                x: 420.0,
                y: 699.5,
                text: "Montante".to_string(),
            },
            PdfPositionedToken {
                x: 40.0,
                y: 680.0,
                text: "20-10-2026".to_string(),
            },
            PdfPositionedToken {
                x: 150.0,
                y: 680.8,
                text: "PADARIA PORTUGUESA".to_string(),
            },
            PdfPositionedToken {
                x: 420.0,
                y: 679.2,
                text: "-4,50 €".to_string(),
            },
        ];
        let pdf_rows = reconstruct_pdf_rows_from_tokens(tokens);
        assert_eq!(pdf_rows.len(), 2);
        let extracted = extract_structured_table_from_rows(pdf_rows, None).unwrap();
        assert_eq!(extracted.headers, vec!["Data", "Descrição", "Montante"]);
        assert_eq!(extracted.rows.len(), 1);
    }
}
