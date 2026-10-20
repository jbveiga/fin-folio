import React, { useMemo } from "react";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Activity,
  Percent,
  Building2,
  ArrowUpRight,
  FolderTree,
  Wallet,
  Award,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { formatCents } from "../utils/money";
import { getActiveDatePresetId, getDatePresets } from "../utils/datePresets";

export interface CategorySpendingMetric {
  categoryId: string;
  categoryName: string;
  categoryPath: string;
  categoryColor: string;
  direction: "Income" | "Expense";
  netCents: number; // Positive magnitude of net expense or net income in minor cents
  percentageOfTotal: number; // 0 to 100
  transactionCount: number;
}

export interface CounterpartySpendMetric {
  key: string;
  displayName: string;
  netExpenseCents: number;
  percentageOfTotal: number;
  transactionCount: number;
}

export const AnalyticsView: React.FC = () => {
  const {
    transactions,
    categories,
    entities,
    accountSummaries,
    selectedAccountIds,
    periodInflowCents,
    periodOutflowCents,
    netCashFlowCents,
    startDate,
    endDate,
    setDateRange,
    setSearchQuery,
    setActiveView,
  } = useFinFolioStore();

  const presets = useMemo(() => getDatePresets(), []);
  const activePresetId = useMemo(
    () => getActiveDatePresetId(startDate, endDate, presets),
    [startDate, endDate, presets]
  );

  // Build O(1) lookup maps
  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );
  const entityMap = useMemo(
    () => new Map(entities.map((e) => [e.id, e])),
    [entities]
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

  // Zero-Float Savings Rate % calculation
  const savingsRatePercent = useMemo(() => {
    if (periodInflowCents <= 0) return 0;
    return Math.max(
      0,
      Math.round((netCashFlowCents / periodInflowCents) * 100)
    );
  }, [periodInflowCents, netCashFlowCents]);

  // Pure integer-cents Category & Counterparty Aggregation (with Reimbursement Netting & Transfer Exclusion)
  const { expenseMetrics, incomeMetrics, topCounterparties } = useMemo(() => {
    const catTotals = new Map<
      string,
      {
        signedCents: number;
        txIds: Set<string>;
        direction: "Income" | "Expense";
        name: string;
        path: string;
        color: string;
      }
    >();

    const merchantTotals = new Map<
      string,
      {
        displayName: string;
        signedExpenseCents: number;
        txIds: Set<string>;
      }
    >();

    for (const item of transactions) {
      const tx = item.transaction;
      const ent = tx.entity_id ? entityMap.get(tx.entity_id) : undefined;
      const counterpartyName =
        ent?.normalized_name || tx.clean_description || "Unknown";

      for (const sp of item.splits) {
        // Exclude internal asset transfers from cash flow analytics
        if (sp.transfer_peer_account_id) continue;

        const cat = sp.category_id ? categoryMap.get(sp.category_id) : undefined;
        const catId = cat ? cat.id : "__uncategorized__";
        const direction: "Income" | "Expense" = cat
          ? cat.direction
          : sp.split_amount_cents >= 0
          ? "Income"
          : "Expense";
        const catName = cat ? cat.name : "Uncategorized";
        const catPath = cat
          ? categoryPathMap.get(cat.id) || cat.name
          : "Uncategorized";
        const catColor = cat ? cat.color_hex : "#737373";

        const existingCat = catTotals.get(catId);
        if (existingCat) {
          existingCat.signedCents += sp.split_amount_cents;
          existingCat.txIds.add(tx.id);
        } else {
          catTotals.set(catId, {
            signedCents: sp.split_amount_cents,
            txIds: new Set([tx.id]),
            direction,
            name: catName,
            path: catPath,
            color: catColor,
          });
        }

        // Aggregate counterparty expenses (including reimbursement netting on expense categories)
        if (direction === "Expense") {
          const mKey = counterpartyName.toUpperCase();
          const existingM = merchantTotals.get(mKey);
          if (existingM) {
            existingM.signedExpenseCents += sp.split_amount_cents;
            existingM.txIds.add(tx.id);
          } else {
            merchantTotals.set(mKey, {
              displayName: counterpartyName,
              signedExpenseCents: sp.split_amount_cents,
              txIds: new Set([tx.id]),
            });
          }
        }
      }
    }

    const rawExpenses: Omit<CategorySpendingMetric, "percentageOfTotal">[] = [];
    const rawIncomes: Omit<CategorySpendingMetric, "percentageOfTotal">[] = [];

    let totalExpensePoolCents = 0;
    let totalIncomePoolCents = 0;

    for (const [catId, data] of catTotals.entries()) {
      if (data.direction === "Expense" && data.signedCents < 0) {
        const absExpense = Math.abs(data.signedCents);
        totalExpensePoolCents += absExpense;
        rawExpenses.push({
          categoryId: catId,
          categoryName: data.name,
          categoryPath: data.path,
          categoryColor: data.color,
          direction: "Expense",
          netCents: absExpense,
          transactionCount: data.txIds.size,
        });
      } else if (data.direction === "Income" && data.signedCents > 0) {
        totalIncomePoolCents += data.signedCents;
        rawIncomes.push({
          categoryId: catId,
          categoryName: data.name,
          categoryPath: data.path,
          categoryColor: data.color,
          direction: "Income",
          netCents: data.signedCents,
          transactionCount: data.txIds.size,
        });
      }
    }

    const expenseMetrics: CategorySpendingMetric[] = rawExpenses
      .sort((a, b) => b.netCents - a.netCents)
      .map((item) => ({
        ...item,
        percentageOfTotal:
          totalExpensePoolCents > 0
            ? Number(((item.netCents / totalExpensePoolCents) * 100).toFixed(1))
            : 0,
      }));

    const incomeMetrics: CategorySpendingMetric[] = rawIncomes
      .sort((a, b) => b.netCents - a.netCents)
      .map((item) => ({
        ...item,
        percentageOfTotal:
          totalIncomePoolCents > 0
            ? Number(((item.netCents / totalIncomePoolCents) * 100).toFixed(1))
            : 0,
      }));

    const topCounterparties: CounterpartySpendMetric[] = Array.from(
      merchantTotals.entries()
    )
      .filter(([, m]) => m.signedExpenseCents < 0)
      .map(([key, m]) => {
        const netExpense = Math.abs(m.signedExpenseCents);
        return {
          key,
          displayName: m.displayName,
          netExpenseCents: netExpense,
          percentageOfTotal:
            totalExpensePoolCents > 0
              ? Number(((netExpense / totalExpensePoolCents) * 100).toFixed(1))
              : 0,
          transactionCount: m.txIds.size,
        };
      })
      .sort((a, b) => b.netExpenseCents - a.netExpenseCents)
      .slice(0, 6);

    return { expenseMetrics, incomeMetrics, topCounterparties };
  }, [transactions, categoryMap, entityMap, categoryPathMap]);

  const handleDrillDown = (term: string) => {
    if (term === "Uncategorized") {
      void setSearchQuery("");
    } else {
      void setSearchQuery(term);
    }
    setActiveView("ledger");
  };

  return (
    <div className="p-3 md:p-6 h-full overflow-y-auto bg-neutral-950 text-neutral-100 space-y-4 md:space-y-6">
      {/* Top Analytics Bar: Title, Active Account Scope & Date Preset Pills */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm md:text-base font-semibold text-white">
              Cash Flow &amp; Category Analytics
            </h1>
            <p className="text-[11px] text-neutral-400 flex items-center gap-1.5">
              <Wallet className="w-3 h-3 text-emerald-400" />
              <span>
                Showing {selectedAccountIds.length} of{" "}
                {accountSummaries.length} accounts •{" "}
                {transactions.length.toLocaleString()} transactions
              </span>
            </p>
          </div>
        </div>

        {/* One-Tap Date Range Presets + Monthly Report Card Shortcut */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveView("report")}
            className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Award className="w-3.5 h-3.5 text-emerald-400" />
            <span>Monthly Report Card</span>
          </button>

          <div className="flex items-center gap-1 bg-neutral-900 p-1 rounded-xl border border-neutral-800 overflow-x-auto">
            {presets.map((preset) => {
              const isActive = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    void setDateRange(preset.startDate, preset.endDate)
                  }
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "text-neutral-400 hover:text-white hover:bg-neutral-800/60 border border-transparent"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4 Financial KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-neutral-900/70 border border-neutral-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
              Period Inflow
            </div>
            <div className="text-base md:text-lg font-bold font-mono tabular-nums text-emerald-400 mt-0.5">
              {formatCents(periodInflowCents, true)}
            </div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <TrendingUp className="w-4 h-4" />
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-neutral-900/70 border border-neutral-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
              Period Outflow (Net)
            </div>
            <div className="text-base md:text-lg font-bold font-mono tabular-nums text-rose-400 mt-0.5">
              {formatCents(periodOutflowCents)}
            </div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <TrendingDown className="w-4 h-4" />
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-neutral-900/70 border border-neutral-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
              Net Cash Flow
            </div>
            <div
              className={`text-base md:text-lg font-bold font-mono tabular-nums mt-0.5 ${
                netCashFlowCents >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {formatCents(netCashFlowCents, true)}
            </div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <Activity className="w-4 h-4" />
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-neutral-900/70 border border-neutral-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
              Savings Rate %
            </div>
            <div className="text-base md:text-lg font-bold font-mono tabular-nums text-sky-300 mt-0.5">
              {savingsRatePercent}%
            </div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-300">
            <Percent className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Main 2-Column Analytics Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Left 2 Columns: Expense Breakdown by Category */}
        <div className="lg:col-span-2 bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderTree className="w-4 h-4 text-rose-400" />
              <h2 className="text-sm font-semibold text-white">
                Expense Breakdown by Category (Net of Reimbursements)
              </h2>
            </div>
            <span className="text-[11px] text-neutral-400">
              Click any category to drill down
            </span>
          </div>

          {expenseMetrics.length === 0 ? (
            <div className="py-10 text-center text-xs text-neutral-500">
              No expense transactions recorded for the selected accounts and
              date period.
            </div>
          ) : (
            <div className="space-y-3">
              {expenseMetrics.map((cat) => (
                <button
                  key={cat.categoryId}
                  type="button"
                  onClick={() => handleDrillDown(cat.categoryName)}
                  className="w-full text-left group p-2.5 rounded-xl bg-neutral-950/70 hover:bg-neutral-900 border border-neutral-800/80 hover:border-emerald-500/40 transition-all space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: cat.categoryColor }}
                      />
                      <span className="font-medium text-neutral-100 group-hover:text-emerald-300 truncate">
                        {cat.categoryPath}
                      </span>
                      <span className="text-[10px] font-mono text-neutral-500 shrink-0">
                        ({cat.transactionCount} tx)
                      </span>
                      <ArrowUpRight className="w-3 h-3 text-neutral-600 group-hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                    <div className="flex items-center gap-2 shrink-0 font-mono">
                      <span className="text-neutral-100 font-semibold tabular-nums">
                        {formatCents(cat.netCents)}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 text-[10px] tabular-nums w-12 text-right">
                        {cat.percentageOfTotal.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Proportional CSS Bar Meter */}
                  <div className="h-2 w-full rounded-full bg-neutral-800/90 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max(2, cat.percentageOfTotal)}%`,
                        backgroundColor: cat.categoryColor,
                      }}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Income Sources Section (if inflows exist) */}
          {incomeMetrics.length > 0 && (
            <div className="pt-4 border-t border-neutral-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                    Income Sources Breakdown
                  </h3>
                </div>
              </div>
              <div className="space-y-2">
                {incomeMetrics.map((inc) => (
                  <button
                    key={inc.categoryId}
                    type="button"
                    onClick={() => handleDrillDown(inc.categoryName)}
                    className="w-full text-left group p-2.5 rounded-xl bg-neutral-950/60 hover:bg-neutral-900 border border-neutral-800/70 hover:border-emerald-500/40 transition-all space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: inc.categoryColor }}
                        />
                        <span className="font-medium text-neutral-100 group-hover:text-emerald-300">
                          {inc.categoryPath}
                        </span>
                        <span className="text-[10px] font-mono text-neutral-500">
                          ({inc.transactionCount} tx)
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-emerald-400 font-semibold tabular-nums">
                          {formatCents(inc.netCents, true)}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] tabular-nums w-12 text-right">
                          {inc.percentageOfTotal.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Top Counterparties / Merchants */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">
                Top Counterparties
              </h2>
            </div>
            <span className="text-[11px] text-neutral-400 font-mono">
              Top {topCounterparties.length}
            </span>
          </div>

          {topCounterparties.length === 0 ? (
            <div className="py-10 text-center text-xs text-neutral-500">
              No counterparty spend for this period.
            </div>
          ) : (
            <div className="space-y-2.5">
              {topCounterparties.map((merchant, idx) => (
                <button
                  key={merchant.key}
                  type="button"
                  onClick={() => handleDrillDown(merchant.displayName)}
                  className="w-full text-left group p-2.5 rounded-xl bg-neutral-950/70 hover:bg-neutral-900 border border-neutral-800/80 hover:border-emerald-500/40 transition-all space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-md bg-neutral-800 text-neutral-400 font-mono text-[10px] flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-medium text-neutral-100 group-hover:text-emerald-300 truncate">
                        {merchant.displayName}
                      </span>
                    </div>
                    <span className="font-mono font-semibold text-rose-400 tabular-nums shrink-0">
                      {formatCents(-merchant.netExpenseCents)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-neutral-400 pl-7">
                    <span>
                      {merchant.transactionCount}{" "}
                      {merchant.transactionCount === 1
                        ? "transaction"
                        : "transactions"}
                    </span>
                    <span className="font-mono text-[10px] text-neutral-400">
                      {merchant.percentageOfTotal.toFixed(1)}% of spend
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
