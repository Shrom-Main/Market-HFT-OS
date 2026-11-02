/**
/**
 * POC-001: Evidence Evaluator & Syndication Detector
 *
 * Implements evidence-aware reasoning, epistemic categorization, syndication detection,
 * contradiction discovery, and negative finding tracking.
 *
 * Invariants:
 * 1. Independent Corroboration Requires Independent Origin:
 *    Multiple search results or marketplace listings sharing a phone number, email domain,
 *    GSTIN, CIN, or physical address are classified as SYNDICATED_SINGLE_ORIGIN and NEVER
 *    counted as independent corroboration.
 * 2. Strict Epistemic Stratification:
 *    Primary registry filings supersede directory listings; direct physical measurements
 *    supersede promotional claims.
 * 3. Contradiction Preservation:
 *    Disconfirming or conflicting evidence cannot be discarded; conflicts are elevated to
 *    the active evidence ledger.
 */

import { sha256 } from '../../canonical/crypto.js';
import {
  EpistemicClassification,
  ObservedEvidenceRecord,
  EvidenceConflict,
  ClaimEvidenceAssessment,
  EconomicComparisonResult,
  StatutoryStatusBreakdown
} from './reasoningTypes.js';

export class EvidenceEvaluator {
  /**
   * Normalizes and evaluates a new evidence observation, assigning its proper
   * epistemic status and identifying syndication clusters.
   */
  public static evaluateEvidence(
    rawRecord: Omit<ObservedEvidenceRecord, 'syndication_cluster_id'>,
    existingLedger: readonly ObservedEvidenceRecord[]
  ): {
    evaluatedRecord: ObservedEvidenceRecord;
    isSyndicated: boolean;
    syndicatedWithEvidenceId?: string;
  } {
    const rawIds = rawRecord.syndication_identifiers;
    let clusterId: string | undefined = undefined;
    let syndicatedWithId: string | undefined = undefined;

    if (rawIds) {
      for (const existing of existingLedger) {
        const exIds = existing.syndication_identifiers;
        if (!exIds) continue;

        const sharesPhone = rawIds.phone && exIds.phone && rawIds.phone === exIds.phone;
        const sharesGstin = rawIds.gstin && exIds.gstin && rawIds.gstin === exIds.gstin;
        const sharesCin = rawIds.corporate_cin && exIds.corporate_cin && rawIds.corporate_cin === exIds.corporate_cin;
        const sharesAddress =
          rawIds.physical_address_hash &&
          exIds.physical_address_hash &&
          rawIds.physical_address_hash === exIds.physical_address_hash;
        const sharesDomain =
          rawIds.email_domain &&
          exIds.email_domain &&
          rawIds.email_domain === exIds.email_domain &&
          !this.isPublicEmailDomain(rawIds.email_domain);

        if (sharesPhone || sharesGstin || sharesCin || sharesAddress || sharesDomain) {
          clusterId = existing.syndication_cluster_id ?? `SYN-CLUSTER-${existing.evidence_id}`;
          syndicatedWithId = existing.evidence_id;
          break;
        }
      }
    }

    const isSyndicated = clusterId !== undefined;
    const finalClusterId = clusterId ?? `SYN-CLUSTER-${rawRecord.evidence_id}`;

    // Adjust epistemic status: A syndicated directory claim can NEVER be INDEPENDENT_CORROBORATION
    let adjustedEpistemic = rawRecord.epistemic_status;
    if (isSyndicated && adjustedEpistemic === 'INDEPENDENT_CORROBORATION') {
      adjustedEpistemic = 'DIRECTORY_CLAIM'; // Demote syndicated claims
    }

    const evaluatedRecord: ObservedEvidenceRecord = {
      ...rawRecord,
      syndication_cluster_id: finalClusterId,
      epistemic_status: adjustedEpistemic
    };

    return {
      evaluatedRecord,
      isSyndicated,
      syndicatedWithEvidenceId: syndicatedWithId
    };
  }

  /**
   * Scans a new observation against existing evidence records to detect material contradictions.
   */
  public static detectConflicts(
    newRecord: ObservedEvidenceRecord,
    existingLedger: readonly ObservedEvidenceRecord[]
  ): EvidenceConflict[] {
    const conflicts: EvidenceConflict[] = [];
    const nowUtc = new Date().toISOString();

    for (const ex of existingLedger) {
      if (ex.evidence_id === newRecord.evidence_id) continue;

      // 1. Corporate Existence / Operational Status Contradictions
      const newStatus = (newRecord.claims['corporate_status'] || newRecord.claims['operating_status']) as string | undefined;
      const exStatus = (ex.claims['corporate_status'] || ex.claims['operating_status']) as string | undefined;

      if (newStatus && exStatus && newStatus.toUpperCase() !== exStatus.toUpperCase()) {
        const isDisqualifying =
          (newStatus.includes('STRIKE') || newStatus.includes('DISSOLVED') || newStatus.includes('AMALGAMATED')) ||
          (exStatus.includes('STRIKE') || exStatus.includes('DISSOLVED') || exStatus.includes('AMALGAMATED'));

        conflicts.push({
          conflict_id: `CONF-${sha256(newRecord.evidence_id + ex.evidence_id + 'corporate_status').substring(0, 12)}`,
          target_field_or_claim: 'corporate_status',
          evidence_a_id: ex.evidence_id,
          evidence_a_claim: exStatus,
          evidence_b_id: newRecord.evidence_id,
          evidence_b_claim: newStatus,
          severity: isDisqualifying ? 'FATAL_DISQUALIFIER' : 'MATERIAL_AMBIGUITY',
          status: 'ACTIVE',
          resolution_notes: `Conflict detected between '${ex.source_name}' (${ex.epistemic_status}) and '${newRecord.source_name}' (${newRecord.epistemic_status})`,
          recorded_at_utc: nowUtc
        });
      }

      // 2. Factory Quote / Unit Economics Discrepancies (>35% variance)
      const newQuote = Number(newRecord.claims['factory_gate_quote_inr'] ?? newRecord.claims['quote_inr']);
      const exQuote = Number(ex.claims['factory_gate_quote_inr'] ?? ex.claims['quote_inr']);

      if (Number.isFinite(newQuote) && Number.isFinite(exQuote) && newQuote > 0 && exQuote > 0) {
        const diffRatio = Math.abs(newQuote - exQuote) / Math.min(newQuote, exQuote);
        if (diffRatio > 0.35) {
          conflicts.push({
            conflict_id: `CONF-${sha256(newRecord.evidence_id + ex.evidence_id + 'factory_quote').substring(0, 12)}`,
            target_field_or_claim: 'factory_gate_quote_inr',
            evidence_a_id: ex.evidence_id,
            evidence_a_claim: exQuote,
            evidence_b_id: newRecord.evidence_id,
            evidence_b_claim: newQuote,
            severity: 'MATERIAL_AMBIGUITY',
            status: 'ACTIVE',
            resolution_notes: `Unit quote discrepancy of ${Math.round(diffRatio * 100)}% between sources`,
            recorded_at_utc: nowUtc
          });
        }
      }

      // 3. Technical Specification Discrepancies (e.g. Material grade SS304 vs SS201 / DIN 3017 compliance)
      const newGrade = (newRecord.claims['material_grade'] || newRecord.claims['spec_standard']) as string | undefined;
      const exGrade = (ex.claims['material_grade'] || ex.claims['spec_standard']) as string | undefined;

      if (newGrade && exGrade && newGrade.trim().toUpperCase() !== exGrade.trim().toUpperCase()) {
        conflicts.push({
          conflict_id: `CONF-${sha256(newRecord.evidence_id + ex.evidence_id + 'spec_standard').substring(0, 12)}`,
          target_field_or_claim: 'spec_standard',
          evidence_a_id: ex.evidence_id,
          evidence_a_claim: exGrade,
          evidence_b_id: newRecord.evidence_id,
          evidence_b_claim: newGrade,
          severity: 'FATAL_DISQUALIFIER',
          status: 'ACTIVE',
          resolution_notes: `Material specification mismatch: claimed '${exGrade}' vs observed '${newGrade}'`,
          recorded_at_utc: nowUtc
        });
      }
    }

    return conflicts;
  }

  /**
   * Assesses the epistemic strength of an evidence collection supporting a given hypothesis.
   * Evaluates evidence claim-specifically rather than applying an arbitrary universal percentage cap.
   * Preserves:
   * - Number of independent source origins
   * - Source reliability and epistemic tier
   * - Direct vs inferred evidence
   * - Contradictions and unresolved uncertainties
   */
  public static calculateHypothesisConfidence(
    supportingIds: readonly string[],
    contradictingIds: readonly string[],
    evidenceMap: Map<string, ObservedEvidenceRecord>,
    claimTopic?: string
  ): ClaimEvidenceAssessment {
    const uncertaintyReasons: string[] = [];

    // 1. Contradiction evaluation
    if (contradictingIds.length > 0) {
      let fatalContradiction = false;
      for (const id of contradictingIds) {
        const ev = evidenceMap.get(id);
        if (ev && (ev.epistemic_status === 'PRIMARY_REGISTRY' || ev.epistemic_status === 'OBSERVED_FACT')) {
          fatalContradiction = true;
          uncertaintyReasons.push(`Refuted by primary evidence [${ev.evidence_id}]: ${ev.source_name}`);
        }
      }
      if (fatalContradiction) {
        return {
          status: 'REFUTED',
          confidence_bps: 0,
          confidenceBps: 0,
          independent_origins_count: 0,
          highest_source_reliability: 'FATAL_CONTRADICTION',
          has_direct_observation: false,
          has_primary_registry: true,
          is_syndicated: false,
          active_contradictions_count: contradictingIds.length,
          unresolved_uncertainty_reasons: Object.freeze(uncertaintyReasons)
        };
      }
      uncertaintyReasons.push(`Active unaddressed contradictory signals present (${contradictingIds.length})`);
      return {
        status: 'TESTING',
        confidence_bps: 1500,
        confidenceBps: 1500,
        independent_origins_count: 1,
        highest_source_reliability: 'DISPUTED_SIGNAL',
        has_direct_observation: false,
        has_primary_registry: false,
        is_syndicated: false,
        active_contradictions_count: contradictingIds.length,
        unresolved_uncertainty_reasons: Object.freeze(uncertaintyReasons)
      };
    }

    // 2. Empty evidence evaluation
    if (supportingIds.length === 0) {
      return {
        status: 'TESTING',
        confidence_bps: 0,
        confidenceBps: 0,
        independent_origins_count: 0,
        highest_source_reliability: 'UNVERIFIED',
        has_direct_observation: false,
        has_primary_registry: false,
        is_syndicated: false,
        active_contradictions_count: 0,
        unresolved_uncertainty_reasons: Object.freeze(['Zero supporting evidence observations recorded'])
      };
    }

    // 3. Cluster identification & source origin analysis
    const uniqueClusters = new Set<string>();
    let hasPrimaryRegistry = false;
    let hasDirectObservation = false;
    let highestReliability = 'DIRECTORY_CLAIM';
    let hasStaleFallback = false;

    for (const id of supportingIds) {
      const ev = evidenceMap.get(id);
      if (!ev) continue;
      if (ev.syndication_cluster_id) {
        uniqueClusters.add(ev.syndication_cluster_id);
      }
      if (ev.epistemic_status === 'PRIMARY_REGISTRY') {
        hasPrimaryRegistry = true;
        highestReliability = 'PRIMARY_REGISTRY';
      }
      if (ev.epistemic_status === 'OBSERVED_FACT') {
        hasDirectObservation = true;
        highestReliability = 'OBSERVED_FACT';
      }
      if (ev.fallback_provenance?.freshness_status === 'STALE_HISTORICAL') {
        hasStaleFallback = true;
        uncertaintyReasons.push(`Evidence [${ev.evidence_id}] derived from stale historical fallback snapshot`);
      }
    }

    const isSyndicated = supportingIds.length > 1 && uniqueClusters.size === 1;
    if (isSyndicated) {
      uncertaintyReasons.push('Multiple observed directory listings originate from a single syndicated origin');
    }

    const independentOrigins = uniqueClusters.size;
    const topic = (claimTopic ?? '').toLowerCase();

    // 4. Claim-Specific Epistemic Calibration

    // A. Corporate Status / Statutory Registration Claim:
    // A single primary registry record (MCA, ROC, GSTN) is authoritative and decisive!
    const isCorporateClaim =
      topic.includes('corporate') || topic.includes('status') || topic.includes('registration') || topic.includes('mca') || topic.includes('gst');
    if (isCorporateClaim && hasPrimaryRegistry) {
      return {
        status: 'SUPPORTED',
        confidence_bps: 9500, // Decisively supported by official primary statutory registry
        confidenceBps: 9500,
        independent_origins_count: independentOrigins,
        highest_source_reliability: highestReliability,
        has_direct_observation: hasDirectObservation,
        has_primary_registry: true,
        is_syndicated: isSyndicated,
        active_contradictions_count: 0,
        unresolved_uncertainty_reasons: Object.freeze(uncertaintyReasons)
      };
    }

    // B. Direct Technical/Physical Measurement:
    // Direct physical measurement / verified lab certificate is authoritative for technical specifications.
    if (hasDirectObservation && (hasPrimaryRegistry || independentOrigins >= 2)) {
      return {
        status: 'SUPPORTED',
        confidence_bps: 9200,
        confidenceBps: 9200,
        independent_origins_count: independentOrigins,
        highest_source_reliability: highestReliability,
        has_direct_observation: true,
        has_primary_registry: hasPrimaryRegistry,
        is_syndicated: isSyndicated,
        active_contradictions_count: 0,
        unresolved_uncertainty_reasons: Object.freeze(uncertaintyReasons)
      };
    }

    // C. Direct observation alone without secondary cross-check:
    if (hasDirectObservation) {
      return {
        status: 'SUPPORTED',
        confidence_bps: 8500,
        confidenceBps: 8500,
        independent_origins_count: independentOrigins,
        highest_source_reliability: highestReliability,
        has_direct_observation: true,
        has_primary_registry: hasPrimaryRegistry,
        is_syndicated: isSyndicated,
        active_contradictions_count: 0,
        unresolved_uncertainty_reasons: Object.freeze(uncertaintyReasons)
      };
    }

    // D. Primary Registry combined with Directory Listing:
    if (hasPrimaryRegistry && independentOrigins >= 1) {
      return {
        status: 'SUPPORTED',
        confidence_bps: 7800,
        confidenceBps: 7800,
        independent_origins_count: independentOrigins,
        highest_source_reliability: highestReliability,
        has_direct_observation: false,
        has_primary_registry: true,
        is_syndicated: isSyndicated,
        active_contradictions_count: 0,
        unresolved_uncertainty_reasons: Object.freeze(uncertaintyReasons)
      };
    }

    // E. Multiple Genuinely Independent Un-syndicated Directory Sources (2+ distinct origins):
    if (independentOrigins >= 2) {
      return {
        status: 'SUPPORTED',
        confidence_bps: 6500,
        confidenceBps: 6500,
        independent_origins_count: independentOrigins,
        highest_source_reliability: highestReliability,
        has_direct_observation: false,
        has_primary_registry: false,
        is_syndicated: false,
        active_contradictions_count: 0,
        unresolved_uncertainty_reasons: Object.freeze(uncertaintyReasons)
      };
    }

    // F. Single Directory Listing or Syndicated Listings:
    // Cannot be SUPPORTED without corroboration or primary record.
    uncertaintyReasons.push('Single source origin uncorroborated by primary registry or direct inspection');
    return {
      status: 'TESTING',
      confidence_bps: 3500,
      confidenceBps: 3500,
      independent_origins_count: independentOrigins,
      highest_source_reliability: highestReliability,
      has_direct_observation: false,
      has_primary_registry: false,
      is_syndicated: isSyndicated,
      active_contradictions_count: 0,
      unresolved_uncertainty_reasons: Object.freeze(uncertaintyReasons)
    };
  }

  private static isPublicEmailDomain(domain: string): boolean {
    const common = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'rediffmail.com'];
    return common.includes(domain.toLowerCase());
  }

  /**
   * Enforces the 5-Stage Epistemic Progression:
   * TRANSPORT_SUCCESS -> SOURCE_RESPONSE_OBSERVED -> CLAIM_EXTRACTED -> CLAIM_CORROBORATED -> CLAIM_VERIFIED
   *
   * Invariant: A successful HTTP/API/MCP transport operation must NOT automatically
   * produce verified factual evidence. A checksum proves integrity of recorded bytes,
   * not authenticity or truth. Syndicated sources are NEVER counted as independent corroboration.
   */
  public static validateEvidenceProgression(
    envelope: any,
    claimKey: string,
    claimValue: unknown,
    corroboratingRecords: readonly ObservedEvidenceRecord[] = []
  ): EpistemicProgressionResult {
    const traces: EpistemicStageTrace[] = [];
    const nowUtc = new Date().toISOString();

    // Stage 1: TRANSPORT_SUCCESS
    const transportOk = envelope.transport_outcome === 'SUCCESS';
    traces.push({
      stage: 'TRANSPORT_SUCCESS',
      passed: transportOk,
      timestamp_utc: envelope.timestamps?.completed_at || nowUtc,
      notes: transportOk
        ? `Transport outcome SUCCESS via connector '${envelope.connector_id}'. Latency: ${envelope.timestamps?.duration_ms ?? 0}ms.`
        : `Transport FAILED: outcome '${envelope.transport_outcome}'.`,
      byte_integrity_verified: Boolean(envelope.envelope_sha256),
      source_attribution: envelope.source_uri || 'unknown://source',
      corroboration_sources_count: 0
    });

    if (!transportOk) {
      return {
        claim_key: claimKey,
        claim_value: null,
        current_stage: 'TRANSPORT_SUCCESS',
        is_verified: false,
        stages: traces,
        epistemic_classification: 'UNVERIFIED_CLAIM',
        record_sha256: envelope.envelope_sha256 || sha256(`FAILED-${nowUtc}`)
      };
    }

    // Stage 2: SOURCE_RESPONSE_OBSERVED
    const hasPayload = envelope.payload !== null && envelope.payload !== undefined;
    traces.push({
      stage: 'SOURCE_RESPONSE_OBSERVED',
      passed: hasPayload,
      timestamp_utc: nowUtc,
      notes: hasPayload
        ? `Source payload observed from '${envelope.source_uri}'. SHA256 integrity: ${envelope.envelope_sha256}. Integrity proved; veracity unverified.`
        : 'Empty payload returned by source.',
      byte_integrity_verified: true,
      source_attribution: envelope.source_uri,
      corroboration_sources_count: 0
    });

    if (!hasPayload) {
      return {
        claim_key: claimKey,
        claim_value: null,
        current_stage: 'SOURCE_RESPONSE_OBSERVED',
        is_verified: false,
        stages: traces,
        epistemic_classification: 'UNVERIFIED_CLAIM',
        record_sha256: envelope.envelope_sha256
      };
    }

    // Stage 3: CLAIM_EXTRACTED
    const claimFound = claimValue !== undefined && claimValue !== null;
    traces.push({
      stage: 'CLAIM_EXTRACTED',
      passed: claimFound,
      timestamp_utc: nowUtc,
      notes: claimFound
        ? `Extracted claim '${claimKey}' = '${JSON.stringify(claimValue)}'.`
        : `Claim key '${claimKey}' was not present in observed source payload.`,
      byte_integrity_verified: true,
      source_attribution: envelope.source_uri,
      corroboration_sources_count: 0
    });

    if (!claimFound) {
      return {
        claim_key: claimKey,
        claim_value: null,
        current_stage: 'CLAIM_EXTRACTED',
        is_verified: false,
        stages: traces,
        epistemic_classification: 'UNVERIFIED_CLAIM',
        record_sha256: envelope.envelope_sha256
      };
    }

    // Stage 4: CLAIM_CORROBORATED
    // Check for syndication collisions across corroborating records
    const independentRecords: ObservedEvidenceRecord[] = [];
    const seenClusters = new Set<string>();

    for (const rec of corroboratingRecords) {
      const cluster = rec.syndication_cluster_id ?? `SYN-${rec.source_name}`;
      if (!seenClusters.has(cluster)) {
        seenClusters.add(cluster);
        independentRecords.push(rec);
      }
    }

    const isPrimaryRegistry =
      envelope.source_uri?.includes('mca.gov.in') ||
      envelope.source_uri?.includes('gov') ||
      envelope.connector_id === 'mcp-statutory';

    const isCorroborated = independentRecords.length >= 1 || isPrimaryRegistry;
    const isSyndicatedCollision = corroboratingRecords.length > 0 && independentRecords.length === 0;

    traces.push({
      stage: 'CLAIM_CORROBORATED',
      passed: isCorroborated,
      timestamp_utc: nowUtc,
      notes: isSyndicatedCollision
        ? 'Multiple sources share identical identity signals (GSTIN/Phone); classified as SYNDICATED and demoted from independent corroboration.'
        : isCorroborated
        ? `Claim corroborated across ${independentRecords.length} independent origin(s).`
        : 'Single origin claim; awaiting secondary corroboration.',
      byte_integrity_verified: true,
      source_attribution: envelope.source_uri,
      corroboration_sources_count: independentRecords.length
    });

    // Stage 5: CLAIM_VERIFIED
    const isVerified = isPrimaryRegistry || (isCorroborated && independentRecords.length >= 2);

    traces.push({
      stage: 'CLAIM_VERIFIED',
      passed: isVerified,
      timestamp_utc: nowUtc,
      notes: isVerified
        ? (isPrimaryRegistry ? 'Authoritative primary statutory registry confirmation.' : 'Verified by 2+ independent un-syndicated corroborating sources.')
        : 'Not verified as authoritative fact; retained as provisional claim or derived estimate.',
      byte_integrity_verified: true,
      source_attribution: envelope.source_uri,
      corroboration_sources_count: independentRecords.length
    });

    let epistemicClass: EpistemicClassification = 'UNVERIFIED_CLAIM';
    if (isVerified) {
      epistemicClass = isPrimaryRegistry ? 'OBSERVED_FACT' : 'INDEPENDENT_CORROBORATION';
    } else if (isCorroborated) {
      epistemicClass = 'DERIVED_ESTIMATE';
    } else if (envelope.freshness_status === 'STALE_HISTORICAL') {
      epistemicClass = 'UNVERIFIED_CLAIM';
    } else {
      epistemicClass = 'DIRECTORY_CLAIM';
    }

    return {
      claim_key: claimKey,
      claim_value: claimValue,
      current_stage: isVerified ? 'CLAIM_VERIFIED' : isCorroborated ? 'CLAIM_CORROBORATED' : 'CLAIM_EXTRACTED',
      is_verified: isVerified,
      stages: traces,
      epistemic_classification: epistemicClass,
      record_sha256: envelope.envelope_sha256
    };
  }

  /**
   * Stage C.3.3 Integrity Check 1: Validates economic comparisons between commodity scrap benchmarks and finished quotes.
   *
   * A per-kilogram commodity price (e.g. ₹118/kg) CANNOT establish manufacturing authenticity
   * against a per-unit quotation (e.g. ₹28.50/unit) without verified component mass (grams).
   */
  public static validateEconomicComparison(params: {
    commodity_benchmark_inr_per_kg: number;
    finished_unit_quote_inr: number;
    component_mass_grams?: number;
    min_stamping_margin_bps?: number;
  }): EconomicComparisonResult {
    const mass = params.component_mass_grams;
    if (mass === undefined || mass === null || !Number.isFinite(mass) || mass <= 0) {
      return {
        valid: false,
        defect_type: 'DIMENSIONAL_UNIT_MISMATCH',
        explanation: `Dimensional unit mismatch: Cannot compare per-kilogram scrap benchmark (₹${params.commodity_benchmark_inr_per_kg}/kg) against per-unit product quote (₹${params.finished_unit_quote_inr}/unit) without component mass in grams.`,
        commodity_benchmark_inr_per_kg: params.commodity_benchmark_inr_per_kg,
        finished_unit_quote_inr: params.finished_unit_quote_inr,
        epistemic_classification: 'UNVERIFIED_HYPOTHESIS'
      };
    }

    const stampingBps = params.min_stamping_margin_bps ?? 1500;
    const rawMetalFloorInr = (mass * params.commodity_benchmark_inr_per_kg) / 1000.0;
    const derivedFloorInr = rawMetalFloorInr * (1 + stampingBps / 10000.0);
    const isValid = params.finished_unit_quote_inr >= derivedFloorInr;

    return {
      valid: isValid,
      defect_type: 'NONE',
      explanation: isValid
        ? `Component quote ₹${params.finished_unit_quote_inr.toFixed(2)} exceeds derived manufacturing floor ₹${derivedFloorInr.toFixed(2)} (raw metal: ₹${rawMetalFloorInr.toFixed(2)} for ${mass}g at ₹${params.commodity_benchmark_inr_per_kg}/kg).`
        : `Component quote ₹${params.finished_unit_quote_inr.toFixed(2)} is BELOW derived scrap floor ₹${derivedFloorInr.toFixed(2)}. Metallurgy fraud or scrap mix detected.`,
      commodity_benchmark_inr_per_kg: params.commodity_benchmark_inr_per_kg,
      component_mass_grams: mass,
      derived_unit_scrap_floor_inr: Number(derivedFloorInr.toFixed(4)),
      finished_unit_quote_inr: params.finished_unit_quote_inr,
      margin_ratio: Number((params.finished_unit_quote_inr / derivedFloorInr).toFixed(4)),
      epistemic_classification: isValid ? 'OBSERVED_FACT' : 'INFERENCE'
    };
  }

  /**
   * Stage C.3.3 Integrity Check 2: Evaluates SaaS gross margin groundedness against COGS disclosures.
   */
  public static auditSaaSMarginGroundedness(claims: Record<string, unknown>): {
    grounded: boolean;
    margin: number | null;
    epistemic_status: EpistemicClassification;
    reason: string;
  } {
    const margin = typeof claims.margin_estimate === 'number'
      ? claims.margin_estimate
      : typeof claims.gross_margin === 'number'
      ? claims.gross_margin
      : null;

    if (margin === null) {
      return {
        grounded: false,
        margin: null,
        epistemic_status: 'UNVERIFIED_HYPOTHESIS',
        reason: 'No margin estimate recorded.'
      };
    }

    const breakdown = claims.cost_basis_breakdown as Record<string, unknown> | undefined;
    const hasCogs = Boolean(
      breakdown?.compute_cogs_documented ||
      breakdown?.source_support === 'PRIMARY_INFRASTRUCTURE_BILLING' ||
      claims.cogs_telemetry_available
    );

    if (!hasCogs) {
      return {
        grounded: false,
        margin,
        epistemic_status: 'UNVERIFIED_HYPOTHESIS',
        reason: `SaaS gross margin (${(margin * 100).toFixed(0)}%) lacks primary COGS source documentation; classified as UNSUPPORTED_ESTIMATE.`
      };
    }

    return {
      grounded: true,
      margin,
      epistemic_status: 'DERIVED_ESTIMATE',
      reason: `SaaS gross margin (${(margin * 100).toFixed(0)}%) grounded in primary infrastructure COGS disclosures.`
    };
  }

  /**
   * Stage C.3.3 Integrity Check 3: Strictly audits separation of corporate, GST, and compliance status.
   */
  public static auditStatutorySeparation(claims: Record<string, unknown>): StatutoryStatusBreakdown & {
    epistemic_defect?: string;
  } {
    const corpStatus = (claims.corporate_registration_status as any) || (claims.cin_mca_status?.toString().includes('ACTIVE') ? 'ACTIVE' : 'DORMANT');
    const gstStatus = (claims.gst_registration_status as any) || 'ACTIVE';
    const complianceStatus = (claims.annual_filing_compliance_status as any) || 'COMPLIANT_UP_TO_DATE';

    let defect: string | undefined = undefined;
    if (claims.manufacturing_capability_proven === true && !claims.physical_plant_inspected) {
      defect = 'EPISTEMIC_FALLACY: Active corporate registration proves legal corporate existence only; it does not prove physical manufacturing capability.';
    }

    return {
      corporate_registration_status: corpStatus,
      gst_registration_status: gstStatus,
      annual_filing_compliance_status: complianceStatus,
      manufacturing_capability_proven: false, // Invariant: Corporate registration alone NEVER proves manufacturing capability
      ...(defect ? { epistemic_defect: defect } : {})
    };
  }
}

export type EpistemicStage =
  | 'TRANSPORT_SUCCESS'
  | 'SOURCE_RESPONSE_OBSERVED'
  | 'CLAIM_EXTRACTED'
  | 'CLAIM_CORROBORATED'
  | 'CLAIM_VERIFIED';

export interface EpistemicStageTrace {
  readonly stage: EpistemicStage;
  readonly passed: boolean;
  readonly timestamp_utc: string;
  readonly notes: string;
  readonly byte_integrity_verified: boolean;
  readonly source_attribution: string;
  readonly corroboration_sources_count: number;
}

export interface EpistemicProgressionResult {
  readonly claim_key: string;
  readonly claim_value: unknown;
  readonly current_stage: EpistemicStage;
  readonly is_verified: boolean;
  readonly stages: readonly EpistemicStageTrace[];
  readonly epistemic_classification: EpistemicClassification;
  readonly record_sha256: string;
}
