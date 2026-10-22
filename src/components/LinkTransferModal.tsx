import React, { useMemo, useState } from "react";
import {
  X,
  ArrowRightLeft,
  Search,
  CheckCircle2,
  Unlink,
  Info,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { TransactionWithSplits } from "../types";
import { formatCents } from "../utils/money";

interface LinkTransferModalProps {
  isOpen: boolean;
  sourceTransaction: TransactionWithSplits | null;
  onClose: () => void;
}

export const LinkTransferModal: React.FC<LinkTransferModalProps> = ({
  isOpen,
  sourceTransaction,
  onClose,
}) => {
  const {
    transactions,
    accountSummaries,
    linkTransferPair,
    unlinkTransferPair,
    getCandidateTransferPeers,
  } = useFinFolioStore();

  const [searchQuery, setSearchQuery] = useState("");

  const accountMap = useMemo(
    () => new Map(accountSummaries.map((s) => [s.account.id, s.account])),
    [accountSummaries]
  );

  const sourceTx = sourceTransaction?.transaction;

  const currentPeer = useMemo(() => {
    if (!sourceTx?.linked_transfer_transaction_id) return null;
    return (
      transactions.find(
        (t) => t.transaction.id === sourceTx.linked_transfer_transaction_id
      ) || null
    );
  }, [sourceTx, transactions]);

  const candidates = useMemo(() => {
    if (!sourceTx) return [];
    const raw = getCandidateTransferPeers(sourceTx.id);
    if (!searchQuery.trim()) {
      return raw.slice(0, 15);
    }
    const q = searchQuery.trim().toLowerCase();
    return raw.filter((item) => {
      const acc = accountMap.get(item.transaction.account_id)?.name.toLowerCase() || "";
      const desc = item.transaction.clean_description.toLowerCase();
      const rawBank = item.transaction.raw_bank_string.toLowerCase();
      const amtStr = (item.transaction.total_amount_cents / 100).toFixed(2);
      return (
        acc.includes(q) ||
        desc.includes(q) ||
        rawBank.includes(q) ||
        amtStr.includes(q)
      );
    });
  }, [sourceTx, getCandidateTransferPeers, searchQuery, accountMap]);

  if (!isOpen || !sourceTransaction || !sourceTx) return null;

  const sourceAccount = accountMap.get(sourceTx.account_id);

  const handleLink = async (targetId: string) => {
    await linkTransferPair(sourceTx.id, targetId);
    onClose();
  };

  const handleUnlink = async () => {
    await unlinkTransferPair(sourceTx.id);
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
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <ArrowRightLeft className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                Pair Internal Transfer
              </h2>
              <p className="text-[11px] text-neutral-400">
                Symmetrical Account-to-Account Asset Shift (Section 5.3)
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

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Source Card */}
          <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 flex items-center justify-between">
              <span>Source Transaction</span>
              <span className="text-sky-400 font-mono">
                {sourceAccount?.name || "Account"}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-neutral-100 truncate">
                  {sourceTx.clean_description}
                </div>
                <div className="text-xs text-neutral-400 font-mono mt-0.5">
                  {sourceTx.date_posted} • {sourceAccount?.name}
                </div>
              </div>
              <div
                className={`text-lg font-bold font-mono tabular-nums shrink-0 ${
                  sourceTx.total_amount_cents >= 0
                    ? "text-emerald-400"
                    : "text-neutral-100"
                }`}
              >
                {formatCents(sourceTx.total_amount_cents, true)}
              </div>
            </div>
          </div>

          {/* Current Linked Status Card */}
          {currentPeer && (
            <div className="p-3.5 rounded-xl bg-sky-950/20 border border-sky-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-sky-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
                  Currently Paired to Transfer Peer
                </span>
                <button
                  type="button"
                  onClick={handleUnlink}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] font-medium flex items-center gap-1 transition-colors"
                >
                  <Unlink className="w-3 h-3" />
                  <span>Unlink Pair</span>
                </button>
              </div>

              <div className="flex items-baseline justify-between text-xs">
                <div>
                  <div className="font-semibold text-neutral-100">
                    {currentPeer.transaction.clean_description}
                  </div>
                  <div className="text-[11px] text-neutral-400 font-mono">
                    {currentPeer.transaction.date_posted} • Account:{" "}
                    {accountMap.get(currentPeer.transaction.account_id)?.name || "Peer Account"}
                  </div>
                </div>
                <div className="text-right font-mono font-bold text-sky-300 text-sm">
                  {formatCents(currentPeer.transaction.total_amount_cents, true)}
                </div>
              </div>
            </div>
          )}

          {/* Candidates */}
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-semibold text-neutral-200">
                Select Matching Opposite Transaction Across Accounts
              </span>
              <div className="relative w-full sm:w-60">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter account or amount..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1 rounded-lg bg-neutral-950 border border-neutral-700 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {candidates.length === 0 ? (
                <div className="text-center py-8 text-neutral-500 text-xs bg-neutral-950/50 rounded-xl border border-neutral-800">
                  No candidate peer transactions found in other accounts.
                </div>
              ) : (
                candidates.map((item) => {
                  const pTx = item.transaction;
                  const isCurrent = currentPeer?.transaction.id === pTx.id;
                  const pAcc = accountMap.get(pTx.account_id);

                  return (
                    <div
                      key={pTx.id}
                      className={`p-3 rounded-xl border transition-colors flex items-center justify-between gap-3 text-xs ${
                        isCurrent
                          ? "bg-sky-950/20 border-sky-500/40"
                          : "bg-neutral-950/80 hover:bg-neutral-800/60 border-neutral-800"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-neutral-100 truncate">
                          {pTx.clean_description}
                        </div>
                        <div className="text-[11px] text-neutral-400 font-mono mt-0.5">
                          {pTx.date_posted} • {pAcc?.name}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="font-mono font-bold text-sm text-sky-400 tabular-nums">
                          {formatCents(pTx.total_amount_cents, true)}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleLink(pTx.id)}
                          className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-neutral-950 font-semibold text-[11px] transition-colors"
                        >
                          {isCurrent ? "Relink" : "Pair as Transfer"}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-neutral-950/70 border border-neutral-800/80 text-[11px] text-neutral-400 flex items-start gap-2">
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>Net Worth Conservation:</strong> Linking transactions as a
              transfer excludes both sides from Period Inflow and Period Outflow,
              accurately representing internal asset shifts with zero net cash
              delta.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-800 flex items-center justify-end gap-2.5 bg-neutral-950/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
