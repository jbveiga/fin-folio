import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  GitMerge,
  Layers,
  X,
} from "lucide-react";
import { useFinFolioStore } from "../stores/useFinFolioStore";
import { Category } from "../types";
import { formatCurrency } from "../utils/money";

interface CategoryMergeModalProps {
  isOpen: boolean;
  sourceCategory: Category | null;
  onClose: () => void;
}

export const CategoryMergeModal: React.FC<CategoryMergeModalProps> = ({
  isOpen,
  sourceCategory,
  onClose,
}) => {
  const {
    categories,
    baseCurrency,
    previewCategoryMerge,
    mergeCategories,
    setStatusBanner,
  } = useFinFolioStore();

  const [targetId, setTargetId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Compute category path map (e.g. "Alimentação › Supermercado")
  const categoryPathMap = useMemo(() => {
    const map = new Map<string, string>();
    const getPath = (cat: Category): string => {
      if (!cat.parent_id) return cat.name;
      const parent = categories.find((c) => c.id === cat.parent_id);
      return parent ? `${getPath(parent)} › ${cat.name}` : cat.name;
    };
    for (const c of categories) {
      map.set(c.id, getPath(c));
    }
    return map;
  }, [categories]);

  // Find descendant IDs of source to prevent cyclic reparenting
  const descendantIds = useMemo(() => {
    if (!sourceCategory) return new Set<string>();
    const desc = new Set<string>();
    const addDescendants = (parentId: string) => {
      for (const c of categories) {
        if (c.parent_id === parentId) {
          desc.add(c.id);
          addDescendants(c.id);
        }
      }
    };
    addDescendants(sourceCategory.id);
    return desc;
  }, [categories, sourceCategory]);

  // Eligible targets: same direction, not self, not descendant
  const eligibleTargets = useMemo(() => {
    if (!sourceCategory) return [];
    return categories.filter(
      (c) =>
        c.id !== sourceCategory.id &&
        c.direction === sourceCategory.direction &&
        !descendantIds.has(c.id)
    );
  }, [categories, sourceCategory, descendantIds]);

  // Pre-select first eligible target when modal opens or source changes
  useEffect(() => {
    if (eligibleTargets.length > 0) {
      if (!targetId || !eligibleTargets.some((c) => c.id === targetId)) {
        setTargetId(eligibleTargets[0].id);
      }
    } else {
      setTargetId("");
    }
  }, [eligibleTargets, targetId]);

  // Calculate live impact preview
  const impactPreview = useMemo(() => {
    if (!sourceCategory || !targetId) return null;
    return previewCategoryMerge(sourceCategory.id, targetId);
  }, [sourceCategory, targetId, previewCategoryMerge]);

  // Escape to close and Enter to submit
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && !e.shiftKey) {
        if (impactPreview?.isValid && !isSubmitting) {
          e.preventDefault();
          void handleExecuteMerge();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, impactPreview, isSubmitting, onClose]);

  if (!isOpen || !sourceCategory) return null;

  const handleExecuteMerge = async () => {
    if (!targetId || !impactPreview?.isValid || isSubmitting) return;
    try {
      setIsSubmitting(true);
      await mergeCategories(sourceCategory.id, targetId);
      onClose();
    } catch (err) {
      setStatusBanner(
        `Failed to merge categories: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const targetCategory = categories.find((c) => c.id === targetId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[640px] rounded-2xl bg-neutral-900 border border-neutral-800 shadow-2xl p-5 md:p-6 space-y-4 text-xs select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <GitMerge className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-100">
                Merge &amp; Consolidate Category
              </h3>
              <p className="text-[11px] text-neutral-400">
                Atomically repoints transactions, entities, and rules into target.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source Category (Deprecated) */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Source Category (To Be Pruned)
          </label>
          <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: sourceCategory.color_hex }}
              />
              <div>
                <div className="font-semibold text-neutral-100 text-sm">
                  {categoryPathMap.get(sourceCategory.id) || sourceCategory.name}
                </div>
                <div className="text-[11px] text-neutral-400 font-mono flex items-center gap-2 mt-0.5">
                  <span
                    className={`px-1.5 py-0.2 rounded ${
                      sourceCategory.direction === "Income"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-rose-500/15 text-rose-400"
                    }`}
                  >
                    {sourceCategory.direction}
                  </span>
                  <span>
                    Budget:{" "}
                    {sourceCategory.monthly_budget_cents
                      ? formatCurrency(
                          sourceCategory.monthly_budget_cents,
                          baseCurrency
                        )
                      : "None"}
                  </span>
                </div>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 font-mono text-[10px]">
              Will be deleted
            </span>
          </div>
        </div>

        {/* Connecting Direction Indicator */}
        <div className="flex items-center justify-center -my-1">
          <div className="w-7 h-7 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-300 shadow-sm">
            <ArrowDown className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Target Category Selection */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 flex items-center justify-between">
            <span>Target Category (Destination)</span>
            <span className="text-neutral-500 font-normal">
              {eligibleTargets.length} eligible
            </span>
          </label>

          {eligibleTargets.length === 0 ? (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
              No eligible target categories found with matching direction (
              {sourceCategory.direction}). Please create a target category first.
            </div>
          ) : (
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-700 text-neutral-100 font-medium focus:outline-none focus:border-emerald-500 text-xs"
            >
              {eligibleTargets.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryPathMap.get(c.id) || c.name} (
                  {c.monthly_budget_cents
                    ? `Budget: ${formatCurrency(
                        c.monthly_budget_cents,
                        baseCurrency
                      )}`
                    : "No budget"}
                  )
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Real-Time Impact Preview Card */}
        {impactPreview && (
          <div
            className={`p-3.5 rounded-xl border space-y-2.5 ${
              impactPreview.isValid
                ? "bg-neutral-950/80 border-neutral-800"
                : "bg-amber-950/20 border-amber-500/40"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-neutral-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                <span>Atomic Merge Impact Summary</span>
              </span>
              {impactPreview.isValid ? (
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-mono">
                  Zero Data Loss (ACID)
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-mono">
                  Merge Blocked
                </span>
              )}
            </div>

            <ul className="space-y-1.5 text-[11px] text-neutral-300">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">•</span>
                <span>
                  <strong className="text-white font-mono">
                    {impactPreview.affectedTransactionCount}
                  </strong>{" "}
                  historical transaction split(s) will be repointed to{" "}
                  <strong className="text-white">
                    {targetCategory?.name || "Target"}
                  </strong>
                  .
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">•</span>
                <span>
                  <strong className="text-white font-mono">
                    {impactPreview.affectedRuleCount}
                  </strong>{" "}
                  categorization rule(s) will auto-classify into{" "}
                  <strong className="text-white">
                    {targetCategory?.name || "Target"}
                  </strong>{" "}
                  (duplicates consolidated with summed hit counts).
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">•</span>
                <span>
                  <strong className="text-white font-mono">
                    {impactPreview.affectedEntityCount}
                  </strong>{" "}
                  merchant default category reference(s) will be updated.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">•</span>
                <span>
                  Monthly budget targets consolidated:{" "}
                  <strong className="text-white font-mono">
                    {impactPreview.combinedBudgetCents !== null
                      ? formatCurrency(
                          impactPreview.combinedBudgetCents,
                          baseCurrency
                        )
                      : "None"}
                  </strong>{" "}
                  (
                  {impactPreview.sourceBudgetCents
                    ? `+${formatCurrency(
                        impactPreview.sourceBudgetCents,
                        baseCurrency
                      )} from source`
                    : "No source budget"}
                  ).
                </span>
              </li>
              <li className="flex items-start gap-2 text-rose-300">
                <span className="text-rose-400 mt-0.5">•</span>
                <span>
                  Category &quot;{sourceCategory.name}&quot; will be permanently
                  pruned from active taxonomy.
                </span>
              </li>
            </ul>

            {impactPreview.hasChildCategories && (
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-start gap-2 text-[11px]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Active subcategories detected: child categories will be
                  automatically reparented under{" "}
                  <strong>{targetCategory?.name}</strong>.
                </span>
              </div>
            )}

            {!impactPreview.isValid && impactPreview.validationError && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-2 text-[11px]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{impactPreview.validationError}</span>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium transition-colors"
          >
            Cancel (Esc)
          </button>
          <button
            type="button"
            disabled={!impactPreview?.isValid || isSubmitting}
            onClick={() => void handleExecuteMerge()}
            className={`px-4 py-2 rounded-xl font-semibold flex items-center gap-1.5 transition-colors shadow-sm ${
              impactPreview?.isValid && !isSubmitting
                ? "bg-emerald-500 hover:bg-emerald-400 text-neutral-950 cursor-pointer"
                : "bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700"
            }`}
          >
            <GitMerge className="w-3.5 h-3.5" />
            <span>
              {isSubmitting
                ? "Merging Categories..."
                : `Merge & Repoint ${
                    impactPreview?.affectedTransactionCount ?? 0
                  } Transactions (Enter)`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
