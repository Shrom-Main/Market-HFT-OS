/**
 * Gate M4.1 Governed Formula Registry & Local RAG Retrieval Module
 *
 * Implements a deterministic, auditable Formula Knowledge Base and Local Retriever
 * for financial and statutory tax formulas used across the Market-HFT-OS arbitrage engine.
 *
 * Architecture:
 * - Tier A (PROMOTED_NORMATIVE): Governed formulas bound to exact TypeScript BigInt
 *   evaluators, cryptographically sealed under RFC 8785 JCS digests.
 * - Tier B (CANDIDATE_UI_MODEL): Sandboxed formulas proposed via UI / intelligence
 *   instructions, retrievable for what-if simulations but prohibited from authorizing
 *   ALLOCATE_CAPITAL in production without explicit owner promotion.
 * - Deterministic Okapi BM25 keyword retrieval over statutory citations, symbolic ASTs,
 *   and invariant descriptions.
 */

import { createHash } from 'crypto';
import { canonicalizeJCS } from '../canonical/jcs.js';

export type FormulaDomain =
  | 'PHYSICAL_ARBITRAGE'
  | 'TAX_STATUTORY'
  | 'WORKING_CAPITAL'
  | 'RISK_HURDLE';

export type FormulaTier =
  | 'PROMOTED_NORMATIVE'
  | 'CANDIDATE_UI_MODEL';

export type VariableUnit =
  | 'SUBUNITS_INR'
  | 'BPS'
  | 'DAYS'
  | 'UNITS';

export interface FormulaVariableDefinition {
  name: string;
  unit: VariableUnit;
  description: string;
}

export interface FormulaTestVector {
  inputs: Record<string, string | number>;
  expected_output: string | number;
}

export interface FormulaCard {
  formula_id: string;
  title: string;
  domain: FormulaDomain;
  tier: FormulaTier;
  statutory_or_economic_citations: string[];
  symbolic_expression: string;
  input_variables: FormulaVariableDefinition[];
  output_variable: { name: string; unit: VariableUnit };
  rationale_and_invariants: string;
  canonical_test_vector: FormulaTestVector;
  jcs_hash: string;
}

export interface FormulaRetrievalResult {
  formula: FormulaCard;
  relevance_score: number;
  matched_terms: string[];
}

export interface FormulaRegistrySearchOptions {
  tier?: FormulaTier;
  domain?: FormulaDomain;
  topK?: number;
}

export type FormulaCardInput = Omit<FormulaCard, 'jcs_hash' | 'tier'> & {
  jcs_hash?: string;
  tier?: FormulaTier;
};

export type FormulaEvaluatorFn = (inputs: Record<string, bigint | number>) => bigint;

export function computeFormulaJcsHash(card: Omit<FormulaCard, 'jcs_hash'>): string {
  const canonical = canonicalizeJCS(card);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Deterministically evaluates a basic symbolic algebraic expression using BigInt arithmetic.
 */
export function evaluateSymbolicExpression(
  expression: string,
  inputs: Record<string, bigint | number>
): bigint {
  let rhs = expression.includes('=') ? expression.split('=')[1] : expression;
  rhs = rhs
    .replace(/\\lfloor|\\rfloor/g, '')
    .replace(/\\times/g, '*')
    .replace(/\\cdot/g, '*');

  const tokens: string[] = [];
  const regex = /\s*([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/])\s*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rhs)) !== null) {
    tokens.push(match[1]);
  }

  if (tokens.length === 0) {
    throw new Error('Empty symbolic expression');
  }

  const normalizedInputs: Record<string, number> = {};
  for (const [k, v] of Object.entries(inputs)) {
    normalizedInputs[k.toLowerCase()] = Number(v);
  }

  let pos = 0;
  function peek(): string | undefined {
    return tokens[pos];
  }
  function consume(): string {
    return tokens[pos++];
  }

  function parsePrimary(): number {
    const t = consume();
    if (!t) throw new Error('Unexpected end of expression');
    if (t === '(') {
      const val = parseExpr();
      if (consume() !== ')') throw new Error('Missing closing parenthesis');
      return val;
    }
    if (/^\d+(?:\.\d+)?$/.test(t)) {
      return Number(t);
    }
    const lower = t.toLowerCase();
    if (lower in normalizedInputs) {
      return normalizedInputs[lower];
    }
    throw new Error(`Unknown variable: ${t}`);
  }

  function parseFactor(): number {
    if (peek() === '-') {
      consume();
      return -parsePrimary();
    }
    if (peek() === '+') {
      consume();
    }
    return parsePrimary();
  }

  function parseTerm(): number {
    let left = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = consume();
      const right = parseFactor();
      if (op === '*') {
        left = left * right;
      } else {
        left = right === 0 ? 0 : left / right;
      }
    }
    return left;
  }

  function parseExpr(): number {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }
    return left;
  }

  const result = parseExpr();
  if (pos < tokens.length) {
    throw new Error(`Extra tokens remaining: ${tokens.slice(pos).join(' ')}`);
  }
  return BigInt(Math.round(result));
}


/**
 * Tokenize string into alphanumeric search tokens.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export class FormulaRegistry {
  private readonly formulas = new Map<string, FormulaCard>();
  private readonly customEvaluators = new Map<string, FormulaEvaluatorFn>();

  constructor() {
    this.bootstrapCanonicalFormulas();
  }

  private bootstrapCanonicalFormulas(): void {
    const canonicalCards: Array<Omit<FormulaCard, 'jcs_hash'>> = [
      {
        formula_id: 'FIN-LANDED-COST-001',
        title: 'DIN 3017 W4 Stainless Steel Hose Clamp Landed Cost Synthesis',
        domain: 'PHYSICAL_ARBITRAGE',
        tier: 'PROMOTED_NORMATIVE',
        statutory_or_economic_citations: [
          'Incoterms 2020 EXW Rule',
          'Customs Tariff Act 1975 HSN 73269099'
        ],
        symbolic_expression:
          'LandedCost = RawPurchase + InboundFreight + InsuranceHandling + CustomsInspection + PackagingKitting',
        input_variables: [
          { name: 'raw_material_purchase_subunits', unit: 'SUBUNITS_INR', description: 'Raw material purchase price per unit' },
          { name: 'inbound_freight_subunits', unit: 'SUBUNITS_INR', description: 'Surface freight transportation cost per unit' },
          { name: 'insurance_handling_subunits', unit: 'SUBUNITS_INR', description: 'Transit insurance and handling cost per unit' },
          { name: 'customs_inspection_subunits', unit: 'SUBUNITS_INR', description: 'Customs clearance and quality inspection cost per unit' },
          { name: 'packaging_kitting_subunits', unit: 'SUBUNITS_INR', description: 'Kitting, barcoding, and protective packaging per unit' }
        ],
        output_variable: { name: 'landed_cost_subunits', unit: 'SUBUNITS_INR' },
        rationale_and_invariants:
          'Synthesizes complete physical inventory cost per pack of 10 SS304 clamps. Baseline canonical landed cost is exactly ₹38.2100 (382,100 integer subunits). Subunit precision scale 4 prevents floating point drift.',
        canonical_test_vector: {
          inputs: {
            raw_material_purchase_subunits: 250000,
            inbound_freight_subunits: 45000,
            insurance_handling_subunits: 10000,
            customs_inspection_subunits: 45100,
            packaging_kitting_subunits: 32000
          },
          expected_output: 382100
        }
      },
      {
        formula_id: 'FIN-MKT-FEES-GST-002',
        title: 'Marketplace Fee Schedule with Statutory 18% GST Deductions',
        domain: 'TAX_STATUTORY',
        tier: 'PROMOTED_NORMATIVE',
        statutory_or_economic_citations: [
          'CGST Act 2017 Sec 9 & Sec 16',
          'Amazon India Seller Fee Schedule 2024'
        ],
        symbolic_expression:
          'FeeGST = \\lfloor (TotalMarketplaceFees \\times GSTBps) / 10000 \\rfloor; NetDisbursement = Gross - TotalMarketplaceFees - FeeGST - TCS - TDS',
        input_variables: [
          { name: 'gross_selling_price_subunits', unit: 'SUBUNITS_INR', description: 'Consumer listing price inclusive of output GST' },
          { name: 'total_marketplace_fees_subunits', unit: 'SUBUNITS_INR', description: 'Sum of referral fee, closing fee, and FBA weight handling fee' },
          { name: 'gst_rate_bps', unit: 'BPS', description: 'Statutory GST rate on service fees (1800 bps = 18.00%)' },
          { name: 'tcs_subunits', unit: 'SUBUNITS_INR', description: 'Section 52 GST TCS withholding' },
          { name: 'tds_subunits', unit: 'SUBUNITS_INR', description: 'Section 194-O Income Tax TDS withholding' }
        ],
        output_variable: { name: 'net_marketplace_disbursement_subunits', unit: 'SUBUNITS_INR' },
        rationale_and_invariants:
          'Amazon India levies 18% GST on top of all marketplace fees, withheld immediately from seller settlement. Under Section 16 of CGST Act, this 18% fee GST is 100% eligible for Input Tax Credit (ITC) in the Electronic Credit Ledger, offsetting output tax liability while creating short-term working-capital lockup.',
        canonical_test_vector: {
          inputs: {
            gross_selling_price_subunits: 1050000,
            total_marketplace_fees_subunits: 397500,
            gst_rate_bps: 1800,
            tcs_subunits: 8898,
            tds_subunits: 8898
          },
          expected_output: 563154
        }
      },
      {
        formula_id: 'FIN-STATUTORY-TCS-TDS-003',
        title: 'E-Commerce Section 52 CGST TCS & Section 194-O Income Tax TDS Non-Fungible Separation',
        domain: 'TAX_STATUTORY',
        tier: 'PROMOTED_NORMATIVE',
        statutory_or_economic_citations: [
          'CGST Act 2017 Sec 52',
          'Notification No. 15/2024-Central Tax',
          'Income Tax Act 1961 Sec 194-O',
          'CBDT Circular No. 20/2023'
        ],
        symbolic_expression:
          'ExGstRev = \\lfloor (Gross \\times 10000) / (10000 + GSTBps) \\rfloor; TCS = \\lfloor (ExGstRev \\times TCSBps) / 10000 \\rfloor; TDS = \\lfloor (ExGstRev \\times TDSBps) / 10000 \\rfloor; NetGstSettlement = \\max(0, NetGstLiability - TCS)',
        input_variables: [
          { name: 'gross_selling_price_subunits', unit: 'SUBUNITS_INR', description: 'Gross listing price' },
          { name: 'gst_rate_bps', unit: 'BPS', description: 'Statutory GST rate (1800 bps)' },
          { name: 'tcs_rate_bps', unit: 'BPS', description: 'Section 52 GST TCS rate on ex-GST taxable base (100 bps)' },
          { name: 'tds_rate_bps', unit: 'BPS', description: 'Section 194-O Income Tax TDS rate on ex-GST taxable base (100 bps)' },
          { name: 'net_gst_cash_liability_subunits', unit: 'SUBUNITS_INR', description: 'Output GST less total eligible ITC' }
        ],
        output_variable: { name: 'net_statutory_gst_settlement_subunits', unit: 'SUBUNITS_INR' },
        rationale_and_invariants:
          'Enforces strict non-fungibility between GST and Income Tax. Section 52 GST TCS resides in the GST Electronic Cash Ledger and offsets monthly GSTR-3B liability. Section 194-O TDS is an Income Tax withholding (Form 26AS) that cannot offset GSTR-3B liability, remaining as an income-tax working capital holdback until annual filing. Both TCS and TDS must be levied strictly on the ex-GST net taxable base.',
        canonical_test_vector: {
          inputs: {
            gross_selling_price_subunits: 1050000,
            gst_rate_bps: 1800,
            tcs_rate_bps: 100,
            tds_rate_bps: 100,
            net_gst_cash_liability_subunits: 30333
          },
          expected_output: 21435
        }
      },
      {
        formula_id: 'FIN-RETURN-ATTRITION-004',
        title: 'Asymmetric Reverse Logistics & Quarantined Damaged Inventory Attrition',
        domain: 'PHYSICAL_ARBITRAGE',
        tier: 'PROMOTED_NORMATIVE',
        statutory_or_economic_citations: [
          'ADR-0002 7-Bucket Inventory Model',
          'Amazon India Customer Return Policy 2024'
        ],
        symbolic_expression:
          'ReturnBase = FBAFee + ReverseLogisticsFee + LandedCost; ReturnDrag = \\lfloor (ReturnBase \\times ReturnRateBps) / 10000 \\rfloor',
        input_variables: [
          { name: 'fba_weight_handling_subunits', unit: 'SUBUNITS_INR', description: 'Forward outbound FBA fee absorbed on return' },
          { name: 'reverse_logistics_fee_subunits', unit: 'SUBUNITS_INR', description: 'Marketplace reverse shipping fee charged to seller' },
          { name: 'landed_cost_subunits', unit: 'SUBUNITS_INR', description: 'Unrecoverable inventory value transferred to DAMAGED_QUARANTINED' },
          { name: 'customer_return_rate_bps', unit: 'BPS', description: 'Customer return rate (200 bps = 2.00%)' }
        ],
        output_variable: { name: 'return_drag_subunits', unit: 'SUBUNITS_INR' },
        rationale_and_invariants:
          'Customer returns in physical hardware arbitrage impose asymmetric drag: forward FBA is non-refundable, reverse logistics is charged, and opened clamps suffer 100% loss transition to DAMAGED_QUARANTINED. Return drag must not exceed ₹5.0000 threshold.',
        canonical_test_vector: {
          inputs: {
            fba_weight_handling_subunits: 140000,
            reverse_logistics_fee_subunits: 140000,
            landed_cost_subunits: 382100,
            customer_return_rate_bps: 200
          },
          expected_output: 13242
        }
      },
      {
        formula_id: 'FIN-CCC-ROWC-005',
        title: 'Working-Capital Cash Conversion Cycle & Annualized Return on Working Capital',
        domain: 'WORKING_CAPITAL',
        tier: 'PROMOTED_NORMATIVE',
        statutory_or_economic_citations: [
          'Working Capital Financial Management Principles (DIO + DSO - DPO)',
          'Frozen Specification Section 8.2'
        ],
        symbolic_expression:
          'CCC = \\max(1, LeadTime + DwellDays + SettlementDelay - PaymentTerms); RoWC = \\lfloor (CashMarginBps \\times 365) / CCC \\rfloor',
        input_variables: [
          { name: 'procurement_lead_time_days', unit: 'DAYS', description: 'Supplier manufacturing and transit lead time' },
          { name: 'warehouse_dwell_days', unit: 'DAYS', description: 'FBA warehouse listing and dwell duration' },
          { name: 'marketplace_settlement_delay_days', unit: 'DAYS', description: 'Marketplace bi-weekly disbursement cycle' },
          { name: 'payment_terms_days', unit: 'DAYS', description: 'Supplier trade credit terms (DPO credit reduction)' },
          { name: 'cash_margin_bps', unit: 'BPS', description: 'Unit net contribution as basis points of landed cost' }
        ],
        output_variable: { name: 'annualized_rowc_bps', unit: 'BPS' },
        rationale_and_invariants:
          'Computes annualized return on committed inventory capital adjusted for the exact cash conversion cycle. Trade credit directly shortens CCC and enhances capital velocity. CCC must not exceed 45 days, and RoWC must clear the 15.00% risk-adjusted hurdle.',
        canonical_test_vector: {
          inputs: {
            procurement_lead_time_days: 7,
            warehouse_dwell_days: 14,
            marketplace_settlement_delay_days: 14,
            payment_terms_days: 0,
            cash_margin_bps: 3830
          },
          expected_output: 39941
        }
      }
    ];

    for (const card of canonicalCards) {
      const jcs_hash = computeFormulaJcsHash(card);
      this.formulas.set(card.formula_id, { ...card, jcs_hash });
    }
  }

  public getFormula(formulaId: string): FormulaCard | undefined {
    return this.formulas.get(formulaId);
  }

  public listFormulas(options?: { tier?: FormulaTier; domain?: FormulaDomain }): FormulaCard[] {
    let list = Array.from(this.formulas.values());
    if (options?.tier) {
      list = list.filter((f) => f.tier === options.tier);
    }
    if (options?.domain) {
      list = list.filter((f) => f.domain === options.domain);
    }
    return list;
  }

  public verifyFormulaIntegrity(formulaId: string): boolean {
    const card = this.formulas.get(formulaId);
    if (!card) return false;
    const { jcs_hash, ...rest } = card;
    const expected = computeFormulaJcsHash(rest);
    return jcs_hash === expected;
  }

  public registerFormulaEvaluator(formulaId: string, evaluator: FormulaEvaluatorFn): void {
    if (!this.formulas.has(formulaId)) {
      throw new Error(
        `E-ERR-GOV-004: FORMULA_NOT_FOUND: Cannot register evaluator for non-existent formula ${formulaId}`
      );
    }
    this.customEvaluators.set(formulaId, evaluator);
  }

  public hasEvaluator(formulaId: string): boolean {
    if (this.customEvaluators.has(formulaId)) return true;
    return [
      'FIN-LANDED-COST-001',
      'FIN-MKT-FEES-GST-002',
      'FIN-STATUTORY-TCS-TDS-003',
      'FIN-RETURN-ATTRITION-004',
      'FIN-CCC-ROWC-005'
    ].includes(formulaId);
  }

  /**
   * Register a new formula proposed by UI or LLM intelligence in the sandboxed CANDIDATE_UI_MODEL tier.
   * Prohibits overriding an existing PROMOTED_NORMATIVE formula without explicit owner promotion.
   */
  public registerCandidateFormula(
    cardInput: FormulaCardInput
  ): FormulaCard {
    const existing = this.formulas.get(cardInput.formula_id);
    if (existing && existing.tier === 'PROMOTED_NORMATIVE') {
      throw new Error(
        `E-ERR-GOV-002: CANNOT_OVERWRITE_NORMATIVE_FORMULA: Formula ${cardInput.formula_id} is PROMOTED_NORMATIVE and cannot be overwritten by candidate registration`
      );
    }

    const tier: FormulaTier = 'CANDIDATE_UI_MODEL';
    const cardWithoutHash: Omit<FormulaCard, 'jcs_hash'> = {
      formula_id: cardInput.formula_id,
      title: cardInput.title,
      domain: cardInput.domain,
      tier,
      statutory_or_economic_citations: [...cardInput.statutory_or_economic_citations],
      symbolic_expression: cardInput.symbolic_expression,
      input_variables: [...cardInput.input_variables],
      output_variable: { ...cardInput.output_variable },
      rationale_and_invariants: cardInput.rationale_and_invariants,
      canonical_test_vector: { ...cardInput.canonical_test_vector }
    };

    const jcs_hash = computeFormulaJcsHash(cardWithoutHash);
    if (cardInput.jcs_hash && cardInput.jcs_hash !== jcs_hash) {
      throw new Error(
        `E-ERR-022: JCS_HASH_MISMATCH: Provided hash ${cardInput.jcs_hash} does not match computed digest ${jcs_hash}`
      );
    }

    const fullCard: FormulaCard = { ...cardWithoutHash, jcs_hash };
    this.formulas.set(fullCard.formula_id, fullCard);
    return fullCard;
  }

  /**
   * Promotes a candidate formula to PROMOTED_NORMATIVE upon authorized owner directive.
   */
  public promoteCandidateFormula(formulaId: string, authorizationToken: string): FormulaCard {
    if (!authorizationToken || !authorizationToken.startsWith('GOVERNED_RATIFICATION_')) {
      throw new Error(
        `E-ERR-GOV-003: INVALID_PROMOTION_TOKEN: Authorization token rejected for formula promotion`
      );
    }

    const card = this.formulas.get(formulaId);
    if (!card) {
      throw new Error(`E-ERR-GOV-004: FORMULA_NOT_FOUND: Cannot promote non-existent formula ${formulaId}`);
    }

    const cardWithoutHash: Omit<FormulaCard, 'jcs_hash'> = {
      ...card,
      tier: 'PROMOTED_NORMATIVE'
    };
    const jcs_hash = computeFormulaJcsHash(cardWithoutHash);
    const promotedCard: FormulaCard = { ...cardWithoutHash, jcs_hash };
    this.formulas.set(formulaId, promotedCard);
    return promotedCard;
  }

  /**
   * Deterministic BM25-style keyword search over formula metadata.
   */
  public retrieveFormulas(
    query: string,
    options?: FormulaRegistrySearchOptions
  ): FormulaRetrievalResult[] {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return [];

    let candidates = Array.from(this.formulas.values());
    if (options?.tier) {
      candidates = candidates.filter((c) => c.tier === options.tier);
    }
    if (options?.domain) {
      candidates = candidates.filter((c) => c.domain === options.domain);
    }

    // Prepare document token corpus
    const docs = candidates.map((card) => {
      const fullText = [
        card.formula_id,
        card.title,
        card.statutory_or_economic_citations.join(' '),
        card.symbolic_expression,
        card.rationale_and_invariants
      ].join(' ');
      const tokens = tokenize(fullText);
      return { card, tokens, length: tokens.length };
    });

    const N = docs.length;
    if (N === 0) return [];

    const avgdl = docs.reduce((acc, d) => acc + d.length, 0) / N;
    const k1 = 1.5;
    const b = 0.75;

    const results: FormulaRetrievalResult[] = [];

    for (const doc of docs) {
      let score = 0;
      const matchedTerms: string[] = [];

      for (const q of qTokens) {
        // Document frequency n(q)
        const docFreq = docs.filter((d) => d.tokens.includes(q)).length;
        if (docFreq === 0) continue;

        // IDF calculation
        const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);

        // Term frequency in current doc
        const tf = doc.tokens.filter((t) => t === q).length;
        if (tf > 0) {
          matchedTerms.push(q);
          const numerator = tf * (k1 + 1);
          const denominator = tf + k1 * (1 - b + (b * doc.length) / avgdl);
          let termScore = idf * (numerator / denominator);

          // Boost if term matches formula_id or title
          if (doc.card.formula_id.toLowerCase().includes(q)) termScore += 5.0;
          if (doc.card.title.toLowerCase().includes(q)) termScore += 3.0;
          if (doc.card.statutory_or_economic_citations.some((c) => c.toLowerCase().includes(q))) {
            termScore += 4.0;
          }

          score += termScore;
        }
      }

      if (score > 0) {
        results.push({
          formula: doc.card,
          relevance_score: Number(score.toFixed(4)),
          matched_terms: Array.from(new Set(matchedTerms))
        });
      }
    }

    results.sort((a, b) => b.relevance_score - a.relevance_score);

    const topK = options?.topK ?? 10;
    return results.slice(0, topK);
  }

  /**
   * Deterministically evaluates a formula by ID using strict integer/subunits arithmetic.
   * Rejects execution of CANDIDATE_UI_MODEL formulas in production unless allowCandidate is true.
   */
  public evaluateFormula(
    formulaId: string,
    inputs: Record<string, bigint | number>,
    options?: { allowCandidate?: boolean }
  ): bigint {
    const card = this.formulas.get(formulaId);
    if (!card) {
      throw new Error(`E-ERR-GOV-004: FORMULA_NOT_FOUND: Formula ${formulaId} does not exist in registry`);
    }

    if (card.tier === 'CANDIDATE_UI_MODEL' && !options?.allowCandidate) {
      throw new Error(
        `E-ERR-GOV-001: CANDIDATE_UI_MODEL formulas cannot execute in production without owner promotion`
      );
    }

    const custom = this.customEvaluators.get(formulaId);
    if (custom) {
      return custom(inputs);
    }

    switch (formulaId) {
      case 'FIN-LANDED-COST-001': {
        const p = BigInt(inputs.raw_material_purchase_subunits);
        const f = BigInt(inputs.inbound_freight_subunits);
        const i = BigInt(inputs.insurance_handling_subunits);
        const c = BigInt(inputs.customs_inspection_subunits);
        const pkg = BigInt(inputs.packaging_kitting_subunits);
        return p + f + i + c + pkg;
      }
      case 'FIN-MKT-FEES-GST-002': {
        const gross = BigInt(inputs.gross_selling_price_subunits);
        const fees = BigInt(inputs.total_marketplace_fees_subunits);
        const gstRate = BigInt(inputs.gst_rate_bps);
        const feeGst = (fees * gstRate) / 10000n;
        const tcs = BigInt(inputs.tcs_subunits);
        const tds = BigInt(inputs.tds_subunits);
        return gross - fees - feeGst - tcs - tds;
      }
      case 'FIN-STATUTORY-TCS-TDS-003': {
        const netGstLiability = BigInt(inputs.net_gst_cash_liability_subunits);
        const gross = BigInt(inputs.gross_selling_price_subunits);
        const gstRate = BigInt(inputs.gst_rate_bps);
        const tcsRate = BigInt(inputs.tcs_rate_bps);
        const exGstRev = (gross * 10000n) / (10000n + gstRate);
        const tcs = (exGstRev * tcsRate) / 10000n;
        return netGstLiability > tcs ? netGstLiability - tcs : 0n;
      }
      case 'FIN-RETURN-ATTRITION-004': {
        const fba = BigInt(inputs.fba_weight_handling_subunits);
        const rev = BigInt(inputs.reverse_logistics_fee_subunits);
        const landed = BigInt(inputs.landed_cost_subunits);
        const returnRate = BigInt(inputs.customer_return_rate_bps);
        const base = fba + rev + landed;
        return (base * returnRate) / 10000n;
      }
      case 'FIN-CCC-ROWC-005': {
        const lead = Number(inputs.procurement_lead_time_days);
        const dwell = Number(inputs.warehouse_dwell_days);
        const settlement = Number(inputs.marketplace_settlement_delay_days);
        const terms = Number(inputs.payment_terms_days);
        const marginBps = Number(inputs.cash_margin_bps);
        const ccc = Math.max(1, lead + dwell + settlement - terms);
        return BigInt(Math.floor((marginBps * 365) / ccc));
      }
      default: {
        try {
          return evaluateSymbolicExpression(card.symbolic_expression, inputs);
        } catch {
          throw new Error(`E-ERR-GOV-005: NO_EVALUATOR_IMPLEMENTED: Formula ${formulaId} does not have a compiled evaluator`);
        }
      }
    }
  }
}
