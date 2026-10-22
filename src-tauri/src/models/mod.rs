use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

/// Strictly 64-bit signed integer minor units (cents).
/// Zero-float policy: floating-point types (`f32`, `f64`) are prohibited in monetary math.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct Cents(pub i64);

impl Cents {
    pub const ZERO: Cents = Cents(0);

    #[inline]
    pub const fn new(cents: i64) -> Self {
        Self(cents)
    }

    #[inline]
    pub const fn as_i64(self) -> i64 {
        self.0
    }

    #[inline]
    pub fn checked_add(self, rhs: Self) -> Option<Self> {
        self.0.checked_add(rhs.0).map(Self)
    }

    #[inline]
    pub fn checked_sub(self, rhs: Self) -> Option<Self> {
        self.0.checked_sub(rhs.0).map(Self)
    }

    /// Formats integer cents into European display format (e.g. `145075` -> `"1.450,75 €"`, `-20000` -> `"-200,00 €"`)
    /// using purely integer division and modulo (zero floats).
    pub fn format_eur(self) -> String {
        let is_negative = self.0 < 0;
        let abs_val: u128 = (self.0 as i128).unsigned_abs();
        let major = abs_val / 100;
        let minor = abs_val % 100;

        let major_str = major.to_string();
        let mut grouped = String::with_capacity(major_str.len() + major_str.len() / 3);
        for (idx, ch) in major_str.chars().rev().enumerate() {
            if idx > 0 && idx % 3 == 0 {
                grouped.push('.');
            }
            grouped.push(ch);
        }
        let formatted_major: String = grouped.chars().rev().collect();

        if is_negative {
            format!("-{},{:02} €", formatted_major, minor)
        } else {
            format!("{},{:02} €", formatted_major, minor)
        }
    }
}

impl fmt::Display for Cents {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.format_eur())
    }
}

/// Helper to generate time-ordered UUIDv7 strings for all relational entities.
pub fn new_uuid_v7() -> String {
    Uuid::now_v7().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultMetadata {
    pub schema_version: u32,
    pub base_currency: String,
    pub cycle_start_day: u8,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AccountType {
    Checking,
    Savings,
    CreditCard,
    Cash,
    MealCard,
}

impl AccountType {
    pub fn as_str(&self) -> &'static str {
        match self {
            AccountType::Checking => "Checking",
            AccountType::Savings => "Savings",
            AccountType::CreditCard => "CreditCard",
            AccountType::Cash => "Cash",
            AccountType::MealCard => "MealCard",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "Checking" => Ok(AccountType::Checking),
            "Savings" => Ok(AccountType::Savings),
            "CreditCard" => Ok(AccountType::CreditCard),
            "Cash" => Ok(AccountType::Cash),
            "MealCard" => Ok(AccountType::MealCard),
            other => Err(format!("Unknown account_type: {}", other)),
        }
    }
}

fn default_currency() -> String {
    "EUR".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub account_type: AccountType,
    pub anchor_balance_cents: i64,
    pub anchor_date: String,
    pub is_included_in_totals: bool,
    #[serde(default = "default_currency")]
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountBalanceSummary {
    pub account: Account,
    /// Current balance as of the latest transaction (or as of a target date)
    pub current_balance_cents: i64,
    /// Balance at the anchor date (strictly equal to `anchor_balance_cents`)
    pub anchor_balance_cents: i64,
    /// Total sum of transactions strictly after `anchor_date`
    pub post_anchor_delta_cents: i64,
    /// Total sum of transactions on or before `anchor_date` (for retroactive historical calculation)
    pub pre_anchor_delta_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entity {
    pub id: String,
    pub normalized_name: String,
    pub default_category_id: Option<String>,
    pub tax_id_nif: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum CategoryDirection {
    Income,
    Expense,
}

impl CategoryDirection {
    pub fn as_str(&self) -> &'static str {
        match self {
            CategoryDirection::Income => "Income",
            CategoryDirection::Expense => "Expense",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "Income" => Ok(CategoryDirection::Income),
            "Expense" => Ok(CategoryDirection::Expense),
            other => Err(format!("Unknown category direction: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Category {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub direction: CategoryDirection,
    pub color_hex: String,
    #[serde(default)]
    pub monthly_budget_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Transaction {
    pub id: String,
    pub account_id: String,
    pub entity_id: Option<String>,
    pub date_posted: String,
    pub total_amount_cents: i64,
    pub raw_bank_string: String,
    pub clean_description: String,
    pub dedup_hash: String,
    pub is_reconciled: bool,
    #[serde(default)]
    pub linked_transfer_transaction_id: Option<String>,
    #[serde(default)]
    pub reimbursement_parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransactionSplit {
    pub id: String,
    pub transaction_id: String,
    pub category_id: Option<String>,
    pub transfer_peer_account_id: Option<String>,
    pub split_amount_cents: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransactionWithSplits {
    pub transaction: Transaction,
    pub splits: Vec<TransactionSplit>,
    pub running_balance_cents: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum MatchMode {
    Contains,
    Prefix,
    Exact,
    Regex,
}

impl MatchMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            MatchMode::Contains => "Contains",
            MatchMode::Prefix => "Prefix",
            MatchMode::Exact => "Exact",
            MatchMode::Regex => "Regex",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "Contains" => Ok(MatchMode::Contains),
            "Prefix" => Ok(MatchMode::Prefix),
            "Exact" => Ok(MatchMode::Exact),
            "Regex" => Ok(MatchMode::Regex),
            other => Err(format!("Unknown match_mode: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportRule {
    pub id: String,
    pub match_mode: MatchMode,
    pub pattern_string: String,
    pub account_scope_id: Option<String>,
    pub assigned_entity_id: Option<String>,
    pub assigned_category_id: Option<String>,
    pub priority_weight: i32,
    pub hit_count: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AmountStrategy {
    SingleSigned,
    DebitCreditSplit,
    UnsignedWithIndicator,
}

impl AmountStrategy {
    pub fn as_str(&self) -> &'static str {
        match self {
            AmountStrategy::SingleSigned => "SingleSigned",
            AmountStrategy::DebitCreditSplit => "DebitCreditSplit",
            AmountStrategy::UnsignedWithIndicator => "UnsignedWithIndicator",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "SingleSigned" => Ok(AmountStrategy::SingleSigned),
            "DebitCreditSplit" => Ok(AmountStrategy::DebitCreditSplit),
            "UnsignedWithIndicator" => Ok(AmountStrategy::UnsignedWithIndicator),
            other => Err(format!("Unknown amount_strategy: {}", other)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BankProfile {
    pub id: String,
    pub profile_name: String,
    pub header_signature_hash: String,
    pub date_col_idx: usize,
    pub desc_col_idx: usize,
    pub amount_strategy: AmountStrategy,
    pub amount_col_idx: Option<usize>,
    pub debit_col_idx: Option<usize>,
    pub credit_col_idx: Option<usize>,
    pub indicator_col_idx: Option<usize>,
    pub decimal_separator: char,
}
