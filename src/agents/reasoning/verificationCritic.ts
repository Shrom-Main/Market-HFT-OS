/**
/**
 * POC-001: Verification & Independent Critic Agent
 *
 * Implements the selective verification stage.
 * Acts as an adversarial quality gate that inspects investigation findings, claims,
 * and category-specific compliance before findings can be promoted or used for underwriting.
 *
 * Invariants Enforced:
 * 1. Evidence Grounding Gate: Every asserted factual claim MUST cite a valid evidence record.
 * 2. Independence Gate: Syndicated claims cannot masquerade as independent corroboration.
 * 3. Category Compliance: Must satisfy CATEGORY_VERIFICATION_REQUIREMENTS for candidate's category.
 * 4. Conflict Resolution Gate: No claim can be approved while active FATAL_DISQUALIFIER conflicts exist.
 * 5. Epistemic Ceiling: Unverified directory claims cannot be elevated above DIRECTORY_CLAIM.
 */

import { CATEGORY_VERIFICATION_REQUIREMENTS, OpportunityCategory } from '../../canonical/opportunityCategory.js';
import {
  CheckpointableInvestigationState,
  VerificationCritiqueResult,
  EpistemicClassification
} from './reasoningTypes.js';

export class VerificationCritic {
  /**
   * Deterministically audits the full investigation state against verification gates.
   */
  public static critiqueInvestigation(
    state: CheckpointableInvestigationState
  ): VerificationCritiqueResult {
    const rejectionReasons: string[] = [];
    const ungroundedClaims: string[] = [];
    const unaddressedConflicts: string[] = [];
    const missingMandatoryFields: string[] = [];
    const remedialActions: string[] = [];
    const nowUtc = new Date().toISOString();

    const evidenceMap = new Map(state.evidence_records.map((e) => [e.evidence_id, e]));

    // 1. Evidence Grounding Audit on Hypotheses
    for (const hyp of state.hypotheses) {
      if (hyp.status === 'SUPPORTED') {
        if (hyp.supporting_evidence_ids.length === 0) {
          ungroundedClaims.push(hyp.hypothesis_id);
          rejectionReasons.push(`Hypothesis '${hyp.hypothesis_id}' marked SUPPORTED with zero evidence citations.`);
          remedialActions.push(`Gather documentary evidence to support '${hyp.statement}'`);
        } else {
          for (const evId of hyp.supporting_evidence_ids) {
            if (!evidenceMap.has(evId)) {
              ungroundedClaims.push(`${hyp.hypothesis_id}:${evId}`);
              rejectionReasons.push(`Hypothesis '${hyp.hypothesis_id}' cites non-existent evidence '${evId}'.`);
            }
          }
        }
      }
    }

    // 2. Active Conflict Audit
    const activeConflicts = state.conflicts.filter((c) => c.status === 'ACTIVE');
    for (const conf of activeConflicts) {
      unaddressedConflicts.push(conf.conflict_id);
      if (conf.severity === 'FATAL_DISQUALIFIER') {
        rejectionReasons.push(
          `Fatal conflict '${conf.conflict_id}' unresolved on '${conf.target_field_or_claim}' (${conf.evidence_a_id} vs ${conf.evidence_b_id}).`
        );
        remedialActions.push(`Resolve fatal contradiction on '${conf.target_field_or_claim}' before proceeding.`);
      }
    }

    // 3. Category-Specific Critical Fields Audit
    const catReqs = CATEGORY_VERIFICATION_REQUIREMENTS[state.category] ?? CATEGORY_VERIFICATION_REQUIREMENTS['PHYSICAL_GOODS'];

    // Check if critical fields exist in the evidence ledger claims
    const collectedFieldNames = new Set<string>();
    for (const ev of state.evidence_records) {
      for (const field of Object.keys(ev.claims)) {
        if (ev.claims[field] !== null && ev.claims[field] !== undefined) {
          collectedFieldNames.add(field);
        }
      }
    }

    if (catReqs.requires_upstream_quote && !collectedFieldNames.has('factory_gate_quote_inr') && !collectedFieldNames.has('quote_inr')) {
      missingMandatoryFields.push('factory_gate_quote_inr');
      rejectionReasons.push(`Category '${state.category}' mandates verified factory gate quote.`);
      remedialActions.push('Acquire primary supplier quotation or manufacturer rate sheet.');
    }

    if (catReqs.requires_prevailing_price && !collectedFieldNames.has('prevailing_retail_asp_inr') && !collectedFieldNames.has('retail_price_inr')) {
      missingMandatoryFields.push('prevailing_retail_asp_inr');
      rejectionReasons.push(`Category '${state.category}' mandates prevailing retail/market ASP.`);
      remedialActions.push('Collect retail marketplace capture or public price index.');
    }

    // 4. Stale Fallback Audit: Never treat STALE_HISTORICAL fallback data as current verification
    for (const ev of state.evidence_records) {
      if (ev.fallback_provenance?.freshness_status === 'STALE_HISTORICAL' || ev.fallback_provenance?.fallback_type === 'TYPE_4_HISTORICAL_CACHE') {
        for (const field of Object.keys(ev.claims)) {
          if (
            field === 'factory_gate_quote_inr' ||
            field === 'quote_inr' ||
            field === 'corporate_status' ||
            catReqs.category_specific_critical_fields.includes(field)
          ) {
            rejectionReasons.push(
              `Critical field '${field}' was populated from STALE_HISTORICAL fallback [${ev.evidence_id}] (${ev.fallback_provenance.snapshot_timestamp_utc}). Stale fallback data cannot serve as current verification.`
            );
            remedialActions.push(`Acquire fresh, real-time verification for '${field}' before proceeding.`);
          }
        }
      }
    }

    // 5. Stage C.3.3 Integrity Check: Dimensional Unit Mismatch Audit
    for (const ev of state.evidence_records) {
      const claims = ev.claims;
      const hasScrapPerKg = claims.commodity_benchmark_inr_per_kg !== undefined || claims.lme_ss304_inr_per_kg !== undefined;
      const hasUnitQuote = claims.factory_gate_quote_inr !== undefined || claims.quote_inr !== undefined || claims.gross_price_inr !== undefined;
      const hasMass = claims.component_mass_grams !== undefined || claims.pack_mass_grams !== undefined;

      if ((hasScrapPerKg && hasUnitQuote && !hasMass) || claims.dimensional_mismatch === true) {
        rejectionReasons.push(
          `E-CRITIC-DIMENSIONAL-MISMATCH: Evidence [${ev.evidence_id}] compares per-kilogram commodity benchmark against per-unit product quotation without component mass in grams. Dimensional unit mismatch prevents valid floor inference.`
        );
        remedialActions.push('Acquire component mass (grams) to derive scaled per-unit scrap floor.');
      }
    }

    // 6. Stage C.3.3 Integrity Check: Corporate Registration Fallacy Audit
    for (const hyp of state.hypotheses) {
      if (hyp.status === 'SUPPORTED' && /manufacturing capability|production plant|factory operational/i.test(hyp.statement)) {
        const onlyStatutory = hyp.supporting_evidence_ids.every((id) => {
          const ev = evidenceMap.get(id);
          return ev && (ev.epistemic_status === 'PRIMARY_REGISTRY' || ev.source_name.includes('statutory'));
        });
        if (onlyStatutory) {
          rejectionReasons.push(
            `E-CRITIC-EPISTEMIC-FALLACY: Hypothesis '${hyp.hypothesis_id}' claims manufacturing capability based solely on statutory corporate registration. Registration establishes legal existence, not manufacturing operations.`
          );
          remedialActions.push('Perform physical factory site audit or obtain verified machinery asset schedule.');
        }
      }
    }
    for (const ev of state.evidence_records) {
      if (ev.claims.manufacturing_capability_proven === true && !ev.claims.physical_plant_inspected) {
        rejectionReasons.push(
          `E-CRITIC-EPISTEMIC-FALLACY: Evidence [${ev.evidence_id}] claims manufacturing capability without physical plant inspection.`
        );
      }
    }

    // 7. Stage C.3.3 Integrity Check: Unsupported SaaS Gross Margin Audit
    if (state.category === 'SOFTWARE_DIGITAL' || state.category === 'SERVICE_SOFTWARE') {
      for (const ev of state.evidence_records) {
        const claims = ev.claims;
        const hasMargin = claims.margin_estimate !== undefined || claims.gross_margin !== undefined;
        const isUnsupported =
          claims.margin_epistemic_status === 'UNSUPPORTED_ESTIMATE' ||
          (hasMargin && claims.cost_basis_breakdown && !(claims.cost_basis_breakdown as any).compute_cogs_documented);

        if (isUnsupported) {
          rejectionReasons.push(
            `E-CRITIC-UNSUPPORTED-COGS: Evidence [${ev.evidence_id}] asserts SaaS gross margin without verified COGS telemetry or infrastructure cost disclosures.`
          );
          remedialActions.push('Collect cloud infrastructure billing or classify gross margin as UNSUPPORTED_ESTIMATE.');
        }
      }
    }

    // 4. Determine Highest Justifiable Epistemic Ceiling
    let epistemicCeiling: EpistemicClassification = 'UNVERIFIED_HYPOTHESIS';

    const hasPrimaryRegistry = state.evidence_records.some((e) => e.epistemic_status === 'PRIMARY_REGISTRY');
    const hasDirectObs = state.evidence_records.some((e) => e.epistemic_status === 'OBSERVED_FACT');
    const uniqueSyndicationClusters = new Set(
      state.evidence_records.map((e) => e.syndication_cluster_id).filter(Boolean)
    );

    if (hasDirectObs) {
      epistemicCeiling = 'OBSERVED_FACT';
    } else if (hasPrimaryRegistry) {
      epistemicCeiling = 'PRIMARY_REGISTRY';
    } else if (uniqueSyndicationClusters.size >= 2) {
      epistemicCeiling = 'INDEPENDENT_CORROBORATION';
    } else if (state.evidence_records.length > 0) {
      epistemicCeiling = 'DIRECTORY_CLAIM';
    }

    const approved = rejectionReasons.length === 0 && unaddressedConflicts.length === 0;

    return {
      investigation_id: state.investigation_id,
      approved,
      rejection_reasons: Object.freeze(rejectionReasons),
      ungrounded_claim_ids: Object.freeze(ungroundedClaims),
      unaddressed_conflict_ids: Object.freeze(unaddressedConflicts),
      missing_mandatory_fields: Object.freeze(missingMandatoryFields),
      verified_epistemic_ceiling: epistemicCeiling,
      recommended_remedial_actions: Object.freeze(remedialActions),
      evaluated_at_utc: nowUtc
    };
  }
}
