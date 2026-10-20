import React, { useState } from "react";
import { Command, Search, ArrowRight } from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";

export const CommandPaletteModal: React.FC = () => {
  const {
    isCommandPaletteOpen,
    accountSummaries,
    setCommandPaletteOpen,
    setActiveView,
    selectSingleAccount,
    selectAllAccounts,
    setImportModalOpen,
    setNewTransactionRowOpen,
    run100kBenchmark,
  } = useFinFolioStore();

  const [query, setQuery] = useState("");

  if (!isCommandPaletteOpen) return null;

  const actions = [
    {
      label: "Go to Master Virtualized Ledger",
      shortcut: "View",
      run: () => setActiveView("ledger"),
    },
    {
      label: "Open Cash Flow & Category Analytics Dashboard",
      shortcut: "Analytics",
      run: () => setActiveView("analytics"),
    },
    {
      label: "Open Statement Import Staging Grid",
      shortcut: "⌘I",
      run: () => {
        setActiveView("staging");
        setImportModalOpen(false);
      },
    },
    {
      label: "Insert New Manual Transaction Row",
      shortcut: "⌘N",
      run: () => {
        setActiveView("ledger");
        setNewTransactionRowOpen(true);
      },
    },
    {
      label: "Manage Categories (3-Level Tree) & Entities",
      shortcut: "Taxonomy",
      run: () => setActiveView("taxonomy"),
    },
    {
      label: "Manage Import Rules & Dry-Run Simulator",
      shortcut: "Rules",
      run: () => setActiveView("rules"),
    },
    {
      label: "Vault Encryption (Rekey), Export & 100k Benchmark",
      shortcut: "Vault",
      run: () => setActiveView("settings"),
    },
    {
      label: "Select All Accounts",
      shortcut: "Filter",
      run: () => void selectAllAccounts(),
    },
    {
      label: "Run 100,000-Transaction Benchmark (Edge Case 4)",
      shortcut: "QA",
      run: () => void run100kBenchmark(100_000),
    },
    ...accountSummaries.map((s) => ({
      label: `Focus Account: ${s.account.name}`,
      shortcut: s.account.account_type,
      run: () => {
        void selectSingleAccount(s.account.id);
        setActiveView("ledger");
      },
    })),
  ];

  const filtered = actions.filter((a) =>
    a.label.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div
      onClick={() => setCommandPaletteOpen(false)}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-start justify-center pt-24"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl bg-neutral-900 border border-neutral-700 shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2.5">
          <Search className="w-4 h-4 text-emerald-400" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered[0]) {
                filtered[0].run();
                setCommandPaletteOpen(false);
              }
            }}
            placeholder="Jump to any account, view, or trigger import/export..."
            className="w-full bg-transparent text-sm text-white placeholder:text-neutral-500 focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 text-[10px] font-mono text-neutral-400">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-neutral-800/60 p-1.5">
          {filtered.map((item, idx) => (
            <button
              key={idx}
              onClick={() => {
                item.run();
                setCommandPaletteOpen(false);
              }}
              className="w-full px-3 py-2 rounded-lg text-xs text-left flex items-center justify-between text-neutral-200 hover:bg-emerald-500/15 hover:text-emerald-300 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Command className="w-3.5 h-3.5 text-neutral-500" />
                {item.label}
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-mono text-neutral-400">
                {item.shortcut}
                <ArrowRight className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
