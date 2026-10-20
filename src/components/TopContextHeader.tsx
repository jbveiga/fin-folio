import React, { useMemo, useState } from "react";
import {
  Command,
  Plus,
  Search,
  TrendingUp,
  TrendingDown,
  Wallet,
  Activity,
  Lock,
  Unlock,
  X,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { formatCents } from "../utils/money";
import { getActiveDatePresetId, getDatePresets } from "../utils/datePresets";

export const TopContextHeader: React.FC = () => {
  const {
    vaultStatus,
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

  const [isMobileSearchOpen, setMobileSearchOpen] = useState(false);

  const presets = useMemo(() => getDatePresets(), []);
  const activePresetId = useMemo(
    () => getActiveDatePresetId(startDate, endDate, presets),
    [startDate, endDate, presets]
  );

  // Compute Selected Balance across currently checked accounts in integer cents
  const selectedBalanceCents = accountSummaries
    .filter((s) => selectedAccountIds.includes(s.account.id))
    .reduce((acc, s) => acc + s.current_balance_cents, 0);

  return (
    <header className="border-b border-neutral-800 bg-neutral-900/90 backdrop-blur-sm shrink-0 pt-[max(0px,env(safe-area-inset-top))]">
      {statusBannerMessage && (
        <div className="bg-emerald-500/15 border-b border-emerald-500/30 px-3 md:px-4 py-1.5 flex items-center justify-between text-xs text-emerald-300">
          <span className="font-mono truncate">{statusBannerMessage}</span>
          <button
            onClick={() => setStatusBanner(null)}
            className="text-emerald-400 hover:text-white ml-2 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* =================================================================== */}
      {/* MOBILE HEADER (< 768px): Brand + Search Trigger + 2 Essential KPIs  */}
      {/* =================================================================== */}
      <div className="md:hidden px-3 py-2 space-y-2">
        {/* Top Row: Brand, Search Toggle & Vault Badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-xs">
              FF
            </div>
            <span className="text-sm font-semibold tracking-tight text-white">
              FinFolio
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMobileSearchOpen((v) => !v)}
              className={`px-2.5 py-1 rounded-lg border text-xs flex items-center gap-1.5 transition-colors ${
                isMobileSearchOpen || searchQuery || startDate || endDate
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : "bg-neutral-950 border-neutral-800 text-neutral-300"
              }`}
              title="Toggle Search & Date Filter"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Filter</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView("settings")}
              className="px-2 py-1 rounded-lg bg-neutral-950 border border-neutral-800 text-[11px] text-neutral-300 flex items-center gap-1"
              title="Vault Security Status"
            >
              {vaultStatus?.is_encrypted ? (
                <>
                  <Lock className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">Encrypted</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3 h-3 text-amber-400" />
                  <span className="text-neutral-300">Vault</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Expandable Mobile Search & Date Filter Strip */}
        {(isMobileSearchOpen || searchQuery || startDate || endDate) && (
          <div className="p-2 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5" />
              <input
                type="text"
                placeholder="Filter merchant, category, or description..."
                value={searchQuery}
                onChange={(e) => void setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => void setSearchQuery("")}
                  className="absolute right-2 text-neutral-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Horizontally Scrollable Mobile Date Preset Strip */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
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
                        : "bg-neutral-900 text-neutral-400 border border-neutral-800"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-1.5 text-xs">
              <input
                type="date"
                value={startDate}
                onChange={(e) => void setDateRange(e.target.value, endDate)}
                className="flex-1 px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-300 font-mono text-[11px]"
              />
              <span className="text-neutral-500">→</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => void setDateRange(startDate, e.target.value)}
                className="flex-1 px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-300 font-mono text-[11px]"
              />
              {(startDate || endDate) && (
                <button
                  type="button"
                  onClick={() => void setDateRange("", "")}
                  className="px-2 py-1 rounded-lg bg-neutral-800 text-neutral-300 text-[11px]"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Row 2: 2 Essential Mobile KPIs (Selected Balance & Net Cash Flow) */}
        <div className="grid grid-cols-2 gap-2">
          <div className="px-3 py-1.5 rounded-xl bg-neutral-950/90 border border-neutral-800 flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold truncate">
                Selected Balance ({selectedAccountIds.length})
              </div>
              <div
                className={`text-sm font-bold font-mono tabular-nums truncate ${
                  selectedBalanceCents >= 0
                    ? "text-neutral-100"
                    : "text-rose-400"
                }`}
              >
                {formatCents(selectedBalanceCents)}
              </div>
            </div>
            <Wallet className="w-4 h-4 text-emerald-400/70 shrink-0 ml-1" />
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-neutral-950/90 border border-neutral-800 flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold truncate">
                Net Cash Flow
              </div>
              <div
                className={`text-sm font-bold font-mono tabular-nums truncate ${
                  netCashFlowCents >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {formatCents(netCashFlowCents, true)}
              </div>
            </div>
            <Activity className="w-4 h-4 text-sky-400/70 shrink-0 ml-1" />
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* DESKTOP HEADER (>= 768px): 4 Live KPI Cards + Search & Date Presets */}
      {/* =================================================================== */}
      <div className="hidden md:flex flex-col px-4 py-2 gap-2">
        <div className="flex items-center justify-between gap-4">
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

          {/* Search & Quick Actions */}
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

        {/* Desktop Temporal Filter Strip: Segmented Date Presets + Custom Date Picker */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-neutral-800/60">
          <div className="flex items-center gap-1 bg-neutral-950 p-0.5 rounded-lg border border-neutral-800 text-xs">
            {presets.map((preset) => {
              const isActive = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    void setDateRange(preset.startDate, preset.endDate)
                  }
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    isActive
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "text-neutral-400 hover:text-white border border-transparent"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold mr-1">
              Range
            </span>
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
        </div>
      </div>
    </header>
  );
};
