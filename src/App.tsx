import React, { lazy, Suspense, useEffect, useState } from "react";
import { LeftNavigationRail } from "./components/LeftNavigationRail";
import { TopContextHeader } from "./components/TopContextHeader";
import { VirtualizedLedgerView } from "./components/VirtualizedLedgerView";
import { MobileBottomBar } from "./components/MobileBottomBar";
import { MobileAccountDrawer } from "./components/MobileAccountDrawer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useFinFolioStore } from "./stores/useFinFolioStore";

const MobileQuickAddModal = lazy(() =>
  import("./components/MobileQuickAddModal").then((m) => ({
    default: m.MobileQuickAddModal,
  }))
);

const CommandPaletteModal = lazy(() =>
  import("./components/CommandPaletteModal").then((m) => ({
    default: m.CommandPaletteModal,
  }))
);

// Dynamically chunked secondary views for fast initial bundle paint
const AnalyticsView = lazy(() =>
  import("./components/AnalyticsView").then((m) => ({
    default: m.AnalyticsView,
  }))
);
const BudgetsView = lazy(() =>
  import("./components/BudgetsView").then((m) => ({
    default: m.BudgetsView,
  }))
);
const RecurringView = lazy(() =>
  import("./components/RecurringView").then((m) => ({
    default: m.RecurringView,
  }))
);
const ReportCardView = lazy(() =>
  import("./components/ReportCardView").then((m) => ({
    default: m.ReportCardView,
  }))
);
const ImportStagingView = lazy(() =>
  import("./components/ImportStagingView").then((m) => ({
    default: m.ImportStagingView,
  }))
);
const TaxonomyView = lazy(() =>
  import("./components/TaxonomyAndRulesView").then((m) => ({
    default: m.TaxonomyView,
  }))
);
const ImportRulesView = lazy(() =>
  import("./components/TaxonomyAndRulesView").then((m) => ({
    default: m.ImportRulesView,
  }))
);
const VaultSettingsView = lazy(() =>
  import("./components/TaxonomyAndRulesView").then((m) => ({
    default: m.VaultSettingsView,
  }))
);

const ViewLoaderFallback: React.FC = () => (
  <div className="h-full w-full flex flex-col items-center justify-center gap-3 bg-neutral-950 text-neutral-400">
    <div className="w-8 h-8 rounded-full border-2 border-emerald-500/20 border-t-emerald-400 animate-spin" />
    <span className="text-xs font-mono tracking-wider uppercase text-neutral-500">
      Loading module...
    </span>
  </div>
);

export function App() {
  useKeyboardShortcuts();

  const {
    activeView,
    isImportModalOpen,
    initializeWorkspace,
    setActiveView,
    setImportModalOpen,
  } = useFinFolioStore();

  const [isMobileAccountDrawerOpen, setMobileAccountDrawerOpen] =
    useState(false);
  const [isMobileQuickAddOpen, setMobileQuickAddOpen] = useState(false);

  useEffect(() => {
    void initializeWorkspace();
  }, [initializeWorkspace]);

  useEffect(() => {
    if (isImportModalOpen) {
      setActiveView("staging");
      setImportModalOpen(false);
    }
  }, [isImportModalOpen, setActiveView, setImportModalOpen]);

  return (
    <div className="flex h-[100dvh] w-screen bg-neutral-950 text-neutral-100 overflow-hidden font-sans">
      <LeftNavigationRail />

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <TopContextHeader />

        <main className="flex-1 min-h-0 overflow-hidden">
          <ErrorBoundary>
            <Suspense fallback={<ViewLoaderFallback />}>
              {activeView === "ledger" && <VirtualizedLedgerView />}
              {activeView === "analytics" && <AnalyticsView />}
              {activeView === "budgets" && <BudgetsView />}
              {activeView === "recurring" && <RecurringView />}
              {activeView === "report" && <ReportCardView />}
              {activeView === "staging" && <ImportStagingView />}
              {activeView === "taxonomy" && <TaxonomyView />}
              {activeView === "rules" && <ImportRulesView />}
              {activeView === "settings" && <VaultSettingsView />}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <MobileBottomBar
        isAccountDrawerOpen={isMobileAccountDrawerOpen}
        onOpenAccounts={() => setMobileAccountDrawerOpen(true)}
        onOpenQuickAdd={() => setMobileQuickAddOpen(true)}
      />

      <MobileAccountDrawer
        isOpen={isMobileAccountDrawerOpen}
        onClose={() => setMobileAccountDrawerOpen(false)}
      />

      {isMobileQuickAddOpen && (
        <Suspense fallback={null}>
          <MobileQuickAddModal
            isOpen={isMobileQuickAddOpen}
            onClose={() => setMobileQuickAddOpen(false)}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <CommandPaletteModal />
      </Suspense>
    </div>
  );
}

export default App;
