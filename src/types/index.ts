export type Cents = number; // Integer minor units (cents) — strictly zero-float

export type ActiveView =
  | "ledger"
  | "analytics"
  | "budgets"
  | "staging"
  | "taxonomy"
  | "rules"
  | "settings";

export interface VaultStatus {
  is_open: boolean;
  path: string | null;
  is_encrypted: boolean;
  is_memory_locked: boolean;
  schema_version: number;
  base_currency: string;
  cycle_start_day: number;
}

export type AccountType =
  | "Checking"
  | "Savings"
  | "CreditCard"
  | "Cash"
  | "MealCard";

export interface Account {
  id: string;
  name: string;
  account_type: AccountType;
  anchor_balance_cents: Cents;
  anchor_date: string; // YYYY-MM-DD
  is_included_in_totals: boolean;
}

export interface AccountBalanceSummary {
  account: Account;
  current_balance_cents: Cents;
  anchor_balance_cents: Cents;
  post_anchor_delta_cents: Cents;
  pre_anchor_delta_cents: Cents;
}

export type CategoryDirection = "Income" | "Expense";

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  direction: CategoryDirection;
  color_hex: string;
  monthly_budget_cents?: Cents | null;
}

export interface CategoryBudgetProgress {
  category: Category;
  parentCategory: Category | null;
  categoryPath: string;
  budget_cents: Cents;
  spent_cents: Cents;
  remaining_cents: Cents;
  percentage: number;
  status: "safe" | "warning" | "over";
  transaction_count: number;
}

export interface BudgetSummary {
  total_budgeted_cents: Cents;
  total_spent_cents: Cents;
  remaining_safe_to_spend_cents: Cents;
  budgeted_categories_count: number;
  over_budget_count: number;
}

export interface Entity {
  id: string;
  normalized_name: string;
  default_category_id: string | null;
  tax_id_nif: string | null;
}

export interface Transaction {
  id: string;
  account_id: string;
  entity_id: string | null;
  date_posted: string;
  total_amount_cents: Cents;
  raw_bank_string: string;
  clean_description: string;
  dedup_hash: string;
  is_reconciled: boolean;
}

export interface TransactionSplit {
  id: string;
  transaction_id: string;
  category_id: string | null;
  transfer_peer_account_id: string | null;
  split_amount_cents: Cents;
  notes: string | null;
}

export interface TransactionWithSplits {
  transaction: Transaction;
  splits: TransactionSplit[];
  running_balance_cents: Cents | null;
}

export type MatchMode = "Contains" | "Prefix" | "Exact" | "Regex";

export interface ImportRule {
  id: string;
  match_mode: MatchMode;
  pattern_string: string;
  account_scope_id: string | null;
  assigned_entity_id: string | null;
  assigned_category_id: string | null;
  priority_weight: number;
  hit_count: number;
}

export type AmountStrategy =
  | "SingleSigned"
  | "DebitCreditSplit"
  | "UnsignedWithIndicator";

export interface BankProfile {
  id: string;
  profile_name: string;
  header_signature_hash: string;
  date_col_idx: number;
  desc_col_idx: number;
  amount_strategy: AmountStrategy;
  amount_col_idx: number | null;
  debit_col_idx: number | null;
  credit_col_idx: number | null;
  indicator_col_idx: number | null;
  decimal_separator: string;
}

export type StagingStatus =
  | "New"
  | "RuleMatched"
  | "Suggested"
  | "AlreadyImported";

export interface StagedTransactionRowDto {
  temp_id: string;
  date_posted: string;
  amount_cents: Cents;
  raw_description: string;
  clean_description: string;
  entity_id: string | null;
  entity_name: string | null;
  category_id: string | null;
  category_name: string | null;
  dedup_hash: string;
  status: StagingStatus;
  suggestion_confidence: number | null;
  matched_rule_id: string | null;
  is_selected_for_import: boolean;
  auto_learn_rule: boolean;
}

export interface ParseStatementResultDto {
  header_matched: boolean;
  profile_name: string | null;
  header_signature_hash: string;
  needs_column_mapping: boolean;
  raw_sample_rows: string[][];
  all_raw_rows: string[][];
  detected_columns: string[];
  staged_rows: StagedTransactionRowDto[];
}

export interface LedgerQueryResultDto {
  transactions: TransactionWithSplits[];
  total_count: number;
  period_inflow_cents: Cents;
  period_outflow_cents: Cents;
  net_cash_flow_cents: Cents;
}

export interface SaveSplitInput {
  category_id: string | null;
  transfer_peer_account_id: string | null;
  split_amount_cents: Cents;
  notes: string | null;
}

export interface SaveTransactionInput {
  id: string | null;
  account_id: string;
  entity_id: string | null;
  entity_name: string | null;
  date_posted: string;
  total_amount_cents: Cents;
  raw_bank_string: string;
  clean_description: string;
  is_reconciled: boolean;
  splits: SaveSplitInput[];
}
