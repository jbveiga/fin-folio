import React from "react";
import {
  BookOpen,
  BarChart3,
  Target,
  CalendarClock,
  Wallet,
  Plus,
  Settings,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { ActiveView } from "../types";

interface MobileBottomBarProps {
  isAccountDrawerOpen: boolean;
  onOpenAccounts: () => void;
  onOpenQuickAdd: () => void;
}

export const MobileBottomBar: React.FC<MobileBottomBarProps> = ({
  isAccountDrawerOpen,
  onOpenAccounts,
  onOpenQuickAdd,
}) => {
  const { activeView, setActiveView, selectedAccountIds } = useFinFolioStore();

  const handleNav = (view: ActiveView) => {
    setActiveView(view);
  };

  return (
    <nav
      aria-label="Mobile Bottom Navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-neutral-950/95 backdrop-blur-md border-t border-neutral-800 pb-[env(safe-area-inset-bottom)] select-none"
    >
      <div className="h-14 grid grid-cols-7 items-center px-0.5">
        {/* Slot 1: Ledger */}
        <button
          type="button"
          onClick={() => handleNav("ledger")}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium transition-colors ${
            activeView === "ledger" && !isAccountDrawerOpen
              ? "text-emerald-400"
              : "text-neutral-400 active:text-neutral-200"
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Ledger</span>
        </button>

        {/* Slot 2: Analytics */}
        <button
          type="button"
          onClick={() => handleNav("analytics")}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium transition-colors ${
            activeView === "analytics" && !isAccountDrawerOpen
              ? "text-emerald-400"
              : "text-neutral-400 active:text-neutral-200"
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Analytics</span>
        </button>

        {/* Slot 3: Budgets */}
        <button
          type="button"
          onClick={() => handleNav("budgets")}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium transition-colors ${
            activeView === "budgets" && !isAccountDrawerOpen
              ? "text-emerald-400"
              : "text-neutral-400 active:text-neutral-200"
          }`}
        >
          <Target className="w-4 h-4" />
          <span>Budgets</span>
        </button>

        {/* Slot 4: Quick Add FAB (+) */}
        <div className="flex flex-col items-center justify-center h-full">
          <button
            type="button"
            onClick={onOpenQuickAdd}
            aria-label="Quick Add Transaction"
            className="w-10 h-10 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-full flex items-center justify-center -translate-y-2 shadow-lg shadow-emerald-500/25 active:scale-95 transition-transform"
          >
            <Plus className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        {/* Slot 5: Recurring Bills */}
        <button
          type="button"
          onClick={() => handleNav("recurring")}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium transition-colors ${
            activeView === "recurring" && !isAccountDrawerOpen
              ? "text-emerald-400"
              : "text-neutral-400 active:text-neutral-200"
          }`}
        >
          <CalendarClock className="w-4 h-4" />
          <span>Bills</span>
        </button>

        {/* Slot 6: Accounts Drawer Trigger */}
        <button
          type="button"
          onClick={onOpenAccounts}
          className={`relative flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium transition-colors ${
            isAccountDrawerOpen
              ? "text-emerald-400"
              : "text-neutral-400 active:text-neutral-200"
          }`}
        >
          <div className="relative">
            <Wallet className="w-4 h-4" />
            {selectedAccountIds.length > 0 && (
              <span className="absolute -top-1.5 -right-2.5 px-1 min-w-[14px] h-[14px] rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[9px] flex items-center justify-center">
                {selectedAccountIds.length}
              </span>
            )}
          </div>
          <span>Accounts</span>
        </button>

        {/* Slot 6: Settings, Categories & Vault */}
        <button
          type="button"
          onClick={() => handleNav("settings")}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium transition-colors ${
            (activeView === "settings" ||
              activeView === "taxonomy" ||
              activeView === "rules" ||
              activeView === "staging") &&
            !isAccountDrawerOpen
              ? "text-emerald-400"
              : "text-neutral-400 active:text-neutral-200"
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Vault</span>
        </button>
      </div>
    </nav>
  );
};
