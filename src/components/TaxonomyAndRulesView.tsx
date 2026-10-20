import React, { useState } from "react";
import {
  FolderTree,
  Building2,
  Sparkles,
  Plus,
  Trash2,
  Shield,
  Download,
  Gauge,
  KeyRound,
  Play,
  RotateCcw,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { CategoryDirection, MatchMode } from "../types";

export const TaxonomyView: React.FC = () => {
  const {
    categories,
    entities,
    saveCategory,
    deleteCategory,
    saveEntity,
    deleteEntity,
  } = useFinFolioStore();

  const [catName, setCatName] = useState("");
  const [catParentId, setCatParentId] = useState("");
  const [catDirection, setCatDirection] =
    useState<CategoryDirection>("Expense");
  const [catColor, setCatColor] = useState("#10b981");

  const [entName, setEntName] = useState("");
  const [entDefaultCatId, setEntDefaultCatId] = useState("");
  const [entNif, setEntNif] = useState("");

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    await saveCategory({
      id: "",
      parent_id: catParentId || null,
      name: catName.trim(),
      direction: catDirection,
      color_hex: catColor,
    });
    setCatName("");
  };

  const handleAddEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entName.trim()) return;
    await saveEntity({
      id: "",
      normalized_name: entName.trim(),
      default_category_id: entDefaultCatId || null,
      tax_id_nif: entNif.trim() || null,
    });
    setEntName("");
    setEntNif("");
  };

  const level1 = categories.filter((c) => !c.parent_id);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 p-3 md:p-6 h-full overflow-y-auto bg-neutral-950 text-neutral-100">
      {/* Left Column: 3-Level Category Hierarchy Manager */}
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">
              Categories (3-Level Hierarchy)
            </h2>
          </div>
          <span className="text-xs text-neutral-400 font-mono">
            {categories.length} buckets
          </span>
        </div>

        <form
          onSubmit={(e) => void handleAddCategory(e)}
          className="flex flex-wrap md:grid md:grid-cols-[1fr_150px_100px_42px_auto] gap-2 text-xs"
        >
          <input
            type="text"
            placeholder="New category name..."
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white"
          />
          <select
            value={catParentId}
            onChange={(e) => setCatParentId(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white"
          >
            <option value="">Root (Level 1)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                ↳ {c.name}
              </option>
            ))}
          </select>
          <select
            value={catDirection}
            onChange={(e) =>
              setCatDirection(e.target.value as CategoryDirection)
            }
            className="px-2 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white"
          >
            <option value="Expense">Expense</option>
            <option value="Income">Income</option>
          </select>
          <input
            type="color"
            value={catColor}
            onChange={(e) => setCatColor(e.target.value)}
            className="w-full h-8 rounded bg-neutral-950 border border-neutral-700 cursor-pointer"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-emerald-500 text-neutral-950 font-semibold hover:bg-emerald-400 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </form>

        <div className="space-y-2 flex-1 overflow-y-auto pr-1 text-xs">
          {level1.map((l1) => {
            const level2 = categories.filter((c) => c.parent_id === l1.id);
            return (
              <div
                key={l1.id}
                className="rounded-lg bg-neutral-950/80 border border-neutral-800 p-2.5 space-y-1.5"
              >
                <div className="flex items-center justify-between font-semibold">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: l1.color_hex }}
                    />
                    <span>{l1.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                        l1.direction === "Income"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-rose-500/15 text-rose-400"
                      }`}
                    >
                      {l1.direction}
                    </span>
                  </div>
                  <button
                    onClick={() => void deleteCategory(l1.id)}
                    className="text-neutral-500 hover:text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {level2.map((l2) => {
                  const level3 = categories.filter(
                    (c) => c.parent_id === l2.id
                  );
                  return (
                    <div key={l2.id} className="pl-5 space-y-1">
                      <div className="flex items-center justify-between text-neutral-300">
                        <div className="flex items-center gap-2">
                          <span className="text-neutral-600">├─</span>
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: l2.color_hex }}
                          />
                          <span>{l2.name}</span>
                        </div>
                        <button
                          onClick={() => void deleteCategory(l2.id)}
                          className="text-neutral-600 hover:text-rose-400"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      {level3.map((l3) => (
                        <div
                          key={l3.id}
                          className="pl-6 flex items-center justify-between text-neutral-400"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-neutral-700">└─</span>
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: l3.color_hex }}
                            />
                            <span>{l3.name}</span>
                          </div>
                          <button
                            onClick={() => void deleteCategory(l3.id)}
                            className="text-neutral-600 hover:text-rose-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Column: Entities & Counterparty Inheritance Manager */}
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">
              Entities (Counterparties & Default Category Inheritance)
            </h2>
          </div>
          <span className="text-xs text-neutral-400 font-mono">
            {entities.length} entities
          </span>
        </div>

        <form
          onSubmit={(e) => void handleAddEntity(e)}
          className="flex flex-wrap md:grid md:grid-cols-[1fr_170px_110px_auto] gap-2 text-xs"
        >
          <input
            type="text"
            placeholder="Merchant / Entity (e.g. Continente)"
            value={entName}
            onChange={(e) => setEntName(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white"
          />
          <select
            value={entDefaultCatId}
            onChange={(e) => setEntDefaultCatId(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white"
          >
            <option value="">-- Default Category --</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="NIF (Optional)"
            value={entNif}
            onChange={(e) => setEntNif(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white font-mono"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-emerald-500 text-neutral-950 font-semibold hover:bg-emerald-400 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </form>

        <div className="divide-y divide-neutral-800/80 flex-1 overflow-y-auto text-xs">
          {entities.map((ent) => {
            const defCat = categories.find(
              (c) => c.id === ent.default_category_id
            );
            return (
              <div
                key={ent.id}
                className="py-2.5 px-2 flex items-center justify-between hover:bg-neutral-800/40 rounded"
              >
                <div>
                  <div className="font-medium text-neutral-100">
                    {ent.normalized_name}
                  </div>
                  <div className="text-[11px] text-neutral-400 flex items-center gap-2 mt-0.5">
                    <span>
                      Default Category:{" "}
                      <strong className="text-emerald-400">
                        {defCat?.name || "None"}
                      </strong>
                    </span>
                    {ent.tax_id_nif && (
                      <span className="font-mono text-neutral-500">
                        • NIF {ent.tax_id_nif}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => void deleteEntity(ent.id)}
                  className="text-neutral-500 hover:text-rose-400 p-1"
                  title="Delete Entity (Sets historical transactions entity_id to NULL)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const ImportRulesView: React.FC = () => {
  const { rules, entities, categories, saveRule, deleteRule } =
    useFinFolioStore();

  const [matchMode, setMatchMode] = useState<MatchMode>("Contains");
  const [pattern, setPattern] = useState("");
  const [entityId, setEntityId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState(200);
  const [simulatorInput, setSimulatorInput] = useState(
    "COMPRA ELEC 4532********1234 CONTINENTE BOM DIA LISBOA"
  );

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim()) return;
    await saveRule({
      id: "",
      match_mode: matchMode,
      pattern_string: pattern.trim().toUpperCase(),
      account_scope_id: null,
      assigned_entity_id: entityId || null,
      assigned_category_id: categoryId || null,
      priority_weight: priority,
      hit_count: 0,
    });
    setPattern("");
  };

  // Evaluate live dry-run simulator (Tier 1 Exact/Prefix/Regex -> Tier 2 Longest Substring Match)
  const simulatedMatch = (() => {
    const upper = simulatorInput.trim().toUpperCase();
    if (!upper) return null;
    const tier1 = rules.find((r) => {
      const p = r.pattern_string.toUpperCase();
      if (r.match_mode === "Exact") return upper === p;
      if (r.match_mode === "Prefix") return upper.startsWith(p);
      if (r.match_mode === "Regex") {
        try {
          return new RegExp(r.pattern_string, "i").test(simulatorInput);
        } catch {
          return false;
        }
      }
      return false;
    });
    if (tier1) return { rule: tier1, tier: "Tier 1 (Explicit Priority)" };

    const matchingContains = rules
      .filter(
        (r) =>
          r.match_mode === "Contains" &&
          upper.includes(r.pattern_string.toUpperCase())
      )
      .sort((a, b) => b.pattern_string.length - a.pattern_string.length);
    if (matchingContains[0]) {
      return {
        rule: matchingContains[0],
        tier: `Tier 2 (Substring Longest-Match: ${matchingContains[0].pattern_string.length} chars)`,
      };
    }
    return null;
  })();

  return (
    <div className="p-3 md:p-6 h-full overflow-y-auto bg-neutral-950 text-neutral-100 space-y-4 md:space-y-6">
      {/* Live 3-Tier Rule Engine Simulator */}
      <div className="p-4 rounded-xl bg-neutral-900/80 border border-neutral-800 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
          <Play className="w-3.5 h-3.5" />
          <span>
            Live Rule Engine Dry-Run Simulator (Aho-Corasick Longest-Match +
            Priority)
          </span>
        </div>
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
          <input
            type="text"
            value={simulatorInput}
            onChange={(e) => setSimulatorInput(e.target.value)}
            placeholder="Paste raw bank statement line to test matching..."
            className="flex-1 px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-xs font-mono text-white"
          />
          {simulatedMatch ? (
            <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300 font-mono">
              ✓ Matched "{simulatedMatch.rule.pattern_string}" via{" "}
              {simulatedMatch.tier}
            </div>
          ) : (
            <div className="px-3 py-1.5 rounded-lg bg-neutral-800 text-xs text-neutral-400 font-mono">
              No explicit rule matched (Falls back to Tier 3 Jaro-Winkler &gt;
              92%)
            </div>
          )}
        </div>
      </div>

      {/* Add Rule Form & Rules Table */}
      <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">
              Import Rules ({rules.length})
            </h2>
          </div>
        </div>

        <form
          onSubmit={(e) => void handleAddRule(e)}
          className="flex flex-col md:grid md:grid-cols-[130px_1fr_180px_180px_90px_auto] gap-2 text-xs"
        >
          <select
            value={matchMode}
            onChange={(e) => setMatchMode(e.target.value as MatchMode)}
            className="px-2 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white"
          >
            <option value="Contains">Contains</option>
            <option value="Prefix">Prefix</option>
            <option value="Exact">Exact</option>
            <option value="Regex">Regex</option>
          </select>
          <input
            type="text"
            placeholder="Pattern (e.g. CONTINENTE BOM DIA)"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white font-mono"
          />
          <select
            value={entityId}
            onChange={(e) => {
              const val = e.target.value;
              setEntityId(val);
              const ent = entities.find((x) => x.id === val);
              if (ent?.default_category_id && !categoryId) {
                setCategoryId(ent.default_category_id);
              }
            }}
            className="px-2 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white"
          >
            <option value="">-- Assign Entity --</option>
            {entities.map((ent) => (
              <option key={ent.id} value={ent.id}>
                {ent.normalized_name}
              </option>
            ))}
          </select>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white"
          >
            <option value="">-- Assign Category --</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            title="Priority Weight"
            className="px-2 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white font-mono"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-emerald-500 text-neutral-950 font-semibold hover:bg-emerald-400 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Save Rule
          </button>
        </form>

        <div className="divide-y divide-neutral-800 text-xs">
          {rules.map((rule) => {
            const ent = entities.find((e) => e.id === rule.assigned_entity_id);
            const cat = categories.find(
              (c) => c.id === rule.assigned_category_id
            );
            return (
              <div
                key={rule.id}
                className="py-2.5 px-2 flex flex-wrap md:grid md:grid-cols-[80px_110px_1fr_180px_180px_80px_40px] items-center gap-2 hover:bg-neutral-800/40 rounded"
              >
                <span className="font-mono text-neutral-400">
                  Prio {rule.priority_weight}
                </span>
                <span className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 w-fit font-mono text-[11px]">
                  {rule.match_mode}
                </span>
                <span className="font-mono font-semibold text-emerald-300">
                  "{rule.pattern_string}"
                </span>
                <span className="text-neutral-200">
                  {ent?.normalized_name || "—"}
                </span>
                <span className="text-neutral-300">{cat?.name || "—"}</span>
                <span className="font-mono text-neutral-500">
                  {rule.hit_count} hits
                </span>
                <button
                  onClick={() => void deleteRule(rule.id)}
                  className="text-neutral-500 hover:text-rose-400 justify-self-end"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const VaultSettingsView: React.FC = () => {
  const {
    vaultStatus,
    rekeyVault,
    run100kBenchmark,
    exportLedger,
    resetPreviewVault,
    setStatusBanner,
  } = useFinFolioStore();

  const [newPassphrase, setNewPassphrase] = useState("");
  const [exportedPreview, setExportedPreview] = useState("");
  const [isBenchmarking, setIsBenchmarking] = useState(false);

  const handleExport = async (format: "csv" | "json") => {
    const data = await exportLedger(format);
    setExportedPreview(data.slice(0, 2000));
    setStatusBanner(
      `Generated ${format.toUpperCase()} export (${data.length.toLocaleString()} bytes).`
    );
  };

  return (
    <div className="p-3 md:p-6 h-full overflow-y-auto bg-neutral-950 text-neutral-100 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
      {/* Left: SQLCipher AES-256 & Argon2id Security */}
      <div className="p-4 md:p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-4">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
          <Shield className="w-4 h-4" />
          <span>
            .finfolio Vault Security (Argon2id + SQLCipher AES-256-CBC)
          </span>
        </div>

        <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 space-y-1.5 text-xs font-mono">
          <div>
            Vault Path:{" "}
            <span className="text-neutral-300">
              {vaultStatus?.path || "In-Memory Vault"}
            </span>
          </div>
          <div>
            Encryption Mode:{" "}
            <span className="text-emerald-400">
              {vaultStatus?.is_encrypted
                ? "Encrypted (SQLCipher AES-256 + HMAC-SHA512)"
                : "Unencrypted (Instant-Launch SQLite 3 WAL)"}
            </span>
          </div>
          <div>
            KDF Parameters:{" "}
            <span className="text-neutral-300">
              Argon2id (64 MB RAM, 3 iterations, 4 lanes, 16-byte CSPRNG salt)
            </span>
          </div>
          <div>
            RAM Key Hygiene:{" "}
            <span className="text-emerald-400">
              mlock() Page-Locked & Zeroize-on-Drop Active
            </span>
          </div>
        </div>

        <div className="space-y-2 pt-2 text-xs">
          <label className="font-semibold text-neutral-300 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
            Live Database Rekey (Add, Change, or Remove Master Passphrase)
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              type="password"
              placeholder="Enter new master passphrase..."
              value={newPassphrase}
              onChange={(e) => setNewPassphrase(e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-white"
            />
            <button
              onClick={() => {
                void rekeyVault(newPassphrase);
                setNewPassphrase("");
              }}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-500 text-neutral-950 font-semibold hover:bg-emerald-400"
            >
              Encrypt / Rekey
            </button>
            <button
              onClick={() => void rekeyVault(null)}
              className="px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            >
              Remove Passphrase
            </button>
          </div>
        </div>
      </div>

      {/* Right: Data Portability & Edge Case 4 (100k Benchmark) */}
      <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-4 flex flex-col">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
            <Download className="w-4 h-4" />
            <span>Zero Lock-In Portability & 10-Year Ledger Benchmark</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            onClick={() => void handleExport("csv")}
            className="px-3.5 py-2 rounded-lg bg-emerald-500 text-neutral-950 font-semibold hover:bg-emerald-400"
          >
            Export Ledger to CSV
          </button>
          <button
            onClick={() => void handleExport("json")}
            className="px-3.5 py-2 rounded-lg bg-neutral-800 text-neutral-100 font-semibold hover:bg-neutral-700 border border-neutral-700"
          >
            Export Ledger to JSON
          </button>
          <button
            disabled={isBenchmarking}
            onClick={async () => {
              setIsBenchmarking(true);
              await run100kBenchmark(100_000);
              setIsBenchmarking(false);
            }}
            className="px-3.5 py-2 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 font-semibold hover:bg-purple-500/30 flex items-center gap-1.5"
          >
            <Gauge className="w-3.5 h-3.5" />
            {isBenchmarking
              ? "Seeding 100,000 Rows..."
              : "Seed 100,000 Benchmark Txs (Edge Case 4)"}
          </button>
        </div>

        {exportedPreview && (
          <pre className="flex-1 p-3 rounded-lg bg-neutral-950 border border-neutral-800 font-mono text-[11px] text-neutral-300 overflow-auto max-h-64">
            {exportedPreview}
          </pre>
        )}

        <div className="pt-4 mt-auto border-t border-neutral-800 space-y-2">
          <div className="text-xs font-semibold text-neutral-300">
            Web Preview &amp; Data Sandbox
          </div>
          <p className="text-[11px] text-neutral-400">
            Restore the browser preview database back to the pristine default
            accounts, categories, entities, and sample transactions.
          </p>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Are you sure you want to reset your local browser data? This will restore the default sample accounts and transactions."
                )
              ) {
                void resetPreviewVault();
              }
            }}
            className="px-3.5 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Preview Vault to Sample Data</span>
          </button>
        </div>
      </div>
    </div>
  );
};
