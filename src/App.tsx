import { useEffect } from "react";
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
    <div className="flex h-screen w-screen bg-neutral-950 text-neutral-100 overflow-hidden font-sans">
      <LeftNavigationRail />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <TopContextHeader />

        <main className="flex-1 min-h-0 overflow-hidden">
          {activeView === "ledger" && <VirtualizedLedgerView />}
          {activeView === "staging" && <ImportStagingView />}
          {activeView === "taxonomy" && <TaxonomyView />}
          {activeView === "rules" && <ImportRulesView />}
          {activeView === "settings" && <VaultSettingsView />}
        </main>
      </div>

      <CommandPaletteModal />
    </div>
  );
}

export default App;
