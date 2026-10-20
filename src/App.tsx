import { useEffect, useState } from "react";
import { LeftNavigationRail } from "./components/LeftNavigationRail";
import { TopContextHeader } from "./components/TopContextHeader";
import { VirtualizedLedgerView } from "./components/VirtualizedLedgerView";
import { ImportStagingView } from "./components/ImportStagingView";
import {
  ImportRulesView,
  TaxonomyView,
  VaultSettingsView,
} from "./components/TaxonomyAndRulesView";
import { CommandPaletteModal } from "./components/CommandPaletteModal";
import { MobileBottomBar } from "./components/MobileBottomBar";
import { MobileAccountDrawer } from "./components/MobileAccountDrawer";
import { MobileQuickAddModal } from "./components/MobileQuickAddModal";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useFinFolioStore } from "./stores/useFinFolioStore";

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
          {activeView === "ledger" && <VirtualizedLedgerView />}
          {activeView === "staging" && <ImportStagingView />}
          {activeView === "taxonomy" && <TaxonomyView />}
          {activeView === "rules" && <ImportRulesView />}
          {activeView === "settings" && <VaultSettingsView />}
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

      <MobileQuickAddModal
        isOpen={isMobileQuickAddOpen}
        onClose={() => setMobileQuickAddOpen(false)}
      />

      <CommandPaletteModal />
    </div>
  );
}

export default App;
