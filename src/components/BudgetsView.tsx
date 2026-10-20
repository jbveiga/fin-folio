import React, { useMemo, useState } from "react";
import {
  Target,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Check,
  X,
  AlertTriangle,
  ShieldCheck,
  TrendingDown,
  Wallet,
  ArrowUpRight,
  Plus,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { BudgetSummary, Category, CategoryBudgetProgress } from "../types";
import { formatCents, parseCentsInput } from "../utils/money";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatBudgetCentsToInput(cents: number): string {
  const intVal = BigInt(Math.max(0, Math.trunc(cents || 0)));
  const major = intVal / 100n;
  const minor = (intVal % 100n).toString().padStart(2, "0");
  return `${major.toString()},${minor}`;
}

export const BudgetsView: React.FC = () => {
  const {
    categories,
    transactions,
    accountSummaries,
    selectedAccountIds,
    startDate,
    endDate,
    setDateRange,
    setCategoryBudget,
    setSearchQuery,
    setActiveView,
    setStatusBanner,
  } = useFinFolioStore();

  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [draftBudgetStr, setDraftBudgetStr] = useState("200,00");

  // Parse active month from startDate (or default to 2026-10 / current calendar month)
  const activeYearMonth = useMemo(() => {
    if (startDate && /^\d{4}-\d{2}/.test(startDate)) {
      const [y, m] = startDate.slice(0, 7).split("-").map(Number);
      if (y && m >= 1 && m <= 12) {
        return { year: y, monthZero: m - 1 };
      }
    }
    const now = new Date();
    return { year: now.getFullYear(), monthZero: now.getMonth() };
  }, [startDate]);

  const handleStepMonth = (delta: number) => {
    const d = new Date(activeYearMonth.year, activeYearMonth.monthZero + delta, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    const startIso = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const endIso = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    void setDateRange(startIso, endIso);
  };

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
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

  // Compute CategoryBudgetProgress[] and BudgetSummary in integer cents (zero-float)
  const { budgetedList, unbudgetedList, summary } = useMemo(() => {
    const spendByCat = new Map<
      string,
      { signedCents: number; txIds: Set<string> }
    >();

    for (const item of transactions) {
      for (const sp of item.splits) {
        if (sp.transfer_peer_account_id || !sp.category_id) continue;
        const existing = spendByCat.get(sp.category_id);
        if (existing) {
          existing.signedCents += sp.split_amount_cents;
          existing.txIds.add(item.transaction.id);
        } else {
          spendByCat.set(sp.category_id, {
            signedCents: sp.split_amount_cents,
            txIds: new Set([item.transaction.id]),
          });
        }
      }
    }

    const expenseCategories = categories.filter(
      (c) => c.direction === "Expense"
    );

    const budgeted: CategoryBudgetProgress[] = [];
    const unbudgeted: {
      category: Category;
      categoryPath: string;
      spent_cents: number;
      transaction_count: number;
    }[] = [];

    let totalBudgetedCents = 0;
    let totalSpentOnBudgetedCents = 0;
    let overBudgetCount = 0;

    for (const cat of expenseCategories) {
      const agg = spendByCat.get(cat.id);
      const rawSigned = agg ? agg.signedCents : 0;
      // Net expense: negative signedCents means net outflow; if positive (reimbursements > spend), clamp to 0
      const spentCents = rawSigned < 0 ? Math.abs(rawSigned) : 0;
      const txCount = agg ? agg.txIds.size : 0;
      const budgetCents = cat.monthly_budget_cents ?? null;
      const parentCat = cat.parent_id
        ? categoryMap.get(cat.parent_id) || null
        : null;
      const categoryPath = categoryPathMap.get(cat.id) || cat.name;

      if (budgetCents && budgetCents > 0) {
        const remainingCents = budgetCents - spentCents;
        const percentage = Math.round((spentCents / budgetCents) * 100);
        const status: "safe" | "warning" | "over" =
          percentage > 100 ? "over" : percentage >= 80 ? "warning" : "safe";

        totalBudgetedCents += budgetCents;
        totalSpentOnBudgetedCents += spentCents;
        if (status === "over") {
          overBudgetCount++;
        }

        budgeted.push({
          category: cat,
          parentCategory: parentCat,
          categoryPath,
          budget_cents: budgetCents,
          spent_cents: spentCents,
          remaining_cents: remainingCents,
          percentage,
          status,
          transaction_count: txCount,
        });
      } else {
        unbudgeted.push({
          category: cat,
          categoryPath,
          spent_cents: spentCents,
          transaction_count: txCount,
        });
      }
    }

    budgeted.sort((a, b) => b.percentage - a.percentage);
    unbudgeted.sort((a, b) => b.spent_cents - a.spent_cents);

    const summary: BudgetSummary = {
      total_budgeted_cents: totalBudgetedCents,
      total_spent_cents: totalSpentOnBudgetedCents,
      remaining_safe_to_spend_cents: Math.max(
        0,
        totalBudgetedCents - totalSpentOnBudgetedCents
      ),
      budgeted_categories_count: budgeted.length,
      over_budget_count: overBudgetCount,
    };

    return {
      budgetedList: budgeted,
      unbudgetedList: unbudgeted,
      summary,
    };
  }, [categories, transactions, categoryMap, categoryPathMap]);

  const startEditBudget = (cat: Category) => {
    setEditingCatId(cat.id);
    setDraftBudgetStr(
      cat.monthly_budget_cents && cat.monthly_budget_cents > 0
        ? formatBudgetCentsToInput(cat.monthly_budget_cents)
        : "150,00"
    );
  };

  const handleSaveBudget = async (e: React.FormEvent, cat: Category) => {
    e.preventDefault();
    const parsed = Math.abs(parseCentsInput(draftBudgetStr));
    const targetCents = parsed > 0 ? parsed : null;
    await setCategoryBudget(cat.id, targetCents);
    setEditingCatId(null);
    setStatusBanner(
      targetCents
        ? `✓ Set monthly budget for "${cat.name}" to ${formatCents(targetCents)}`
        : `✓ Cleared monthly budget for "${cat.name}"`
    );
  };

  const handleDrillDown = (categoryName: string) => {
    void setSearchQuery(categoryName);
    setActiveView("ledger");
  };

  const overallPercent =
    summary.total_budgeted_cents > 0
      ? Math.round(
          (summary.total_spent_cents / summary.total_budgeted_cents) * 100
        )
      : 0;

  return (
    <div className="p-3 md:p-6 h-full overflow-y-auto bg-neutral-950 text-neutral-100 space-y-4 md:space-y-6">
      {/* Top Header & Month Stepper */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm md:text-base font-semibold text-white">
              Monthly Category Budgets &amp; Safe-to-Spend
            </h1>
            <p className="text-[11px] text-neutral-400 flex items-center gap-1.5">
              <Wallet className="w-3 h-3 text-emerald-400" />
              <span>
                Active across {selectedAccountIds.length} of{" "}
                {accountSummaries.length} accounts •{" "}
                {summary.budgeted_categories_count} budgeted categories
              </span>
            </p>
          </div>
        </div>

        {/* Month Selector Stepper (< October 2026 >) */}
        <div className="flex items-center gap-1.5 bg-neutral-900 p-1 rounded-xl border border-neutral-800 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => handleStepMonth(-1)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800"
            title="Previous Month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-3 text-xs font-semibold font-mono text-neutral-100 min-w-[125px] text-center">
            { startDate || endDate
              ? `${MONTH_NAMES[activeYearMonth.monthZero]} ${activeYearMonth.year}`
              : `${MONTH_NAMES[activeYearMonth.monthZero]} ${activeYearMonth.year} (All)` }
          </span>
          <button
            type="button"
            onClick={() => handleStepMonth(1)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800"
            title="Next Month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {(startDate || endDate) && (
            <button
              type="button"
              onClick={() => void setDateRange("", "")}
              className="px-2 py-1 rounded-lg bg-neutral-800 text-[10px] text-neutral-300 hover:text-white"
              title="Reset to All Time"
            >
              All Time
            </button>
          )}
        </div>
      </div>

      {/* 3 Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-neutral-900/70 border border-neutral-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
              Total Budgeted
            </div>
            <div className="text-lg font-bold font-mono tabular-nums text-neutral-100 mt-0.5">
              {formatCents(summary.total_budgeted_cents)}
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5">
              Across {summary.budgeted_categories_count} active category targets
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-neutral-800 border border-neutral-700 flex items-center justify-center text-emerald-400">
            <Target className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-neutral-900/70 border border-neutral-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
              Spent So Far
            </div>
            <div className="text-lg font-bold font-mono tabular-nums text-rose-400 mt-0.5">
              {formatCents(summary.total_spent_cents)}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5 font-mono">
              {overallPercent}% of total monthly budget utilized
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <TrendingDown className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-neutral-900/70 border border-neutral-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
              Remaining Safe-to-Spend
            </div>
            <div className="text-lg font-bold font-mono tabular-nums text-emerald-400 mt-0.5">
              {formatCents(summary.remaining_safe_to_spend_cents)}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">
              {summary.over_budget_count > 0 ? (
                <span className="text-rose-400 font-medium">
                  ⚠️ {summary.over_budget_count} category over target
                </span>
              ) : (
                <span className="text-emerald-400/90">
                  ✓ All budgeted categories within target
                </span>
              )}
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Active Category Budget Progress Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
            Category Budget Pacing (Click Category to Inspect Ledger)
          </h2>
          <span className="text-[11px] text-neutral-500">
            Click <Pencil className="w-3 h-3 inline mx-0.5" /> or budget amount
            to calibrate target
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {budgetedList.map((item) => {
            const {
              category: cat,
              categoryPath,
              budget_cents,
              spent_cents,
              remaining_cents,
              percentage,
              status,
              transaction_count,
            } = item;
            const isEditing = editingCatId === cat.id;

            const barColorClass =
              status === "over"
                ? "bg-rose-500"
                : status === "warning"
                ? "bg-amber-500"
                : "bg-emerald-500";

            return (
              <div
                key={cat.id}
                onClick={() => {
                  if (!isEditing) {
                    handleDrillDown(cat.name);
                  }
                }}
                className="group p-4 rounded-xl bg-neutral-900/70 hover:bg-neutral-900 border border-neutral-800 hover:border-emerald-500/40 transition-all cursor-pointer space-y-3"
              >
                {/* Card Header: Category Name + Edit Button */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color_hex }}
                    />
                    <span className="text-xs font-semibold text-neutral-100 group-hover:text-emerald-300 truncate">
                      {categoryPath}
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-neutral-600 group-hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditBudget(cat);
                    }}
                    title="Edit Monthly Budget Target"
                    className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 shrink-0"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Inline Budget Editor OR Spend vs Target Row */}
                {isEditing ? (
                  <form
                    onClick={(e) => e.stopPropagation()}
                    onSubmit={(e) => void handleSaveBudget(e, cat)}
                    className="p-2.5 rounded-lg bg-neutral-950 border border-emerald-500/50 space-y-2 text-xs"
                  >
                    <label className="block text-[10px] text-neutral-400 font-semibold uppercase">
                      Monthly Budget Target (€)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draftBudgetStr}
                        onChange={(e) => setDraftBudgetStr(e.target.value)}
                        autoFocus
                        onFocus={(e) => e.currentTarget.select()}
                        className="w-full px-2.5 py-1.5 rounded bg-neutral-900 border border-neutral-700 font-mono text-white text-right focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="submit"
                        className="p-1.5 rounded bg-emerald-500 text-neutral-950 hover:bg-emerald-400"
                        title="Save Budget"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingCatId(null)}
                        className="p-1.5 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void setCategoryBudget(cat.id, null);
                        setEditingCatId(null);
                      }}
                      className="text-[10px] text-rose-400 hover:underline"
                    >
                      Remove monthly budget target
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between gap-2 font-mono text-xs">
                      <div>
                        <span className="text-sm font-bold text-neutral-100 tabular-nums">
                          {formatCents(spent_cents)}
                        </span>
                        <span className="text-neutral-500 mx-1">/</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditBudget(cat);
                          }}
                          className="text-neutral-400 hover:text-emerald-400 underline decoration-dotted tabular-nums"
                          title="Click to edit monthly budget"
                        >
                          {formatCents(budget_cents)}
                        </button>
                      </div>
                      <span
                        className={`font-semibold tabular-nums ${
                          status === "over"
                            ? "text-rose-400"
                            : status === "warning"
                            ? "text-amber-300"
                            : "text-emerald-400"
                        }`}
                      >
                        {percentage}%
                      </span>
                    </div>

                    {/* 3-Tier Progress Bar */}
                    <div className="h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${barColorClass}`}
                        style={{
                          width: `${Math.min(100, Math.max(2, percentage))}%`,
                        }}
                      />
                    </div>

                    {/* Footer Status Badge */}
                    <div className="flex items-center justify-between text-[11px]">
                      {status === "over" ? (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 font-mono text-[10px] font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>
                            +{formatCents(Math.abs(remaining_cents))} over
                          </span>
                        </span>
                      ) : status === "warning" ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-[10px]">
                          {formatCents(remaining_cents)} left • Near Limit
                        </span>
                      ) : (
                        <span className="text-emerald-400/90 font-mono text-[11px]">
                          {formatCents(remaining_cents)} remaining • Safe
                        </span>
                      )}

                      <span className="text-[10px] font-mono text-neutral-500">
                        {transaction_count} tx
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Unbudgeted Expense Categories Section */}
      {unbudgetedList.length > 0 && (
        <div className="pt-4 border-t border-neutral-800 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Unbudgeted Expense Categories ({unbudgetedList.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {unbudgetedList.map(({ category: cat, categoryPath, spent_cents }) => {
              const isEditing = editingCatId === cat.id;
              return (
                <div
                  key={cat.id}
                  className="p-3 rounded-xl bg-neutral-900/40 border border-neutral-800/80 flex items-center justify-between gap-2 text-xs"
                >
                  {isEditing ? (
                    <form
                      onSubmit={(e) => void handleSaveBudget(e, cat)}
                      className="w-full flex items-center gap-1.5"
                    >
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draftBudgetStr}
                        onChange={(e) => setDraftBudgetStr(e.target.value)}
                        autoFocus
                        onFocus={(e) => e.currentTarget.select()}
                        className="flex-1 px-2 py-1 rounded bg-neutral-950 border border-emerald-500 font-mono text-white text-right text-xs"
                      />
                      <button
                        type="submit"
                        className="p-1 rounded bg-emerald-500 text-neutral-950"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingCatId(null)}
                        className="p-1 rounded bg-neutral-800 text-neutral-300"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: cat.color_hex }}
                          />
                          <span className="font-medium text-neutral-200 truncate">
                            {categoryPath}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-neutral-500 mt-0.5">
                          Spent: {formatCents(spent_cents)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => startEditBudget(cat)}
                        className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-emerald-400 border border-neutral-700 text-[11px] font-medium flex items-center gap-1 shrink-0"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Set Budget</span>
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
