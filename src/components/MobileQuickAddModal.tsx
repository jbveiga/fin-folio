import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Check, Repeat } from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { formatCents, parseCentsInput } from "../utils/money";

interface MobileQuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MobileQuickAddModal: React.FC<MobileQuickAddModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    accountSummaries,
    selectedAccountIds,
    categories,
    entities,
    saveTransaction,
    setStatusBanner,
    setActiveView,
  } = useFinFolioStore();

  const amountInputRef = useRef<HTMLInputElement>(null);
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [isExpense, setIsExpense] = useState(true);
  const [amountStr, setAmountStr] = useState("25,00");
  const [entityName, setEntityName] = useState("");
  const [categoryOrTransfer, setCategoryOrTransfer] = useState("");
  const [accountId, setAccountId] = useState("");
  const [datePosted, setDatePosted] = useState(todayIso);
  const [description, setDescription] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);

  const categoryPathMap = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c]));
    const pathMap = new Map<string, string>();
    for (const c of categories) {
      const parts = [c.name];
      let curParent = c.parent_id ? map.get(c.parent_id) : undefined;
      while (curParent) {
        parts.unshift(curParent.name);
        curParent = curParent.parent_id
          ? map.get(curParent.parent_id)
          : undefined;
      }
      pathMap.set(c.id, parts.join(" › "));
    }
    return pathMap;
  }, [categories]);

  useEffect(() => {
    if (isOpen) {
      const defaultAcc =
        selectedAccountIds[0] || accountSummaries[0]?.account.id || "";
      setAccountId(defaultAcc);
      setDatePosted(new Date().toISOString().slice(0, 10));
      requestAnimationFrame(() => {
        amountInputRef.current?.focus();
        amountInputRef.current?.select();
      });
    }
  }, [isOpen, selectedAccountIds, accountSummaries]);

  if (!isOpen) return null;

  const handleEntityChange = (val: string) => {
    setEntityName(val);
    const q = val.trim().toLowerCase();
    if (!q) return;
    const match =
      entities.find((e) => e.normalized_name.toLowerCase() === q) ||
      entities.find((e) => e.normalized_name.toLowerCase().startsWith(q));
    if (match?.default_category_id) {
      setCategoryOrTransfer(match.default_category_id);
      const cat = categories.find((c) => c.id === match.default_category_id);
      if (cat) {
        setIsExpense(cat.direction === "Expense");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetAccId =
      accountId || selectedAccountIds[0] || accountSummaries[0]?.account.id;
    if (!targetAccId) return;

    const rawCents = Math.abs(parseCentsInput(amountStr));
    const signedCents = isExpense ? -rawCents : rawCents;

    const isTransfer = categoryOrTransfer.startsWith("transfer:");
    const transferPeerId = isTransfer
      ? categoryOrTransfer.replace("transfer:", "")
      : null;
    const categoryId =
      !isTransfer && categoryOrTransfer ? categoryOrTransfer : null;

    const matchedEntity = entities.find(
      (ent) =>
        ent.normalized_name.toLowerCase() === entityName.trim().toLowerCase()
    );

    const cleanDesc =
      description.trim() ||
      entityName.trim() ||
      (transferPeerId ? "Internal Transfer" : "Manual Entry");

    await saveTransaction({
      id: null,
      account_id: targetAccId,
      entity_id: matchedEntity?.id || null,
      entity_name: entityName.trim() || null,
      date_posted: datePosted,
      total_amount_cents: signedCents,
      raw_bank_string: cleanDesc,
      clean_description: cleanDesc,
      is_reconciled: false,
      is_recurring: isRecurring,
      recurrence_interval: isRecurring ? "Monthly" : undefined,
      splits: [
        {
          category_id: categoryId,
          transfer_peer_account_id: transferPeerId,
          split_amount_cents: signedCents,
          notes: description.trim() || null,
        },
      ],
    });

    setStatusBanner(
      `✓ Saved ${isRecurring ? "recurring " : ""}transaction (${formatCents(
        signedCents,
        true
      )})`
    );
    setActiveView("ledger");
    setEntityName("");
    setDescription("");
    setIsRecurring(false);
    setAmountStr("0,00");
    onClose();
  };

  return (
    <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/75 backdrop-blur-xs">
      <div className="flex-1" onClick={onClose} />

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="bg-neutral-900 border-t border-neutral-800 rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-3 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Plus className="w-4 h-4" />
            </span>
            <h2 className="text-sm font-semibold text-white">
              New Transaction
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full bg-neutral-800 text-neutral-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Expense / Income Toggle + Large Numeric Keypad Amount */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-neutral-950 rounded-xl border border-neutral-800">
            <button
              type="button"
              onClick={() => setIsExpense(true)}
              className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                isExpense
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                  : "text-neutral-400"
              }`}
            >
              − Expense / Outflow
            </button>
            <button
              type="button"
              onClick={() => setIsExpense(false)}
              className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                !isExpense
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : "text-neutral-400"
              }`}
            >
              + Income / Inflow
            </button>
          </div>

          <div className="relative flex items-center bg-neutral-950 border border-neutral-700 focus-within:border-emerald-500 rounded-xl px-3.5 py-2.5">
            <span
              className={`font-mono text-xl font-bold mr-2 ${
                isExpense ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              {isExpense ? "− €" : "+ €"}
            </span>
            <input
              ref={amountInputRef}
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className={`w-full bg-transparent font-mono text-2xl font-bold text-right focus:outline-none tabular-nums ${
                isExpense ? "text-rose-400" : "text-emerald-400"
              }`}
            />
          </div>
        </div>

        {/* Entity / Counterparty */}
        <div>
          <label className="block text-[11px] font-medium text-neutral-400 mb-1">
            Entity / Counterparty
          </label>
          <input
            type="text"
            placeholder="Merchant or Counterparty (e.g. Continente)"
            value={entityName}
            onChange={(e) => handleEntityChange(e.target.value)}
            list="mobile-entities-datalist"
            className="w-full px-3 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-sm text-white focus:outline-none focus:border-emerald-500"
          />
          <datalist id="mobile-entities-datalist">
            {entities.map((e) => (
              <option key={e.id} value={e.normalized_name} />
            ))}
          </datalist>
        </div>

        {/* Category or Transfer */}
        <div>
          <label className="block text-[11px] font-medium text-neutral-400 mb-1">
            Category or Transfer
          </label>
          <select
            value={categoryOrTransfer}
            onChange={(e) => setCategoryOrTransfer(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-sm text-white focus:outline-none focus:border-emerald-500"
          >
            <option value="">-- Select Category / Transfer --</option>
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
        </div>

        {/* Account & Date Row */}
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 mb-1">
              Account
            </label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-sm text-white focus:outline-none focus:border-emerald-500"
            >
              {accountSummaries.map((s) => (
                <option key={s.account.id} value={s.account.id}>
                  {s.account.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 mb-1">
              Date
            </label>
            <input
              type="date"
              value={datePosted}
              onChange={(e) => setDatePosted(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-sm font-mono text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Notes / Description */}
        <div>
          <label className="block text-[11px] font-medium text-neutral-400 mb-1">
            Description / Notes (Optional)
          </label>
          <input
            type="text"
            placeholder="Add a note..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-sm text-white focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Recurring Toggle */}
        <label className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-neutral-200 cursor-pointer select-none">
          <span className="flex items-center gap-2">
            <Repeat className="w-4 h-4 text-purple-400" />
            <span>Recurring Monthly Commitment / Subscription</span>
          </span>
          <input
            type="checkbox"
            checked={isRecurring}
            onChange={(e) => setIsRecurring(e.target.checked)}
            className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 accent-purple-500"
          />
        </label>

        <button
          type="submit"
          className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-neutral-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all"
        >
          <Check className="w-4 h-4 stroke-[2.5]" />
          <span>Save Transaction</span>
        </button>
      </form>
    </div>
  );
};
