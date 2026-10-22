import React, { useMemo, useState } from "react";
import {
  X,
  Undo2,
  Search,
  CheckCircle2,
  Unlink,
  ArrowRight,
  TrendingDown,
  Info,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { TransactionWithSplits } from "../types";
import { formatCents } from "../utils/money";

interface LinkReimbursementModalProps {
  isOpen: boolean;
  childTransaction: TransactionWithSplits | null;
  onClose: () => void;
}

export const LinkReimbursementModal: React.FC<LinkReimbursementModalProps> = ({
  isOpen,
  childTransaction,
  onClose,
}) => {
  const {
    transactions,
    categories,
    entities,
    accountSummaries,
    linkReimbursement,
    unlinkReimbursement,
    getCandidateReimbursementParents,
    getReimbursementSummary,
  } = useFinFolioStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );
  const entityMap = useMemo(
    () => new Map(entities.map((e) => [e.id, e])),
    [entities]
  );
  const accountMap = useMemo(
    () => new Map(accountSummaries.map((s) => [s.account.id, s.account])),
    [accountSummaries]
  );

  const childTx = childTransaction?.transaction;

  // Determine if this child transaction is currently linked to a parent expense
  const currentParent = useMemo(() => {
    if (!childTx?.reimbursement_parent_id) return null;
    return (
      transactions.find(
        (t) => t.transaction.id === childTx.reimbursement_parent_id
      ) || null
    );
  }, [childTx, transactions]);

  // Candidate parents from store
  const candidates = useMemo(() => {
    if (!childTx) return [];
    const raw = getCandidateReimbursementParents(childTx.id);
    if (!searchQuery.trim()) {
      return raw.slice(0, 15);
    }
    const q = searchQuery.trim().toLowerCase();
    return raw.filter((item) => {
      const entName = item.transaction.entity_id
        ? entityMap.get(item.transaction.entity_id)?.normalized_name.toLowerCase() || ""
        : "";
      const desc = item.transaction.clean_description.toLowerCase();
      const rawBank = item.transaction.raw_bank_string.toLowerCase();
      const amtStr = (item.transaction.total_amount_cents / 100).toFixed(2);
      return (
        entName.includes(q) ||
        desc.includes(q) ||
        rawBank.includes(q) ||
        amtStr.includes(q)
      );
    });
  }, [childTx, getCandidateReimbursementParents, searchQuery, entityMap]);

  if (!isOpen || !childTransaction || !childTx) return null;

  const childAccount = accountMap.get(childTx.account_id);
  const childEntity = childTx.entity_id ? entityMap.get(childTx.entity_id) : null;
  const childMerchant =
    childEntity?.normalized_name || childTx.clean_description || "Credit Reimbursement";

  const handleConfirmLink = async (targetParentId: string) => {
    await linkReimbursement(childTx.id, targetParentId);
    onClose();
  };

  const handleUnlink = async () => {
    await unlinkReimbursement(childTx.id);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 md:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-neutral-900 border border-neutral-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Undo2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                Link Expense Reimbursement
              </h2>
              <p className="text-[11px] text-neutral-400">
                The "MB WAY Dinner" Netting Model (Section 5.3)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Surface 1: Current Incoming Credit Card */}
          <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 flex items-center justify-between">
              <span>Incoming Payment (Reimbursement Credit)</span>
              <span className="text-emerald-400 font-mono">
                {childAccount?.name || "Account"}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-neutral-100 truncate">
                  {childMerchant}
                </div>
                <div className="text-xs text-neutral-400 font-mono mt-0.5">
                  {childTx.date_posted} • {childTx.clean_description}
                </div>
              </div>
              <div className="text-lg font-bold font-mono text-emerald-400 tabular-nums shrink-0">
                +{formatCents(childTx.total_amount_cents, true)}
              </div>
            </div>
          </div>

          {/* Current Linked Status Card (if already linked) */}
          {currentParent && (
            <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Currently Linked to Parent Expense
                </span>
                <button
                  type="button"
                  onClick={handleUnlink}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] font-medium flex items-center gap-1 transition-colors"
                >
                  <Unlink className="w-3 h-3" />
                  <span>Unlink</span>
                </button>
              </div>

              <div className="flex items-baseline justify-between text-xs">
                <div>
                  <div className="font-semibold text-neutral-100">
                    {currentParent.transaction.clean_description}
                  </div>
                  <div className="text-[11px] text-neutral-400 font-mono">
                    {currentParent.transaction.date_posted} • Original Expense:{" "}
                    {formatCents(currentParent.transaction.total_amount_cents)}
                  </div>
                </div>
                {(() => {
                  const summary = getReimbursementSummary(currentParent.transaction.id);
                  return (
                    <div className="text-right font-mono">
                      <div className="text-emerald-400 font-bold">
                        Net Spend: {formatCents(summary?.netAmountCents || currentParent.transaction.total_amount_cents)}
                      </div>
                      <div className="text-[10px] text-neutral-400">
                        Total Reimbursed: +{formatCents(summary?.totalReimbursedCents || 0)}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Surface 2: Candidate Expenses Selection */}
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-semibold text-neutral-200">
                Select Original Group Expense to Reimburse
              </span>
              <div className="relative w-full sm:w-60">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter by merchant or amount..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1 rounded-lg bg-neutral-950 border border-neutral-700 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Candidate List */}
            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {candidates.length === 0 ? (
                <div className="text-center py-8 text-neutral-500 text-xs bg-neutral-950/50 rounded-xl border border-neutral-800">
                  No candidate expense transactions found matching query.
                </div>
              ) : (
                candidates.map((item) => {
                  const pTx = item.transaction;
                  const isCurrent = currentParent?.transaction.id === pTx.id;
                  const isSelected = selectedParentId === pTx.id;
                  const summary = getReimbursementSummary(pTx.id);
                  const currentReimbursed = summary?.totalReimbursedCents || 0;
                  const existingNet = pTx.total_amount_cents + currentReimbursed;
                  // If we link this child, the new net amount will be:
                  const newNet = existingNet + childTx.total_amount_cents;

                  const pEnt = pTx.entity_id ? entityMap.get(pTx.entity_id) : null;
                  const pCat = item.splits[0]?.category_id
                    ? categoryMap.get(item.splits[0].category_id)
                    : null;
                  const pAcc = accountMap.get(pTx.account_id);

                  return (
                    <div
                      key={pTx.id}
                      onClick={() => setSelectedParentId(pTx.id)}
                      className={`p-3 rounded-xl border transition-colors cursor-pointer text-xs space-y-2 ${
                        isCurrent
                          ? "bg-emerald-950/20 border-emerald-500/40"
                          : isSelected
                          ? "bg-neutral-800/90 border-emerald-500 ring-1 ring-emerald-500"
                          : "bg-neutral-950/80 hover:bg-neutral-800/60 border-neutral-800"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-neutral-100 truncate">
                              {pEnt?.normalized_name || pTx.clean_description}
                            </span>
                            {pCat && (
                              <span
                                className="px-2 py-0.5 rounded-full text-[10px] font-medium border"
                                style={{
                                  backgroundColor: `${pCat.color_hex}15`,
                                  borderColor: `${pCat.color_hex}40`,
                                  color: pCat.color_hex,
                                }}
                              >
                                {pCat.name}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-neutral-400 font-mono mt-0.5">
                            {pTx.date_posted} • {pAcc?.name || "Account"} • {pTx.clean_description}
                          </div>
                        </div>

                        <div className="text-right font-mono shrink-0">
                          <div className="font-bold text-rose-400 text-sm">
                            {formatCents(pTx.total_amount_cents)}
                          </div>
                        </div>
                      </div>

                      {/* Netting Projection Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-neutral-800/80 text-[11px] font-mono">
                        <div className="text-neutral-400 flex items-center gap-1.5">
                          <TrendingDown className="w-3.5 h-3.5 text-neutral-500" />
                          <span>Current Reimbursed: +{formatCents(currentReimbursed)}</span>
                          <ArrowRight className="w-3 h-3 text-neutral-600" />
                          <span className="text-emerald-400 font-bold">
                            New Net: {formatCents(newNet)}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleConfirmLink(pTx.id);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-semibold text-[11px] transition-colors"
                        >
                          {isCurrent ? "Relink" : "Link Reimbursement"}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Section 5.3 Educational Note */}
          <div className="p-3 rounded-xl bg-neutral-950/70 border border-neutral-800/80 text-[11px] text-neutral-400 flex items-start gap-2">
            <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>Zero-Inflation Guarantee:</strong> Linking this credit
              offsets the parent expense in Analytics and Category Budgets directly.
              It does not record artificial income and maintains zero-float
              integer cents math.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-neutral-800 flex items-center justify-end gap-2.5 bg-neutral-950/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 text-xs font-medium transition-colors"
          >
            Cancel
          </button>
          {selectedParentId && (
            <button
              type="button"
              onClick={() => void handleConfirmLink(selectedParentId)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-semibold text-xs transition-colors shadow-sm"
            >
              Confirm Reimbursement Link
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
