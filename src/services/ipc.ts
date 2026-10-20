import { invoke } from "@tauri-apps/api/core";
import {
  Account,
  AccountBalanceSummary,
  BankProfile,
  BankProfilePreset,
  Category,
  Entity,
  ImportRule,
  LedgerQueryResultDto,
  ParseStatementResultDto,
  RecurringSchedule,
  SaveTransactionInput,
  StagedTransactionRowDto,
  TransactionWithSplits,
  VaultStatus,
} from "../types";
import { parseCentsInput } from "../utils/money";

export const BUILTIN_BANK_PRESETS: BankProfilePreset[] = [
  {
    id: "cgd_split",
    name: "CGD (Débito / Crédito)",
    delimiter: ";",
    decimalSeparator: ",",
    strategy: "DebitCreditSplit",
    dateColIdx: 0,
    descColIdx: 2,
    debitColIdx: 3,
    creditColIdx: 4,
    balanceColIdx: 5,
  },
  {
    id: "cgd_single",
    name: "CGD (Montante Único)",
    delimiter: ";",
    decimalSeparator: ",",
    strategy: "SingleSigned",
    dateColIdx: 0,
    descColIdx: 2,
    amountColIdx: 3,
    balanceColIdx: 4,
  },
  {
    id: "millennium_bcp",
    name: "Millennium bcp",
    delimiter: ";",
    decimalSeparator: ",",
    strategy: "SingleSigned",
    dateColIdx: 0,
    descColIdx: 2,
    amountColIdx: 3,
    balanceColIdx: 5,
  },
  {
    id: "santander_totta",
    name: "Santander Totta",
    delimiter: ";",
    decimalSeparator: ",",
    strategy: "SingleSigned",
    dateColIdx: 0,
    descColIdx: 2,
    amountColIdx: 3,
    balanceColIdx: 4,
  },
  {
    id: "activobank",
    name: "ActivoBank",
    delimiter: ";",
    decimalSeparator: ",",
    strategy: "SingleSigned",
    dateColIdx: 0,
    descColIdx: 2,
    amountColIdx: 3,
    balanceColIdx: 4,
  },
  {
    id: "revolut",
    name: "Revolut",
    delimiter: ",",
    decimalSeparator: ".",
    strategy: "SingleSigned",
    dateColIdx: 2,
    descColIdx: 4,
    amountColIdx: 5,
    balanceColIdx: 9,
  },
  {
    id: "n26",
    name: "N26",
    delimiter: ",",
    decimalSeparator: ".",
    strategy: "SingleSigned",
    dateColIdx: 0,
    descColIdx: 1,
    amountColIdx: 5,
  },
];

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
  recurringSchedules: RecurringSchedule[];
  bankProfiles: BankProfile[];
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
      monthly_budget_cents: 4_000,
    },
    {
      id: "cat_edp",
      parent_id: "cat_hab_serv",
      name: "Eletricidade & Gás",
      direction: "Expense",
      color_hex: "#facc15",
      monthly_budget_cents: 7_500,
    },
    {
      id: "cat_telecom",
      parent_id: "cat_hab_serv",
      name: "Telecomunicações",
      direction: "Expense",
      color_hex: "#818cf8",
      monthly_budget_cents: 5_000,
    },
    {
      id: "cat_alim",
      parent_id: null,
      name: "Alimentação",
      direction: "Expense",
      color_hex: "#10b981",
      monthly_budget_cents: null,
    },
    {
      id: "cat_super",
      parent_id: "cat_alim",
      name: "Supermercado",
      direction: "Expense",
      color_hex: "#34d399",
      monthly_budget_cents: 40_000,
    },
    {
      id: "cat_rest",
      parent_id: "cat_alim",
      name: "Restauração & Cafés",
      direction: "Expense",
      color_hex: "#f43f5e",
      monthly_budget_cents: 15_000,
    },
    {
      id: "cat_saude",
      parent_id: null,
      name: "Saúde",
      direction: "Expense",
      color_hex: "#ec4899",
      monthly_budget_cents: null,
    },
    {
      id: "cat_farm",
      parent_id: "cat_saude",
      name: "Farmácia",
      direction: "Expense",
      color_hex: "#f472b6",
      monthly_budget_cents: 6_000,
    },
    {
      id: "cat_pess",
      parent_id: null,
      name: "Pessoal & Casa",
      direction: "Expense",
      color_hex: "#a855f7",
      monthly_budget_cents: null,
    },
    {
      id: "cat_hig",
      parent_id: "cat_pess",
      name: "Higiene & Limpeza",
      direction: "Expense",
      color_hex: "#c084fc",
      monthly_budget_cents: 4_500,
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
  recurringSchedules: [
    {
      id: "rec_edp",
      name: "EDP Comercial (Eletricidade)",
      expected_amount_cents: -6_450,
      recurrence_interval: "Monthly",
      day_of_month: 18,
      account_id: "acc_cgd",
      category_id: "cat_edp",
      entity_id: "ent_edp",
      is_active: true,
      notes: "Fatura mensal eletricidade & gás",
    },
    {
      id: "rec_epal",
      name: "EPAL Águas Lisboa",
      expected_amount_cents: -2_480,
      recurrence_interval: "Monthly",
      day_of_month: 19,
      account_id: "acc_cgd",
      category_id: "cat_agua",
      entity_id: "ent_epal",
      is_active: true,
      notes: "Consumo mensal água",
    },
    {
      id: "rec_voda",
      name: "Vodafone Fibra & Móvel",
      expected_amount_cents: -4_290,
      recurrence_interval: "Monthly",
      day_of_month: 22,
      account_id: "acc_cgd",
      category_id: "cat_telecom",
      entity_id: "ent_voda",
      is_active: true,
      notes: "Pacote Fibra 1Gbps + 2 cartões móveis",
    },
    {
      id: "rec_gym",
      name: "Ginásio Fitness",
      expected_amount_cents: -3_500,
      recurrence_interval: "Monthly",
      day_of_month: 25,
      account_id: "acc_bcp",
      category_id: "cat_saude",
      entity_id: null,
      is_active: true,
      notes: "Mensalidade livre-trânsito",
    },
    {
      id: "rec_stream",
      name: "Netflix & Spotify",
      expected_amount_cents: -2_398,
      recurrence_interval: "Monthly",
      day_of_month: 28,
      account_id: "acc_revolut",
      category_id: "cat_pess",
      entity_id: null,
      is_active: true,
      notes: "Subscrições mensais streaming",
    },
  ],
  bankProfiles: [],
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
        is_recurring: true,
        recurrence_interval: "Monthly",
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
        is_recurring: true,
        recurrence_interval: "Monthly",
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
        is_recurring: true,
        recurrence_interval: "Monthly",
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
        const defaultBudgetMap = new Map(
          defaultFallbackDb.categories.map((c) => [
            c.id,
            c.monthly_budget_cents ?? null,
          ])
        );
        parsed.categories = parsed.categories.map((c) => ({
          ...c,
          monthly_budget_cents:
            c.monthly_budget_cents !== undefined
              ? c.monthly_budget_cents
              : defaultBudgetMap.get(c.id) ?? null,
        }));
        if (!Array.isArray(parsed.recurringSchedules)) {
          parsed.recurringSchedules = cloneDefaultFallbackDb().recurringSchedules;
        }
        if (!Array.isArray(parsed.bankProfiles)) {
          parsed.bankProfiles = [];
        }
        const recurringSeedIds = new Set(["tx_1", "tx_6", "tx_7"]);
        parsed.transactions = parsed.transactions.map((item) => ({
          ...item,
          transaction: {
            ...item.transaction,
            is_recurring:
              item.transaction.is_recurring !== undefined
                ? item.transaction.is_recurring
                : recurringSeedIds.has(item.transaction.id),
            recurrence_interval:
              item.transaction.recurrence_interval ||
              (recurringSeedIds.has(item.transaction.id)
                ? "Monthly"
                : undefined),
          },
        }));
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
    const existing = fallbackDb.categories.find((c) => c.id === category.id);
    const saved: Category = {
      ...category,
      id: category.id || `cat_${Date.now()}`,
      monthly_budget_cents:
        category.monthly_budget_cents !== undefined
          ? category.monthly_budget_cents
          : existing?.monthly_budget_cents ?? null,
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
    fallbackDb.entities = fallbackDb.entities.map((e) =>
      e.default_category_id === id ? { ...e, default_category_id: null } : e
    );
    for (const item of fallbackDb.transactions) {
      item.splits = item.splits.map((sp) =>
        sp.category_id === id ? { ...sp, category_id: null } : sp
      );
    }
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

  async listRecurringSchedules(): Promise<RecurringSchedule[]> {
    return [...fallbackDb.recurringSchedules].sort(
      (a, b) => a.day_of_month - b.day_of_month
    );
  },

  async saveRecurringSchedule(
    schedule: RecurringSchedule
  ): Promise<RecurringSchedule> {
    const clampedDay = Math.max(
      1,
      Math.min(31, Math.trunc(schedule.day_of_month || 1))
    );
    const saved: RecurringSchedule = {
      ...schedule,
      id: schedule.id || `rec_${Date.now()}`,
      day_of_month: clampedDay,
    };
    const idx = fallbackDb.recurringSchedules.findIndex(
      (r) => r.id === saved.id
    );
    if (idx >= 0) {
      fallbackDb.recurringSchedules[idx] = saved;
    } else {
      fallbackDb.recurringSchedules.push(saved);
    }
    persistFallbackDb();
    return saved;
  },

  async deleteRecurringSchedule(id: string): Promise<void> {
    fallbackDb.recurringSchedules = fallbackDb.recurringSchedules.filter(
      (r) => r.id !== id
    );
    persistFallbackDb();
  },

  async toggleRecurringActive(id: string): Promise<RecurringSchedule | null> {
    const target = fallbackDb.recurringSchedules.find((r) => r.id === id);
    if (!target) return null;
    target.is_active = !target.is_active;
    persistFallbackDb();
    return { ...target };
  },

  async applyRulesToTransactions(onlyUncategorized: boolean): Promise<{
    matchedCount: number;
    rulesAppliedCount: number;
  }> {
    const doesRuleMatch = (
      rule: ImportRule,
      cleanDesc: string,
      rawDesc: string
    ): boolean => {
      const pattern = rule.pattern_string.trim();
      if (!pattern) return false;
      const upperPattern = pattern.toUpperCase();
      const upperClean = (cleanDesc || "").trim().toUpperCase();
      const upperRaw = (rawDesc || "").trim().toUpperCase();

      if (rule.match_mode === "Exact") {
        return upperClean === upperPattern || upperRaw === upperPattern;
      }
      if (rule.match_mode === "Prefix") {
        return (
          upperClean.startsWith(upperPattern) ||
          upperRaw.startsWith(upperPattern)
        );
      }
      if (rule.match_mode === "Regex") {
        try {
          const re = new RegExp(pattern, "i");
          return re.test(cleanDesc) || re.test(rawDesc);
        } catch {
          return false;
        }
      }
      // Default: Contains
      return (
        upperClean.includes(upperPattern) || upperRaw.includes(upperPattern)
      );
    };

    const sortedRules = [...(await this.listRules())].sort((a, b) => {
      if (b.priority_weight !== a.priority_weight) {
        return b.priority_weight - a.priority_weight;
      }
      return b.pattern_string.length - a.pattern_string.length;
    });

    if (sortedRules.length === 0) {
      return { matchedCount: 0, rulesAppliedCount: 0 };
    }

    if (isTauriRuntime()) {
      const [allAccs, entities] = await Promise.all([
        this.listAccounts(),
        this.listEntities(),
      ]);
      const entMap = new Map(entities.map((e) => [e.id, e]));
      const ledger = await this.queryLedger({
        accountIds: allAccs.map((a) => a.account.id),
        limit: 250_000,
      });

      let matchedCount = 0;
      const usedRuleIds = new Set<string>();

      for (const item of ledger.transactions) {
        const isUncat = item.splits.some(
          (s) => !s.category_id && !s.transfer_peer_account_id
        );
        if (onlyUncategorized && !isUncat) continue;

        const tx = item.transaction;
        const matchedRule = sortedRules.find((r) => {
          if (r.account_scope_id && r.account_scope_id !== tx.account_id) {
            return false;
          }
          return doesRuleMatch(r, tx.clean_description, tx.raw_bank_string);
        });

        if (!matchedRule) continue;

        const targetEntId = matchedRule.assigned_entity_id || tx.entity_id;
        const linkedEnt = targetEntId ? entMap.get(targetEntId) : undefined;
        const targetCatId =
          matchedRule.assigned_category_id ||
          linkedEnt?.default_category_id ||
          null;

        if (!targetEntId && !targetCatId) continue;

        await this.saveTransaction({
          id: tx.id,
          account_id: tx.account_id,
          entity_id: targetEntId,
          entity_name: null,
          date_posted: tx.date_posted,
          total_amount_cents: tx.total_amount_cents,
          raw_bank_string: tx.raw_bank_string,
          clean_description: tx.clean_description,
          is_reconciled: tx.is_reconciled,
          splits: item.splits.map((s) =>
            !s.transfer_peer_account_id && targetCatId
              ? {
                  category_id: targetCatId,
                  transfer_peer_account_id: null,
                  split_amount_cents: s.split_amount_cents,
                  notes: s.notes,
                }
              : {
                  category_id: s.category_id,
                  transfer_peer_account_id: s.transfer_peer_account_id,
                  split_amount_cents: s.split_amount_cents,
                  notes: s.notes,
                }
          ),
        });

        matchedCount++;
        usedRuleIds.add(matchedRule.id);
      }

      return {
        matchedCount,
        rulesAppliedCount: usedRuleIds.size,
      };
    }

    const entMap = new Map(fallbackDb.entities.map((e) => [e.id, e]));
    let matchedCount = 0;
    const ruleHitDeltas = new Map<string, number>();

    for (const item of fallbackDb.transactions) {
      const isUncat = item.splits.some(
        (s) => !s.category_id && !s.transfer_peer_account_id
      );
      if (onlyUncategorized && !isUncat) continue;

      const tx = item.transaction;
      const matchedRule = sortedRules.find((r) => {
        if (r.account_scope_id && r.account_scope_id !== tx.account_id) {
          return false;
        }
        return doesRuleMatch(r, tx.clean_description, tx.raw_bank_string);
      });

      if (!matchedRule) continue;

      const targetEntId = matchedRule.assigned_entity_id || tx.entity_id;
      const linkedEnt = targetEntId ? entMap.get(targetEntId) : undefined;
      const targetCatId =
        matchedRule.assigned_category_id ||
        linkedEnt?.default_category_id ||
        null;

      if (!targetEntId && !targetCatId) continue;

      tx.entity_id = targetEntId;
      if (targetCatId) {
        item.splits = item.splits.map((s) =>
          !s.transfer_peer_account_id ? { ...s, category_id: targetCatId } : s
        );
      }

      matchedCount++;
      ruleHitDeltas.set(
        matchedRule.id,
        (ruleHitDeltas.get(matchedRule.id) || 0) + 1
      );
    }

    if (matchedCount > 0) {
      fallbackDb.rules = fallbackDb.rules.map((r) => {
        const delta = ruleHitDeltas.get(r.id) || 0;
        return delta > 0 ? { ...r, hit_count: r.hit_count + delta } : r;
      });
      persistFallbackDb();
    }

    return {
      matchedCount,
      rulesAppliedCount: ruleHitDeltas.size,
    };
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

    const existingIdx = fallbackDb.transactions.findIndex(
      (t) => t.transaction.id === txId
    );
    const existingTx =
      existingIdx >= 0 ? fallbackDb.transactions[existingIdx].transaction : null;

    const isRecurringFlag =
      transaction.is_recurring !== undefined
        ? transaction.is_recurring
        : existingTx?.is_recurring ?? false;
    const recurrenceInterval =
      transaction.recurrence_interval ||
      existingTx?.recurrence_interval ||
      (isRecurringFlag ? "Monthly" : undefined);

    const saved: TransactionWithSplits = {
      transaction: {
        id: txId,
        account_id: transaction.account_id,
        entity_id: entityId,
        date_posted: transaction.date_posted,
        total_amount_cents: transaction.total_amount_cents,
        raw_bank_string: transaction.raw_bank_string || transaction.clean_description,
        clean_description: transaction.clean_description,
        dedup_hash: existingTx?.dedup_hash || `manual_${txId}`,
        is_reconciled: transaction.is_reconciled,
        is_recurring: isRecurringFlag,
        recurrence_interval: recurrenceInterval,
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

    if (existingIdx >= 0) {
      fallbackDb.transactions[existingIdx] = saved;
    } else {
      fallbackDb.transactions.unshift(saved);
    }

    // If user created/saved a transaction flagged as recurring, ensure a corresponding RecurringSchedule exists
    if (isRecurringFlag) {
      const ent = entityId
        ? fallbackDb.entities.find((e) => e.id === entityId)
        : undefined;
      const scheduleName = ent?.normalized_name || transaction.clean_description;
      const alreadyExists = fallbackDb.recurringSchedules.some(
        (r) =>
          (entityId && r.entity_id === entityId) ||
          r.name.toLowerCase() === scheduleName.toLowerCase()
      );
      if (!alreadyExists && scheduleName) {
        const parsedDay = Number(transaction.date_posted.split("-")[2]) || 1;
        fallbackDb.recurringSchedules.push({
          id: `rec_${Date.now()}`,
          name: scheduleName,
          expected_amount_cents: transaction.total_amount_cents,
          recurrence_interval: recurrenceInterval || "Monthly",
          day_of_month: Math.max(1, Math.min(31, parsedDay)),
          account_id: transaction.account_id,
          category_id: transaction.splits[0]?.category_id || null,
          entity_id: entityId || null,
          is_active: true,
          notes: transaction.splits[0]?.notes || null,
        });
      }
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

  async batchAssignCategory(
    txIds: string[],
    categoryId: string | null
  ): Promise<void> {
    const idSet = new Set(txIds);
    if (isTauriRuntime()) {
      const allAccs = await this.listAccounts();
      const ledger = await this.queryLedger({
        accountIds: allAccs.map((a) => a.account.id),
        limit: 250_000,
      });
      for (const item of ledger.transactions) {
        if (!idSet.has(item.transaction.id)) continue;
        await this.saveTransaction({
          id: item.transaction.id,
          account_id: item.transaction.account_id,
          entity_id: item.transaction.entity_id,
          entity_name: null,
          date_posted: item.transaction.date_posted,
          total_amount_cents: item.transaction.total_amount_cents,
          raw_bank_string: item.transaction.raw_bank_string,
          clean_description: item.transaction.clean_description,
          is_reconciled: item.transaction.is_reconciled,
          splits: item.splits.map((s, idx) =>
            idx === 0 || !s.transfer_peer_account_id
              ? {
                  category_id: categoryId,
                  transfer_peer_account_id: null,
                  split_amount_cents: s.split_amount_cents,
                  notes: s.notes,
                }
              : {
                  category_id: s.category_id,
                  transfer_peer_account_id: s.transfer_peer_account_id,
                  split_amount_cents: s.split_amount_cents,
                  notes: s.notes,
                }
          ),
        });
      }
      return;
    }

    for (const item of fallbackDb.transactions) {
      if (!idSet.has(item.transaction.id)) continue;
      item.splits = item.splits.map((s, idx) =>
        idx === 0 || !s.transfer_peer_account_id
          ? {
              ...s,
              category_id: categoryId,
              transfer_peer_account_id: null,
            }
          : s
      );
    }
    persistFallbackDb();
  },

  async batchAssignEntity(
    txIds: string[],
    entityId: string | null
  ): Promise<void> {
    const idSet = new Set(txIds);
    if (isTauriRuntime()) {
      const [allAccs, entities] = await Promise.all([
        this.listAccounts(),
        this.listEntities(),
      ]);
      const matchedEnt = entityId
        ? entities.find((e) => e.id === entityId)
        : undefined;
      const ledger = await this.queryLedger({
        accountIds: allAccs.map((a) => a.account.id),
        limit: 250_000,
      });
      for (const item of ledger.transactions) {
        if (!idSet.has(item.transaction.id)) continue;
        await this.saveTransaction({
          id: item.transaction.id,
          account_id: item.transaction.account_id,
          entity_id: entityId,
          entity_name: null,
          date_posted: item.transaction.date_posted,
          total_amount_cents: item.transaction.total_amount_cents,
          raw_bank_string: item.transaction.raw_bank_string,
          clean_description: item.transaction.clean_description,
          is_reconciled: item.transaction.is_reconciled,
          splits: item.splits.map((s) => ({
            category_id:
              !s.category_id &&
              !s.transfer_peer_account_id &&
              matchedEnt?.default_category_id
                ? matchedEnt.default_category_id
                : s.category_id,
            transfer_peer_account_id: s.transfer_peer_account_id,
            split_amount_cents: s.split_amount_cents,
            notes: s.notes,
          })),
        });
      }
      return;
    }

    const matchedEnt = entityId
      ? fallbackDb.entities.find((e) => e.id === entityId)
      : undefined;
    for (const item of fallbackDb.transactions) {
      if (!idSet.has(item.transaction.id)) continue;
      item.transaction.entity_id = entityId;
      if (matchedEnt?.default_category_id) {
        item.splits = item.splits.map((s) =>
          !s.category_id && !s.transfer_peer_account_id
            ? { ...s, category_id: matchedEnt.default_category_id }
            : s
        );
      }
    }
    persistFallbackDb();
  },

  async batchToggleReconciled(
    txIds: string[],
    reconciled: boolean
  ): Promise<void> {
    const idSet = new Set(txIds);
    if (isTauriRuntime()) {
      const allAccs = await this.listAccounts();
      const ledger = await this.queryLedger({
        accountIds: allAccs.map((a) => a.account.id),
        limit: 250_000,
      });
      for (const item of ledger.transactions) {
        if (
          idSet.has(item.transaction.id) &&
          item.transaction.is_reconciled !== reconciled
        ) {
          await this.toggleReconciled(item.transaction.id);
        }
      }
      return;
    }

    for (const item of fallbackDb.transactions) {
      if (idSet.has(item.transaction.id)) {
        item.transaction.is_reconciled = reconciled;
      }
    }
    persistFallbackDb();
  },

  async batchDeleteTransactions(txIds: string[]): Promise<void> {
    const idSet = new Set(txIds);
    if (isTauriRuntime()) {
      for (const id of txIds) {
        await this.deleteTransaction(id);
      }
      return;
    }

    fallbackDb.transactions = fallbackDb.transactions.filter(
      (t) => !idSet.has(t.transaction.id)
    );
    persistFallbackDb();
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

    // -------------------------------------------------------------------------
    // Stage 1–6 Deterministic Browser Ingestion Engine
    // -------------------------------------------------------------------------
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const text = decoder.decode(new Uint8Array(params.rawBytes));
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return {
        header_matched: false,
        profile_name: null,
        header_signature_hash: "sig_empty",
        needs_column_mapping: true,
        raw_sample_rows: [],
        all_raw_rows: [],
        detected_columns: [],
        staged_rows: [],
      };
    }

    // Stage 2.1: Preamble Discard & Header Row Detection
    const headerKeywords = [
      "data",
      "date",
      "movimento",
      "mov",
      "lançamento",
      "lancamento",
      "lanc",
      "descri",
      "description",
      "montante",
      "valor",
      "débito",
      "debito",
      "crédito",
      "credito",
      "amount",
      "saldo",
      "balance",
      "started",
      "completed",
      "payee",
    ];

    let headerRowIdx = 0;
    if (
      params.explicitProfile &&
      typeof params.explicitProfile.header_row_idx === "number" &&
      params.explicitProfile.header_row_idx >= 0 &&
      params.explicitProfile.header_row_idx < lines.length
    ) {
      headerRowIdx = params.explicitProfile.header_row_idx;
    } else {
      const maxScan = Math.min(16, lines.length);
      for (let idx = 0; idx < maxScan; idx++) {
        const lower = lines[idx].toLowerCase();
        let hits = 0;
        for (const kw of headerKeywords) {
          if (lower.includes(kw)) hits++;
        }
        if (hits >= 2) {
          headerRowIdx = idx;
          break;
        }
      }
    }

    // Stage 2.2: Delimiter Detection
    const headerLine = lines[headerRowIdx] || lines[0] || "";
    const countChar = (s: string, ch: string) => s.split(ch).length - 1;
    let delim = ";";
    if (params.explicitProfile?.delimiter) {
      delim = params.explicitProfile.delimiter;
    } else {
      const candidates = [";", "\t", ",", "|"];
      let bestCount = -1;
      for (const cand of candidates) {
        const c = countChar(headerLine, cand);
        if (c > bestCount) {
          bestCount = c;
          delim = cand;
        }
      }
    }

    const tokenizeCsvRow = (line: string, delimiter: string): string[] => {
      return line
        .split(delimiter)
        .map((cell) => cell.trim().replace(/^"(.*)"$/, "$1").trim());
    };

    const allParsedRows = lines.map((l) => tokenizeCsvRow(l, delim));
    const headerRow = allParsedRows[headerRowIdx] || [];
    const dataRows = allParsedRows
      .slice(headerRowIdx + 1)
      .filter((r) => r.some((cell) => cell.length > 0));

    // Compute normalized header signature hash
    const normalizedSig = headerRow
      .map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""))
      .join("_");
    const headerSignatureHash = `sig_${delim === "\t" ? "tab" : delim}_${normalizedSig}`;

    // Stage 2.3: Date & Zero-Float Monetary Parsers
    const ptMonthMap: Record<string, string> = {
      jan: "01",
      fev: "02",
      mar: "03",
      abr: "04",
      mai: "05",
      jun: "06",
      jul: "07",
      ago: "08",
      set: "09",
      out: "10",
      nov: "11",
      dez: "12",
      oct: "10",
      dec: "12",
      may: "05",
      feb: "02",
      apr: "04",
      aug: "08",
      sep: "09",
    };

    const normalizeDateStr = (raw: string): string => {
      const trimmed = (raw || "").trim().replace(/^"(.*)"$/, "$1").trim();
      if (!trimmed) return "2026-10-20";
      // YYYY-MM-DD or YYYY-MM-DD HH:MM:SS (e.g. Revolut)
      const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})/);
      if (isoMatch) {
        return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
      }
      // DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
      const dmyMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
      if (dmyMatch) {
        return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
      }
      // Textual Portuguese/English month: "20 Out 2026" or "20-Out-2026"
      const txtMatch = trimmed.match(
        /^(\d{1,2})[\s-/.]+([A-Za-zçÇ]{3,})[\s-/.]+(\d{4})/
      );
      if (txtMatch) {
        const mKey = txtMatch[2].slice(0, 3).toLowerCase();
        const mm = ptMonthMap[mKey] || "10";
        return `${txtMatch[3]}-${mm}-${txtMatch[1].padStart(2, "0")}`;
      }
      return trimmed.slice(0, 10);
    };

    const parseAmountWithSeparator = (
      raw: string,
      decimalSep: string
    ): number => {
      const cleaned = (raw || "")
        .replace(/[€$£\sA-Za-z]/g, "")
        .replace(/^"(.*)"$/, "$1")
        .trim();
      if (!cleaned) return 0;
      if (decimalSep === ".") {
        // Anglo format: strip thousand commas, convert decimal dot to comma for parseCentsInput
        const normalized = cleaned.replace(/,/g, "").replace(".", ",");
        return parseCentsInput(normalized);
      }
      // European format: parseCentsInput natively strips dots and uses comma as decimal
      return parseCentsInput(cleaned);
    };

    // Stage 3: Resolve BankProfile (Explicit -> Saved Custom -> Auto-Heuristic)
    let activeProfile: BankProfile | null =
      params.explicitProfile ||
      fallbackDb.bankProfiles.find(
        (p) => p.header_signature_hash === headerSignatureHash
      ) ||
      null;

    if (!activeProfile && headerRow.length >= 3) {
      const lowerCols = headerRow.map((c) => c.toLowerCase());
      const findIdx = (patterns: string[]) =>
        lowerCols.findIndex((c) => patterns.some((p) => c.includes(p)));

      const dateIdx = findIdx([
        "started date",
        "data mov",
        "data lanc",
        "data valor",
        "data",
        "date",
      ]);
      const descIdx = findIdx([
        "descri",
        "description",
        "movimento",
        "histórico",
        "historico",
        "payee",
      ]);
      const debitIdx = findIdx(["débito", "debito", "debit"]);
      const creditIdx = findIdx(["crédito", "credito", "credit"]);
      const amountIdx = findIdx(["montante", "valor", "amount", "importância"]);
      const balanceIdx = findIdx(["saldo", "balance"]);

      if (
        dateIdx >= 0 &&
        descIdx >= 0 &&
        (amountIdx >= 0 || (debitIdx >= 0 && creditIdx >= 0))
      ) {
        const isRevolutOrAnglo =
          delim === "," &&
          (lowerCols.some((c) => c.includes("started date")) ||
            lowerCols.some((c) => c.includes("payee")));
        const isSplit = debitIdx >= 0 && creditIdx >= 0;

        let detectedName = "Auto-Detected Portuguese Statement";
        if (isRevolutOrAnglo && lowerCols.some((c) => c.includes("started date"))) {
          detectedName = "Revolut";
        } else if (isRevolutOrAnglo && lowerCols.some((c) => c.includes("payee"))) {
          detectedName = "N26";
        } else if (isSplit && lowerCols.some((c) => c.includes("saldo contabil"))) {
          detectedName = "CGD (Débito / Crédito)";
        } else if (lowerCols.some((c) => c.includes("data lanc"))) {
          detectedName = "Millennium bcp / ActivoBank";
        }

        activeProfile = {
          id: "auto_profile",
          profile_name: detectedName,
          header_signature_hash: headerSignatureHash,
          date_col_idx: dateIdx,
          desc_col_idx: descIdx,
          amount_strategy: isSplit ? "DebitCreditSplit" : "SingleSigned",
          amount_col_idx: isSplit ? null : amountIdx,
          debit_col_idx: isSplit ? debitIdx : null,
          credit_col_idx: isSplit ? creditIdx : null,
          indicator_col_idx: null,
          decimal_separator: isRevolutOrAnglo ? "." : ",",
          delimiter: delim,
          header_row_idx: headerRowIdx,
          balance_col_idx: balanceIdx >= 0 ? balanceIdx : null,
        };
      }
    }

    if (!activeProfile) {
      return {
        header_matched: false,
        profile_name: null,
        header_signature_hash: headerSignatureHash,
        needs_column_mapping: true,
        raw_sample_rows: dataRows.slice(0, 5),
        all_raw_rows: allParsedRows,
        detected_columns: headerRow,
        staged_rows: [],
        detected_delimiter: delim,
        detected_header_row_idx: headerRowIdx,
        detected_decimal_separator: delim === "," ? "." : ",",
        applied_profile: null,
      };
    }

    const seqMap = new Map<string, number>();
    const existingHashes = new Set(
      fallbackDb.transactions
        .filter((t) => t.transaction.account_id === params.accountId)
        .map((t) => t.transaction.dedup_hash)
    );

    const decSep = activeProfile.decimal_separator || ",";

    const stagedRows: StagedTransactionRowDto[] = dataRows
      .filter((r) => r.length >= 2)
      .map((r, i) => {
        const rawDate = r[activeProfile!.date_col_idx] || r[0] || "";
        const isoDate = normalizeDateStr(rawDate);
        const rawDesc =
          r[activeProfile!.desc_col_idx] || r[1] || r[0] || "Movimento";

        let amountCents = 0;
        if (
          activeProfile!.amount_strategy === "DebitCreditSplit" &&
          activeProfile!.debit_col_idx !== null &&
          activeProfile!.credit_col_idx !== null
        ) {
          const debRaw = r[activeProfile!.debit_col_idx] || "";
          const credRaw = r[activeProfile!.credit_col_idx] || "";
          const debCents = Math.abs(parseAmountWithSeparator(debRaw, decSep));
          const credCents = Math.abs(parseAmountWithSeparator(credRaw, decSep));
          amountCents = credCents > 0 ? credCents : -debCents;
        } else {
          const amtCol = activeProfile!.amount_col_idx ?? 2;
          const rawAmt = r[amtCol] || "0";
          amountCents = parseAmountWithSeparator(rawAmt, decSep);
        }

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
          ? fallbackDb.entities.find(
              (e) => e.id === matchedRule?.assigned_entity_id
            )
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
      profile_name: activeProfile.profile_name,
      header_signature_hash: headerSignatureHash,
      needs_column_mapping: false,
      raw_sample_rows: dataRows.slice(0, 5),
      all_raw_rows: allParsedRows,
      detected_columns: headerRow,
      staged_rows: stagedRows,
      detected_delimiter: delim,
      detected_header_row_idx: headerRowIdx,
      detected_decimal_separator: decSep,
      applied_profile: activeProfile,
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
    const existingIdx = fallbackDb.bankProfiles.findIndex(
      (p) =>
        p.id === profile.id ||
        p.header_signature_hash === profile.header_signature_hash
    );
    if (existingIdx >= 0) {
      fallbackDb.bankProfiles[existingIdx] = profile;
    } else {
      fallbackDb.bankProfiles.push(profile);
    }
    persistFallbackDb();
  },

  async listBankProfiles(): Promise<BankProfile[]> {
    return [...fallbackDb.bankProfiles];
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
        recurringSchedules: fallbackDb.recurringSchedules,
        bankProfiles: fallbackDb.bankProfiles,
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
    fallbackDb.recurringSchedules = Array.isArray(parsed.recurringSchedules)
      ? parsed.recurringSchedules
      : cloneDefaultFallbackDb().recurringSchedules;
    fallbackDb.bankProfiles = Array.isArray(parsed.bankProfiles)
      ? parsed.bankProfiles
      : [];
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
      fallbackDb.recurringSchedules = fresh.recurringSchedules;
      fallbackDb.bankProfiles = fresh.bankProfiles;
      fallbackDb.transactions = fresh.transactions;
      persistFallbackDb();
    }
  },
};
