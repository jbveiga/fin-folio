import { invoke } from "@tauri-apps/api/core";
import {
  Account,
  AccountBalanceSummary,
  BankProfile,
  Category,
  Entity,
  ImportRule,
  LedgerQueryResultDto,
  ParseStatementResultDto,
  SaveTransactionInput,
  StagedTransactionRowDto,
  TransactionWithSplits,
  VaultStatus,
} from "../types";
import { parseCentsInput } from "../utils/money";

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

// =============================================================================
// Deterministic Local Fallback Engine (for Browser Preview / Non-Tauri WebView)
// =============================================================================

interface FallbackDatabase {
  vaultStatus: VaultStatus;
  accounts: Account[];
  categories: Category[];
  entities: Entity[];
  rules: ImportRule[];
  transactions: TransactionWithSplits[];
}

const PREVIEW_VAULT_STORAGE_KEY = "finfolio_preview_vault_v1";

const defaultFallbackDb: FallbackDatabase = {
  vaultStatus: {
    is_open: true,
    path: "/Users/bernardo/Documents/Pessoal_2026.finfolio",
    is_encrypted: true,
    is_memory_locked: true,
    schema_version: 1,
    base_currency: "EUR",
    cycle_start_day: 1,
  },
  accounts: [
    {
      id: "acc_cgd",
      name: "Checking CGD",
      account_type: "Checking",
      anchor_balance_cents: 342_010,
      anchor_date: "2026-10-01",
      is_included_in_totals: true,
    },
    {
      id: "acc_bcp",
      name: "Millennium BCP",
      account_type: "Checking",
      anchor_balance_cents: 183_070,
      anchor_date: "2026-10-01",
      is_included_in_totals: true,
    },
    {
      id: "acc_savings",
      name: "Poupança PPR / Cert. Aforro",
      account_type: "Savings",
      anchor_balance_cents: 850_000,
      anchor_date: "2026-10-01",
      is_included_in_totals: true,
    },
    {
      id: "acc_revolut",
      name: "Revolut",
      account_type: "Checking",
      anchor_balance_cents: 25_000,
      anchor_date: "2026-10-01",
      is_included_in_totals: true,
    },
    {
      id: "acc_meal",
      name: "Cartão Refeição Coverflex",
      account_type: "MealCard",
      anchor_balance_cents: 16_800,
      anchor_date: "2026-10-01",
      is_included_in_totals: true,
    },
  ],
  categories: [
    {
      id: "cat_hab",
      parent_id: null,
      name: "Habitação",
      direction: "Expense",
      color_hex: "#f97316",
    },
    {
      id: "cat_hab_serv",
      parent_id: "cat_hab",
      name: "Serviços",
      direction: "Expense",
      color_hex: "#fb923c",
    },
    {
      id: "cat_agua",
      parent_id: "cat_hab_serv",
      name: "Água",
      direction: "Expense",
      color_hex: "#38bdf8",
    },
    {
      id: "cat_edp",
      parent_id: "cat_hab_serv",
      name: "Eletricidade & Gás",
      direction: "Expense",
      color_hex: "#facc15",
    },
    {
      id: "cat_telecom",
      parent_id: "cat_hab_serv",
      name: "Telecomunicações",
      direction: "Expense",
      color_hex: "#818cf8",
    },
    {
      id: "cat_alim",
      parent_id: null,
      name: "Alimentação",
      direction: "Expense",
      color_hex: "#10b981",
    },
    {
      id: "cat_super",
      parent_id: "cat_alim",
      name: "Supermercado",
      direction: "Expense",
      color_hex: "#34d399",
    },
    {
      id: "cat_rest",
      parent_id: "cat_alim",
      name: "Restauração & Cafés",
      direction: "Expense",
      color_hex: "#f43f5e",
    },
    {
      id: "cat_saude",
      parent_id: null,
      name: "Saúde",
      direction: "Expense",
      color_hex: "#ec4899",
    },
    {
      id: "cat_farm",
      parent_id: "cat_saude",
      name: "Farmácia",
      direction: "Expense",
      color_hex: "#f472b6",
    },
    {
      id: "cat_pess",
      parent_id: null,
      name: "Pessoal & Casa",
      direction: "Expense",
      color_hex: "#a855f7",
    },
    {
      id: "cat_hig",
      parent_id: "cat_pess",
      name: "Higiene & Limpeza",
      direction: "Expense",
      color_hex: "#c084fc",
    },
    {
      id: "cat_rend",
      parent_id: null,
      name: "Rendimentos",
      direction: "Income",
      color_hex: "#10b981",
    },
    {
      id: "cat_sal",
      parent_id: "cat_rend",
      name: "Salário Líquido",
      direction: "Income",
      color_hex: "#34d399",
    },
  ],
  entities: [
    {
      id: "ent_cont",
      normalized_name: "Continente",
      default_category_id: "cat_super",
      tax_id_nif: "500276999",
    },
    {
      id: "ent_pd",
      normalized_name: "Pingo Doce",
      default_category_id: "cat_super",
      tax_id_nif: "500829993",
    },
    {
      id: "ent_epal",
      normalized_name: "EPAL Águas",
      default_category_id: "cat_agua",
      tax_id_nif: "500906840",
    },
    {
      id: "ent_edp",
      normalized_name: "EDP Comercial",
      default_category_id: "cat_edp",
      tax_id_nif: "503504564",
    },
    {
      id: "ent_voda",
      normalized_name: "Vodafone Portugal",
      default_category_id: "cat_telecom",
      tax_id_nif: "502544180",
    },
    {
      id: "ent_farm",
      normalized_name: "Farmácia São João",
      default_category_id: "cat_farm",
      tax_id_nif: "501442100",
    },
    {
      id: "ent_pad",
      normalized_name: "Padaria Portuguesa",
      default_category_id: "cat_rest",
      tax_id_nif: "509445123",
    },
    {
      id: "ent_tech",
      normalized_name: "TechCorp Portugal Lda",
      default_category_id: "cat_sal",
      tax_id_nif: "514000111",
    },
  ],
  rules: [
    {
      id: "rule_1",
      match_mode: "Contains",
      pattern_string: "CONTINENTE",
      account_scope_id: null,
      assigned_entity_id: "ent_cont",
      assigned_category_id: "cat_super",
      priority_weight: 200,
      hit_count: 14,
    },
    {
      id: "rule_2",
      match_mode: "Contains",
      pattern_string: "PINGO DOCE",
      account_scope_id: null,
      assigned_entity_id: "ent_pd",
      assigned_category_id: "cat_super",
      priority_weight: 200,
      hit_count: 9,
    },
    {
      id: "rule_3",
      match_mode: "Contains",
      pattern_string: "EPAL",
      account_scope_id: null,
      assigned_entity_id: "ent_epal",
      assigned_category_id: "cat_agua",
      priority_weight: 250,
      hit_count: 6,
    },
    {
      id: "rule_4",
      match_mode: "Contains",
      pattern_string: "EDP COMERCIAL",
      account_scope_id: null,
      assigned_entity_id: "ent_edp",
      assigned_category_id: "cat_edp",
      priority_weight: 250,
      hit_count: 6,
    },
    {
      id: "rule_5",
      match_mode: "Contains",
      pattern_string: "FARMÁCIA SÃO JOÃO",
      account_scope_id: null,
      assigned_entity_id: "ent_farm",
      assigned_category_id: "cat_farm",
      priority_weight: 220,
      hit_count: 4,
    },
    {
      id: "rule_6",
      match_mode: "Contains",
      pattern_string: "PADARIA PORTUGUESA",
      account_scope_id: null,
      assigned_entity_id: "ent_pad",
      assigned_category_id: "cat_rest",
      priority_weight: 180,
      hit_count: 21,
    },
  ],
  transactions: [
    {
      transaction: {
        id: "tx_1",
        account_id: "acc_cgd",
        entity_id: "ent_tech",
        date_posted: "2026-10-05",
        total_amount_cents: 280_000,
        raw_bank_string: "TRF SEPA+ TECHCORP PORTUGAL LDA",
        clean_description: "TECHCORP PORTUGAL LDA",
        dedup_hash: "seed_tx_1",
        is_reconciled: true,
      },
      splits: [
        {
          id: "sp_1",
          transaction_id: "tx_1",
          category_id: "cat_sal",
          transfer_peer_account_id: null,
          split_amount_cents: 280_000,
          notes: "Salário Outubro 2026",
        },
      ],
      running_balance_cents: null,
    },
    {
      transaction: {
        id: "tx_2",
        account_id: "acc_cgd",
        entity_id: "ent_cont",
        date_posted: "2026-10-08",
        total_amount_cents: -10_000,
        raw_bank_string: "COMPRA ELEC Card *4512 CONTINENTE COLOMBO",
        clean_description: "CONTINENTE COLOMBO",
        dedup_hash: "seed_tx_2",
        is_reconciled: true,
      },
      splits: [
        {
          id: "sp_2a",
          transaction_id: "tx_2",
          category_id: "cat_hig",
          transfer_peer_account_id: null,
          split_amount_cents: -3_000,
          notes: "Champô e detergentes",
        },
        {
          id: "sp_2b",
          transaction_id: "tx_2",
          category_id: "cat_super",
          transfer_peer_account_id: null,
          split_amount_cents: -7_000,
          notes: "Compras semanais",
        },
      ],
      running_balance_cents: null,
    },
    {
      transaction: {
        id: "tx_3",
        account_id: "acc_bcp",
        entity_id: "ent_pad",
        date_posted: "2026-10-12",
        total_amount_cents: -6_000,
        raw_bank_string: "COMPRA ELEC RESTAURANTE LISBOA",
        clean_description: "RESTAURANTE LISBOA",
        dedup_hash: "seed_tx_3",
        is_reconciled: true,
      },
      splits: [
        {
          id: "sp_3",
          transaction_id: "tx_3",
          category_id: "cat_rest",
          transfer_peer_account_id: null,
          split_amount_cents: -6_000,
          notes: "Jantar de grupo (3 pessoas)",
        },
      ],
      running_balance_cents: null,
    },
    {
      transaction: {
        id: "tx_4",
        account_id: "acc_bcp",
        entity_id: null,
        date_posted: "2026-10-13",
        total_amount_cents: 4_000,
        raw_bank_string: "TRF MB WAY DE [PHONE] AMIGOS JANTAR",
        clean_description: "AMIGOS JANTAR (Reembolso MB WAY)",
        dedup_hash: "seed_tx_4",
        is_reconciled: true,
      },
      splits: [
        {
          id: "sp_4",
          transaction_id: "tx_4",
          category_id: "cat_rest",
          transfer_peer_account_id: null,
          split_amount_cents: 4_000,
          notes: "Reembolso MB WAY jantar (abate despesa Restauração)",
        },
      ],
      running_balance_cents: null,
    },
    {
      transaction: {
        id: "tx_5",
        account_id: "acc_cgd",
        entity_id: null,
        date_posted: "2026-10-15",
        total_amount_cents: -15_000,
        raw_bank_string: "TRF SEPA P/ REVOLUT TOPUP",
        clean_description: "Transferência para Revolut",
        dedup_hash: "seed_tx_5",
        is_reconciled: true,
      },
      splits: [
        {
          id: "sp_5",
          transaction_id: "tx_5",
          category_id: null,
          transfer_peer_account_id: "acc_revolut",
          split_amount_cents: -15_000,
          notes: "Reforço Revolut (Transferência interna)",
        },
      ],
      running_balance_cents: null,
    },
    {
      transaction: {
        id: "tx_6",
        account_id: "acc_cgd",
        entity_id: "ent_edp",
        date_posted: "2026-10-18",
        total_amount_cents: -6_450,
        raw_bank_string: "DD EDP COMERCIAL FATURA OUT",
        clean_description: "EDP COMERCIAL",
        dedup_hash: "seed_tx_6",
        is_reconciled: false,
      },
      splits: [
        {
          id: "sp_6",
          transaction_id: "tx_6",
          category_id: "cat_edp",
          transfer_peer_account_id: null,
          split_amount_cents: -6_450,
          notes: "Fatura mensal eletricidade",
        },
      ],
      running_balance_cents: null,
    },
    {
      transaction: {
        id: "tx_7",
        account_id: "acc_cgd",
        entity_id: "ent_epal",
        date_posted: "2026-10-19",
        total_amount_cents: -2_480,
        raw_bank_string: "DD EPAL AGUAS LISBOA",
        clean_description: "EPAL ÁGUAS",
        dedup_hash: "seed_tx_7",
        is_reconciled: false,
      },
      splits: [
        {
          id: "sp_7",
          transaction_id: "tx_7",
          category_id: "cat_agua",
          transfer_peer_account_id: null,
          split_amount_cents: -2_480,
          notes: "Consumo água",
        },
      ],
      running_balance_cents: null,
    },
  ],
};

function cloneDefaultFallbackDb(): FallbackDatabase {
  return JSON.parse(JSON.stringify(defaultFallbackDb)) as FallbackDatabase;
}

function loadOrInitializeFallbackDb(): FallbackDatabase {
  if (typeof window === "undefined" || isTauriRuntime()) {
    return cloneDefaultFallbackDb();
  }
  try {
    const raw = window.localStorage.getItem(PREVIEW_VAULT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FallbackDatabase;
      if (
        parsed &&
        Array.isArray(parsed.accounts) &&
        Array.isArray(parsed.categories) &&
        Array.isArray(parsed.entities) &&
        Array.isArray(parsed.transactions)
      ) {
        return parsed;
      }
    }
    const fresh = cloneDefaultFallbackDb();
    window.localStorage.setItem(
      PREVIEW_VAULT_STORAGE_KEY,
      JSON.stringify(fresh)
    );
    return fresh;
  } catch {
    // Fallback to in-memory seed if localStorage is restricted
  }
  return cloneDefaultFallbackDb();
}

function persistFallbackDb(): void {
  if (typeof window === "undefined" || isTauriRuntime()) return;
  try {
    window.localStorage.setItem(
      PREVIEW_VAULT_STORAGE_KEY,
      JSON.stringify(fallbackDb)
    );
  } catch {
    // Ignore storage quota errors during 100k benchmark
  }
}

const fallbackDb: FallbackDatabase = loadOrInitializeFallbackDb();

function computeFallbackAccountSummaries(): AccountBalanceSummary[] {
  return fallbackDb.accounts.map((acc) => {
    let postDelta = 0;
    let preDelta = 0;
    for (const item of fallbackDb.transactions) {
      if (item.transaction.account_id !== acc.id) continue;
      if (item.transaction.date_posted > acc.anchor_date) {
        postDelta += item.transaction.total_amount_cents;
      } else {
        preDelta += item.transaction.total_amount_cents;
      }
    }
    return {
      account: acc,
      current_balance_cents: acc.anchor_balance_cents + postDelta,
      anchor_balance_cents: acc.anchor_balance_cents,
      post_anchor_delta_cents: postDelta,
      pre_anchor_delta_cents: preDelta,
    };
  });
}

function scrubPiiFallback(raw: string): { scrubbedRaw: string; clean: string } {
  const afterIban = raw.replace(
    /\b([A-Z]{2}\d{2})(?:[A-Z0-9]{17,30}|(?:\s+[A-Z0-9]{4}){3,7}(?:\s+\d{1,4})?)\b/gi,
    (m) => {
      const alnum = m.replace(/[^A-Za-z0-9]/g, "");
      return `${alnum.slice(0, 4).toUpperCase()}...${alnum.slice(-4)}`;
    }
  );
  const afterPan = afterIban.replace(
    /\b(?:\d{4}[\s-]?[\d*X]{4}[\s-]?[\d*X]{4}[\s-]?|\*{4,12}[\s-]?)(\d{4})\b/g,
    "Card *$1"
  );
  const phoneRe = /(?:(?:\+351|00351)[\s-]?)?\b(9[1236]\d[\s-]?\d{3}[\s-]?\d{3})\b/g;
  const scrubbedRaw = afterPan.replace(phoneRe, "[PHONE]").replace(/\s+/g, " ").trim();
  let clean = afterPan.replace(phoneRe, " ").replace(/\s+/g, " ").trim();
  const prefixes = [
    "COMPRA ELEC ",
    "COMPRA CARTAO ",
    "COMPRA ",
    "PAGAMENTO SERVICOS ",
    "TRF MB WAY P/ ",
    "TRF MB WAY DE ",
    "TRANSFERENCIA P/ ",
    "DD ",
  ];
  for (const p of prefixes) {
    if (clean.toUpperCase().startsWith(p)) {
      clean = clean.slice(p.length).trim();
      break;
    }
  }
  return { scrubbedRaw, clean: clean || scrubbedRaw };
}

// =============================================================================
// Exported IPC Client API
// =============================================================================

export const ipc = {
  async getVaultStatus(): Promise<VaultStatus> {
    if (isTauriRuntime()) {
      return invoke("vault_get_status");
    }
    return fallbackDb.vaultStatus;
  },

  async rekeyVault(newPassphrase: string | null): Promise<VaultStatus> {
    if (isTauriRuntime()) {
      return invoke("vault_rekey", { newPassphrase });
    }
    fallbackDb.vaultStatus = {
      ...fallbackDb.vaultStatus,
      is_encrypted: Boolean(newPassphrase && newPassphrase.trim().length > 0),
      is_memory_locked: Boolean(newPassphrase && newPassphrase.trim().length > 0),
    };
    persistFallbackDb();
    return fallbackDb.vaultStatus;
  },

  async backupVault(destinationPath: string): Promise<string> {
    if (isTauriRuntime()) {
      return invoke("vault_backup", { destinationPath });
    }
    return destinationPath;
  },

  async listAccounts(): Promise<AccountBalanceSummary[]> {
    if (isTauriRuntime()) {
      return invoke("account_list");
    }
    return computeFallbackAccountSummaries();
  },

  async saveAccount(account: Account): Promise<AccountBalanceSummary> {
    if (isTauriRuntime()) {
      return invoke("account_save", { account });
    }
    if (!account.id) {
      const created: Account = { ...account, id: `acc_${Date.now()}` };
      fallbackDb.accounts.push(created);
    } else {
      fallbackDb.accounts = fallbackDb.accounts.map((a) =>
        a.id === account.id ? account : a
      );
    }
    persistFallbackDb();
    const all = computeFallbackAccountSummaries();
    return all[all.length - 1];
  },

  async deleteAccount(id: string): Promise<void> {
    if (isTauriRuntime()) {
      return invoke("account_delete", { id });
    }
    fallbackDb.accounts = fallbackDb.accounts.filter((a) => a.id !== id);
    fallbackDb.transactions = fallbackDb.transactions.filter(
      (t) => t.transaction.account_id !== id
    );
    persistFallbackDb();
  },

  async listCategories(): Promise<Category[]> {
    if (isTauriRuntime()) {
      return invoke("category_list");
    }
    return [...fallbackDb.categories];
  },

  async saveCategory(category: Category): Promise<Category> {
    if (isTauriRuntime()) {
      return invoke("category_save", { category });
    }
    const saved: Category = {
      ...category,
      id: category.id || `cat_${Date.now()}`,
    };
    const idx = fallbackDb.categories.findIndex((c) => c.id === saved.id);
    if (idx >= 0) {
      fallbackDb.categories[idx] = saved;
    } else {
      fallbackDb.categories.push(saved);
    }
    persistFallbackDb();
    return saved;
  },

  async deleteCategory(id: string): Promise<void> {
    if (isTauriRuntime()) {
      return invoke("category_delete", { id, reassignToId: null });
    }
    fallbackDb.categories = fallbackDb.categories.filter(
      (c) => c.id !== id && c.parent_id !== id
    );
    persistFallbackDb();
  },

  async listEntities(): Promise<Entity[]> {
    if (isTauriRuntime()) {
      return invoke("entity_list");
    }
    return [...fallbackDb.entities];
  },

  async saveEntity(entity: Entity): Promise<Entity> {
    if (isTauriRuntime()) {
      return invoke("entity_save", { entity });
    }
    const saved: Entity = {
      ...entity,
      id: entity.id || `ent_${Date.now()}`,
    };
    const idx = fallbackDb.entities.findIndex((e) => e.id === saved.id);
    if (idx >= 0) {
      fallbackDb.entities[idx] = saved;
    } else {
      fallbackDb.entities.push(saved);
    }
    persistFallbackDb();
    return saved;
  },

  async deleteEntity(id: string): Promise<void> {
    if (isTauriRuntime()) {
      return invoke("entity_delete", { id });
    }
    fallbackDb.entities = fallbackDb.entities.filter((e) => e.id !== id);
    fallbackDb.transactions = fallbackDb.transactions.map((t) =>
      t.transaction.entity_id === id
        ? { ...t, transaction: { ...t.transaction, entity_id: null } }
        : t
    );
    persistFallbackDb();
  },

  async listRules(): Promise<ImportRule[]> {
    if (isTauriRuntime()) {
      return invoke("rule_list");
    }
    return [...fallbackDb.rules].sort(
      (a, b) => b.priority_weight - a.priority_weight
    );
  },

  async saveRule(rule: ImportRule): Promise<ImportRule> {
    if (isTauriRuntime()) {
      return invoke("rule_save", { rule });
    }
    const saved: ImportRule = {
      ...rule,
      id: rule.id || `rule_${Date.now()}`,
    };
    const idx = fallbackDb.rules.findIndex((r) => r.id === saved.id);
    if (idx >= 0) {
      fallbackDb.rules[idx] = saved;
    } else {
      fallbackDb.rules.push(saved);
    }
    persistFallbackDb();
    return saved;
  },

  async deleteRule(id: string): Promise<void> {
    if (isTauriRuntime()) {
      return invoke("rule_delete", { id });
    }
    fallbackDb.rules = fallbackDb.rules.filter((r) => r.id !== id);
    persistFallbackDb();
  },

  async queryLedger(params: {
    accountIds: string[];
    startDate?: string;
    endDate?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<LedgerQueryResultDto> {
    if (isTauriRuntime()) {
      return invoke("ledger_query", {
        accountIds: params.accountIds,
        startDate: params.startDate || null,
        endDate: params.endDate || null,
        search: params.search || null,
        limit: params.limit ?? 1000,
        offset: params.offset ?? 0,
      });
    }

    const accSet = new Set(params.accountIds);
    const catMap = new Map(fallbackDb.categories.map((c) => [c.id, c]));
    const entMap = new Map(fallbackDb.entities.map((e) => [e.id, e]));
    const q = (params.search || "").trim().toUpperCase();

    const filtered = fallbackDb.transactions
      .filter((item) => {
        const t = item.transaction;
        if (!accSet.has(t.account_id)) return false;
        if (params.startDate && t.date_posted < params.startDate) return false;
        if (params.endDate && t.date_posted > params.endDate) return false;
        if (q) {
          const descMatch =
            t.clean_description.toUpperCase().includes(q) ||
            t.raw_bank_string.toUpperCase().includes(q);
          const entName = t.entity_id
            ? entMap.get(t.entity_id)?.normalized_name.toUpperCase() || ""
            : "";
          const entMatch = entName.includes(q);
          const catMatch = item.splits.some((sp) => {
            if (!sp.category_id) return false;
            const c = catMap.get(sp.category_id);
            return c ? c.name.toUpperCase().includes(q) : false;
          });
          if (!descMatch && !entMatch && !catMatch) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) =>
        b.transaction.date_posted.localeCompare(a.transaction.date_posted)
      );

    let inflow = 0;
    let outflow = 0;
    for (const item of filtered) {
      for (const sp of item.splits) {
        if (sp.transfer_peer_account_id) continue;
        const cat = sp.category_id ? catMap.get(sp.category_id) : undefined;
        if (cat?.direction === "Expense") {
          outflow += sp.split_amount_cents;
        } else if (cat?.direction === "Income") {
          inflow += sp.split_amount_cents;
        } else if (sp.split_amount_cents > 0) {
          inflow += sp.split_amount_cents;
        } else {
          outflow += sp.split_amount_cents;
        }
      }
    }

    return {
      transactions: filtered.slice(
        params.offset ?? 0,
        (params.offset ?? 0) + (params.limit ?? 1000)
      ),
      total_count: filtered.length,
      period_inflow_cents: inflow,
      period_outflow_cents: outflow,
      net_cash_flow_cents: inflow + outflow,
    };
  },

  async saveTransaction(
    transaction: SaveTransactionInput
  ): Promise<TransactionWithSplits> {
    if (isTauriRuntime()) {
      return invoke("ledger_save_transaction", { transaction });
    }
    const txId = transaction.id || `tx_${Date.now()}`;
    let entityId = transaction.entity_id;
    if (!entityId && transaction.entity_name?.trim()) {
      const name = transaction.entity_name.trim();
      const existing = fallbackDb.entities.find(
        (e) => e.normalized_name.toLowerCase() === name.toLowerCase()
      );
      if (existing) {
        entityId = existing.id;
      } else {
        const created: Entity = {
          id: `ent_${Date.now()}`,
          normalized_name: name,
          default_category_id: transaction.splits[0]?.category_id || null,
          tax_id_nif: null,
        };
        fallbackDb.entities.push(created);
        entityId = created.id;
      }
    }

    const saved: TransactionWithSplits = {
      transaction: {
        id: txId,
        account_id: transaction.account_id,
        entity_id: entityId,
        date_posted: transaction.date_posted,
        total_amount_cents: transaction.total_amount_cents,
        raw_bank_string: transaction.raw_bank_string || transaction.clean_description,
        clean_description: transaction.clean_description,
        dedup_hash: `manual_${txId}`,
        is_reconciled: transaction.is_reconciled,
      },
      splits: transaction.splits.map((s, idx) => ({
        id: `sp_${txId}_${idx}`,
        transaction_id: txId,
        category_id: s.category_id,
        transfer_peer_account_id: s.transfer_peer_account_id,
        split_amount_cents: s.split_amount_cents,
        notes: s.notes,
      })),
      running_balance_cents: null,
    };

    const existingIdx = fallbackDb.transactions.findIndex(
      (t) => t.transaction.id === txId
    );
    if (existingIdx >= 0) {
      fallbackDb.transactions[existingIdx] = saved;
    } else {
      fallbackDb.transactions.unshift(saved);
    }
    persistFallbackDb();
    return saved;
  },

  async deleteTransaction(id: string): Promise<void> {
    if (isTauriRuntime()) {
      return invoke("ledger_delete_transaction", { id });
    }
    fallbackDb.transactions = fallbackDb.transactions.filter(
      (t) => t.transaction.id !== id
    );
    persistFallbackDb();
  },

  async toggleReconciled(id: string): Promise<boolean> {
    if (isTauriRuntime()) {
      return invoke("ledger_toggle_reconciled", { id });
    }
    const target = fallbackDb.transactions.find((t) => t.transaction.id === id);
    if (target) {
      target.transaction.is_reconciled = !target.transaction.is_reconciled;
      persistFallbackDb();
      return target.transaction.is_reconciled;
    }
    return false;
  },

  async parseStatement(params: {
    fileName: string;
    rawBytes: number[];
    mimeType?: string;
    accountId: string;
    explicitProfile?: BankProfile | null;
  }): Promise<ParseStatementResultDto> {
    if (isTauriRuntime()) {
      return invoke("statement_parse", {
        fileName: params.fileName,
        rawBytes: params.rawBytes,
        mimeType: params.mimeType || null,
        accountId: params.accountId,
        explicitProfile: params.explicitProfile || null,
      });
    }

    // Fallback browser parser for CSV/TSV
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const text = decoder.decode(new Uint8Array(params.rawBytes));
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const delim = lines[0]?.includes(";")
      ? ";"
      : lines[0]?.includes("\t")
      ? "\t"
      : ",";
    const rows = lines.map((l) => l.split(delim).map((c) => c.trim()));
    const headerRow = rows[0] || [];
    const dataRows = rows.slice(1);

    const seqMap = new Map<string, number>();
    const existingHashes = new Set(
      fallbackDb.transactions
        .filter((t) => t.transaction.account_id === params.accountId)
        .map((t) => t.transaction.dedup_hash)
    );

    const stagedRows: StagedTransactionRowDto[] = dataRows
      .filter((r) => r.length >= 3)
      .map((r, i) => {
        const rawDate = r[0];
        const parts = rawDate.split(/[-/.]/);
        const isoDate =
          parts.length === 3 && parts[0].length === 2
            ? `${parts[2]}-${parts[1]}-${parts[0]}`
            : rawDate;
        const rawDesc = r[2] || r[1] || "";
        const rawAmt = r[3] || r[2] || "0";
        const amountCents = parseCentsInput(rawAmt);
        const { scrubbedRaw, clean } = scrubPiiFallback(rawDesc);

        const seqKey = `${isoDate}|${amountCents}|${scrubbedRaw.toUpperCase()}`;
        const seqIdx = (seqMap.get(seqKey) || 0) + 1;
        seqMap.set(seqKey, seqIdx);

        const dedupHash = `blake3_${params.accountId}_${isoDate}_${amountCents}_${scrubbedRaw}_${seqIdx}`;
        const isDup = existingHashes.has(dedupHash);

        // Longest-match rule evaluation
        let matchedRule: ImportRule | undefined;
        for (const rule of fallbackDb.rules) {
          if (
            clean.toUpperCase().includes(rule.pattern_string.toUpperCase()) ||
            scrubbedRaw.toUpperCase().includes(rule.pattern_string.toUpperCase())
          ) {
            if (
              !matchedRule ||
              rule.pattern_string.length > matchedRule.pattern_string.length
            ) {
              matchedRule = rule;
            }
          }
        }

        const ent = matchedRule?.assigned_entity_id
          ? fallbackDb.entities.find((e) => e.id === matchedRule?.assigned_entity_id)
          : undefined;
        const catId =
          matchedRule?.assigned_category_id || ent?.default_category_id || null;
        const cat = catId
          ? fallbackDb.categories.find((c) => c.id === catId)
          : undefined;

        return {
          temp_id: `stg_${Date.now()}_${i}`,
          date_posted: isoDate,
          amount_cents: amountCents,
          raw_description: scrubbedRaw,
          clean_description: clean,
          entity_id: ent?.id || null,
          entity_name: ent?.normalized_name || null,
          category_id: cat?.id || null,
          category_name: cat?.name || null,
          dedup_hash: dedupHash,
          status: isDup
            ? "AlreadyImported"
            : matchedRule
            ? "RuleMatched"
            : "New",
          suggestion_confidence: matchedRule ? 1.0 : null,
          matched_rule_id: matchedRule?.id || null,
          is_selected_for_import: !isDup,
          auto_learn_rule: false,
        };
      });

    return {
      header_matched: true,
      profile_name: "Auto-Detected Portuguese Statement",
      header_signature_hash: "sig_auto",
      needs_column_mapping: false,
      raw_sample_rows: dataRows.slice(0, 5),
      all_raw_rows: dataRows,
      detected_columns: headerRow,
      staged_rows: stagedRows,
    };
  },

  async commitStatement(params: {
    accountId: string;
    rows: StagedTransactionRowDto[];
  }): Promise<{ imported_count: number; rules_created: number }> {
    if (isTauriRuntime()) {
      return invoke("statement_commit", {
        accountId: params.accountId,
        rows: params.rows,
      });
    }

    let importedCount = 0;
    let rulesCreated = 0;
    for (const row of params.rows) {
      if (!row.is_selected_for_import) continue;
      await this.saveTransaction({
        id: null,
        account_id: params.accountId,
        entity_id: row.entity_id,
        entity_name: row.entity_name,
        date_posted: row.date_posted,
        total_amount_cents: row.amount_cents,
        raw_bank_string: row.raw_description,
        clean_description: row.clean_description,
        is_reconciled: false,
        splits: [
          {
            category_id: row.category_id,
            transfer_peer_account_id: null,
            split_amount_cents: row.amount_cents,
            notes: null,
          },
        ],
      });
      // Preserve exact dedup_hash
      fallbackDb.transactions[0].transaction.dedup_hash = row.dedup_hash;
      importedCount++;

      if (row.auto_learn_rule && (row.entity_id || row.category_id)) {
        await this.saveRule({
          id: "",
          match_mode: "Contains",
          pattern_string: row.clean_description.toUpperCase(),
          account_scope_id: null,
          assigned_entity_id: row.entity_id,
          assigned_category_id: row.category_id,
          priority_weight: 160,
          hit_count: 1,
        });
        rulesCreated++;
      }
    }
    persistFallbackDb();
    return { imported_count: importedCount, rules_created: rulesCreated };
  },

  async saveBankProfile(profile: BankProfile): Promise<void> {
    if (isTauriRuntime()) {
      return invoke("bank_profile_save", { profile });
    }
  },

  async seedBenchmark(count: number): Promise<string> {
    if (isTauriRuntime()) {
      return invoke("ledger_seed_benchmark", { count });
    }
    const t0 = performance.now();
    const merchants = [
      "CONTINENTE MODELO",
      "PINGO DOCE",
      "EDP COMERCIAL",
      "FARMÁCIA SÃO JOÃO",
      "PADARIA PORTUGUESA",
      "GALP ENERGIA",
    ];
    for (let i = 0; i < count; i++) {
      const acc = fallbackDb.accounts[i % fallbackDb.accounts.length];
      const amt = i % 12 === 0 ? 185_000 : -(((i % 80) + 1) * 125);
      const m = merchants[i % merchants.length];
      const day = String(1 + (i % 28)).padStart(2, "0");
      const month = String(1 + (i % 12)).padStart(2, "0");
      const year = 2017 + (i % 10);
      const id = `bench_${i}`;
      fallbackDb.transactions.push({
        transaction: {
          id,
          account_id: acc.id,
          entity_id: "ent_cont",
          date_posted: `${year}-${month}-${day}`,
          total_amount_cents: amt,
          raw_bank_string: m,
          clean_description: m,
          dedup_hash: `dedup_${id}`,
          is_reconciled: true,
        },
        splits: [
          {
            id: `sp_${id}`,
            transaction_id: id,
            category_id: amt > 0 ? "cat_sal" : "cat_super",
            transfer_peer_account_id: null,
            split_amount_cents: amt,
            notes: null,
          },
        ],
        running_balance_cents: null,
      });
    }
    const insertMs = (performance.now() - t0).toFixed(1);
    const t1 = performance.now();
    computeFallbackAccountSummaries();
    const queryMs = (performance.now() - t1).toFixed(2);
    return `Seeded ${count.toLocaleString()} transactions in ${insertMs}ms. Account Switcher balance recalculation: ${queryMs}ms (<15ms budget).`;
  },

  async exportData(
    format: "csv" | "json",
    accountIds: string[]
  ): Promise<string> {
    if (isTauriRuntime()) {
      return invoke("export_data", { format, accountIds });
    }
    const res = await this.queryLedger({ accountIds, limit: 250_000 });
    if (format === "json") {
      return JSON.stringify(res.transactions, null, 2);
    }

    const accMap = new Map(fallbackDb.accounts.map((a) => [a.id, a.name]));
    const entMap = new Map(
      fallbackDb.entities.map((e) => [e.id, e.normalized_name])
    );
    const catMap = new Map(fallbackDb.categories.map((c) => [c.id, c.name]));

    const formatCentsDecimal = (cents: number): string => {
      const v = BigInt(Math.trunc(cents || 0));
      const neg = v < 0n;
      const abs = neg ? -v : v;
      const major = abs / 100n;
      const minor = (abs % 100n).toString().padStart(2, "0");
      return `${neg ? "-" : ""}${major.toString()}.${minor}`;
    };

    const escapeCsv = (val: string): string =>
      `"${(val || "").replace(/"/g, '""')}"`;

    const header =
      "\uFEFFDate,Account,Entity,Category,Description,Notes,Amount_EUR,Amount_Cents,Reconciled\n";
    const lines = res.transactions.map((t) => {
      const tx = t.transaction;
      const sp = t.splits[0];
      const accName = accMap.get(tx.account_id) || tx.account_id;
      const entName = tx.entity_id ? entMap.get(tx.entity_id) || "" : "";
      const catName =
        t.splits.length > 1
          ? `Split (${t.splits.length})`
          : sp?.transfer_peer_account_id
          ? `Transfer -> ${
              accMap.get(sp.transfer_peer_account_id) ||
              sp.transfer_peer_account_id
            }`
          : sp?.category_id
          ? catMap.get(sp.category_id) || ""
          : "Uncategorized";
      const notes = sp?.notes || "";
      return [
        tx.date_posted,
        escapeCsv(accName),
        escapeCsv(entName),
        escapeCsv(catName),
        escapeCsv(tx.clean_description),
        escapeCsv(notes),
        formatCentsDecimal(tx.total_amount_cents),
        String(tx.total_amount_cents),
        tx.is_reconciled ? "true" : "false",
      ].join(",");
    });
    return header + lines.join("\n");
  },

  async exportVaultSnapshot(): Promise<string> {
    if (isTauriRuntime()) {
      const [vaultStatus, accountSummaries, categories, entities, rules, ledger] =
        await Promise.all([
          this.getVaultStatus(),
          this.listAccounts(),
          this.listCategories(),
          this.listEntities(),
          this.listRules(),
          this.queryLedger({
            accountIds: (await this.listAccounts()).map((s) => s.account.id),
            limit: 250_000,
          }),
        ]);
      return JSON.stringify(
        {
          schema_version: 2,
          exported_at: new Date().toISOString(),
          vaultStatus,
          accounts: accountSummaries.map((s) => s.account),
          categories,
          entities,
          rules,
          transactions: ledger.transactions,
        },
        null,
        2
      );
    }

    return JSON.stringify(
      {
        schema_version: 2,
        exported_at: new Date().toISOString(),
        vaultStatus: fallbackDb.vaultStatus,
        accounts: fallbackDb.accounts,
        categories: fallbackDb.categories,
        entities: fallbackDb.entities,
        rules: fallbackDb.rules,
        transactions: fallbackDb.transactions,
      },
      null,
      2
    );
  },

  async importVaultSnapshot(jsonString: string): Promise<void> {
    const parsed = JSON.parse(jsonString) as Partial<FallbackDatabase>;
    if (
      !parsed ||
      !Array.isArray(parsed.accounts) ||
      !Array.isArray(parsed.categories) ||
      !Array.isArray(parsed.entities) ||
      !Array.isArray(parsed.transactions)
    ) {
      throw new Error(
        "Invalid FinFolio vault backup file: missing accounts, categories, entities, or transactions arrays."
      );
    }

    fallbackDb.vaultStatus = parsed.vaultStatus || fallbackDb.vaultStatus;
    fallbackDb.accounts = parsed.accounts;
    fallbackDb.categories = parsed.categories;
    fallbackDb.entities = parsed.entities;
    fallbackDb.rules = Array.isArray(parsed.rules) ? parsed.rules : [];
    fallbackDb.transactions = parsed.transactions;
    persistFallbackDb();
  },

  async resetPreviewVault(): Promise<void> {
    if (!isTauriRuntime()) {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(PREVIEW_VAULT_STORAGE_KEY);
      }
      const fresh = cloneDefaultFallbackDb();
      fallbackDb.vaultStatus = fresh.vaultStatus;
      fallbackDb.accounts = fresh.accounts;
      fallbackDb.categories = fresh.categories;
      fallbackDb.entities = fresh.entities;
      fallbackDb.rules = fresh.rules;
      fallbackDb.transactions = fresh.transactions;
      persistFallbackDb();
    }
  },
};
