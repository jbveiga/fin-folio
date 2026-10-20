import React, { useState } from "react";
import {
  UploadCloud,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  ClipboardPaste,
  Check,
  Columns,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { BankProfile } from "../types";
import { formatCents } from "../utils/money";
import { ipc } from "../services/ipc";

const SAMPLE_CGD_STATEMENT = `Conta: PT50 0035 0651 0001 2345 6783 3
Data mov.;Data valor;Descrição;Débito;Crédito;Saldo contabilístico
20-10-2026;20-10-2026;COMPRA ELEC 4532********9876 CONTINENTE BOM DIA;34,80;;3.385,30 €
20-10-2026;20-10-2026;TRF MB WAY P/ 912 345 678 JOAO SILVA;15,00;;3.370,30 €
21-10-2026;21-10-2026;FARMÁCIA SÃO JOÃO PORTO;18,45;;3.351,85 €
22-10-2026;22-10-2026;PAGAMENTO SERVICOS VODAFONE PORTUGAL;42,90;;3.308,95 €
`;

const SAMPLE_DOUBLE_ESPRESSO = `Data Lanc.;Data Valor;Descrição;Valor;Saldo
20-10-2026;20-10-2026;COMPRA ELEC PADARIA PORTUGUESA;-1,00;499,00
20-10-2026;20-10-2026;COMPRA ELEC PADARIA PORTUGUESA;-1,00;498,00
21-10-2026;21-10-2026;COMPRA ELEC PINGO DOCE;-24,60;473,40
`;

export const ImportStagingView: React.FC = () => {
  const {
    accountSummaries,
    stagingAccountId,
    stagingResult,
    activeStagingRowIdx,
    entities,
    categories,
    pendingFileName,
    pendingRawBytes,
    setStagingAccountId,
    ingestRawStatement,
    updateStagedRow,
    setActiveStagingRowIdx,
    confirmActiveStagingRowAndAdvance,
    commitAllStagedTransactions,
  } = useFinFolioStore();

  // Column Mapper state when unknown header format is uploaded
  const [profileName, setProfileName] = useState("Custom Bank Profile");
  const [colRoles, setColRoles] = useState<Record<number, string>>({
    0: "Date",
    1: "Description",
    2: "Amount",
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buf));
    await ingestRawStatement(file.name, bytes, file.type);
  };

  const handleLoadSample = async (name: string, csvText: string) => {
    const bytes = Array.from(new TextEncoder().encode(csvText));
    await ingestRawStatement(name, bytes, "text/csv");
  };

  const handleApplyColumnMapping = async () => {
    if (!stagingResult) return;
    let dateIdx = 0;
    let descIdx = 1;
    let amtIdx: number | null = null;
    let debIdx: number | null = null;
    let credIdx: number | null = null;

    Object.entries(colRoles).forEach(([colStr, role]) => {
      const idx = Number(colStr);
      if (role === "Date") dateIdx = idx;
      if (role === "Description") descIdx = idx;
      if (role === "Amount") amtIdx = idx;
      if (role === "Debit") debIdx = idx;
      if (role === "Credit") credIdx = idx;
    });

    const profile: BankProfile = {
      id: `prof_${Date.now()}`,
      profile_name: profileName.trim() || "Custom Bank Profile",
      header_signature_hash: stagingResult.header_signature_hash,
      date_col_idx: dateIdx,
      desc_col_idx: descIdx,
      amount_strategy:
        debIdx !== null && credIdx !== null
          ? "DebitCreditSplit"
          : "SingleSigned",
      amount_col_idx: amtIdx ?? 2,
      debit_col_idx: debIdx,
      credit_col_idx: credIdx,
      indicator_col_idx: null,
      decimal_separator: ",",
    };

    await ipc.saveBankProfile(profile);
    await ingestRawStatement(
      pendingFileName || "mapped.csv",
      pendingRawBytes,
      "text/csv",
      profile
    );
  };

  const selectedToImportCount =
    stagingResult?.staged_rows.filter((r) => r.is_selected_for_import).length ||
    0;

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-neutral-100 overflow-hidden">
      {/* Top Staging Control Bar */}
      <div className="px-4 py-3 bg-neutral-900/80 border-b border-neutral-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-300">
              Target Account:
            </span>
            <select
              value={stagingAccountId}
              onChange={(e) => setStagingAccountId(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-xs text-white font-medium"
            >
              {accountSummaries.map((s) => (
                <option key={s.account.id} value={s.account.id}>
                  {s.account.name} ({formatCents(s.current_balance_cents)})
                </option>
              ))}
            </select>
          </div>

          <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-medium text-neutral-100">
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Drop / Select File (.csv, .xlsx, .pdf)</span>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.html"
              onChange={(e) => void handleFileUpload(e)}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={() =>
              void handleLoadSample("cgd_extract_oct2026.csv", SAMPLE_CGD_STATEMENT)
            }
            className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-300"
          >
            Load CGD Sample (PII + Rules)
          </button>

          <button
            type="button"
            onClick={() =>
              void handleLoadSample(
                "double_espresso_test.csv",
                SAMPLE_DOUBLE_ESPRESSO
              )
            }
            className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-300"
          >
            Load "Double Espresso" Dedup Test
          </button>
        </div>

        {stagingResult && !stagingResult.needs_column_mapping && (
          <div className="flex items-center gap-3">
            {stagingResult.profile_name && (
              <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-md font-mono">
                Profile: {stagingResult.profile_name}
              </span>
            )}
            <button
              onClick={() => void commitAllStagedTransactions()}
              disabled={selectedToImportCount === 0}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                selectedToImportCount > 0
                  ? "bg-emerald-500 hover:bg-emerald-400 text-neutral-950 shadow-sm"
                  : "bg-neutral-800 text-neutral-500 cursor-not-allowed"
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                Commit {selectedToImportCount} Valid Rows (⌘Enter)
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Empty Dropzone State */}
      {!stagingResult && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="max-w-lg w-full p-8 rounded-2xl border-2 border-dashed border-neutral-800 bg-neutral-900/30 space-y-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-white">
                7-Stage Deterministic Statement Ingestion
              </h3>
              <p className="text-xs text-neutral-400">
                Paste HTML/TSV directly from your homebanking portal (
                <kbd className="px-1.5 py-0.5 bg-neutral-800 rounded font-mono">
                  ⌘V
                </kbd>
                ) or upload any CSV, TSV, XLSX, or PDF statement from CGD,
                Millennium bcp, ActivoBank, BPI, Santander, Novo Banco, Moey!,
                Revolut, or Wise.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() =>
                  void handleLoadSample(
                    "cgd_extract_oct2026.csv",
                    SAMPLE_CGD_STATEMENT
                  )
                }
                className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs flex items-center gap-1.5"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                Try CGD Statement (with PII Scrubber)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stage 3 Unknown Structure Fallback: Interactive Column Mapper Bar */}
      {stagingResult && stagingResult.needs_column_mapping && (
        <div className="p-4 bg-amber-950/20 border-b border-amber-500/40 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-300 font-semibold">
              <Columns className="w-4 h-4" />
              <span>
                Unrecognized Bank Header Structure — Assign Columns Once to Save
                Profile
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Profile Name (e.g. Banco Montepio)"
                className="px-2.5 py-1 rounded bg-neutral-900 border border-neutral-700 text-white"
              />
              <button
                onClick={() => void handleApplyColumnMapping()}
                className="px-3 py-1 rounded bg-emerald-500 text-neutral-950 font-semibold hover:bg-emerald-400"
              >
                Save Bank Profile & Parse
              </button>
            </div>
          </div>

          <div className="grid grid-flow-col auto-cols-fr gap-2">
            {stagingResult.detected_columns.map((colName, idx) => (
              <div
                key={idx}
                className="p-2 rounded bg-neutral-900 border border-neutral-800 space-y-1"
              >
                <div className="text-[10px] text-neutral-400 font-mono truncate">
                  Col #{idx + 1}: {colName}
                </div>
                <select
                  value={colRoles[idx] || "Ignore"}
                  onChange={(e) =>
                    setColRoles({ ...colRoles, [idx]: e.target.value })
                  }
                  className="w-full px-1.5 py-1 rounded bg-neutral-950 border border-neutral-700 text-white"
                >
                  <option value="Date">Date</option>
                  <option value="Description">Description</option>
                  <option value="Amount">Signed Amount</option>
                  <option value="Debit">Debit (-)</option>
                  <option value="Credit">Credit (+)</option>
                  <option value="Ignore">Ignore</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stage 7 Keyboard-First Staging Grid */}
      {stagingResult && !stagingResult.needs_column_mapping && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="grid grid-cols-[40px_100px_1fr_190px_190px_120px_170px] items-center px-4 h-8 bg-neutral-900 border-b border-neutral-800 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 shrink-0">
            <div>Imp</div>
            <div>Date</div>
            <div>Scrubbed Clean & Raw Description</div>
            <div>Entity (Inherits Cat)</div>
            <div>Category</div>
            <div className="text-right">Amount</div>
            <div className="pl-3">Pipeline Status</div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-neutral-900">
            {stagingResult.staged_rows.map((row, idx) => {
              const isFocused = idx === activeStagingRowIdx;
              const isDup = row.status === "AlreadyImported";

              return (
                <div
                  key={row.temp_id}
                  onClick={() => setActiveStagingRowIdx(idx)}
                  className={`grid grid-cols-[40px_100px_1fr_190px_190px_120px_170px] items-center px-4 py-2 text-xs transition-colors ${
                    isDup
                      ? "bg-neutral-950/60 text-neutral-600 line-through"
                      : isFocused
                      ? "bg-neutral-800/80 ring-1 ring-inset ring-emerald-500/60"
                      : "hover:bg-neutral-900/50"
                  }`}
                >
                  <div>
                    <input
                      type="checkbox"
                      checked={row.is_selected_for_import}
                      onChange={(e) =>
                        updateStagedRow(row.temp_id, {
                          is_selected_for_import: e.target.checked,
                        })
                      }
                      className="rounded border-neutral-700 bg-neutral-900 text-emerald-500 focus:ring-0"
                    />
                  </div>

                  <div className="font-mono text-neutral-300">
                    {row.date_posted}
                  </div>

                  <div className="pr-3 min-w-0">
                    <div className="font-medium text-neutral-100 truncate flex items-center gap-2">
                      <span>{row.clean_description}</span>
                      {row.auto_learn_rule && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateStagedRow(row.temp_id, {
                              auto_learn_rule: !row.auto_learn_rule,
                            });
                          }}
                          className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] flex items-center gap-1 no-underline"
                        >
                          <Sparkles className="w-2.5 h-2.5" />⚡ Auto-learn rule
                        </button>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-neutral-500 truncate">
                      Raw (PII Scrubbed): {row.raw_description}
                    </div>
                  </div>

                  <div className="pr-2">
                    <select
                      disabled={isDup}
                      value={row.entity_id || ""}
                      onChange={(e) =>
                        updateStagedRow(row.temp_id, {
                          entity_id: e.target.value || null,
                        })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          confirmActiveStagingRowAndAdvance();
                        }
                      }}
                      className="w-full px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-neutral-100 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="">-- Select Entity --</option>
                      {entities.map((ent) => (
                        <option key={ent.id} value={ent.id}>
                          {ent.normalized_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="pr-2">
                    <select
                      disabled={isDup}
                      value={row.category_id || ""}
                      onChange={(e) =>
                        updateStagedRow(row.temp_id, {
                          category_id: e.target.value || null,
                        })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          confirmActiveStagingRowAndAdvance();
                        }
                      }}
                      className="w-full px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-neutral-100 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="">-- Select Category --</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name} ({cat.direction})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div
                    className={`font-mono font-semibold text-right tabular-nums ${
                      row.amount_cents >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {formatCents(row.amount_cents, true)}
                  </div>

                  <div className="pl-3 flex items-center">
                    {row.status === "AlreadyImported" && (
                      <span className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700 text-[10px] font-medium flex items-center gap-1 no-underline">
                        <AlertCircle className="w-3 h-3" />
                        Already Imported (Skipped)
                      </span>
                    )}
                    {row.status === "RuleMatched" && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Rule Matched
                      </span>
                    )}
                    {row.status === "Suggested" && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-medium flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        Suggested (
                        {Math.round((row.suggestion_confidence || 0.94) * 100)}
                        %)
                      </span>
                    )}
                    {row.status === "New" && (
                      <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-medium">
                        New
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
