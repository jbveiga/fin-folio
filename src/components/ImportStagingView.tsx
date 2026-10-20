import React, { useEffect, useMemo, useState } from "react";
import {
  UploadCloud,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  ClipboardPaste,
  Check,
  Columns,
  SlidersHorizontal,
  RotateCcw,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { BankProfile, BankProfilePreset } from "../types";
import { formatCents } from "../utils/money";
import { BUILTIN_BANK_PRESETS, ipc } from "../services/ipc";

// =============================================================================
// Authoritative Portuguese & European Bank Statement Fixtures
// =============================================================================

const SAMPLE_STATEMENTS: {
  id: string;
  label: string;
  fileName: string;
  csv: string;
}[] = [
  {
    id: "cgd",
    label: "CGD (Débito/Crédito)",
    fileName: "cgd_extract_oct2026.csv",
    csv: `Caixa Geral de Depósitos — Consulta de Movimentos
Conta: PT50 0035 0651 0001 2345 6783 3
Data mov.;Data valor;Descrição;Débito;Crédito;Saldo contabilístico
20-10-2026;20-10-2026;COMPRA ELEC 4532********9876 CONTINENTE BOM DIA;34,80;;3.385,30 €
20-10-2026;20-10-2026;TRF MB WAY P/ 912 345 678 JOAO SILVA;15,00;;3.370,30 €
21-10-2026;21-10-2026;FARMÁCIA SÃO JOÃO PORTO;18,45;;3.351,85 €
22-10-2026;22-10-2026;PAGAMENTO SERVICOS VODAFONE PORTUGAL;42,90;;3.308,95 €
23-10-2026;23-10-2026;TRF SEPA+ REEMBOLSO IRS;;145,00;3.453,95 €`,
  },
  {
    id: "millennium",
    label: "Millennium bcp",
    fileName: "millennium_bcp_oct2026.csv",
    csv: `Millennium bcp - Histórico de Movimentos
Data Lancamento;Data Valor;Descricao;Montante;Moeda;Saldo Contabilistico
20/10/2026;20/10/2026;COMPRA ELEC PINGO DOCE LISBOA;-52,40;EUR;1.778,30
21/10/2026;21/10/2026;DD EDP COMERCIAL FATURA;-64,50;EUR;1.713,80
22/10/2026;22/10/2026;COMPRA PADARIA PORTUGUESA;-4,85;EUR;1.708,95`,
  },
  {
    id: "santander",
    label: "Santander Totta",
    fileName: "santander_totta_oct2026.csv",
    csv: `Banco Santander Totta - Extrato Integrado
Data Operação;Data Valor;Descrição do Movimento;Valor (EUR);Saldo Após Movimento
20-10-2026;20-10-2026;COMPRA CARTAO CONTINENTE MODELO;-41,20;2.150,80
21-10-2026;21-10-2026;PAGAMENTO SERVICOS EPAL AGUAS;-24,80;2.126,00`,
  },
  {
    id: "activobank",
    label: "ActivoBank",
    fileName: "activobank_oct2026.csv",
    csv: `Data Lanc.;Data Valor;Descrição;Valor;Saldo
20-10-2026;20-10-2026;COMPRA ELEC CONTINENTE COLOMBO;-28,90;1.420,10
21-10-2026;21-10-2026;TRF MB WAY DE 918 222 333 PEDRO COSTA;12,50;1.432,60`,
  },
  {
    id: "revolut",
    label: "Revolut",
    fileName: "revolut_eur_oct2026.csv",
    csv: `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-10-20 09:14:22,2026-10-20 12:00:00,PADARIA PORTUGUESA,-3.60,0.00,EUR,COMPLETED,246.40
CARD_PAYMENT,Current,2026-10-21 19:45:10,2026-10-21 20:01:00,NETFLIX.COM,-15.99,0.00,EUR,COMPLETED,230.41
TOPUP,Current,2026-10-22 10:00:00,2026-10-22 10:00:05,Top-Up by *4512,100.00,0.00,EUR,COMPLETED,330.41`,
  },
  {
    id: "n26",
    label: "N26",
    fileName: "n26_oct2026.csv",
    csv: `Date,Payee,Account number,Transaction type,Payment reference,Amount (EUR),Amount (Foreign Currency),Type Foreign Currency,Exchange Rate
2026-10-20,PINGO DOCE,,MasterCard Payment,Groceries,-31.45,,,
2026-10-21,FARMÁCIA SÃO JOÃO,,MasterCard Payment,Health,-14.20,,,`,
  },
  {
    id: "espresso",
    label: "Double Espresso Dedup",
    fileName: "double_espresso_test.csv",
    csv: `Data Lanc.;Data Valor;Descrição;Valor;Saldo
20-10-2026;20-10-2026;COMPRA ELEC PADARIA PORTUGUESA;-1,00;499,00
20-10-2026;20-10-2026;COMPRA ELEC PADARIA PORTUGUESA;-1,00;498,00
21-10-2026;21-10-2026;COMPRA ELEC PINGO DOCE;-24,60;473,40`,
  },
  {
    id: "custom_wizard",
    label: "Custom CSV (Wizard Demo)",
    fileName: "custom_cooperative_bank.csv",
    csv: `Ref_ID;Timestamp_ISO;Merchant_Counterparty;Net_EUR;Running_Total
TX-901;20-10-2026;CONTINENTE HIPERMERCADO;-64,20;1.200,00
TX-902;21-10-2026;EDP COMERCIAL ELETRICIDADE;-58,90;1.141,10
TX-903;22-10-2026;PADARIA PORTUGUESA CHIADO;-6,40;1.134,70`,
  },
];

type ColumnRole =
  | "Date"
  | "Description"
  | "Amount"
  | "Debit"
  | "Credit"
  | "Balance"
  | "Ignore";

const ROLE_BADGE_STYLES: Record<ColumnRole, string> = {
  Date: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-semibold",
  Description:
    "bg-purple-500/15 border-purple-500/40 text-purple-300 font-semibold",
  Amount: "bg-sky-500/15 border-sky-500/40 text-sky-300 font-semibold",
  Debit: "bg-rose-500/15 border-rose-500/40 text-rose-300 font-semibold",
  Credit:
    "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-semibold",
  Balance: "bg-neutral-800 border-neutral-700 text-neutral-300 font-medium",
  Ignore: "bg-neutral-900 border-neutral-800 text-neutral-500",
};

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
    setStatusBanner,
  } = useFinFolioStore();

  // Step 1 Acquisition state: File Dropper vs Direct Paste
  const [acquisitionTab, setAcquisitionTab] = useState<"drop" | "paste">("drop");
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [pastedText, setPastedText] = useState("");

  // Step 2 Interactive 5-Row Column Mapping Wizard state
  const [isMapperManuallyOpen, setIsMapperManuallyOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("custom");
  const [profileName, setProfileName] = useState("Custom Bank Profile");
  const [saveProfileChecked, setSaveProfileChecked] = useState(true);
  const [delimiter, setDelimiter] = useState<string>(";");
  const [decimalSeparator, setDecimalSeparator] = useState<"," | ".">(",");
  const [headerRowIdx, setHeaderRowIdx] = useState<number>(0);
  const [colRoles, setColRoles] = useState<Record<number, ColumnRole>>({
    0: "Date",
    1: "Description",
    2: "Amount",
  });

  // Synchronize Column Mapping Wizard controls whenever a new statement is loaded
  useEffect(() => {
    if (!stagingResult) return;
    const detectedDelim = stagingResult.detected_delimiter || ";";
    const detectedDec =
      stagingResult.detected_decimal_separator === "." ? "." : ",";
    const detectedHeaderIdx = stagingResult.detected_header_row_idx ?? 0;
    setDelimiter(detectedDelim);
    setDecimalSeparator(detectedDec);
    setHeaderRowIdx(detectedHeaderIdx);

    if (stagingResult.applied_profile) {
      const p = stagingResult.applied_profile;
      const nextRoles: Record<number, ColumnRole> = {};
      stagingResult.detected_columns.forEach((_, idx) => {
        nextRoles[idx] = "Ignore";
      });
      nextRoles[p.date_col_idx] = "Date";
      nextRoles[p.desc_col_idx] = "Description";
      if (p.amount_strategy === "DebitCreditSplit") {
        if (p.debit_col_idx !== null) nextRoles[p.debit_col_idx] = "Debit";
        if (p.credit_col_idx !== null) nextRoles[p.credit_col_idx] = "Credit";
      } else if (p.amount_col_idx !== null) {
        nextRoles[p.amount_col_idx] = "Amount";
      }
      if (p.balance_col_idx !== undefined && p.balance_col_idx !== null) {
        nextRoles[p.balance_col_idx] = "Balance";
      }
      setColRoles(nextRoles);
      setProfileName(p.profile_name || "Custom Bank Profile");
    } else {
      // Default heuristic for unknown headers
      const nextRoles: Record<number, ColumnRole> = {};
      stagingResult.detected_columns.forEach((col, idx) => {
        const lower = col.toLowerCase();
        if (
          idx === 0 ||
          lower.includes("date") ||
          lower.includes("data") ||
          lower.includes("timestamp")
        ) {
          nextRoles[idx] = "Date";
        } else if (
          idx === 1 ||
          lower.includes("desc") ||
          lower.includes("merchant") ||
          lower.includes("counterparty") ||
          lower.includes("payee")
        ) {
          nextRoles[idx] = "Description";
        } else if (
          lower.includes("net") ||
          lower.includes("amt") ||
          lower.includes("amount") ||
          lower.includes("valor") ||
          lower.includes("eur")
        ) {
          nextRoles[idx] = "Amount";
        } else if (lower.includes("total") || lower.includes("bal")) {
          nextRoles[idx] = "Balance";
        } else {
          nextRoles[idx] = "Ignore";
        }
      });
      setColRoles(nextRoles);
    }
  }, [stagingResult]);

  // Ambient metrics for pasted text
  const pastedMetrics = useMemo(() => {
    const lines = pastedText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const sample = lines[0] || "";
    const delimLabel = sample.includes(";")
      ? "Semicolon delimited (;)"
      : sample.includes("\t")
      ? "Tab delimited (TSV)"
      : sample.includes(",")
      ? "Comma delimited (,)"
      : "Auto-detect";
    return { lineCount: lines.length, delimLabel };
  }, [pastedText]);

  // Re-tokenize raw preview lines dynamically when user changes Delimiter or Header Row in Wizard
  const dynamicPreview = useMemo(() => {
    if (!pendingRawBytes || pendingRawBytes.length === 0) {
      return {
        headers: stagingResult?.detected_columns || [],
        sampleRows: stagingResult?.raw_sample_rows || [],
        totalDataRows: stagingResult?.all_raw_rows.length || 0,
      };
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(
      new Uint8Array(pendingRawBytes)
    );
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const safeHeaderIdx = Math.max(
      0,
      Math.min(lines.length - 1, headerRowIdx)
    );
    const splitLine = (line: string) =>
      line
        .split(delimiter)
        .map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());

    const headers = lines[safeHeaderIdx] ? splitLine(lines[safeHeaderIdx]) : [];
    const dataRows = lines.slice(safeHeaderIdx + 1).map(splitLine);
    return {
      headers,
      sampleRows: dataRows.slice(0, 5),
      totalDataRows: dataRows.length,
    };
  }, [pendingRawBytes, delimiter, headerRowIdx, stagingResult]);

  // Validate current column role assignments
  const mappingValidation = useMemo(() => {
    const roles = Object.values(colRoles);
    const hasDate = roles.includes("Date");
    const hasDesc = roles.includes("Description");
    const hasSingleAmount = roles.includes("Amount");
    const hasSplitAmount = roles.includes("Debit") && roles.includes("Credit");
    const isValid =
      hasDate && hasDesc && (hasSingleAmount || hasSplitAmount);
    return {
      isValid,
      hasDate,
      hasDesc,
      hasAmount: hasSingleAmount || hasSplitAmount,
    };
  }, [colRoles]);

  const handleFileUpload = async (file: File) => {
    const buf = await file.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buf));
    await ingestRawStatement(file.name, bytes, file.type);
  };

  const handleFileInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleFileUpload(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleFileUpload(file);
    }
  };

  const handleParsePastedText = async () => {
    if (!pastedText.trim()) return;
    const bytes = Array.from(new TextEncoder().encode(pastedText));
    await ingestRawStatement("pasted_statement.csv", bytes, "text/csv");
  };

  const handleLoadSample = async (fileName: string, csvText: string) => {
    const bytes = Array.from(new TextEncoder().encode(csvText));
    await ingestRawStatement(fileName, bytes, "text/csv");
  };

  const handleSelectPreset = (preset: BankProfilePreset) => {
    setSelectedPresetId(preset.id);
    setProfileName(preset.name);
    setDelimiter(preset.delimiter);
    setDecimalSeparator(preset.decimalSeparator);

    const maxCols = Math.max(
      dynamicPreview.headers.length,
      (preset.balanceColIdx ?? 5) + 1
    );
    const nextRoles: Record<number, ColumnRole> = {};
    for (let i = 0; i < maxCols; i++) {
      nextRoles[i] = "Ignore";
    }
    nextRoles[preset.dateColIdx] = "Date";
    nextRoles[preset.descColIdx] = "Description";
    if (preset.strategy === "DebitCreditSplit") {
      if (preset.debitColIdx !== undefined) {
        nextRoles[preset.debitColIdx] = "Debit";
      }
      if (preset.creditColIdx !== undefined) {
        nextRoles[preset.creditColIdx] = "Credit";
      }
    } else if (preset.amountColIdx !== undefined) {
      nextRoles[preset.amountColIdx] = "Amount";
    }
    if (preset.balanceColIdx !== undefined) {
      nextRoles[preset.balanceColIdx] = "Balance";
    }
    setColRoles(nextRoles);
  };

  const handleApplyColumnMapping = async () => {
    if (!stagingResult || !mappingValidation.isValid) return;
    let dateIdx = 0;
    let descIdx = 1;
    let amtIdx: number | null = null;
    let debIdx: number | null = null;
    let credIdx: number | null = null;
    let balIdx: number | null = null;

    Object.entries(colRoles).forEach(([colStr, role]) => {
      const idx = Number(colStr);
      if (role === "Date") dateIdx = idx;
      if (role === "Description") descIdx = idx;
      if (role === "Amount") amtIdx = idx;
      if (role === "Debit") debIdx = idx;
      if (role === "Credit") credIdx = idx;
      if (role === "Balance") balIdx = idx;
    });

    const isSplit = debIdx !== null && credIdx !== null;
    const normalizedSig = dynamicPreview.headers
      .map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""))
      .join("_");
    const computedSigHash = `sig_${delimiter === "\t" ? "tab" : delimiter}_${normalizedSig}`;

    const profile: BankProfile = {
      id: `prof_${Date.now()}`,
      profile_name: profileName.trim() || "Custom Bank Profile",
      header_signature_hash: computedSigHash,
      date_col_idx: dateIdx,
      desc_col_idx: descIdx,
      amount_strategy: isSplit ? "DebitCreditSplit" : "SingleSigned",
      amount_col_idx: isSplit ? null : amtIdx ?? 2,
      debit_col_idx: isSplit ? debIdx : null,
      credit_col_idx: isSplit ? credIdx : null,
      indicator_col_idx: null,
      decimal_separator: decimalSeparator,
      delimiter,
      header_row_idx: headerRowIdx,
      balance_col_idx: balIdx,
    };

    if (saveProfileChecked) {
      await ipc.saveBankProfile(profile);
    }

    await ingestRawStatement(
      pendingFileName || "mapped_statement.csv",
      pendingRawBytes,
      "text/csv",
      profile
    );
    setIsMapperManuallyOpen(false);
    setStatusBanner(
      `✓ Applied "${profile.profile_name}" column mapping (${dynamicPreview.totalDataRows} rows parsed into integer cents).`
    );
  };

  const showColumnMapper =
    Boolean(stagingResult) &&
    (stagingResult!.needs_column_mapping || isMapperManuallyOpen);

  const selectedToImportCount =
    stagingResult?.staged_rows.filter((r) => r.is_selected_for_import).length ||
    0;
  const ruleMatchedCount =
    stagingResult?.staged_rows.filter((r) => r.status === "RuleMatched")
      .length || 0;
  const duplicateCount =
    stagingResult?.staged_rows.filter((r) => r.status === "AlreadyImported")
      .length || 0;

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-neutral-100 overflow-hidden">
      {/* Top Staging Control Bar */}
      <div className="px-4 py-3 bg-neutral-900/90 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-300">
              Target Account:
            </span>
            <select
              value={stagingAccountId}
              onChange={(e) => setStagingAccountId(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-700 text-xs text-white font-medium focus:outline-none focus:border-emerald-500"
            >
              {accountSummaries.map((s) => (
                <option key={s.account.id} value={s.account.id}>
                  {s.account.name} ({formatCents(s.current_balance_cents)})
                </option>
              ))}
            </select>
          </div>

          <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-medium text-neutral-100 transition-colors">
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Browse File (.csv, .tsv, .txt)</span>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.html"
              onChange={(e) => void handleFileInputChange(e)}
              className="hidden"
            />
          </label>

          {stagingResult && (
            <button
              type="button"
              onClick={() => setIsMapperManuallyOpen((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                showColumnMapper
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border-neutral-800"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Column Mapping Wizard (5-Row Preview)</span>
            </button>
          )}
        </div>

        {stagingResult && !stagingResult.needs_column_mapping && (
          <div className="flex flex-wrap items-center gap-2.5">
            {stagingResult.profile_name && (
              <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-md font-mono flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Profile: {stagingResult.profile_name}</span>
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                useFinFolioStore.setState({
                  stagingResult: null,
                  pendingFileName: "",
                  pendingRawBytes: [],
                })
              }
              className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-300 flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>New Import</span>
            </button>
            <button
              type="button"
              onClick={() => void commitAllStagedTransactions()}
              disabled={selectedToImportCount === 0}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                selectedToImportCount > 0
                  ? "bg-emerald-500 hover:bg-emerald-400 text-neutral-950 shadow-sm"
                  : "bg-neutral-800 text-neutral-500 cursor-not-allowed"
              }`}
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>
                Commit {selectedToImportCount} Valid Rows (⌘Enter)
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Quick Sample Institution Loaders Bar */}
      <div className="px-4 py-2 bg-neutral-950 border-b border-neutral-900 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mr-1">
          Instant Bank Fixtures:
        </span>
        {SAMPLE_STATEMENTS.map((sample) => (
          <button
            key={sample.id}
            type="button"
            onClick={() => {
              if (sample.id === "custom_wizard") {
                setIsMapperManuallyOpen(true);
              }
              void handleLoadSample(sample.fileName, sample.csv);
            }}
            className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-emerald-500/40 text-[11px] font-medium text-neutral-300 hover:text-white transition-colors"
          >
            {sample.label}
          </button>
        ))}
      </div>

      {/* =================================================================== */}
      {/* SURFACE 1: Tabbed Acquisition Container (Drop File vs Paste Text)   */}
      {/* =================================================================== */}
      {!stagingResult && (
        <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col items-center justify-center">
          <div className="max-w-2xl w-full rounded-2xl bg-neutral-900/60 border border-neutral-800 shadow-2xl overflow-hidden">
            {/* Segmented Tab Switcher */}
            <div className="grid grid-cols-2 p-1.5 bg-neutral-950 border-b border-neutral-800">
              <button
                type="button"
                onClick={() => setAcquisitionTab("drop")}
                className={`py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
                  acquisitionTab === "drop"
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>📁 Drop Statement File (CSV / TSV / TXT)</span>
              </button>
              <button
                type="button"
                onClick={() => setAcquisitionTab("paste")}
                className={`py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
                  acquisitionTab === "paste"
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <ClipboardPaste className="w-4 h-4" />
                <span>📋 Paste Raw Statement Text</span>
              </button>
            </div>

            {acquisitionTab === "drop" ? (
              <div className="p-6 md:p-8">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingOver(false);
                  }}
                  onDrop={(e) => void handleDrop(e)}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all ${
                    isDraggingOver
                      ? "border-emerald-400 bg-emerald-500/10 scale-[1.01]"
                      : "border-neutral-800 bg-neutral-950/50 hover:border-emerald-500/50 hover:bg-neutral-900/70"
                  }`}
                >
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400 mb-4">
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-semibold text-white mb-1">
                    Drag &amp; drop your bank statement file here
                  </h3>
                  <p className="text-xs text-neutral-400 max-w-md mx-auto mb-5">
                    Supports <code className="text-emerald-300">.csv</code>,{" "}
                    <code className="text-emerald-300">.tsv</code>, and{" "}
                    <code className="text-emerald-300">.txt</code> exports from
                    CGD, Millennium bcp, Santander Totta, ActivoBank, BPI,
                    Revolut, N26, or any custom CSV structure.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <label className="cursor-pointer px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs flex items-center gap-1.5 shadow-sm transition-colors">
                      <FileText className="w-3.5 h-3.5" />
                      <span>Choose Statement File...</span>
                      <input
                        type="file"
                        accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.html"
                        onChange={(e) => void handleFileInputChange(e)}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        void handleLoadSample(
                          SAMPLE_STATEMENTS[0].fileName,
                          SAMPLE_STATEMENTS[0].csv
                        )
                      }
                      className="px-3.5 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium text-xs transition-colors"
                    >
                      Try CGD Sample Statement
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-3">
                <textarea
                  rows={8}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder={`Paste lines copied from your online banking statement table here...\n\nExample:\nData mov.;Data valor;Descrição;Débito;Crédito;Saldo\n20-10-2026;20-10-2026;COMPRA CONTINENTE BOM DIA;34,80;;3.385,30 €`}
                  className="w-full font-mono text-xs bg-neutral-950 border border-neutral-800 p-4 rounded-xl text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-emerald-500/60"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono text-[11px] text-neutral-400">
                    Detected: <strong>{pastedMetrics.lineCount}</strong> lines •{" "}
                    {pastedMetrics.delimLabel} • UTF-8
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPastedText(SAMPLE_STATEMENTS[0].csv)}
                      className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs"
                    >
                      Fill Sample Text
                    </button>
                    <button
                      type="button"
                      disabled={pastedMetrics.lineCount === 0}
                      onClick={() => void handleParsePastedText()}
                      className={`px-4 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 ${
                        pastedMetrics.lineCount > 0
                          ? "bg-emerald-500 hover:bg-emerald-400 text-neutral-950"
                          : "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Parse Pasted Text</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SURFACE 2 & 3: Interactive 5-Row Column Mapping Wizard              */}
      {/* =================================================================== */}
      {showColumnMapper && stagingResult && (
        <div className="p-4 bg-neutral-900/95 border-b border-emerald-500/30 space-y-3.5 text-xs overflow-y-auto max-h-[65vh] shrink-0">
          {/* Top Row: Title + Institution Preset Selector Pills */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-300 font-semibold">
              <Columns className="w-4 h-4" />
              <span>
                Configure Column Mapping:{" "}
                <span className="font-mono text-white">
                  {pendingFileName || "statement.csv"}
                </span>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mr-1">
                Bank Presets:
              </span>
              {BUILTIN_BANK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                    selectedPresetId === preset.id
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-semibold shadow-sm"
                      : "bg-neutral-950 hover:bg-neutral-800 text-neutral-300 border-neutral-800"
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Controls Bar: Delimiter, Decimal Separator, Header Line */}
          <div className="flex flex-wrap items-center gap-4 p-2.5 rounded-xl bg-neutral-950 border border-neutral-800">
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-neutral-400">Delimiter:</label>
              <select
                value={delimiter}
                onChange={(e) => {
                  setDelimiter(e.target.value);
                  setSelectedPresetId("custom");
                }}
                className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-white font-mono text-xs"
              >
                <option value=";">; (Semicolon)</option>
                <option value=",">, (Comma)</option>
                <option value={"\t"}>Tab (TSV)</option>
                <option value="|">| (Pipe)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[11px] text-neutral-400">Decimals:</label>
              <select
                value={decimalSeparator}
                onChange={(e) => {
                  setDecimalSeparator(e.target.value as "," | ".");
                  setSelectedPresetId("custom");
                }}
                className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-white font-mono text-xs"
              >
                <option value=",">, Comma (1.234,56 €)</option>
                <option value=".">. Period (1,234.56 €)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[11px] text-neutral-400">
                Header Row (Preamble Skip):
              </label>
              <input
                type="number"
                min={0}
                max={15}
                value={headerRowIdx}
                onChange={(e) =>
                  setHeaderRowIdx(Math.max(0, Number(e.target.value) || 0))
                }
                className="w-16 px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-white font-mono text-xs"
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveProfileChecked}
                  onChange={(e) => setSaveProfileChecked(e.target.checked)}
                  className="rounded border-neutral-700 bg-neutral-900 accent-emerald-500"
                />
                <span>Save as Profile:</span>
              </label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Profile Name"
                className="px-2.5 py-1 rounded bg-neutral-900 border border-neutral-700 text-white text-xs w-44"
              />
            </div>
          </div>

          {/* Live 5-Row Interactive Preview Grid */}
          <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/80">
                  {dynamicPreview.headers.map((colHeader, idx) => {
                    const role: ColumnRole = colRoles[idx] || "Ignore";
                    return (
                      <th
                        key={idx}
                        className="p-2.5 min-w-[155px] border-r border-neutral-800/80 last:border-r-0 align-top"
                      >
                        <div className="text-[10px] font-mono text-neutral-400 truncate mb-1.5">
                          Col #{idx}:{" "}
                          <span className="text-neutral-200 font-semibold">
                            {colHeader || `(Column ${idx})`}
                          </span>
                        </div>
                        <select
                          value={role}
                          onChange={(e) => {
                            setColRoles({
                              ...colRoles,
                              [idx]: e.target.value as ColumnRole,
                            });
                            setSelectedPresetId("custom");
                          }}
                          className={`w-full px-2 py-1 rounded-lg border text-xs focus:outline-none ${ROLE_BADGE_STYLES[role]}`}
                        >
                          <option value="Date">📅 Date</option>
                          <option value="Description">📝 Description</option>
                          <option value="Amount">💶 Amount (Signed)</option>
                          <option value="Debit">➖ Debit (Expense)</option>
                          <option value="Credit">➕ Credit (Income)</option>
                          <option value="Balance">🏦 Balance</option>
                          <option value="Ignore">⏭️ Skip / Ignore</option>
                        </select>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900 font-mono text-[11px]">
                {dynamicPreview.sampleRows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-neutral-900/50">
                    {dynamicPreview.headers.map((_, cIdx) => {
                      const role = colRoles[cIdx] || "Ignore";
                      return (
                        <td
                          key={cIdx}
                          className={`px-2.5 py-2 border-r border-neutral-900 last:border-r-0 truncate max-w-[220px] ${
                            role === "Ignore"
                              ? "text-neutral-600"
                              : role === "Date"
                              ? "text-emerald-300"
                              : role === "Description"
                              ? "text-purple-200 font-sans"
                              : role === "Debit"
                              ? "text-rose-300"
                              : role === "Credit"
                              ? "text-emerald-300"
                              : role === "Amount"
                              ? "text-sky-300"
                              : "text-neutral-300"
                          }`}
                        >
                          {row[cIdx] ?? ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Validation Status & Action Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {mappingValidation.isValid ? (
              <div className="text-emerald-400 flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  ✓ Ready to Ingest: {dynamicPreview.totalDataRows} rows
                  detected (Date, Description, and Amount columns mapped)
                </span>
              </div>
            ) : (
              <div className="text-amber-300 flex items-center gap-1.5 font-medium">
                <AlertCircle className="w-4 h-4" />
                <span>
                  ⚠️ Please map at least one{" "}
                  {!mappingValidation.hasDate && "Date, "}
                  {!mappingValidation.hasDesc && "Description, "}
                  {!mappingValidation.hasAmount &&
                    "Amount (or Debit + Credit) "}{" "}
                  column to proceed.
                </span>
              </div>
            )}

            <div className="flex items-center gap-2">
              {!stagingResult.needs_column_mapping && (
                <button
                  type="button"
                  onClick={() => setIsMapperManuallyOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                >
                  Close Wizard
                </button>
              )}
              <button
                type="button"
                disabled={!mappingValidation.isValid}
                onClick={() => void handleApplyColumnMapping()}
                className={`px-4 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors ${
                  mappingValidation.isValid
                    ? "bg-emerald-500 hover:bg-emerald-400 text-neutral-950 shadow-sm"
                    : "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                }`}
              >
                <Check className="w-4 h-4" />
                <span>Parse &amp; Stage Rows (↵)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SURFACE 4: Stage 7 Keyboard-First Staging Grid                      */}
      {/* =================================================================== */}
      {stagingResult && !stagingResult.needs_column_mapping && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Staging Summary Metrics Strip */}
          <div className="px-4 py-2 bg-neutral-900/50 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-neutral-300">
                Total Parsed:{" "}
                <strong className="text-white">
                  {stagingResult.staged_rows.length}
                </strong>
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono text-[11px]">
                ✓ {ruleMatchedCount} Rule Matched
              </span>
              {duplicateCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono text-[11px]">
                  🛡️ {duplicateCount} Duplicate(s) Skipped (BLAKE3)
                </span>
              )}
            </div>
            <span className="text-[11px] text-neutral-400 hidden lg:inline">
              Assigning an Entity automatically inherits its default Category
              and enables{" "}
              <strong className="text-emerald-300">⚡ Auto-learn rule</strong>.
            </span>
          </div>

          <div className="grid grid-cols-[40px_100px_1fr_190px_190px_120px_170px] items-center px-4 h-8 bg-neutral-900 border-b border-neutral-800 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 shrink-0">
            <div>Imp</div>
            <div>Date</div>
            <div>Scrubbed Clean &amp; Raw Description</div>
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
