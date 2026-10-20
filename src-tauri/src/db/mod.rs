use crate::crypto::{read_vault_header_salt, CryptoError, LockedVaultKey};
use crate::models::{
    new_uuid_v7, Account, AccountBalanceSummary, AccountType, AmountStrategy, BankProfile,
    Category, CategoryDirection, Cents, Entity, ImportRule, MatchMode, Transaction,
    TransactionSplit, TransactionWithSplits, VaultMetadata,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use thiserror::Error;
use zeroize::Zeroize;

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("Database error: {0}")]
    SqlError(#[from] rusqlite::Error),
    #[error("Cryptographic error: {0}")]
    CryptoError(#[from] CryptoError),
    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Vault is encrypted and requires a passphrase to unlock")]
    PassphraseRequired,
    #[error("Invalid passphrase or corrupted vault file")]
    InvalidPassphrase,
    #[error("Validation error: {0}")]
    ValidationError(String),
    #[error("Arithmetic overflow in zero-float cents calculation")]
    ArithmeticOverflow,
}

/// Manages an active connection to a `.finfolio` SQLite / SQLCipher vault file.
pub struct VaultEngine {
    conn: Connection,
    path: Option<PathBuf>,
    locked_key: Option<LockedVaultKey>,
}

impl VaultEngine {
    /// Opens an existing `.finfolio` vault or creates a new one at `path`.
    /// - If `passphrase` is `None`: creates or opens an unencrypted SQLite 3 vault in WAL mode.
    /// - If `passphrase` is `Some(pass)`: derives a 256-bit key via Argon2id (64MB, 3 iter, 4 lanes)
    ///   using either the existing 16-byte file header salt or a newly generated 16-byte salt,
    ///   locks the key in memory (`mlock`), and opens the SQLCipher AES-256-CBC + HMAC-SHA512 vault.
    pub fn open_or_create(path: &Path, passphrase: Option<&str>) -> Result<Self, VaultError> {
        let file_exists = path.exists() && path.metadata()?.len() > 0;

        let locked_key = if file_exists {
            let maybe_salt = read_vault_header_salt(path)?;
            match (maybe_salt, passphrase) {
                (Some(salt), Some(pass)) => Some(LockedVaultKey::derive(pass, salt)?),
                (Some(_), None) => return Err(VaultError::PassphraseRequired),
                (None, Some(_)) => {
                    return Err(VaultError::ValidationError(
                        "Vault is unencrypted; open without passphrase or use rekey to encrypt"
                            .to_string(),
                    ))
                }
                (None, None) => None,
            }
        } else {
            match passphrase {
                Some(pass) => Some(LockedVaultKey::derive_with_new_salt(pass)?),
                None => None,
            }
        };

        let conn = Connection::open(path)?;
        Self::configure_connection(&conn, locked_key.as_ref())?;

        let mut engine = Self {
            conn,
            path: Some(path.to_path_buf()),
            locked_key,
        };
        engine.run_migrations()?;
        Ok(engine)
    }

    /// Creates an in-memory vault for fast isolated testing.
    pub fn open_in_memory() -> Result<Self, VaultError> {
        let conn = Connection::open_in_memory()?;
        Self::configure_connection(&conn, None)?;
        let mut engine = Self {
            conn,
            path: None,
            locked_key: None,
        };
        engine.run_migrations()?;
        Ok(engine)
    }

    fn configure_connection(
        conn: &Connection,
        locked_key: Option<&LockedVaultKey>,
    ) -> Result<(), VaultError> {
        if let Some(key) = locked_key {
            let mut raw_key_spec = key.to_sqlcipher_raw_key_spec();
            let pragma_sql = format!("PRAGMA key = \"{}\";", raw_key_spec);
            raw_key_spec.zeroize();
            let res = conn.execute_batch(&pragma_sql);
            // Zeroize the SQL string containing the hex key immediately
            let mut pragma_sql_zero = pragma_sql;
            pragma_sql_zero.zeroize();
            res?;

            conn.execute_batch(
                "PRAGMA cipher_page_size = 4096;
                 PRAGMA cipher_hmac_algorithm = HMAC_SHA512;
                 PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512;",
            )?;
        }

        // Verify we can read sqlite_master (detects wrong passphrase immediately)
        let verify: Result<i64, rusqlite::Error> =
            conn.query_row("SELECT count(*) FROM sqlite_master;", [], |r| r.get(0));
        if verify.is_err() {
            return Err(VaultError::InvalidPassphrase);
        }

        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;",
        )?;

        Ok(())
    }

    pub fn is_encrypted(&self) -> bool {
        self.locked_key.is_some()
    }

    pub fn is_key_memory_locked(&self) -> bool {
        self.locked_key
            .as_ref()
            .map(|k| k.is_memory_locked())
            .unwrap_or(false)
    }

    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    /// Adds, changes, or removes the encryption passphrase on an on-disk `.finfolio` vault.
    /// Uses SQLCipher's `sqlcipher_export` into a clean target file and atomically swaps it,
    /// ensuring both unencrypted <-> encrypted transitions and fresh 16-byte header salts work reliably.
    pub fn rekey(&mut self, new_passphrase: Option<&str>) -> Result<(), VaultError> {
        let vault_path = self.path.clone().ok_or_else(|| {
            VaultError::ValidationError("Cannot rekey an in-memory vault".to_string())
        })?;

        let temp_path = vault_path.with_extension("finfolio.rekey_tmp");
        if temp_path.exists() {
            std::fs::remove_file(&temp_path)?;
        }

        let new_locked_key = match new_passphrase {
            Some(pass) => Some(LockedVaultKey::derive_with_new_salt(pass)?),
            None => None,
        };

        // Ensure WAL is checkpointed before exporting
        self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;

        let temp_path_str = temp_path.to_string_lossy().replace('\'', "''");
        if let Some(ref key) = new_locked_key {
            let mut raw_key_spec = key.to_sqlcipher_raw_key_spec();
            let attach_sql = format!(
                "ATTACH DATABASE '{}' AS rekey_target KEY \"{}\";
                 SELECT sqlcipher_export('rekey_target');
                 DETACH DATABASE rekey_target;",
                temp_path_str, raw_key_spec
            );
            raw_key_spec.zeroize();
            let res = self.conn.execute_batch(&attach_sql);
            let mut attach_zero = attach_sql;
            attach_zero.zeroize();
            res?;
        } else {
            let attach_sql = format!(
                "ATTACH DATABASE '{}' AS rekey_target KEY '';
                 SELECT sqlcipher_export('rekey_target');
                 DETACH DATABASE rekey_target;",
                temp_path_str
            );
            self.conn.execute_batch(&attach_sql)?;
        }

        // Replace connection with a dummy in-memory connection before swapping files on disk
        let dummy = Connection::open_in_memory()?;
        let old_conn = std::mem::replace(&mut self.conn, dummy);
        drop(old_conn);

        // Remove old WAL/SHM sidecars if present
        let wal_path = PathBuf::from(format!("{}-wal", vault_path.display()));
        let shm_path = PathBuf::from(format!("{}-shm", vault_path.display()));
        if wal_path.exists() {
            let _ = std::fs::remove_file(&wal_path);
        }
        if shm_path.exists() {
            let _ = std::fs::remove_file(&shm_path);
        }

        std::fs::rename(&temp_path, &vault_path)?;

        let new_conn = Connection::open(&vault_path)?;
        Self::configure_connection(&new_conn, new_locked_key.as_ref())?;
        self.conn = new_conn;
        self.locked_key = new_locked_key;

        Ok(())
    }

    /// Executes the relational schema migration matching Section 3.3 of `app-bible.md`.
    pub fn run_migrations(&mut self) -> Result<(), VaultError> {
        self.conn.execute_batch(
            "
            -- 1. Vault Metadata (Singleton configuration table)
            CREATE TABLE IF NOT EXISTS vault_metadata (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                schema_version INTEGER NOT NULL DEFAULT 1,
                base_currency TEXT NOT NULL DEFAULT 'EUR',
                cycle_start_day INTEGER NOT NULL DEFAULT 1 CHECK (cycle_start_day >= 1 AND cycle_start_day <= 28)
            );

            INSERT OR IGNORE INTO vault_metadata (id, schema_version, base_currency, cycle_start_day)
            VALUES (1, 1, 'EUR', 1);

            -- 2. Accounts
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                account_type TEXT NOT NULL CHECK (account_type IN ('Checking', 'Savings', 'CreditCard', 'Cash', 'MealCard')),
                anchor_balance_cents INTEGER NOT NULL DEFAULT 0,
                anchor_date TEXT NOT NULL,
                is_included_in_totals INTEGER NOT NULL DEFAULT 1 CHECK (is_included_in_totals IN (0, 1)),
                cached_post_anchor_delta_cents INTEGER NOT NULL DEFAULT 0,
                cached_pre_anchor_delta_cents INTEGER NOT NULL DEFAULT 0
            );

            -- 3. Categories (Hierarchical up to 3 levels deep)
            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY NOT NULL,
                parent_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
                name TEXT NOT NULL,
                direction TEXT NOT NULL CHECK (direction IN ('Income', 'Expense')),
                color_hex TEXT NOT NULL DEFAULT '#10b981'
            );

            -- 4. Entities (Counterparties: Merchants, Employers, Individuals, State bodies)
            CREATE TABLE IF NOT EXISTS entities (
                id TEXT PRIMARY KEY NOT NULL,
                normalized_name TEXT NOT NULL UNIQUE,
                default_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
                tax_id_nif TEXT
            );

            -- 5. Transactions (Immutable bank statement line or cash event)
            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY NOT NULL,
                account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
                date_posted TEXT NOT NULL,
                total_amount_cents INTEGER NOT NULL,
                raw_bank_string TEXT NOT NULL,
                clean_description TEXT NOT NULL,
                dedup_hash TEXT NOT NULL,
                is_reconciled INTEGER NOT NULL DEFAULT 0 CHECK (is_reconciled IN (0, 1))
            );

            CREATE INDEX IF NOT EXISTS idx_transactions_account_date
                ON transactions(account_id, date_posted, total_amount_cents, id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_account_dedup
                ON transactions(account_id, dedup_hash);

            CREATE TRIGGER IF NOT EXISTS trg_tx_after_insert
            AFTER INSERT ON transactions
            BEGIN
                UPDATE accounts
                SET cached_post_anchor_delta_cents = cached_post_anchor_delta_cents +
                        CASE WHEN NEW.date_posted > anchor_date THEN NEW.total_amount_cents ELSE 0 END,
                    cached_pre_anchor_delta_cents = cached_pre_anchor_delta_cents +
                        CASE WHEN NEW.date_posted <= anchor_date THEN NEW.total_amount_cents ELSE 0 END
                WHERE id = NEW.account_id;
            END;

            CREATE TRIGGER IF NOT EXISTS trg_tx_after_delete
            AFTER DELETE ON transactions
            BEGIN
                UPDATE accounts
                SET cached_post_anchor_delta_cents = cached_post_anchor_delta_cents -
                        CASE WHEN OLD.date_posted > anchor_date THEN OLD.total_amount_cents ELSE 0 END,
                    cached_pre_anchor_delta_cents = cached_pre_anchor_delta_cents -
                        CASE WHEN OLD.date_posted <= anchor_date THEN OLD.total_amount_cents ELSE 0 END
                WHERE id = OLD.account_id;
            END;

            CREATE TRIGGER IF NOT EXISTS trg_tx_after_update
            AFTER UPDATE OF account_id, date_posted, total_amount_cents ON transactions
            BEGIN
                UPDATE accounts
                SET cached_post_anchor_delta_cents = cached_post_anchor_delta_cents -
                        CASE WHEN OLD.date_posted > anchor_date THEN OLD.total_amount_cents ELSE 0 END,
                    cached_pre_anchor_delta_cents = cached_pre_anchor_delta_cents -
                        CASE WHEN OLD.date_posted <= anchor_date THEN OLD.total_amount_cents ELSE 0 END
                WHERE id = OLD.account_id;
                UPDATE accounts
                SET cached_post_anchor_delta_cents = cached_post_anchor_delta_cents +
                        CASE WHEN NEW.date_posted > anchor_date THEN NEW.total_amount_cents ELSE 0 END,
                    cached_pre_anchor_delta_cents = cached_pre_anchor_delta_cents +
                        CASE WHEN NEW.date_posted <= anchor_date THEN NEW.total_amount_cents ELSE 0 END
                WHERE id = NEW.account_id;
            END;

            CREATE TRIGGER IF NOT EXISTS trg_acc_after_update_anchor_date
            AFTER UPDATE OF anchor_date ON accounts
            BEGIN
                UPDATE accounts
                SET cached_post_anchor_delta_cents = COALESCE((
                        SELECT SUM(total_amount_cents) FROM transactions
                        WHERE account_id = NEW.id AND date_posted > NEW.anchor_date
                    ), 0),
                    cached_pre_anchor_delta_cents = COALESCE((
                        SELECT SUM(total_amount_cents) FROM transactions
                        WHERE account_id = NEW.id AND date_posted <= NEW.anchor_date
                    ), 0)
                WHERE id = NEW.id;
            END;

            -- 6. Transaction Splits (Budgetary allocation; sum must equal total_amount_cents)
            CREATE TABLE IF NOT EXISTS transaction_splits (
                id TEXT PRIMARY KEY NOT NULL,
                transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
                transfer_peer_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
                split_amount_cents INTEGER NOT NULL,
                notes TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_splits_transaction_id
                ON transaction_splits(transaction_id);

            -- 7. Import Rules (Evaluated sequentially by priority_weight descending)
            CREATE TABLE IF NOT EXISTS import_rules (
                id TEXT PRIMARY KEY NOT NULL,
                match_mode TEXT NOT NULL CHECK (match_mode IN ('Contains', 'Prefix', 'Exact', 'Regex')),
                pattern_string TEXT NOT NULL,
                account_scope_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
                assigned_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
                assigned_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
                priority_weight INTEGER NOT NULL DEFAULT 100,
                hit_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_import_rules_priority
                ON import_rules(priority_weight DESC);

            -- 8. Bank Profiles (Saved column mappings matched via header_signature_hash)
            CREATE TABLE IF NOT EXISTS bank_profiles (
                id TEXT PRIMARY KEY NOT NULL,
                profile_name TEXT NOT NULL,
                header_signature_hash TEXT NOT NULL UNIQUE,
                date_col_idx INTEGER NOT NULL,
                desc_col_idx INTEGER NOT NULL,
                amount_strategy TEXT NOT NULL CHECK (amount_strategy IN ('SingleSigned', 'DebitCreditSplit', 'UnsignedWithIndicator')),
                amount_col_idx INTEGER,
                debit_col_idx INTEGER,
                credit_col_idx INTEGER,
                indicator_col_idx INTEGER,
                decimal_separator TEXT NOT NULL DEFAULT ','
            );
            ",
        )?;

        Ok(())
    }

    // =========================================================================
    // Vault Metadata Operations
    // =========================================================================

    pub fn get_metadata(&self) -> Result<VaultMetadata, VaultError> {
        let meta = self.conn.query_row(
            "SELECT schema_version, base_currency, cycle_start_day FROM vault_metadata WHERE id = 1",
            [],
            |row| {
                Ok(VaultMetadata {
                    schema_version: row.get(0)?,
                    base_currency: row.get(1)?,
                    cycle_start_day: row.get(2)?,
                })
            },
        )?;
        Ok(meta)
    }

    pub fn update_metadata(&self, base_currency: &str, cycle_start_day: u8) -> Result<(), VaultError> {
        if !(1..=28).contains(&cycle_start_day) {
            return Err(VaultError::ValidationError(
                "cycle_start_day must be between 1 and 28".to_string(),
            ));
        }
        self.conn.execute(
            "UPDATE vault_metadata SET base_currency = ?1, cycle_start_day = ?2 WHERE id = 1",
            params![base_currency, cycle_start_day],
        )?;
        Ok(())
    }

    // =========================================================================
    // Account Operations & Anchor Balance Calculation Engine
    // =========================================================================

    pub fn create_account(
        &self,
        name: &str,
        account_type: AccountType,
        anchor_balance_cents: i64,
        anchor_date: &str,
        is_included_in_totals: bool,
    ) -> Result<Account, VaultError> {
        let account = Account {
            id: new_uuid_v7(),
            name: name.to_string(),
            account_type,
            anchor_balance_cents,
            anchor_date: anchor_date.to_string(),
            is_included_in_totals,
        };
        self.conn.execute(
            "INSERT INTO accounts (id, name, account_type, anchor_balance_cents, anchor_date, is_included_in_totals)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                account.id,
                account.name,
                account.account_type.as_str(),
                account.anchor_balance_cents,
                account.anchor_date,
                if account.is_included_in_totals { 1 } else { 0 }
            ],
        )?;
        Ok(account)
    }

    pub fn get_account(&self, account_id: &str) -> Result<Account, VaultError> {
        let account = self.conn.query_row(
            "SELECT id, name, account_type, anchor_balance_cents, anchor_date, is_included_in_totals
             FROM accounts WHERE id = ?1",
            params![account_id],
            |row| {
                let acct_type_str: String = row.get(2)?;
                let included: i64 = row.get(5)?;
                Ok(Account {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    account_type: AccountType::from_str(&acct_type_str)
                        .unwrap_or(AccountType::Checking),
                    anchor_balance_cents: row.get(3)?,
                    anchor_date: row.get(4)?,
                    is_included_in_totals: included != 0,
                })
            },
        )?;
        Ok(account)
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>, VaultError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, account_type, anchor_balance_cents, anchor_date, is_included_in_totals
             FROM accounts ORDER BY id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let acct_type_str: String = row.get(2)?;
            let included: i64 = row.get(5)?;
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                account_type: AccountType::from_str(&acct_type_str)
                    .unwrap_or(AccountType::Checking),
                anchor_balance_cents: row.get(3)?,
                anchor_date: row.get(4)?,
                is_included_in_totals: included != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn delete_account(&self, account_id: &str) -> Result<(), VaultError> {
        self.conn
            .execute("DELETE FROM accounts WHERE id = ?1", params![account_id])?;
        Ok(())
    }

    /// Calculates the exact zero-float balance in integer cents (`i64`) for an account on a given `target_date` (ISO-8601 `YYYY-MM-DD`).
    ///
    /// Rules (per Section 3.3 & Section 8 Edge Case 5 "The Retroactive Anchor Test"):
    /// - At `target_date == account.anchor_date`:
    ///   Balance is strictly `account.anchor_balance_cents`. Historical transactions on or before `anchor_date`
    ///   do NOT alter the balance on `anchor_date`.
    /// - For `target_date > account.anchor_date` (Forward calculation):
    ///   `Balance(target_date) = anchor_balance_cents + SUM(total_amount_cents WHERE anchor_date < date_posted <= target_date)`
    /// - For `target_date < account.anchor_date` (Retroactive calculation):
    ///   Working backwards from `anchor_date`, any transaction that occurred in `[target_date, anchor_date]`
    ///   is subtracted from `anchor_balance_cents` to find the historical balance as of `target_date`:
    ///   `Balance(target_date) = anchor_balance_cents - SUM(total_amount_cents WHERE target_date <= date_posted <= anchor_date)`
    pub fn calculate_account_balance_at_date(
        &self,
        account_id: &str,
        target_date: &str,
    ) -> Result<Cents, VaultError> {
        let account = self.get_account(account_id)?;
        let anchor = Cents::new(account.anchor_balance_cents);

        if target_date == account.anchor_date {
            return Ok(anchor);
        }

        if target_date > account.anchor_date.as_str() {
            let mut stmt = self.conn.prepare(
                "SELECT total_amount_cents FROM transactions
                 WHERE account_id = ?1 AND date_posted > ?2 AND date_posted <= ?3",
            )?;
            let amounts = stmt.query_map(
                params![account_id, account.anchor_date, target_date],
                |r| r.get::<_, i64>(0),
            )?;
            let mut balance = anchor;
            for amt_res in amounts {
                let amt = Cents::new(amt_res?);
                balance = balance
                    .checked_add(amt)
                    .ok_or(VaultError::ArithmeticOverflow)?;
            }
            Ok(balance)
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT total_amount_cents FROM transactions
                 WHERE account_id = ?1 AND date_posted >= ?2 AND date_posted <= ?3",
            )?;
            let amounts = stmt.query_map(
                params![account_id, target_date, account.anchor_date],
                |r| r.get::<_, i64>(0),
            )?;
            let mut balance = anchor;
            for amt_res in amounts {
                let amt = Cents::new(amt_res?);
                balance = balance
                    .checked_sub(amt)
                    .ok_or(VaultError::ArithmeticOverflow)?;
            }
            Ok(balance)
        }
    }

    /// Computes the current balance summary for an account (including all post-anchor transactions).
    pub fn get_account_balance_summary(
        &self,
        account_id: &str,
    ) -> Result<AccountBalanceSummary, VaultError> {
        let account = self.get_account(account_id)?;
        let anchor = Cents::new(account.anchor_balance_cents);

        let mut post_stmt = self.conn.prepare(
            "SELECT total_amount_cents FROM transactions
             WHERE account_id = ?1 AND date_posted > ?2",
        )?;
        let post_iter =
            post_stmt.query_map(params![account_id, account.anchor_date], |r| r.get::<_, i64>(0))?;
        let mut post_delta = Cents::ZERO;
        for amt in post_iter {
            post_delta = post_delta
                .checked_add(Cents::new(amt?))
                .ok_or(VaultError::ArithmeticOverflow)?;
        }

        let mut pre_stmt = self.conn.prepare(
            "SELECT total_amount_cents FROM transactions
             WHERE account_id = ?1 AND date_posted <= ?2",
        )?;
        let pre_iter =
            pre_stmt.query_map(params![account_id, account.anchor_date], |r| r.get::<_, i64>(0))?;
        let mut pre_delta = Cents::ZERO;
        for amt in pre_iter {
            pre_delta = pre_delta
                .checked_add(Cents::new(amt?))
                .ok_or(VaultError::ArithmeticOverflow)?;
        }

        let current_balance = anchor
            .checked_add(post_delta)
            .ok_or(VaultError::ArithmeticOverflow)?;

        Ok(AccountBalanceSummary {
            account,
            current_balance_cents: current_balance.as_i64(),
            anchor_balance_cents: anchor.as_i64(),
            post_anchor_delta_cents: post_delta.as_i64(),
            pre_anchor_delta_cents: pre_delta.as_i64(),
        })
    }

    // =========================================================================
    // Categories & Entities Operations
    // =========================================================================

    /// Creates a category while enforcing the max 3-level hierarchy depth constraint.
    pub fn create_category(
        &self,
        parent_id: Option<&str>,
        name: &str,
        direction: CategoryDirection,
        color_hex: &str,
    ) -> Result<Category, VaultError> {
        if let Some(pid) = parent_id {
            let depth = self.get_category_depth(pid)?;
            if depth >= 3 {
                return Err(VaultError::ValidationError(
                    "Category hierarchy cannot exceed 3 levels deep".to_string(),
                ));
            }
        }

        let category = Category {
            id: new_uuid_v7(),
            parent_id: parent_id.map(|s| s.to_string()),
            name: name.to_string(),
            direction,
            color_hex: color_hex.to_string(),
        };

        self.conn.execute(
            "INSERT INTO categories (id, parent_id, name, direction, color_hex)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                category.id,
                category.parent_id,
                category.name,
                category.direction.as_str(),
                category.color_hex
            ],
        )?;

        Ok(category)
    }

    fn get_category_depth(&self, category_id: &str) -> Result<usize, VaultError> {
        let mut depth = 0usize;
        let mut current_id = Some(category_id.to_string());
        while let Some(cid) = current_id {
            depth += 1;
            let parent: Option<Option<String>> = self
                .conn
                .query_row(
                    "SELECT parent_id FROM categories WHERE id = ?1",
                    params![cid],
                    |r| r.get(0),
                )
                .optional()?;
            match parent {
                Some(next_parent) => current_id = next_parent,
                None => {
                    return Err(VaultError::ValidationError(format!(
                        "Parent category {} does not exist",
                        cid
                    )))
                }
            }
        }
        Ok(depth)
    }

    pub fn create_entity(
        &self,
        normalized_name: &str,
        default_category_id: Option<&str>,
        tax_id_nif: Option<&str>,
    ) -> Result<Entity, VaultError> {
        let entity = Entity {
            id: new_uuid_v7(),
            normalized_name: normalized_name.trim().to_string(),
            default_category_id: default_category_id.map(|s| s.to_string()),
            tax_id_nif: tax_id_nif.map(|s| s.to_string()),
        };

        self.conn.execute(
            "INSERT INTO entities (id, normalized_name, default_category_id, tax_id_nif)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                entity.id,
                entity.normalized_name,
                entity.default_category_id,
                entity.tax_id_nif
            ],
        )?;

        Ok(entity)
    }

    pub fn delete_entity(&self, entity_id: &str) -> Result<(), VaultError> {
        self.conn
            .execute("DELETE FROM entities WHERE id = ?1", params![entity_id])?;
        Ok(())
    }

    // =========================================================================
    // Transactions & Splits Operations (Strict Zero-Float Split Validation)
    // =========================================================================

    /// Inserts a transaction along with its child splits in an atomic transaction.
    /// Enforces Section 3.3 constraints:
    /// 1. Every transaction MUST have at least one split in `transaction_splits`.
    /// 2. The sum of `split_amount_cents` across all splits MUST strictly equal `total_amount_cents` (checked `i64` math).
    pub fn insert_transaction_with_splits(
        &mut self,
        account_id: &str,
        entity_id: Option<&str>,
        date_posted: &str,
        total_amount_cents: i64,
        raw_bank_string: &str,
        clean_description: &str,
        dedup_hash: &str,
        is_reconciled: bool,
        splits: Vec<(Option<String>, Option<String>, i64, Option<String>)>,
    ) -> Result<TransactionWithSplits, VaultError> {
        if splits.is_empty() {
            return Err(VaultError::ValidationError(
                "A transaction must have at least one split".to_string(),
            ));
        }

        let mut split_sum = Cents::ZERO;
        for (_, _, amount_cents, _) in &splits {
            split_sum = split_sum
                .checked_add(Cents::new(*amount_cents))
                .ok_or(VaultError::ArithmeticOverflow)?;
        }

        if split_sum.as_i64() != total_amount_cents {
            return Err(VaultError::ValidationError(format!(
                "Sum of transaction splits ({}) does not equal total_amount_cents ({})",
                split_sum.as_i64(),
                total_amount_cents
            )));
        }

        let tx_id = new_uuid_v7();
        let tx = self.conn.transaction()?;

        tx.execute(
            "INSERT INTO transactions (
                id, account_id, entity_id, date_posted, total_amount_cents,
                raw_bank_string, clean_description, dedup_hash, is_reconciled
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                tx_id,
                account_id,
                entity_id,
                date_posted,
                total_amount_cents,
                raw_bank_string,
                clean_description,
                dedup_hash,
                if is_reconciled { 1 } else { 0 }
            ],
        )?;

        let mut saved_splits = Vec::with_capacity(splits.len());
        for (category_id, transfer_peer_account_id, split_amount_cents, notes) in splits {
            let split_id = new_uuid_v7();
            tx.execute(
                "INSERT INTO transaction_splits (
                    id, transaction_id, category_id, transfer_peer_account_id, split_amount_cents, notes
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    split_id,
                    tx_id,
                    category_id,
                    transfer_peer_account_id,
                    split_amount_cents,
                    notes
                ],
            )?;
            saved_splits.push(TransactionSplit {
                id: split_id,
                transaction_id: tx_id.clone(),
                category_id,
                transfer_peer_account_id,
                split_amount_cents,
                notes,
            });
        }

        tx.commit()?;

        Ok(TransactionWithSplits {
            transaction: Transaction {
                id: tx_id,
                account_id: account_id.to_string(),
                entity_id: entity_id.map(|s| s.to_string()),
                date_posted: date_posted.to_string(),
                total_amount_cents,
                raw_bank_string: raw_bank_string.to_string(),
                clean_description: clean_description.to_string(),
                dedup_hash: dedup_hash.to_string(),
                is_reconciled,
            },
            splits: saved_splits,
            running_balance_cents: None,
        })
    }

    pub fn get_transaction_with_splits(
        &self,
        transaction_id: &str,
    ) -> Result<TransactionWithSplits, VaultError> {
        let transaction = self.conn.query_row(
            "SELECT id, account_id, entity_id, date_posted, total_amount_cents,
                    raw_bank_string, clean_description, dedup_hash, is_reconciled
             FROM transactions WHERE id = ?1",
            params![transaction_id],
            |row| {
                let rec: i64 = row.get(8)?;
                Ok(Transaction {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    entity_id: row.get(2)?,
                    date_posted: row.get(3)?,
                    total_amount_cents: row.get(4)?,
                    raw_bank_string: row.get(5)?,
                    clean_description: row.get(6)?,
                    dedup_hash: row.get(7)?,
                    is_reconciled: rec != 0,
                })
            },
        )?;

        let mut stmt = self.conn.prepare(
            "SELECT id, transaction_id, category_id, transfer_peer_account_id, split_amount_cents, notes
             FROM transaction_splits WHERE transaction_id = ?1 ORDER BY id ASC",
        )?;
        let splits = stmt
            .query_map(params![transaction_id], |row| {
                Ok(TransactionSplit {
                    id: row.get(0)?,
                    transaction_id: row.get(1)?,
                    category_id: row.get(2)?,
                    transfer_peer_account_id: row.get(3)?,
                    split_amount_cents: row.get(4)?,
                    notes: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(TransactionWithSplits {
            transaction,
            splits,
            running_balance_cents: None,
        })
    }

    // =========================================================================
    // Import Rules & Bank Profiles Operations
    // =========================================================================

    pub fn create_import_rule(
        &self,
        match_mode: MatchMode,
        pattern_string: &str,
        account_scope_id: Option<&str>,
        assigned_entity_id: Option<&str>,
        assigned_category_id: Option<&str>,
        priority_weight: i32,
    ) -> Result<ImportRule, VaultError> {
        let rule = ImportRule {
            id: new_uuid_v7(),
            match_mode,
            pattern_string: pattern_string.to_string(),
            account_scope_id: account_scope_id.map(|s| s.to_string()),
            assigned_entity_id: assigned_entity_id.map(|s| s.to_string()),
            assigned_category_id: assigned_category_id.map(|s| s.to_string()),
            priority_weight,
            hit_count: 0,
        };

        self.conn.execute(
            "INSERT INTO import_rules (
                id, match_mode, pattern_string, account_scope_id,
                assigned_entity_id, assigned_category_id, priority_weight, hit_count
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
            params![
                rule.id,
                rule.match_mode.as_str(),
                rule.pattern_string,
                rule.account_scope_id,
                rule.assigned_entity_id,
                rule.assigned_category_id,
                rule.priority_weight
            ],
        )?;

        Ok(rule)
    }

    pub fn save_bank_profile(&self, profile: &BankProfile) -> Result<(), VaultError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO bank_profiles (
                id, profile_name, header_signature_hash, date_col_idx, desc_col_idx,
                amount_strategy, amount_col_idx, debit_col_idx, credit_col_idx,
                indicator_col_idx, decimal_separator
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                profile.id,
                profile.profile_name,
                profile.header_signature_hash,
                profile.date_col_idx as i64,
                profile.desc_col_idx as i64,
                profile.amount_strategy.as_str(),
                profile.amount_col_idx.map(|v| v as i64),
                profile.debit_col_idx.map(|v| v as i64),
                profile.credit_col_idx.map(|v| v as i64),
                profile.indicator_col_idx.map(|v| v as i64),
                profile.decimal_separator.to_string()
            ],
        )?;
        Ok(())
    }

    pub fn list_bank_profiles(&self) -> Result<Vec<BankProfile>, VaultError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, profile_name, header_signature_hash, date_col_idx, desc_col_idx,
                    amount_strategy, amount_col_idx, debit_col_idx, credit_col_idx,
                    indicator_col_idx, decimal_separator
             FROM bank_profiles ORDER BY profile_name ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let strategy_str: String = row.get(5)?;
            let dec_str: String = row.get(10)?;
            Ok(BankProfile {
                id: row.get(0)?,
                profile_name: row.get(1)?,
                header_signature_hash: row.get(2)?,
                date_col_idx: row.get::<_, i64>(3)? as usize,
                desc_col_idx: row.get::<_, i64>(4)? as usize,
                amount_strategy: AmountStrategy::from_str(&strategy_str)
                    .unwrap_or(AmountStrategy::SingleSigned),
                amount_col_idx: row.get::<_, Option<i64>>(6)?.map(|v| v as usize),
                debit_col_idx: row.get::<_, Option<i64>>(7)?.map(|v| v as usize),
                credit_col_idx: row.get::<_, Option<i64>>(8)?.map(|v| v as usize),
                indicator_col_idx: row.get::<_, Option<i64>>(9)?.map(|v| v as usize),
                decimal_separator: dec_str.chars().next().unwrap_or(','),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_import_rules(&self) -> Result<Vec<ImportRule>, VaultError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, match_mode, pattern_string, account_scope_id,
                    assigned_entity_id, assigned_category_id, priority_weight, hit_count
             FROM import_rules ORDER BY priority_weight DESC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let mode_str: String = row.get(1)?;
            Ok(ImportRule {
                id: row.get(0)?,
                match_mode: MatchMode::from_str(&mode_str).unwrap_or(MatchMode::Contains),
                pattern_string: row.get(2)?,
                account_scope_id: row.get(3)?,
                assigned_entity_id: row.get(4)?,
                assigned_category_id: row.get(5)?,
                priority_weight: row.get(6)?,
                hit_count: row.get(7)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_entities(&self) -> Result<Vec<Entity>, VaultError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, normalized_name, default_category_id, tax_id_nif
             FROM entities ORDER BY normalized_name ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Entity {
                id: row.get(0)?,
                normalized_name: row.get(1)?,
                default_category_id: row.get(2)?,
                tax_id_nif: row.get(3)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_categories(&self) -> Result<Vec<Category>, VaultError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, parent_id, name, direction, color_hex
             FROM categories ORDER BY name ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let dir_str: String = row.get(3)?;
            Ok(Category {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                direction: CategoryDirection::from_str(&dir_str)
                    .unwrap_or(CategoryDirection::Expense),
                color_hex: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_existing_dedup_hashes(
        &self,
        account_id: &str,
    ) -> Result<std::collections::HashSet<String>, VaultError> {
        let mut stmt = self
            .conn
            .prepare("SELECT dedup_hash FROM transactions WHERE account_id = ?1")?;
        let rows = stmt.query_map(params![account_id], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<std::collections::HashSet<_>, _>>()
            .map_err(Into::into)
    }

    pub fn get_historical_exemplars(
        &self,
    ) -> Result<Vec<crate::rules::HistoricalExemplar>, VaultError> {
        let mut stmt = self.conn.prepare(
            "SELECT t.clean_description, t.entity_id,
                    (SELECT s.category_id FROM transaction_splits s WHERE s.transaction_id = t.id LIMIT 1) as cat_id
             FROM transactions t
             WHERE t.entity_id IS NOT NULL OR cat_id IS NOT NULL
             GROUP BY t.clean_description, t.entity_id, cat_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(crate::rules::HistoricalExemplar {
                clean_description: row.get(0)?,
                entity_id: row.get(1)?,
                category_id: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn update_account(&self, account: &Account) -> Result<(), VaultError> {
        self.conn.execute(
            "UPDATE accounts
             SET name = ?2, account_type = ?3, anchor_balance_cents = ?4, anchor_date = ?5, is_included_in_totals = ?6
             WHERE id = ?1",
            params![
                account.id,
                account.name,
                account.account_type.as_str(),
                account.anchor_balance_cents,
                account.anchor_date,
                if account.is_included_in_totals { 1 } else { 0 }
            ],
        )?;
        Ok(())
    }

    pub fn list_all_account_balance_summaries(
        &self,
    ) -> Result<Vec<AccountBalanceSummary>, VaultError> {
        // Sub-1ms O(accounts) query backed by ACID SQLite triggers for <5ms Multi-Account Switcher reactivity
        let mut stmt = self.conn.prepare(
            "SELECT
                a.id,
                a.name,
                a.account_type,
                a.anchor_balance_cents,
                a.anchor_date,
                a.is_included_in_totals,
                a.cached_post_anchor_delta_cents,
                a.cached_pre_anchor_delta_cents
             FROM accounts a
             ORDER BY a.id ASC",
        )?;

        let rows = stmt.query_map([], |row| {
            let acct_type_str: String = row.get(2)?;
            let anchor_cents: i64 = row.get(3)?;
            let included: i64 = row.get(5)?;
            let post_delta: i64 = row.get(6)?;
            let pre_delta: i64 = row.get(7)?;
            let account = Account {
                id: row.get(0)?,
                name: row.get(1)?,
                account_type: AccountType::from_str(&acct_type_str)
                    .unwrap_or(AccountType::Checking),
                anchor_balance_cents: anchor_cents,
                anchor_date: row.get(4)?,
                is_included_in_totals: included != 0,
            };
            Ok(AccountBalanceSummary {
                account,
                current_balance_cents: anchor_cents.saturating_add(post_delta),
                anchor_balance_cents: anchor_cents,
                post_anchor_delta_cents: post_delta,
                pre_anchor_delta_cents: pre_delta,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn save_category(&self, category: &Category) -> Result<Category, VaultError> {
        if let Some(ref pid) = category.parent_id {
            if pid == &category.id {
                return Err(VaultError::ValidationError(
                    "Category cannot be its own parent".to_string(),
                ));
            }
            let depth = self.get_category_depth(pid)?;
            if depth >= 3 {
                return Err(VaultError::ValidationError(
                    "Category hierarchy cannot exceed 3 levels deep".to_string(),
                ));
            }
        }
        let id = if category.id.trim().is_empty() {
            new_uuid_v7()
        } else {
            category.id.clone()
        };
        let saved = Category {
            id: id.clone(),
            parent_id: category.parent_id.clone(),
            name: category.name.trim().to_string(),
            direction: category.direction,
            color_hex: category.color_hex.clone(),
        };
        self.conn.execute(
            "INSERT INTO categories (id, parent_id, name, direction, color_hex)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                parent_id = excluded.parent_id,
                name = excluded.name,
                direction = excluded.direction,
                color_hex = excluded.color_hex",
            params![
                saved.id,
                saved.parent_id,
                saved.name,
                saved.direction.as_str(),
                saved.color_hex
            ],
        )?;
        Ok(saved)
    }

    pub fn delete_category(
        &mut self,
        category_id: &str,
        reassign_to_id: Option<&str>,
    ) -> Result<(), VaultError> {
        let tx = self.conn.transaction()?;
        if let Some(target_id) = reassign_to_id {
            tx.execute(
                "UPDATE categories SET parent_id = ?1 WHERE parent_id = ?2",
                params![target_id, category_id],
            )?;
            tx.execute(
                "UPDATE transaction_splits SET category_id = ?1 WHERE category_id = ?2",
                params![target_id, category_id],
            )?;
            tx.execute(
                "UPDATE entities SET default_category_id = ?1 WHERE default_category_id = ?2",
                params![target_id, category_id],
            )?;
            tx.execute(
                "UPDATE import_rules SET assigned_category_id = ?1 WHERE assigned_category_id = ?2",
                params![target_id, category_id],
            )?;
        } else {
            // Cascade delete children up to 3 levels if no reassignment target given
            tx.execute(
                "DELETE FROM categories WHERE parent_id IN (SELECT id FROM categories WHERE parent_id = ?1)",
                params![category_id],
            )?;
            tx.execute(
                "DELETE FROM categories WHERE parent_id = ?1",
                params![category_id],
            )?;
        }
        tx.execute("DELETE FROM categories WHERE id = ?1", params![category_id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn save_entity(&self, entity: &Entity) -> Result<Entity, VaultError> {
        let id = if entity.id.trim().is_empty() {
            new_uuid_v7()
        } else {
            entity.id.clone()
        };
        let saved = Entity {
            id,
            normalized_name: entity.normalized_name.trim().to_string(),
            default_category_id: entity.default_category_id.clone(),
            tax_id_nif: entity.tax_id_nif.clone(),
        };
        self.conn.execute(
            "INSERT INTO entities (id, normalized_name, default_category_id, tax_id_nif)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
                normalized_name = excluded.normalized_name,
                default_category_id = excluded.default_category_id,
                tax_id_nif = excluded.tax_id_nif",
            params![
                saved.id,
                saved.normalized_name,
                saved.default_category_id,
                saved.tax_id_nif
            ],
        )?;
        Ok(saved)
    }

    pub fn save_import_rule(&self, rule: &ImportRule) -> Result<ImportRule, VaultError> {
        let id = if rule.id.trim().is_empty() {
            new_uuid_v7()
        } else {
            rule.id.clone()
        };
        let saved = ImportRule {
            id,
            match_mode: rule.match_mode,
            pattern_string: rule.pattern_string.trim().to_string(),
            account_scope_id: rule.account_scope_id.clone(),
            assigned_entity_id: rule.assigned_entity_id.clone(),
            assigned_category_id: rule.assigned_category_id.clone(),
            priority_weight: rule.priority_weight,
            hit_count: rule.hit_count,
        };
        self.conn.execute(
            "INSERT INTO import_rules (
                id, match_mode, pattern_string, account_scope_id,
                assigned_entity_id, assigned_category_id, priority_weight, hit_count
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                match_mode = excluded.match_mode,
                pattern_string = excluded.pattern_string,
                account_scope_id = excluded.account_scope_id,
                assigned_entity_id = excluded.assigned_entity_id,
                assigned_category_id = excluded.assigned_category_id,
                priority_weight = excluded.priority_weight,
                hit_count = excluded.hit_count",
            params![
                saved.id,
                saved.match_mode.as_str(),
                saved.pattern_string,
                saved.account_scope_id,
                saved.assigned_entity_id,
                saved.assigned_category_id,
                saved.priority_weight,
                saved.hit_count
            ],
        )?;
        Ok(saved)
    }

    pub fn delete_import_rule(&self, rule_id: &str) -> Result<(), VaultError> {
        self.conn
            .execute("DELETE FROM import_rules WHERE id = ?1", params![rule_id])?;
        Ok(())
    }

    pub fn update_transaction_with_splits(
        &mut self,
        transaction_id: &str,
        account_id: &str,
        entity_id: Option<&str>,
        date_posted: &str,
        total_amount_cents: i64,
        clean_description: &str,
        is_reconciled: bool,
        splits: Vec<(Option<String>, Option<String>, i64, Option<String>)>,
    ) -> Result<TransactionWithSplits, VaultError> {
        if splits.is_empty() {
            return Err(VaultError::ValidationError(
                "A transaction must have at least one split".to_string(),
            ));
        }

        let mut split_sum = Cents::ZERO;
        for (_, _, amount_cents, _) in &splits {
            split_sum = split_sum
                .checked_add(Cents::new(*amount_cents))
                .ok_or(VaultError::ArithmeticOverflow)?;
        }

        if split_sum.as_i64() != total_amount_cents {
            return Err(VaultError::ValidationError(format!(
                "Sum of transaction splits ({}) does not equal total_amount_cents ({})",
                split_sum.as_i64(),
                total_amount_cents
            )));
        }

        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE transactions
             SET account_id = ?2, entity_id = ?3, date_posted = ?4,
                 total_amount_cents = ?5, clean_description = ?6, is_reconciled = ?7
             WHERE id = ?1",
            params![
                transaction_id,
                account_id,
                entity_id,
                date_posted,
                total_amount_cents,
                clean_description,
                if is_reconciled { 1 } else { 0 }
            ],
        )?;

        tx.execute(
            "DELETE FROM transaction_splits WHERE transaction_id = ?1",
            params![transaction_id],
        )?;

        for (category_id, transfer_peer_account_id, split_amount_cents, notes) in splits {
            let split_id = new_uuid_v7();
            tx.execute(
                "INSERT INTO transaction_splits (
                    id, transaction_id, category_id, transfer_peer_account_id, split_amount_cents, notes
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    split_id,
                    transaction_id,
                    category_id,
                    transfer_peer_account_id,
                    split_amount_cents,
                    notes
                ],
            )?;
        }
        tx.commit()?;

        self.get_transaction_with_splits(transaction_id)
    }

    pub fn delete_transaction(&self, transaction_id: &str) -> Result<(), VaultError> {
        self.conn.execute(
            "DELETE FROM transactions WHERE id = ?1",
            params![transaction_id],
        )?;
        Ok(())
    }

    pub fn toggle_reconciliation(&self, transaction_id: &str) -> Result<bool, VaultError> {
        self.conn.execute(
            "UPDATE transactions SET is_reconciled = CASE WHEN is_reconciled = 1 THEN 0 ELSE 1 END WHERE id = ?1",
            params![transaction_id],
        )?;
        let new_val: i64 = self.conn.query_row(
            "SELECT is_reconciled FROM transactions WHERE id = ?1",
            params![transaction_id],
            |r| r.get(0),
        )?;
        Ok(new_val != 0)
    }

    pub fn backup_to_path(&self, target_path: &Path) -> Result<(), VaultError> {
        if target_path.exists() {
            std::fs::remove_file(target_path)?;
        }
        self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        if let Some(ref src_path) = self.path {
            std::fs::copy(src_path, target_path)?;
            Ok(())
        } else {
            let target_str = target_path.to_string_lossy().replace('\'', "''");
            self.conn
                .execute_batch(&format!("VACUUM INTO '{}';", target_str))?;
            Ok(())
        }
    }

    /// Queries transactions filtered by selected accounts, date range, and text query,
    /// returning both the paginated rows (with their splits) and the exact zero-float period KPIs
    /// (handling internal transfers and MB WAY expense reimbursements per Section 5.3).
    pub fn query_ledger(
        &self,
        account_ids: &[String],
        start_date: Option<&str>,
        end_date: Option<&str>,
        search_query: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<(Vec<TransactionWithSplits>, usize, i64, i64), VaultError> {
        if account_ids.is_empty() {
            return Ok((Vec::new(), 0, 0, 0));
        }

        let placeholders: Vec<String> = (1..=account_ids.len()).map(|i| format!("?{}", i)).collect();
        let in_clause = placeholders.join(", ");

        let mut where_clauses = vec![format!("t.account_id IN ({})", in_clause)];
        let mut bind_values: Vec<rusqlite::types::Value> = account_ids
            .iter()
            .map(|s| rusqlite::types::Value::Text(s.clone()))
            .collect();

        if let Some(sd) = start_date.filter(|s| !s.trim().is_empty()) {
            bind_values.push(rusqlite::types::Value::Text(sd.to_string()));
            where_clauses.push(format!("t.date_posted >= ?{}", bind_values.len()));
        }
        if let Some(ed) = end_date.filter(|s| !s.trim().is_empty()) {
            bind_values.push(rusqlite::types::Value::Text(ed.to_string()));
            where_clauses.push(format!("t.date_posted <= ?{}", bind_values.len()));
        }
        if let Some(q) = search_query.filter(|s| !s.trim().is_empty()) {
            let pattern = format!("%{}%", q.trim().to_uppercase());
            bind_values.push(rusqlite::types::Value::Text(pattern));
            let idx = bind_values.len();
            where_clauses.push(format!(
                "(UPPER(t.clean_description) LIKE ?{idx} OR UPPER(t.raw_bank_string) LIKE ?{idx})"
            ));
        }

        let where_sql = where_clauses.join(" AND ");

        // 1. Total matching transaction count
        let count_sql = format!("SELECT COUNT(*) FROM transactions t WHERE {}", where_sql);
        let total_count: usize = self.conn.query_row(
            &count_sql,
            rusqlite::params_from_iter(bind_values.iter()),
            |r| r.get::<_, i64>(0).map(|v| v as usize),
        )?;

        // 2. Period Inflow & Outflow KPI calculation (Section 5.3 compliant):
        // - Internal Transfers (`s.transfer_peer_account_id IS NOT NULL`) are excluded from income/expense totals.
        // - Expense Reimbursements ("MB WAY Dinner" problem): positive splits assigned to an `Expense` category
        //   net down `period_outflow_cents` instead of inflating `period_inflow_cents`!
        let kpi_sql = format!(
            "SELECT
                COALESCE(SUM(
                    CASE
                        WHEN s.transfer_peer_account_id IS NOT NULL THEN 0
                        WHEN c.direction = 'Expense' THEN 0
                        WHEN c.direction = 'Income' THEN s.split_amount_cents
                        WHEN s.split_amount_cents > 0 THEN s.split_amount_cents
                        ELSE 0
                    END
                ), 0) AS period_inflow_cents,
                COALESCE(SUM(
                    CASE
                        WHEN s.transfer_peer_account_id IS NOT NULL THEN 0
                        WHEN c.direction = 'Expense' THEN s.split_amount_cents
                        WHEN c.direction = 'Income' THEN 0
                        WHEN s.split_amount_cents < 0 THEN s.split_amount_cents
                        ELSE 0
                    END
                ), 0) AS period_outflow_cents
             FROM transactions t
             JOIN transaction_splits s ON s.transaction_id = t.id
             LEFT JOIN categories c ON c.id = s.category_id
             WHERE {}",
            where_sql
        );

        let (period_inflow_cents, period_outflow_cents): (i64, i64) = self.conn.query_row(
            &kpi_sql,
            rusqlite::params_from_iter(bind_values.iter()),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;

        // 3. Fetch paginated transactions
        let mut page_binds = bind_values.clone();
        page_binds.push(rusqlite::types::Value::Integer(limit as i64));
        let limit_idx = page_binds.len();
        page_binds.push(rusqlite::types::Value::Integer(offset as i64));
        let offset_idx = page_binds.len();

        let tx_sql = format!(
            "SELECT t.id, t.account_id, t.entity_id, t.date_posted, t.total_amount_cents,
                    t.raw_bank_string, t.clean_description, t.dedup_hash, t.is_reconciled
             FROM transactions t
             WHERE {}
             ORDER BY t.date_posted DESC, t.id DESC
             LIMIT ?{} OFFSET ?{}",
            where_sql, limit_idx, offset_idx
        );

        let mut stmt = self.conn.prepare(&tx_sql)?;
        let tx_rows: Vec<Transaction> = stmt
            .query_map(rusqlite::params_from_iter(page_binds.iter()), |row| {
                let rec: i64 = row.get(8)?;
                Ok(Transaction {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    entity_id: row.get(2)?,
                    date_posted: row.get(3)?,
                    total_amount_cents: row.get(4)?,
                    raw_bank_string: row.get(5)?,
                    clean_description: row.get(6)?,
                    dedup_hash: row.get(7)?,
                    is_reconciled: rec != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        if tx_rows.is_empty() {
            return Ok((
                Vec::new(),
                total_count,
                period_inflow_cents,
                period_outflow_cents,
            ));
        }

        // Batch fetch splits for the page transactions
        let tx_placeholders: Vec<String> =
            (1..=tx_rows.len()).map(|i| format!("?{}", i)).collect();
        let splits_sql = format!(
            "SELECT id, transaction_id, category_id, transfer_peer_account_id, split_amount_cents, notes
             FROM transaction_splits
             WHERE transaction_id IN ({})
             ORDER BY id ASC",
            tx_placeholders.join(", ")
        );
        let tx_id_values: Vec<rusqlite::types::Value> = tx_rows
            .iter()
            .map(|t| rusqlite::types::Value::Text(t.id.clone()))
            .collect();

        let mut split_stmt = self.conn.prepare(&splits_sql)?;
        let all_splits: Vec<TransactionSplit> = split_stmt
            .query_map(rusqlite::params_from_iter(tx_id_values.iter()), |row| {
                Ok(TransactionSplit {
                    id: row.get(0)?,
                    transaction_id: row.get(1)?,
                    category_id: row.get(2)?,
                    transfer_peer_account_id: row.get(3)?,
                    split_amount_cents: row.get(4)?,
                    notes: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut splits_by_tx: std::collections::HashMap<String, Vec<TransactionSplit>> =
            std::collections::HashMap::with_capacity(tx_rows.len());
        for sp in all_splits {
            splits_by_tx
                .entry(sp.transaction_id.clone())
                .or_default()
                .push(sp);
        }

        let results = tx_rows
            .into_iter()
            .map(|t| {
                let splits = splits_by_tx.remove(&t.id).unwrap_or_default();
                TransactionWithSplits {
                    transaction: t,
                    splits,
                    running_balance_cents: None,
                }
            })
            .collect();

        Ok((
            results,
            total_count,
            period_inflow_cents,
            period_outflow_cents,
        ))
    }

    pub fn vault_path_string(&self) -> Option<String> {
        self.path.as_ref().map(|p| p.to_string_lossy().to_string())
    }

    /// Seeds realistic Portuguese default categories, entities, rules, accounts, and sample transactions
    /// when a brand-new vault is created so the user immediately has a rich working taxonomy.
    pub fn seed_default_portuguese_workspace_if_empty(&mut self) -> Result<(), VaultError> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))?;
        if count > 0 {
            return Ok(());
        }

        // 1. Accounts
        let acc_cgd = self.create_account(
            "Checking CGD",
            AccountType::Checking,
            342_010, // 3.420,10 €
            "2026-10-01",
            true,
        )?;
        let acc_bcp = self.create_account(
            "Millennium BCP",
            AccountType::Checking,
            183_070, // 1.830,70 €
            "2026-10-01",
            true,
        )?;
        let acc_savings = self.create_account(
            "Poupança PPR / Cert. Aforro",
            AccountType::Savings,
            850_000, // 8.500,00 €
            "2026-10-01",
            true,
        )?;
        let acc_revolut = self.create_account(
            "Revolut",
            AccountType::Checking,
            25_000, // 250,00 €
            "2026-10-01",
            true,
        )?;
        let _acc_meal = self.create_account(
            "Cartão Refeição Coverflex",
            AccountType::MealCard,
            16_800, // 168,00 €
            "2026-10-01",
            true,
        )?;

        // 2. Categories (3-level hierarchy per Section 3.3: e.g., Habitação > Serviços > Água)
        let cat_hab = self.create_category(None, "Habitação", CategoryDirection::Expense, "#f97316")?;
        let cat_hab_serv = self.create_category(
            Some(&cat_hab.id),
            "Serviços",
            CategoryDirection::Expense,
            "#fb923c",
        )?;
        let cat_agua = self.create_category(
            Some(&cat_hab_serv.id),
            "Água",
            CategoryDirection::Expense,
            "#38bdf8",
        )?;
        let cat_eletricidade = self.create_category(
            Some(&cat_hab_serv.id),
            "Eletricidade & Gás",
            CategoryDirection::Expense,
            "#facc15",
        )?;
        let cat_telecom = self.create_category(
            Some(&cat_hab_serv.id),
            "Telecomunicações",
            CategoryDirection::Expense,
            "#818cf8",
        )?;

        let cat_alim =
            self.create_category(None, "Alimentação", CategoryDirection::Expense, "#10b981")?;
        let cat_super = self.create_category(
            Some(&cat_alim.id),
            "Supermercado",
            CategoryDirection::Expense,
            "#34d399",
        )?;
        let cat_rest = self.create_category(
            Some(&cat_alim.id),
            "Restauração & Cafés",
            CategoryDirection::Expense,
            "#f43f5e",
        )?;

        let cat_saude = self.create_category(None, "Saúde", CategoryDirection::Expense, "#ec4899")?;
        let cat_farmacia = self.create_category(
            Some(&cat_saude.id),
            "Farmácia",
            CategoryDirection::Expense,
            "#f472b6",
        )?;

        let cat_pessoal =
            self.create_category(None, "Pessoal & Casa", CategoryDirection::Expense, "#a855f7")?;
        let cat_higiene = self.create_category(
            Some(&cat_pessoal.id),
            "Higiene & Limpeza",
            CategoryDirection::Expense,
            "#c084fc",
        )?;

        let cat_rend =
            self.create_category(None, "Rendimentos", CategoryDirection::Income, "#10b981")?;
        let cat_salario = self.create_category(
            Some(&cat_rend.id),
            "Salário Líquido",
            CategoryDirection::Income,
            "#34d399",
        )?;

        // 3. Entities with Default Categories and Portuguese NIFs
        let ent_continente =
            self.create_entity("Continente", Some(&cat_super.id), Some("500276999"))?;
        let ent_pingo_doce =
            self.create_entity("Pingo Doce", Some(&cat_super.id), Some("500829993"))?;
        let ent_epal = self.create_entity("EPAL Águas", Some(&cat_agua.id), Some("500906840"))?;
        let ent_edp =
            self.create_entity("EDP Comercial", Some(&cat_eletricidade.id), Some("503504564"))?;
        let ent_vodafone =
            self.create_entity("Vodafone Portugal", Some(&cat_telecom.id), Some("502544180"))?;
        let ent_farmacia = self.create_entity(
            "Farmácia São João",
            Some(&cat_farmacia.id),
            Some("501442100"),
        )?;
        let ent_delta =
            self.create_entity("Padaria Portuguesa", Some(&cat_rest.id), Some("509445123"))?;
        let ent_emp =
            self.create_entity("TechCorp Portugal Lda", Some(&cat_salario.id), Some("514000111"))?;

        // 4. Default Import Rules
        self.create_import_rule(
            MatchMode::Contains,
            "CONTINENTE",
            None,
            Some(&ent_continente.id),
            Some(&cat_super.id),
            200,
        )?;
        self.create_import_rule(
            MatchMode::Contains,
            "PINGO DOCE",
            None,
            Some(&ent_pingo_doce.id),
            Some(&cat_super.id),
            200,
        )?;
        self.create_import_rule(
            MatchMode::Contains,
            "EPAL",
            None,
            Some(&ent_epal.id),
            Some(&cat_agua.id),
            250,
        )?;
        self.create_import_rule(
            MatchMode::Contains,
            "EDP COMERCIAL",
            None,
            Some(&ent_edp.id),
            Some(&cat_eletricidade.id),
            250,
        )?;
        self.create_import_rule(
            MatchMode::Contains,
            "VODAFONE",
            None,
            Some(&ent_vodafone.id),
            Some(&cat_telecom.id),
            200,
        )?;
        self.create_import_rule(
            MatchMode::Contains,
            "FARMÁCIA SÃO JOÃO",
            None,
            Some(&ent_farmacia.id),
            Some(&cat_farmacia.id),
            220,
        )?;
        self.create_import_rule(
            MatchMode::Contains,
            "PADARIA PORTUGUESA",
            None,
            Some(&ent_delta.id),
            Some(&cat_rest.id),
            180,
        )?;

        // 5. Sample Transactions demonstrating Standard, Split, Internal Transfer, and MB WAY Reimbursement
        self.insert_transaction_with_splits(
            &acc_cgd.id,
            Some(&ent_emp.id),
            "2026-10-05",
            280_000, // +2.800,00 €
            "TRF SEPA+ TECHCORP PORTUGAL LDA",
            "TECHCORP PORTUGAL LDA",
            "seed_tx_1",
            true,
            vec![(
                Some(cat_salario.id.clone()),
                None,
                280_000,
                Some("Salário Outubro 2026".to_string()),
            )],
        )?;

        // Multi-category Split transaction (-100,00 € at Continente: -30,00 € Higiene + -70,00 € Supermercado)
        self.insert_transaction_with_splits(
            &acc_cgd.id,
            Some(&ent_continente.id),
            "2026-10-08",
            -10_000,
            "COMPRA ELEC Card *4512 CONTINENTE COLOMBO",
            "CONTINENTE COLOMBO",
            "seed_tx_2",
            true,
            vec![
                (
                    Some(cat_higiene.id),
                    None,
                    -3_000,
                    Some("Champô e detergentes".to_string()),
                ),
                (
                    Some(cat_super.id.clone()),
                    None,
                    -7_000,
                    Some("Compras semanais".to_string()),
                ),
            ],
        )?;

        // Group dinner + MB WAY Expense Reimbursement ("The MB WAY Dinner Problem", Section 5.3)
        self.insert_transaction_with_splits(
            &acc_bcp.id,
            Some(&ent_delta.id),
            "2026-10-12",
            -6_000, // -60,00 €
            "COMPRA ELEC RESTAURANTE LISBOA",
            "RESTAURANTE LISBOA",
            "seed_tx_3",
            true,
            vec![(
                Some(cat_rest.id.clone()),
                None,
                -6_000,
                Some("Jantar de grupo (3 pessoas)".to_string()),
            )],
        )?;

        self.insert_transaction_with_splits(
            &acc_bcp.id,
            None,
            "2026-10-13",
            4_000, // +40,00 € reimbursement assigned directly to Expense category `Restauração`
            "TRF MB WAY DE [PHONE] AMIGOS JANTAR",
            "AMIGOS JANTAR (Reembolso MB WAY)",
            "seed_tx_4",
            true,
            vec![(
                Some(cat_rest.id),
                None,
                4_000,
                Some("Reembolso MB WAY jantar (abate despesa)".to_string()),
            )],
        )?;

        // Internal Transfer from Checking CGD to Revolut (-150,00 €)
        self.insert_transaction_with_splits(
            &acc_cgd.id,
            None,
            "2026-10-15",
            -15_000,
            "TRF SEPA P/ REVOLUT TOPUP",
            "Transferência para Revolut",
            "seed_tx_5",
            true,
            vec![(
                None,
                Some(acc_revolut.id.clone()),
                -15_000,
                Some("Reforço Revolut".to_string()),
            )],
        )?;

        self.insert_transaction_with_splits(
            &acc_cgd.id,
            Some(&ent_edp.id),
            "2026-10-18",
            -6_450,
            "DD EDP COMERCIAL FATURA OUT",
            "EDP COMERCIAL",
            "seed_tx_6",
            false,
            vec![(
                Some(cat_eletricidade.id),
                None,
                -6_450,
                Some("Fatura mensal eletricidade".to_string()),
            )],
        )?;

        self.insert_transaction_with_splits(
            &acc_cgd.id,
            Some(&ent_epal.id),
            "2026-10-19",
            -2_480,
            "DD EPAL AGUAS LISBOA",
            "EPAL ÁGUAS",
            "seed_tx_7",
            false,
            vec![(
                Some(cat_agua.id),
                None,
                -2_480,
                Some("Consumo água".to_string()),
            )],
        )?;

        let _ = acc_savings;
        Ok(())
    }

    /// Seeds `count` (e.g., 100,000) synthetic historical transactions across 8 accounts
    /// inside a single fast SQLite transaction to verify Edge Case 4 ("The 10-Year Ledger Benchmark").
    /// Returns the elapsed millisecond time of a subsequent full 8-account balance + ledger query.
    pub fn seed_benchmark_transactions(&mut self, count: usize) -> Result<(u128, u128), VaultError> {
        let existing_accounts = self.list_accounts()?;
        let mut account_ids: Vec<String> = existing_accounts.into_iter().map(|a| a.id).collect();
        while account_ids.len() < 8 {
            let idx = account_ids.len() + 1;
            let acc = self.create_account(
                &format!("Conta Benchmark #{}", idx),
                AccountType::Checking,
                250_000,
                "2026-10-20",
                true,
            )?;
            account_ids.push(acc.id);
        }

        let categories = self.list_categories()?;
        let default_cat_id = categories.first().map(|c| c.id.clone());

        let start_insert = std::time::Instant::now();
        let tx = self.conn.transaction()?;
        {
            let mut tx_stmt = tx.prepare(
                "INSERT INTO transactions (
                    id, account_id, entity_id, date_posted, total_amount_cents,
                    raw_bank_string, clean_description, dedup_hash, is_reconciled
                 ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, 1)",
            )?;
            let mut sp_stmt = tx.prepare(
                "INSERT INTO transaction_splits (
                    id, transaction_id, category_id, transfer_peer_account_id, split_amount_cents, notes
                 ) VALUES (?1, ?2, ?3, NULL, ?4, NULL)",
            )?;

            let merchants = [
                "CONTINENTE MODELO",
                "PINGO DOCE",
                "EDP COMERCIAL",
                "FARMACIA SAO JOAO",
                "GALP ENERGIA",
                "VIA VERDE PORTUGAL",
                "PADARIA PORTUGUESA",
                "FNAC PORTUGAL",
            ];

            for i in 0..count {
                let acc_id = &account_ids[i % 8];
                let year = 2017 + (i % 10);
                let month = 1 + (i % 12);
                let day = 1 + (i % 28);
                let date_str = format!("{:04}-{:02}-{:02}", year, month, day);
                let amount_cents: i64 = if i % 15 == 0 {
                    185_000 // salary inflow
                } else {
                    -(((i as i64 % 95) + 1) * 125)
                };
                let merchant = merchants[i % merchants.len()];
                let tx_id = format!("bench_tx_{:07}", i);
                let sp_id = format!("bench_sp_{:07}", i);
                let dedup = format!("bench_dedup_{:07}", i);

                tx_stmt.execute(params![
                    tx_id,
                    acc_id,
                    date_str,
                    amount_cents,
                    merchant,
                    merchant,
                    dedup
                ])?;
                sp_stmt.execute(params![sp_id, tx_id, default_cat_id, amount_cents])?;
            }
        }
        tx.commit()?;
        let insert_ms = start_insert.elapsed().as_millis();

        // Measure account toggle balance recalculation speed across the 100k ledger
        let start_query = std::time::Instant::now();
        let _summaries = self.list_all_account_balance_summaries()?;
        let query_ms = start_query.elapsed().as_millis();

        Ok((insert_ms, query_ms))
    }

    /// Exports all transactions for the selected `account_ids` into CSV or JSON format.
    pub fn export_ledger_data(
        &self,
        format: &str,
        account_ids: &[String],
    ) -> Result<String, VaultError> {
        let (rows, _, _, _) = self.query_ledger(account_ids, None, None, None, 250_000, 0)?;
        if format.eq_ignore_ascii_case("json") {
            serde_json::to_string_pretty(&rows)
                .map_err(|e| VaultError::ValidationError(e.to_string()))
        } else {
            let mut csv_out = String::from(
                "id;account_id;date_posted;clean_description;raw_bank_string;total_amount_cents;amount_eur;is_reconciled;dedup_hash\n",
            );
            for item in rows {
                let t = item.transaction;
                let eur = Cents::new(t.total_amount_cents).format_eur();
                csv_out.push_str(&format!(
                    "{};{};{};\"{}\";\"{}\";{};{};{};{}\n",
                    t.id,
                    t.account_id,
                    t.date_posted,
                    t.clean_description.replace('"', "\"\""),
                    t.raw_bank_string.replace('"', "\"\""),
                    t.total_amount_cents,
                    eur,
                    t.is_reconciled,
                    t.dedup_hash
                ));
            }
            Ok(csv_out)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn temp_vault_path(name: &str) -> PathBuf {
        let mut dir = env::temp_dir();
        dir.push(format!("finfolio_test_{}_{}.finfolio", name, new_uuid_v7()));
        dir
    }

    #[test]
    fn test_zero_float_cents_formatting_and_math() {
        let c1 = Cents::new(145_075);
        assert_eq!(c1.format_eur(), "1.450,75 €");

        let c2 = Cents::new(-20_000);
        assert_eq!(c2.format_eur(), "-200,00 €");

        let c3 = Cents::new(100_000);
        assert_eq!(c3.format_eur(), "1.000,00 €");

        let sum = c3.checked_add(c2).unwrap();
        assert_eq!(sum.as_i64(), 80_000);
        assert_eq!(sum.format_eur(), "800,00 €");

        let diff = c3.checked_sub(c2).unwrap();
        assert_eq!(diff.as_i64(), 120_000);
        assert_eq!(diff.format_eur(), "1.200,00 €");
    }

    #[test]
    fn test_schema_integrity_and_cascades() {
        let mut vault = VaultEngine::open_in_memory().expect("open in-memory vault");
        let meta = vault.get_metadata().expect("get metadata");
        assert_eq!(meta.schema_version, 1);
        assert_eq!(meta.base_currency, "EUR");
        assert_eq!(meta.cycle_start_day, 1);

        // 3-level Category hierarchy test (Habitação > Serviços > Água)
        let cat_l1 = vault
            .create_category(None, "Habitação", CategoryDirection::Expense, "#ef4444")
            .unwrap();
        let cat_l2 = vault
            .create_category(
                Some(&cat_l1.id),
                "Serviços",
                CategoryDirection::Expense,
                "#f97316",
            )
            .unwrap();
        let cat_l3 = vault
            .create_category(
                Some(&cat_l2.id),
                "Água",
                CategoryDirection::Expense,
                "#3b82f6",
            )
            .unwrap();

        // Attempting a 4th level must fail validation
        let cat_l4_err = vault.create_category(
            Some(&cat_l3.id),
            "Sub-Água",
            CategoryDirection::Expense,
            "#3b82f6",
        );
        assert!(cat_l4_err.is_err());

        // Create Entity linked to default category
        let entity = vault
            .create_entity("EPAL AGUAS", Some(&cat_l3.id), Some("500999888"))
            .unwrap();

        // Create Account
        let account = vault
            .create_account("CGD Ordem", AccountType::Checking, 100_000, "2026-10-20", true)
            .unwrap();

        // Split validation: mismatched split sum must be rejected
        let bad_split_res = vault.insert_transaction_with_splits(
            &account.id,
            Some(&entity.id),
            "2026-10-20",
            -3500,
            "DD EPAL AGUAS",
            "EPAL AGUAS",
            "hash_1",
            false,
            vec![(Some(cat_l3.id.clone()), None, -3000, None)],
        );
        assert!(bad_split_res.is_err());

        // Valid multi-split transaction (-2000 + -1500 == -3500)
        let tx_with_splits = vault
            .insert_transaction_with_splits(
                &account.id,
                Some(&entity.id),
                "2026-10-20",
                -3500,
                "DD EPAL AGUAS",
                "EPAL AGUAS",
                "hash_1",
                true,
                vec![
                    (
                        Some(cat_l3.id.clone()),
                        None,
                        -2000,
                        Some("Consumo".to_string()),
                    ),
                    (
                        Some(cat_l2.id.clone()),
                        None,
                        -1500,
                        Some("Taxa".to_string()),
                    ),
                ],
            )
            .unwrap();
        assert_eq!(tx_with_splits.splits.len(), 2);

        // Deleting an Entity must set `entity_id` to NULL on historical transactions (not delete them)
        vault.delete_entity(&entity.id).unwrap();
        let reloaded_tx = vault
            .get_transaction_with_splits(&tx_with_splits.transaction.id)
            .unwrap();
        assert!(reloaded_tx.transaction.entity_id.is_none());
        assert_eq!(reloaded_tx.splits.len(), 2);

        // Deleting an Account must cascade to its transactions and splits
        vault.delete_account(&account.id).unwrap();
        assert!(vault
            .get_transaction_with_splits(&tx_with_splits.transaction.id)
            .is_err());
    }

    #[test]
    fn test_edge_case_5_retroactive_anchor_balance() {
        let mut vault = VaultEngine::open_in_memory().expect("open in-memory vault");

        // Edge Case 5:
        // "Setting an account's Anchor Balance to 1.000,00 € on 2026-10-20, and subsequently
        // importing a historical statement from 2026-09-01 with -200,00 € in expenses, must
        // leave the 2026-10-20 balance untouched at 1.000,00 € while accurately calculating
        // the 2026-09-01 historical balance as 1.200,00 €."
        let account = vault
            .create_account(
                "ActivoBank",
                AccountType::Checking,
                100_000, // 1.000,00 € in cents
                "2026-10-20",
                true,
            )
            .unwrap();

        // Import historical transaction on 2026-09-01 of -200,00 € (-20_000 cents)
        vault
            .insert_transaction_with_splits(
                &account.id,
                None,
                "2026-09-01",
                -20_000,
                "COMPRA CONTINENTE",
                "CONTINENTE",
                "dedup_hist_1",
                false,
                vec![(None, None, -20_000, None)],
            )
            .unwrap();

        // Verify 2026-10-20 balance remains untouched at 1.000,00 € (100_000 cents)
        let anchor_day_balance = vault
            .calculate_account_balance_at_date(&account.id, "2026-10-20")
            .unwrap();
        assert_eq!(anchor_day_balance.as_i64(), 100_000);
        assert_eq!(anchor_day_balance.format_eur(), "1.000,00 €");

        // Verify 2026-09-01 historical balance is 1.200,00 € (120_000 cents)
        let hist_balance = vault
            .calculate_account_balance_at_date(&account.id, "2026-09-01")
            .unwrap();
        assert_eq!(hist_balance.as_i64(), 120_000);
        assert_eq!(hist_balance.format_eur(), "1.200,00 €");

        // Now add a forward transaction after the anchor date (2026-10-25: +500,00 € salary / inflow)
        vault
            .insert_transaction_with_splits(
                &account.id,
                None,
                "2026-10-25",
                50_000,
                "TRF SALARIO",
                "SALARIO",
                "dedup_fwd_1",
                false,
                vec![(None, None, 50_000, None)],
            )
            .unwrap();

        let fwd_balance = vault
            .calculate_account_balance_at_date(&account.id, "2026-10-25")
            .unwrap();
        assert_eq!(fwd_balance.as_i64(), 150_000);
        assert_eq!(fwd_balance.format_eur(), "1.500,00 €");

        let summary = vault.get_account_balance_summary(&account.id).unwrap();
        assert_eq!(summary.anchor_balance_cents, 100_000);
        assert_eq!(summary.current_balance_cents, 150_000);
        assert_eq!(summary.post_anchor_delta_cents, 50_000);
        assert_eq!(summary.pre_anchor_delta_cents, -20_000);
    }

    #[test]
    fn test_encrypted_and_unencrypted_vault_lifecycle_and_rekey() {
        let path = temp_vault_path("crypto_lifecycle");

        // 1. Create an encrypted vault with Argon2id + SQLCipher
        {
            let vault = VaultEngine::open_or_create(&path, Some("correct-horse-battery-staple"))
                .expect("create encrypted vault");
            assert!(vault.is_encrypted());
            assert!(vault.is_key_memory_locked());
            vault
                .create_account("Millennium", AccountType::Checking, 250_000, "2026-10-20", true)
                .unwrap();
        }

        // Verify the on-disk header is a 16-byte random salt (NOT "SQLite format 3\0")
        let header_salt = read_vault_header_salt(&path)
            .unwrap()
            .expect("should have encrypted salt header");
        assert_ne!(&header_salt, crate::crypto::SQLITE3_HEADER_MAGIC);

        // 2. Opening without passphrase must fail with PassphraseRequired
        assert!(matches!(
            VaultEngine::open_or_create(&path, None),
            Err(VaultError::PassphraseRequired)
        ));

        // 3. Opening with wrong passphrase must fail with InvalidPassphrase
        assert!(matches!(
            VaultEngine::open_or_create(&path, Some("wrong-passphrase")),
            Err(VaultError::InvalidPassphrase)
        ));

        // 4. Re-open with correct passphrase and rekey to unencrypted
        {
            let mut vault =
                VaultEngine::open_or_create(&path, Some("correct-horse-battery-staple"))
                    .expect("reopen encrypted vault");
            let accounts = vault.list_accounts().unwrap();
            assert_eq!(accounts.len(), 1);
            assert_eq!(accounts[0].name, "Millennium");

            // Remove passphrase (Encrypted -> Unencrypted)
            vault.rekey(None).expect("rekey to unencrypted");
            assert!(!vault.is_encrypted());
        }

        // Verify the on-disk header is now standard SQLite 3 magic ("SQLite format 3\0")
        assert!(read_vault_header_salt(&path).unwrap().is_none());

        // 5. Re-open unencrypted and rekey back to a new passphrase (Unencrypted -> Encrypted)
        {
            let mut vault =
                VaultEngine::open_or_create(&path, None).expect("open unencrypted vault");
            assert_eq!(vault.list_accounts().unwrap().len(), 1);
            vault
                .rekey(Some("new-master-passphrase-2026"))
                .expect("rekey back to encrypted");
            assert!(vault.is_encrypted());
        }

        // 6. Verify new passphrase works and data is intact
        {
            let vault = VaultEngine::open_or_create(&path, Some("new-master-passphrase-2026"))
                .expect("open with new passphrase");
            let accounts = vault.list_accounts().unwrap();
            assert_eq!(accounts.len(), 1);
            assert_eq!(accounts[0].anchor_balance_cents, 250_000);
        }

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_section_5_3_internal_transfers_and_mbway_reimbursements() {
        let mut vault = VaultEngine::open_in_memory().unwrap();
        let acc_cgd = vault
            .create_account("CGD", AccountType::Checking, 100_000, "2026-10-01", true)
            .unwrap();
        let acc_sav = vault
            .create_account("Savings", AccountType::Savings, 500_000, "2026-10-01", true)
            .unwrap();

        let cat_rest = vault
            .create_category(None, "Restauração", CategoryDirection::Expense, "#f43f5e")
            .unwrap();

        // 1. Group dinner expense: -60,00 € (-6000 cents)
        vault
            .insert_transaction_with_splits(
                &acc_cgd.id,
                None,
                "2026-10-10",
                -6_000,
                "COMPRA RESTAURANTE",
                "RESTAURANTE",
                "mbway_dinner_1",
                true,
                vec![(Some(cat_rest.id.clone()), None, -6_000, None)],
            )
            .unwrap();

        // 2. Two +20,00 € MB WAY transfers from friends categorized against Expense category `Restauração`
        vault
            .insert_transaction_with_splits(
                &acc_cgd.id,
                None,
                "2026-10-11",
                2_000,
                "TRF MB WAY AMIGO 1",
                "AMIGO 1",
                "mbway_dinner_2",
                true,
                vec![(Some(cat_rest.id.clone()), None, 2_000, None)],
            )
            .unwrap();
        vault
            .insert_transaction_with_splits(
                &acc_cgd.id,
                None,
                "2026-10-11",
                2_000,
                "TRF MB WAY AMIGO 2",
                "AMIGO 2",
                "mbway_dinner_3",
                true,
                vec![(Some(cat_rest.id.clone()), None, 2_000, None)],
            )
            .unwrap();

        // 3. Internal transfer of -50,00 € from CGD to Savings
        vault
            .insert_transaction_with_splits(
                &acc_cgd.id,
                None,
                "2026-10-12",
                -5_000,
                "TRF POUPANCA",
                "TRF POUPANCA",
                "internal_trf_1",
                true,
                vec![(None, Some(acc_sav.id.clone()), -5_000, None)],
            )
            .unwrap();

        let (_rows, total, inflow_cents, outflow_cents) = vault
            .query_ledger(&[acc_cgd.id], None, None, None, 50, 0)
            .unwrap();

        assert_eq!(total, 4);
        // Inflow must be 0,00 € (neither the MB WAY expense reimbursements nor the internal transfer inflate income!)
        assert_eq!(inflow_cents, 0);
        // Outflow must be netted down from -60,00 € to -20,00 € (-2000 cents)!
        assert_eq!(outflow_cents, -2_000);
    }

    #[test]
    fn test_edge_case_4_10_year_ledger_100k_benchmark() {
        let mut vault = VaultEngine::open_in_memory().unwrap();
        let (_insert_ms, balance_query_ms) = vault.seed_benchmark_transactions(100_000).unwrap();

        // Verify that recalculating balances across 100,000 transactions across 8 accounts
        // completes strictly under the 15ms budget!
        assert!(
            balance_query_ms < 15,
            "Expected <15ms balance recalculation across 100k rows, took {}ms",
            balance_query_ms
        );
    }
}
