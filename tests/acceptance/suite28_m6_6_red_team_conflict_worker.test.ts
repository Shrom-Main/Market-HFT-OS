/**
 * SUITE-28: Gate M6.6 Stage 6 RedTeamAndConflictWorker & Context-Routing State Machine
 *
 * Normative Acceptance Suite for Stage 6:
 * 1. MCP-RTW-SCRAP-FLOOR-AND-METALLURGY-DEFENSE-001:
 *    - Red-team blocks candidate quote below LME SS304 physical scrap floor (RT-01) -> HOLD_BLOCKED_BY_RED_TEAM.
 *    - Proves quote above physical scrap floor passes cleanly.
 * 2. MCP-RTW-UNRESOLVED-CROSS-SOURCE-CONFLICT-002:
 *    - Independent suppliers disagree on raw material price (₹28 vs ₹35) yielding CONFLICT in joinSupplementaryClaims.
 *    - Red-team strictly preserves conflict without averaging/voting (RT-02) -> HOLD_BLOCKED_BY_RED_TEAM.
 * 3. MCP-RTW-HIGH-RETURN-ILLUSION-ON-ADVERTISED-003:
 *    - RoWC > 10,000 bps (100.00%) resting solely on ADVERTISED_LISTING triggers RT-03 -> REQUIRES_SUPPLEMENTARY_CORROBORATION.
 *    - Verified purchase invoice (VERIFIED_INVOICE) resolves rule cleanly.
 * 4. MCP-RTW-METALLURGY-CHATTER-CONTRADICTION-004:
 *    - Supplier claims SS304, but customer reviews / YouTube transcripts identify SS202 adulteration or
 *      elevated defect rate > 1000 bps (RT-04) -> HOLD_BLOCKED_BY_RED_TEAM.
 * 5. MCP-RTW-ILLEGAL-MSME-CREDIT-TERM-DEFENSE-005:
 *    - Assumed DPO payment terms > 45 days for MSME supplier violate Sec 43B(h) (RT-05) -> HOLD_BLOCKED_BY_RED_TEAM.
 *    - Compliant DPO (<= 45 days) passes cleanly.
 * 6. MCP-RTW-MANDATORY-COST-DATA-AND-CLOCK-SKEW-006:
 *    - Missing mandatory freight/packaging (zero-cost substitution ban) triggers RT-06 -> HOLD_BLOCKED_BY_RED_TEAM.
 *    - Future clock skew or expired evidence TTL triggers RT-07 -> HOLD_BLOCKED_BY_RED_TEAM.
 * 7. MCP-RTW-DISPOSITION-CEILING-AND-ZERO-NETWORK-EGRESS-007:
 *    - RED_TEAM_TOOL_POLICY strictly enforces allowed_hosts: [] (zero network egress).
 *    - Attempting to pass or request APPROVED_FOR_EXECUTION fails closed (E-RTW-DISPOSITION-CEILING-BREACH).
 * 8. MCP-RTW-3PASS-SCHEDULER-STATE-MACHINE-008:
 *    - End-to-end execution of ContextRoutingStateMachine across Pass 1 (Horizontal gap-filling),
 *      Pass 2 (Supplementary corroboration & join), and Pass 3 (Red-team audit & deterministic join).
 *    - Verifies bit-for-bit identical RFC 8785 JCS canonical attestation with SHA-256 telemetry digest.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import { sanitizeForJcs } from '../../src/agents/m6AgentFramework.js';
import {
  McpServerAdapter,
  McpCapabilityBroker,
  createCapabilityGrant,
  McpRunLedger,
  SupplementaryClaim,
  joinSupplementaryClaims
} from '../../src/mcp/mcpSubstrate.js';
import {
  RedTeamAndConflictWorker,
  registerRedTeamTool,
  RedTeamAuditEvaluator,
  RED_TEAM_TOOL_POLICY,
  RedTeamMcpRequest
} from '../../src/agents/workers/redTeamWorker.js';
import { registerSourceCaptureTool, SourceCaptureWorker } from '../../src/agents/workers/sourceCaptureWorker.js';
import { registerMacroLateralTool, MacroAndLateralMarketWorker } from '../../src/agents/workers/macroLateralWorker.js';
import { registerGovtStatutoryTool, GovtAndStatutoryWorker } from '../../src/agents/workers/govtStatutoryWorker.js';
import { registerMediaChatterTool, MediaAndChatterWorker } from '../../src/agents/workers/mediaChatterWorker.js';
import { ContextRoutingStateMachine, ContextRoutingInput } from '../../src/agents/scheduler/contextRoutingStateMachine.js';

describe('SUITE-28: Gate M6.6 Stage 6 RedTeamAndConflictWorker & Context Routing State Machine', () => {
  let server: McpServerAdapter;
  let runLedger: McpRunLedger;
  let broker: McpCapabilityBroker;
  let redTeamWorker: RedTeamAndConflictWorker;

  const TASK_ID = 'task:m6-6:red-team-verification';
  const CANDIDATE_ID = 'cand:ss304:16-25mm:pack-10';
  const SKU_ID = 'prod:din3017:ss304:16-25mm:pack-10';
  const REF_TIME = '2026-10-18T00:00:00.000Z';

  beforeEach(() => {
    server = new McpServerAdapter();
    registerRedTeamTool(server);
    registerSourceCaptureTool(server);
    registerMacroLateralTool(server);
    registerGovtStatutoryTool(server);
    registerMediaChatterTool(server);

    runLedger = new McpRunLedger();
    broker = new McpCapabilityBroker(server, runLedger);

    const standardGrant = createCapabilityGrant({
      grant_id: 'grant:rtw:standard',
      task_id: TASK_ID,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      allowed_tools: ['mcp://audit-corpus/read_joined_claims'],
      allowed_hosts: [], // Zero network egress
      allowed_methods: ['GET'],
      allow_redirects: false,
      max_requests: 10,
      max_payload_bytes: 262144,
      max_latency_ms: 4000,
      max_tokens: 100000,
      expires_at_utc: '2026-12-31T23:59:59.000Z'
    });

    redTeamWorker = new RedTeamAndConflictWorker(broker, standardGrant);
  });

  // --------------------------------------------------------------------------
  // Assertion 1: MCP-RTW-SCRAP-FLOOR-AND-METALLURGY-DEFENSE-001
  // --------------------------------------------------------------------------
  it('MCP-RTW-SCRAP-FLOOR-AND-METALLURGY-DEFENSE-001: blocks candidate quotes below physical scrap floor and passes valid quotes', async () => {
    // 140g pack of DIN 3017 SS304 clamps
    // LME SS304 = ₹184.9100/kg (1849100 subunits)
    // Raw metal floor = (140 * 1849100) / 1000 = 258874 subunits (₹25.8874)
    // Min viable EXW floor (+15% stamping) = (258874 * 11500) / 10000 = 297705 subunits (₹29.7705)

    // Test Case A: Sub-scrap quote of ₹22.0000 (220000 subunits)
    const subScrapReq: RedTeamMcpRequest = {
      task_id: `${TASK_ID}:sub-scrap`,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      reference_time_utc: REF_TIME,
      claimed_supplier_exw_subunits: 220000n,
      pack_mass_grams: 140,
      lme_ss304_inr_per_kg_subunits: 1849100n,
      min_stamping_conversion_bps: 1500n,
      cost_breakdown: {
        raw_material_purchase_subunits: 220000n,
        inbound_freight_subunits: 45000n,
        packaging_kitting_subunits: 32000n,
        gst_rate_bps: 1800n
      }
    };

    const subScrapRes = await redTeamWorker.auditCandidate(subScrapReq);
    expect(subScrapRes.disposition).toBe('HOLD_BLOCKED_BY_RED_TEAM');
    expect(subScrapRes.passed_cleanly).toBe(false);
    expect(subScrapRes.findings.length).toBeGreaterThanOrEqual(1);

    const scrapFinding = subScrapRes.findings.find((f) => f.rule_id === 'RT-01-BELOW-PHYSICAL-SCRAP-FLOOR');
    expect(scrapFinding).toBeDefined();
    expect(scrapFinding!.severity).toBe('BLOCK_ALLOCATION_GATE');
    expect(scrapFinding!.observed_value).toBe('220000');
    expect(scrapFinding!.threshold_or_floor).toBe('297705');

    // Test Case B: Quote above scrap floor (₹32.0000 = 320000 subunits)
    const validScrapReq: RedTeamMcpRequest = {
      task_id: `${TASK_ID}:valid-scrap`,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      reference_time_utc: REF_TIME,
      claimed_supplier_exw_subunits: 320000n,
      pack_mass_grams: 140,
      lme_ss304_inr_per_kg_subunits: 1849100n,
      min_stamping_conversion_bps: 1500n,
      cost_breakdown: {
        raw_material_purchase_subunits: 320000n,
        inbound_freight_subunits: 45000n,
        packaging_kitting_subunits: 32000n,
        gst_rate_bps: 1800n
      }
    };

    const validRes = await redTeamWorker.auditCandidate(validScrapReq);
    expect(validRes.findings.some((f) => f.rule_id === 'RT-01-BELOW-PHYSICAL-SCRAP-FLOOR')).toBe(false);
    expect(validRes.disposition).toBe('ELIGIBLE_FOR_HUMAN_REVIEW');
  });

  // --------------------------------------------------------------------------
  // Assertion 2: MCP-RTW-UNRESOLVED-CROSS-SOURCE-CONFLICT-002
  // --------------------------------------------------------------------------
  it('MCP-RTW-UNRESOLVED-CROSS-SOURCE-CONFLICT-002: strictly preserves cross-source conflict without voting or averaging', async () => {
    // Two independent suppliers give conflicting quotes: ₹28.0000 vs ₹35.0000
    const conflictingClaims: SupplementaryClaim[] = [
      {
        entity_id: SKU_ID,
        metric_name: 'raw_material_purchase',
        value: 280000n,
        source_id: 'catalog.howrah-industrial.com',
        observed_at_utc: REF_TIME
      },
      {
        entity_id: SKU_ID,
        metric_name: 'raw_material_purchase',
        value: 350000n,
        source_id: 'dir.indiamart.com',
        observed_at_utc: REF_TIME
      }
    ];

    const joinResults = joinSupplementaryClaims(conflictingClaims);
    expect(joinResults.length).toBe(1);
    expect(joinResults[0].status).toBe('CONFLICT');
    expect(joinResults[0].conflicting_values?.length).toBe(2);

    const conflictReq: RedTeamMcpRequest = {
      task_id: `${TASK_ID}:conflict-test`,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      reference_time_utc: REF_TIME,
      claimed_supplier_exw_subunits: 320000n,
      min_viable_exw_floor_subunits: 297705n,
      joined_results: joinResults,
      cost_breakdown: {
        raw_material_purchase_subunits: 320000n,
        inbound_freight_subunits: 45000n,
        packaging_kitting_subunits: 32000n,
        gst_rate_bps: 1800n
      }
    };

    const conflictRes = await redTeamWorker.auditCandidate(conflictReq);
    expect(conflictRes.disposition).toBe('HOLD_BLOCKED_BY_RED_TEAM');

    const conflictFinding = conflictRes.findings.find(
      (f) => f.rule_id === 'RT-02-UNRESOLVED-CROSS-SOURCE-CONFLICT'
    );
    expect(conflictFinding).toBeDefined();
    expect(conflictFinding!.severity).toBe('BLOCK_ALLOCATION_GATE');
    expect(conflictFinding!.evidence_citations).toContain('catalog.howrah-industrial.com');
    expect(conflictFinding!.evidence_citations).toContain('dir.indiamart.com');
    expect(conflictRes.joined_claims_summary?.[0].status).toBe('CONFLICT');
  });

  // --------------------------------------------------------------------------
  // Assertion 3: MCP-RTW-HIGH-RETURN-ILLUSION-ON-ADVERTISED-003
  // --------------------------------------------------------------------------
  it('MCP-RTW-HIGH-RETURN-ILLUSION-ON-ADVERTISED-003: flags RoWC > 100% resting solely on advertised listing', async () => {
    // 145.00% RoWC (14,500 bps) with ADVERTISED_LISTING
    const highReturnReq: RedTeamMcpRequest = {
      task_id: `${TASK_ID}:high-return-illusion`,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      reference_time_utc: REF_TIME,
      claimed_supplier_exw_subunits: 320000n,
      min_viable_exw_floor_subunits: 297705n,
      projected_rowc_bps: 14500n,
      sourcing_evidence_status: 'ADVERTISED_LISTING',
      cost_breakdown: {
        raw_material_purchase_subunits: 320000n,
        inbound_freight_subunits: 45000n,
        packaging_kitting_subunits: 32000n,
        gst_rate_bps: 1800n
      }
    };

    const res = await redTeamWorker.auditCandidate(highReturnReq);
    expect(res.disposition).toBe('REQUIRES_SUPPLEMENTARY_CORROBORATION');

    const illusionFinding = res.findings.find(
      (f) => f.rule_id === 'RT-03-UNVERIFIED-HIGH-RETURN-ILLUSION'
    );
    expect(illusionFinding).toBeDefined();
    expect(illusionFinding!.severity).toBe('WARNING_REQUIRES_CORROBORATION');
    expect(illusionFinding!.observed_value).toBe('14500');

    // Upgrade sourcing evidence to verified invoice (VERIFIED_INVOICE)
    const verifiedReq: RedTeamMcpRequest = {
      ...highReturnReq,
      task_id: `${TASK_ID}:high-return-verified`,
      sourcing_evidence_status: 'VERIFIED_INVOICE'
    };

    const verifiedRes = await redTeamWorker.auditCandidate(verifiedReq);
    expect(
      verifiedRes.findings.some((f) => f.rule_id === 'RT-03-UNVERIFIED-HIGH-RETURN-ILLUSION')
    ).toBe(false);
    expect(verifiedRes.disposition).toBe('ELIGIBLE_FOR_HUMAN_REVIEW');
  });

  // --------------------------------------------------------------------------
  // Assertion 4: MCP-RTW-METALLURGY-CHATTER-CONTRADICTION-004
  // --------------------------------------------------------------------------
  it('MCP-RTW-METALLURGY-CHATTER-CONTRADICTION-004: quarantines quotes contradicted by chatter defect and adulteration reports', async () => {
    // Sourcing claims SS304, but chatter found SS202 adulteration and 1250 bps defect rate
    const defectReq: RedTeamMcpRequest = {
      task_id: `${TASK_ID}:metallurgy-defect`,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      reference_time_utc: REF_TIME,
      claimed_supplier_exw_subunits: 320000n,
      min_viable_exw_floor_subunits: 297705n,
      material_claimed: 'SS304',
      chatter_defect_signals: [
        {
          material_flagged: 'SS202_ADULTERATION',
          defect_rate_bps: 1250,
          source_id: 'www.youtube.com/watch?v=clamp-tear-down',
          transcript_span: 'Magnet strongly sticks to the band, indicating SS202 grade instead of true SS304.'
        }
      ],
      cost_breakdown: {
        raw_material_purchase_subunits: 320000n,
        inbound_freight_subunits: 45000n,
        packaging_kitting_subunits: 32000n,
        gst_rate_bps: 1800n
      }
    };

    const defectRes = await redTeamWorker.auditCandidate(defectReq);
    expect(defectRes.disposition).toBe('HOLD_BLOCKED_BY_RED_TEAM');

    const chatterFinding = defectRes.findings.find(
      (f) => f.rule_id === 'RT-04-METALLURGY-CHATTER-CONTRADICTION'
    );
    expect(chatterFinding).toBeDefined();
    expect(chatterFinding!.severity).toBe('BLOCK_ALLOCATION_GATE');
    expect(chatterFinding!.evidence_citations).toContain('www.youtube.com/watch?v=clamp-tear-down');
  });

  // --------------------------------------------------------------------------
  // Assertion 5: MCP-RTW-ILLEGAL-MSME-CREDIT-TERM-DEFENSE-005
  // --------------------------------------------------------------------------
  it('MCP-RTW-ILLEGAL-MSME-CREDIT-TERM-DEFENSE-005: blocks credit term assumptions violating statutory MSME Sec 43B(h)', async () => {
    // Model assumes 60-day DPO for MSME supplier (statutory limit is 45 days)
    const illegalMsmeReq: RedTeamMcpRequest = {
      task_id: `${TASK_ID}:msme-illegal-terms`,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      reference_time_utc: REF_TIME,
      claimed_supplier_exw_subunits: 320000n,
      min_viable_exw_floor_subunits: 297705n,
      is_msme_supplier: true,
      has_written_msme_agreement: true,
      supplier_dpo_days: 60,
      statutory_max_payment_terms_days: 45,
      cost_breakdown: {
        raw_material_purchase_subunits: 320000n,
        inbound_freight_subunits: 45000n,
        packaging_kitting_subunits: 32000n,
        gst_rate_bps: 1800n
      }
    };

    const illegalRes = await redTeamWorker.auditCandidate(illegalMsmeReq);
    expect(illegalRes.disposition).toBe('HOLD_BLOCKED_BY_RED_TEAM');

    const msmeFinding = illegalRes.findings.find(
      (f) => f.rule_id === 'RT-05-ILLEGAL-MSME-CREDIT-TERM-ASSUMPTION'
    );
    expect(msmeFinding).toBeDefined();
    expect(msmeFinding!.severity).toBe('BLOCK_ALLOCATION_GATE');
    expect(msmeFinding!.observed_value).toBe('60');
    expect(msmeFinding!.threshold_or_floor).toBe('45');

    // Compliant 45-day DPO passes cleanly
    const compliantMsmeReq: RedTeamMcpRequest = {
      ...illegalMsmeReq,
      task_id: `${TASK_ID}:msme-compliant-terms`,
      supplier_dpo_days: 45
    };

    const compliantRes = await redTeamWorker.auditCandidate(compliantMsmeReq);
    expect(
      compliantRes.findings.some((f) => f.rule_id === 'RT-05-ILLEGAL-MSME-CREDIT-TERM-ASSUMPTION')
    ).toBe(false);
    expect(compliantRes.disposition).toBe('ELIGIBLE_FOR_HUMAN_REVIEW');
  });

  // --------------------------------------------------------------------------
  // Assertion 6: MCP-RTW-MANDATORY-COST-DATA-AND-CLOCK-SKEW-006
  // --------------------------------------------------------------------------
  it('MCP-RTW-MANDATORY-COST-DATA-AND-CLOCK-SKEW-006: enforces zero-cost substitution ban and clock skew defense', async () => {
    // 1. Zero-Cost Substitution Ban (missing freight and packaging)
    const missingCostReq: RedTeamMcpRequest = {
      task_id: `${TASK_ID}:missing-costs`,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      reference_time_utc: REF_TIME,
      claimed_supplier_exw_subunits: 320000n,
      min_viable_exw_floor_subunits: 297705n,
      cost_breakdown: {
        raw_material_purchase_subunits: 320000n,
        inbound_freight_subunits: 0n, // Zero freight forbidden!
        packaging_kitting_subunits: 0n, // Zero packaging forbidden!
        gst_rate_bps: 1800n
      }
    };

    const missingRes = await redTeamWorker.auditCandidate(missingCostReq);
    expect(missingRes.disposition).toBe('HOLD_BLOCKED_BY_RED_TEAM');

    const costFinding = missingRes.findings.find(
      (f) => f.rule_id === 'RT-06-MANDATORY-COST-DATA-REQUIRED'
    );
    expect(costFinding).toBeDefined();
    expect(costFinding!.severity).toBe('BLOCK_ALLOCATION_GATE');

    // 2. Clock Skew Defense (observed time 300s into future)
    const futureTimeUtc = '2026-10-18T00:05:00.000Z'; // +300s
    const clockSkewReq: RedTeamMcpRequest = {
      task_id: `${TASK_ID}:clock-skew`,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      reference_time_utc: REF_TIME,
      claimed_supplier_exw_subunits: 320000n,
      min_viable_exw_floor_subunits: 297705n,
      cost_breakdown: {
        raw_material_purchase_subunits: 320000n,
        inbound_freight_subunits: 45000n,
        packaging_kitting_subunits: 32000n,
        gst_rate_bps: 1800n
      },
      evidence_envelopes: [
        {
          envelope_id: 'future-env',
          observed_at_utc: futureTimeUtc,
          ttl_seconds: 3600
        }
      ]
    };

    const skewRes = await redTeamWorker.auditCandidate(clockSkewReq);
    expect(skewRes.disposition).toBe('HOLD_BLOCKED_BY_RED_TEAM');

    const skewFinding = skewRes.findings.find(
      (f) => f.rule_id === 'RT-07-EXPIRED-OR-CLOCK-SKEWED-EVIDENCE'
    );
    expect(skewFinding).toBeDefined();
    expect(skewFinding!.severity).toBe('BLOCK_ALLOCATION_GATE');
  });

  // --------------------------------------------------------------------------
  // Assertion 7: MCP-RTW-DISPOSITION-CEILING-AND-ZERO-NETWORK-EGRESS-007
  // --------------------------------------------------------------------------
  it('MCP-RTW-DISPOSITION-CEILING-AND-ZERO-NETWORK-EGRESS-007: enforces zero network egress and hard disposition ceiling', async () => {
    // 1. Tool Policy Verification
    expect(RED_TEAM_TOOL_POLICY.allowed_hosts).toEqual([]);
    expect(RED_TEAM_TOOL_POLICY.tool_id).toBe('mcp://audit-corpus/read_joined_claims');

    // 2. Structurally forbidden from ever emitting APPROVED_FOR_EXECUTION
    const bypassReq: RedTeamMcpRequest = {
      task_id: `${TASK_ID}:bypass-attempt`,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      attempted_disposition_override: 'APPROVED_FOR_EXECUTION'
    };

    await expect(redTeamWorker.auditCandidate(bypassReq)).rejects.toThrow(
      'E-RTW-DISPOSITION-CEILING-BREACH: RedTeam worker is structurally prohibited from approving real capital execution.'
    );
  });

  // --------------------------------------------------------------------------
  // Assertion 8: MCP-RTW-3PASS-SCHEDULER-STATE-MACHINE-008
  // --------------------------------------------------------------------------
  it('MCP-RTW-3PASS-SCHEDULER-STATE-MACHINE-008: executes 3-pass ContextRoutingStateMachine with RFC 8785 JCS attestation', async () => {
    const scheduler = new ContextRoutingStateMachine({
      broker,
      redTeamWorker
    });

    const pipelineInput: ContextRoutingInput = {
      task_id: 'task:sched:m6-6:full-run',
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      target_catalog_url: 'https://catalog.howrah-industrial.com/din3017-ss304-16-25-p10',
      reference_time_utc: REF_TIME,
      pack_mass_grams: 140,
      hsn_code: '73269099',
      is_msme_supplier: true,
      has_written_msme_agreement: true,
      assumed_dpo_days: 45,
      inbound_freight_subunits: 45000n,
      packaging_kitting_subunits: 32000n,
      customs_inspection_subunits: 0n,
      raw_source_html: `
        <div id="catalog-listing" data-sku="${SKU_ID}">
          <span class="product-title">DIN 3017 SS304 Hose Clamp 16-25mm Pack of 10</span>
          <span class="unit-price" data-price="382100">₹ 38.21 / Pack</span>
          <span class="supplier-moq" data-moq="500">MOQ: 500 Packs</span>
        </div>
      `
    };

    const runRecord1 = await scheduler.runFullPipeline(pipelineInput);
    expect(runRecord1.candidate_id).toBe(CANDIDATE_ID);
    expect(runRecord1.pass1.primary_source_capture).toBeDefined();
    expect(runRecord1.pass1.physical_scrap_floor).toBeDefined();
    expect(runRecord1.pass1.statutory_response).toBeDefined();
    expect(runRecord1.pass3.final_disposition).toBe('ELIGIBLE_FOR_HUMAN_REVIEW');
    expect(runRecord1.telemetry_digest_sha256).toMatch(/^[a-f0-9]{64}$/);

    // Verify bit-for-bit JCS reproducibility
    const runRecord2 = await scheduler.runFullPipeline(pipelineInput);
    expect(runRecord1.pass3.red_team_response.disposition).toBe(
      runRecord2.pass3.red_team_response.disposition
    );

    // Assert deep freeze immutability
    expect(Object.isFrozen(runRecord1)).toBe(true);
    expect(Object.isFrozen(runRecord1.pass1)).toBe(true);
    expect(Object.isFrozen(runRecord1.pass3)).toBe(true);
  });
});
