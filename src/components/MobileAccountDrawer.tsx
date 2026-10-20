import React, { useState } from "react";
import {
  CheckSquare,
  Square,
  Plus,
  Pencil,
  X,
  UploadCloud,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { AccountType } from "../types";
import { formatCents, parseCentsInput } from "../utils/money";

interface MobileAccountDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MobileAccountDrawer: React.FC<MobileAccountDrawerProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    accountSummaries,
    selectedAccountIds,
    toggleAccountSelection,
    selectAllAccounts,
    selectSingleAccount,
    saveAccount,
    setActiveView,
  } = useFinFolioStore();

  const [isEditingOrAdding, setIsEditingOrAdding] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accName, setAccName] = useState("");
  const [accType, setAccType] = useState<AccountType>("Checking");
  const [accAnchorStr, setAccAnchorStr] = useState("1000,00");
  const [accAnchorDate, setAccAnchorDate] = useState("2026-10-20");
  const [accIncludeTotals, setAccIncludeTotals] = useState(true);

  if (!isOpen) return null;

  const selectedBalanceCents = accountSummaries
    .filter((s) => selectedAccountIds.includes(s.account.id))
    .reduce((acc, s) => acc + s.current_balance_cents, 0);

  const totalNetWorthCents = accountSummaries
    .filter((s) => s.account.is_included_in_totals)
    .reduce((acc, s) => acc + s.current_balance_cents, 0);

  const allSelected =
    accountSummaries.length > 0 &&
    selectedAccountIds.length === accountSummaries.length;

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName.trim()) return;
    await saveAccount({
      id: editingAccountId || "",
      name: accName.trim(),
      account_type: accType,
      anchor_balance_cents: parseCentsInput(accAnchorStr),
      anchor_date: accAnchorDate,
      is_included_in_totals: accIncludeTotals,
    });
    setAccName("");
    setEditingAccountId(null);
    setIsEditingOrAdding(false);
  };

  return (
    <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-xs">
      {/* Backdrop tap to dismiss */}
      <div className="flex-1" onClick={onClose} />

      {/* Slide-up Sheet */}
      <div className="bg-neutral-900 border-t border-neutral-800 rounded-t-2xl max-h-[82vh] flex flex-col pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
        {/* Drag handle & Header */}
        <div className="pt-2.5 pb-3 px-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold text-white">
              Accounts &amp; Balances
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-full bg-neutral-800 text-xs font-medium text-neutral-200 active:bg-neutral-700"
          >
            Done
          </button>
        </div>

        {/* Aggregated Balance Banner */}
        <div className="px-4 py-3 bg-neutral-950/70 border-b border-neutral-800/80 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
              Selected ({selectedAccountIds.length})
            </div>
            <div
              className={`text-base font-bold font-mono tabular-nums ${
                selectedBalanceCents >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {formatCents(selectedBalanceCents)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
              Total Net Worth
            </div>
            <div className="text-base font-bold font-mono tabular-nums text-neutral-100">
              {formatCents(totalNetWorthCents)}
            </div>
          </div>
        </div>

        {/* Account List & Controls */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Active Filter Selection
            </span>
            <button
              type="button"
              onClick={() => void selectAllAccounts()}
              className="text-xs text-emerald-400 font-medium"
            >
              {allSelected ? "All Accounts Selected" : "Select All Accounts"}
            </button>
          </div>

          <div className="space-y-2">
            {accountSummaries.map((summary) => {
              const { account, current_balance_cents } = summary;
              const isChecked = selectedAccountIds.includes(account.id);
              return (
                <div
                  key={account.id}
                  onClick={() => void toggleAccountSelection(account.id)}
                  className={`min-h-[54px] px-3 py-2 rounded-xl border flex items-center justify-between transition-colors ${
                    isChecked
                      ? "bg-neutral-800/90 border-neutral-700 text-neutral-100"
                      : "bg-neutral-950/50 border-neutral-800/60 text-neutral-400"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-emerald-400 shrink-0">
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4 text-neutral-600" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {account.name}
                      </div>
                      <div className="text-[11px] text-neutral-400 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-neutral-900 text-[10px] font-mono">
                          {account.account_type}
                        </span>
                        <span>Anchor {account.anchor_date}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <div className="text-right">
                      <div
                        className={`font-mono text-sm font-semibold tabular-nums ${
                          current_balance_cents >= 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }`}
                      >
                        {formatCents(current_balance_cents)}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void selectSingleAccount(account.id);
                        }}
                        className="text-[10px] text-neutral-400 underline"
                      >
                        Solo
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingAccountId(account.id);
                        setAccName(account.name);
                        setAccType(account.account_type);
                        setAccAnchorStr(
                          (account.anchor_balance_cents / 100)
                            .toFixed(2)
                            .replace(".", ",")
                        );
                        setAccAnchorDate(account.anchor_date);
                        setAccIncludeTotals(account.is_included_in_totals);
                        setIsEditingOrAdding(true);
                      }}
                      title="Edit Account & Calibrate Balance"
                      className="w-9 h-9 rounded-lg bg-neutral-900 border border-neutral-700/80 flex items-center justify-center text-neutral-300 active:bg-neutral-700"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add / Edit Account Form */}
          {!isEditingOrAdding ? (
            <button
              type="button"
              onClick={() => {
                setEditingAccountId(null);
                setAccName("");
                setAccAnchorStr("1000,00");
                setIsEditingOrAdding(true);
              }}
              className="w-full py-2.5 px-3 rounded-xl border border-dashed border-neutral-700 text-xs font-medium text-neutral-300 flex items-center justify-center gap-1.5 active:bg-neutral-800"
            >
              <Plus className="w-4 h-4 text-emerald-400" />
              <span>Add Account &amp; Anchor Balance</span>
            </button>
          ) : (
            <form
              onSubmit={(e) => void handleSaveAccount(e)}
              className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2.5 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-neutral-200">
                  {editingAccountId
                    ? "Edit Account & Anchor"
                    : "New Account & Anchor"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingOrAdding(false);
                    setEditingAccountId(null);
                  }}
                  className="text-neutral-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                type="text"
                placeholder="Account Name (e.g. BPI Ordem)"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-white text-sm"
                autoFocus
              />
              <select
                value={accType}
                onChange={(e) => setAccType(e.target.value as AccountType)}
                className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-white text-sm"
              >
                <option value="Checking">Checking</option>
                <option value="Savings">Savings</option>
                <option value="CreditCard">Credit Card</option>
                <option value="Cash">Cash</option>
                <option value="MealCard">Meal Card</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-neutral-400">
                    Anchor Balance (€)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={accAnchorStr}
                    onChange={(e) => setAccAnchorStr(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-white font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-neutral-400">
                    Anchor Date
                  </label>
                  <input
                    type="date"
                    value={accAnchorDate}
                    onChange={(e) => setAccAnchorDate(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-white font-mono text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-neutral-300 py-1">
                <input
                  type="checkbox"
                  checked={accIncludeTotals}
                  onChange={(e) => setAccIncludeTotals(e.target.checked)}
                  className="rounded border-neutral-700 bg-neutral-900 text-emerald-500"
                />
                <span>Include in net worth totals</span>
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingOrAdding(false);
                    setEditingAccountId(null);
                  }}
                  className="px-3 py-2 rounded-lg text-neutral-400 bg-neutral-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-500 text-neutral-950 font-semibold"
                >
                  Save Account
                </button>
              </div>
            </form>
          )}

          {/* Secondary Mobile Navigation Shortcuts (Import & Rules) */}
          <div className="pt-2 border-t border-neutral-800 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveView("staging");
                onClose();
              }}
              className="py-2.5 px-3 rounded-xl bg-neutral-800/80 border border-neutral-700 text-xs font-medium text-neutral-200 flex items-center justify-center gap-1.5"
            >
              <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
              <span>Import Statement</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveView("rules");
                onClose();
              }}
              className="py-2.5 px-3 rounded-xl bg-neutral-800/80 border border-neutral-700 text-xs font-medium text-neutral-200 flex items-center justify-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>Import Rules</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
