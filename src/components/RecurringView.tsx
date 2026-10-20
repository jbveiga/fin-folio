import React, { useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  Repeat,
  ChevronLeft,
  ChevronRight,
  Power,
  ExternalLink,
  Check,
  X,
  Zap,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import {
  RecurrenceInterval,
  RecurringBillItem,
  RecurringBillStatus,
  RecurringSchedule,
  RecurringSummaryKpis,
} from "../types";
import { formatCents, parseCentsInput } from "../utils/money";

function formatCentsEditable(cents: number): string {
  const abs = Math.abs(Math.trunc(cents || 0));
  const euros = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, "0");
  return `${euros},${rem}`;
}

function getMonthBounds(yearMonth: string): {
  startDate: string;
  endDate: string;
  label: string;
} {
  const [yStr, mStr] = yearMonth.split("-");
  const year = Number(yStr) || 2026;
  const month = Number(mStr) || 10;
  const lastDay = new Date(year, month, 0).getDate();
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(
    lastDay
  ).padStart(2, "0")}`;
  const dateObj = new Date(year, month - 1, 1);
  const label = dateObj.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  return { startDate, endDate, label };
}

function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const [yStr, mStr] = yearMonth.split("-");
  const d = new Date(
    Number(yStr) || 2026,
    (Number(mStr) || 10) - 1 + deltaMonths,
    1
  );
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const RecurringView: React.FC = () => {
  const {
    recurringSchedules,
    transactions,
    categories,
    entities,
    accountSummaries,
    selectedAccountIds,
    saveRecurringSchedule,
    deleteRecurringSchedule,
    toggleRecurringActive,
    saveTransaction,
    setDateRange,
    setSearchQuery,
    setActiveView,
    setStatusBanner,
  } = useFinFolioStore();

  // Default to the latest transaction month (e.g. "2026-10") so seed data is immediately interactive
  const defaultYearMonth = useMemo(() => {
    if (transactions.length > 0) {
      const latest = transactions[0]?.transaction.date_posted.slice(0, 7);
      if (latest && /^\d{4}-\d{2}$/.test(latest)) {
        return latest;
      }
    }
    return "2026-10";
  }, [transactions]);

  const [selectedMonth, setSelectedMonth] = useState<string>(defaultYearMonth);
  const { startDate, endDate, label: monthLabel } = useMemo(
    () => getMonthBounds(selectedMonth),
    [selectedMonth]
  );

  // Form state for adding / editing a recurring commitment
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isExpense, setIsExpense] = useState(true);
  const [name, setName] = useState("");
  const [amountStr, setAmountStr] = useState("35,00");
  const [dayOfMonth, setDayOfMonth] = useState<number>(15);
  const [interval, setInterval] = useState<RecurrenceInterval>("Monthly");
  const [accountId, setAccountId] = useState<string>(
    selectedAccountIds[0] || accountSummaries[0]?.account.id || ""
  );
  const [categoryId, setCategoryId] = useState<string>("");
  const [entityId, setEntityId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

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

  // Compute chronological bill items and reconciliation status for `selectedMonth`
  const billItems = useMemo<RecurringBillItem[]>(() => {
    const monthTxs = transactions.filter(
      (t) =>
        t.transaction.date_posted >= startDate &&
        t.transaction.date_posted <= endDate
    );

    // Reference day in the inspected month:
    // If inspecting the seed month "2026-10", use day 20 (right after Oct 19 seed transactions)
    // so Paid (Days 18, 19), Due Soon (Day 22), and Upcoming (Days 25, 28) are all demonstrated live.
    const realNowIso = new Date().toISOString().slice(0, 7);
    const referenceDay =
      selectedMonth === "2026-10"
        ? 20
        : selectedMonth === realNowIso
        ? new Date().getDate()
        : selectedMonth < realNowIso
        ? 32
        : 0;

    return [...recurringSchedules]
      .sort((a, b) => a.day_of_month - b.day_of_month)
      .map((schedule) => {
        const cat = schedule.category_id
          ? categoryMap.get(schedule.category_id)
          : null;
        const ent = schedule.entity_id
          ? entityMap.get(schedule.entity_id)
          : null;
        const acc = schedule.account_id
          ? accountMap.get(schedule.account_id)
          : null;

        const expectedAbs = Math.abs(schedule.expected_amount_cents);
        const scheduleNameLower = schedule.name.trim().toLowerCase();
        const entNameLower = ent?.normalized_name.trim().toLowerCase() || "";

        // Find matching transaction in `monthTxs`
        const matched = monthTxs.find((item) => {
          const tx = item.transaction;
          // Must have same sign
          if (
            (schedule.expected_amount_cents < 0 && tx.total_amount_cents > 0) ||
            (schedule.expected_amount_cents > 0 && tx.total_amount_cents < 0)
          ) {
            return false;
          }

          const entityMatches =
            Boolean(schedule.entity_id) && tx.entity_id === schedule.entity_id;
          const cleanLower = tx.clean_description.trim().toLowerCase();
          const nameMatches =
            (scheduleNameLower.length >= 3 &&
              (cleanLower.includes(scheduleNameLower) ||
                scheduleNameLower.includes(cleanLower))) ||
            (entNameLower.length >= 3 && cleanLower.includes(entNameLower));

          if (!entityMatches && !nameMatches) return false;

          // Amount within 25% tolerance of expected commitment
          const txAbs = Math.abs(tx.total_amount_cents);
          if (expectedAbs === 0) return true;
          const diffRatio = Math.abs(txAbs - expectedAbs) / expectedAbs;
          return diffRatio <= 0.25;
        });

        const daysUntilDue = schedule.day_of_month - referenceDay;
        let status: RecurringBillStatus = "upcoming";
        if (matched) {
          status = "paid";
        } else if (daysUntilDue < 0) {
          status = "overdue";
        } else if (daysUntilDue <= 5) {
          status = "due_soon";
        } else {
          status = "upcoming";
        }

        const nextDueDate = `${selectedMonth}-${String(
          Math.min(31, Math.max(1, schedule.day_of_month))
        ).padStart(2, "0")}`;

        return {
          schedule,
          categoryName: cat
            ? categoryPathMap.get(cat.id) || cat.name
            : null,
          categoryColor: cat?.color_hex || null,
          entityName: ent?.normalized_name || null,
          accountName: acc?.name || null,
          status,
          matchedTransactionId: matched?.transaction.id || null,
          matchedDatePosted: matched?.transaction.date_posted || null,
          daysUntilDue,
          nextDueDate,
        };
      });
  }, [
    recurringSchedules,
    transactions,
    startDate,
    endDate,
    selectedMonth,
    categoryMap,
    entityMap,
    accountMap,
    categoryPathMap,
  ]);

  // Compute Top 3 KPI Summary Cards (using integer cents math)
  const summaryKpis = useMemo<RecurringSummaryKpis>(() => {
    let monthlyFixedCommitmentsCents = 0;
    let paidThisMonthCents = 0;
    let upcomingRemainingCents = 0;
    let activeSubscriptionsCount = 0;
    let paidCount = 0;
    let pendingCount = 0;

    for (const item of billItems) {
      if (!item.schedule.is_active) continue;
      // Normalize commitment to monthly equivalent in integer cents for the KPI card
      const rawAbs = Math.abs(item.schedule.expected_amount_cents);
      const monthlyEquivCents =
        item.schedule.recurrence_interval === "Yearly"
          ? Math.round(rawAbs / 12)
          : item.schedule.recurrence_interval === "Weekly"
          ? rawAbs * 4
          : rawAbs;

      // Focus fixed commitments KPI on expenses (or all active commitments if all positive)
      if (item.schedule.expected_amount_cents < 0) {
        monthlyFixedCommitmentsCents += monthlyEquivCents;
        activeSubscriptionsCount++;
        if (item.status === "paid") {
          paidThisMonthCents += rawAbs;
          paidCount++;
        } else {
          upcomingRemainingCents += rawAbs;
          pendingCount++;
        }
      }
    }

    return {
      monthlyFixedCommitmentsCents,
      paidThisMonthCents,
      upcomingRemainingCents,
      activeSubscriptionsCount,
      paidCount,
      pendingCount,
    };
  }, [billItems]);

  const openAddForm = () => {
    setEditingId(null);
    setIsExpense(true);
    setName("");
    setAmountStr("29,90");
    setDayOfMonth(15);
    setInterval("Monthly");
    setAccountId(
      selectedAccountIds[0] || accountSummaries[0]?.account.id || ""
    );
    setCategoryId(categories.find((c) => c.direction === "Expense")?.id || "");
    setEntityId("");
    setNotes("");
    setIsFormOpen(true);
  };

  const openEditForm = (sched: RecurringSchedule) => {
    setEditingId(sched.id);
    setIsExpense(sched.expected_amount_cents <= 0);
    setName(sched.name);
    setAmountStr(formatCentsEditable(sched.expected_amount_cents));
    setDayOfMonth(sched.day_of_month);
    setInterval(sched.recurrence_interval);
    setAccountId(
      sched.account_id ||
        selectedAccountIds[0] ||
        accountSummaries[0]?.account.id ||
        ""
    );
    setCategoryId(sched.category_id || "");
    setEntityId(sched.entity_id || "");
    setNotes(sched.notes || "");
    setIsFormOpen(true);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const rawCents = Math.abs(parseCentsInput(amountStr));
    const signedCents = isExpense ? -rawCents : rawCents;

    await saveRecurringSchedule({
      id: editingId || "",
      name: name.trim(),
      expected_amount_cents: signedCents,
      recurrence_interval: interval,
      day_of_month: Math.max(1, Math.min(31, Number(dayOfMonth) || 1)),
      account_id: accountId || null,
      category_id: categoryId || null,
      entity_id: entityId || null,
      is_active: true,
      notes: notes.trim() || null,
    });

    setStatusBanner(
      `✓ Saved recurring commitment "${name.trim()}" (${formatCents(
        signedCents,
        true
      )} on Day ${String(dayOfMonth).padStart(2, "0")}).`
    );
    setIsFormOpen(false);
    setEditingId(null);
  };

  const handleJumpToMatchedTx = async (item: RecurringBillItem) => {
    await setDateRange(startDate, endDate);
    const filterTerm = item.entityName || item.schedule.name;
    await setSearchQuery(filterTerm);
    setActiveView("ledger");
    setStatusBanner(
      `Filtered Ledger to recurring bill "${item.schedule.name}" in ${monthLabel}.`
    );
  };

  const handleRecordPaymentNow = async (item: RecurringBillItem) => {
    const targetAccId =
      item.schedule.account_id ||
      selectedAccountIds[0] ||
      accountSummaries[0]?.account.id;
    if (!targetAccId) return;

    await saveTransaction({
      id: null,
      account_id: targetAccId,
      entity_id: item.schedule.entity_id,
      entity_name: item.entityName || item.schedule.name,
      date_posted: item.nextDueDate,
      total_amount_cents: item.schedule.expected_amount_cents,
      raw_bank_string: `DD ${item.schedule.name.toUpperCase()}`,
      clean_description: item.schedule.name,
      is_reconciled: false,
      is_recurring: true,
      recurrence_interval: item.schedule.recurrence_interval,
      splits: [
        {
          category_id: item.schedule.category_id,
          transfer_peer_account_id: null,
          split_amount_cents: item.schedule.expected_amount_cents,
          notes: item.schedule.notes || `Recurring payment (${monthLabel})`,
        },
      ],
    });

    setStatusBanner(
      `✓ Recorded payment for "${item.schedule.name}" (${formatCents(
        item.schedule.expected_amount_cents,
        true
      )}) on ${item.nextDueDate}.`
    );
  };

  const settledPercent =
    summaryKpis.monthlyFixedCommitmentsCents > 0
      ? Math.min(
          100,
          Math.round(
            (summaryKpis.paidThisMonthCents /
              summaryKpis.monthlyFixedCommitmentsCents) *
              100
          )
        )
      : 0;

  return (
    <div className="h-full overflow-y-auto bg-neutral-950 p-4 md:p-6 space-y-5">
      {/* Header Bar + Month Stepper + Add Button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base md:text-lg font-bold text-white flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-purple-400" />
            <span>Recurring Expenses, Subscriptions &amp; Bills Schedule</span>
          </h1>
          <p className="text-xs text-neutral-400">
            Deterministic day-of-month commitments with automatic ledger
            reconciliation matching.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Month Stepper */}
          <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-xl p-1">
            <button
              type="button"
              onClick={() =>
                setSelectedMonth((m) => shiftYearMonth(m, -1))
              }
              title="Previous Month"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 text-xs font-semibold text-neutral-100 min-w-[125px] text-center">
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={() =>
                setSelectedMonth((m) => shiftYearMonth(m, 1))
              }
              title="Next Month"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={openAddForm}
            className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Add Recurring</span>
          </button>
        </div>
      </div>

      {/* Surface 1: 3 Top KPI Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Card 1: Total Fixed Monthly */}
        <div className="p-4 rounded-xl bg-neutral-900/90 border border-neutral-800 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Total Fixed Monthly
            </span>
            <span className="px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[10px] font-mono">
              {summaryKpis.activeSubscriptionsCount} active commitments
            </span>
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-neutral-100">
            {formatCents(summaryKpis.monthlyFixedCommitmentsCents)}
            <span className="text-xs font-normal text-neutral-400 ml-1">
              / month
            </span>
          </div>
          <div className="text-[11px] text-neutral-400">
            Baseline monthly recurring obligations across active accounts
          </div>
        </div>

        {/* Card 2: Paid This Month */}
        <div className="p-4 rounded-xl bg-neutral-900/90 border border-neutral-800 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Paid This Month
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {summaryKpis.paidCount} settled ({settledPercent}%)
            </span>
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-400">
            {formatCents(summaryKpis.paidThisMonthCents)}
          </div>
          <div className="w-full h-1.5 rounded-full bg-neutral-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${settledPercent}%` }}
            />
          </div>
        </div>

        {/* Card 3: Upcoming Remaining Due */}
        <div className="p-4 rounded-xl bg-neutral-900/90 border border-neutral-800 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Upcoming Remaining Due
            </span>
            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-mono flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {summaryKpis.pendingCount} bills pending
            </span>
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-amber-300">
            {formatCents(summaryKpis.upcomingRemainingCents)}
          </div>
          <div className="text-[11px] text-neutral-400">
            Liquidity required to cover remaining {monthLabel} commitments
          </div>
        </div>
      </div>

      {/* Add / Edit Recurring Schedule Form */}
      {isFormOpen && (
        <form
          onSubmit={(e) => void handleSaveSchedule(e)}
          className="p-4 rounded-xl bg-neutral-900 border border-emerald-500/40 shadow-xl space-y-3 text-xs"
        >
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
            <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
              <Repeat className="w-4 h-4" />
              <span>
                {editingId
                  ? "Edit Recurring Commitment"
                  : "New Recurring Commitment / Subscription"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsFormOpen(false);
                setEditingId(null);
              }}
              className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">
                Commitment / Subscription Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Renda Habitação, Vodafone, Netflix"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">
                Direction &amp; Expected Amount (€)
              </label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsExpense(true)}
                  className={`px-2 py-1.5 rounded-lg font-semibold border ${
                    isExpense
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                      : "bg-neutral-950 text-neutral-400 border-neutral-800"
                  }`}
                >
                  − Bill
                </button>
                <button
                  type="button"
                  onClick={() => setIsExpense(false)}
                  className={`px-2 py-1.5 rounded-lg font-semibold border ${
                    !isExpense
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                      : "bg-neutral-950 text-neutral-400 border-neutral-800"
                  }`}
                >
                  + Income
                </button>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 font-mono text-right text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-neutral-400 mb-1">
                  Due Day (1–31)
                </label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value) || 1)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 font-mono text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-[11px] text-neutral-400 mb-1">
                  Interval
                </label>
                <select
                  value={interval}
                  onChange={(e) =>
                    setInterval(e.target.value as RecurrenceInterval)
                  }
                  className="w-full px-2 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="Monthly">Monthly</option>
                  <option value="Yearly">Yearly</option>
                  <option value="Weekly">Weekly</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">
                Account
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">-- Any Account --</option>
                {accountSummaries.map((s) => (
                  <option key={s.account.id} value={s.account.id}>
                    {s.account.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">
                Linked Counterparty / Entity (for Auto-Matching)
              </label>
              <select
                value={entityId}
                onChange={(e) => {
                  const nextEntId = e.target.value;
                  setEntityId(nextEntId);
                  const ent = entities.find((x) => x.id === nextEntId);
                  if (ent?.default_category_id && !categoryId) {
                    setCategoryId(ent.default_category_id);
                  }
                  if (ent && !name.trim()) {
                    setName(ent.normalized_name);
                  }
                }}
                className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">-- Match by Name Pattern --</option>
                {entities.map((ent) => (
                  <option key={ent.id} value={ent.id}>
                    {ent.normalized_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">
                Category
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">-- Select Category --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryPathMap.get(c.id) || c.name} ({c.direction})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">
                Notes / Contract Reference (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Direct debit contract #..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setIsFormOpen(false);
                setEditingId(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {editingId ? "Update Schedule" : "Save Recurring Schedule"}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Surface 2: Chronological Day-of-Month Bills Schedule */}
      <div className="rounded-xl bg-neutral-900/80 border border-neutral-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Repeat className="w-4 h-4 text-purple-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-200">
              {monthLabel} Chronological Schedule (Sorted by Due Day)
            </h2>
          </div>
          <span className="text-[11px] text-neutral-400">
            Click a <strong className="text-emerald-400">Paid</strong> badge to
            inspect the matched transaction in the Ledger, or click{" "}
            <strong className="text-purple-300">Post Now</strong> to record a
            due bill.
          </span>
        </div>

        {billItems.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <CalendarClock className="w-8 h-8 text-neutral-600 mx-auto" />
            <div className="text-sm font-medium text-neutral-300">
              No recurring schedules configured yet
            </div>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">
              Add your monthly rent, electricity, water, internet, or streaming
              subscriptions to track fixed commitments and remaining due bills.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-800/80">
            {billItems.map((item) => {
              const { schedule } = item;
              const isPaused = !schedule.is_active;

              return (
                <div
                  key={schedule.id}
                  className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                    isPaused
                      ? "opacity-50 bg-neutral-950/40"
                      : "hover:bg-neutral-800/40"
                  }`}
                >
                  {/* Left: Day Badge + Name + Metadata */}
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`w-14 h-12 rounded-xl border flex flex-col items-center justify-center shrink-0 font-mono ${
                        item.status === "paid" && !isPaused
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                          : item.status === "due_soon" && !isPaused
                          ? "bg-amber-500/10 border-amber-500/40 text-amber-300"
                          : item.status === "overdue" && !isPaused
                          ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                          : "bg-neutral-950 border-neutral-800 text-neutral-300"
                      }`}
                    >
                      <span className="text-[9px] uppercase tracking-wider text-neutral-400 leading-none">
                        DAY
                      </span>
                      <span className="text-sm font-bold leading-tight mt-0.5">
                        {String(schedule.day_of_month).padStart(2, "0")}
                      </span>
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-neutral-100 truncate">
                          {schedule.name}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-[10px] font-mono text-neutral-300">
                          {schedule.recurrence_interval}
                        </span>
                        {isPaused && (
                          <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 text-[10px] font-mono">
                            PAUSED
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap text-xs text-neutral-400">
                        {item.accountName && (
                          <span className="px-1.5 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-[11px] text-neutral-300">
                            {item.accountName}
                          </span>
                        )}
                        {item.categoryName && (
                          <span className="flex items-center gap-1.5 text-[11px] text-neutral-300">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{
                                backgroundColor:
                                  item.categoryColor || "#10b981",
                              }}
                            />
                            <span>{item.categoryName}</span>
                          </span>
                        )}
                        {schedule.notes && (
                          <span className="text-[11px] text-neutral-500 truncate max-w-[240px]">
                            • {schedule.notes}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Expected Amount + Status Badge + Row Actions */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <div
                      className={`font-mono text-sm font-bold tabular-nums text-right ${
                        schedule.expected_amount_cents >= 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                      }`}
                    >
                      {formatCents(schedule.expected_amount_cents, true)}
                    </div>

                    {/* Status Badge */}
                    <div className="min-w-[138px] flex justify-end">
                      {isPaused ? (
                        <span className="px-2.5 py-1 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700 text-[11px] font-medium">
                          Paused
                        </span>
                      ) : item.status === "paid" ? (
                        <button
                          type="button"
                          onClick={() => void handleJumpToMatchedTx(item)}
                          title="Click to inspect matched transaction in Ledger"
                          className="px-2.5 py-1 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                          <span>
                            ✓ Paid{" "}
                            {item.matchedDatePosted
                              ? item.matchedDatePosted.slice(5)
                              : ""}
                          </span>
                          <ExternalLink className="w-2.5 h-2.5 ml-0.5 opacity-75" />
                        </button>
                      ) : item.status === "due_soon" ? (
                        <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[11px] font-medium flex items-center gap-1 animate-pulse">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span>
                            {item.daysUntilDue === 0
                              ? "Due Today"
                              : `Due in ${item.daysUntilDue}d`}
                          </span>
                        </span>
                      ) : item.status === "overdue" ? (
                        <span className="px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[11px] font-medium flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span>Overdue ({Math.abs(item.daysUntilDue)}d)</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full bg-neutral-800 text-neutral-300 border border-neutral-700 text-[11px] font-medium flex items-center gap-1">
                          <CalendarClock className="w-3 h-3 shrink-0 text-neutral-400" />
                          <span>Upcoming ({item.daysUntilDue}d)</span>
                        </span>
                      )}
                    </div>

                    {/* Row Actions */}
                    <div className="flex items-center gap-1">
                      {!isPaused && item.status !== "paid" && (
                        <button
                          type="button"
                          onClick={() => void handleRecordPaymentNow(item)}
                          title="Post this recurring bill payment to the Ledger for this month"
                          className="px-2 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 text-[11px] font-medium flex items-center gap-1 transition-colors"
                        >
                          <Zap className="w-3 h-3" />
                          <span className="hidden md:inline">Post Now</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditForm(schedule)}
                        title="Edit Recurring Schedule"
                        className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleRecurringActive(schedule.id)}
                        title={
                          schedule.is_active
                            ? "Pause Recurring Schedule"
                            : "Resume Recurring Schedule"
                        }
                        className={`p-1.5 rounded-lg transition-colors ${
                          schedule.is_active
                            ? "text-emerald-400 hover:bg-neutral-800"
                            : "text-neutral-500 hover:text-emerald-400 hover:bg-neutral-800"
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteRecurringSchedule(schedule.id)}
                        title="Delete Recurring Schedule"
                        className="p-1.5 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-neutral-800 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
