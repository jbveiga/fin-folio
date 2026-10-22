import React, { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckCircle2,
  Circle,
  GitBranch,
  Plus,
  Trash2,
  ArrowRightLeft,
  RotateCcw,
  Check,
  CheckCheck,
  Inbox,
  Sparkles,
  AlertTriangle,
  Pencil,
  Repeat,
  SearchX,
  BookOpen,
  UploadCloud,
  X,
  Undo2,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import {
  CurrencyCode,
  SaveSplitInput,
  SaveTransactionInput,
  TransactionWithSplits,
} from "../types";
import { formatCents, formatCurrency, parseCentsInput } from "../utils/money";
import { convertCurrency } from "../utils/fx";

const LinkTransferModal = React.lazy(() =>
  import("./LinkTransferModal").then((m) => ({ default: m.LinkTransferModal }))
);
const LinkReimbursementModal = React.lazy(() =>
  import("./LinkReimbursementModal").then((m) => ({
    default: m.LinkReimbursementModal,
  }))
);

function formatCentsToEditableInput(cents: number): string {
  const intVal = BigInt(Math.trunc(cents || 0));
  const isNeg = intVal < 0n;
  const absVal = isNeg ? -intVal : intVal;
  const major = absVal / 100n;
  const minor = (absVal % 100n).toString().padStart(2, "0");
  return `${isNeg ? "-" : ""}${major.toString()},${minor}`;
}

export const VirtualizedLedgerView: React.FC = () => {
  const {
    baseCurrency,
    fxRates,
    transactions,
    totalTransactionCount,
    uncategorizedCount,
    isUncategorizedFilterActive,
    selectedLedgerTxIds,
    accountSummaries,
    selectedAccountIds,
    categories,
    entities,
    recurringSchedules,
    startDate,
    endDate,
    searchQuery,
    activeLedgerRowIdx,
    editingTxId,
    expandedSplitTxIds,
    isNewTransactionRowOpen,
    setDateRange,
    setSearchQuery,
    setActiveView,
    toggleUncategorizedFilter,
    setActiveLedgerRowIdx,
    setEditingTxId,
    toggleSplitExpanded,
    toggleTransactionReconciled,
    saveTransaction,
    deleteTransaction,
    toggleSelectLedgerTx,
    selectAllLedgerTxs,
    clearSelectedLedgerTxs,
    batchAssignCategory,
    batchAssignEntity,
    batchToggleReconciled,
    batchDeleteTransactions,
    applyRulesToTransactions,
    createRecurringFromTransaction,
    createTransferWithMirror,
    getReimbursementSummary,
    setNewTransactionRowOpen,
    setStatusBanner,
  } = useFinFolioStore();

  const parentRef = useRef<HTMLDivElement>(null);
  const quickEntryEntityRef = useRef<HTMLInputElement>(null);

  // Maps for O(1) lookup in virtualized rows
  const accountMap = useMemo(
    () => new Map(accountSummaries.map((s) => [s.account.id, s.account])),
    [accountSummaries]
  );
  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );
  const entityMap = useMemo(
    () => new Map(entities.map((e) => [e.id, e])),
    [entities]
  );

  // Build hierarchical category path label (e.g. "Habitação › Serviços › Água")
  const categoryPathMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) {
      const parts = [c.name];
      let curParent = c.parent_id ? categoryMap.get(c.parent_id) : undefined;
      while (curParent) {
        parts.unshift(curParent.name);
        curParent = curParent.parent_id
          ? categoryMap.get(curParent.parent_id)
          : undefined;
      }
      map.set(c.id, parts.join(" › "));
    }
    return map;
  }, [categories, categoryMap]);

  // Manual Quick Entry Bar State (`Cmd+N`)
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [newTxAccountId, setNewTxAccountId] = useState(
    selectedAccountIds[0] || accountSummaries[0]?.account.id || ""
  );
  const [newTxDate, setNewTxDate] = useState(todayIso);
  const [newTxEntityName, setNewTxEntityName] = useState("");
  const [newTxCategoryOrTransfer, setNewTxCategoryOrTransfer] = useState("");
  const [newTxDescription, setNewTxDescription] = useState("");
  const [newTxAmountStr, setNewTxAmountStr] = useState("-25,00");
  const [newTxIsRecurring, setNewTxIsRecurring] = useState(false);
  const [newTxAutoMirror, setNewTxAutoMirror] = useState(true);

  // Link Modals State (Milestone 2.2)
  const [reimbursementModalTx, setReimbursementModalTx] =
    useState<TransactionWithSplits | null>(null);
  const [transferModalTx, setTransferModalTx] =
    useState<TransactionWithSplits | null>(null);

  // Keep default account synced when opening Quick Entry (`Cmd+N`) and focus Entity input
  useEffect(() => {
    if (isNewTransactionRowOpen) {
      const preferredAcc =
        selectedAccountIds[0] || accountSummaries[0]?.account.id || "";
      if (preferredAcc) {
        setNewTxAccountId(preferredAcc);
      }
      requestAnimationFrame(() => {
        quickEntryEntityRef.current?.focus();
        quickEntryEntityRef.current?.select();
      });
    }
  }, [isNewTransactionRowOpen, selectedAccountIds, accountSummaries]);

  // Check if typed Entity matches an existing Entity (exact or prefix match)
  const matchedQuickEntity = useMemo(() => {
    const q = newTxEntityName.trim().toLowerCase();
    if (!q) return undefined;
    return (
      entities.find((e) => e.normalized_name.toLowerCase() === q) ||
      entities.find((e) => e.normalized_name.toLowerCase().startsWith(q))
    );
  }, [newTxEntityName, entities]);

  const handleQuickEntityChange = (val: string) => {
    setNewTxEntityName(val);
    const q = val.trim().toLowerCase();
    if (!q) return;
    const match =
      entities.find((e) => e.normalized_name.toLowerCase() === q) ||
      entities.find((e) => e.normalized_name.toLowerCase().startsWith(q));
    if (match?.default_category_id) {
      setNewTxCategoryOrTransfer(match.default_category_id);
    }
  };

  // Virtualizer setup (40px row on desktop, 62px 2-line touch card on mobile, 230px when split drawer is expanded)
  const rowVirtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const txId = transactions[index]?.transaction.id;
      const isMobile =
        typeof window !== "undefined" && window.innerWidth < 768;
      if (txId && expandedSplitTxIds.includes(txId)) {
        return isMobile ? 280 : 230;
      }
      return isMobile ? 62 : 40;
    },
    overscan: 12,
  });

  const handleCreateManualTx = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetAccId =
      newTxAccountId ||
      selectedAccountIds[0] ||
      accountSummaries[0]?.account.id;
    if (!targetAccId) return;

    const amountCents = parseCentsInput(newTxAmountStr);
    const isTransfer = newTxCategoryOrTransfer.startsWith("transfer:");
    const transferPeerId = isTransfer
      ? newTxCategoryOrTransfer.replace("transfer:", "")
      : null;
    const categoryId =
      !isTransfer && newTxCategoryOrTransfer ? newTxCategoryOrTransfer : null;

    const cleanDesc =
      newTxDescription.trim() ||
      newTxEntityName.trim() ||
      (transferPeerId ? "Internal Transfer" : "Manual Entry");

    const txInput: SaveTransactionInput = {
      id: null,
      account_id: targetAccId,
      entity_id:
        matchedQuickEntity &&
        matchedQuickEntity.normalized_name.toLowerCase() ===
          newTxEntityName.trim().toLowerCase()
          ? matchedQuickEntity.id
          : null,
      entity_name: newTxEntityName.trim() || null,
      date_posted: newTxDate,
      total_amount_cents: amountCents,
      raw_bank_string: cleanDesc,
      clean_description: cleanDesc,
      is_reconciled: false,
      is_recurring: newTxIsRecurring,
      recurrence_interval: newTxIsRecurring ? "Monthly" : undefined,
      splits: [
        {
          category_id: categoryId,
          transfer_peer_account_id: transferPeerId,
          split_amount_cents: amountCents,
          notes: newTxDescription.trim() || null,
        },
      ],
    };

    if (isTransfer && transferPeerId && newTxAutoMirror) {
      await createTransferWithMirror(txInput, transferPeerId);
    } else {
      await saveTransaction(txInput);
    }

    // Rapid "Add & Next" loop: flash status banner, reset Entity/Description/Amount, keep focus on Entity
    setStatusBanner(
      `✓ ${newTxIsRecurring ? "Recurring transaction" : isTransfer ? "Transfer" : "Transaction"} saved (${formatCents(
        amountCents,
        true
      )}) — ready for next entry`
    );
    setNewTxEntityName("");
    setNewTxDescription("");
    setNewTxIsRecurring(false);
    setNewTxAmountStr("-");
    requestAnimationFrame(() => {
      quickEntryEntityRef.current?.focus();
    });
  };

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-neutral-100">
      {/* Sub-header Toolbar */}
      <div className="px-3 md:px-4 py-1.5 md:py-2 border-b border-neutral-800 bg-neutral-900/50 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <span className="font-semibold text-neutral-200 hidden sm:inline">
            Master Virtualized Ledger
          </span>
          <span className="text-neutral-400 md:text-neutral-500 font-mono text-[11px] md:text-xs">
            Showing {transactions.length.toLocaleString()} of{" "}
            {totalTransactionCount.toLocaleString()} transactions
          </span>

          {/* Task 1: Needs Categorization Inbox & Triage Pill */}
          <button
            type="button"
            onClick={() => void toggleUncategorizedFilter()}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              isUncategorizedFilterActive
                ? "bg-amber-500/25 text-amber-200 border border-amber-400/60 ring-1 ring-amber-400/40"
                : uncategorizedCount > 0
                ? "bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30"
                : "bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800"
            }`}
            title="Filter transactions needing categorization"
          >
            <Inbox className="w-3.5 h-3.5 text-amber-400" />
            <span>Needs Categorization</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/20 text-amber-300">
              {uncategorizedCount}
            </span>
          </button>

          {searchQuery && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[11px] flex items-center gap-1.5">
              <span>Filter: &ldquo;{searchQuery}&rdquo;</span>
              <button
                type="button"
                onClick={() => void setSearchQuery("")}
                title="Clear Filter"
                className="text-emerald-400 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <span className="text-[11px] text-neutral-400 hidden xl:inline">
            Shortcuts:{" "}
            <kbd className="px-1 py-0.5 bg-neutral-800 rounded font-mono text-[10px]">
              ↑/↓
            </kbd>{" "}
            Navigate •{" "}
            <kbd className="px-1 py-0.5 bg-neutral-800 rounded font-mono text-[10px]">
              Enter / DblClick
            </kbd>{" "}
            Edit Row •{" "}
            <kbd className="px-1 py-0.5 bg-neutral-800 rounded font-mono text-[10px]">
              Space
            </kbd>{" "}
            Reconcile •{" "}
            <kbd className="px-1 py-0.5 bg-neutral-800 rounded font-mono text-[10px]">
              ⌘S
            </kbd>{" "}
            Split Row •{" "}
            <kbd className="px-1 py-0.5 bg-neutral-800 rounded font-mono text-[10px]">
              ⌘N
            </kbd>{" "}
            Quick Entry
          </span>
        </div>

        {/* Mobile / Quick Select All Toggle */}
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={() => {
              if (
                transactions.length > 0 &&
                selectedLedgerTxIds.length === transactions.length
              ) {
                clearSelectedLedgerTxs();
              } else {
                selectAllLedgerTxs();
              }
            }}
            className="px-2 py-1 rounded bg-neutral-900 border border-neutral-800 text-[11px] text-neutral-300"
          >
            {transactions.length > 0 &&
            selectedLedgerTxIds.length === transactions.length
              ? "Deselect All"
              : "Select All"}
          </button>
        </div>
      </div>

      {/* Active Uncategorized Inbox Triage Banner */}
      {isUncategorizedFilterActive && (
        <div className="px-3 md:px-4 py-1.5 bg-amber-500/15 border-b border-amber-500/30 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <Inbox className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              Showing <strong>{transactions.length}</strong> transaction(s)
              needing categorization
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void applyRulesToTransactions(true)}
              className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-[11px] flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" />
              <span>⚡ Auto-Categorize with Rules</span>
            </button>
            <button
              type="button"
              onClick={() => void toggleUncategorizedFilter()}
              className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 font-medium text-[11px]"
            >
              Clear Filter
            </button>
          </div>
        </div>
      )}

      {/* Surface 2: Manual Quick Entry Bar (`Cmd+N`) with Rapid "Add & Next" Loop */}
      {isNewTransactionRowOpen && (
        <form
          onSubmit={(e) => void handleCreateManualTx(e)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setNewTransactionRowOpen(false);
            }
          }}
          className="px-4 py-2.5 bg-emerald-950/30 border-b border-emerald-500/40 ring-1 ring-inset ring-emerald-500/30 flex flex-wrap items-center gap-2 text-xs"
        >
          <span className="text-emerald-400 font-semibold shrink-0 flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" />
            NEW TX
          </span>

          <input
            type="date"
            value={newTxDate}
            onChange={(e) => setNewTxDate(e.target.value)}
            className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 font-mono text-[11px] text-white focus:ring-2 focus:ring-emerald-400 focus:outline-none"
            title="Date Posted"
          />

          <select
            value={newTxAccountId}
            onChange={(e) => setNewTxAccountId(e.target.value)}
            className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-neutral-100 focus:ring-2 focus:ring-emerald-400 focus:outline-none"
            title="Account"
          >
            {accountSummaries.map((s) => (
              <option key={s.account.id} value={s.account.id}>
                {s.account.name}
              </option>
            ))}
          </select>

          <div className="relative flex items-center">
            <input
              ref={quickEntryEntityRef}
              type="text"
              placeholder="Entity (e.g. Continente)"
              value={newTxEntityName}
              onChange={(e) => handleQuickEntityChange(e.target.value)}
              list="ledger-entities-list"
              className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 w-44 text-white focus:ring-2 focus:ring-emerald-400 focus:outline-none"
            />
            {newTxEntityName.trim() && !matchedQuickEntity && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono shrink-0">
                ✚ New Entity
              </span>
            )}
          </div>

          <select
            value={newTxCategoryOrTransfer}
            onChange={(e) => setNewTxCategoryOrTransfer(e.target.value)}
            className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 w-48 text-white focus:ring-2 focus:ring-emerald-400 focus:outline-none"
          >
            <option value="">-- Category or Transfer --</option>
            <optgroup label="Internal Transfers (Asset Shift)">
              {accountSummaries.map((s) => (
                <option key={s.account.id} value={`transfer:${s.account.id}`}>
                  ⇄ Transfer to: {s.account.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Categories">
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryPathMap.get(c.id) || c.name} ({c.direction})
                </option>
              ))}
            </optgroup>
          </select>

          <input
            type="text"
            placeholder="Description / Notes..."
            value={newTxDescription}
            onChange={(e) => setNewTxDescription(e.target.value)}
            className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 flex-1 min-w-[140px] text-white focus:ring-2 focus:ring-emerald-400 focus:outline-none"
          />

          <input
            type="text"
            placeholder="Amount (-45,50)"
            value={newTxAmountStr}
            onChange={(e) => setNewTxAmountStr(e.target.value)}
            className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 w-28 font-mono text-right text-white focus:ring-2 focus:ring-emerald-400 focus:outline-none"
          />

          <label className="flex items-center gap-1.5 px-2 py-1 rounded bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 hover:text-white cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={newTxIsRecurring}
              onChange={(e) => setNewTxIsRecurring(e.target.checked)}
              className="rounded bg-neutral-950 border-neutral-700 accent-purple-500"
            />
            <Repeat className="w-3.5 h-3.5 text-purple-400" />
            <span>Recurring</span>
          </label>

          {newTxCategoryOrTransfer.startsWith("transfer:") && (
            <label
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-sky-950/40 border border-sky-800/60 text-xs text-sky-200 hover:text-sky-100 cursor-pointer select-none shrink-0"
              title="Automatically create equal-and-opposite credit transaction in target account with mutual transfer link"
            >
              <input
                type="checkbox"
                checked={newTxAutoMirror}
                onChange={(e) => setNewTxAutoMirror(e.target.checked)}
                className="rounded bg-neutral-950 border-neutral-700 accent-sky-500"
              />
              <ArrowRightLeft className="w-3.5 h-3.5 text-sky-400" />
              <span>Auto-Mirror Credit</span>
            </label>
          )}

          <button
            type="submit"
            className="px-3 py-1 rounded bg-emerald-500 text-neutral-950 font-semibold hover:bg-emerald-400 transition-colors shrink-0"
          >
            Add & Next ↵
          </button>
          <button
            type="button"
            onClick={() => setNewTransactionRowOpen(false)}
            className="px-2 py-1 rounded text-neutral-400 hover:bg-neutral-800 shrink-0"
          >
            Cancel Esc
          </button>
        </form>
      )}

      <datalist id="ledger-entities-list">
        {entities.map((e) => (
          <option key={e.id} value={e.normalized_name} />
        ))}
      </datalist>

      {/* Grid Column Headers (Desktop >= 768px) */}
      <div className="hidden md:grid grid-cols-[32px_36px_96px_120px_160px_210px_1fr_130px_150px] items-center px-4 h-8 bg-neutral-900 border-b border-neutral-800 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 shrink-0">
        <div className="flex items-center">
          <input
            type="checkbox"
            checked={
              transactions.length > 0 &&
              selectedLedgerTxIds.length === transactions.length
            }
            onChange={() => {
              if (
                transactions.length > 0 &&
                selectedLedgerTxIds.length === transactions.length
              ) {
                clearSelectedLedgerTxs();
              } else {
                selectAllLedgerTxs();
              }
            }}
            title="Select / Deselect All Visible Transactions"
            className="w-3.5 h-3.5 rounded border-neutral-700 bg-neutral-950 accent-emerald-500 cursor-pointer"
          />
        </div>
        <div>Rec</div>
        <div>Date</div>
        <div>Account</div>
        <div>Entity</div>
        <div>Category / Transfer</div>
        <div>Description & Notes</div>
        <div className="text-right">Amount</div>
        <div className="text-right">Actions</div>
      </div>

      {/* Virtualized Viewport (`@tanstack/react-virtual`) */}
      <div ref={parentRef} className="flex-1 overflow-y-auto relative">
        {transactions.length === 0 ? (
          <div className="h-80 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-3">
              {searchQuery ||
              isUncategorizedFilterActive ||
              startDate ||
              endDate ? (
                <SearchX className="w-6 h-6 text-amber-400/90" />
              ) : (
                <BookOpen className="w-6 h-6 text-emerald-400/90" />
              )}
            </div>
            <div className="text-sm font-semibold text-neutral-200">
              {searchQuery ||
              isUncategorizedFilterActive ||
              startDate ||
              endDate
                ? "No transactions found matching active filters"
                : "No transactions recorded yet in this account"}
            </div>
            <p className="text-xs text-neutral-500 max-w-sm mt-1 mb-4 leading-relaxed">
              {searchQuery ||
              isUncategorizedFilterActive ||
              startDate ||
              endDate
                ? "Try broadening your search query, clearing the date filter, or switching active accounts."
                : "Start tracking by adding a manual transaction or importing a bank statement."}
            </p>
            {searchQuery ||
            isUncategorizedFilterActive ||
            startDate ||
            endDate ? (
              <button
                type="button"
                onClick={() => {
                  void setSearchQuery("");
                  void setDateRange("", "");
                  if (isUncategorizedFilterActive) {
                    void toggleUncategorizedFilter();
                  }
                }}
                className="px-3.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 text-xs font-medium transition-colors"
              >
                Clear All Filters
              </button>
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setNewTransactionRowOpen(true)}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-semibold text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Quick Entry (⌘N)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView("staging")}
                  className="px-3.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 font-medium text-xs flex items-center gap-1.5 transition-colors"
                >
                  <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Import Statement (⌘I)</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = transactions[virtualRow.index];
              if (!item) return null;
              const { transaction: tx, splits } = item;
              const isFocused = virtualRow.index === activeLedgerRowIdx;
              const isEditing = editingTxId === tx.id;
              const isSplitExpanded = expandedSplitTxIds.includes(tx.id);
              const account = accountMap.get(tx.account_id);
              const entity = tx.entity_id ? entityMap.get(tx.entity_id) : null;

              const primarySplit = splits[0];
              const primaryCat = primarySplit?.category_id
                ? categoryMap.get(primarySplit.category_id)
                : null;
              const transferPeer = primarySplit?.transfer_peer_account_id
                ? accountMap.get(primarySplit.transfer_peer_account_id)
                : null;

              // Section 5.3 Transfer and Reimbursement Linking
              const isTransferRow = Boolean(
                tx.linked_transfer_transaction_id ||
                transferPeer ||
                primarySplit?.transfer_peer_account_id
              );
              const linkedPeerTx = tx.linked_transfer_transaction_id
                ? transactions.find(
                    (t) => t.transaction.id === tx.linked_transfer_transaction_id
                  )
                : null;
              const linkedPeerAccount = linkedPeerTx
                ? accountMap.get(linkedPeerTx.transaction.account_id)
                : null;
              const effectiveTransferTargetName =
                transferPeer?.name || linkedPeerAccount?.name || "Account";

              const isChildReimbursement = Boolean(tx.reimbursement_parent_id);
              const parentTx = tx.reimbursement_parent_id
                ? transactions.find(
                    (t) => t.transaction.id === tx.reimbursement_parent_id
                  )
                : null;
              const parentTxDesc =
                parentTx?.transaction.clean_description || "Expense";
              const reimbursementSummary =
                tx.total_amount_cents < 0 ? getReimbursementSummary(tx.id) : null;
              const hasReimbursements = Boolean(
                reimbursementSummary && reimbursementSummary.reimbursementCount > 0
              );

              // Detect Section 5.3 "MB WAY Dinner" Expense Reimbursement:
              // Positive transaction amount assigned directly to an Expense category
              const isExpenseReimbursement =
                tx.total_amount_cents > 0 && primaryCat?.direction === "Expense";

              // Detect whether this transaction is flagged as recurring or matches an active RecurringSchedule
              const isTxRecurring =
                Boolean(tx.is_recurring) ||
                recurringSchedules.some(
                  (r) =>
                    r.is_active &&
                    ((tx.entity_id && r.entity_id === tx.entity_id) ||
                      (r.name.trim().length >= 3 &&
                        tx.clean_description
                          .toLowerCase()
                          .includes(r.name.trim().toLowerCase())))
                );

              const txCurrency: CurrencyCode =
                (account?.currency as CurrencyCode) || "EUR";
              const isForeign = txCurrency !== baseCurrency;
              const convertedBaseCents = isForeign
                ? convertCurrency(
                    tx.total_amount_cents,
                    txCurrency,
                    baseCurrency,
                    fxRates
                  )
                : tx.total_amount_cents;
              const rate = isForeign
                ? fxRates?.ratesBasisPoints?.[txCurrency] ?? 10000
                : 10000;
              const rateFormatted = (rate / 10000).toFixed(4);

              return (
                <div
                  key={tx.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => setActiveLedgerRowIdx(virtualRow.index)}
                  onDoubleClick={() => setEditingTxId(tx.id)}
                  className={`border-b border-neutral-900 transition-colors ${
                    isFocused
                      ? "bg-neutral-800/90 ring-1 ring-inset ring-emerald-500/70 shadow-sm"
                      : "hover:bg-neutral-900/60 hover:border-l-2 hover:border-l-emerald-500/50"
                  }`}
                >
                {isEditing ? (
                  <InlineRowEditForm
                    item={item}
                    initialEntityName={entity?.normalized_name || ""}
                    categoryPathMap={categoryPathMap}
                    onCancel={() => setEditingTxId(null)}
                  />
                ) : (
                  <>
                    {/* ===================================================== */}
                    {/* MOBILE 2-LINE TOUCH CARD (< 768px, min-h-[54px])      */}
                    {/* ===================================================== */}
                    <div
                      onClick={() => setEditingTxId(tx.id)}
                      className={`md:hidden min-h-[56px] pl-2.5 pr-1 py-2 flex items-center justify-between gap-2 active:bg-neutral-800/70 ${
                        selectedLedgerTxIds.includes(tx.id)
                          ? "bg-emerald-950/25"
                          : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedLedgerTxIds.includes(tx.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const shift =
                            e.nativeEvent instanceof MouseEvent &&
                            e.nativeEvent.shiftKey;
                          toggleSelectLedgerTx(tx.id, shift);
                        }}
                        aria-label="Select Transaction"
                        className="w-4 h-4 rounded border-neutral-700 bg-neutral-950 accent-emerald-500 shrink-0"
                      />

                      <div className="flex-1 min-w-0 space-y-1">
                        {/* Line 1: Counterparty / Description + Amount */}
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="font-medium text-neutral-100 text-sm truncate max-w-[65%]">
                            {entity
                              ? entity.normalized_name
                              : tx.clean_description}
                            {entity &&
                              tx.clean_description &&
                              tx.clean_description.toLowerCase() !==
                                entity.normalized_name.toLowerCase() && (
                                <span className="text-xs text-neutral-400 font-normal ml-1.5">
                                  • {tx.clean_description}
                                </span>
                              )}
                          </div>
                          <div className="text-right shrink-0">
                            <div
                              className={`font-mono text-sm font-semibold tabular-nums ${
                                isTransferRow
                                  ? "text-sky-400"
                                  : tx.total_amount_cents >= 0
                                  ? "text-emerald-400"
                                  : "text-rose-400"
                              }`}
                            >
                              {formatCurrency(tx.total_amount_cents, txCurrency, true)}
                            </div>
                            {isForeign && (
                              <div
                                className="font-mono text-[10px] text-neutral-400 font-normal flex items-center justify-end gap-1 leading-none mt-0.5"
                                title={`Rate: 1 ${txCurrency} = ${rateFormatted} ${baseCurrency} (Basis: ${rate.toLocaleString()} bp)`}
                              >
                                <span>≈ {formatCurrency(convertedBaseCents, baseCurrency)}</span>
                                <span className="text-[9px] px-1 rounded bg-neutral-800 text-neutral-400 border border-neutral-700/60 font-mono">
                                  FX
                                </span>
                              </div>
                            )}
                            {hasReimbursements && reimbursementSummary && (
                              <div className="text-[10px] font-mono text-emerald-400 font-normal">
                                Net: {formatCurrency(reimbursementSummary.netAmountCents, txCurrency, true)}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Line 2: Date + Account Tag + Clickable Category Pill */}
                        <div className="text-[11px] text-neutral-400 flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-[10px] text-neutral-400">
                            {tx.date_posted}
                          </span>
                          <span className="text-neutral-600">•</span>
                          <span className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700/80 text-[10px] text-neutral-300 truncate max-w-[110px]">
                            {account?.name || tx.account_id}
                          </span>

                          {splits.length > 1 ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSplitExpanded(tx.id);
                              }}
                              className="px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[10px] font-medium flex items-center gap-1"
                            >
                              <GitBranch className="w-2.5 h-2.5" />
                              <span>{splits.length} Splits</span>
                            </button>
                          ) : isTransferRow ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setTransferModalTx(item);
                              }}
                              className="px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-medium flex items-center gap-1 truncate max-w-[140px]"
                            >
                              <ArrowRightLeft className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate">
                                {effectiveTransferTargetName}
                              </span>
                            </button>
                          ) : isChildReimbursement ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReimbursementModalTx(item);
                              }}
                              className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-medium flex items-center gap-1 truncate max-w-[140px]"
                            >
                              <Undo2 className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate">
                                {parentTxDesc || "Reimbursement"}
                              </span>
                            </button>
                          ) : primaryCat ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const nextQuery =
                                  searchQuery.toLowerCase() ===
                                  primaryCat.name.toLowerCase()
                                    ? ""
                                    : primaryCat.name;
                                void setSearchQuery(nextQuery);
                              }}
                              className="px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700 text-[10px] text-neutral-200 flex items-center gap-1 truncate max-w-[150px]"
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor: primaryCat.color_hex,
                                }}
                              />
                              <span className="truncate">
                                {primaryCat.name}
                              </span>
                            </button>
                          ) : (
                            <span className="text-[10px] text-neutral-500 italic">
                              Uncategorized
                            </span>
                          )}

                          {tx.total_amount_cents > 0 &&
                            !isTransferRow &&
                            !isChildReimbursement && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReimbursementModalTx(item);
                                }}
                                className="px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-800/60 text-[10px] flex items-center gap-1 shrink-0"
                              >
                                <Undo2 className="w-2.5 h-2.5" />
                                <span>Link MB WAY</span>
                              </button>
                            )}

                          {isTxRecurring && (
                            <span
                              className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[10px] font-medium flex items-center gap-1 shrink-0"
                              title="Recurring Commitment"
                            >
                              <Repeat className="w-2.5 h-2.5 text-purple-400" />
                              <span>Recurring</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Generous 44x44px Reconcile Touch Target */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleTransactionReconciled(tx.id);
                        }}
                        aria-label="Toggle Reconciled"
                        className="w-11 h-11 flex items-center justify-center shrink-0 rounded-lg text-neutral-500 active:bg-neutral-800"
                      >
                        {tx.is_reconciled ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <Circle className="w-5 h-5 text-neutral-600" />
                        )}
                      </button>
                    </div>

                    {/* ===================================================== */}
                    {/* DESKTOP 9-COLUMN GRID (>= 768px)                      */}
                    {/* ===================================================== */}
                    <div
                      className={`hidden md:grid grid-cols-[32px_36px_96px_120px_160px_210px_1fr_130px_150px] items-center px-4 min-h-[40px] py-1 text-[13px] ${
                        selectedLedgerTxIds.includes(tx.id)
                          ? "bg-emerald-950/25"
                          : ""
                      }`}
                    >
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={selectedLedgerTxIds.includes(tx.id)}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectLedgerTx(tx.id, e.shiftKey);
                          }}
                          onChange={() => {}}
                          title="Select Row (Shift+Click for range)"
                          className="w-3.5 h-3.5 rounded border-neutral-700 bg-neutral-950 accent-emerald-500 cursor-pointer"
                        />
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleTransactionReconciled(tx.id);
                        }}
                        className="text-neutral-600 hover:text-emerald-400"
                        title="Reconciled (Space)"
                      >
                        {tx.is_reconciled ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Circle className="w-4 h-4" />
                        )}
                      </button>

                      <div className="font-mono text-xs text-neutral-300">
                        {tx.date_posted}
                      </div>

                      <div className="truncate pr-2">
                        <span className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-[11px] text-neutral-200 truncate">
                          {account?.name || tx.account_id}
                        </span>
                      </div>

                      <div className="font-medium text-neutral-100 truncate pr-2">
                        {entity ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextQuery =
                                searchQuery.toLowerCase() ===
                                entity.normalized_name.toLowerCase()
                                  ? ""
                                  : entity.normalized_name;
                              void setSearchQuery(nextQuery);
                            }}
                            title={`Click to filter by entity "${entity.normalized_name}"`}
                            className="hover:underline hover:text-emerald-400 cursor-pointer truncate text-left"
                          >
                            {entity.normalized_name}
                          </button>
                        ) : (
                          "—"
                        )}
                      </div>

                      <div className="truncate pr-2 flex items-center gap-1.5">
                        {splits.length > 1 ? (
                          <span className="px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[11px] font-medium flex items-center gap-1">
                            <GitBranch className="w-3 h-3" />
                            {splits.length} Splits
                          </span>
                        ) : isTransferRow ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTransferModalTx(item);
                            }}
                            className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 text-[11px] font-medium flex items-center gap-1 truncate max-w-[200px] transition-colors"
                            title={
                              tx.linked_transfer_transaction_id
                                ? `Linked Transfer: ${account?.name || "A"} ↔ ${effectiveTransferTargetName}`
                                : `Transfer → ${effectiveTransferTargetName}`
                            }
                          >
                            <ArrowRightLeft className="w-3 h-3 shrink-0" />
                            <span className="truncate">
                              Transfer → {effectiveTransferTargetName}
                            </span>
                          </button>
                        ) : isChildReimbursement ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReimbursementModalTx(item);
                            }}
                            className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 text-[11px] font-medium flex items-center gap-1 truncate max-w-[200px] transition-colors"
                            title={`Reimburses parent expense "${parentTxDesc}"`}
                          >
                            <Undo2 className="w-3 h-3 shrink-0" />
                            <span className="truncate">
                              ↩ Reimburses: {parentTxDesc}
                            </span>
                          </button>
                        ) : primaryCat ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextQuery =
                                searchQuery.toLowerCase() ===
                                primaryCat.name.toLowerCase()
                                  ? ""
                                  : primaryCat.name;
                              void setSearchQuery(nextQuery);
                            }}
                            title={`Click to filter by category "${primaryCat.name}"`}
                            className="px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700 hover:ring-1 hover:ring-emerald-400/50 cursor-pointer text-[11px] text-neutral-200 truncate flex items-center gap-1.5 transition-shadow"
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: primaryCat.color_hex }}
                            />
                            <span className="truncate">
                              {categoryPathMap.get(primaryCat.id) ||
                                primaryCat.name}
                            </span>
                          </button>
                        ) : (
                          <span className="text-xs text-neutral-500 italic">
                            Uncategorized
                          </span>
                        )}
                      </div>

                      <div className="truncate pr-3 flex items-center gap-2">
                        <span className="text-neutral-200 truncate">
                          {tx.clean_description}
                        </span>
                        {isTxRecurring && (
                          <span
                            className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[10px] font-medium flex items-center gap-1 shrink-0"
                            title="Recurring Monthly Commitment"
                          >
                            <Repeat className="w-2.5 h-2.5" />
                            <span>Recurring</span>
                          </span>
                        )}
                        {tx.total_amount_cents > 0 &&
                          !isTransferRow &&
                          !isChildReimbursement && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReimbursementModalTx(item);
                              }}
                              className="px-1.5 py-0.5 rounded bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/60 text-[10px] flex items-center gap-1 shrink-0 transition-colors"
                              title="Link as reimbursement to an earlier expense (e.g. MB WAY dinner split)"
                            >
                              <Undo2 className="w-2.5 h-2.5" />
                              <span>Link Reimbursement</span>
                            </button>
                          )}
                        {primarySplit?.notes &&
                          primarySplit.notes !== tx.clean_description && (
                            <span className="text-xs text-neutral-500 truncate">
                              • {primarySplit.notes}
                            </span>
                          )}
                        {isExpenseReimbursement && primaryCat && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] flex items-center gap-1 shrink-0">
                            <RotateCcw className="w-2.5 h-2.5" />
                            Nets {primaryCat.name} spend
                          </span>
                        )}
                      </div>

                      <div>
                        <div
                          className={`font-mono text-xs font-semibold text-right tabular-nums ${
                            isTransferRow
                              ? "text-sky-400"
                              : tx.total_amount_cents >= 0
                              ? "text-emerald-400"
                              : "text-rose-400"
                          }`}
                        >
                          {formatCurrency(tx.total_amount_cents, txCurrency, true)}
                        </div>
                        {isForeign && (
                          <div
                            className="font-mono text-[10px] text-neutral-400 font-normal flex items-center justify-end gap-1 leading-none mt-0.5"
                            title={`Rate: 1 ${txCurrency} = ${rateFormatted} ${baseCurrency} (Basis: ${rate.toLocaleString()} bp)`}
                          >
                            <span>≈ {formatCurrency(convertedBaseCents, baseCurrency)}</span>
                            <span className="text-[9px] px-1 rounded bg-neutral-800 text-neutral-400 border border-neutral-700/60 font-mono">
                              FX
                            </span>
                          </div>
                        )}
                        {hasReimbursements && reimbursementSummary && (
                          <div
                            className="text-[10px] font-mono text-emerald-400 font-normal text-right leading-none mt-0.5"
                            title={`Reimbursed: +${formatCurrency(reimbursementSummary.totalReimbursedCents, txCurrency)} across ${reimbursementSummary.reimbursementCount} payment(s)`}
                          >
                            Net: {formatCurrency(reimbursementSummary.netAmountCents, txCurrency, true)}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setTransferModalTx(item);
                          }}
                          title={
                            tx.linked_transfer_transaction_id
                              ? "Manage Transfer Pair Link"
                              : "Link to Peer Transfer Transaction"
                          }
                          className={`p-1 rounded hover:bg-neutral-700 transition-colors ${
                            tx.linked_transfer_transaction_id || isTransferRow
                              ? "text-sky-400"
                              : "text-neutral-500 hover:text-sky-300"
                          }`}
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isChildReimbursement || tx.total_amount_cents > 0) {
                              setReimbursementModalTx(item);
                            } else if (hasReimbursements && reimbursementSummary) {
                              const child = transactions.find(
                                (t) =>
                                  t.transaction.id ===
                                  reimbursementSummary.childReimbursementIds[0]
                              );
                              if (child) setReimbursementModalTx(child);
                              else setReimbursementModalTx(item);
                            } else {
                              setReimbursementModalTx(item);
                            }
                          }}
                          title={
                            isChildReimbursement
                              ? "Manage Linked Reimbursement"
                              : hasReimbursements
                              ? `View ${reimbursementSummary?.reimbursementCount} Linked Reimbursements`
                              : "Link as Reimbursement (MB WAY)"
                          }
                          className={`p-1 rounded hover:bg-neutral-700 transition-colors ${
                            isChildReimbursement || hasReimbursements
                              ? "text-emerald-400"
                              : "text-neutral-500 hover:text-emerald-300"
                          }`}
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void createRecurringFromTransaction(tx.id);
                          }}
                          title="Promote to Recurring Subscription"
                          className={`p-1 rounded hover:bg-neutral-700 ${
                            isTxRecurring
                              ? "text-purple-400"
                              : "text-neutral-500 hover:text-purple-300"
                          }`}
                        >
                          <Repeat className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTxId(tx.id);
                          }}
                          title="Edit Row (Enter / Double-Click)"
                          className="p-1 rounded text-neutral-400 hover:text-emerald-400 hover:bg-neutral-700"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSplitExpanded(tx.id);
                          }}
                          title="Split Transaction (⌘S)"
                          className={`p-1 rounded hover:bg-neutral-700 ${
                            isSplitExpanded || splits.length > 1
                              ? "text-purple-400"
                              : "text-neutral-400"
                          }`}
                        >
                          <GitBranch className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteTransaction(tx.id);
                          }}
                          title="Delete Transaction"
                          className="p-1 rounded text-neutral-500 hover:text-rose-400 hover:bg-neutral-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Inline Split Transaction Editor (`Cmd+S`, Section 5.2) */}
                {isSplitExpanded && (
                  <InlineSplitEditor
                    item={item}
                    categoryPathMap={categoryPathMap}
                    onClose={() => toggleSplitExpanded(tx.id)}
                  />
                )}
              </div>
            );
          })}
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* Task 2: Floating Batch Action Bar (appears when >= 1 tx selected) */}
      {/* ================================================================= */}
      {selectedLedgerTxIds.length > 0 && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 bg-neutral-900/95 backdrop-blur-md border border-neutral-700/80 shadow-2xl rounded-2xl px-3 md:px-4 py-2.5 flex flex-wrap items-center gap-2 md:gap-3 text-xs text-white max-w-[95vw]">
          <div className="flex items-center gap-1.5 pr-2 border-r border-neutral-800">
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-semibold">
              {selectedLedgerTxIds.length} selected
            </span>
            <button
              type="button"
              onClick={clearSelectedLedgerTxs}
              className="px-1.5 py-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800"
              title="Clear Selection"
            >
              Clear
            </button>
          </div>

          {/* Batch Assign Category Dropdown */}
          <select
            value=""
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              const catId = val === "__uncategorized__" ? null : val;
              void batchAssignCategory(selectedLedgerTxIds, catId);
            }}
            className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-100 text-xs font-medium focus:outline-none focus:border-emerald-500"
          >
            <option value="">🏷️ Assign Category...</option>
            <option value="__uncategorized__">-- Mark Uncategorized --</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryPathMap.get(c.id) || c.name} ({c.direction})
              </option>
            ))}
          </select>

          {/* Batch Assign Entity / Merchant Dropdown */}
          <select
            value=""
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              const entId = val === "__none__" ? null : val;
              void batchAssignEntity(selectedLedgerTxIds, entId);
            }}
            className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-100 text-xs font-medium focus:outline-none focus:border-emerald-500"
          >
            <option value="">🏢 Assign Merchant...</option>
            <option value="__none__">-- Clear Merchant --</option>
            {entities.map((ent) => (
              <option key={ent.id} value={ent.id}>
                {ent.normalized_name}
              </option>
            ))}
          </select>

          {/* Batch Toggle Reconciled */}
          <button
            type="button"
            onClick={() => {
              const selectedSet = new Set(selectedLedgerTxIds);
              const allCurrentlyReconciled = transactions
                .filter((t) => selectedSet.has(t.transaction.id))
                .every((t) => t.transaction.is_reconciled);
              void batchToggleReconciled(
                selectedLedgerTxIds,
                !allCurrentlyReconciled
              );
            }}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-medium flex items-center gap-1.5 transition-colors"
            title="Toggle Reconciled on Selected Rows"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>Reconcile</span>
          </button>

          {/* Batch Delete Selected */}
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  `Delete ${selectedLedgerTxIds.length} selected transaction(s)? This cannot be undone.`
                )
              ) {
                void batchDeleteTransactions(selectedLedgerTxIds);
              }
            }}
            className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 font-medium flex items-center gap-1.5 transition-colors"
            title="Delete Selected Transactions"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        </div>
      )}

      {/* Task: Link Transfer Pair Modal (Milestone 2.2) */}
      {transferModalTx && (
        <React.Suspense fallback={null}>
          <LinkTransferModal
            isOpen={Boolean(transferModalTx)}
            sourceTransaction={transferModalTx}
            onClose={() => setTransferModalTx(null)}
          />
        </React.Suspense>
      )}

      {/* Task: Link Reimbursement Modal (MB WAY Dinner) (Milestone 2.2) */}
      {reimbursementModalTx && (
        <React.Suspense fallback={null}>
          <LinkReimbursementModal
            isOpen={Boolean(reimbursementModalTx)}
            childTransaction={reimbursementModalTx}
            onClose={() => setReimbursementModalTx(null)}
          />
        </React.Suspense>
      )}
    </div>
  );
};

// =============================================================================
// Task 3: Inline Row Cell Editor (`Enter` or Double-Click on Active Row)
// =============================================================================

interface InlineRowEditFormProps {
  item: TransactionWithSplits;
  initialEntityName: string;
  categoryPathMap: Map<string, string>;
  onCancel: () => void;
}

const InlineRowEditForm: React.FC<InlineRowEditFormProps> = ({
  item,
  initialEntityName,
  categoryPathMap,
  onCancel,
}) => {
  const {
    accountSummaries,
    categories,
    entities,
    saveTransaction,
    deleteTransaction,
    toggleSplitExpanded,
    createRecurringFromTransaction,
    setStatusBanner,
  } = useFinFolioStore();
  const tx = item.transaction;
  const primarySplit = item.splits[0];

  const [datePosted, setDatePosted] = useState(tx.date_posted);
  const [accountId, setAccountId] = useState(tx.account_id);
  const [entityName, setEntityName] = useState(initialEntityName);
  const [catOrTransfer, setCatOrTransfer] = useState(() => {
    if (primarySplit?.transfer_peer_account_id) {
      return `transfer:${primarySplit.transfer_peer_account_id}`;
    }
    return primarySplit?.category_id || "";
  });
  const [description, setDescription] = useState(tx.clean_description);
  const [amountStr, setAmountStr] = useState(() =>
    formatCentsToEditableInput(tx.total_amount_cents)
  );

  const handleEntityEditChange = (val: string) => {
    setEntityName(val);
    const q = val.trim().toLowerCase();
    if (!q) return;
    const match =
      entities.find((e) => e.normalized_name.toLowerCase() === q) ||
      entities.find((e) => e.normalized_name.toLowerCase().startsWith(q));
    if (match?.default_category_id) {
      setCatOrTransfer(match.default_category_id);
    }
  };

  const handleCommitRowEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newAmountCents = parseCentsInput(amountStr);
    const matchedEntity = entities.find(
      (ent) =>
        ent.normalized_name.toLowerCase() === entityName.trim().toLowerCase()
    );

    const isTransfer = catOrTransfer.startsWith("transfer:");
    const transferPeerId = isTransfer
      ? catOrTransfer.replace("transfer:", "")
      : null;
    const categoryId = !isTransfer && catOrTransfer ? catOrTransfer : null;

    // If multi-split transaction and total amount didn't change, preserve splits; else update single split
    const updatedSplits: SaveSplitInput[] =
      item.splits.length > 1 && newAmountCents === tx.total_amount_cents
        ? item.splits.map((s) => ({
            category_id: s.category_id,
            transfer_peer_account_id: s.transfer_peer_account_id,
            split_amount_cents: s.split_amount_cents,
            notes: s.notes,
          }))
        : [
            {
              category_id: categoryId,
              transfer_peer_account_id: transferPeerId,
              split_amount_cents: newAmountCents,
              notes: primarySplit?.notes || null,
            },
          ];

    await saveTransaction({
      id: tx.id,
      account_id: accountId,
      entity_id: matchedEntity?.id || null,
      entity_name: entityName.trim() || null,
      date_posted: datePosted,
      total_amount_cents: newAmountCents,
      raw_bank_string: tx.raw_bank_string,
      clean_description: description.trim() || tx.clean_description,
      is_reconciled: tx.is_reconciled,
      is_recurring: tx.is_recurring,
      recurrence_interval: tx.recurrence_interval,
      linked_transfer_transaction_id: tx.linked_transfer_transaction_id,
      reimbursement_parent_id: tx.reimbursement_parent_id,
      splits: updatedSplits,
    });

    const targetAcc = accountSummaries.find(
      (s) => s.account.id === accountId
    )?.account;
    const accCurrency: CurrencyCode =
      (targetAcc?.currency as CurrencyCode) || "EUR";

    setStatusBanner(
      `✓ Updated transaction (${formatCurrency(newAmountCents, accCurrency, true)})`
    );
  };

  return (
    <form
      onSubmit={(e) => void handleCommitRowEdit(e)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      className="flex flex-col gap-2 p-3 md:grid md:grid-cols-[36px_96px_130px_170px_220px_1fr_130px_84px] md:items-center md:px-4 md:py-0 md:h-9 bg-neutral-900 ring-2 ring-inset ring-emerald-400 text-xs md:gap-1.5"
    >
      <div className="flex items-center justify-between md:block">
        <span className="text-emerald-400 font-mono text-[10px]">EDIT</span>
        <div className="flex items-center gap-1.5 md:hidden">
          <button
            type="button"
            onClick={() => {
              void createRecurringFromTransaction(tx.id);
              onCancel();
            }}
            className="px-2 py-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[11px] flex items-center gap-1"
          >
            <Repeat className="w-3 h-3" />
            <span>Recurring</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onCancel();
              toggleSplitExpanded(tx.id);
            }}
            className="px-2 py-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[11px] flex items-center gap-1"
          >
            <GitBranch className="w-3 h-3" />
            <span>Split</span>
          </button>
          <button
            type="button"
            onClick={() => {
              void deleteTransaction(tx.id);
              onCancel();
            }}
            className="px-2 py-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      <input
        type="date"
        value={datePosted}
        onChange={(e) => setDatePosted(e.target.value)}
        className="bg-neutral-950 ring-1 ring-emerald-400/60 text-white rounded px-2 py-1 md:px-1.5 md:py-0.5 outline-none font-mono text-[11px]"
      />

      <select
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        className="bg-neutral-950 ring-1 ring-emerald-400/60 text-white rounded px-2 py-1 md:px-1.5 md:py-0.5 outline-none text-xs md:text-[11px]"
      >
        {accountSummaries.map((s) => (
          <option key={s.account.id} value={s.account.id}>
            {s.account.name}
          </option>
        ))}
      </select>

      <input
        type="text"
        value={entityName}
        onChange={(e) => handleEntityEditChange(e.target.value)}
        list="ledger-entities-list"
        placeholder="Entity..."
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        className="bg-neutral-950 ring-2 ring-emerald-400 text-white rounded px-2 py-1 md:py-0.5 outline-none text-xs"
      />

      <select
        value={catOrTransfer}
        onChange={(e) => setCatOrTransfer(e.target.value)}
        className="bg-neutral-950 ring-1 ring-emerald-400/60 text-white rounded px-2 py-1 md:px-1.5 md:py-0.5 outline-none text-xs md:text-[11px]"
      >
        <option value="">-- Uncategorized --</option>
        <optgroup label="Internal Transfer">
          {accountSummaries.map((s) => (
            <option key={s.account.id} value={`transfer:${s.account.id}`}>
              ⇄ Transfer to {s.account.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Categories">
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {categoryPathMap.get(c.id) || c.name}
            </option>
          ))}
        </optgroup>
      </select>

      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        className="bg-neutral-950 ring-1 ring-emerald-400/60 text-white rounded px-2 py-1 md:py-0.5 outline-none text-xs"
      />

      <input
        type="text"
        inputMode="decimal"
        value={amountStr}
        onChange={(e) => setAmountStr(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        className="bg-neutral-950 ring-1 ring-emerald-400/60 text-white rounded px-2 py-1 md:py-0.5 outline-none font-mono text-xs text-right"
      />

      <div className="flex items-center justify-end gap-2 md:gap-1 pt-1 md:pt-0">
        <button
          type="submit"
          title="Commit Row Edit (Enter)"
          className="px-3 py-1.5 md:p-1 rounded bg-emerald-500 text-neutral-950 font-semibold hover:bg-emerald-400 flex items-center gap-1"
        >
          <Check className="w-3.5 h-3.5" />
          <span className="md:hidden">Save</span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          title="Cancel Edit (Esc)"
          className="px-3 py-1.5 md:p-1 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700 flex items-center gap-1"
        >
          <X className="w-3.5 h-3.5" />
          <span className="md:hidden">Cancel</span>
        </button>
      </div>
    </form>
  );
};

// =============================================================================
// Task 4: Inline Split Drawer (`Cmd+S`) with Real-Time Auto-Balance
// =============================================================================

interface InlineSplitEditorProps {
  item: TransactionWithSplits;
  categoryPathMap: Map<string, string>;
  onClose: () => void;
}

const InlineSplitEditor: React.FC<InlineSplitEditorProps> = ({
  item,
  categoryPathMap,
  onClose,
}) => {
  const { categories, accountSummaries, saveTransaction, setStatusBanner } =
    useFinFolioStore();
  const parentCents = item.transaction.total_amount_cents;

  const initialSplits = useMemo<SaveSplitInput[]>(() => {
    if (item.splits.length >= 2) {
      return item.splits.map((s) => ({
        category_id: s.category_id,
        transfer_peer_account_id: s.transfer_peer_account_id,
        split_amount_cents: s.split_amount_cents,
        notes: s.notes,
      }));
    }
    const firstHalf = Math.trunc(parentCents / 2);
    const secondRemainder = parentCents - firstHalf;
    return [
      {
        category_id: item.splits[0]?.category_id || null,
        transfer_peer_account_id: null,
        split_amount_cents: firstHalf,
        notes: item.splits[0]?.notes || "Split 1",
      },
      {
        category_id: item.splits[0]?.category_id || null,
        transfer_peer_account_id: null,
        split_amount_cents: secondRemainder,
        notes: "Split 2 (Remainder)",
      },
    ];
  }, [item.splits, parentCents]);

  const [draftSplits, setDraftSplits] =
    useState<SaveSplitInput[]>(initialSplits);
  const [amountStrings, setAmountStrings] = useState<string[]>(() =>
    initialSplits.map((s) => formatCentsToEditableInput(s.split_amount_cents))
  );

  const allocatedSum = draftSplits.reduce(
    (sum, s) => sum + s.split_amount_cents,
    0
  );
  const remainderCents = parentCents - allocatedSum;
  const isBalanced = remainderCents === 0;

  const handleAmountInputChange = (idx: number, rawValue: string) => {
    const parsedCents = parseCentsInput(rawValue);
    const nextSplits = [...draftSplits];
    const nextStrings = [...amountStrings];

    nextSplits[idx] = { ...nextSplits[idx], split_amount_cents: parsedCents };
    nextStrings[idx] = rawValue;

    // Auto-Balance Heuristic (Task 4):
    // When 2 splits exist, modifying Split 1 automatically recalculates Split 2 to `Parent - Split 1`
    if (idx === 0 && nextSplits.length === 2) {
      const autoSecondCents = parentCents - parsedCents;
      nextSplits[1] = {
        ...nextSplits[1],
        split_amount_cents: autoSecondCents,
      };
      nextStrings[1] = formatCentsToEditableInput(autoSecondCents);
    }

    setDraftSplits(nextSplits);
    setAmountStrings(nextStrings);
  };

  const handleAddSplitLine = () => {
    const newSplit: SaveSplitInput = {
      category_id: null,
      transfer_peer_account_id: null,
      split_amount_cents: remainderCents,
      notes: null,
    };
    setDraftSplits([...draftSplits, newSplit]);
    setAmountStrings([
      ...amountStrings,
      formatCentsToEditableInput(remainderCents),
    ]);
  };

  const handleRemoveSplitLine = (idx: number) => {
    setDraftSplits(draftSplits.filter((_, i) => i !== idx));
    setAmountStrings(amountStrings.filter((_, i) => i !== idx));
  };

  const targetAcc = accountSummaries.find(
    (s) => s.account.id === item.transaction.account_id
  )?.account;
  const splitCurrency: CurrencyCode =
    (targetAcc?.currency as CurrencyCode) || "EUR";

  const handleSaveSplits = async () => {
    if (!isBalanced) return;
    await saveTransaction({
      id: item.transaction.id,
      account_id: item.transaction.account_id,
      entity_id: item.transaction.entity_id,
      entity_name: null,
      date_posted: item.transaction.date_posted,
      total_amount_cents: parentCents,
      raw_bank_string: item.transaction.raw_bank_string,
      clean_description: item.transaction.clean_description,
      is_reconciled: item.transaction.is_reconciled,
      splits: draftSplits,
    });
    setStatusBanner(
      `✓ Committed ${draftSplits.length} balanced splits for ${formatCurrency(parentCents, splitCurrency)}`
    );
    onClose();
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      className={`mx-2 md:mx-8 my-2 p-3 rounded-lg bg-neutral-950 border text-xs space-y-2 ${
        isBalanced ? "border-emerald-500/40" : "border-amber-500/60"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <span className="font-semibold text-purple-300 flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5" />
            Split Allocation (Parent Amount: {formatCurrency(parentCents, splitCurrency)})
          </span>
          {isBalanced ? (
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono flex items-center gap-1">
              <Check className="w-3 h-3" />✓ Remainder: {formatCurrency(0, splitCurrency)} [Balanced]
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 font-mono flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Remaining to allocate: {formatCurrency(remainderCents, splitCurrency)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAddSplitLine}
            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Add Split Line
          </button>
          <button
            type="button"
            disabled={!isBalanced}
            onClick={() => void handleSaveSplits()}
            className={`px-3 py-1 rounded font-semibold transition-colors ${
              isBalanced
                ? "bg-emerald-500 text-neutral-950 hover:bg-emerald-400"
                : "bg-neutral-800 text-neutral-500 cursor-not-allowed"
            }`}
          >
            Commit Splits
          </button>
        </div>
      </div>

      <div className="space-y-2 md:space-y-1.5">
        {draftSplits.map((sp, idx) => (
          <div
            key={idx}
            className="flex flex-col md:grid md:grid-cols-[80px_140px_240px_1fr_32px] md:items-center gap-1.5 md:gap-2 p-2 md:p-0 rounded bg-neutral-900/50 md:bg-transparent"
          >
            <span className="text-neutral-400 font-mono">
              ├─ Split {idx + 1}:
            </span>
            <input
              type="text"
              value={amountStrings[idx] ?? ""}
              onChange={(e) => handleAmountInputChange(idx, e.target.value)}
              autoFocus={idx === 0}
              onFocus={(e) => e.currentTarget.select()}
              className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 font-mono text-right text-white focus:ring-2 focus:ring-emerald-400 focus:outline-none"
            />
            <select
              value={
                sp.transfer_peer_account_id
                  ? `transfer:${sp.transfer_peer_account_id}`
                  : sp.category_id || ""
              }
              onChange={(e) => {
                const val = e.target.value;
                const next = [...draftSplits];
                if (val.startsWith("transfer:")) {
                  next[idx] = {
                    ...next[idx],
                    category_id: null,
                    transfer_peer_account_id: val.replace("transfer:", ""),
                  };
                } else {
                  next[idx] = {
                    ...next[idx],
                    category_id: val || null,
                    transfer_peer_account_id: null,
                  };
                }
                setDraftSplits(next);
              }}
              className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-white"
            >
              <option value="">-- Select Category --</option>
              <optgroup label="Internal Transfer">
                {accountSummaries.map((s) => (
                  <option key={s.account.id} value={`transfer:${s.account.id}`}>
                    ⇄ Transfer to {s.account.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Categories">
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryPathMap.get(c.id) || c.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <input
              type="text"
              placeholder="Split notes..."
              value={sp.notes || ""}
              onChange={(e) => {
                const next = [...draftSplits];
                next[idx] = { ...next[idx], notes: e.target.value };
                setDraftSplits(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isBalanced) {
                  e.preventDefault();
                  void handleSaveSplits();
                }
              }}
              className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-white"
            />
            {draftSplits.length > 1 && (
              <button
                type="button"
                onClick={() => handleRemoveSplitLine(idx)}
                className="text-neutral-500 hover:text-rose-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
