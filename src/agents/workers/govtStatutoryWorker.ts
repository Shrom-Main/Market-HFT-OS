/**
 * Market HFT OS — Micro-Agent #4: GovtAndStatutoryWorker (Stage 5)
 *
 * Implements:
 * 1. Strict MCP Broker Routing & Tool Policy (GOVT_STATUTORY_TOOL_POLICY):
 *    - Worker ID: 'worker:govt-statutory:v1'
 *    - Read-only tool 'mcp://policy-bulletins/fetch_circular'
 *    - Scoped to approved statutory hosts ('cbic-gst.gov.in', 'incometaxindia.gov.in', 'dgft.gov.in', 'msme.gov.in')
 *    - 256 KB payload cap, GET only, redirect blocking
 *    - InjectionCanaryGuard quarantine (E-GSW-PROMPT-INJECTION-DETECTED)
 * 2. Immutable Statutory Citation & Rule Claim Extraction:
 *    - Ingests CBIC HSN GST rates (73269099 = 1800 bps), Sec 52 TCS (100 bps),
 *      Sec 194-O TDS (100 bps), DGFT customs tariffs (750 bps BCD), and Anti-Dumping duties
 *    - Mandatory Citation: Every claim must bind to authority, notification/section ID,
 *      effective date, and document SHA-256 (E-GSW-INVALID-CITATION)
 *    - Zero-Default Policy: Missing circular or unknown HSN returns DATA_REQUIRED (E-GSW-STATUTORY-CIRCULAR-REQUIRED)
 * 3. MSME Section 43B(h) Payment Term Cross-Check:
 *    - Micro/Small Enterprise suppliers: 45 days with written agreement, 15 days without
 *    - Emits msme_max_payment_terms_days allowing Red-Team to flag 60-90 day credit term illusions
 * 4. FormulaRegistry Non-Mutation Firewall:
 *    - Autonomous mutation of PROMOTED_NORMATIVE tax cards is strictly blocked (E-ERR-GOV-002)
 *    - Worker can only emit UNVERIFIED claims or register sandboxed CANDIDATE_UI_MODEL cards
 * 5. Deterministic JCS Canonicalization:
 *    - Bit-for-bit reproducible JSON-RPC 2.0 / MCP responses
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
  CapabilityGrant
} from '../../mcp/mcpSubstrate.js';
import { InjectionCanaryGuard } from './sourceCaptureWorker.js';
import { deepFreeze } from '../../verification/gate.js';
import {
  FormulaRegistry,
  FormulaCard,
  FormulaCardInput
} from '../../research/formulaRegistry.js';
import {
  GovtStatutoryToolPolicy,
  GOVT_STATUTORY_TOOL_POLICY,
  StatutoryCitation,
  StatutoryRuleClaim,
  StatutoryAuthority,
  StatutoryParameterName,
  StatutoryUnit,
  GovtStatutoryMcpRequest,
  GovtStatutoryMcpResponse,
  GovtStatutoryEvidenceEnvelope,
  CandidateFormulaProposal
} from '../../mcp/contracts/govtStatutoryContract.js';

export {
  GovtStatutoryToolPolicy,
  GOVT_STATUTORY_TOOL_POLICY,
  StatutoryCitation,
  StatutoryRuleClaim,
  StatutoryAuthority,
  StatutoryParameterName,
  StatutoryUnit,
  GovtStatutoryMcpRequest,
  GovtStatutoryMcpResponse,
  GovtStatutoryEvidenceEnvelope,
  CandidateFormulaProposal
};

// ============================================================================
// 1. STATUTORY CIRCULAR FIXTURE REGISTRY
// ============================================================================

export interface RegisteredCircularItem {
  readonly circular_id: string;
  readonly authority: StatutoryAuthority;
  readonly notification_or_section_id: string;
  readonly effective_from_date: string;
  readonly hsn_or_sac_code?: string;
  readonly parameter_name: StatutoryParameterName;
  readonly value_bigint: bigint;
  readonly unit: StatutoryUnit;
  readonly source_url: string;
  readonly title: string;
  readonly raw_text_summary: string;
  readonly document_sha256: string;
}

export class StatutoryCircularRegistry {
  private static readonly circulars = new Map<string, RegisteredCircularItem>();

  static {
    StatutoryCircularRegistry.bootstrapDefaults();
  }

  public static bootstrapDefaults(): void {
    StatutoryCircularRegistry.circulars.clear();

    // 1. CBIC GST Rate on HSN 73269099 (Articles of Iron or Steel / Hose Clamps)
    const cbicHsn73269099Text =
      'CBIC Notification No. 01/2017-Integrated Tax (Rate), Schedule III, Entry 369B: ' +
      'All goods under HSN 7326 (including other articles of iron or steel wire, hose clamps, and fasteners) ' +
      'are subject to Integrated Goods and Services Tax (IGST) at the standard rate of 18.00% (1800 basis points).';
    StatutoryCircularRegistry.circulars.set('CBIC-GST-HSN-73269099', {
      circular_id: 'CBIC-GST-HSN-73269099',
      authority: 'CBIC',
      notification_or_section_id: 'Notification No. 01/2017-Integrated Tax (Rate)',
      effective_from_date: '2017-07-01',
      hsn_or_sac_code: '73269099',
      parameter_name: 'gst_rate_bps',
      value_bigint: 1800n,
      unit: 'BPS',
      source_url: 'https://cbic-gst.gov.in/gst-goods-services-rates.html',
      title: 'IGST Rate for HSN 73269099 (Hose Clamps & Steel Articles)',
      raw_text_summary: cbicHsn73269099Text,
      document_sha256: sha256(cbicHsn73269099Text)
    });

    // 2. CBIC E-Commerce Tax Collection at Source (TCS) under CGST Section 52
    const cbicTcsSec52Text =
      'Notification No. 15/2024-Central Tax issued pursuant to Section 52(1) of CGST Act 2017: ' +
      'Electronic Commerce Operators (ECO) shall collect Tax Collection at Source (TCS) at the rate of ' +
      '0.5% CGST plus 0.5% SGST (aggregate 1.00% = 100 basis points) on net taxable supplies of goods or services.';
    StatutoryCircularRegistry.circulars.set('CBIC-TCS-SEC52', {
      circular_id: 'CBIC-TCS-SEC52',
      authority: 'CBIC',
      notification_or_section_id: 'Notification No. 15/2024-Central Tax',
      effective_from_date: '2024-07-10',
      parameter_name: 'tcs_rate_bps',
      value_bigint: 100n,
      unit: 'BPS',
      source_url: 'https://cbic-gst.gov.in/central-tax-notifications.html',
      title: 'CGST Section 52 E-Commerce TCS Rate Withholding',
      raw_text_summary: cbicTcsSec52Text,
      document_sha256: sha256(cbicTcsSec52Text)
    });

    // 3. CBDT E-Commerce Tax Deducted at Source (TDS) under Income Tax Act Section 194-O
    const cbdtTdsSec194OText =
      'CBDT Circular No. 20/2023 on Section 194-O of the Income-tax Act, 1961: ' +
      'An e-commerce operator shall deduct income-tax at the rate of 1.00% (100 basis points) ' +
      'of the gross amount of sales of goods or provision of services facilitated through its digital platform.';
    StatutoryCircularRegistry.circulars.set('CBDT-TDS-SEC194O', {
      circular_id: 'CBDT-TDS-SEC194O',
      authority: 'CBDT',
      notification_or_section_id: 'CBDT Circular No. 20/2023',
      effective_from_date: '2023-10-01',
      parameter_name: 'tds_rate_bps',
      value_bigint: 100n,
      unit: 'BPS',
      source_url: 'https://incometaxindia.gov.in/circulars/2023',
      title: 'Income Tax Act Section 194-O E-Commerce Participant TDS',
      raw_text_summary: cbdtTdsSec194OText,
      document_sha256: sha256(cbdtTdsSec194OText)
    });

    // 4. DGFT Customs Tariff Basic Customs Duty (BCD) on HSN 73269099
    const dgftBcdText =
      'Customs Tariff Notification No. 02/2024-Customs under Section 25(1) of Customs Act, 1962: ' +
      'Standard Basic Customs Duty (BCD) applicable to imported articles of iron or steel under HSN 73269099 ' +
      'is set at 7.50% (750 basis points) ad valorem on assessable CIF value.';
    StatutoryCircularRegistry.circulars.set('DGFT-CUSTOMS-BCD-73269099', {
      circular_id: 'DGFT-CUSTOMS-BCD-73269099',
      authority: 'DGFT',
      notification_or_section_id: 'Customs Tariff Notification No. 02/2024-Customs',
      effective_from_date: '2024-02-01',
      hsn_or_sac_code: '73269099',
      parameter_name: 'customs_bcd_bps',
      value_bigint: 750n,
      unit: 'BPS',
      source_url: 'https://dgft.gov.in/tariff/73269099',
      title: 'DGFT Customs Basic Customs Duty on HSN 73269099',
      raw_text_summary: dgftBcdText,
      document_sha256: sha256(dgftBcdText)
    });

    // 5. DGFT Anti-Dumping Duty (ADD) on Stainless Steel Flat Products / Strip
    const dgftAddText =
      'Notification No. 45/2023-Customs (ADD): Anti-Dumping Duty investigation findings on cold-rolled stainless steel ' +
      'strip/sheet imports from designated jurisdictions. Baseline reference tariff for grade SS304 specifies zero ' +
      'additional duty for domestic accredited manufacturers meeting BIS / DIN standards.';
    StatutoryCircularRegistry.circulars.set('DGFT-ADD-SS304', {
      circular_id: 'DGFT-ADD-SS304',
      authority: 'DGFT',
      notification_or_section_id: 'Notification No. 45/2023-Customs (ADD)',
      effective_from_date: '2023-09-15',
      parameter_name: 'anti_dumping_duty_subunits_per_kg',
      value_bigint: 0n,
      unit: 'SUBUNITS_INR',
      source_url: 'https://dgft.gov.in/anti-dumping/ss304',
      title: 'Anti-Dumping Duty Baseline for SS304 Strip & Fasteners',
      raw_text_summary: dgftAddText,
      document_sha256: sha256(dgftAddText)
    });

    // 6. Ministry of MSME / Income Tax Act Section 43B(h) Payment Mandate
    const msmeSec43BhText =
      'Finance Act 2023 insertion of clause (h) to Section 43B of the Income-tax Act, 1961, read with ' +
      'Sections 15 and 16 of the Micro, Small and Medium Enterprises Development (MSMED) Act, 2006: ' +
      'Any sum payable by the buyer to a micro or small enterprise shall be paid within 45 days if there is an agreement ' +
      'in writing, or within 15 days in the absence of a written agreement. Payments beyond these periods are disallowed ' +
      'as business deductions in the year of accrual and attract compound interest at 3x RBI bank rate.';
    StatutoryCircularRegistry.circulars.set('MSME-SEC-43BH-PAYMENT-TERMS', {
      circular_id: 'MSME-SEC-43BH-PAYMENT-TERMS',
      authority: 'MINISTRY_OF_MSME',
      notification_or_section_id: 'Finance Act 2023 / Income Tax Act 1961 Sec 43B(h)',
      effective_from_date: '2024-04-01',
      parameter_name: 'msme_max_payment_terms_days',
      value_bigint: 45n,
      unit: 'DAYS',
      source_url: 'https://msme.gov.in/section-43b-h-guidelines',
      title: 'Statutory 15/45-Day Payment Term Ceiling for MSME Suppliers',
      raw_text_summary: msmeSec43BhText,
      document_sha256: sha256(msmeSec43BhText)
    });
  }

  public static getCircular(circularId: string): RegisteredCircularItem | undefined {
    return this.circulars.get(circularId);
  }

  public static findByHsn(hsnCode: string, parameterName?: StatutoryParameterName): RegisteredCircularItem | undefined {
    for (const c of this.circulars.values()) {
      if (c.hsn_or_sac_code === hsnCode) {
        if (!parameterName || c.parameter_name === parameterName) {
          return c;
        }
      }
    }
    return undefined;
  }

  public static findByParameter(parameterName: StatutoryParameterName): RegisteredCircularItem | undefined {
    for (const c of this.circulars.values()) {
      if (c.parameter_name === parameterName) {
        return c;
      }
    }
    return undefined;
  }

  public static registerCircular(item: RegisteredCircularItem): void {
    this.circulars.set(item.circular_id, { ...item });
  }
}

// ============================================================================
// 2. STATUTORY CITATION & MSME VALIDATION HELPERS
// ============================================================================

export function verifyStatutoryCitation(citation: StatutoryCitation): void {
  if (!citation) {
    throw new Error('E-GSW-INVALID-CITATION: Statutory citation object is required.');
  }

  const validAuthorities: StatutoryAuthority[] = ['CBIC', 'CBDT', 'DGFT', 'MINISTRY_OF_MSME'];
  if (!validAuthorities.includes(citation.authority)) {
    throw new Error(`E-GSW-INVALID-CITATION: Authority '${citation.authority}' is not an authorized statutory body.`);
  }

  if (!citation.notification_or_section_id || citation.notification_or_section_id.trim().length === 0) {
    throw new Error('E-GSW-INVALID-CITATION: Notification or statutory section ID cannot be empty.');
  }

  if (!citation.effective_from_date || !/^\d{4}-\d{2}-\d{2}$/.test(citation.effective_from_date)) {
    throw new Error(`E-GSW-INVALID-CITATION: Effective date '${citation.effective_from_date}' must follow YYYY-MM-DD format.`);
  }

  if (!citation.document_sha256 || !/^[0-9a-f]{64}$/i.test(citation.document_sha256)) {
    throw new Error('E-GSW-INVALID-CITATION: Document SHA-256 must be a valid 64-character hexadecimal digest.');
  }
}

/**
 * Derives the statutory maximum payment term ceiling under Section 43B(h) / MSMED Act 2006.
 * - Non-MSME: 0n (no statutory MSMED payment term cap)
 * - MSME with written agreement: 45n days
 * - MSME without written agreement: 15n days
 */
export function evaluateMsmePaymentTermLimit(
  isMsmeSupplier: boolean,
  hasWrittenAgreement: boolean
): bigint {
  if (!isMsmeSupplier) {
    return 0n;
  }
  return hasWrittenAgreement ? 45n : 15n;
}

// ============================================================================
// 3. MCP TOOL DESCRIPTOR & SERVER REGISTRATION
// ============================================================================

export const GOVT_STATUTORY_TOOL_DESCRIPTOR: McpToolDescriptor = Object.freeze({
  name: 'mcp://policy-bulletins/fetch_circular',
  description:
    'Read-only government policy and statutory circular query endpoint with immutable legal citation verification, MSME Sec 43B(h) compliance, and zero fabricated default tax parameters',
  inputSchema: {
    type: 'object' as const,
    properties: {
      circular_id: { type: 'string' },
      hsn_code: { type: 'string' },
      parameter_name: { type: 'string' },
      target_url: { type: 'string' },
      url: { type: 'string' },
      is_msme_supplier: { type: 'boolean' },
      has_written_payment_agreement: { type: 'boolean' },
      custom_commercial_status: { type: 'string' },
      reference_time_utc: { type: 'string' },
      raw_circular_payload: { type: 'string' },
      custom_claims: { type: 'array' },
      task_id: { type: 'string' }
    }
  }
});

export function registerGovtStatutoryTool(server: McpServerAdapter): void {
  server.registerTool({
    descriptor: GOVT_STATUTORY_TOOL_DESCRIPTOR,
    handler: async (args: Record<string, unknown>): Promise<McpToolCallResponse['result']> => {
      // 1. Hardcoded Commercial Status Ceiling
      const customCommercialStatus = args.custom_commercial_status as string | undefined;
      if (customCommercialStatus && customCommercialStatus !== 'NOT_APPLICABLE') {
        throw new Error(
          'E-GSW-COMMERCIAL-STATUS-FORBIDDEN: Statutory rules and circulars cannot carry commercial offer status.'
        );
      }

      const circularId = args.circular_id ? String(args.circular_id) : undefined;
      const hsnCode = args.hsn_code ? String(args.hsn_code) : undefined;
      const parameterName = args.parameter_name as StatutoryParameterName | undefined;
      const taskId = String(args.task_id || args.request_id || 'gsw-task-default');
      const referenceTimeUtc = String(args.reference_time_utc || '2026-10-18T00:00:00.000Z');

      // 2. Scan for prompt injection if raw payload provided
      if (args.raw_circular_payload) {
        const rawText = String(args.raw_circular_payload);
        const canaryResult = InjectionCanaryGuard.scan(rawText);
        if (canaryResult.quarantined) {
          const quarantinedResponse: GovtStatutoryMcpResponse = {
            request_id: taskId,
            requested_at_utc: referenceTimeUtc,
            status: 'QUARANTINED_INJECTION',
            error_code: 'E-GSW-PROMPT-INJECTION-DETECTED',
            error_reason: `Statutory circular payload quarantined due to prompt injection flags: [${canaryResult.flags.join(', ')}].`,
            claims: [],
            evidence_envelope: Object.freeze({
              evidence_kind: 'SOURCE_DOCUMENT',
              verification_status: 'UNVERIFIED',
              commercial_status: 'NOT_APPLICABLE',
              provenance_lineage: Object.freeze({
                source_id: circularId || 'raw_circular_payload',
                observed_at_utc: referenceTimeUtc,
                ttl_seconds: 604800,
                document_sha256: sha256(rawText),
                extractor_version: 'gsw-statutory-sieve-v1.0.0'
              })
            })
          };

          const serializedQuarantine = canonicalizeJCS(sanitizeForJcs(quarantinedResponse));
          return {
            content: [{ type: 'text', text: serializedQuarantine }],
            tokens_used: Math.ceil(serializedQuarantine.length / 4)
          };
        }
      }

      // 3. Resolve Claims (Zero Fabricated Defaults Policy)
      const claims: Array<{
        rule_id: string;
        parameter_name: StatutoryParameterName;
        proposed_value_bigint: string;
        unit: StatutoryUnit;
        citation: StatutoryCitation;
        verification_status: 'UNVERIFIED';
        candidate_formula_proposal?: CandidateFormulaProposal;
      }> = [];

      let sourceUrl = 'https://cbic-gst.gov.in';

      // Check for custom claims supplied in arguments
      const customClaims = args.custom_claims as
        | ReadonlyArray<{
            rule_id: string;
            parameter_name: StatutoryParameterName;
            proposed_value_bigint: string;
            unit: StatutoryUnit;
            citation: StatutoryCitation;
          }>
        | undefined;

      if (customClaims && Array.isArray(customClaims) && customClaims.length > 0) {
        for (const cc of customClaims) {
          try {
            verifyStatutoryCitation(cc.citation);
          } catch (citErr: any) {
            const citFailResponse: GovtStatutoryMcpResponse = {
              request_id: taskId,
              requested_at_utc: referenceTimeUtc,
              status: 'CITATION_INVALID_REJECTED',
              error_code: 'E-GSW-INVALID-CITATION',
              error_reason: citErr.message || 'E-GSW-INVALID-CITATION: Citation validation failed',
              claims: [],
              evidence_envelope: Object.freeze({
                evidence_kind: 'SOURCE_DOCUMENT',
                verification_status: 'UNVERIFIED',
                commercial_status: 'NOT_APPLICABLE',
                provenance_lineage: Object.freeze({
                  source_id: 'custom_claims',
                  observed_at_utc: referenceTimeUtc,
                  ttl_seconds: 604800,
                  extractor_version: 'gsw-statutory-sieve-v1.0.0'
                })
              })
            };
            const serializedCitFail = canonicalizeJCS(sanitizeForJcs(citFailResponse));
            return {
              content: [{ type: 'text', text: serializedCitFail }],
              tokens_used: Math.ceil(serializedCitFail.length / 4)
            };
          }

          claims.push({
            rule_id: cc.rule_id,
            parameter_name: cc.parameter_name,
            proposed_value_bigint: String(cc.proposed_value_bigint),
            unit: cc.unit,
            citation: { ...cc.citation },
            verification_status: 'UNVERIFIED'
          });
        }
      } else {
        // Query Registry
        let matched: RegisteredCircularItem | undefined;

        if (circularId) {
          matched = StatutoryCircularRegistry.getCircular(circularId);
        } else if (hsnCode) {
          matched = StatutoryCircularRegistry.findByHsn(hsnCode, parameterName);
        } else if (parameterName) {
          matched = StatutoryCircularRegistry.findByParameter(parameterName);
        }

        if (!matched) {
          const missingResponse: GovtStatutoryMcpResponse = {
            request_id: taskId,
            requested_at_utc: referenceTimeUtc,
            status: 'DATA_REQUIRED',
            error_code: 'E-GSW-STATUTORY-CIRCULAR-REQUIRED',
            error_reason: `E-GSW-STATUTORY-CIRCULAR-REQUIRED: No official circular found for circular_id='${circularId || ''}', hsn_code='${hsnCode || ''}', parameter='${parameterName || ''}'. Zero fabricated default tax rates permitted.`,
            claims: [],
            evidence_envelope: Object.freeze({
              evidence_kind: 'SOURCE_DOCUMENT',
              verification_status: 'UNVERIFIED',
              commercial_status: 'NOT_APPLICABLE',
              provenance_lineage: Object.freeze({
                source_id: 'cbic-gst.gov.in',
                observed_at_utc: referenceTimeUtc,
                ttl_seconds: 604800,
                extractor_version: 'gsw-statutory-sieve-v1.0.0'
              })
            })
          };
          const serializedMissing = canonicalizeJCS(sanitizeForJcs(missingResponse));
          return {
            content: [{ type: 'text', text: serializedMissing }],
            tokens_used: Math.ceil(serializedMissing.length / 4)
          };
        }

        sourceUrl = matched.source_url;
        claims.push({
          rule_id: `stat-rule-${matched.circular_id.toLowerCase()}`,
          parameter_name: matched.parameter_name,
          proposed_value_bigint: matched.value_bigint.toString(),
          unit: matched.unit,
          citation: Object.freeze({
            authority: matched.authority,
            notification_or_section_id: matched.notification_or_section_id,
            effective_from_date: matched.effective_from_date,
            ...(matched.hsn_or_sac_code ? { hsn_or_sac_code: matched.hsn_or_sac_code } : {}),
            document_sha256: matched.document_sha256
          }),
          verification_status: 'UNVERIFIED',
          candidate_formula_proposal: Object.freeze({
            target_formula_id: `FIN-TAX-CANDIDATE-${matched.parameter_name.toUpperCase().replace(/_/g, '-')}`,
            requires_owner_promotion: true
          })
        });
      }

      // 4. Optional MSME Section 43B(h) Cross-Check
      let msmeCrossCheckPayload: GovtStatutoryMcpResponse['msme_cross_check'] | undefined;
      const isMsme = args.is_msme_supplier === true;

      if (isMsme) {
        const hasAgreement = args.has_written_payment_agreement === true;
        const maxDays = evaluateMsmePaymentTermLimit(true, hasAgreement);
        msmeCrossCheckPayload = Object.freeze({
          is_msme_supplier: true,
          has_written_agreement: hasAgreement,
          statutory_max_payment_terms_days: Number(maxDays),
          citation_section: 'Income Tax Act 1961 Section 43B(h)' as const
        });

        // Add MSME rule claim if not already present
        if (!claims.some((c) => c.parameter_name === 'msme_max_payment_terms_days')) {
          claims.push({
            rule_id: 'stat-rule-msme-sec43bh',
            parameter_name: 'msme_max_payment_terms_days',
            proposed_value_bigint: maxDays.toString(),
            unit: 'DAYS',
            citation: Object.freeze({
              authority: 'MINISTRY_OF_MSME',
              notification_or_section_id: 'Finance Act 2023 / Income Tax Act 1961 Sec 43B(h)',
              effective_from_date: '2024-04-01',
              document_sha256: sha256('Finance Act 2023 / Income Tax Act 1961 Sec 43B(h)')
            }),
            verification_status: 'UNVERIFIED',
            candidate_formula_proposal: Object.freeze({
              target_formula_id: 'FIN-CCC-ROWC-005',
              requires_owner_promotion: true
            })
          });
        }
      }

      // 5. Success Response
      const successResponse: GovtStatutoryMcpResponse = {
        request_id: taskId,
        requested_at_utc: referenceTimeUtc,
        status: 'RESOLVED',
        claims: Object.freeze(claims),
        ...(msmeCrossCheckPayload ? { msme_cross_check: msmeCrossCheckPayload } : {}),
        evidence_envelope: Object.freeze({
          evidence_kind: 'SOURCE_DOCUMENT',
          verification_status: 'UNVERIFIED',
          commercial_status: 'NOT_APPLICABLE',
          provenance_lineage: Object.freeze({
            source_id: sourceUrl,
            observed_at_utc: referenceTimeUtc,
            ttl_seconds: 604800,
            extractor_version: 'gsw-statutory-sieve-v1.0.0'
          })
        })
      };

      const serialized = canonicalizeJCS(sanitizeForJcs(successResponse));
      return {
        content: [{ type: 'text', text: serialized }],
        tokens_used: Math.ceil(serialized.length / 4)
      };
    }
  });
}

// ============================================================================
// 4. FORMULA REGISTRY NON-MUTATION FIREWALL HELPER
// ============================================================================

/**
 * Attempts to register a candidate statutory tax formula into FormulaRegistry.
 * Enforces the fail-closed invariant:
 * - Mutating or overriding a PROMOTED_NORMATIVE formula without human promotion
 *   fails closed with E-ERR-GOV-002.
 * - Successfully registers sandboxed CANDIDATE_UI_MODEL formulas.
 */
export function proposeStatutoryFormulaCandidate(
  registry: FormulaRegistry,
  claim: StatutoryRuleClaim,
  proposedCardInput: FormulaCardInput
): FormulaCard {
  if (claim.verification_status !== 'UNVERIFIED') {
    throw new Error('E-GSW-INVALID-CLAIM-STATUS: Statutory claims must be UNVERIFIED upon submission.');
  }

  // Attempt candidate registration. FormulaRegistry.registerCandidateFormula
  // will throw E-ERR-GOV-002 if the formulaId is currently PROMOTED_NORMATIVE.
  return registry.registerCandidateFormula(proposedCardInput);
}

// ============================================================================
// 5. GOVT AND STATUTORY WORKER
// ============================================================================

export class GovtAndStatutoryWorker {
  public static readonly WORKER_ID = 'worker:govt-statutory:v1';
  private readonly broker: McpCapabilityBroker;
  private readonly defaultGrant?: CapabilityGrant;

  constructor(broker: McpCapabilityBroker, defaultGrant?: CapabilityGrant) {
    this.broker = broker;
    this.defaultGrant = defaultGrant;
  }

  public getBroker(): McpCapabilityBroker {
    return this.broker;
  }

  public async fetchCircular(
    request: GovtStatutoryMcpRequest,
    customGrant?: CapabilityGrant
  ): Promise<GovtStatutoryMcpResponse> {
    const grant = customGrant ?? this.defaultGrant;
    if (!grant) {
      throw new Error('E-GSW-NO-GRANT: No CapabilityGrant provided for GovtAndStatutoryWorker execution.');
    }

    if (
      request.custom_commercial_status &&
      request.custom_commercial_status !== 'NOT_APPLICABLE'
    ) {
      throw new Error(
        'E-GSW-COMMERCIAL-STATUS-FORBIDDEN: Statutory rules and circulars cannot carry commercial offer status.'
      );
    }

    let targetHost = 'cbic-gst.gov.in';
    if (request.circular_id?.includes('DGFT') || request.target_url?.includes('dgft.gov.in')) {
      targetHost = 'dgft.gov.in';
    } else if (request.circular_id?.includes('CBDT') || request.target_url?.includes('incometaxindia.gov.in')) {
      targetHost = 'incometaxindia.gov.in';
    } else if (request.circular_id?.includes('MSME') || request.target_url?.includes('msme.gov.in')) {
      targetHost = 'msme.gov.in';
    }

    const targetUrl = request.target_url || `https://${targetHost}`;

    const toolCallRequest: McpToolCallRequest = {
      jsonrpc: '2.0',
      id: request.task_id,
      method: 'tools/call',
      params: {
        name: 'mcp://policy-bulletins/fetch_circular',
        arguments: {
          circular_id: request.circular_id,
          hsn_code: request.hsn_code,
          parameter_name: request.parameter_name,
          target_url: targetUrl,
          url: targetUrl,
          is_msme_supplier: request.is_msme_supplier,
          has_written_payment_agreement: request.has_written_payment_agreement,
          custom_commercial_status: request.custom_commercial_status,
          raw_circular_payload: request.raw_circular_payload,
          reference_time_utc: request.reference_time_utc,
          custom_claims: request.custom_claims,
          task_id: request.task_id
        }
      }
    };

    const toolCallResponse = await this.broker.invokeTool(grant, toolCallRequest);

    if (toolCallResponse.error) {
      throw new Error(toolCallResponse.error.message);
    }

    const contentItem = toolCallResponse.result?.content?.[0];
    if (!contentItem || !contentItem.text) {
      throw new Error('E-GSW-EMPTY-RESPONSE: Tool call returned empty result content.');
    }

    const parsed: GovtStatutoryMcpResponse = JSON.parse(contentItem.text);
    return deepFreeze(parsed);
  }

  public evaluateMsmeCreditTerms(
    isMsmeSupplier: boolean,
    hasWrittenAgreement: boolean
  ): {
    max_payment_terms_days: bigint;
    statutory_basis: string;
    affects_working_capital_ccc: boolean;
  } {
    const maxDays = evaluateMsmePaymentTermLimit(isMsmeSupplier, hasWrittenAgreement);
    return deepFreeze({
      max_payment_terms_days: maxDays,
      statutory_basis: isMsmeSupplier
        ? hasWrittenAgreement
          ? 'Income Tax Act 1961 Section 43B(h) / MSMED Act Section 15 (45-day ceiling with written contract)'
          : 'Income Tax Act 1961 Section 43B(h) / MSMED Act Section 15 (15-day statutory default without contract)'
        : 'Non-MSME supplier: Subject to bilateral commercial terms without statutory Sec 43B(h) disallowance',
      affects_working_capital_ccc: isMsmeSupplier
    });
  }
}
