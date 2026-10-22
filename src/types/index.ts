export type Cents = number; // Integer minor units (cents) — strictly zero-float

export type ActiveView =
  | "ledger"
  | "analytics"
  | "budgets"
  | "recurring"
  | "report"
  | "staging"
  | "taxonomy"
  | "rules"
  | "settings";

export type ReportGrade = "A+" | "A" | "B" | "C" | "D";

export interface ScorePillar {
  name: string;
  score: number;
  maxScore: number;
  percentage: number;
  status: "excellent" | "good" | "warning" | "alert";
  summary: string;
}

export interface MonthlyReportCardData {
  month: string; // YYYY-MM
  monthLabel: string; // e.g. "October 2026"
  totalScore: number; // 0 - 100
  letterGrade: ReportGrade;
  gradeTitle: string; // e.g. "Excellent Financial Health"
  pillars: {
    savingsRate: ScorePillar;
    budgetDiscipline: ScorePillar;
    fixedOverhead: ScorePillar;
    cashFlowGrowth: ScorePillar;
  };
  metrics: {
    inflowCents: Cents;
    outflowCents: Cents;
    netSavingsCents: Cents;
    savingsRatePct: number;
    totalBudgetedCents: Cents;
    budgetSpentCents: Cents;
    safeToSpendCents: Cents;
    budgetedCategoriesCount: number;
    overBudgetCount: number;
    fixedCommitmentsCents: Cents;
    discretionarySpendCents: Cents;
    fixedRatioPct: number;
    discretionaryRatioPct: number;
  };
  topCategories: Array<{
    name: string;
    categoryPath: string;
    amountCents: Cents;
    pct: number;
    color: string;
  }>;
  topMerchants: Array<{
    name: string;
    amountCents: Cents;
    pct: number;
    txCount: number;
  }>;
  insights: Array<{
    title: string;
    detail: string;
    tone: "positive" | "neutral" | "warning";
  }>;
}

export type RecurrenceInterval = "Monthly" | "Yearly" | "Weekly";

export interface RecurringSchedule {
  id: string;
  name: string;
  expected_amount_cents: Cents; // Signed integer minor units (negative for expense, positive for income)
  recurrence_interval: RecurrenceInterval;
  day_of_month: number; // 1-31
  account_id: string | null;
  category_id: string | null;
  entity_id: string | null;
  is_active: boolean;
  notes?: string | null;
}

export type RecurringBillStatus = "paid" | "due_soon" | "upcoming" | "overdue";

export interface RecurringBillItem {
  schedule: RecurringSchedule;
  categoryName: string | null;
  categoryColor: string | null;
  entityName: string | null;
  accountName: string | null;
  status: RecurringBillStatus;
  matchedTransactionId: string | null;
  matchedDatePosted: string | null;
  daysUntilDue: number;
  nextDueDate: string; // YYYY-MM-DD
}

export interface RecurringSummaryKpis {
  monthlyFixedCommitmentsCents: Cents;
  paidThisMonthCents: Cents;
  upcomingRemainingCents: Cents;
  activeSubscriptionsCount: number;
  paidCount: number;
  pendingCount: number;
}

export type CurrencyCode = "EUR" | "USD" | "GBP" | "CHF";

export interface CurrencyConfig {
  code: CurrencyCode;
  symbol: string;
  name: string;
  decimalSeparator: "," | ".";
  thousandsSeparator: "." | "," | "'";
  symbolPosition: "before" | "after";
}

export interface FxRateConfig {
  baseCurrency: CurrencyCode;
  ratesBasisPoints: Record<CurrencyCode, number>;
}

export interface VaultStatus {
  is_open: boolean;
  path: string | null;
  is_encrypted: boolean;
  is_memory_locked: boolean;
  schema_version: number;
  base_currency: CurrencyCode;
  cycle_start_day: number;
  fx_rates?: FxRateConfig;
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
  currency?: CurrencyCode;
}

export interface AccountBalanceSummary {
  account: Account;
  current_balance_cents: Cents;
  anchor_balance_cents: Cents;
  post_anchor_delta_cents: Cents;
  pre_anchor_delta_cents: Cents;
  converted_balance_cents?: Cents;
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
  is_recurring?: boolean;
  recurrence_interval?: RecurrenceInterval;
  linked_transfer_transaction_id?: string | null;
  reimbursement_parent_id?: string | null;
}

export interface ReimbursementSummary {
  parentTransactionId: string;
  totalReimbursedCents: Cents;
  netAmountCents: Cents;
  reimbursementCount: number;
  childReimbursementIds: string[];
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
  delimiter?: string;
  header_row_idx?: number;
  balance_col_idx?: number | null;
}

export interface BankProfilePreset {
  id: string;
  name: string;
  delimiter: string;
  decimalSeparator: "," | ".";
  strategy: "SingleSigned" | "DebitCreditSplit";
  dateColIdx: number;
  descColIdx: number;
  amountColIdx?: number;
  debitColIdx?: number;
  creditColIdx?: number;
  balanceColIdx?: number;
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
  detected_delimiter?: string;
  detected_header_row_idx?: number;
  detected_decimal_separator?: string;
  applied_profile?: BankProfile | null;
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
  is_recurring?: boolean;
  recurrence_interval?: RecurrenceInterval;
  linked_transfer_transaction_id?: string | null;
  reimbursement_parent_id?: string | null;
  splits: SaveSplitInput[];
}
