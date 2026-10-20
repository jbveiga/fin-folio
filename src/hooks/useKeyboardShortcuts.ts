import { useEffect } from "react";
import { useFinFolioStore } from "../stores/useFinFolioStore";

/**
 * Global Keyboard Ergonomics Dispatcher implementing Section 6.2 of `app-bible.md`.
 */
export function useKeyboardShortcuts() {
  const {
    activeView,
    isCommandPaletteOpen,
    isImportModalOpen,
    transactions,
    activeLedgerRowIdx,
    editingTxId,
    stagingResult,
    activeStagingRowIdx,
    setCommandPaletteOpen,
    setImportModalOpen,
    setNewTransactionRowOpen,
    setActiveLedgerRowIdx,
    setEditingTxId,
    setActiveStagingRowIdx,
    toggleSplitExpanded,
    toggleTransactionReconciled,
    confirmActiveStagingRowAndAdvance,
    excludeActiveStagingRow,
    commitAllStagedTransactions,
    ingestRawStatement,
  } = useFinFolioStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      const isMod = event.metaKey || event.ctrlKey;

      // Cmd/Ctrl + K: Open Command Palette (Global)
      if (isMod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
        return;
      }

      // Cmd/Ctrl + I: Open Import Wizard (Global)
      if (isMod && event.key.toLowerCase() === "i") {
        event.preventDefault();
        setImportModalOpen(true);
        return;
      }

      // Cmd/Ctrl + N: Insert new manual transaction row at top of Ledger
      if (isMod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        useFinFolioStore.getState().setActiveView("ledger");
        setNewTransactionRowOpen(true);
        return;
      }

      // Cmd/Ctrl + Enter: Commit all valid staged rows to the main Ledger
      if (isMod && event.key === "Enter") {
        if (activeView === "staging" && stagingResult) {
          event.preventDefault();
          void commitAllStagedTransactions();
        }
        return;
      }

      // Cmd/Ctrl + S: Open/Add a Split line item to the focused transaction
      if (isMod && event.key.toLowerCase() === "s") {
        if (activeView === "ledger" && transactions[activeLedgerRowIdx]) {
          event.preventDefault();
          toggleSplitExpanded(transactions[activeLedgerRowIdx].transaction.id);
        }
        return;
      }

      if (event.key === "Escape") {
        if (isCommandPaletteOpen) setCommandPaletteOpen(false);
        if (isImportModalOpen) setImportModalOpen(false);
        if (editingTxId) setEditingTxId(null);
        setNewTransactionRowOpen(false);
        return;
      }

      // Skip single-key navigation shortcuts when typing inside an input/select
      if (isInputFocused) {
        if (event.key === "Enter" && activeView === "staging") {
          event.preventDefault();
          (target as HTMLElement).blur();
          confirmActiveStagingRowAndAdvance();
        }
        return;
      }

      if (activeView === "ledger") {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveLedgerRowIdx(activeLedgerRowIdx + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveLedgerRowIdx(activeLedgerRowIdx - 1);
        } else if (event.key === " ") {
          event.preventDefault();
          const activeTx = transactions[activeLedgerRowIdx];
          if (activeTx) {
            void toggleTransactionReconciled(activeTx.transaction.id);
          }
        } else if (event.key === "Enter") {
          event.preventDefault();
          const activeTx = transactions[activeLedgerRowIdx];
          if (activeTx) {
            setEditingTxId(activeTx.transaction.id);
          }
        }
      } else if (activeView === "staging") {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveStagingRowIdx(activeStagingRowIdx + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveStagingRowIdx(activeStagingRowIdx - 1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          confirmActiveStagingRowAndAdvance();
        } else if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          excludeActiveStagingRow();
        }
      }
    };

    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (isInputFocused && !isImportModalOpen) return;

      const htmlData = event.clipboardData?.getData("text/html") || "";
      const textData = event.clipboardData?.getData("text/plain") || "";

      if (htmlData && htmlData.toLowerCase().includes("<table")) {
        event.preventDefault();
        const bytes = Array.from(new TextEncoder().encode(htmlData));
        void ingestRawStatement("clipboard_table.html", bytes, "text/html");
      } else if (
        textData &&
        (textData.includes(";") || textData.includes("\t")) &&
        textData.split(/\r?\n/).length >= 2
      ) {
        event.preventDefault();
        const bytes = Array.from(new TextEncoder().encode(textData));
        void ingestRawStatement("clipboard_paste.csv", bytes, "text/plain");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("paste", handlePaste);
    };
  }, [
    activeView,
    isCommandPaletteOpen,
    isImportModalOpen,
    transactions,
    activeLedgerRowIdx,
    editingTxId,
    stagingResult,
    activeStagingRowIdx,
    setCommandPaletteOpen,
    setImportModalOpen,
    setNewTransactionRowOpen,
    setActiveLedgerRowIdx,
    setEditingTxId,
    setActiveStagingRowIdx,
    toggleSplitExpanded,
    toggleTransactionReconciled,
    confirmActiveStagingRowAndAdvance,
    excludeActiveStagingRow,
    commitAllStagedTransactions,
    ingestRawStatement,
  ]);
}
