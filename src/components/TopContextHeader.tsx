import React from "react";
import {
  Command,
  Plus,
  Search,
  TrendingUp,
  TrendingDown,
  Wallet,
  Activity,
  X,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { formatCents } from "../utils/money";

export const TopContextHeader: React.FC = () => {
  const {
    accountSummaries,
    selectedAccountIds,
    periodInflowCents,
    periodOutflowCents,
    netCashFlowCents,
    startDate,
    endDate,
    searchQuery,
    statusBannerMessage,
    setDateRange,
    setSearchQuery,
    setCommandPaletteOpen,
    setNewTransactionRowOpen,
    setActiveView,
    setStatusBanner,
  } = useFinFolioStore();

  // Compute Selected Balance across currently checked accounts in integer cents
  const selectedBalanceCents = accountSummaries
    .filter((s) => selectedAccountIds.includes(s.account.id))
    .reduce((acc, s) => acc + s.current_balance_cents, 0);

  return (
    <header className="border-b border-neutral-800 bg-neutral-900/90 backdrop-blur-sm shrink-0">
      {statusBannerMessage && (
        <div className="bg-emerald-500/15 border-b border-emerald-500/30 px-4 py-1.5 flex items-center justify-between text-xs text-emerald-300">
          <span className="font-mono">{statusBannerMessage}</span>
          <button
            onClick={() => setStatusBanner(null)}
            className="text-emerald-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="h-16 px-4 flex items-center justify-between gap-4">
        {/* 4 Live KPI Cards */}
        <div className="grid grid-cols-4 gap-3 flex-1 max-w-3xl">
          <div className="px-3 py-1.5 rounded-lg bg-neutral-950/80 border border-neutral-800 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
                Selected Balance ({selectedAccountIds.length})
              </div>
              <div
                className={`text-sm font-bold font-mono tabular-nums ${
                  selectedBalanceCents >= 0
                    ? "text-neutral-100"
                    : "text-rose-400"
                }`}
              >
                {formatCents(selectedBalanceCents)}
              </div>
            </div>
            <Wallet className="w-4 h-4 text-emerald-400/70" />
          </div>

          <div className="px-3 py-1.5 rounded-lg bg-neutral-950/80 border border-neutral-800 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
                Period Inflow
              </div>
              <div className="text-sm font-bold font-mono tabular-nums text-emerald-400">
                {formatCents(periodInflowCents, true)}
              </div>
            </div>
            <TrendingUp className="w-4 h-4 text-emerald-400/70" />
          </div>

          <div className="px-3 py-1.5 rounded-lg bg-neutral-950/80 border border-neutral-800 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
                Period Outflow (Net)
              </div>
              <div className="text-sm font-bold font-mono tabular-nums text-rose-400">
                {formatCents(periodOutflowCents)}
              </div>
            </div>
            <TrendingDown className="w-4 h-4 text-rose-400/70" />
          </div>

          <div className="px-3 py-1.5 rounded-lg bg-neutral-950/80 border border-neutral-800 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
                Net Cash Flow
              </div>
              <div
                className={`text-sm font-bold font-mono tabular-nums ${
                  netCashFlowCents >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {formatCents(netCashFlowCents, true)}
              </div>
            </div>
            <Activity className="w-4 h-4 text-sky-400/70" />
          </div>
        </div>

        {/* Search, Date Range & Quick Actions */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter merchant or raw text..."
              value={searchQuery}
              onChange={(e) => void setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 w-48 rounded-lg bg-neutral-950 border border-neutral-800 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-1 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1 text-xs">
            <input
              type="date"
              value={startDate}
              onChange={(e) => void setDateRange(e.target.value, endDate)}
              className="bg-transparent text-neutral-300 font-mono text-[11px] focus:outline-none"
              title="Start Date Filter"
            />
            <span className="text-neutral-600">→</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => void setDateRange(startDate, e.target.value)}
              className="bg-transparent text-neutral-300 font-mono text-[11px] focus:outline-none"
              title="End Date Filter"
            />
            {(startDate || endDate) && (
              <button
                onClick={() => void setDateRange("", "")}
                className="text-neutral-500 hover:text-neutral-200 ml-1"
                title="Clear Date Filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            onClick={() => {
              setActiveView("ledger");
              setNewTransactionRowOpen(true);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-xs font-medium border border-neutral-700"
            title="New Manual Transaction (⌘N)"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>New Tx</span>
            <kbd className="text-[10px] font-mono text-neutral-400 bg-neutral-900 px-1 rounded">
              ⌘N
            </kbd>
          </button>

          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-950 hover:bg-neutral-800 text-neutral-300 text-xs border border-neutral-800"
            title="Open Command Palette (⌘K)"
          >
            <Command className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-mono text-[11px]">⌘K</span>
          </button>
        </div>
      </div>
    </header>
  );
};
