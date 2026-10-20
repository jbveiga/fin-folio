//! 3-Tier Auto-Categorization & Rule Matching Engine (Stage 7)
//!
//! Evaluates scrubbed transaction descriptions against:
//! - Tier 1: Explicit `Exact`, `Prefix`, and `Regex` rules ordered by `priority_weight` descending.
//! - Tier 2: Substring / Keyword containment (`Contains` rules) using an in-memory compiled
//!           `AhoCorasick` automaton where **longest match wins** (tie-broken by `priority_weight` descending).
//! - Tier 3: Historical Jaro-Winkler fuzzy fallback (`> 92%` similarity) with a `"Suggested"` badge.

use crate::models::{Entity, ImportRule, MatchMode};
use aho_corasick::{AhoCorasick, AhoCorasickBuilder, MatchKind};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use strsim::jaro_winkler;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleMatchTier {
    /// Tier 1: Matched an explicit Exact, Prefix, or Regex rule
    Tier1Explicit { rule_id: String },
    /// Tier 2: Matched a Substring/Contains rule (longest match wins)
    Tier2Substring {
        rule_id: String,
        matched_length: usize,
    },
    /// Tier 3: Matched a historical transaction via Jaro-Winkler > 92% ("Suggested" badge)
    Tier3HistoricalFuzzy {
        /// Similarity in basis points (e.g. 9540 = 95.40%)
        similarity_bps: u32,
        matched_description: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CategorizationMatch {
    pub entity_id: Option<String>,
    pub category_id: Option<String>,
    pub tier: RuleMatchTier,
    pub is_suggested: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoricalExemplar {
    pub clean_description: String,
    pub entity_id: Option<String>,
    pub category_id: Option<String>,
}

struct CompiledTier1Rule {
    rule: ImportRule,
    upper_pattern: String,
    compiled_regex: Option<Regex>,
}

/// High-performance in-memory compiled Rule & Historical Matching Engine.
pub struct RuleMatcherEngine {
    tier1_rules: Vec<CompiledTier1Rule>,
    tier2_rules: Vec<ImportRule>,
    tier2_automaton: Option<AhoCorasick>,
    entity_default_categories: HashMap<String, Option<String>>,
    historical_exemplars: Vec<HistoricalExemplar>,
}

impl RuleMatcherEngine {
    pub fn new(
        mut rules: Vec<ImportRule>,
        entities: &[Entity],
        historical_exemplars: Vec<HistoricalExemplar>,
    ) -> Self {
        // Sort all rules by priority_weight descending
        rules.sort_by(|a, b| b.priority_weight.cmp(&a.priority_weight));

        let mut entity_default_categories = HashMap::with_capacity(entities.len());
        for entity in entities {
            entity_default_categories
                .insert(entity.id.clone(), entity.default_category_id.clone());
        }

        let mut tier1_rules = Vec::new();
        let mut tier2_rules = Vec::new();
        let mut tier2_patterns = Vec::new();

        for rule in rules {
            match rule.match_mode {
                MatchMode::Exact | MatchMode::Prefix | MatchMode::Regex => {
                    let upper_pattern = rule.pattern_string.trim().to_uppercase();
                    let compiled_regex = if rule.match_mode == MatchMode::Regex {
                        Regex::new(&format!("(?i){}", rule.pattern_string)).ok()
                    } else {
                        None
                    };
                    tier1_rules.push(CompiledTier1Rule {
                        rule,
                        upper_pattern,
                        compiled_regex,
                    });
                }
                MatchMode::Contains => {
                    let pat = rule.pattern_string.trim().to_uppercase();
                    if !pat.is_empty() {
                        tier2_patterns.push(pat);
                        tier2_rules.push(rule);
                    }
                }
            }
        }

        let tier2_automaton = if !tier2_patterns.is_empty() {
            AhoCorasickBuilder::new()
                .ascii_case_insensitive(true)
                .match_kind(MatchKind::Standard)
                .build(&tier2_patterns)
                .ok()
        } else {
            None
        };

        Self {
            tier1_rules,
            tier2_rules,
            tier2_automaton,
            entity_default_categories,
            historical_exemplars,
        }
    }

    /// Resolves inherited category from Entity if rule only specifies `assigned_entity_id`.
    fn resolve_entity_and_category(
        &self,
        entity_id: Option<String>,
        category_id: Option<String>,
    ) -> (Option<String>, Option<String>) {
        if category_id.is_some() {
            return (entity_id, category_id);
        }
        if let Some(ref eid) = entity_id {
            if let Some(default_cat) = self.entity_default_categories.get(eid) {
                return (entity_id, default_cat.clone());
            }
        }
        (entity_id, None)
    }

    /// Evaluates a transaction description against Tier 1 -> Tier 2 -> Tier 3.
    pub fn evaluate(
        &self,
        account_id: &str,
        clean_description: &str,
        raw_scrubbed_description: &str,
    ) -> Option<CategorizationMatch> {
        let candidate_clean = clean_description.trim().to_uppercase();
        let candidate_raw = raw_scrubbed_description.trim().to_uppercase();

        // ---------------------------------------------------------------------
        // Tier 1: Exact, Prefix, and Regex Rules (ordered by priority_weight DESC)
        // ---------------------------------------------------------------------
        for compiled in &self.tier1_rules {
            if let Some(ref scope_acc) = compiled.rule.account_scope_id {
                if scope_acc != account_id {
                    continue;
                }
            }

            let matched = match compiled.rule.match_mode {
                MatchMode::Exact => {
                    candidate_clean == compiled.upper_pattern
                        || candidate_raw == compiled.upper_pattern
                }
                MatchMode::Prefix => {
                    candidate_clean.starts_with(&compiled.upper_pattern)
                        || candidate_raw.starts_with(&compiled.upper_pattern)
                }
                MatchMode::Regex => compiled
                    .compiled_regex
                    .as_ref()
                    .map(|re| re.is_match(clean_description) || re.is_match(raw_scrubbed_description))
                    .unwrap_or(false),
                MatchMode::Contains => false,
            };

            if matched {
                let (entity_id, category_id) = self.resolve_entity_and_category(
                    compiled.rule.assigned_entity_id.clone(),
                    compiled.rule.assigned_category_id.clone(),
                );
                return Some(CategorizationMatch {
                    entity_id,
                    category_id,
                    tier: RuleMatchTier::Tier1Explicit {
                        rule_id: compiled.rule.id.clone(),
                    },
                    is_suggested: false,
                });
            }
        }

        // ---------------------------------------------------------------------
        // Tier 2: Substring / Keyword Containment (Longest-Match Wins via Aho-Corasick)
        // ---------------------------------------------------------------------
        if let Some(ref ac) = self.tier2_automaton {
            let mut best_rule: Option<(&ImportRule, usize)> = None;

            for haystack in [&candidate_clean, &candidate_raw] {
                for mat in ac.find_overlapping_iter(haystack) {
                    let rule = &self.tier2_rules[mat.pattern().as_usize()];
                    if let Some(ref scope_acc) = rule.account_scope_id {
                        if scope_acc != account_id {
                            continue;
                        }
                    }
                    let pat_char_len = rule.pattern_string.trim().chars().count();
                    match best_rule {
                        None => best_rule = Some((rule, pat_char_len)),
                        Some((current_best, best_len)) => {
                            if pat_char_len > best_len
                                || (pat_char_len == best_len
                                    && rule.priority_weight > current_best.priority_weight)
                            {
                                best_rule = Some((rule, pat_char_len));
                            }
                        }
                    }
                }
            }

            if let Some((winning_rule, matched_length)) = best_rule {
                let (entity_id, category_id) = self.resolve_entity_and_category(
                    winning_rule.assigned_entity_id.clone(),
                    winning_rule.assigned_category_id.clone(),
                );
                return Some(CategorizationMatch {
                    entity_id,
                    category_id,
                    tier: RuleMatchTier::Tier2Substring {
                        rule_id: winning_rule.id.clone(),
                        matched_length,
                    },
                    is_suggested: false,
                });
            }
        }

        // ---------------------------------------------------------------------
        // Tier 3: Historical Fuzzy Fallback (Jaro-Winkler > 92% / 0.92)
        // ---------------------------------------------------------------------
        if !candidate_clean.is_empty() {
            let mut best_fuzzy: Option<(&HistoricalExemplar, u32)> = None;
            for exemplar in &self.historical_exemplars {
                if exemplar.entity_id.is_none() && exemplar.category_id.is_none() {
                    continue;
                }
                let hist_upper = exemplar.clean_description.trim().to_uppercase();
                if hist_upper.is_empty() {
                    continue;
                }
                let sim = jaro_winkler(&candidate_clean, &hist_upper);
                // Convert [0.0, 1.0] to integer basis points [0, 10000]; strictly > 9200 (> 92.00%)
                let sim_bps = (sim * 10_000.0).round() as u32;
                if sim_bps > 9200 {
                    match best_fuzzy {
                        None => best_fuzzy = Some((exemplar, sim_bps)),
                        Some((_, current_best_bps)) => {
                            if sim_bps > current_best_bps {
                                best_fuzzy = Some((exemplar, sim_bps));
                            }
                        }
                    }
                }
            }

            if let Some((exemplar, similarity_bps)) = best_fuzzy {
                let (entity_id, category_id) = self.resolve_entity_and_category(
                    exemplar.entity_id.clone(),
                    exemplar.category_id.clone(),
                );
                return Some(CategorizationMatch {
                    entity_id,
                    category_id,
                    tier: RuleMatchTier::Tier3HistoricalFuzzy {
                        similarity_bps,
                        matched_description: exemplar.clean_description.clone(),
                    },
                    is_suggested: true,
                });
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tier2_longest_match_wins_and_entity_inheritance() {
        let entities = vec![
            Entity {
                id: "ent_continente".to_string(),
                normalized_name: "Continente".to_string(),
                default_category_id: Some("cat_supermercado".to_string()),
                tax_id_nif: None,
            },
            Entity {
                id: "ent_bom_dia".to_string(),
                normalized_name: "Continente Bom Dia".to_string(),
                default_category_id: Some("cat_mercearia".to_string()),
                tax_id_nif: None,
            },
        ];

        let rules = vec![
            ImportRule {
                id: "rule_short".to_string(),
                match_mode: MatchMode::Contains,
                pattern_string: "CONTINENTE".to_string(),
                account_scope_id: None,
                assigned_entity_id: Some("ent_continente".to_string()),
                assigned_category_id: None,
                priority_weight: 500, // Even with higher priority weight, longest match wins in Tier 2
                hit_count: 10,
            },
            ImportRule {
                id: "rule_long".to_string(),
                match_mode: MatchMode::Contains,
                pattern_string: "CONTINENTE BOM DIA".to_string(),
                account_scope_id: None,
                assigned_entity_id: Some("ent_bom_dia".to_string()),
                assigned_category_id: None,
                priority_weight: 100,
                hit_count: 2,
            },
        ];

        let engine = RuleMatcherEngine::new(rules, &entities, vec![]);
        let res = engine
            .evaluate("acc_1", "CONTINENTE BOM DIA LISBOA", "COMPRA ELEC CONTINENTE BOM DIA LISBOA")
            .expect("should match Tier 2 rule");

        assert_eq!(res.entity_id.as_deref(), Some("ent_bom_dia"));
        // Inherited from Entity's default_category_id!
        assert_eq!(res.category_id.as_deref(), Some("cat_mercearia"));
        assert!(!res.is_suggested);
        assert!(matches!(
            res.tier,
            RuleMatchTier::Tier2Substring {
                ref rule_id,
                matched_length: 18
            } if rule_id == "rule_long"
        ));
    }

    #[test]
    fn test_tier3_jaro_winkler_historical_fuzzy_fallback() {
        let historical = vec![HistoricalExemplar {
            clean_description: "FARMACIA SAO JOAO PORTO".to_string(),
            entity_id: Some("ent_farmacia".to_string()),
            category_id: Some("cat_saude".to_string()),
        }];

        let engine = RuleMatcherEngine::new(vec![], &[], historical);
        let res = engine
            .evaluate("acc_1", "FARMACIA SAO JOAO PRT", "FARMACIA SAO JOAO PRT")
            .expect("should match Tier 3 historical fuzzy > 92%");

        assert!(res.is_suggested);
        assert_eq!(res.entity_id.as_deref(), Some("ent_farmacia"));
        assert_eq!(res.category_id.as_deref(), Some("cat_saude"));
        assert!(matches!(
            res.tier,
            RuleMatchTier::Tier3HistoricalFuzzy { similarity_bps, .. } if similarity_bps > 9200
        ));
    }
}
