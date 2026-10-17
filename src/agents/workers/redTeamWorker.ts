/**
 * Market HFT OS — Micro-Agent #5: RedTeamAndConflictWorker (Stage 6)
 *
 * Implements:
 * 1. Strict MCP Broker Routing & Tool Policy (RED_TEAM_TOOL_POLICY):
 *    - Worker ID: 'worker:red-team:v1'
 *    - Read-only tool 'mcp://audit-corpus/read_joined_claims'
 *    - Zero network egress (allowed_hosts: [])
 *    - 256 KB payload cap, GET only, redirect blocking
 *    - InjectionCanaryGuard quarantine (E-RTW-PROMPT-INJECTION-DETECTED)
 * 2. 7 Authoritative Red-Team Adversarial & Conflict Rules:
 *    - RT-01-BELOW-PHYSICAL-SCRAP-FLOOR: Blocks quotes priced below LME SS304 raw metal scrap floor
 *    - RT-02-UNRESOLVED-CROSS-SOURCE-CONFLICT: Strictly preserves cross-source conflicts without voting or averaging
 *    - RT-03-UNVERIFIED-HIGH-RETURN-ILLUSION: Flags RoWC > 100% resting solely on ADVERTISED_LISTING evidence
 *    - RT-04-METALLURGY-CHATTER-CONTRADICTION: Rejects SS304 claims contradicted by SS202/corrosion chatter
 *    - RT-05-ILLEGAL-MSME-CREDIT-TERM-ASSUMPTION: Flags supplier DPO > 45 days on MSME suppliers (Sec 43B(h))
 *    - RT-06-MANDATORY-COST-DATA-REQUIRED: Enforces zero-cost substitution ban (missing freight, packaging, or tax)
 *    - RT-07-EXPIRED-OR-CLOCK-SKEWED-EVIDENCE: Flags evidence TTL expiration and future clock skew
 * 3. Hard Disposition Ceiling:
 *    - Can only output HOLD_BLOCKED_BY_RED_TEAM, REQUIRES_SUPPLEMENTARY_CORROBORATION, or ELIGIBLE_FOR_HUMAN_REVIEW
 *    - Structurally forbidden from ever emitting APPROVED_FOR_EXECUTION (E-RTW-DISPOSITION-CEILING-BREACH)
 * 4. Deterministic JCS Attestation:
 *    - Bit-for-bit reproducible JSON-RPC 2.0 / MCP responses under RFC 8785 JCS
 */

import { sha256 } from '../../canonical/crypto.js';
import { canonicalizeJCS } from '../../canonical/jcs.js';
import { sanitizeForJcs } from '../m6AgentFramework.js';
import {
  McpCapabilityBroker,
  McpServerAdapter,
  McpToolDescriptor,
  McpToolCallRequest,
  McpToolCallResponse,
  CapabilityGrant,
  SupplementaryClaim,
  SupplementaryJoinResult,
  joinSupplementaryClaims
} from '../../mcp/mcpSubstrate.js';
import { InjectionCanaryGuard } from './sourceCaptureWorker.js';
import { derivePhysicalScrapFloor } from './macroLateralWorker.js';
import { evaluateMsmePaymentTermLimit } from './govtStatutoryWorker.js';
import { deepFreeze } from '../../verification/gate.js';
import {
  RedTeamToolPolicy,
  RED_TEAM_TOOL_POLICY,
  RedTeamRuleId,
  RedTeamFindingSeverity,
  RedTeamDisposition,
  RedTeamAuditFinding,
  RedTeamEvidenceEnvelope,
  RedTeamChatterDefectSignal,
  RedTeamCostBreakdown,
  RedTeamEvidenceTimestamp,
  RedTeamMcpRequest,
  RedTeamMcpResponse
} from '../../mcp/contracts/redTeamContract.js';

export {
  RedTeamToolPolicy,
  RED_TEAM_TOOL_POLICY,
  RedTeamRuleId,
  RedTeamFindingSeverity,
  RedTeamDisposition,
  RedTeamAuditFinding,
  RedTeamEvidenceEnvelope,
  RedTeamChatterDefectSignal,
  RedTeamCostBreakdown,
  RedTeamEvidenceTimestamp,
  RedTeamMcpRequest,
  RedTeamMcpResponse
};

// ============================================================================
// 1. AUTHORITATIVE RED-TEAM AUDIT EVALUATOR
// ============================================================================

export class RedTeamAuditEvaluator {
  /**
   * Rule RT-01: Below Physical Scrap Floor Check
   */
  public static evaluateScrapFloor(args: {
    claimed_supplier_exw_subunits?: bigint;
    pack_mass_grams?: number;
    lme_ss304_inr_per_kg_subunits?: bigint;
    min_stamping_conversion_bps?: bigint;
    min_viable_exw_floor_subunits?: bigint;
    raw_material_scrap_floor_subunits?: bigint;
  }): RedTeamAuditFinding | null {
    if (args.claimed_supplier_exw_subunits === undefined) {
      return null;
    }

    let minFloor = args.min_viable_exw_floor_subunits;
    let rawScrapFloor = args.raw_material_scrap_floor_subunits;

    if (
      minFloor === undefined &&
      args.pack_mass_grams !== undefined &&
      args.lme_ss304_inr_per_kg_subunits !== undefined
    ) {
      const derived = derivePhysicalScrapFloor(
        args.pack_mass_grams,
        args.lme_ss304_inr_per_kg_subunits,
        args.min_stamping_conversion_bps ?? 1500n
      );
      minFloor = derived.min_viable_exw_floor_subunits;
      rawScrapFloor = derived.raw_metal_cost_subunits;
    }

    if (minFloor !== undefined && args.claimed_supplier_exw_subunits < minFloor) {
      return {
        rule_id: 'RT-01-BELOW-PHYSICAL-SCRAP-FLOOR',
        severity: 'BLOCK_ALLOCATION_GATE',
        rule_name: 'Physical Scrap Floor and Metallurgy Integrity Defense',
        description: `Claimed supplier EXW price of ${args.claimed_supplier_exw_subunits} subunits is below minimum viable EXW manufacturing floor of ${minFloor} subunits (raw metal floor: ${rawScrapFloor ?? 'N/A'}). Metallurgy fraud, scrap mix, or fake listing detected.`,
        evidence_citations: Object.freeze(['LME-SS304-COLD-ROLLED-BENCHMARK', 'DIN-3017-PHYSICAL-MASS-SPEC']),
        metric_involved: 'supplier_exw_price_subunits',
        observed_value: args.claimed_supplier_exw_subunits.toString(),
        threshold_or_floor: minFloor.toString()
      };
    }

    return null;
  }

  /**
   * Rule RT-02: Unresolved Cross-Source Conflict Check
   */
  public static evaluateCrossSourceConflict(args: {
    joined_results?: readonly SupplementaryJoinResult[];
    joined_claims?: readonly SupplementaryClaim[];
  }): RedTeamAuditFinding | null {
    let results = args.joined_results;
    if (!results && args.joined_claims && args.joined_claims.length > 0) {
      results = joinSupplementaryClaims(args.joined_claims);
    }

    if (!results || results.length === 0) {
      return null;
    }

    const conflictResult = results.find((r) => r.status === 'CONFLICT');
    if (conflictResult) {
      const conflictSummary = conflictResult.conflicting_values
        ? conflictResult.conflicting_values
            .map((cv) => `${cv.source_id}: ${cv.value}`)
            .join(' vs ')
        : conflictResult.sources.join(', ');

      return {
        rule_id: 'RT-02-UNRESOLVED-CROSS-SOURCE-CONFLICT',
        severity: 'BLOCK_ALLOCATION_GATE',
        rule_name: 'Strict Conflict-Preserving Multi-Source Verification',
        description: `Unresolved cross-source conflict detected on metric '${conflictResult.metric_name}' for entity '${conflictResult.entity_id}' (${conflictSummary}). Averaging or voting is prohibited. Execution blocked.`,
        evidence_citations: Object.freeze([...conflictResult.sources]),
        metric_involved: conflictResult.metric_name,
        observed_value: conflictSummary,
        threshold_or_floor: 'CROSS_SOURCE_CONSENSUS_REQUIRED'
      };
    }

    return null;
  }

  /**
   * Rule RT-03: Unverified High Return Illusion Check
   */
  public static evaluateHighReturnIllusion(args: {
    projected_rowc_bps?: bigint;
    sourcing_evidence_status?: string;
  }): RedTeamAuditFinding | null {
    if (args.projected_rowc_bps === undefined) {
      return null;
    }

    const highReturnThreshold = 10000n; // 100% RoWC
    const isAdvertised =
      !args.sourcing_evidence_status ||
      args.sourcing_evidence_status === 'ADVERTISED_LISTING' ||
      args.sourcing_evidence_status === 'UNVERIFIED';

    if (args.projected_rowc_bps > highReturnThreshold && isAdvertised) {
      return {
        rule_id: 'RT-03-UNVERIFIED-HIGH-RETURN-ILLUSION',
        severity: 'WARNING_REQUIRES_CORROBORATION',
        rule_name: 'High Return Illusion on Unverified Advertised Listing',
        description: `Projected RoWC of ${args.projected_rowc_bps} bps exceeds 10,000 bps (100.00%) while relying solely on unverified ${args.sourcing_evidence_status || 'ADVERTISED_LISTING'} sourcing evidence. Supplementary supplier quote or verified invoice required.`,
        evidence_citations: Object.freeze(['M5-OPERATIONAL-CCC-ROWC-MODEL']),
        metric_involved: 'projected_rowc_bps',
        observed_value: args.projected_rowc_bps.toString(),
        threshold_or_floor: highReturnThreshold.toString()
      };
    }

    return null;
  }

  /**
   * Rule RT-04: Metallurgy & Defect Chatter Contradiction Check
   */
  public static evaluateMetallurgyChatter(args: {
    material_claimed?: string;
    chatter_defect_signals?: readonly RedTeamChatterDefectSignal[];
  }): RedTeamAuditFinding | null {
    if (!args.chatter_defect_signals || args.chatter_defect_signals.length === 0) {
      return null;
    }

    const claimedMaterial = (args.material_claimed || 'SS304').toUpperCase();

    for (const signal of args.chatter_defect_signals) {
      const flagged = (signal.material_flagged || '').toUpperCase();
      const defectRate = signal.defect_rate_bps ?? 0;

      // Check 1: Material mismatch (claimed SS304 but chatter found SS202 / counterfeit)
      if (
        claimedMaterial === 'SS304' &&
        (flagged.includes('SS202') || flagged.includes('202') || flagged.includes('CARBON_STEEL'))
      ) {
        return {
          rule_id: 'RT-04-METALLURGY-CHATTER-CONTRADICTION',
          severity: 'BLOCK_ALLOCATION_GATE',
          rule_name: 'Metallurgy Defect and Alloy Adulteration Quarantine',
          description: `Supplier advertises '${claimedMaterial}', but market chatter/transcript evidence identifies '${signal.material_flagged}' adulteration. Contradiction unresolved.`,
          evidence_citations: Object.freeze([signal.source_id || 'mcp://media-corpus/fetch_transcript']),
          metric_involved: 'material_purity',
          observed_value: signal.material_flagged,
          threshold_or_floor: claimedMaterial
        };
      }

      // Check 2: Elevated defect/rust rate exceeding 1,000 bps (10.00%)
      if (defectRate > 1000) {
        return {
          rule_id: 'RT-04-METALLURGY-CHATTER-CONTRADICTION',
          severity: 'BLOCK_ALLOCATION_GATE',
          rule_name: 'Severe Customer Defect and Corrosion Rate Alert',
          description: `Customer review and forum chatter identifies elevated defect/rust rate of ${defectRate} bps (threshold: 1,000 bps). Sourcing quarantined.`,
          evidence_citations: Object.freeze([signal.source_id || 'mcp://media-corpus/fetch_transcript']),
          metric_involved: 'observed_defect_rate_bps',
          observed_value: defectRate.toString(),
          threshold_or_floor: '1000'
        };
      }
    }

    return null;
  }

  /**
   * Rule RT-05: Illegal MSME Credit Term Assumption Check (Sec 43B(h))
   */
  public static evaluateMsmeCreditTerms(args: {
    is_msme_supplier?: boolean;
    has_written_msme_agreement?: boolean;
    supplier_dpo_days?: number;
    statutory_max_payment_terms_days?: number;
  }): RedTeamAuditFinding | null {
    if (!args.is_msme_supplier || args.supplier_dpo_days === undefined) {
      return null;
    }

    const statutoryCeiling =
      args.statutory_max_payment_terms_days ??
      Number(evaluateMsmePaymentTermLimit(true, args.has_written_msme_agreement === true));

    if (args.supplier_dpo_days > statutoryCeiling) {
      return {
        rule_id: 'RT-05-ILLEGAL-MSME-CREDIT-TERM-ASSUMPTION',
        severity: 'BLOCK_ALLOCATION_GATE',
        rule_name: 'Statutory MSME Section 43B(h) Credit Ceiling Enforcement',
        description: `Financial model assumes supplier DPO payment term of ${args.supplier_dpo_days} days, exceeding the statutory MSME Section 43B(h) ceiling of ${statutoryCeiling} days (${args.has_written_msme_agreement ? '45 days with contract' : '15 days statutory default'}). Non-deductible tax penalty and compound interest apply.`,
        evidence_citations: Object.freeze([
          'Income Tax Act 1961 Section 43B(h)',
          'MSMED Act 2006 Section 15'
        ]),
        metric_involved: 'supplier_dpo_days',
        observed_value: args.supplier_dpo_days.toString(),
        threshold_or_floor: statutoryCeiling.toString()
      };
    }

    return null;
  }

  /**
   * Rule RT-06: Mandatory Commercial Cost Data Completeness Check
   */
  public static evaluateMandatoryCostData(args: {
    cost_breakdown?: RedTeamCostBreakdown;
  }): RedTeamAuditFinding | null {
    if (!args.cost_breakdown) {
      return null;
    }

    const missingFields: string[] = [];
    const cb = args.cost_breakdown;

    const parseToBigInt = (v: string | bigint | undefined): bigint | undefined => {
      if (v === undefined) return undefined;
      return typeof v === 'bigint' ? v : BigInt(v);
    };

    const freight = parseToBigInt(cb.inbound_freight_subunits);
    if (freight === undefined || freight <= 0n) {
      missingFields.push('inbound_freight_subunits');
    }

    const packaging = parseToBigInt(cb.packaging_kitting_subunits);
    if (packaging === undefined || packaging <= 0n) {
      missingFields.push('packaging_kitting_subunits');
    }

    const gstRate = parseToBigInt(cb.gst_rate_bps);
    if (gstRate === undefined || gstRate <= 0n) {
      missingFields.push('gst_rate_bps');
    }

    if (missingFields.length > 0) {
      return {
        rule_id: 'RT-06-MANDATORY-COST-DATA-REQUIRED',
        severity: 'BLOCK_ALLOCATION_GATE',
        rule_name: 'Zero-Cost Substitution and Mandatory Cost Item Enforcement',
        description: `Mandatory commercial cost components are missing or zero (${missingFields.join(', ')}). Zero-cost substitution is strictly prohibited under Frozen Spec §2.3.`,
        evidence_citations: Object.freeze(['SPEC-SEC-2.3-ZERO-COST-SUBSTITUTION-BAN']),
        metric_involved: missingFields.join(','),
        observed_value: '0_OR_MISSING',
        threshold_or_floor: 'MANDATORY_POSITIVE_COST'
      };
    }

    return null;
  }

  /**
   * Rule RT-07: Expired Evidence TTL and Future Clock Skew Check
   */
  public static evaluateExpiredOrSkewedEvidence(args: {
    evidence_envelopes?: readonly RedTeamEvidenceTimestamp[];
    reference_time_utc?: string;
    max_clock_skew_seconds?: number;
  }): RedTeamAuditFinding | null {
    if (!args.evidence_envelopes || args.evidence_envelopes.length === 0) {
      return null;
    }

    const refTimeMs = Date.parse(args.reference_time_utc || '2026-10-18T00:00:00.000Z');
    const maxSkewMs = (args.max_clock_skew_seconds ?? 60) * 1000;

    for (const env of args.evidence_envelopes) {
      const observedMs = Date.parse(env.observed_at_utc);

      // Future clock skew check
      if (observedMs > refTimeMs + maxSkewMs) {
        return {
          rule_id: 'RT-07-EXPIRED-OR-CLOCK-SKEWED-EVIDENCE',
          severity: 'BLOCK_ALLOCATION_GATE',
          rule_name: 'Evidence Clock Skew Firewall',
          description: `Evidence envelope '${env.envelope_id || 'unidentified'}' timestamp (${env.observed_at_utc}) is ahead of reference time by more than ${args.max_clock_skew_seconds ?? 60} seconds. Clock skew rejected.`,
          evidence_citations: Object.freeze([env.envelope_id || 'clock-skew-spec']),
          metric_involved: 'observed_at_utc',
          observed_value: env.observed_at_utc,
          threshold_or_floor: new Date(refTimeMs).toISOString()
        };
      }

      // Expired TTL check
      const expiryMs = observedMs + env.ttl_seconds * 1000;
      if (refTimeMs > expiryMs) {
        return {
          rule_id: 'RT-07-EXPIRED-OR-CLOCK-SKEWED-EVIDENCE',
          severity: 'BLOCK_ALLOCATION_GATE',
          rule_name: 'Evidence Staleness and TTL Expiration Firewall',
          description: `Evidence envelope '${env.envelope_id || 'unidentified'}' expired at ${new Date(expiryMs).toISOString()} (TTL: ${env.ttl_seconds}s). Fresh observation required.`,
          evidence_citations: Object.freeze([env.envelope_id || 'ttl-expiry-spec']),
          metric_involved: 'evidence_ttl_seconds',
          observed_value: `${env.ttl_seconds}s (expired)`,
          threshold_or_floor: 'ACTIVE_TTL_REQUIRED'
        };
      }
    }

    return null;
  }
}

// ============================================================================
// 2. MCP TOOL REGISTRATION & HANDLER
// ============================================================================

export const RED_TEAM_TOOL_DESCRIPTOR: McpToolDescriptor = Object.freeze({
  name: 'mcp://audit-corpus/read_joined_claims',
  description:
    'Read-only adversarial multi-agent audit and cross-source conflict evaluation endpoint with strict disposition ceiling and zero network egress',
  inputSchema: {
    type: 'object' as const,
    properties: {
      task_id: { type: 'string' },
      candidate_id: { type: 'string' },
      sku_id: { type: 'string' },
      reference_time_utc: { type: 'string' },
      max_clock_skew_seconds: { type: 'number' },
      claimed_supplier_exw_subunits: { type: 'string' },
      pack_mass_grams: { type: 'number' },
      lme_ss304_inr_per_kg_subunits: { type: 'string' },
      min_stamping_conversion_bps: { type: 'string' },
      raw_material_scrap_floor_subunits: { type: 'string' },
      min_viable_exw_floor_subunits: { type: 'string' },
      joined_claims: { type: 'array' },
      joined_results: { type: 'array' },
      projected_rowc_bps: { type: 'string' },
      sourcing_evidence_status: { type: 'string' },
      material_claimed: { type: 'string' },
      chatter_defect_signals: { type: 'array' },
      supplier_dpo_days: { type: 'number' },
      is_msme_supplier: { type: 'boolean' },
      has_written_msme_agreement: { type: 'boolean' },
      statutory_max_payment_terms_days: { type: 'number' },
      cost_breakdown: { type: 'object' },
      evidence_envelopes: { type: 'array' },
      attempted_disposition_override: { type: 'string' },
      raw_audit_payload: { type: 'string' }
    },
    required: ['candidate_id', 'sku_id']
  }
});

export function registerRedTeamTool(server: McpServerAdapter): void {
  server.registerTool({
    descriptor: RED_TEAM_TOOL_DESCRIPTOR,
    handler: async (args: Record<string, unknown>): Promise<McpToolCallResponse['result']> => {
      const taskId = String(args.task_id || `task:rtw:${Date.now()}`);
      const referenceTimeUtc = String(args.reference_time_utc || '2026-10-18T00:00:00.000Z');
      const candidateId = String(args.candidate_id);

      // 1. Prompt-Injection Quarantine Defense
      if (args.raw_audit_payload) {
        const payloadStr = String(args.raw_audit_payload);
        const canary = InjectionCanaryGuard.scan(payloadStr);
        if (canary.quarantined) {
          const quarantinedResponse: RedTeamMcpResponse = {
            request_id: taskId,
            candidate_id: candidateId,
            audited_at_utc: referenceTimeUtc,
            disposition: 'HOLD_BLOCKED_BY_RED_TEAM',
            passed_cleanly: false,
            findings: Object.freeze([
              {
                rule_id: 'RT-02-UNRESOLVED-CROSS-SOURCE-CONFLICT',
                severity: 'BLOCK_ALLOCATION_GATE',
                rule_name: 'Adversarial Prompt Injection Quarantine',
                description: 'Potential prompt-injection or delimiter attack detected in audit payload. Quarantined.',
                evidence_citations: Object.freeze(['SECURITY-INJECTION-CANARY-GUARD'])
              }
            ]),
            evidence_envelope: Object.freeze({
              evidence_kind: 'AUDIT_RECORD',
              verification_status: 'UNVERIFIED',
              commercial_status: 'NOT_APPLICABLE',
              provenance_lineage: Object.freeze({
                source_id: 'mcp://audit-corpus/read_joined_claims',
                observed_at_utc: referenceTimeUtc,
                ttl_seconds: 604800,
                auditor_version: 'rtw-conflict-sieve-v1.0.0'
              })
            }),
            error_code: 'E-RTW-PROMPT-INJECTION-DETECTED',
            error_reason: 'Adversarial prompt injection detected in audit input.'
          };

          const serialized = canonicalizeJCS(sanitizeForJcs(quarantinedResponse));
          return {
            content: [{ type: 'text', text: serialized }],
            tokens_used: Math.ceil(serialized.length / 4)
          };
        }
      }

      // 2. Disposition Ceiling Defense: Structurally forbid 'APPROVED_FOR_EXECUTION'
      if (
        args.attempted_disposition_override &&
        args.attempted_disposition_override === 'APPROVED_FOR_EXECUTION'
      ) {
        throw new Error(
          'E-RTW-DISPOSITION-CEILING-BREACH: RedTeam worker is structurally prohibited from approving real capital execution.'
        );
      }

      // 3. Parse BigInt values safely
      const parseBigInt = (v: any): bigint | undefined => {
        if (v === undefined || v === null || v === '') return undefined;
        return typeof v === 'bigint' ? v : BigInt(v);
      };

      const claimedExw = parseBigInt(args.claimed_supplier_exw_subunits);
      const lmeSs304InrPerKg = parseBigInt(args.lme_ss304_inr_per_kg_subunits);
      const minStampingBps = parseBigInt(args.min_stamping_conversion_bps);
      const rawScrapFloor = parseBigInt(args.raw_material_scrap_floor_subunits);
      const minExwFloor = parseBigInt(args.min_viable_exw_floor_subunits);
      const projectedRowcBps = parseBigInt(args.projected_rowc_bps);

      const packMassGrams = typeof args.pack_mass_grams === 'number' ? args.pack_mass_grams : undefined;
      const joinedResults = args.joined_results as readonly SupplementaryJoinResult[] | undefined;
      const joinedClaims = args.joined_claims as readonly SupplementaryClaim[] | undefined;
      const sourcingEvidenceStatus = args.sourcing_evidence_status as string | undefined;
      const materialClaimed = args.material_claimed as string | undefined;
      const chatterDefectSignals = args.chatter_defect_signals as readonly RedTeamChatterDefectSignal[] | undefined;
      const isMsmeSupplier = typeof args.is_msme_supplier === 'boolean' ? args.is_msme_supplier : undefined;
      const hasWrittenMsmeAgreement = typeof args.has_written_msme_agreement === 'boolean' ? args.has_written_msme_agreement : undefined;
      const supplierDpoDays = typeof args.supplier_dpo_days === 'number' ? args.supplier_dpo_days : undefined;
      const statutoryMaxPaymentTermsDays = typeof args.statutory_max_payment_terms_days === 'number' ? args.statutory_max_payment_terms_days : undefined;
      const costBreakdown = args.cost_breakdown as RedTeamCostBreakdown | undefined;
      const evidenceEnvelopes = args.evidence_envelopes as readonly RedTeamEvidenceTimestamp[] | undefined;
      const maxClockSkewSeconds = typeof args.max_clock_skew_seconds === 'number' ? args.max_clock_skew_seconds : undefined;

      // 4. Evaluate the 7 Red-Team Rules
      const findings: RedTeamAuditFinding[] = [];

      // Rule RT-01: Scrap Floor
      const f1 = RedTeamAuditEvaluator.evaluateScrapFloor({
        claimed_supplier_exw_subunits: claimedExw,
        pack_mass_grams: packMassGrams,
        lme_ss304_inr_per_kg_subunits: lmeSs304InrPerKg,
        min_stamping_conversion_bps: minStampingBps,
        min_viable_exw_floor_subunits: minExwFloor,
        raw_material_scrap_floor_subunits: rawScrapFloor
      });
      if (f1) findings.push(f1);

      // Rule RT-02: Cross-Source Conflict
      const f2 = RedTeamAuditEvaluator.evaluateCrossSourceConflict({
        joined_results: joinedResults,
        joined_claims: joinedClaims
      });
      if (f2) findings.push(f2);

      // Rule RT-03: High Return Illusion
      const f3 = RedTeamAuditEvaluator.evaluateHighReturnIllusion({
        projected_rowc_bps: projectedRowcBps,
        sourcing_evidence_status: sourcingEvidenceStatus
      });
      if (f3) findings.push(f3);

      // Rule RT-04: Metallurgy Chatter Contradiction
      const f4 = RedTeamAuditEvaluator.evaluateMetallurgyChatter({
        material_claimed: materialClaimed,
        chatter_defect_signals: chatterDefectSignals
      });
      if (f4) findings.push(f4);

      // Rule RT-05: Illegal MSME Credit Terms (Sec 43B(h))
      const f5 = RedTeamAuditEvaluator.evaluateMsmeCreditTerms({
        is_msme_supplier: isMsmeSupplier,
        has_written_msme_agreement: hasWrittenMsmeAgreement,
        supplier_dpo_days: supplierDpoDays,
        statutory_max_payment_terms_days: statutoryMaxPaymentTermsDays
      });
      if (f5) findings.push(f5);

      // Rule RT-06: Mandatory Commercial Cost Completeness
      const f6 = RedTeamAuditEvaluator.evaluateMandatoryCostData({
        cost_breakdown: costBreakdown
      });
      if (f6) findings.push(f6);

      // Rule RT-07: Expired Evidence and Clock Skew
      const f7 = RedTeamAuditEvaluator.evaluateExpiredOrSkewedEvidence({
        evidence_envelopes: evidenceEnvelopes,
        reference_time_utc: referenceTimeUtc,
        max_clock_skew_seconds: maxClockSkewSeconds
      });
      if (f7) findings.push(f7);

      // 5. Determine Hard Disposition
      let disposition: RedTeamDisposition = 'ELIGIBLE_FOR_HUMAN_REVIEW';
      const hasBlock = findings.some((f) => f.severity === 'BLOCK_ALLOCATION_GATE');
      const hasWarning = findings.some((f) => f.severity === 'WARNING_REQUIRES_CORROBORATION');

      if (hasBlock) {
        disposition = 'HOLD_BLOCKED_BY_RED_TEAM';
      } else if (hasWarning) {
        disposition = 'REQUIRES_SUPPLEMENTARY_CORROBORATION';
      }

      // 6. Build Joined Claims Summary
      let joinedSummary = joinedResults;
      if (!joinedSummary && joinedClaims && joinedClaims.length > 0) {
        joinedSummary = joinSupplementaryClaims(joinedClaims);
      }

      const response: RedTeamMcpResponse = {
        request_id: taskId,
        candidate_id: candidateId,
        audited_at_utc: referenceTimeUtc,
        disposition,
        passed_cleanly: findings.length === 0,
        findings: Object.freeze(findings),
        ...(joinedSummary ? { joined_claims_summary: joinedSummary } : {}),
        evidence_envelope: Object.freeze({
          evidence_kind: 'AUDIT_RECORD',
          verification_status: 'UNVERIFIED',
          commercial_status: 'NOT_APPLICABLE',
          provenance_lineage: Object.freeze({
            source_id: 'mcp://audit-corpus/read_joined_claims',
            observed_at_utc: referenceTimeUtc,
            ttl_seconds: 604800,
            auditor_version: 'rtw-conflict-sieve-v1.0.0'
          })
        })
      };

      const serialized = canonicalizeJCS(sanitizeForJcs(response));
      return {
        content: [{ type: 'text', text: serialized }],
        tokens_used: Math.ceil(serialized.length / 4)
      };
    }
  });
}

// ============================================================================
// 3. RED TEAM AND CONFLICT WORKER CLASS
// ============================================================================

export class RedTeamAndConflictWorker {
  public static readonly WORKER_ID = 'worker:red-team:v1';
  private readonly broker: McpCapabilityBroker;
  private readonly defaultGrant?: CapabilityGrant;

  constructor(broker: McpCapabilityBroker, defaultGrant?: CapabilityGrant) {
    this.broker = broker;
    this.defaultGrant = defaultGrant;
  }

  public getBroker(): McpCapabilityBroker {
    return this.broker;
  }

  public async auditCandidate(
    request: RedTeamMcpRequest,
    customGrant?: CapabilityGrant
  ): Promise<RedTeamMcpResponse> {
    const grant = customGrant ?? this.defaultGrant;
    if (!grant) {
      throw new Error('E-RTW-NO-GRANT: No CapabilityGrant provided for RedTeamAndConflictWorker execution.');
    }

    if (request.attempted_disposition_override === 'APPROVED_FOR_EXECUTION') {
      throw new Error(
        'E-RTW-DISPOSITION-CEILING-BREACH: RedTeam worker is structurally prohibited from approving real capital execution.'
      );
    }

    const toolCallRequest: McpToolCallRequest = {
      jsonrpc: '2.0',
      id: request.task_id,
      method: 'tools/call',
      params: {
        name: 'mcp://audit-corpus/read_joined_claims',
        arguments: {
          task_id: request.task_id,
          candidate_id: request.candidate_id,
          sku_id: request.sku_id,
          reference_time_utc: request.reference_time_utc,
          max_clock_skew_seconds: request.max_clock_skew_seconds,
          claimed_supplier_exw_subunits:
            typeof request.claimed_supplier_exw_subunits === 'bigint'
              ? request.claimed_supplier_exw_subunits.toString()
              : request.claimed_supplier_exw_subunits,
          pack_mass_grams: request.pack_mass_grams,
          lme_ss304_inr_per_kg_subunits:
            typeof request.lme_ss304_inr_per_kg_subunits === 'bigint'
              ? request.lme_ss304_inr_per_kg_subunits.toString()
              : request.lme_ss304_inr_per_kg_subunits,
          min_stamping_conversion_bps:
            typeof request.min_stamping_conversion_bps === 'bigint'
              ? request.min_stamping_conversion_bps.toString()
              : request.min_stamping_conversion_bps,
          raw_material_scrap_floor_subunits:
            typeof request.raw_material_scrap_floor_subunits === 'bigint'
              ? request.raw_material_scrap_floor_subunits.toString()
              : request.raw_material_scrap_floor_subunits,
          min_viable_exw_floor_subunits:
            typeof request.min_viable_exw_floor_subunits === 'bigint'
              ? request.min_viable_exw_floor_subunits.toString()
              : request.min_viable_exw_floor_subunits,
          joined_claims: request.joined_claims,
          joined_results: request.joined_results,
          projected_rowc_bps:
            typeof request.projected_rowc_bps === 'bigint'
              ? request.projected_rowc_bps.toString()
              : request.projected_rowc_bps,
          sourcing_evidence_status: request.sourcing_evidence_status,
          material_claimed: request.material_claimed,
          chatter_defect_signals: request.chatter_defect_signals,
          supplier_dpo_days: request.supplier_dpo_days,
          is_msme_supplier: request.is_msme_supplier,
          has_written_msme_agreement: request.has_written_msme_agreement,
          statutory_max_payment_terms_days: request.statutory_max_payment_terms_days,
          cost_breakdown: request.cost_breakdown
            ? {
                raw_material_purchase_subunits:
                  typeof request.cost_breakdown.raw_material_purchase_subunits === 'bigint'
                    ? request.cost_breakdown.raw_material_purchase_subunits.toString()
                    : request.cost_breakdown.raw_material_purchase_subunits,
                inbound_freight_subunits:
                  typeof request.cost_breakdown.inbound_freight_subunits === 'bigint'
                    ? request.cost_breakdown.inbound_freight_subunits.toString()
                    : request.cost_breakdown.inbound_freight_subunits,
                packaging_kitting_subunits:
                  typeof request.cost_breakdown.packaging_kitting_subunits === 'bigint'
                    ? request.cost_breakdown.packaging_kitting_subunits.toString()
                    : request.cost_breakdown.packaging_kitting_subunits,
                customs_inspection_subunits:
                  typeof request.cost_breakdown.customs_inspection_subunits === 'bigint'
                    ? request.cost_breakdown.customs_inspection_subunits.toString()
                    : request.cost_breakdown.customs_inspection_subunits,
                marketplace_closing_subunits:
                  typeof request.cost_breakdown.marketplace_closing_subunits === 'bigint'
                    ? request.cost_breakdown.marketplace_closing_subunits.toString()
                    : request.cost_breakdown.marketplace_closing_subunits,
                marketplace_weight_handling_subunits:
                  typeof request.cost_breakdown.marketplace_weight_handling_subunits === 'bigint'
                    ? request.cost_breakdown.marketplace_weight_handling_subunits.toString()
                    : request.cost_breakdown.marketplace_weight_handling_subunits,
                gst_rate_bps:
                  typeof request.cost_breakdown.gst_rate_bps === 'bigint'
                    ? request.cost_breakdown.gst_rate_bps.toString()
                    : request.cost_breakdown.gst_rate_bps
              }
            : undefined,
          evidence_envelopes: request.evidence_envelopes,
          attempted_disposition_override: request.attempted_disposition_override
        }
      }
    };

    const toolCallResponse = await this.broker.invokeTool(grant, toolCallRequest);

    if (toolCallResponse.error) {
      throw new Error(toolCallResponse.error.message);
    }

    const contentItem = toolCallResponse.result?.content?.[0];
    if (!contentItem || !contentItem.text) {
      throw new Error('E-RTW-EMPTY-RESPONSE: Tool call returned empty result content.');
    }

    const parsed: RedTeamMcpResponse = JSON.parse(contentItem.text);
    return deepFreeze(parsed);
  }
}
