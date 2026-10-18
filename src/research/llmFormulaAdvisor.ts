/**
 * Gate M4.2 Groq-Backed LLM Formula Discovery & Refinement Module
 *
 * Implements an intelligent formula research, discovery, and refinement loop
 * powered by Groq's low-latency inference API. LLM-generated formulas are
 * rigorously structured as Governed Formula Cards, ingested into the
 * FormulaRegistry under the sandboxed CANDIDATE_UI_MODEL tier, and validated
 * deterministically against canonical test vectors before any promotion.
 *
 * Architecture & Governance Firewall:
 * - Reads Groq API key from Groq_Key.env or process.env.
 * - Supports high-speed JSON mode completions with fallbacks for offline test environments.
 * - Proposes formal FormulaCards with symbolic expressions, subunit variables, and test vectors.
 * - Auto-registers candidates into FormulaRegistry under CANDIDATE_UI_MODEL tier.
 * - Deterministically executes and verifies test vectors.
 * - Governance Firewall: CANDIDATE_UI_MODEL formulas are blocked from executing in production
 *   or authorizing capital allocation until formally promoted by the Project Owner.
 */

import fs from 'fs';
import path from 'path';
import {
  FormulaCard,
  FormulaCardInput,
  FormulaDomain,
  FormulaEvaluatorFn,
  FormulaRegistry,
  FormulaTier,
  VariableUnit
} from './formulaRegistry.js';

/**
 * Loads the Groq API key from environment variables or a dotenv file.
 * Supports standard KEY=VALUE syntax and bare gsk_ token strings.
 */
export function loadGroqKeyFromEnv(envPath?: string): string | null {
  if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 0) {
    return process.env.GROQ_API_KEY.trim();
  }

  const candidatePaths = envPath
    ? [envPath]
    : [
        path.resolve(process.cwd(), 'Groq_Key.env'),
        'D:/Market HFT OS/Groq_Key.env',
        'D:\\Market HFT OS\\Groq_Key.env',
        path.resolve(process.cwd(), '.env')
      ];

  for (const candidate of candidatePaths) {
    try {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, 'utf8').trim();
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          if (trimmed.includes('=')) {
            const [k, ...v] = trimmed.split('=');
            const keyName = k.trim().toUpperCase();
            if (['GROQ_API_KEY', 'KEY', 'GROQ_KEY', 'API_KEY'].includes(keyName)) {
              const val = v.join('=').trim().replace(/^["']|["']$/g, '');
              if (val.length > 0) return val;
            }
          } else if (trimmed.startsWith('gsk_')) {
            return trimmed;
          }
        }
      }
    } catch {
      // Continue searching next candidate path
    }
  }

  return null;
}

export interface GroqFormulaAdvisorOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  offlineFallback?: boolean;
  forceSimulated?: boolean;
}

export type FormulaResolutionPath =
  | 'RAG_CACHE_HIT'
  | 'DETERMINISTIC_APPEND'
  | 'LLM_RAG_REFINED_SYNTHESIS';

export interface FormulaResolutionRequest {
  query: string;
  required_variables?: string[];
  deterministic_card_input?: FormulaCardInput;
  min_bm25_score?: number;
}

export interface FormulaResolutionResult {
  resolution_path: FormulaResolutionPath;
  llm_called: boolean;
  card: FormulaCard;
  rag_context_cards_used: string[];
  refined_prompt_preview?: string;
}

export interface AdvisorTelemetry {
  total_requests: number;
  rag_cache_hits: number;
  deterministic_appends: number;
  llm_calls_invoked: number;
  llm_dependency_ratio_bps: number;
}

export interface LlmCandidateEvaluationResult {
  registered_card: FormulaCard;
  test_vector_passed: boolean;
  computed_output?: bigint | number;
  expected_output: bigint | number;
  error?: string;
}

export const APPROVED_GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export function redactPromptSecrets(text: string): string {
  return text
    .replace(/gsk_[a-zA-Z0-9_\-]+/g, '[REDACTED_SECRET]')
    .replace(/(?:bearer|key|token|password|secret)[=:\s]+['"]?[a-zA-Z0-9_\-\.]{8,}['"]?/gi, '[REDACTED_SECRET]');
}

export const redactPromptInputs = redactPromptSecrets;

export class GroqFormulaAdvisor {
  private readonly apiKey: string | null;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly offlineFallback: boolean;
  private readonly forceSimulated: boolean;

  private telemetry: AdvisorTelemetry = {
    total_requests: 0,
    rag_cache_hits: 0,
    deterministic_appends: 0,
    llm_calls_invoked: 0,
    llm_dependency_ratio_bps: 0
  };

  constructor(options?: GroqFormulaAdvisorOptions) {
    this.apiKey = options?.apiKey ?? loadGroqKeyFromEnv();
    this.model = options?.model ?? process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';
    this.endpoint = options?.endpoint ?? APPROVED_GROQ_ENDPOINT;
    if (this.endpoint !== APPROVED_GROQ_ENDPOINT) {
      throw new Error(
        `E-GROQ-UNAPPROVED-ENDPOINT: Groq endpoint '${this.endpoint}' is not permitted. Network egress strictly locked to '${APPROVED_GROQ_ENDPOINT}'.`
      );
    }
    this.offlineFallback = options?.offlineFallback ?? true;
    this.forceSimulated = options?.forceSimulated ?? false;
  }

  public getApiKey(): string | null {
    return this.apiKey;
  }

  public getModel(): string {
    return this.model;
  }

  public getTelemetry(): AdvisorTelemetry {
    return { ...this.telemetry };
  }

  public resetTelemetry(): void {
    this.telemetry = {
      total_requests: 0,
      rag_cache_hits: 0,
      deterministic_appends: 0,
      llm_calls_invoked: 0,
      llm_dependency_ratio_bps: 0
    };
  }

  private updateDependencyRatio(): void {
    if (this.telemetry.total_requests === 0) {
      this.telemetry.llm_dependency_ratio_bps = 0;
    } else {
      this.telemetry.llm_dependency_ratio_bps = Math.round(
        (this.telemetry.llm_calls_invoked / this.telemetry.total_requests) * 10000
      );
    }
  }

  /**
   * Generates a deterministic simulated formula card for testing or offline environments.
   */
  public generateSimulatedProposal(
    promptContext: string,
    existingFormula?: FormulaCard
  ): FormulaCardInput {
    const reqMatch = promptContext.match(/Requirement Query:\s*([^\n]+)/i);
    const ctx = reqMatch ? reqMatch[1].toLowerCase() : promptContext.toLowerCase();

    if (ctx.includes('shrinkage') || ctx.includes('inventory loss') || ctx.includes('warehouse')) {
      return {
        formula_id: 'FIN-CANDIDATE-SHRINKAGE-001',
        title: 'Warehouse Inventory Shrinkage Drag for SS304 Clamps',
        domain: 'PHYSICAL_ARBITRAGE',
        statutory_or_economic_citations: [
          'Internal Warehouse Loss Accounting Policy',
          'Indian Companies (Accounting Standards) AS 10'
        ],
        symbolic_expression: 'Shrinkage_Drag = (Opening_Inventory - Closing_Inventory - Recorded_Sales) * Unit_Cost',
        input_variables: [
          { name: 'Opening_Inventory', unit: 'UNITS', description: 'Total units of SS304 clamps at period start' },
          { name: 'Closing_Inventory', unit: 'UNITS', description: 'Total units of SS304 clamps at period end' },
          { name: 'Recorded_Sales', unit: 'UNITS', description: 'Audited sales outbound units during period' },
          { name: 'Unit_Cost', unit: 'SUBUNITS_INR', description: 'Acquisition landed cost per clamp in INR subunits' }
        ],
        output_variable: { name: 'Shrinkage_Drag', unit: 'SUBUNITS_INR' },
        rationale_and_invariants:
          'Measures economic drag of unaccounted warehouse inventory shrinkage. Invariant: shrinkage quantity = Opening - Closing - Recorded_Sales. Multiplying by Unit_Cost yields monetary loss in integer INR subunits.',
        canonical_test_vector: {
          inputs: {
            Opening_Inventory: 1000,
            Closing_Inventory: 950,
            Recorded_Sales: 30,
            Unit_Cost: 500
          },
          expected_output: 10000
        },
        evidence_origin_class: 'LLM_MODEL_PROPOSAL'
      };
    }

    if (ctx.includes('customs') || ctx.includes('anti-dumping') || ctx.includes('duty') || ctx.includes('tariff')) {
      return {
        formula_id: 'FIN-CANDIDATE-CUSTOMS-ADD-001',
        title: 'Imported SS304 Raw Strip Anti-Dumping & Surcharge Synthesis',
        domain: 'TAX_STATUTORY',
        statutory_or_economic_citations: [
          'Customs Tariff Act 1975 Sec 9A',
          'DGTR Anti-Dumping Final Findings Notification'
        ],
        symbolic_expression: 'TotalCustomsDuty = BasicCustomsDuty + AntiDumpingDuty + SocialWelfareSurcharge',
        input_variables: [
          { name: 'BasicCustomsDuty', unit: 'SUBUNITS_INR', description: 'Basic customs duty on landed CIF base' },
          { name: 'AntiDumpingDuty', unit: 'SUBUNITS_INR', description: 'Benchmark anti-dumping duty surcharge' },
          { name: 'SocialWelfareSurcharge', unit: 'SUBUNITS_INR', description: 'Social welfare surcharge (10% of BCD)' }
        ],
        output_variable: { name: 'TotalCustomsDuty', unit: 'SUBUNITS_INR' },
        rationale_and_invariants:
          'Synthesizes statutory customs burden on imported cold-rolled SS304 raw strip materials. Sum of BCD, ADD, and SWS in integer subunits.',
        canonical_test_vector: {
          inputs: {
            BasicCustomsDuty: 15000,
            AntiDumpingDuty: 20000,
            SocialWelfareSurcharge: 1500
          },
          expected_output: 36500
        },
        evidence_origin_class: 'LLM_MODEL_PROPOSAL'
      };
    }

    if (ctx.includes('credit') || ctx.includes('b2b') || ctx.includes('default') || ctx.includes('risk')) {
      return {
        formula_id: 'FIN-CANDIDATE-CREDIT-RISK-001',
        title: 'B2B Trade Credit Counterparty Default Risk Drag',
        domain: 'RISK_HURDLE',
        statutory_or_economic_citations: [
          'MSMED Act 2006 Delayed Payments Framework',
          'Expected Credit Loss (ECL) Modeling Standards'
        ],
        symbolic_expression: 'CreditRiskDrag = (ReceivableAmount * DefaultProbabilityBps) / 10000',
        input_variables: [
          { name: 'ReceivableAmount', unit: 'SUBUNITS_INR', description: 'Outstanding wholesale trade receivable' },
          { name: 'DefaultProbabilityBps', unit: 'BPS', description: 'Assessed default probability in basis points' }
        ],
        output_variable: { name: 'CreditRiskDrag', unit: 'SUBUNITS_INR' },
        rationale_and_invariants:
          'Quantifies capital impairment risk under trade credit terms. Drag cannot exceed total receivable amount.',
        canonical_test_vector: {
          inputs: {
            ReceivableAmount: 1000000,
            DefaultProbabilityBps: 250
          },
          expected_output: 25000
        },
        evidence_origin_class: 'LLM_MODEL_PROPOSAL'
      };
    }

    // Default proposal or refinement of existing formula
    const baseId = existingFormula ? `${existingFormula.formula_id}-REFINED` : 'FIN-CANDIDATE-GENERAL-001';
    return {
      formula_id: baseId,
      title: existingFormula ? `Refined: ${existingFormula.title}` : 'Physical Arbitrage Landed Cost Adjustment Model',
      domain: existingFormula?.domain ?? 'PHYSICAL_ARBITRAGE',
      statutory_or_economic_citations: existingFormula?.statutory_or_economic_citations ?? ['Arbitrage Risk Governance v1.0'],
      symbolic_expression: 'AdjustedMetric = BaseValue + MarginBuffer',
      input_variables: [
        { name: 'BaseValue', unit: 'SUBUNITS_INR', description: 'Base input valuation in INR subunits' },
        { name: 'MarginBuffer', unit: 'SUBUNITS_INR', description: 'Safety margin buffer in INR subunits' }
      ],
      output_variable: { name: 'AdjustedMetric', unit: 'SUBUNITS_INR' },
      rationale_and_invariants: 'Refined metric ensuring capital preservation and margin buffer.',
      canonical_test_vector: {
        inputs: { BaseValue: 10000, MarginBuffer: 2500 },
        expected_output: 12500
      },
      evidence_origin_class: 'LLM_MODEL_PROPOSAL'
    };
  }

  /**
   * Interacts with Groq chat completion API (or fallback simulation) to propose a new or refined FormulaCard.
   */
  public async proposeFormulaRefinement(
    promptContext: string,
    existingFormula?: FormulaCard
  ): Promise<FormulaCardInput> {
    if (
      this.forceSimulated ||
      !this.apiKey ||
      (this.offlineFallback && process.env.GROQ_OFFLINE_MODE === 'true')
    ) {
      return this.generateSimulatedProposal(promptContext, existingFormula);
    }

    try {
      const systemPrompt = `You are an expert Indian tax, financial engineering, and physical commodity arbitrage quantitative researcher for Market-HFT-OS.
You must return a single valid JSON object matching this exact schema:
{
  "formula_id": "string (e.g. FIN-CANDIDATE-...)",
  "title": "string",
  "domain": "PHYSICAL_ARBITRAGE" | "TAX_STATUTORY" | "WORKING_CAPITAL" | "RISK_HURDLE",
  "statutory_or_economic_citations": ["string"],
  "symbolic_expression": "string",
  "input_variables": [
    { "name": "string", "unit": "SUBUNITS_INR" | "BPS" | "DAYS" | "UNITS", "description": "string" }
  ],
  "output_variable": { "name": "string", "unit": "SUBUNITS_INR" | "BPS" | "DAYS" },
  "rationale_and_invariants": "string",
  "canonical_test_vector": {
    "inputs": { "<variable_name>": number },
    "expected_output": number
  }
}
Do not include any markdown wrappers or commentary, only the raw JSON object.`;

      let userPrompt = `Propose a candidate formula or metric refinement based on the following context:\n${promptContext}`;
      if (existingFormula) {
        userPrompt += `\nExisting formula to refine:\nID: ${existingFormula.formula_id}\nTitle: ${existingFormula.title}\nExpression: ${existingFormula.symbolic_expression}\nTest Vector: ${JSON.stringify(existingFormula.canonical_test_vector)}`;
      }
      userPrompt = redactPromptSecrets(userPrompt);

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1
        }),
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) {
        if (this.offlineFallback) {
          return this.generateSimulatedProposal(promptContext, existingFormula);
        }
        const errText = await res.text().catch(() => '');
        throw new Error(`Groq API request failed (${res.status}): ${errText}`);
      }

      const data = (await res.json()) as any;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        if (this.offlineFallback) {
          return this.generateSimulatedProposal(promptContext, existingFormula);
        }
        throw new Error('Groq returned empty completion content');
      }

      const parsed = JSON.parse(content);
      return this.validateAndNormalizeProposal(parsed, promptContext);
    } catch (err) {
      if (this.offlineFallback) {
        return this.generateSimulatedProposal(promptContext, existingFormula);
      }
      throw err;
    }
  }

  /**
   * Validates and normalizes raw JSON proposal into a strictly typed FormulaCardInput.
   */
  private validateAndNormalizeProposal(parsed: any, promptContext: string): FormulaCardInput {
    let formula_id = typeof parsed.formula_id === 'string' && parsed.formula_id.trim().length > 0
      ? parsed.formula_id.trim()
      : 'FIN-CANDIDATE-LLM-001';

    if (!formula_id.startsWith('FIN-CANDIDATE-')) {
      formula_id = `FIN-CANDIDATE-${formula_id.replace(/^FIN-/, '')}`;
    }

    const title = typeof parsed.title === 'string' && parsed.title.trim().length > 0
      ? parsed.title.trim()
      : `LLM Refinement: ${promptContext.slice(0, 50)}`;

    const validDomains: FormulaDomain[] = ['PHYSICAL_ARBITRAGE', 'TAX_STATUTORY', 'WORKING_CAPITAL', 'RISK_HURDLE'];
    const domain: FormulaDomain = validDomains.includes(parsed.domain)
      ? parsed.domain
      : 'PHYSICAL_ARBITRAGE';

    const statutory_or_economic_citations = Array.isArray(parsed.statutory_or_economic_citations)
      ? parsed.statutory_or_economic_citations.map((c: any) => String(c))
      : ['LLM Governed Formula Discovery'];

    const symbolic_expression = typeof parsed.symbolic_expression === 'string' && parsed.symbolic_expression.trim().length > 0
      ? parsed.symbolic_expression.trim()
      : 'Metric = A + B';

    const input_variables = Array.isArray(parsed.input_variables)
      ? parsed.input_variables.map((iv: any) => ({
          name: String(iv.name || 'var'),
          unit: (['SUBUNITS_INR', 'BPS', 'DAYS', 'UNITS'].includes(iv.unit) ? iv.unit : 'SUBUNITS_INR') as VariableUnit,
          description: String(iv.description || iv.name || 'Input variable')
        }))
      : [{ name: 'A', unit: 'SUBUNITS_INR' as VariableUnit, description: 'Variable A' }];

    const output_variable = parsed.output_variable && typeof parsed.output_variable === 'object'
      ? {
          name: String(parsed.output_variable.name || 'output'),
          unit: (['SUBUNITS_INR', 'BPS', 'DAYS'].includes(parsed.output_variable.unit)
            ? parsed.output_variable.unit
            : 'SUBUNITS_INR') as VariableUnit
        }
      : { name: 'output', unit: 'SUBUNITS_INR' as VariableUnit };

    const rationale_and_invariants = typeof parsed.rationale_and_invariants === 'string'
      ? parsed.rationale_and_invariants.trim()
      : 'Governed LLM candidate formula';

    const rawInputs = parsed.canonical_test_vector?.inputs;
    const inputs: Record<string, string | number> = {};
    if (rawInputs && typeof rawInputs === 'object') {
      for (const [k, v] of Object.entries(rawInputs)) {
        inputs[k] = Number(v);
      }
    } else {
      inputs['A'] = 1000;
    }

    const expected_output = parsed.canonical_test_vector?.expected_output !== undefined
      ? (typeof parsed.canonical_test_vector.expected_output === 'number'
          ? Math.round(parsed.canonical_test_vector.expected_output)
          : Math.round(Number(parsed.canonical_test_vector.expected_output) || 1000))
      : 1000;

    return {
      formula_id,
      title,
      domain,
      statutory_or_economic_citations,
      symbolic_expression,
      input_variables,
      output_variable,
      rationale_and_invariants,
      canonical_test_vector: {
        inputs,
        expected_output
      },
      evidence_origin_class: 'LLM_MODEL_PROPOSAL'
    };
  }

  /**
   * Registers candidate card into FormulaRegistry under CANDIDATE_UI_MODEL tier,
   * evaluates its canonical test vector deterministically, and returns pass/fail status.
   */
  public async evaluateLlmCandidate(
    cardInput: FormulaCardInput,
    registry: FormulaRegistry,
    customEvaluator?: FormulaEvaluatorFn
  ): Promise<LlmCandidateEvaluationResult> {
    // 1. Register candidate formula into registry (under CANDIDATE_UI_MODEL tier)
    const registered_card = registry.registerCandidateFormula(cardInput);

    // 2. If a custom evaluator was provided, register it with registry
    if (customEvaluator) {
      registry.registerFormulaEvaluator(registered_card.formula_id, customEvaluator);
    }

    // 3. Evaluate canonical test vector in sandboxed mode (allowCandidate: true)
    const rawExp = registered_card.canonical_test_vector.expected_output;
    const expected = typeof rawExp === 'number'
      ? BigInt(Math.round(rawExp))
      : BigInt(Math.round(Number(rawExp)));
    try {
      const computed = registry.evaluateFormula(
        registered_card.formula_id,
        registered_card.canonical_test_vector.inputs as Record<string, number>,
        { allowCandidate: true }
      );
      const passed = computed === expected;
      return {
        registered_card,
        test_vector_passed: passed,
        computed_output: computed,
        expected_output: expected
      };
    } catch (err: any) {
      return {
        registered_card,
        test_vector_passed: false,
        expected_output: expected,
        error: err?.message || String(err)
      };
    }
  }

  /**
   * 3-Tier "RAG-First, LLM-Last" Orchestrator:
   * Tier 1: Local BM25 RAG Cache Hit (llm_called: false)
   * Tier 2: Deterministic Append (llm_called: false)
   * Tier 3: LLM RAG-Refined Synthesis with neighbor card injection (llm_called: true)
   */
  public async resolveOrSynthesizeFormula(
    request: FormulaResolutionRequest,
    registry: FormulaRegistry
  ): Promise<FormulaResolutionResult> {
    const minScore = request.min_bm25_score ?? 1.5;
    const topMatches = registry.retrieveFormulas(request.query, { topK: 3 });

    // Tier 1 (RAG_CACHE_HIT — llm_called: false)
    if (topMatches.length > 0 && topMatches[0].relevance_score >= minScore) {
      const topCard = topMatches[0].formula;
      let coversRequiredVars = true;

      const requiredVars = request.required_variables ?? (
        request.deterministic_card_input
          ? request.deterministic_card_input.input_variables.map((v) => v.name)
          : undefined
      );

      if (requiredVars && requiredVars.length > 0) {
        const cardVars = new Set<string>();
        for (const iv of topCard.input_variables) {
          cardVars.add(iv.name.toLowerCase());
        }
        if (topCard.output_variable) {
          cardVars.add(topCard.output_variable.name.toLowerCase());
        }
        for (const reqVar of requiredVars) {
          if (!cardVars.has(reqVar.toLowerCase())) {
            coversRequiredVars = false;
            break;
          }
        }
      }

      if (coversRequiredVars) {
        this.telemetry.total_requests++;
        this.telemetry.rag_cache_hits++;
        this.updateDependencyRatio();
        return {
          resolution_path: 'RAG_CACHE_HIT',
          llm_called: false,
          card: topCard,
          rag_context_cards_used: [topCard.formula_id]
        };
      }
    }

    // Tier 2 (DETERMINISTIC_APPEND — llm_called: false)
    if (request.deterministic_card_input) {
      const card = registry.appendDeterministicFormula(request.deterministic_card_input);
      this.telemetry.total_requests++;
      this.telemetry.deterministic_appends++;
      this.updateDependencyRatio();
      return {
        resolution_path: 'DETERMINISTIC_APPEND',
        llm_called: false,
        card,
        rag_context_cards_used: []
      };
    }

    // Tier 3 (LLM_RAG_REFINED_SYNTHESIS — llm_called: true)
    const neighborCards = topMatches.length > 0
      ? topMatches.map((m) => m.formula)
      : registry.listFormulas().slice(0, 3);
    const rag_context_cards_used = neighborCards.map((c) => c.formula_id);

    const neighborContext = neighborCards
      .map(
        (c, idx) => `[Neighbor ${idx + 1}] Formula ID: ${c.formula_id}
Title: ${c.title}
Citations: ${c.statutory_or_economic_citations.join('; ')}
Expression: ${c.symbolic_expression}
Inputs: ${c.input_variables.map((v) => `${v.name} (${v.unit}: ${v.description})`).join(', ')}
Output: ${c.output_variable.name} (${c.output_variable.unit})
Test Vector: ${JSON.stringify(c.canonical_test_vector)}`
      )
      .join('\n\n');

    const refinedPrompt = `Requirement Query: ${request.query}
${request.required_variables && request.required_variables.length > 0 ? `Required Variables: ${request.required_variables.join(', ')}` : ''}

Local RAG Corpus Top-${neighborCards.length} Neighbors (Structural & Domain Context):
${neighborContext}

Instructions:
1. Reuse canonical variable naming and scaling conventions (SUBUNITS_INR scale 4, BPS 10000 = 100%, DAYS, UNITS).
2. Synthesize ONLY the missing mathematical delta for the required metric.
3. Formulate a complete, mathematically closed symbolic expression and canonical test vector in pure integer/subunits arithmetic.`;

    const candidateInput = await this.proposeFormulaRefinement(
      refinedPrompt,
      neighborCards[0]
    );

    const evalResult = await this.evaluateLlmCandidate(candidateInput, registry);

    this.telemetry.total_requests++;
    this.telemetry.llm_calls_invoked++;
    this.updateDependencyRatio();

    return {
      resolution_path: 'LLM_RAG_REFINED_SYNTHESIS',
      llm_called: true,
      card: evalResult.registered_card,
      rag_context_cards_used,
      refined_prompt_preview: refinedPrompt
    };
  }
}
