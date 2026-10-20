import { create } from "zustand";
import { ipc } from "../services/ipc";
import {
  Account,
  AccountBalanceSummary,
  ActiveView,
  BankProfile,
  Category,
  Cents,
  Entity,
  ImportRule,
  ParseStatementResultDto,
  SaveTransactionInput,
  StagedTransactionRowDto,
  TransactionWithSplits,
  VaultStatus,
} from "../types";

interface FinFolioState {
  // Navigation & UI Modals
  activeView: ActiveView;
  isSidebarCollapsed: boolean;
  isCommandPaletteOpen: boolean;
  isImportModalOpen: boolean;
  isNewTransactionRowOpen: boolean;
  isVaultSecurityModalOpen: boolean;

  // Vault & Entities
  vaultStatus: VaultStatus | null;
  accountSummaries: AccountBalanceSummary[];
  selectedAccountIds: string[];
  categories: Category[];
  entities: Entity[];
  rules: ImportRule[];

  // Ledger & Context Header KPIs
  transactions: TransactionWithSplits[];
  totalTransactionCount: number;
  uncategorizedCount: number;
  isUncategorizedFilterActive: boolean;
  selectedLedgerTxIds: string[];
  lastSelectedTxId: string | null;
  periodInflowCents: Cents;
  periodOutflowCents: Cents;
  netCashFlowCents: Cents;
  startDate: string;
  endDate: string;
  searchQuery: string;
  activeLedgerRowIdx: number;
  editingTxId: string | null;
  expandedSplitTxIds: string[];
  lastFilterDurationMs: number;
  statusBannerMessage: string | null;

  // Import Staging State
  stagingAccountId: string;
  stagingResult: ParseStatementResultDto | null;
  activeStagingRowIdx: number;
  pendingFileName: string;
  pendingRawBytes: number[];

  // Actions
  initializeWorkspace: () => Promise<void>;
  setActiveView: (view: ActiveView) => void;
  toggleSidebar: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setImportModalOpen: (open: boolean) => void;
  setNewTransactionRowOpen: (open: boolean) => void;
  setVaultSecurityModalOpen: (open: boolean) => void;
  setStatusBanner: (msg: string | null) => void;

  // Multi-Account Switcher (<5ms filter)
  toggleAccountSelection: (accountId: string) => Promise<void>;
  selectAllAccounts: () => Promise<void>;
  selectSingleAccount: (accountId: string) => Promise<void>;
  saveAccount: (account: Account) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;

  // Ledger Filtering, Batch Selection & Actions
  setDateRange: (startDate: string, endDate: string) => Promise<void>;
  setSearchQuery: (query: string) => Promise<void>;
  toggleUncategorizedFilter: () => Promise<void>;
  refreshLedger: () => Promise<void>;
  setActiveLedgerRowIdx: (idx: number) => void;
  setEditingTxId: (txId: string | null) => void;
  toggleSplitExpanded: (txId: string) => void;
  toggleTransactionReconciled: (txId: string) => Promise<void>;
  saveTransaction: (input: SaveTransactionInput) => Promise<void>;
  deleteTransaction: (txId: string) => Promise<void>;
  toggleSelectLedgerTx: (txId: string, shiftKey?: boolean) => void;
  selectAllLedgerTxs: () => void;
  clearSelectedLedgerTxs: () => void;
  batchAssignCategory: (
    txIds: string[],
    categoryId: string | null
  ) => Promise<void>;
  batchAssignEntity: (txIds: string[], entityId: string | null) => Promise<void>;
  batchToggleReconciled: (
    txIds: string[],
    reconciled: boolean
  ) => Promise<void>;
  batchDeleteTransactions: (txIds: string[]) => Promise<void>;

  // Staging Grid Actions
  setStagingAccountId: (accountId: string) => void;
  ingestRawStatement: (
    fileName: string,
    rawBytes: number[],
    mimeType?: string,
    explicitProfile?: BankProfile | null
  ) => Promise<void>;
  updateStagedRow: (
    tempId: string,
    patch: Partial<StagedTransactionRowDto>
  ) => void;
  setActiveStagingRowIdx: (idx: number) => void;
  confirmActiveStagingRowAndAdvance: () => void;
  excludeActiveStagingRow: () => void;
  commitAllStagedTransactions: () => Promise<void>;

  // Taxonomy, Budgets & Rules Actions
  saveCategory: (cat: Category) => Promise<void>;
  setCategoryBudget: (
    categoryId: string,
    budgetCents: Cents | null
  ) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  saveEntity: (ent: Entity) => Promise<void>;
  deleteEntity: (id: string) => Promise<void>;
  saveRule: (rule: ImportRule) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  applyRulesToTransactions: (onlyUncategorized?: boolean) => Promise<number>;

  // Vault Security, Portability & Benchmark
  rekeyVault: (newPassphrase: string | null) => Promise<void>;
  run100kBenchmark: (count?: number) => Promise<void>;
  exportLedger: (format: "csv" | "json") => Promise<string>;
  exportVaultSnapshot: () => Promise<string>;
  importVaultSnapshot: (jsonString: string) => Promise<void>;
  resetPreviewVault: () => Promise<void>;
}

export const useFinFolioStore = create<FinFolioState>((set, get) => ({
  activeView: "ledger",
  isSidebarCollapsed: false,
  isCommandPaletteOpen: false,
  isImportModalOpen: false,
  isNewTransactionRowOpen: false,
  isVaultSecurityModalOpen: false,

  vaultStatus: null,
  accountSummaries: [],
  selectedAccountIds: [],
  categories: [],
  entities: [],
  rules: [],

  transactions: [],
  totalTransactionCount: 0,
  uncategorizedCount: 0,
  isUncategorizedFilterActive: false,
  selectedLedgerTxIds: [],
  lastSelectedTxId: null,
  periodInflowCents: 0,
  periodOutflowCents: 0,
  netCashFlowCents: 0,
  startDate: "",
  endDate: "",
  searchQuery: "",
  activeLedgerRowIdx: 0,
  editingTxId: null,
  expandedSplitTxIds: [],
  lastFilterDurationMs: 0.4,
  statusBannerMessage: null,

  stagingAccountId: "",
  stagingResult: null,
  activeStagingRowIdx: 0,
  pendingFileName: "",
  pendingRawBytes: [],

  initializeWorkspace: async () => {
    const [vaultStatus, accountSummaries, categories, entities, rules] =
      await Promise.all([
        ipc.getVaultStatus(),
        ipc.listAccounts(),
        ipc.listCategories(),
        ipc.listEntities(),
        ipc.listRules(),
      ]);

    const includedIds = accountSummaries
      .filter((s) => s.account.is_included_in_totals)
      .map((s) => s.account.id);
    const defaultSelected =
      includedIds.length > 0
        ? includedIds
        : accountSummaries.map((s) => s.account.id);

    set({
      vaultStatus,
      accountSummaries,
      selectedAccountIds: defaultSelected,
      stagingAccountId: defaultSelected[0] || "",
      categories,
      entities,
      rules,
    });

    await get().refreshLedger();
  },

  setActiveView: (view) => set({ activeView: view }),
  toggleSidebar: () =>
    set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),
  setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),
  setImportModalOpen: (open) => set({ isImportModalOpen: open }),
  setNewTransactionRowOpen: (open) => set({ isNewTransactionRowOpen: open }),
  setVaultSecurityModalOpen: (open) => set({ isVaultSecurityModalOpen: open }),
  setStatusBanner: (msg) => set({ statusBannerMessage: msg }),

  toggleAccountSelection: async (accountId) => {
    const t0 = performance.now();
    const current = get().selectedAccountIds;
    const next = current.includes(accountId)
      ? current.filter((id) => id !== accountId)
      : [...current, accountId];

    set({ selectedAccountIds: next });
    await get().refreshLedger();
    const elapsed = Number((performance.now() - t0).toFixed(2));
    set({ lastFilterDurationMs: elapsed });
  },

  selectAllAccounts: async () => {
    const t0 = performance.now();
    const allIds = get().accountSummaries.map((s) => s.account.id);
    set({ selectedAccountIds: allIds });
    await get().refreshLedger();
    set({ lastFilterDurationMs: Number((performance.now() - t0).toFixed(2)) });
  },

  selectSingleAccount: async (accountId) => {
    const t0 = performance.now();
    set({ selectedAccountIds: [accountId] });
    await get().refreshLedger();
    set({ lastFilterDurationMs: Number((performance.now() - t0).toFixed(2)) });
  },

  saveAccount: async (account) => {
    await ipc.saveAccount(account);
    const accountSummaries = await ipc.listAccounts();
    const selected = get().selectedAccountIds;
    const latestId = accountSummaries[accountSummaries.length - 1]?.account.id;
    const nextSelected =
      !account.id && latestId && !selected.includes(latestId)
        ? [...selected, latestId]
        : selected;
    set({ accountSummaries, selectedAccountIds: nextSelected });
    await get().refreshLedger();
  },

  deleteAccount: async (id) => {
    await ipc.deleteAccount(id);
    const accountSummaries = await ipc.listAccounts();
    set((s) => ({
      accountSummaries,
      selectedAccountIds: s.selectedAccountIds.filter((aid) => aid !== id),
    }));
    await get().refreshLedger();
  },

  setDateRange: async (startDate, endDate) => {
    set({ startDate, endDate });
    await get().refreshLedger();
  },

  setSearchQuery: async (searchQuery) => {
    set({ searchQuery });
    await get().refreshLedger();
  },

  toggleUncategorizedFilter: async () => {
    set((s) => ({
      isUncategorizedFilterActive: !s.isUncategorizedFilterActive,
    }));
    await get().refreshLedger();
  },

  refreshLedger: async () => {
    const {
      selectedAccountIds,
      startDate,
      endDate,
      searchQuery,
      isUncategorizedFilterActive,
      selectedLedgerTxIds,
    } = get();
    const [res, accountSummaries] = await Promise.all([
      ipc.queryLedger({
        accountIds: selectedAccountIds,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: searchQuery || undefined,
        limit: 1000,
        offset: 0,
      }),
      ipc.listAccounts(),
    ]);

    const isTxUncategorized = (item: TransactionWithSplits) =>
      item.splits.some(
        (s) => !s.category_id && !s.transfer_peer_account_id
      );

    const uncategorizedCount = res.transactions.filter(isTxUncategorized).length;
    const finalTransactions = isUncategorizedFilterActive
      ? res.transactions.filter(isTxUncategorized)
      : res.transactions;

    const visibleIdSet = new Set(finalTransactions.map((t) => t.transaction.id));
    const prunedSelection = selectedLedgerTxIds.filter((id) =>
      visibleIdSet.has(id)
    );

    set({
      transactions: finalTransactions,
      totalTransactionCount: isUncategorizedFilterActive
        ? finalTransactions.length
        : res.total_count,
      uncategorizedCount,
      selectedLedgerTxIds: prunedSelection,
      periodInflowCents: res.period_inflow_cents,
      periodOutflowCents: res.period_outflow_cents,
      netCashFlowCents: res.net_cash_flow_cents,
      accountSummaries,
    });
  },

  setActiveLedgerRowIdx: (idx) => {
    const max = Math.max(0, get().transactions.length - 1);
    set({ activeLedgerRowIdx: Math.max(0, Math.min(idx, max)) });
  },

  setEditingTxId: (txId) => set({ editingTxId: txId }),

  toggleSplitExpanded: (txId) => {
    set((s) => ({
      expandedSplitTxIds: s.expandedSplitTxIds.includes(txId)
        ? s.expandedSplitTxIds.filter((id) => id !== txId)
        : [...s.expandedSplitTxIds, txId],
    }));
  },

  toggleTransactionReconciled: async (txId) => {
    await ipc.toggleReconciled(txId);
    await get().refreshLedger();
  },

  saveTransaction: async (input) => {
    await ipc.saveTransaction(input);
    const entities = await ipc.listEntities();
    set({ entities, editingTxId: null });
    await get().refreshLedger();
  },

  deleteTransaction: async (txId) => {
    await ipc.deleteTransaction(txId);
    await get().refreshLedger();
  },

  toggleSelectLedgerTx: (txId, shiftKey = false) => {
    const { transactions, selectedLedgerTxIds, lastSelectedTxId } = get();
    if (shiftKey && lastSelectedTxId && lastSelectedTxId !== txId) {
      const idxA = transactions.findIndex(
        (t) => t.transaction.id === lastSelectedTxId
      );
      const idxB = transactions.findIndex((t) => t.transaction.id === txId);
      if (idxA !== -1 && idxB !== -1) {
        const start = Math.min(idxA, idxB);
        const end = Math.max(idxA, idxB);
        const rangeIds = transactions
          .slice(start, end + 1)
          .map((t) => t.transaction.id);
        const merged = Array.from(new Set([...selectedLedgerTxIds, ...rangeIds]));
        set({ selectedLedgerTxIds: merged, lastSelectedTxId: txId });
        return;
      }
    }

    const exists = selectedLedgerTxIds.includes(txId);
    const next = exists
      ? selectedLedgerTxIds.filter((id) => id !== txId)
      : [...selectedLedgerTxIds, txId];
    set({
      selectedLedgerTxIds: next,
      lastSelectedTxId: txId,
    });
  },

  selectAllLedgerTxs: () => {
    const allIds = get().transactions.map((t) => t.transaction.id);
    set({ selectedLedgerTxIds: allIds });
  },

  clearSelectedLedgerTxs: () => {
    set({ selectedLedgerTxIds: [], lastSelectedTxId: null });
  },

  batchAssignCategory: async (txIds, categoryId) => {
    await ipc.batchAssignCategory(txIds, categoryId);
    const cat = categoryId
      ? get().categories.find((c) => c.id === categoryId)
      : null;
    await get().refreshLedger();
    set({
      selectedLedgerTxIds: [],
      statusBannerMessage: `✓ Assigned category "${
        cat ? cat.name : "Uncategorized"
      }" to ${txIds.length} transaction(s).`,
    });
  },

  batchAssignEntity: async (txIds, entityId) => {
    await ipc.batchAssignEntity(txIds, entityId);
    const ent = entityId
      ? get().entities.find((e) => e.id === entityId)
      : null;
    await get().refreshLedger();
    set({
      selectedLedgerTxIds: [],
      statusBannerMessage: `✓ Assigned counterparty "${
        ent ? ent.normalized_name : "None"
      }" to ${txIds.length} transaction(s).`,
    });
  },

  batchToggleReconciled: async (txIds, reconciled) => {
    await ipc.batchToggleReconciled(txIds, reconciled);
    await get().refreshLedger();
    set({
      selectedLedgerTxIds: [],
      statusBannerMessage: `✓ Marked ${txIds.length} transaction(s) as ${
        reconciled ? "Reconciled" : "Unreconciled"
      }.`,
    });
  },

  batchDeleteTransactions: async (txIds) => {
    await ipc.batchDeleteTransactions(txIds);
    await get().refreshLedger();
    set({
      selectedLedgerTxIds: [],
      statusBannerMessage: `✓ Deleted ${txIds.length} transaction(s).`,
    });
  },

  setStagingAccountId: (accountId) => set({ stagingAccountId: accountId }),

  ingestRawStatement: async (
    fileName,
    rawBytes,
    mimeType,
    explicitProfile = null
  ) => {
    const accountId =
      get().stagingAccountId ||
      get().selectedAccountIds[0] ||
      get().accountSummaries[0]?.account.id ||
      "";
    if (!accountId) return;

    const result = await ipc.parseStatement({
      fileName,
      rawBytes,
      mimeType,
      accountId,
      explicitProfile,
    });

    set({
      stagingAccountId: accountId,
      stagingResult: result,
      activeStagingRowIdx: 0,
      pendingFileName: fileName,
      pendingRawBytes: rawBytes,
      activeView: "staging",
      isImportModalOpen: false,
    });
  },

  updateStagedRow: (tempId, patch) => {
    const { stagingResult, entities, categories } = get();
    if (!stagingResult) return;

    const updatedRows = stagingResult.staged_rows.map((row) => {
      if (row.temp_id !== tempId) return row;
      const next = { ...row, ...patch };

      // Section 5.1 Entity-Category Inheritance Model:
      // Assigning an Entity automatically populates its default Category if Category wasn't explicitly overridden
      if ("entity_id" in patch && patch.entity_id) {
        const matchedEnt = entities.find((e) => e.id === patch.entity_id);
        if (matchedEnt) {
          next.entity_name = matchedEnt.normalized_name;
          if (matchedEnt.default_category_id && !("category_id" in patch)) {
            next.category_id = matchedEnt.default_category_id;
            const defCat = categories.find(
              (c) => c.id === matchedEnt.default_category_id
            );
            next.category_name = defCat?.name || null;
          }
        }
      }

      if ("category_id" in patch) {
        const matchedCat = categories.find((c) => c.id === patch.category_id);
        next.category_name = matchedCat?.name || null;
      }

      // If categorizing a previously unknown merchant, enable Auto-Rule Learning indicator
      if (
        (patch.entity_id || patch.entity_name || patch.category_id) &&
        row.status === "New"
      ) {
        next.auto_learn_rule = true;
      }

      return next;
    });

    set({
      stagingResult: {
        ...stagingResult,
        staged_rows: updatedRows,
      },
    });
  },

  setActiveStagingRowIdx: (idx) => {
    const rows = get().stagingResult?.staged_rows || [];
    const max = Math.max(0, rows.length - 1);
    set({ activeStagingRowIdx: Math.max(0, Math.min(idx, max)) });
  },

  confirmActiveStagingRowAndAdvance: () => {
    const { stagingResult, activeStagingRowIdx } = get();
    if (!stagingResult || stagingResult.staged_rows.length === 0) return;
    const row = stagingResult.staged_rows[activeStagingRowIdx];
    if (row && row.status !== "AlreadyImported") {
      get().updateStagedRow(row.temp_id, {
        is_selected_for_import: true,
      });
    }
    const nextIdx = Math.min(
      stagingResult.staged_rows.length - 1,
      activeStagingRowIdx + 1
    );
    set({ activeStagingRowIdx: nextIdx });
  },

  excludeActiveStagingRow: () => {
    const { stagingResult, activeStagingRowIdx } = get();
    if (!stagingResult || stagingResult.staged_rows.length === 0) return;
    const row = stagingResult.staged_rows[activeStagingRowIdx];
    if (row) {
      get().updateStagedRow(row.temp_id, {
        is_selected_for_import: !row.is_selected_for_import,
      });
    }
  },

  commitAllStagedTransactions: async () => {
    const { stagingResult, stagingAccountId } = get();
    if (!stagingResult || !stagingAccountId) return;

    const res = await ipc.commitStatement({
      accountId: stagingAccountId,
      rows: stagingResult.staged_rows,
    });

    const [entities, rules] = await Promise.all([
      ipc.listEntities(),
      ipc.listRules(),
    ]);

    set({
      stagingResult: null,
      entities,
      rules,
      activeView: "ledger",
      statusBannerMessage: `Imported ${res.imported_count} transactions (${res.rules_created} auto-rules learned).`,
    });

    await get().refreshLedger();
  },

  saveCategory: async (cat) => {
    await ipc.saveCategory(cat);
    const categories = await ipc.listCategories();
    set({ categories });
    await get().refreshLedger();
  },

  setCategoryBudget: async (categoryId, budgetCents) => {
    const existing = get().categories.find((c) => c.id === categoryId);
    if (!existing) return;
    await ipc.saveCategory({
      ...existing,
      monthly_budget_cents: budgetCents,
    });
    const categories = await ipc.listCategories();
    set({ categories });
  },

  deleteCategory: async (id) => {
    await ipc.deleteCategory(id);
    const [categories, entities] = await Promise.all([
      ipc.listCategories(),
      ipc.listEntities(),
    ]);
    set({ categories, entities });
    await get().refreshLedger();
  },

  saveEntity: async (ent) => {
    await ipc.saveEntity(ent);
    const entities = await ipc.listEntities();
    set({ entities });
  },

  deleteEntity: async (id) => {
    await ipc.deleteEntity(id);
    const entities = await ipc.listEntities();
    set({ entities });
    await get().refreshLedger();
  },

  saveRule: async (rule) => {
    await ipc.saveRule(rule);
    const rules = await ipc.listRules();
    set({ rules });
  },

  deleteRule: async (id) => {
    await ipc.deleteRule(id);
    const rules = await ipc.listRules();
    set({ rules });
  },

  applyRulesToTransactions: async (onlyUncategorized = true) => {
    const res = await ipc.applyRulesToTransactions(onlyUncategorized);
    const [rules, entities] = await Promise.all([
      ipc.listRules(),
      ipc.listEntities(),
    ]);
    set({ rules, entities });
    await get().refreshLedger();
    if (res.matchedCount > 0) {
      get().setStatusBanner(
        `✓ Successfully categorized ${res.matchedCount} transaction(s) using ${res.rulesAppliedCount} active rule(s).`
      );
    } else {
      get().setStatusBanner(
        "No matching uncategorized transactions found for current rules."
      );
    }
    return res.matchedCount;
  },

  rekeyVault: async (newPassphrase) => {
    const vaultStatus = await ipc.rekeyVault(newPassphrase);
    set({
      vaultStatus,
      statusBannerMessage: vaultStatus.is_encrypted
        ? "Vault rekeyed with Argon2id + SQLCipher AES-256 encryption."
        : "Vault passphrase removed (unencrypted instant-launch mode).",
    });
  },

  run100kBenchmark: async (count = 100_000) => {
    const msg = await ipc.seedBenchmark(count);
    const accountSummaries = await ipc.listAccounts();
    const allIds = accountSummaries.map((s) => s.account.id);
    set({
      accountSummaries,
      selectedAccountIds: allIds,
      statusBannerMessage: msg,
    });
    await get().refreshLedger();
  },

  exportLedger: async (format) => {
    return ipc.exportData(format, get().selectedAccountIds);
  },

  exportVaultSnapshot: async () => {
    return ipc.exportVaultSnapshot();
  },

  importVaultSnapshot: async (jsonString) => {
    await ipc.importVaultSnapshot(jsonString);
    await get().initializeWorkspace();
    get().setStatusBanner(
      "✓ Vault snapshot restored successfully from JSON backup."
    );
  },

  resetPreviewVault: async () => {
    await ipc.resetPreviewVault();
    await get().initializeWorkspace();
    get().setStatusBanner(
      "Preview vault successfully reset to pristine default dataset."
    );
  },
}));
