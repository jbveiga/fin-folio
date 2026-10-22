import React, { useState } from "react";
import {
  BookOpen,
  BarChart3,
  Target,
  CalendarClock,
  Award,
  UploadCloud,
  FolderTree,
  Sparkles,
  Settings,
  Lock,
  Unlock,
  Plus,
  CheckSquare,
  Square,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Zap,
  Pencil,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { AccountType, ActiveView, CurrencyCode } from "../types";
import { formatCurrency, parseCentsInput } from "../utils/money";
import { convertCurrency } from "../utils/fx";

export const LeftNavigationRail: React.FC = () => {
  const {
    activeView,
    isSidebarCollapsed,
    vaultStatus,
    baseCurrency,
    fxRates,
    accountSummaries,
    selectedAccountIds,
    stagingResult,
    lastFilterDurationMs,
    setActiveView,
    toggleSidebar,
    toggleAccountSelection,
    selectAllAccounts,
    selectSingleAccount,
    saveAccount,
    setImportModalOpen,
  } = useFinFolioStore();

  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [newAccName, setNewAccName] = useState("");
  const [newAccType, setNewAccType] = useState<AccountType>("Checking");
  const [newAccCurrency, setNewAccCurrency] = useState<CurrencyCode>("EUR");
  const [newAccAnchorStr, setNewAccAnchorStr] = useState("1000,00");
  const [newAccAnchorDate, setNewAccAnchorDate] = useState("2026-10-20");
  const [newAccIncludeTotals, setNewAccIncludeTotals] = useState(true);

  const navItems: {
    id: ActiveView;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }[] = [
    {
      id: "ledger",
      label: "Ledger",
      icon: <BookOpen className="w-4 h-4" />,
    },
    {
      id: "analytics",
      label: "Analytics",
      icon: <BarChart3 className="w-4 h-4" />,
    },
    {
      id: "budgets",
      label: "Budgets",
      icon: <Target className="w-4 h-4" />,
    },
    {
      id: "recurring",
      label: "Recurring & Bills",
      icon: <CalendarClock className="w-4 h-4" />,
    },
    {
      id: "report",
      label: "Report Card",
      icon: <Award className="w-4 h-4" />,
    },
    {
      id: "staging",
      label: "Import Staging",
      icon: <UploadCloud className="w-4 h-4" />,
      badge: stagingResult?.staged_rows.filter((r) => r.is_selected_for_import)
        .length,
    },
    {
      id: "taxonomy",
      label: "Categories & Entities",
      icon: <FolderTree className="w-4 h-4" />,
    },
    {
      id: "rules",
      label: "Import Rules",
      icon: <Sparkles className="w-4 h-4" />,
    },
    {
      id: "settings",
      label: "Vault & Portability",
      icon: <Settings className="w-4 h-4" />,
    },
  ];

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    await saveAccount({
      id: editingAccountId || "",
      name: newAccName.trim(),
      account_type: newAccType,
      currency: newAccCurrency,
      anchor_balance_cents: parseCentsInput(newAccAnchorStr),
      anchor_date: newAccAnchorDate,
      is_included_in_totals: newAccIncludeTotals,
    });
    setNewAccName("");
    setEditingAccountId(null);
    setIsAddingAccount(false);
  };

  if (isSidebarCollapsed) {
    return (
      <aside
        data-tauri-drag-region
        className="hidden md:flex w-14 h-screen bg-neutral-900 border-r border-neutral-800 flex-col items-center pt-10 pb-3 justify-between shrink-0"
      >
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={toggleSidebar}
            title="Expand Navigation Rail"
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
          <div className="w-6 h-px bg-neutral-800" />
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              title={item.label}
              className={`p-2.5 rounded-lg transition-colors ${
                activeView === item.id
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
              }`}
            >
              {item.icon}
            </button>
          ))}
        </div>
        <button
          onClick={() => setActiveView("settings")}
          title={
            vaultStatus?.is_encrypted
              ? "Vault Encrypted (SQLCipher AES-256)"
              : "Vault Unencrypted"
          }
          className="p-2 rounded-lg text-emerald-400 hover:bg-neutral-800"
        >
          {vaultStatus?.is_encrypted ? (
            <Lock className="w-4 h-4" />
          ) : (
            <Unlock className="w-4 h-4 text-amber-400" />
          )}
        </button>
      </aside>
    );
  }

  const allSelected =
    accountSummaries.length > 0 &&
    selectedAccountIds.length === accountSummaries.length;

  return (
    <aside className="hidden md:flex w-[240px] h-screen bg-neutral-900 border-r border-neutral-800 flex-col justify-between shrink-0 select-none">
      {/* Top Brand + Primary Views (with macOS traffic lights clearance & drag region) */}
      <div data-tauri-drag-region className="pt-8 px-3 pb-3 space-y-4">
        <div
          data-tauri-drag-region
          className="flex items-center justify-between px-1 cursor-default"
        >
          <div data-tauri-drag-region className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-xs">
              FF
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-white leading-none">
                FinFolio
              </div>
              <div className="text-[10px] text-neutral-400 font-mono mt-0.5">
                LOCAL-FIRST v2.0
              </div>
            </div>
          </div>
          <button
            onClick={toggleSidebar}
            title="Collapse Sidebar"
            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                  active
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    : "text-neutral-300 hover:text-white hover:bg-neutral-800/70"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  {item.icon}
                  {item.label}
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono rounded-full bg-emerald-500/20 text-emerald-300">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <button
          onClick={() => setImportModalOpen(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-semibold text-xs transition-colors shadow-sm"
        >
          <UploadCloud className="w-3.5 h-3.5" />
          <span>Import Statement (⌘I)</span>
        </button>
      </div>

      {/* Middle Section: Multi-Account Switcher */}
      <div className="flex-1 overflow-y-auto px-3 py-2 border-t border-neutral-800/80 space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Accounts
          </span>
          <div className="flex items-center gap-1.5">
            <span
              title="Last account filter recalculation time"
              className="text-[10px] font-mono text-emerald-400/90 flex items-center gap-0.5 bg-emerald-500/10 px-1.5 py-0.5 rounded"
            >
              <Zap className="w-2.5 h-2.5" />
              {lastFilterDurationMs}ms
            </span>
            <button
              onClick={() => void selectAllAccounts()}
              className="text-[10px] text-neutral-400 hover:text-emerald-400 underline"
            >
              {allSelected ? "All" : "Select All"}
            </button>
          </div>
        </div>

        <div className="space-y-1">
          {accountSummaries.map((summary) => {
            const { account, current_balance_cents } = summary;
            const isChecked = selectedAccountIds.includes(account.id);
            const accCurrency = account.currency || "EUR";
            const isNonBase = accCurrency !== baseCurrency;
            const convertedBalance =
              summary.converted_balance_cents ??
              convertCurrency(
                current_balance_cents,
                accCurrency,
                baseCurrency,
                fxRates
              );

            return (
              <div
                key={account.id}
                className={`group flex items-center justify-between px-2 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                  isChecked
                    ? "bg-neutral-800/90 border-neutral-700 text-neutral-100"
                    : "bg-neutral-900/40 border-transparent text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-300"
                }`}
                onClick={() => void toggleAccountSelection(account.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  void selectSingleAccount(account.id);
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-emerald-400 shrink-0">
                    {isChecked ? (
                      <CheckSquare className="w-3.5 h-3.5" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-neutral-600" />
                    )}
                  </span>
                  <div className="truncate">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-medium truncate">{account.name}</span>
                      {isNonBase && (
                        <span className="px-1 py-0.2 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[9px] font-mono font-semibold shrink-0">
                          {accCurrency}
                        </span>
                      )}
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingAccountId(account.id);
                        setNewAccName(account.name);
                        setNewAccType(account.account_type);
                        setNewAccCurrency(account.currency || "EUR");
                        setNewAccAnchorStr(
                          (account.anchor_balance_cents / 100)
                            .toFixed(2)
                            .replace(".", ",")
                        );
                        setNewAccAnchorDate(account.anchor_date);
                        setIsAddingAccount(true);
                      }}
                      title="Click to calibrate Anchor Balance & Anchor Date"
                      className="text-[10px] text-neutral-500 hover:text-emerald-400 underline decoration-dotted"
                    >
                      {account.account_type} • Anchor {account.anchor_date}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <div className="text-right">
                    <div
                      className={`font-mono text-[11px] tabular-nums font-semibold ${
                        current_balance_cents >= 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                      }`}
                    >
                      {formatCurrency(current_balance_cents, accCurrency)}
                    </div>
                    {isNonBase && (
                      <div
                        className="font-mono text-[9px] text-neutral-400 tabular-nums leading-none mt-0.5"
                        title={`Converted to ${baseCurrency} at 1 ${accCurrency} = ${(
                          (fxRates.ratesBasisPoints[accCurrency] || 10000) /
                          10000
                        ).toFixed(4)} ${baseCurrency}`}
                      >
                        ≈ {formatCurrency(convertedBalance, baseCurrency)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingAccountId(account.id);
                      setNewAccName(account.name);
                      setNewAccType(account.account_type);
                      setNewAccCurrency(account.currency || "EUR");
                      setNewAccAnchorStr(
                        (account.anchor_balance_cents / 100)
                          .toFixed(2)
                          .replace(".", ",")
                      );
                      setNewAccAnchorDate(account.anchor_date);
                      setNewAccIncludeTotals(account.is_included_in_totals);
                      setIsAddingAccount(true);
                    }}
                    title="Edit Account & Anchor Balance"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-neutral-500 hover:text-white hover:bg-neutral-700 transition-opacity"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {!isAddingAccount ? (
          <button
            onClick={() => {
              setEditingAccountId(null);
              setNewAccName("");
              setNewAccCurrency("EUR");
              setNewAccAnchorStr("1000,00");
              setIsAddingAccount(true);
            }}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-neutral-400 hover:text-emerald-400 hover:bg-neutral-800/60 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Account & Anchor</span>
          </button>
        ) : (
          <form
            onSubmit={(e) => void handleCreateAccount(e)}
            className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 space-y-2 text-xs"
          >
            <div className="font-semibold text-neutral-200">
              {editingAccountId
                ? "Edit Account & Anchor"
                : "New Account & Anchor"}
            </div>
            <input
              type="text"
              placeholder="Account Name (e.g. BPI Ordem)"
              value={newAccName}
              onChange={(e) => setNewAccName(e.target.value)}
              className="w-full px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-white focus:outline-none focus:border-emerald-500"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={newAccType}
                onChange={(e) => setNewAccType(e.target.value as AccountType)}
                className="w-full px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-white"
              >
                <option value="Checking">Checking</option>
                <option value="Savings">Savings</option>
                <option value="CreditCard">Credit Card</option>
                <option value="Cash">Cash</option>
                <option value="MealCard">Meal Card</option>
              </select>
              <select
                value={newAccCurrency}
                onChange={(e) =>
                  setNewAccCurrency(e.target.value as CurrencyCode)
                }
                className="w-full px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-white font-mono text-[11px]"
                title="Account Currency (ISO-4217)"
              >
                <option value="EUR">EUR — Euro (€)</option>
                <option value="USD">USD — Dollar ($)</option>
                <option value="GBP">GBP — Pound (£)</option>
                <option value="CHF">CHF — Franc (CHF)</option>
              </select>
            </div>
            <div className="text-[10px] text-neutral-500 leading-tight">
              All transactions in this account will be recorded in this native currency.
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-neutral-400">
                  Anchor Balance (€)
                </label>
                <input
                  type="text"
                  value={newAccAnchorStr}
                  onChange={(e) => setNewAccAnchorStr(e.target.value)}
                  className="w-full px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-400">
                  Anchor Date
                </label>
                <input
                  type="date"
                  value={newAccAnchorDate}
                  onChange={(e) => setNewAccAnchorDate(e.target.value)}
                  className="w-full px-1.5 py-1 rounded bg-neutral-900 border border-neutral-700 text-white font-mono text-[11px]"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-neutral-300 cursor-pointer pt-0.5">
              <input
                type="checkbox"
                checked={newAccIncludeTotals}
                onChange={(e) => setNewAccIncludeTotals(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-900 text-emerald-500"
              />
              <span>Include in net worth totals</span>
            </label>
            <div className="text-[10px] text-neutral-400 leading-tight bg-neutral-900/70 p-1.5 rounded border border-neutral-800">
              ℹ️ FinFolio calculates retroactive &amp; forward balances starting
              from this anchor balance.
            </div>
            <div className="flex justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsAddingAccount(false);
                  setEditingAccountId(null);
                }}
                className="px-2 py-1 rounded text-neutral-400 hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-2.5 py-1 rounded bg-emerald-600 text-neutral-950 font-semibold hover:bg-emerald-500"
              >
                Save Account
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Bottom Section: Vault Status Indicator & Air-Gap Badge */}
      <div className="p-3 border-t border-neutral-800 bg-neutral-950/50 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-neutral-300">
            {vaultStatus?.is_encrypted ? (
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Unlock className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span className="font-medium truncate">
              {vaultStatus?.is_encrypted
                ? "SQLCipher AES-256"
                : "Unencrypted Vault"}
            </span>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            WAL
          </span>
        </div>
        <div className="text-[10px] text-neutral-500 font-mono truncate">
          {vaultStatus?.path || "In-Memory .finfolio Vault"}
        </div>
      </div>
    </aside>
  );
};
