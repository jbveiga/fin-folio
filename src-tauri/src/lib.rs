pub mod crypto;
pub mod db;
pub mod ingest;
pub mod models;
pub mod rules;

use db::VaultEngine;
use ingest::{
    run_ingestion_pipeline, IngestionOutcome, SourceFormat, StagingStatus,
};
use models::{
    new_uuid_v7, Account, AccountBalanceSummary, BankProfile, Category, Entity, ImportRule,
    MatchMode, TransactionWithSplits,
};
use rules::{CategorizationMatch, RuleMatchTier, RuleMatcherEngine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub vault: Mutex<Option<VaultEngine>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultStatus {
    pub is_open: bool,
    pub path: Option<String>,
    pub is_encrypted: bool,
    pub is_memory_locked: bool,
    pub schema_version: u32,
    pub base_currency: String,
    pub cycle_start_day: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagedTransactionRowDto {
    pub temp_id: String,
    pub date_posted: String,
    pub amount_cents: i64,
    pub raw_description: String,
    pub clean_description: String,
    pub entity_id: Option<String>,
    pub entity_name: Option<String>,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub dedup_hash: String,
    pub status: StagingStatus,
    pub suggestion_confidence: Option<f64>,
    pub matched_rule_id: Option<String>,
    pub is_selected_for_import: bool,
    pub auto_learn_rule: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseStatementResultDto {
    pub header_matched: bool,
    pub profile_name: Option<String>,
    pub header_signature_hash: String,
    pub needs_column_mapping: bool,
    pub raw_sample_rows: Vec<Vec<String>>,
    pub all_raw_rows: Vec<Vec<String>>,
    pub detected_columns: Vec<String>,
    pub staged_rows: Vec<StagedTransactionRowDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitResultDto {
    pub imported_count: usize,
    pub rules_created: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerQueryResultDto {
    pub transactions: Vec<TransactionWithSplits>,
    pub total_count: usize,
    pub period_inflow_cents: i64,
    pub period_outflow_cents: i64,
    pub net_cash_flow_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveTransactionInput {
    pub id: Option<String>,
    pub account_id: String,
    pub entity_id: Option<String>,
    pub entity_name: Option<String>,
    pub date_posted: String,
    pub total_amount_cents: i64,
    pub raw_bank_string: String,
    pub clean_description: String,
    pub is_reconciled: bool,
    pub splits: Vec<SaveSplitInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveSplitInput {
    pub category_id: Option<String>,
    pub transfer_peer_account_id: Option<String>,
    pub split_amount_cents: i64,
    pub notes: Option<String>,
}

fn with_vault<F, R>(state: &State<'_, AppState>, f: F) -> Result<R, String>
where
    F: FnOnce(&mut VaultEngine) -> Result<R, String>,
{
    let mut guard = state.vault.lock().map_err(|e| e.to_string())?;
    let vault = guard
        .as_mut()
        .ok_or_else(|| "Vault is currently locked or closed".to_string())?;
    f(vault)
}

fn build_vault_status(vault_opt: Option<&VaultEngine>) -> Result<VaultStatus, String> {
    match vault_opt {
        Some(v) => {
            let meta = v.get_metadata().map_err(|e| e.to_string())?;
            Ok(VaultStatus {
                is_open: true,
                path: v.vault_path_string(),
                is_encrypted: v.is_encrypted(),
                is_memory_locked: v.is_key_memory_locked(),
                schema_version: meta.schema_version,
                base_currency: meta.base_currency,
                cycle_start_day: meta.cycle_start_day,
            })
        }
        None => Ok(VaultStatus {
            is_open: false,
            path: None,
            is_encrypted: false,
            is_memory_locked: false,
            schema_version: db::CURRENT_SCHEMA_VERSION,
            base_currency: "EUR".to_string(),
            cycle_start_day: 1,
        }),
    }
}

// =============================================================================
// 1. Vault Commands
// =============================================================================

#[tauri::command]
fn vault_create(
    state: State<'_, AppState>,
    path: String,
    passphrase: Option<String>,
) -> Result<VaultStatus, String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        let _ = std::fs::remove_file(&p);
    }
    let pass_ref = passphrase.as_deref().filter(|s| !s.is_empty());
    let mut engine = VaultEngine::open_or_create(&p, pass_ref).map_err(|e| e.to_string())?;
    engine
        .seed_default_portuguese_workspace_if_empty()
        .map_err(|e| e.to_string())?;
    let status = build_vault_status(Some(&engine))?;
    let mut guard = state.vault.lock().map_err(|e| e.to_string())?;
    *guard = Some(engine);
    Ok(status)
}

#[tauri::command]
fn vault_open(
    state: State<'_, AppState>,
    path: String,
    passphrase: Option<String>,
) -> Result<VaultStatus, String> {
    let p = PathBuf::from(&path);
    let pass_ref = passphrase.as_deref().filter(|s| !s.is_empty());
    let mut engine = VaultEngine::open_or_create(&p, pass_ref).map_err(|e| e.to_string())?;
    engine
        .seed_default_portuguese_workspace_if_empty()
        .map_err(|e| e.to_string())?;
    let status = build_vault_status(Some(&engine))?;
    let mut guard = state.vault.lock().map_err(|e| e.to_string())?;
    *guard = Some(engine);
    Ok(status)
}

#[tauri::command]
fn vault_close(state: State<'_, AppState>) -> Result<VaultStatus, String> {
    let mut guard = state.vault.lock().map_err(|e| e.to_string())?;
    *guard = None; // Drops VaultEngine & LockedVaultKey -> zeroizes and munlocks key in RAM
    build_vault_status(None)
}

#[tauri::command]
fn vault_get_status(state: State<'_, AppState>) -> Result<VaultStatus, String> {
    let guard = state.vault.lock().map_err(|e| e.to_string())?;
    build_vault_status(guard.as_ref())
}

#[tauri::command]
fn vault_rekey(
    state: State<'_, AppState>,
    new_passphrase: Option<String>,
) -> Result<VaultStatus, String> {
    with_vault(&state, |vault| {
        let pass_ref = new_passphrase.as_deref().filter(|s| !s.is_empty());
        vault.rekey(pass_ref).map_err(|e| e.to_string())?;
        build_vault_status(Some(vault))
    })
}

#[tauri::command]
fn vault_backup(
    state: State<'_, AppState>,
    destination_path: String,
) -> Result<String, String> {
    with_vault(&state, |vault| {
        let target = PathBuf::from(&destination_path);
        vault.backup_to_path(&target).map_err(|e| e.to_string())?;
        Ok(destination_path)
    })
}

// =============================================================================
// 2. Account Commands (<5ms Multi-Account Switcher)
// =============================================================================

#[tauri::command]
fn account_list(state: State<'_, AppState>) -> Result<Vec<AccountBalanceSummary>, String> {
    with_vault(&state, |vault| {
        vault
            .list_all_account_balance_summaries()
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn account_save(
    state: State<'_, AppState>,
    account: Account,
) -> Result<AccountBalanceSummary, String> {
    with_vault(&state, |vault| {
        let saved_id = if account.id.trim().is_empty() {
            let created = vault
                .create_account(
                    &account.name,
                    account.account_type,
                    account.anchor_balance_cents,
                    &account.anchor_date,
                    account.is_included_in_totals,
                )
                .map_err(|e| e.to_string())?;
            created.id
        } else {
            vault.update_account(&account).map_err(|e| e.to_string())?;
            account.id
        };
        vault
            .get_account_balance_summary(&saved_id)
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn account_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_vault(&state, |vault| {
        vault.delete_account(&id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn account_get_balances(
    state: State<'_, AppState>,
    account_ids: Vec<String>,
    as_of_date: Option<String>,
) -> Result<HashMap<String, i64>, String> {
    with_vault(&state, |vault| {
        let mut map = HashMap::with_capacity(account_ids.len());
        if let Some(ref date_str) = as_of_date.filter(|d| !d.trim().is_empty()) {
            for acc_id in &account_ids {
                let bal = vault
                    .calculate_account_balance_at_date(acc_id, date_str)
                    .map_err(|e| e.to_string())?;
                map.insert(acc_id.clone(), bal.as_i64());
            }
        } else {
            let summaries = vault
                .list_all_account_balance_summaries()
                .map_err(|e| e.to_string())?;
            for s in summaries {
                if account_ids.contains(&s.account.id) {
                    map.insert(s.account.id, s.current_balance_cents);
                }
            }
        }
        Ok(map)
    })
}

// =============================================================================
// 3. Taxonomy (Categories, Entities) & Import Rules Commands
// =============================================================================

#[tauri::command]
fn category_list(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    with_vault(&state, |vault| {
        vault.list_categories().map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn category_save(state: State<'_, AppState>, category: Category) -> Result<Category, String> {
    with_vault(&state, |vault| {
        vault.save_category(&category).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn category_delete(
    state: State<'_, AppState>,
    id: String,
    reassign_to_id: Option<String>,
) -> Result<(), String> {
    with_vault(&state, |vault| {
        vault
            .delete_category(&id, reassign_to_id.as_deref())
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn entity_list(state: State<'_, AppState>) -> Result<Vec<Entity>, String> {
    with_vault(&state, |vault| {
        vault.list_entities().map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn entity_save(state: State<'_, AppState>, entity: Entity) -> Result<Entity, String> {
    with_vault(&state, |vault| {
        vault.save_entity(&entity).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn entity_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_vault(&state, |vault| {
        vault.delete_entity(&id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn rule_list(state: State<'_, AppState>) -> Result<Vec<ImportRule>, String> {
    with_vault(&state, |vault| {
        vault.list_import_rules().map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn rule_save(state: State<'_, AppState>, rule: ImportRule) -> Result<ImportRule, String> {
    with_vault(&state, |vault| {
        vault.save_import_rule(&rule).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn rule_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_vault(&state, |vault| {
        vault.delete_import_rule(&id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn rule_test(
    state: State<'_, AppState>,
    account_id: String,
    sample_bank_text: String,
) -> Result<Option<CategorizationMatch>, String> {
    with_vault(&state, |vault| {
        let rules = vault.list_import_rules().map_err(|e| e.to_string())?;
        let entities = vault.list_entities().map_err(|e| e.to_string())?;
        let historical = vault
            .get_historical_exemplars()
            .map_err(|e| e.to_string())?;
        let scrubbed = ingest::scrub_pii_and_noise(&sample_bank_text);
        let engine = RuleMatcherEngine::new(rules, &entities, historical);
        Ok(engine.evaluate(&account_id, &scrubbed.clean_description, &scrubbed.scrubbed_raw))
    })
}

// =============================================================================
// 4. Ingestion & Staging Commands (Stages 1–7)
// =============================================================================

#[tauri::command]
fn statement_parse(
    state: State<'_, AppState>,
    file_name: String,
    raw_bytes: Vec<u8>,
    mime_type: Option<String>,
    account_id: String,
    explicit_profile: Option<BankProfile>,
) -> Result<ParseStatementResultDto, String> {
    with_vault(&state, |vault| {
        let lower_name = file_name.to_lowercase();
        let mime = mime_type.unwrap_or_default().to_lowercase();

        let format = if lower_name.ends_with(".xlsx") || lower_name.ends_with(".xls") {
            SourceFormat::Excel
        } else if lower_name.ends_with(".pdf") || mime.contains("pdf") {
            SourceFormat::Pdf
        } else if mime.contains("html") || lower_name.ends_with(".html") {
            SourceFormat::ClipboardHtml
        } else {
            SourceFormat::CsvOrTsv
        };

        let saved_profiles = vault.list_bank_profiles().map_err(|e| e.to_string())?;
        let existing_hashes = vault
            .get_existing_dedup_hashes(&account_id)
            .map_err(|e| e.to_string())?;
        let rules = vault.list_import_rules().map_err(|e| e.to_string())?;
        let entities = vault.list_entities().map_err(|e| e.to_string())?;
        let categories = vault.list_categories().map_err(|e| e.to_string())?;
        let historical = vault
            .get_historical_exemplars()
            .map_err(|e| e.to_string())?;

        let entity_names: HashMap<String, String> = entities
            .iter()
            .map(|e| (e.id.clone(), e.normalized_name.clone()))
            .collect();
        let category_names: HashMap<String, String> = categories
            .iter()
            .map(|c| (c.id.clone(), c.name.clone()))
            .collect();

        let outcome = run_ingestion_pipeline(
            &account_id,
            &raw_bytes,
            format,
            &saved_profiles,
            explicit_profile,
            &existing_hashes,
            (rules, entities, historical),
        )
        .map_err(|e| e.to_string())?;

        match outcome {
            IngestionOutcome::Mapped {
                matched_profile,
                staged_transactions,
            } => {
                let staged_rows = staged_transactions
                    .into_iter()
                    .map(|st| {
                        let (suggestion_confidence, matched_rule_id) =
                            match &st.categorization_match {
                                Some(m) => match &m.tier {
                                    RuleMatchTier::Tier1Explicit { rule_id }
                                    | RuleMatchTier::Tier2Substring { rule_id, .. } => {
                                        (Some(1.0), Some(rule_id.clone()))
                                    }
                                    RuleMatchTier::Tier3HistoricalFuzzy {
                                        similarity_bps, ..
                                    } => (Some((*similarity_bps as f64) / 10_000.0), None),
                                },
                                None => (None, None),
                            };

                        let entity_name = st
                            .entity_id
                            .as_ref()
                            .and_then(|id| entity_names.get(id).cloned());
                        let category_name = st
                            .category_id
                            .as_ref()
                            .and_then(|id| category_names.get(id).cloned());
                        let is_selected = st.status != StagingStatus::AlreadyImported;

                        StagedTransactionRowDto {
                            temp_id: st.staging_id,
                            date_posted: st.date_posted,
                            amount_cents: st.total_amount_cents,
                            raw_description: st.raw_bank_string,
                            clean_description: st.clean_description,
                            entity_id: st.entity_id,
                            entity_name,
                            category_id: st.category_id,
                            category_name,
                            dedup_hash: st.dedup_hash,
                            status: st.status,
                            suggestion_confidence,
                            matched_rule_id,
                            is_selected_for_import: is_selected,
                            auto_learn_rule: false,
                        }
                    })
                    .collect();

                Ok(ParseStatementResultDto {
                    header_matched: true,
                    profile_name: Some(matched_profile.profile_name),
                    header_signature_hash: matched_profile.header_signature_hash,
                    needs_column_mapping: false,
                    raw_sample_rows: Vec::new(),
                    all_raw_rows: Vec::new(),
                    detected_columns: Vec::new(),
                    staged_rows,
                })
            }
            IngestionOutcome::NeedsColumnMapping {
                header_signature_hash,
                headers,
                sample_rows,
                all_rows,
            } => Ok(ParseStatementResultDto {
                header_matched: false,
                profile_name: None,
                header_signature_hash,
                needs_column_mapping: true,
                raw_sample_rows: sample_rows,
                all_raw_rows: all_rows,
                detected_columns: headers,
                staged_rows: Vec::new(),
            }),
        }
    })
}

#[tauri::command]
fn statement_commit(
    state: State<'_, AppState>,
    account_id: String,
    rows: Vec<StagedTransactionRowDto>,
) -> Result<CommitResultDto, String> {
    with_vault(&state, |vault| {
        let mut imported_count = 0usize;
        let mut rules_created = 0usize;

        let mut existing_entities = vault.list_entities().map_err(|e| e.to_string())?;
        let existing_hashes = vault
            .get_existing_dedup_hashes(&account_id)
            .map_err(|e| e.to_string())?;

        for row in rows {
            if !row.is_selected_for_import || existing_hashes.contains(&row.dedup_hash) {
                continue;
            }

            // Resolve or auto-create Entity if user typed a new entity_name
            let resolved_entity_id = if let Some(eid) = row.entity_id.filter(|s| !s.is_empty()) {
                Some(eid)
            } else if let Some(ename) = row.entity_name.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                if let Some(found) = existing_entities
                    .iter()
                    .find(|e| e.normalized_name.eq_ignore_ascii_case(ename))
                {
                    Some(found.id.clone())
                } else {
                    let created = vault
                        .create_entity(ename, row.category_id.as_deref(), None)
                        .map_err(|e| e.to_string())?;
                    let cid = created.id.clone();
                    existing_entities.push(created);
                    Some(cid)
                }
            } else {
                None
            };

            vault
                .insert_transaction_with_splits(
                    &account_id,
                    resolved_entity_id.as_deref(),
                    &row.date_posted,
                    row.amount_cents,
                    &row.raw_description,
                    &row.clean_description,
                    &row.dedup_hash,
                    false,
                    vec![(
                        row.category_id.clone().filter(|s| !s.is_empty()),
                        None,
                        row.amount_cents,
                        None,
                    )],
                )
                .map_err(|e| e.to_string())?;
            imported_count += 1;

            if row.auto_learn_rule
                && !row.clean_description.trim().is_empty()
                && (resolved_entity_id.is_some() || row.category_id.is_some())
            {
                vault
                    .create_import_rule(
                        MatchMode::Contains,
                        row.clean_description.trim(),
                        None,
                        resolved_entity_id.as_deref(),
                        row.category_id.as_deref().filter(|s| !s.is_empty()),
                        150,
                    )
                    .map_err(|e| e.to_string())?;
                rules_created += 1;
            }
        }

        Ok(CommitResultDto {
            imported_count,
            rules_created,
        })
    })
}

#[tauri::command]
fn bank_profile_save(state: State<'_, AppState>, profile: BankProfile) -> Result<(), String> {
    with_vault(&state, |vault| {
        vault.save_bank_profile(&profile).map_err(|e| e.to_string())
    })
}

// =============================================================================
// 5. Master Virtualized Ledger, Splits, Transfers & Benchmark Commands
// =============================================================================

#[tauri::command]
fn ledger_query(
    state: State<'_, AppState>,
    account_ids: Vec<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    search: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<LedgerQueryResultDto, String> {
    with_vault(&state, |vault| {
        let (transactions, total_count, period_inflow_cents, period_outflow_cents) = vault
            .query_ledger(
                &account_ids,
                start_date.as_deref(),
                end_date.as_deref(),
                search.as_deref(),
                limit.unwrap_or(500),
                offset.unwrap_or(0),
            )
            .map_err(|e| e.to_string())?;

        let net_cash_flow_cents = period_inflow_cents.saturating_add(period_outflow_cents);
        Ok(LedgerQueryResultDto {
            transactions,
            total_count,
            period_inflow_cents,
            period_outflow_cents,
            net_cash_flow_cents,
        })
    })
}

#[tauri::command]
fn ledger_save_transaction(
    state: State<'_, AppState>,
    transaction: SaveTransactionInput,
) -> Result<TransactionWithSplits, String> {
    with_vault(&state, |vault| {
        let resolved_entity_id = if let Some(eid) = transaction.entity_id.filter(|s| !s.is_empty()) {
            Some(eid)
        } else if let Some(ename) = transaction
            .entity_name
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            let existing = vault.list_entities().map_err(|e| e.to_string())?;
            if let Some(found) = existing
                .iter()
                .find(|e| e.normalized_name.eq_ignore_ascii_case(ename))
            {
                Some(found.id.clone())
            } else {
                let first_cat = transaction
                    .splits
                    .first()
                    .and_then(|s| s.category_id.as_deref());
                let created = vault
                    .create_entity(ename, first_cat, None)
                    .map_err(|e| e.to_string())?;
                Some(created.id)
            }
        } else {
            None
        };

        let splits_vec: Vec<(Option<String>, Option<String>, i64, Option<String>)> = transaction
            .splits
            .into_iter()
            .map(|s| {
                (
                    s.category_id.filter(|v| !v.is_empty()),
                    s.transfer_peer_account_id.filter(|v| !v.is_empty()),
                    s.split_amount_cents,
                    s.notes.filter(|v| !v.is_empty()),
                )
            })
            .collect();

        if let Some(existing_id) = transaction.id.filter(|s| !s.trim().is_empty()) {
            vault
                .update_transaction_with_splits(
                    &existing_id,
                    &transaction.account_id,
                    resolved_entity_id.as_deref(),
                    &transaction.date_posted,
                    transaction.total_amount_cents,
                    &transaction.clean_description,
                    transaction.is_reconciled,
                    splits_vec,
                )
                .map_err(|e| e.to_string())
        } else {
            let dedup = ingest::compute_dedup_hash(
                &transaction.account_id,
                &transaction.date_posted,
                transaction.total_amount_cents,
                &format!("{}_{}", transaction.clean_description, new_uuid_v7()),
                1,
            );
            vault
                .insert_transaction_with_splits(
                    &transaction.account_id,
                    resolved_entity_id.as_deref(),
                    &transaction.date_posted,
                    transaction.total_amount_cents,
                    &transaction.raw_bank_string,
                    &transaction.clean_description,
                    &dedup,
                    transaction.is_reconciled,
                    splits_vec,
                )
                .map_err(|e| e.to_string())
        }
    })
}

#[tauri::command]
fn ledger_delete_transaction(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_vault(&state, |vault| {
        vault.delete_transaction(&id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn ledger_toggle_reconciled(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    with_vault(&state, |vault| {
        vault.toggle_reconciliation(&id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn ledger_seed_benchmark(
    state: State<'_, AppState>,
    count: usize,
) -> Result<String, String> {
    with_vault(&state, |vault| {
        let (insert_ms, query_ms) = vault
            .seed_benchmark_transactions(count)
            .map_err(|e| e.to_string())?;
        Ok(format!(
            "Seeded {} transactions across 8 accounts in {}ms. Sidebar balance recalculation took {}ms (<15ms target).",
            count, insert_ms, query_ms
        ))
    })
}

#[tauri::command]
fn export_data(
    state: State<'_, AppState>,
    format: String,
    account_ids: Vec<String>,
) -> Result<String, String> {
    with_vault(&state, |vault| {
        vault
            .export_ledger_data(&format, &account_ids)
            .map_err(|e| e.to_string())
    })
}

fn create_initial_vault() -> Option<VaultEngine> {
    let mut default_path = std::env::temp_dir();
    default_path.push("finfolio_default_workspace.finfolio");
    if let Ok(mut engine) = VaultEngine::open_or_create(&default_path, None) {
        let _ = engine.seed_default_portuguese_workspace_if_empty();
        Some(engine)
    } else if let Ok(mut mem) = VaultEngine::open_in_memory() {
        let _ = mem.seed_default_portuguese_workspace_if_empty();
        Some(mem)
    } else {
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            vault: Mutex::new(create_initial_vault()),
        })
        .invoke_handler(tauri::generate_handler![
            vault_create,
            vault_open,
            vault_close,
            vault_get_status,
            vault_rekey,
            vault_backup,
            account_list,
            account_save,
            account_delete,
            account_get_balances,
            category_list,
            category_save,
            category_delete,
            entity_list,
            entity_save,
            entity_delete,
            rule_list,
            rule_save,
            rule_delete,
            rule_test,
            statement_parse,
            statement_commit,
            bank_profile_save,
            ledger_query,
            ledger_save_transaction,
            ledger_delete_transaction,
            ledger_toggle_reconciled,
            ledger_seed_benchmark,
            export_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FinFolio application");
}
