import React, { useMemo } from "react";
import {
  Award,
  ChevronLeft,
  ChevronRight,
  Printer,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Target,
  CalendarClock,
  Sparkles,
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  Wallet,
  BarChart3,
  Building2,
  FolderTree,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import {
  MonthlyReportCardData,
  ReportGrade,
  ScorePillar,
} from "../types";
import { formatCents } from "../utils/money";

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

function getGradeMetadata(score: number): {
  grade: ReportGrade;
  title: string;
  shieldClasses: string;
  barColor: string;
  accentText: string;
} {
  if (score >= 90) {
    return {
      grade: "A+",
      title: "Outstanding Financial Mastery",
      shieldClasses:
        "bg-emerald-500/20 text-emerald-300 border-2 border-emerald-400 shadow-lg shadow-emerald-500/15",
      barColor: "bg-emerald-500",
      accentText: "text-emerald-400",
    };
  }
  if (score >= 80) {
    return {
      grade: "A",
      title: "Excellent Financial Health",
      shieldClasses:
        "bg-emerald-500/20 text-emerald-300 border-2 border-emerald-400 shadow-lg shadow-emerald-500/10",
      barColor: "bg-emerald-500",
      accentText: "text-emerald-400",
    };
  }
  if (score >= 70) {
    return {
      grade: "B",
      title: "Solid Financial Stability",
      shieldClasses:
        "bg-teal-500/20 text-teal-300 border-2 border-teal-400 shadow-lg shadow-teal-500/10",
      barColor: "bg-teal-400",
      accentText: "text-teal-300",
    };
  }
  if (score >= 60) {
    return {
      grade: "C",
      title: "Fair — Headroom for Optimization",
      shieldClasses:
        "bg-amber-500/20 text-amber-300 border-2 border-amber-400 shadow-lg shadow-amber-500/10",
      barColor: "bg-amber-400",
      accentText: "text-amber-300",
    };
  }
  return {
    grade: "D",
    title: "Attention Needed — Cash Flow Deficit",
    shieldClasses:
      "bg-rose-500/20 text-rose-300 border-2 border-rose-400 shadow-lg shadow-rose-500/10",
    barColor: "bg-rose-500",
    accentText: "text-rose-400",
  };
}

export const ReportCardView: React.FC = () => {
  const {
    transactions,
    categories,
    entities,
    recurringSchedules,
    accountSummaries,
    selectedAccountIds,
    startDate,
    endDate,
    setDateRange,
    setSearchQuery,
    setActiveView,
  } = useFinFolioStore();

  // Derive active month from store startDate or latest transaction date (defaulting to October 2026)
  const activeYearMonth = useMemo(() => {
    if (startDate && /^\d{4}-\d{2}/.test(startDate)) {
      const [y, m] = startDate.slice(0, 7).split("-").map(Number);
      if (y && m >= 1 && m <= 12) {
        return {
          year: y,
          monthZero: m - 1,
          ym: `${y}-${String(m).padStart(2, "0")}`,
        };
      }
    }
    if (transactions.length > 0) {
      const firstDate = transactions[0]?.transaction.date_posted;
      if (firstDate && /^\d{4}-\d{2}/.test(firstDate)) {
        const [y, m] = firstDate.slice(0, 7).split("-").map(Number);
        if (y && m >= 1 && m <= 12) {
          return {
            year: y,
            monthZero: m - 1,
            ym: `${y}-${String(m).padStart(2, "0")}`,
          };
        }
      }
    }
    return { year: 2026, monthZero: 9, ym: "2026-10" };
  }, [startDate, transactions]);

  const handleStepMonth = (delta: number) => {
    const d = new Date(
      activeYearMonth.year,
      activeYearMonth.monthZero + delta,
      1
    );
    const y = d.getFullYear();
    const m = d.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    const startIso = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const endIso = `${y}-${String(m + 1).padStart(2, "0")}-${String(
      lastDay
    ).padStart(2, "0")}`;
    void setDateRange(startIso, endIso);
  };

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

  // Deterministic 100-Point Monthly Report Card Calculation (Strictly Zero-Float Cents)
  const reportData: MonthlyReportCardData = useMemo(() => {
    const monthLabel = `${MONTH_NAMES[activeYearMonth.monthZero]} ${
      activeYearMonth.year
    }`;

    // Filter transactions to active month if no explicit date filter is active, or use current store slice
    const scopedTransactions =
      startDate || endDate
        ? transactions
        : transactions.filter((t) =>
            t.transaction.date_posted.startsWith(activeYearMonth.ym)
          );

    const effectiveTransactions =
      scopedTransactions.length > 0 ? scopedTransactions : transactions;

    let inflowCents = 0;
    let signedExpensePoolCents = 0;

    const catSignedMap = new Map<string, number>();
    const merchantExpenseMap = new Map<
      string,
      { name: string; signedCents: number; txIds: Set<string> }
    >();

    for (const item of effectiveTransactions) {
      const { transaction: tx, splits } = item;
      const ent = tx.entity_id ? entityMap.get(tx.entity_id) : undefined;
      const merchantName = ent
        ? ent.normalized_name
        : tx.clean_description || tx.raw_bank_string;

      for (const sp of splits) {
        // Ignore account-to-account transfers from income/expense calculation
        if (sp.transfer_peer_account_id) continue;

        const cat = sp.category_id ? categoryMap.get(sp.category_id) : undefined;
        const isIncomeSplit =
          cat?.direction === "Income" || (!cat && sp.split_amount_cents > 0);

        if (isIncomeSplit) {
          if (sp.split_amount_cents > 0) {
            inflowCents += sp.split_amount_cents;
          }
        } else {
          // Expense split (supports reimbursement netting where positive split in Expense category offsets outflow)
          signedExpensePoolCents += sp.split_amount_cents;
          if (sp.category_id) {
            catSignedMap.set(
              sp.category_id,
              (catSignedMap.get(sp.category_id) || 0) + sp.split_amount_cents
            );
          } else {
            catSignedMap.set(
              "__uncategorized__",
              (catSignedMap.get("__uncategorized__") || 0) +
                sp.split_amount_cents
            );
          }

          const existingMerch = merchantExpenseMap.get(merchantName);
          if (existingMerch) {
            existingMerch.signedCents += sp.split_amount_cents;
            existingMerch.txIds.add(tx.id);
          } else {
            merchantExpenseMap.set(merchantName, {
              name: merchantName,
              signedCents: sp.split_amount_cents,
              txIds: new Set([tx.id]),
            });
          }
        }
      }
    }

    const outflowCents =
      signedExpensePoolCents < 0 ? Math.abs(signedExpensePoolCents) : 0;
    const netSavingsCents = inflowCents - outflowCents;
    const savingsRatePct =
      inflowCents > 0
        ? Math.trunc((netSavingsCents * 100) / inflowCents)
        : netSavingsCents < 0
        ? -100
        : 0;

    // Evaluate Category Budgets
    const expenseCategories = categories.filter(
      (c) => c.direction === "Expense"
    );
    let totalBudgetedCents = 0;
    let budgetSpentCents = 0;
    let budgetedCategoriesCount = 0;
    let overBudgetCount = 0;

    for (const cat of expenseCategories) {
      const budget = cat.monthly_budget_cents ?? 0;
      if (budget > 0) {
        budgetedCategoriesCount++;
        totalBudgetedCents += budget;
        const signed = catSignedMap.get(cat.id) || 0;
        const spent = signed < 0 ? Math.abs(signed) : 0;
        budgetSpentCents += spent;
        if (spent > budget) {
          overBudgetCount++;
        }
      }
    }

    const safeToSpendCents = Math.max(0, totalBudgetedCents - budgetSpentCents);

    // Evaluate Fixed Recurring Commitments vs Discretionary Spend
    const activeExpenseSchedules = recurringSchedules.filter(
      (r) =>
        r.is_active &&
        r.expected_amount_cents < 0 &&
        (!r.account_id || selectedAccountIds.includes(r.account_id))
    );

    const fixedCommitmentsCents = activeExpenseSchedules.reduce((acc, s) => {
      const absAmt = Math.abs(s.expected_amount_cents);
      if (s.recurrence_interval === "Yearly") return acc + Math.round(absAmt / 12);
      if (s.recurrence_interval === "Weekly") return acc + absAmt * 4;
      return acc + absAmt;
    }, 0);

    const discretionarySpendCents = Math.max(
      0,
      outflowCents - Math.min(outflowCents, fixedCommitmentsCents)
    );

    const fixedRatioPct =
      inflowCents > 0
        ? Math.min(100, Math.round((fixedCommitmentsCents * 100) / inflowCents))
        : 0;

    const discretionaryRatioPct =
      inflowCents > 0
        ? Math.min(
            100,
            Math.round((discretionarySpendCents * 100) / inflowCents)
          )
        : 0;

    // -------------------------------------------------------------------------
    // PILLAR 1: Savings Rate (Max 35 Points)
    // -------------------------------------------------------------------------
    let savingsScore = 0;
    let savingsStatus: ScorePillar["status"] = "alert";
    if (savingsRatePct >= 35) {
      savingsScore = 35;
      savingsStatus = "excellent";
    } else if (savingsRatePct >= 25) {
      savingsScore = 28;
      savingsStatus = "good";
    } else if (savingsRatePct >= 15) {
      savingsScore = 20;
      savingsStatus = "good";
    } else if (savingsRatePct >= 5) {
      savingsScore = 12;
      savingsStatus = "warning";
    } else if (savingsRatePct > 0) {
      savingsScore = 6;
      savingsStatus = "warning";
    } else {
      savingsScore = 0;
      savingsStatus = "alert";
    }

    const savingsPillar: ScorePillar = {
      name: "Savings Rate",
      score: savingsScore,
      maxScore: 35,
      percentage: Math.max(0, savingsRatePct),
      status: savingsStatus,
      summary:
        inflowCents > 0
          ? `${Math.max(0, savingsRatePct)}% of income saved (Target ≥ 20%)`
          : "No inflow recorded in this period",
    };

    // -------------------------------------------------------------------------
    // PILLAR 2: Budget Discipline (Max 25 Points)
    // -------------------------------------------------------------------------
    let budgetScore = 15;
    let budgetStatus: ScorePillar["status"] = "good";
    if (budgetedCategoriesCount === 0) {
      budgetScore = 15;
      budgetStatus = "good";
    } else if (overBudgetCount === 0) {
      budgetScore = 25;
      budgetStatus = "excellent";
    } else if (overBudgetCount === 1) {
      budgetScore = 18;
      budgetStatus = "good";
    } else if (overBudgetCount === 2) {
      budgetScore = 10;
      budgetStatus = "warning";
    } else {
      budgetScore = 4;
      budgetStatus = "alert";
    }

    const underBudgetCount = Math.max(
      0,
      budgetedCategoriesCount - overBudgetCount
    );
    const budgetAdherencePct =
      budgetedCategoriesCount > 0
        ? Math.round((underBudgetCount * 100) / budgetedCategoriesCount)
        : 100;

    const budgetPillar: ScorePillar = {
      name: "Budget Discipline",
      score: budgetScore,
      maxScore: 25,
      percentage: budgetAdherencePct,
      status: budgetStatus,
      summary:
        budgetedCategoriesCount > 0
          ? `${underBudgetCount} of ${budgetedCategoriesCount} budgets on track`
          : "No category budgets configured yet",
    };

    // -------------------------------------------------------------------------
    // PILLAR 3: Fixed Overhead Ratio (Max 20 Points)
    // -------------------------------------------------------------------------
    let fixedScore = 20;
    let fixedStatus: ScorePillar["status"] = "excellent";
    if (inflowCents === 0 && fixedCommitmentsCents > 0) {
      fixedScore = 10;
      fixedStatus = "warning";
    } else if (fixedRatioPct < 40) {
      fixedScore = 20;
      fixedStatus = "excellent";
    } else if (fixedRatioPct <= 54) {
      fixedScore = 14;
      fixedStatus = "good";
    } else if (fixedRatioPct <= 70) {
      fixedScore = 8;
      fixedStatus = "warning";
    } else {
      fixedScore = 4;
      fixedStatus = "alert";
    }

    const fixedPillar: ScorePillar = {
      name: "Fixed Overhead Ratio",
      score: fixedScore,
      maxScore: 20,
      percentage: fixedRatioPct,
      status: fixedStatus,
      summary: `${fixedRatioPct}% committed to recurring bills (< 50% rule)`,
    };

    // -------------------------------------------------------------------------
    // PILLAR 4: Cash Flow Growth (Max 20 Points)
    // -------------------------------------------------------------------------
    let cashFlowScore = 0;
    let cashFlowStatus: ScorePillar["status"] = "alert";
    if (inflowCents > outflowCents) {
      cashFlowScore = 20;
      cashFlowStatus = "excellent";
    } else if (inflowCents === outflowCents && inflowCents > 0) {
      cashFlowScore = 10;
      cashFlowStatus = "warning";
    } else {
      cashFlowScore = 0;
      cashFlowStatus = "alert";
    }

    const cashFlowPillar: ScorePillar = {
      name: "Cash Flow Growth",
      score: cashFlowScore,
      maxScore: 20,
      percentage: inflowCents > outflowCents ? 100 : 0,
      status: cashFlowStatus,
      summary: `${formatCents(netSavingsCents, true)} ${
        netSavingsCents >= 0 ? "positive net surplus" : "net deficit"
      }`,
    };

    const totalScore =
      savingsPillar.score +
      budgetPillar.score +
      fixedPillar.score +
      cashFlowPillar.score;

    const gradeMeta = getGradeMetadata(totalScore);

    // Top 4 Expense Categories
    const topCategories = Array.from(catSignedMap.entries())
      .filter(([, signed]) => signed < 0)
      .map(([catId, signed]) => {
        const amt = Math.abs(signed);
        const cat = categoryMap.get(catId);
        return {
          name: cat ? cat.name : "Uncategorized",
          categoryPath: cat
            ? categoryPathMap.get(catId) || cat.name
            : "Uncategorized",
          amountCents: amt,
          pct:
            outflowCents > 0
              ? Number(((amt * 100) / outflowCents).toFixed(1))
              : 0,
          color: cat ? cat.color_hex : "#737373",
        };
      })
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 4);

    // Top 4 Merchants / Counterparties
    const topMerchants = Array.from(merchantExpenseMap.values())
      .filter((m) => m.signedCents < 0)
      .map((m) => {
        const amt = Math.abs(m.signedCents);
        return {
          name: m.name,
          amountCents: amt,
          pct:
            outflowCents > 0
              ? Number(((amt * 100) / outflowCents).toFixed(1))
              : 0,
          txCount: m.txIds.size,
        };
      })
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 4);

    // Deterministic Rule-Based Observations & Tips
    const insights: MonthlyReportCardData["insights"] = [];

    if (savingsRatePct >= 35) {
      insights.push({
        title: "Outstanding Savings Preservation",
        detail: `You preserved ${savingsRatePct}% of your monthly inflow (${formatCents(
          netSavingsCents,
          true
        )}), well above the 20% sovereign wealth benchmark.`,
        tone: "positive",
      });
    } else if (savingsRatePct >= 15) {
      insights.push({
        title: "Healthy Capital Retention",
        detail: `You saved ${savingsRatePct}% of your monthly inflow (${formatCents(
          netSavingsCents,
          true
        )}). Pushing toward 35% will unlock maximum Savings Pillar points.`,
        tone: "positive",
      });
    } else {
      insights.push({
        title: "Cash Flow Compression Detected",
        detail:
          netSavingsCents >= 0
            ? `Savings rate is ${savingsRatePct}% this month. Review top discretionary categories to widen your safety margin.`
            : `Outflow exceeded inflow by ${formatCents(
                Math.abs(netSavingsCents)
              )}. Prioritize trimming non-essential spend next cycle.`,
        tone: "warning",
      });
    }

    if (budgetedCategoriesCount > 0) {
      if (overBudgetCount === 0) {
        insights.push({
          title: "Perfect Category Budget Adherence",
          detail: `All ${budgetedCategoriesCount} budgeted expense categories stayed within target, leaving ${formatCents(
            safeToSpendCents
          )} in Safe-to-Spend headroom.`,
          tone: "positive",
        });
      } else {
        insights.push({
          title: "Category Budget Watch",
          detail: `${overBudgetCount} of ${budgetedCategoriesCount} budgeted categories exceeded their monthly cap. Click any category to inspect transactions or recalibrate targets.`,
          tone: "warning",
        });
      }
    }

    if (fixedRatioPct <= 40) {
      insights.push({
        title: "Agile Fixed Overhead (< 50% Rule)",
        detail: `Fixed recurring commitments (${formatCents(
          fixedCommitmentsCents
        )}/mo) represent ${fixedRatioPct}% of income, giving you strong monthly flexibility.`,
        tone: "positive",
      });
    } else {
      insights.push({
        title: "Elevated Fixed Commitments",
        detail: `Recurring obligations consume ${fixedRatioPct}% of monthly inflow (${formatCents(
          fixedCommitmentsCents
        )}). Auditing subscriptions can free up cash flow.`,
        tone: "neutral",
      });
    }

    if (topCategories[0]) {
      insights.push({
        title: `Primary Outflow Driver: ${topCategories[0].name}`,
        detail: `${topCategories[0].categoryPath} accounted for ${
          topCategories[0].pct
        }% of total monthly spend (${formatCents(
          topCategories[0].amountCents
        )}).`,
        tone: "neutral",
      });
    }

    return {
      month: activeYearMonth.ym,
      monthLabel,
      totalScore,
      letterGrade: gradeMeta.grade,
      gradeTitle: gradeMeta.title,
      pillars: {
        savingsRate: savingsPillar,
        budgetDiscipline: budgetPillar,
        fixedOverhead: fixedPillar,
        cashFlowGrowth: cashFlowPillar,
      },
      metrics: {
        inflowCents,
        outflowCents,
        netSavingsCents,
        savingsRatePct,
        totalBudgetedCents,
        budgetSpentCents,
        safeToSpendCents,
        budgetedCategoriesCount,
        overBudgetCount,
        fixedCommitmentsCents,
        discretionarySpendCents,
        fixedRatioPct,
        discretionaryRatioPct,
      },
      topCategories,
      topMerchants,
      insights,
    };
  }, [
    activeYearMonth,
    startDate,
    endDate,
    transactions,
    categories,
    recurringSchedules,
    selectedAccountIds,
    categoryMap,
    entityMap,
    categoryPathMap,
  ]);

  const gradeMeta = getGradeMetadata(reportData.totalScore);

  const handleDrillDown = (term: string) => {
    void setSearchQuery(term === "Uncategorized" ? "" : term);
    setActiveView("ledger");
  };

  return (
    <div className="report-container p-3 md:p-6 h-full overflow-y-auto bg-neutral-950 text-neutral-100 space-y-4 md:space-y-6">
      {/* =================================================================== */}
      {/* TOP BAR: Title, Month Stepper (< October 2026 >) & Print PDF Button */}
      {/* =================================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Award className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm md:text-base font-semibold text-white">
              Monthly Financial Health Report Card
            </h1>
            <p className="text-[11px] text-neutral-400 flex items-center gap-1.5">
              <Wallet className="w-3 h-3 text-emerald-400" />
              <span>
                Executive Assessment • {reportData.monthLabel} •{" "}
                {selectedAccountIds.length} of {accountSummaries.length} accounts
              </span>
            </p>
          </div>
        </div>

        {/* Interactive Controls (Hidden when printing PDF) */}
        <div className="print-hidden flex flex-wrap items-center gap-2">
          {/* Month Stepper */}
          <div className="flex items-center gap-1 bg-neutral-900 p-1 rounded-xl border border-neutral-800">
            <button
              type="button"
              onClick={() => handleStepMonth(-1)}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 text-xs font-semibold font-mono text-neutral-100 min-w-[125px] text-center">
              {reportData.monthLabel}
            </span>
            <button
              type="button"
              onClick={() => handleStepMonth(1)}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => void setDateRange("", "")}
                className="px-2 py-1 rounded-lg bg-neutral-800 text-[10px] text-neutral-300 hover:text-white"
                title="Reset Date Filter"
              >
                All
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setActiveView("analytics")}
            className="px-2.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Analytics</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-neutral-950 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            title="Print or Save 1-Page Executive PDF Summary"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print / Save PDF</span>
          </button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* SURFACE 1: EXECUTIVE GRADE SHIELD & COMPOSITE 100-POINT SCORE BAR   */}
      {/* =================================================================== */}
      <div className="report-card p-4 md:p-6 rounded-2xl bg-neutral-900/80 border border-neutral-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
        <div className="flex items-center gap-4 md:gap-5">
          {/* Letter Grade Shield */}
          <div
            className={`w-20 h-20 md:w-24 md:h-24 rounded-2xl flex flex-col items-center justify-center shrink-0 select-none ${gradeMeta.shieldClasses}`}
          >
            <span className="text-[10px] font-mono uppercase tracking-widest opacity-80">
              GRADE
            </span>
            <span className="text-3xl md:text-4xl font-extrabold font-mono tracking-tight leading-none mt-0.5">
              {reportData.letterGrade}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-neutral-950 border border-neutral-700 font-mono text-xs font-bold text-white">
                SCORE: {reportData.totalScore} / 100 PTS
              </span>
              <span
                className={`text-xs font-semibold uppercase tracking-wider ${gradeMeta.accentText}`}
              >
                • {reportData.gradeTitle}
              </span>
            </div>

            <p className="text-xs md:text-sm text-neutral-300 max-w-2xl leading-relaxed">
              {reportData.metrics.netSavingsCents >= 0 ? (
                <>
                  Strong financial discipline in{" "}
                  <span className="font-semibold text-white">
                    {reportData.monthLabel}
                  </span>
                  : a{" "}
                  <span className="font-mono font-semibold text-emerald-400">
                    {Math.max(0, reportData.metrics.savingsRatePct)}%
                  </span>{" "}
                  savings rate and{" "}
                  <span className="font-mono font-semibold text-sky-300">
                    {Math.max(
                      0,
                      reportData.metrics.budgetedCategoriesCount -
                        reportData.metrics.overBudgetCount
                    )}{" "}
                    of {reportData.metrics.budgetedCategoriesCount}
                  </span>{" "}
                  category budgets kept under target generated a net cash surplus
                  of{" "}
                  <span className="font-mono font-semibold text-emerald-400">
                    {formatCents(reportData.metrics.netSavingsCents, true)}
                  </span>
                  .
                </>
              ) : (
                <>
                  In{" "}
                  <span className="font-semibold text-white">
                    {reportData.monthLabel}
                  </span>
                  , total outflows exceeded inflows by{" "}
                  <span className="font-mono font-semibold text-rose-400">
                    {formatCents(Math.abs(reportData.metrics.netSavingsCents))}
                  </span>
                  . Reviewing top discretionary categories and budget caps will
                  help restore positive cash flow next cycle.
                </>
              )}
            </p>

            {/* 100-Point Progress Bar */}
            <div className="pt-1 max-w-xl">
              <div className="h-2.5 w-full rounded-full bg-neutral-950 border border-neutral-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${gradeMeta.barColor}`}
                  style={{
                    width: `${Math.min(100, Math.max(4, reportData.totalScore))}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-neutral-500 mt-1">
                <span>0 (Deficit)</span>
                <span>60 (Fair C)</span>
                <span>70 (Solid B)</span>
                <span>80 (Great A)</span>
                <span>90+ (Mastery A+)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Quick Summary Stamp */}
        <div className="w-full md:w-auto pt-3 md:pt-0 border-t md:border-t-0 md:border-l border-neutral-800 md:pl-5 flex md:flex-col justify-between gap-2 text-xs font-mono shrink-0">
          <div>
            <div className="text-[10px] uppercase text-neutral-400">
              Net Monthly Surplus
            </div>
            <div
              className={`text-base md:text-lg font-bold tabular-nums ${
                reportData.metrics.netSavingsCents >= 0
                  ? "text-emerald-400"
                  : "text-rose-400"
              }`}
            >
              {formatCents(reportData.metrics.netSavingsCents, true)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-neutral-400">
              Safe-to-Spend Left
            </div>
            <div className="text-sm font-bold text-sky-300 tabular-nums">
              {formatCents(reportData.metrics.safeToSpendCents)}
            </div>
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* SURFACE 2: THE 4 CORE ZERO-FLOAT SCORING PILLARS                    */}
      {/* =================================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Pillar 1: Savings Rate (35 pts) */}
        <div className="report-card p-4 rounded-xl bg-neutral-900/70 border border-neutral-800 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span>1. Savings Rate</span>
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[11px] font-bold">
              {reportData.pillars.savingsRate.score} /{" "}
              {reportData.pillars.savingsRate.maxScore} pts
            </span>
          </div>
          <div>
            <div className="text-xl font-bold font-mono tabular-nums text-emerald-400">
              {Math.max(0, reportData.metrics.savingsRatePct)}%{" "}
              <span className="text-xs font-normal text-neutral-400">
                of Inflow
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              {reportData.pillars.savingsRate.summary}
            </p>
          </div>
          <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{
                width: `${Math.round(
                  (reportData.pillars.savingsRate.score /
                    reportData.pillars.savingsRate.maxScore) *
                    100
                )}%`,
              }}
            />
          </div>
        </div>

        {/* Pillar 2: Budget Discipline (25 pts) */}
        <div
          onClick={() => setActiveView("budgets")}
          className="report-card p-4 rounded-xl bg-neutral-900/70 hover:bg-neutral-900 border border-neutral-800 hover:border-sky-500/40 transition-colors cursor-pointer flex flex-col justify-between space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-sky-400" />
              <span>2. Budget Discipline</span>
            </span>
            <span className="px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 font-mono text-[11px] font-bold">
              {reportData.pillars.budgetDiscipline.score} /{" "}
              {reportData.pillars.budgetDiscipline.maxScore} pts
            </span>
          </div>
          <div>
            <div className="text-xl font-bold font-mono tabular-nums text-sky-300">
              {reportData.pillars.budgetDiscipline.percentage}%{" "}
              <span className="text-xs font-normal text-neutral-400">
                On Track
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              {reportData.pillars.budgetDiscipline.summary}
            </p>
          </div>
          <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
            <div
              className="h-full bg-sky-400 rounded-full"
              style={{
                width: `${Math.round(
                  (reportData.pillars.budgetDiscipline.score /
                    reportData.pillars.budgetDiscipline.maxScore) *
                    100
                )}%`,
              }}
            />
          </div>
        </div>

        {/* Pillar 3: Fixed Overhead Ratio (20 pts) */}
        <div
          onClick={() => setActiveView("recurring")}
          className="report-card p-4 rounded-xl bg-neutral-900/70 hover:bg-neutral-900 border border-neutral-800 hover:border-purple-500/40 transition-colors cursor-pointer flex flex-col justify-between space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
              <CalendarClock className="w-3.5 h-3.5 text-purple-400" />
              <span>3. Fixed Overhead</span>
            </span>
            <span className="px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 font-mono text-[11px] font-bold">
              {reportData.pillars.fixedOverhead.score} /{" "}
              {reportData.pillars.fixedOverhead.maxScore} pts
            </span>
          </div>
          <div>
            <div className="text-xl font-bold font-mono tabular-nums text-purple-300">
              {reportData.metrics.fixedRatioPct}%{" "}
              <span className="text-xs font-normal text-neutral-400">
                of Income
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              {reportData.pillars.fixedOverhead.summary}
            </p>
          </div>
          <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
            <div
              className="h-full bg-purple-400 rounded-full"
              style={{
                width: `${Math.round(
                  (reportData.pillars.fixedOverhead.score /
                    reportData.pillars.fixedOverhead.maxScore) *
                    100
                )}%`,
              }}
            />
          </div>
        </div>

        {/* Pillar 4: Cash Flow Growth (20 pts) */}
        <div className="report-card p-4 rounded-xl bg-neutral-900/70 border border-neutral-800 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>4. Cash Flow Growth</span>
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[11px] font-bold">
              {reportData.pillars.cashFlowGrowth.score} /{" "}
              {reportData.pillars.cashFlowGrowth.maxScore} pts
            </span>
          </div>
          <div>
            <div
              className={`text-xl font-bold font-mono tabular-nums ${
                reportData.metrics.netSavingsCents >= 0
                  ? "text-emerald-400"
                  : "text-rose-400"
              }`}
            >
              {formatCents(reportData.metrics.netSavingsCents, true)}
            </div>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              {reportData.pillars.cashFlowGrowth.summary}
            </p>
          </div>
          <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                reportData.metrics.netSavingsCents >= 0
                  ? "bg-emerald-500"
                  : "bg-rose-500"
              }`}
              style={{
                width: `${Math.round(
                  (reportData.pillars.cashFlowGrowth.score /
                    reportData.pillars.cashFlowGrowth.maxScore) *
                    100
                )}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* SURFACE 3: FLOW & 50/30/20 BREAKDOWN + TOP EXPENSE DRIVERS          */}
      {/* =================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Column: Financial Flow & 50/30/20 Rule Comparison */}
        <div className="report-card p-4 md:p-5 rounded-xl bg-neutral-900/70 border border-neutral-800 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-200 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-emerald-400" />
              <span>Financial Flow &amp; 50/30/20 Benchmark</span>
            </h2>
            <span className="text-[11px] font-mono text-neutral-400">
              Zero-Float Cents
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5 text-xs font-mono">
            <div className="p-2.5 rounded-lg bg-neutral-950/80 border border-neutral-800/80">
              <div className="text-[10px] uppercase text-neutral-400 font-sans">
                Total Inflow
              </div>
              <div className="text-sm font-bold text-emerald-400 tabular-nums mt-0.5">
                {formatCents(reportData.metrics.inflowCents, true)}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-neutral-950/80 border border-neutral-800/80">
              <div className="text-[10px] uppercase text-neutral-400 font-sans">
                Total Outflow
              </div>
              <div className="text-sm font-bold text-rose-400 tabular-nums mt-0.5">
                -{formatCents(reportData.metrics.outflowCents)}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-neutral-950/80 border border-neutral-800/80">
              <div className="text-[10px] uppercase text-neutral-400 font-sans">
                Net Saved
              </div>
              <div
                className={`text-sm font-bold tabular-nums mt-0.5 ${
                  reportData.metrics.netSavingsCents >= 0
                    ? "text-emerald-400"
                    : "text-rose-400"
                }`}
              >
                {formatCents(reportData.metrics.netSavingsCents, true)}
              </div>
            </div>
          </div>

          {/* 50/30/20 Allocation Breakdown */}
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-neutral-300">
                50/30/20 Sovereign Allocation Rule
              </span>
              <span className="text-neutral-400 font-mono">
                Needs ≤50% • Wants ≤30% • Savings ≥20%
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-neutral-300 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-400" />
                  <span>Fixed Recurring Needs</span>
                  <span className="text-[10px] font-mono text-neutral-500">
                    (Target ≤ 50%)
                  </span>
                </span>
                <span className="font-mono tabular-nums text-neutral-200">
                  {formatCents(reportData.metrics.fixedCommitmentsCents)}{" "}
                  <span className="text-purple-300 font-semibold">
                    ({reportData.metrics.fixedRatioPct}%)
                  </span>
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-neutral-300 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span>Discretionary Outflows</span>
                  <span className="text-[10px] font-mono text-neutral-500">
                    (Target ≤ 30%)
                  </span>
                </span>
                <span className="font-mono tabular-nums text-neutral-200">
                  {formatCents(reportData.metrics.discretionarySpendCents)}{" "}
                  <span className="text-amber-300 font-semibold">
                    ({reportData.metrics.discretionaryRatioPct}%)
                  </span>
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-neutral-300 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span>Net Capital Saved</span>
                  <span className="text-[10px] font-mono text-neutral-500">
                    (Target ≥ 20%)
                  </span>
                </span>
                <span className="font-mono tabular-nums text-neutral-200">
                  {formatCents(Math.max(0, reportData.metrics.netSavingsCents))}{" "}
                  <span className="text-emerald-400 font-semibold">
                    ({Math.max(0, reportData.metrics.savingsRatePct)}%)
                  </span>
                </span>
              </div>
            </div>

            {/* Budget Adherence Summary Footer */}
            <div className="pt-2 border-t border-neutral-800/80 flex items-center justify-between text-xs">
              <span className="text-neutral-400">
                Total Category Budgets Utilized:
              </span>
              <span className="font-mono tabular-nums text-neutral-200">
                {formatCents(reportData.metrics.budgetSpentCents)} /{" "}
                {formatCents(reportData.metrics.totalBudgetedCents)}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Top 4 Expense Categories & Top 4 Counterparties */}
        <div className="report-card p-4 md:p-5 rounded-xl bg-neutral-900/70 border border-neutral-800 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-200 flex items-center gap-2">
              <FolderTree className="w-4 h-4 text-emerald-400" />
              <span>Top Monthly Expense Drivers</span>
            </h2>
            <span className="text-[11px] text-neutral-400 print-hidden">
              Click to inspect ledger
            </span>
          </div>

          {/* Top Categories */}
          <div className="space-y-2">
            {reportData.topCategories.length === 0 ? (
              <div className="text-xs text-neutral-500 py-2">
                No expense transactions recorded in this period.
              </div>
            ) : (
              reportData.topCategories.map((cat, idx) => (
                <div
                  key={cat.categoryPath}
                  onClick={() => handleDrillDown(cat.name)}
                  className="group flex items-center justify-between p-2 rounded-lg bg-neutral-950/60 hover:bg-neutral-800/70 border border-neutral-800/70 cursor-pointer transition-colors text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono text-neutral-500 w-4">
                      {idx + 1}.
                    </span>
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="font-medium text-neutral-200 group-hover:text-emerald-300 truncate">
                      {cat.categoryPath}
                    </span>
                    <ArrowUpRight className="w-3 h-3 text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity print-hidden shrink-0" />
                  </div>
                  <div className="flex items-center gap-2 font-mono shrink-0 ml-2">
                    <span className="text-[11px] text-neutral-400">
                      ({cat.pct}%)
                    </span>
                    <span className="font-semibold text-neutral-100 tabular-nums">
                      {formatCents(cat.amountCents)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Top Counterparties */}
          <div className="pt-2 border-t border-neutral-800/80 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-sky-400" />
              <span>Top Counterparties / Merchants</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {reportData.topMerchants.map((m) => (
                <div
                  key={m.name}
                  onClick={() => handleDrillDown(m.name)}
                  className="px-2.5 py-1.5 rounded-lg bg-neutral-950/60 hover:bg-neutral-800/70 border border-neutral-800/70 flex items-center justify-between text-xs cursor-pointer transition-colors"
                >
                  <span className="font-medium text-neutral-200 truncate mr-2">
                    {m.name}
                  </span>
                  <span className="font-mono text-[11px] text-rose-300 tabular-nums shrink-0">
                    {formatCents(m.amountCents)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* SURFACE 4: AUTOMATED DETERMINISTIC OBSERVATIONS & INSIGHTS          */}
      {/* =================================================================== */}
      <div className="report-card p-4 md:p-5 rounded-xl bg-neutral-900/70 border border-neutral-800 space-y-3">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-200 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Automated Financial Observations &amp; Advisory</span>
          </h2>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            100% Local Deterministic Engine
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {reportData.insights.map((ins, idx) => (
            <div
              key={idx}
              className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800/90 flex items-start gap-2.5"
            >
              {ins.tone === "positive" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : ins.tone === "warning" ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <Sparkles className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5 text-xs">
                <div className="font-semibold text-neutral-100">
                  {ins.title}
                </div>
                <p className="text-neutral-400 leading-relaxed text-[11px]">
                  {ins.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
