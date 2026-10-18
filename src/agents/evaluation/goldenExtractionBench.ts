/**
 * Market HFT OS — Golden Extraction Bench (Decision OD-18 / Gate M6.8)
 *
 * Implements an Adala-inspired deterministic evaluation and certification harness
 * for specialist micro-agent extraction workers. Evaluates field-level precision,
 * recall, and exact match against curated golden ground-truth fixtures using pure
 * BigInt basis point arithmetic (10000n scale = 100.00%).
 */

import { sha256 } from '../../canonical/crypto.js';
import { canonicalizeJCS } from '../../canonical/jcs.js';
import { sanitizeForJcs } from '../m6AgentFramework.js';
import {
  SourceCaptureWorker,
  SourceCaptureMcpRequest,
  SourceCaptureMcpResponse,
  SourceCaptureFixtureRegistry
} from '../workers/sourceCaptureWorker.js';

export interface GoldenGroundTruthField {
  readonly expected_value: string | bigint | number;
  readonly unit?: string;
  readonly is_mandatory?: boolean;
}

export interface GoldenBenchmarkCase {
  readonly fixture_id: string;
  readonly source_profile: 'AMAZON_IN_PRODUCT_LISTING' | 'INDIAMART_SUPPLIER_LISTING' | 'HOWRAH_B2B_DISTRIBUTOR_CATALOG';
  readonly target_url: string;
  readonly raw_html?: string;
  readonly target_batch_quantity?: number;
  readonly extraction_rules?: readonly any[];
  readonly ground_truth_fields: Record<string, GoldenGroundTruthField>;
}

export interface FieldEvaluationResult {
  readonly field_name: string;
  readonly expected: string;
  readonly observed?: string;
  readonly matched: boolean;
  readonly status: 'TRUE_POSITIVE' | 'FALSE_POSITIVE' | 'FALSE_NEGATIVE';
}

export interface CaseBenchmarkResult {
  readonly fixture_id: string;
  readonly passed: boolean;
  readonly total_fields: number;
  readonly matched_fields: number;
  readonly field_results: readonly FieldEvaluationResult[];
}

export interface BenchCertificationSummary {
  readonly benchmark_name: string;
  readonly total_cases: number;
  readonly passed_cases: number;
  readonly total_fields_evaluated: number;
  readonly true_positives: number;
  readonly false_positives: number;
  readonly false_negatives: number;
  readonly precision_bps: bigint;
  readonly recall_bps: bigint;
  readonly exact_match_rate_bps: bigint;
  readonly certified_pass: boolean;
  readonly evaluation_timestamp_utc: string;
  readonly benchmark_digest_sha256: string;
}

const amazonCase: GoldenBenchmarkCase = {
  fixture_id: 'amazon_in_b09xyz1234',
  source_profile: 'AMAZON_IN_PRODUCT_LISTING',
  target_url: 'https://www.amazon.in/dp/B09XYZ1234',
  ground_truth_fields: {
    gross_price_inr: { expected_value: '1050000', unit: 'SUBUNITS_INR', is_mandatory: true },
    pack_quantity: { expected_value: '10', unit: 'UNITS', is_mandatory: true }
  }
};

const howrahCase: GoldenBenchmarkCase = {
  fixture_id: 'howrah_ss304_supplier',
  source_profile: 'HOWRAH_B2B_DISTRIBUTOR_CATALOG',
  target_url: 'https://dir.indiamart.com/supplier/howrah-ss304-clamp',
  ground_truth_fields: {
    gross_price_inr: { expected_value: '250000', unit: 'SUBUNITS_INR', is_mandatory: true },
    moq_units: { expected_value: '500', unit: 'UNITS', is_mandatory: true }
  }
};

const indiamartCase: GoldenBenchmarkCase = {
  fixture_id: 'indiamart_tiered_moq',
  source_profile: 'INDIAMART_SUPPLIER_LISTING',
  target_url: 'https://dir.indiamart.com/supplier/ss304-bracket',
  target_batch_quantity: 300,
  extraction_rules: [
    {
      field_name: 'tiered_unit_price_inr',
      selector: '#indiamart-tier-pricing',
      expected_type: 'TIERED_SUBUNITS_INR',
      is_mandatory: true
    }
  ],
  ground_truth_fields: {
    tiered_unit_price_inr: { expected_value: '285000', unit: 'SUBUNITS_INR', is_mandatory: true }
  }
};

export class GoldenExtractionBench {
  public static readonly DEFAULT_GOLDEN_CASES: readonly GoldenBenchmarkCase[] = Object.freeze([
    amazonCase,
    howrahCase,
    indiamartCase
  ]);

  /**
   * Executes certification evaluation of a SourceCaptureWorker against golden ground-truth cases.
   * Requires 10000n bps precision, recall, and exact match to achieve certified_pass = true.
   */
  public static async evaluateSourceCaptureWorker(
    worker: SourceCaptureWorker,
    cases: readonly GoldenBenchmarkCase[] = GoldenExtractionBench.DEFAULT_GOLDEN_CASES
  ): Promise<BenchCertificationSummary> {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let totalFieldsEvaluated = 0;
    let passedCases = 0;

    for (const testCase of cases) {
      const request: SourceCaptureMcpRequest = {
        task_id: `bench-${testCase.fixture_id}-${Date.now()}`,
        worker_id: 'worker:source-capture:v1',
        target_url: testCase.target_url,
        source_profile: testCase.source_profile,
        execution_mode: 'RECORDED_FIXTURE_REPLAY',
        fixture_id: testCase.fixture_id,
        raw_html_payload: testCase.raw_html,
        target_batch_quantity: testCase.target_batch_quantity,
        extraction_rules: testCase.extraction_rules,
        requested_at_utc: '2026-10-18T12:00:00.000Z'
      };

      const captureResponse = await worker.captureAndExtract(request);
      const extracted = captureResponse.extracted_fields;

      let caseMatched = true;

      for (const [fieldName, gt] of Object.entries(testCase.ground_truth_fields)) {
        totalFieldsEvaluated++;
        const fieldOutcome = extracted[fieldName];
        const expectedStr = String(gt.expected_value);

        if (!fieldOutcome || fieldOutcome.status !== 'EXTRACTED' || fieldOutcome.normalized_value === undefined) {
          falseNegatives++;
          caseMatched = false;
        } else {
          const observedStr = String(fieldOutcome.normalized_value);
          if (observedStr === expectedStr) {
            truePositives++;
          } else {
            falsePositives++;
            caseMatched = false;
          }
        }
      }

      if (caseMatched) {
        passedCases++;
      }
    }

    const precisionBps =
      truePositives === 0 && falsePositives === 0
        ? 10000n
        : (BigInt(truePositives) * 10000n) / BigInt(truePositives + falsePositives);

    const recallBps =
      truePositives === 0 && falseNegatives === 0
        ? 10000n
        : (BigInt(truePositives) * 10000n) / BigInt(truePositives + falseNegatives);

    const exactMatchRateBps =
      cases.length === 0
        ? 10000n
        : (BigInt(passedCases) * 10000n) / BigInt(cases.length);

    const certifiedPass =
      precisionBps === 10000n &&
      recallBps === 10000n &&
      exactMatchRateBps === 10000n;

    const summaryPayload = {
      benchmark_name: 'GoldenExtractionBench::SourceCaptureWorker',
      total_cases: cases.length,
      passed_cases: passedCases,
      total_fields_evaluated: totalFieldsEvaluated,
      true_positives: truePositives,
      false_positives: falsePositives,
      false_negatives: falseNegatives,
      precision_bps: precisionBps.toString(),
      recall_bps: recallBps.toString(),
      exact_match_rate_bps: exactMatchRateBps.toString(),
      certified_pass: certifiedPass,
      evaluation_timestamp_utc: new Date().toISOString()
    };

    const digest = sha256(canonicalizeJCS(sanitizeForJcs(summaryPayload)));

    return Object.freeze({
      benchmark_name: summaryPayload.benchmark_name,
      total_cases: summaryPayload.total_cases,
      passed_cases: summaryPayload.passed_cases,
      total_fields_evaluated: summaryPayload.total_fields_evaluated,
      true_positives: summaryPayload.true_positives,
      false_positives: summaryPayload.false_positives,
      false_negatives: summaryPayload.false_negatives,
      precision_bps: precisionBps,
      recall_bps: recallBps,
      exact_match_rate_bps: exactMatchRateBps,
      certified_pass: certifiedPass,
      evaluation_timestamp_utc: summaryPayload.evaluation_timestamp_utc,
      benchmark_digest_sha256: digest
    });
  }
}
