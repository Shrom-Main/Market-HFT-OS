/**
 * Market HFT OS — Investigation Skill Registry & Procedural Playbooks
 * POC-001 Stage C.3.2: Unified Agent Capability, Skills & Connector Integration
 *
 * Implements the vital distinction between Capabilities and Skills:
 * - Capabilities: Platform-owned external operational tools exposed by ConnectorGateway
 *   (e.g., extract_pricing_and_terms, audit_statutory_registry, fetch_clean_dom).
 * - Skills: Reusable procedural playbooks that teach agents *how to investigate* a specific domain,
 *   which capabilities to orchestrate, what inputs are required, how to interpret claims,
 *   and how to recover from failure.
 *
 * Key Capabilities:
 * 1. Dynamic Skill Discovery without hardcoding implementations in agents.
 * 2. Multi-domain playbooks: Physical Goods, Statutory Compliance, and Digital SaaS.
 * 3. Structured context passing and provenance preservation.
 * 4. Explicit failure and fallback recovery rules.
 */

import { sha256 } from '../../canonical/crypto.js';
import { canonicalizeJCS } from '../../canonical/jcs.js';
import { ConnectorGateway, ConnectorExecutionEnvelope } from '../../mcp/connectorGateway.js';

export type InvestigationDomain =
  | 'PHYSICAL_MANUFACTURING'
  | 'STATUTORY_COMPLIANCE'
  | 'DIGITAL_SAAS';

export interface SkillProcedureStep {
  readonly step_index: number;
  readonly name: string;
  readonly capability_id: string;
  readonly target_agent_role: string;
  readonly description: string;
  readonly expected_claim_fields: readonly string[];
  readonly is_mandatory: boolean;
}

export interface SkillFailureRecoveryRule {
  readonly failure_condition: string;
  readonly recovery_strategy: string;
  readonly fallback_capability_id?: string;
  readonly epistemic_demotion?: 'UNVERIFIED_CLAIM' | 'DERIVED_ESTIMATE' | 'CONTRADICTION_FLAGGED';
}

export interface InvestigationSkillDefinition {
  readonly skill_id: string;
  readonly name: string;
  readonly domain: InvestigationDomain;
  readonly description: string;
  readonly applicable_categories: readonly string[];
  readonly required_capabilities: readonly string[];
  readonly procedures: readonly SkillProcedureStep[];
  readonly failure_recovery_rules: readonly SkillFailureRecoveryRule[];
  readonly rejected_domain_assumptions?: readonly string[];
}

export interface SkillExecutionStepResult {
  readonly step_index: number;
  readonly step_name: string;
  readonly capability_id: string;
  readonly envelope: ConnectorExecutionEnvelope;
  readonly extracted_claims: Record<string, unknown>;
  readonly status: 'STEP_SUCCESS' | 'STEP_RECOVERED' | 'STEP_FAILED';
}

export interface SkillExecutionReport {
  readonly skill_id: string;
  readonly execution_id: string;
  readonly candidate_id: string;
  readonly domain: InvestigationDomain;
  readonly initiated_at_utc: string;
  readonly completed_at_utc: string;
  readonly overall_status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'BLOCKED';
  readonly executed_steps: readonly SkillExecutionStepResult[];
  readonly synthesized_claims: Record<string, unknown>;
  readonly rejected_assumptions: readonly string[];
  readonly report_sha256: string;
}

export class SkillRegistry {
  private static instance: SkillRegistry | null = null;
  private readonly skills: Map<string, InvestigationSkillDefinition> = new Map();

  constructor() {
    this.registerStandardSkills();
  }

  public static getInstance(): SkillRegistry {
    if (!SkillRegistry.instance) {
      SkillRegistry.instance = new SkillRegistry();
    }
    return SkillRegistry.instance;
  }

  public static resetInstanceForTesting(): void {
    SkillRegistry.instance = null;
  }

  private registerStandardSkills(): void {
    // ------------------------------------------------------------------------
    // SKILL 1: Physical Manufacturing & Supplier Qualification
    // ------------------------------------------------------------------------
    const physicalSkill: InvestigationSkillDefinition = {
      skill_id: 'skill:proc:physical-supplier-qualification',
      name: 'Physical Supplier Qualification & Terms Verification Playbook',
      domain: 'PHYSICAL_MANUFACTURING',
      description: 'Orchestrates multi-step investigation of manufacturing suppliers, verifying corporate registration, catalog price sheets, corridor transit distances, and metallurgy scrap floor.',
      applicable_categories: ['PHYSICAL_GOODS', 'HARDWARE_MANUFACTURING'],
      required_capabilities: [
        'audit_statutory_registry',
        'extract_pricing_and_terms',
        'logistics_transit_route',
        'audit_conflict_and_bias'
      ],
      procedures: [
        {
          step_index: 1,
          name: 'Verify Corporate Statutory Incorporation',
          capability_id: 'audit_statutory_registry',
          target_agent_role: 'StatutoryRegistrySpecialist',
          description: 'Audit MCA21 corporate incorporation, CIN, and GST compliance status.',
          expected_claim_fields: ['cin_mca_status', 'incorporation_year', 'statutory_entity'],
          is_mandatory: true
        },
        {
          step_index: 2,
          name: 'Extract Commercial Terms and Price Sheet',
          capability_id: 'extract_pricing_and_terms',
          target_agent_role: 'SupplySpecialist',
          description: 'Extract factory gate quote, MOQ, payment terms, and material grade.',
          expected_claim_fields: ['gross_price_inr', 'moq_units', 'material_grade'],
          is_mandatory: true
        },
        {
          step_index: 3,
          name: 'Model Logistics Transit Corridor',
          capability_id: 'logistics_transit_route',
          target_agent_role: 'LogisticsRouteSpecialist',
          description: 'Compute freight corridor distance, duration, and road transit toll estimates.',
          expected_claim_fields: ['distance_km', 'duration_seconds', 'toll_cost_estimate_inr'],
          is_mandatory: false
        },
        {
          step_index: 4,
          name: 'Adversarial Scrap Floor & Mass-Scaled Metallurgy Audit',
          capability_id: 'audit_conflict_and_bias',
          target_agent_role: 'AdversarialAuditorSpecialist',
          description: 'Audits per-unit component quote against derived mass-scaled scrap floor using verified component mass in grams and LME SS304 benchmark.',
          expected_claim_fields: ['adversarial_audit_verdict', 'syndication_signals', 'component_mass_grams'],
          is_mandatory: true
        }
      ],
      failure_recovery_rules: [
        {
          failure_condition: 'Primary statutory portal unreachable',
          recovery_strategy: 'Divert to internal statutory historical gazette; demote to STALE_HISTORICAL',
          fallback_capability_id: 'internal-statutory-cache',
          epistemic_demotion: 'DERIVED_ESTIMATE'
        },
        {
          failure_condition: 'Logistics API rate limited or quota exhausted',
          recovery_strategy: 'Divert to algorithmic haversine geodesic calculation; badge PROVISIONAL_CACHE'
        }
      ]
    };

    // ------------------------------------------------------------------------
    // SKILL 2: Statutory & Regulatory Compliance Due Diligence
    // ------------------------------------------------------------------------
    const statutorySkill: InvestigationSkillDefinition = {
      skill_id: 'skill:proc:statutory-corporate-audit',
      name: 'Statutory Registry & Regulatory Compliance Due Diligence Playbook',
      domain: 'STATUTORY_COMPLIANCE',
      description: 'Conducts formal corporate identity, MCA21 gazette, GST tariff, and MSME 43B(h) credit ceiling audits.',
      applicable_categories: ['PHYSICAL_GOODS', 'HARDWARE_MANUFACTURING', 'SOFTWARE_DIGITAL'],
      required_capabilities: [
        'resolve_corporate_identity',
        'audit_statutory_registry',
        'audit_conflict_and_bias'
      ],
      procedures: [
        {
          step_index: 1,
          name: 'Resolve Entity Legal Identity & Status',
          capability_id: 'resolve_corporate_identity',
          target_agent_role: 'StatutoryRegistrySpecialist',
          description: 'Resolve official corporate CIN, legal name, registered address, and filing status.',
          expected_claim_fields: ['statutory_entity', 'cin_mca_status', 'incorporation_year'],
          is_mandatory: true
        },
        {
          step_index: 2,
          name: 'Audit Regulatory Tariffs & MSME Terms',
          capability_id: 'audit_statutory_registry',
          target_agent_role: 'StatutoryRegistrySpecialist',
          description: 'Audit applicable GST rate bps, anti-dumping schedules, and MSME maximum payment days.',
          expected_claim_fields: ['parameter_verified', 'value', 'statutory_source'],
          is_mandatory: true
        },
        {
          step_index: 3,
          name: 'Verify Cross-Source Identity & Tax Uniqueness',
          capability_id: 'audit_conflict_and_bias',
          target_agent_role: 'AdversarialAuditorSpecialist',
          description: 'Confirm distinct physical address hash and GSTIN to prevent syndication collision.',
          expected_claim_fields: ['adversarial_audit_verdict', 'conflicts_detected'],
          is_mandatory: true
        }
      ],
      failure_recovery_rules: [
        {
          failure_condition: 'Entity CIN not found in live registry',
          recovery_strategy: 'Fallback to historical state registrar gazette; flag UNVERIFIED_CLAIM',
          epistemic_demotion: 'UNVERIFIED_CLAIM'
        }
      ]
    };

    // ------------------------------------------------------------------------
    // SKILL 3: Digital Domain / SaaS & API Subscription Qualification
    // ------------------------------------------------------------------------
    const digitalSaaSSkill: InvestigationSkillDefinition = {
      skill_id: 'skill:proc:digital-saas-qualification',
      name: 'Digital SaaS & API Subscription Qualification Playbook',
      domain: 'DIGITAL_SAAS',
      description: 'Orchestrates digital commercial intelligence for software API subscriptions, extracting pricing tiers, SLA uptime terms, and customer defect chatter, while rejecting physical-goods assumptions.',
      applicable_categories: ['SOFTWARE_DIGITAL', 'SERVICE_SOFTWARE'],
      required_capabilities: [
        'fetch_clean_dom',
        'extract_pricing_and_terms',
        'scan_media_sentiment',
        'synthesize_reasoning'
      ],
      procedures: [
        {
          step_index: 1,
          name: 'Fetch Clean DOM Documentation & Portal Terms',
          capability_id: 'fetch_clean_dom',
          target_agent_role: 'SupplySpecialist',
          description: 'Extract documentation structure, API spec endpoints, and SLA terms without bot blocks.',
          expected_claim_fields: ['captured_url', 'structured_text'],
          is_mandatory: true
        },
        {
          step_index: 2,
          name: 'Extract SaaS Subscription Pricing Tiers',
          capability_id: 'extract_pricing_and_terms',
          target_agent_role: 'SupplySpecialist',
          description: 'Extract subscription tier prices, per-seat/API usage fees, and refund policy.',
          expected_claim_fields: ['gross_price_inr', 'payment_terms'],
          is_mandatory: true
        },
        {
          step_index: 3,
          name: 'Scan Community Incident & Sentiment Chatter',
          capability_id: 'scan_media_sentiment',
          target_agent_role: 'MediaChatterWorker',
          description: 'Survey developer forums, outage trackers, and review sentiment for reliability risks.',
          expected_claim_fields: ['sentiment_score', 'sentiment_category'],
          is_mandatory: false
        },
        {
          step_index: 4,
          name: 'Synthesize Digital Unit Economics & COGS Groundedness',
          capability_id: 'synthesize_reasoning',
          target_agent_role: 'LeadInvestigator',
          description: 'Audits SaaS pricing vs primary infrastructure COGS disclosures to establish grounded gross margin or classify as UNSUPPORTED_ESTIMATE.',
          expected_claim_fields: ['reasoning_synthesis', 'margin_estimate', 'margin_epistemic_status', 'cost_basis_breakdown'],
          is_mandatory: true
        }
      ],
      failure_recovery_rules: [
        {
          failure_condition: 'Social chatter API fails with invalid scope',
          recovery_strategy: 'Divert to YouTube & technical forums transcript corpus; retain CURRENT status'
        }
      ],
      rejected_domain_assumptions: [
        'Physical scrap commodity floor (SS304/LME scrap) is NOT applicable to digital code/API tokens.',
        'Corridor road freight transit distance (NH19/NH53) is NOT applicable; latency replaces freight.',
        'B2B minimum order quantity (MOQ) of 500 physical units is replaced by monthly seat commitments.'
      ]
    };

    this.skills.set(physicalSkill.skill_id, Object.freeze(physicalSkill));
    this.skills.set(statutorySkill.skill_id, Object.freeze(statutorySkill));
    this.skills.set(digitalSaaSSkill.skill_id, Object.freeze(digitalSaaSSkill));
  }

  // --------------------------------------------------------------------------
  // DISCOVERY APIs
  // --------------------------------------------------------------------------

  public discoverSkills(filter?: {
    domain?: InvestigationDomain;
    category?: string;
    capability?: string;
  }): readonly InvestigationSkillDefinition[] {
    return Array.from(this.skills.values()).filter((skill) => {
      if (filter?.domain && skill.domain !== filter.domain) return false;
      if (filter?.category && !skill.applicable_categories.includes(filter.category)) return false;
      if (filter?.capability && !skill.required_capabilities.includes(filter.capability)) return false;
      return true;
    });
  }

  public getSkill(skillId: string): InvestigationSkillDefinition | undefined {
    return this.skills.get(skillId);
  }

  /**
   * Dynamically registers a new custom or composite skill at runtime.
   */
  public registerSkill(definition: InvestigationSkillDefinition): void {
    if (!definition.skill_id || !definition.name || !definition.domain) {
      throw new Error('E-SKILL-INVALID: Skill definition must have skill_id, name, and domain.');
    }
    this.skills.set(definition.skill_id, Object.freeze(definition));
  }

  /**
   * Composes a new skill by deriving from a base playbook, extending procedures,
   * injecting custom validation steps, or modifying domain assumptions.
   */
  public composeSkill(
    baseSkillId: string,
    composition: {
      new_skill_id: string;
      name?: string;
      description?: string;
      additional_procedures?: readonly SkillProcedureStep[];
      override_procedures?: readonly SkillProcedureStep[];
      additional_capabilities?: readonly string[];
      additional_rejected_assumptions?: readonly string[];
      additional_recovery_rules?: readonly SkillFailureRecoveryRule[];
    }
  ): InvestigationSkillDefinition {
    const base = this.skills.get(baseSkillId);
    if (!base) {
      throw new Error(`E-SKILL-NOT-FOUND: Cannot compose from non-existent base skill '${baseSkillId}'.`);
    }

    const procedures = composition.override_procedures
      ? [...composition.override_procedures]
      : [...base.procedures, ...(composition.additional_procedures || [])];

    // Re-index procedures sequentially
    const reindexedProcedures = procedures.map((p, idx) => ({
      ...p,
      step_index: idx + 1
    }));

    const requiredCapabilities = Array.from(
      new Set([
        ...base.required_capabilities,
        ...(composition.additional_capabilities || []),
        ...reindexedProcedures.map((p) => p.capability_id)
      ])
    );

    const composed: InvestigationSkillDefinition = {
      skill_id: composition.new_skill_id,
      name: composition.name ?? `${base.name} (Composed)`,
      domain: base.domain,
      description: composition.description ?? base.description,
      applicable_categories: [...base.applicable_categories],
      required_capabilities: requiredCapabilities,
      procedures: reindexedProcedures,
      failure_recovery_rules: [
        ...base.failure_recovery_rules,
        ...(composition.additional_recovery_rules || [])
      ],
      rejected_domain_assumptions: [
        ...(base.rejected_domain_assumptions || []),
        ...(composition.additional_rejected_assumptions || [])
      ]
    };

    this.registerSkill(composed);
    return composed;
  }

  // --------------------------------------------------------------------------
  // EXECUTABLE PLAYBOOK ORCHESTRATION
  // --------------------------------------------------------------------------

  public async executeSkill(
    skillId: string,
    context: {
      candidate_id: string;
      candidate_name: string;
      category: string;
      parameters?: Record<string, unknown>;
    },
    gateway: ConnectorGateway,
    options?: {
      caller_role?: string;
      correlation_prefix?: string;
    }
  ): Promise<SkillExecutionReport> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`E-SKILL-UNKNOWN: Skill '${skillId}' is not registered in SkillRegistry.`);
    }

    const executionId = `SKILL-RUN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const initiatedAt = new Date().toISOString();
    const executedSteps: SkillExecutionStepResult[] = [];
    const synthesizedClaims: Record<string, unknown> = {};

    for (const step of skill.procedures) {
      const corrId = `${options?.correlation_prefix ?? 'SKILL'}-${executionId}-STEP-${step.step_index}`;
      const stepParams: Record<string, unknown> = {
        candidate_id: context.candidate_id,
        candidate_name: context.candidate_name,
        category: context.category,
        sub_question: step.description,
        ...(context.parameters || {})
      };

      try {
        const envelope = await gateway.executeCapability(
          step.capability_id,
          stepParams,
          {
            correlation_id: corrId,
            caller_role: options?.caller_role ?? step.target_agent_role
          }
        );

        const isSuccess = envelope.transport_outcome === 'SUCCESS';
        const claims = (envelope.payload as Record<string, unknown>) || {};

        executedSteps.push({
          step_index: step.step_index,
          step_name: step.name,
          capability_id: step.capability_id,
          envelope,
          extracted_claims: claims,
          status: isSuccess
            ? envelope.fallback_provenance?.was_fallback
              ? 'STEP_RECOVERED'
              : 'STEP_SUCCESS'
            : 'STEP_FAILED'
        });

        // Merge claims into synthesized claims
        Object.assign(synthesizedClaims, claims);

        if (!isSuccess && step.is_mandatory) {
          // Mandatory step failed closed
          break;
        }
      } catch (err: any) {
        // Handle step failure
        if (step.is_mandatory) {
          break;
        }
      }
    }

    const allMandatorySuccess = skill.procedures
      .filter((s) => s.is_mandatory)
      .every((s) => {
        const r = executedSteps.find((es) => es.step_index === s.step_index);
        return r && (r.status === 'STEP_SUCCESS' || r.status === 'STEP_RECOVERED');
      });

    const overallStatus: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'BLOCKED' = allMandatorySuccess
      ? executedSteps.length === skill.procedures.length
        ? 'SUCCESS'
        : 'PARTIAL_SUCCESS'
      : 'BLOCKED';

    const completedAt = new Date().toISOString();

    const reportBase = {
      skill_id: skill.skill_id,
      execution_id: executionId,
      candidate_id: context.candidate_id,
      domain: skill.domain,
      initiated_at_utc: initiatedAt,
      completed_at_utc: completedAt,
      overall_status: overallStatus,
      executed_steps: executedSteps,
      synthesized_claims: synthesizedClaims,
      rejected_assumptions: skill.rejected_domain_assumptions ?? []
    };

    const reportSha = sha256(canonicalizeJCS(reportBase));

    return Object.freeze({
      ...reportBase,
      report_sha256: reportSha
    });
  }
}
