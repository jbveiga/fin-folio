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
  RecurringSchedule,
  ReimbursementSummary,
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
  recurringSchedules: RecurringSchedule[];

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

  // Milestone 2.2: Internal Transfers & MB WAY Reimbursements
  linkTransferPair: (sourceTxId: string, targetTxId: string) => Promise<void>;
  unlinkTransferPair: (txId: string) => Promise<void>;
  linkReimbursement: (
    childCreditTxId: string,
    parentExpenseTxId: string
  ) => Promise<void>;
  unlinkReimbursement: (childCreditTxId: string) => Promise<void>;
  createTransferWithMirror: (
    input: SaveTransactionInput,
    targetAccountId: string
  ) => Promise<void>;
  getReimbursementSummary: (parentTxId: string) => ReimbursementSummary | null;
  getCandidateReimbursementParents: (
    childCreditTxId: string
  ) => TransactionWithSplits[];
  getCandidateTransferPeers: (txId: string) => TransactionWithSplits[];

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

  // Taxonomy, Budgets, Recurring & Rules Actions
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
  saveRecurringSchedule: (schedule: RecurringSchedule) => Promise<void>;
  deleteRecurringSchedule: (id: string) => Promise<void>;
  toggleRecurringActive: (id: string) => Promise<void>;
  createRecurringFromTransaction: (txId: string) => Promise<void>;

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
  recurringSchedules: [],

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
    const [
      vaultStatus,
      accountSummaries,
      categories,
      entities,
      rules,
      recurringSchedules,
    ] = await Promise.all([
      ipc.getVaultStatus(),
      ipc.listAccounts(),
      ipc.listCategories(),
      ipc.listEntities(),
      ipc.listRules(),
      ipc.listRecurringSchedules(),
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
      recurringSchedules,
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
    const [entities, recurringSchedules] = await Promise.all([
      ipc.listEntities(),
      ipc.listRecurringSchedules(),
    ]);
    set({ entities, recurringSchedules, editingTxId: null });
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

  linkTransferPair: async (sourceTxId, targetTxId) => {
    await ipc.linkTransferPair(sourceTxId, targetTxId);
    await get().refreshLedger();
    set({
      statusBannerMessage: "✓ Symmetrically linked internal transfer pair.",
    });
  },

  unlinkTransferPair: async (txId) => {
    await ipc.unlinkTransferPair(txId);
    await get().refreshLedger();
    set({
      statusBannerMessage: "✓ Unlinked transfer pair.",
    });
  },

  linkReimbursement: async (childCreditTxId, parentExpenseTxId) => {
    await ipc.linkReimbursement(childCreditTxId, parentExpenseTxId);
    await get().refreshLedger();
    set({
      statusBannerMessage:
        "✓ Linked incoming reimbursement to parent group expense (netted category spend).",
    });
  },

  unlinkReimbursement: async (childCreditTxId) => {
    await ipc.unlinkReimbursement(childCreditTxId);
    await get().refreshLedger();
    set({
      statusBannerMessage: "✓ Unlinked reimbursement.",
    });
  },

  createTransferWithMirror: async (input, targetAccountId) => {
    await ipc.createTransferWithMirror(input, targetAccountId);
    await get().refreshLedger();
    set({
      statusBannerMessage: `✓ Created transfer and mirror credit in target account.`,
      isNewTransactionRowOpen: false,
    });
  },

  getReimbursementSummary: (parentTxId) => {
    const parent = get().transactions.find(
      (t) => t.transaction.id === parentTxId
    );
    if (!parent) return null;
    const children = get().transactions.filter(
      (t) => t.transaction.reimbursement_parent_id === parentTxId
    );
    if (children.length === 0) return null;
    const totalReimbursedCents = children.reduce(
      (acc, c) => acc + Math.max(0, c.transaction.total_amount_cents),
      0
    );
    return {
      parentTransactionId: parentTxId,
      totalReimbursedCents,
      netAmountCents:
        parent.transaction.total_amount_cents + totalReimbursedCents,
      reimbursementCount: children.length,
      childReimbursementIds: children.map((c) => c.transaction.id),
    };
  },

  getCandidateReimbursementParents: (childCreditTxId) => {
    const child = get().transactions.find(
      (t) => t.transaction.id === childCreditTxId
    );
    const childDate = child?.transaction.date_posted || "";

    return get().transactions.filter((t) => {
      // Must be an expense (negative amount)
      if (t.transaction.total_amount_cents >= 0) return false;
      // Cannot be itself
      if (t.transaction.id === childCreditTxId) return false;
      // Cannot be a transfer
      if (
        t.transaction.linked_transfer_transaction_id ||
        t.splits.some((s) => s.transfer_peer_account_id)
      ) {
        return false;
      }
      return true;
    }).sort((a, b) => {
      // Prioritize expenses close to the child credit date (e.g. past 14-30 days)
      const diffA = childDate
        ? Math.abs(new Date(childDate).getTime() - new Date(a.transaction.date_posted).getTime())
        : 0;
      const diffB = childDate
        ? Math.abs(new Date(childDate).getTime() - new Date(b.transaction.date_posted).getTime())
        : 0;
      return diffA - diffB;
    });
  },

  getCandidateTransferPeers: (txId) => {
    const target = get().transactions.find((t) => t.transaction.id === txId);
    if (!target) return [];
    const targetAmt = target.transaction.total_amount_cents;
    const targetAccId = target.transaction.account_id;
    const targetDate = target.transaction.date_posted;

    return get().transactions.filter((t) => {
      if (t.transaction.id === txId) return false;
      // Must be in a different account
      if (t.transaction.account_id === targetAccId) return false;
      // Must not be already linked to another transfer
      if (
        t.transaction.linked_transfer_transaction_id &&
        t.transaction.linked_transfer_transaction_id !== txId
      ) {
        return false;
      }
      // Signs should be opposite (one debit, one credit)
      return t.transaction.total_amount_cents * targetAmt <= 0;
    }).sort((a, b) => {
      // Exact opposite amount match comes first
      const exactA = a.transaction.total_amount_cents === -targetAmt ? 0 : 1;
      const exactB = b.transaction.total_amount_cents === -targetAmt ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;

      // Then date proximity
      const diffA = Math.abs(
        new Date(targetDate).getTime() - new Date(a.transaction.date_posted).getTime()
      );
      const diffB = Math.abs(
        new Date(targetDate).getTime() - new Date(b.transaction.date_posted).getTime()
      );
      return diffA - diffB;
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

  saveRecurringSchedule: async (schedule) => {
    await ipc.saveRecurringSchedule(schedule);
    const recurringSchedules = await ipc.listRecurringSchedules();
    set({ recurringSchedules });
  },

  deleteRecurringSchedule: async (id) => {
    await ipc.deleteRecurringSchedule(id);
    const recurringSchedules = await ipc.listRecurringSchedules();
    set({ recurringSchedules });
  },

  toggleRecurringActive: async (id) => {
    await ipc.toggleRecurringActive(id);
    const recurringSchedules = await ipc.listRecurringSchedules();
    set({ recurringSchedules });
  },

  createRecurringFromTransaction: async (txId) => {
    const item = get().transactions.find((t) => t.transaction.id === txId);
    if (!item) return;
    const { transaction: tx, splits } = item;
    const ent = tx.entity_id
      ? get().entities.find((e) => e.id === tx.entity_id)
      : undefined;
    const name = ent?.normalized_name || tx.clean_description;
    const dayOfMonth = Number(tx.date_posted.split("-")[2]) || 1;

    await ipc.saveTransaction({
      id: tx.id,
      account_id: tx.account_id,
      entity_id: tx.entity_id,
      entity_name: null,
      date_posted: tx.date_posted,
      total_amount_cents: tx.total_amount_cents,
      raw_bank_string: tx.raw_bank_string,
      clean_description: tx.clean_description,
      is_reconciled: tx.is_reconciled,
      is_recurring: true,
      recurrence_interval: "Monthly",
      splits: splits.map((s) => ({
        category_id: s.category_id,
        transfer_peer_account_id: s.transfer_peer_account_id,
        split_amount_cents: s.split_amount_cents,
        notes: s.notes,
      })),
    });

    const existingSchedule = get().recurringSchedules.find(
      (r) =>
        (tx.entity_id && r.entity_id === tx.entity_id) ||
        r.name.toLowerCase() === name.toLowerCase()
    );
    if (!existingSchedule) {
      await ipc.saveRecurringSchedule({
        id: "",
        name,
        expected_amount_cents: tx.total_amount_cents,
        recurrence_interval: "Monthly",
        day_of_month: Math.max(1, Math.min(31, dayOfMonth)),
        account_id: tx.account_id,
        category_id: splits[0]?.category_id || null,
        entity_id: tx.entity_id,
        is_active: true,
        notes: splits[0]?.notes || null,
      });
    }

    const recurringSchedules = await ipc.listRecurringSchedules();
    set({
      recurringSchedules,
      statusBannerMessage: `✓ Promoted "${name}" (Day ${String(dayOfMonth).padStart(
        2,
        "0"
      )}) to Monthly Recurring Schedule.`,
    });
    await get().refreshLedger();
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
