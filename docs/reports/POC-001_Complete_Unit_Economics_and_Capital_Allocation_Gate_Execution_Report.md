# POC-001 Execution Report: Complete Unit Economics & Capital-Allocation Gate

**Document Identifier:** POC-001-EXEC-REPORT-UNIT-ECONOMICS-GATE-001  
**Project:** POC-001 Capital-Allocation Research and Market Simulation Platform  
**Repository Working Tree:** `D:\Market HFT OS` (branch `main`)  
**Companion Repository:** `D:\ADRs` (branch `main`)  
**Status:** **FULLY IMPLEMENTED & VERIFIED** (664 passing tests across 56 test suites; 0 regressions; clean TypeScript build)

---

## 1. Executive Summary

This milestone resolves the critical governance and underwriting requirement: **a candidate can never be declared commercially viable based on gross spread alone**. 

Prior to this work, the platform's initial underwriting slice allowed candidates whose retail selling price exceeded supplier purchase price to be stamped `ELIGIBLE`, while ignoring mandatory variable deductions (freight, packaging, marketplace commissions, statutory taxes, return defect attrition), upfront capital requirements, and working-capital exposure. 

We implemented a deterministic, full-variable-cost contribution model powered by **pure BigInt integer subunit arithmetic** (scale $10,000$, $1\text{ INR} = 10,000\text{ subunits}$), fail-closed handling of missing cost inputs (`DATA_REQUIRED`), and explicit capital-allocation parameterization (MOQ upfront cash and Cash Conversion Cycle exposure).

Acceptance Suite 55 (`tests/acceptance/suite55_complete_unit_economics_and_capital_gate.test.ts`) was authored with 9 normative acceptance tests (`UEC-001` through `UEC-009`). A strict red-green workflow was executed:
- **Baseline:** 6 failing tests, 3 passing.
- **Post-Remediation:** 9/9 passing tests in Suite 55, 8/8 passing in Suite 54, 7/7 passing in Suite 52, 7/7 passing in Suite 53, clean TypeScript compilation, and **664 total passing tests across 56 test files** (0 failures, 0 skipped, exit code 0).

---

## 2. Pre-Existing Calculation Gaps Identified

A thorough audit of `src/financial/cashFlowEngine.ts`, `src/research/m4VerticalSlice.ts`, `src/research/opportunityLifecycleEngine.ts`, and `src/discovery/discoveryScreenerService.ts` revealed four major systemic calculation gaps:

| ID | Module / Interface | Pre-Existing Defect / Gap | Commercial & Safety Consequence | Remediated Behavior |
|:---|:---|:---|:---|:---|
| **GAP-01** | `OpportunityLifecycleEngine.underwriteCandidate()` | Evaluated commercial viability strictly on gross spread ($\text{Retail ASP} - \text{Factory Gate Quote}$). Deductions for freight, packaging, commissions, taxes, and returns were omitted. | **False-Positive Viability**: Candidates with positive gross spread but heavily negative net contribution were evaluated as `ELIGIBLE`. | Implemented full variable deductions. Declared cost inputs must produce net contribution $\ge 1,000\text{ bps}$ hurdle; otherwise marked `INELIGIBLE` (`NEGATIVE_NET_CONTRIBUTION` or `NET_CONTRIBUTION_BELOW_POLICY_HURDLE`). |
| **GAP-02** | `OpportunityLifecycleEngine.underwriteCandidate()` & `computeEconomicEligibility()` | Missing variable cost inputs were either silently ignored or implicitly treated as zero when not present. | **Unearned Promotion**: Unresearched costs were assumed to be free, bypassing investigation requirements. | **Fail-Closed Completeness**: Declared applicable cost categories require explicit, non-null numeric inputs. Any missing cost category halts underwriting with `INSUFFICIENT_EVIDENCE` and emits `MANDATORY_COST_INPUT_MISSING` (`DATA_REQUIRED`). |
| **GAP-03** | `OpportunityLifecycleEngine` & `discoveryScreenerService` | Underwriting decision completely lacked initial capital outlay ($\text{MOQ} \times \text{unit upfront cost}$) and working capital exposure (CCC). | **Capital Blindness**: System could approve an opportunity without calculating the cash tied up in inventory or the cash cycle duration. | Deterministic calculation of `initial_cash_requirement_inr`, `working_capital_exposure_inr`, and `cash_conversion_cycle_days` via canonical formula `FIN-CCC-ROWC-005`. |
| **GAP-04** | Arithmetic Precision Across Financial Calculations | Ad-hoc JavaScript floating-point numbers (`Number((a - b).toFixed(2))`) subject to IEEE 754 precision drift on fractional cents. | Non-deterministic string serialization and potential drift across repeated calculations. | Pure BigInt integer subunit arithmetic (scale $10,000$, 4 decimal places) for all outlays, deductions, and net margins. Fractional amounts (e.g. ₹115.3333 + ₹18.6667 = ₹134.0000) are exact. |

---

## 3. Calculation Model & Canonical Formulas

All economic evaluations strictly adhere to canonical ledger formulas registered in `src/research/formulaRegistry.ts` and `src/financial/cashFlowEngine.ts`:

### 3.1 Landed Cost & Variable Deductions (`FIN-LANDED-COST-001`)
$$\text{Total Variable Deductions Subunits} = C_{\text{supplier}} + C_{\text{inbound\_freight}} + C_{\text{packaging}} + C_{\text{platform\_fees}} + C_{\text{statutory\_tax}} + C_{\text{return\_drag}}$$
$$\text{Net Contribution Subunits} = P_{\text{retail\_asp}} - \text{Total Variable Deductions Subunits}$$
$$\text{Contribution Margin bps} = \text{round}\left(\frac{\text{Net Contribution Subunits}}{P_{\text{retail\_asp\_subunits}}} \times 10,000\right)$$

### 3.2 Upfront Cash Outlay & Working Capital Exposure
Only direct physical procurement and logistics preparation require cash upfront prior to listing:
$$\text{Unit Upfront Outlay} = C_{\text{supplier}} + C_{\text{inbound\_freight}} + C_{\text{packaging}}$$
$$\text{Initial Cash Requirement} = \text{Unit Upfront Outlay} \times \text{unit\_batch\_moq}$$
$$\text{Working Capital Exposure} = \text{Initial Cash Requirement}$$

### 3.3 Cash Conversion Cycle (`FIN-CCC-ROWC-005`)
$$\text{CCC (days)} = \max\left(1, D_{\text{lead\_time}} + D_{\text{warehouse\_dwell}} + D_{\text{settlement\_delay}} - D_{\text{payment\_terms}}\right)$$
$$\text{Annualized RoWC bps} = \text{round}\left(\frac{\text{Contribution Margin bps} \times 365}{\text{CCC}}\right)$$

---

## 4. Acceptance Verification Matrix (Suite 55)

The 9 normative acceptance tests in [`tests/acceptance/suite55_complete_unit_economics_and_capital_gate.test.ts`](file:///d:/Market%20HFT%20OS/tests/acceptance/suite55_complete_unit_economics_and_capital_gate.test.ts) passed:

| Test ID | Name | Scenario & Input Profile | Expected & Verified Outcome | Status |
|:---|:---|:---|:---|:---:|
| **UEC-001** | Complete Contribution Economics | Retail ASP ₹320.00; Factory Quote ₹115.00; Freight ₹18.00; Packaging ₹12.00; Fees ₹45.00; Tax ₹8.00; Returns ₹6.00. Total variable deductions = ₹204.00. | `outcome: 'ELIGIBLE'`, `net_contribution_inr: 116.00`, `contribution_margin_bps: 3625`, explanation contains both gross spread (6406 bps) and net contribution (3625 bps). | **PASS** |
| **UEC-002** | Missing Cost Inputs Fail Closed | Gross spread ₹205.00 positive, but applicable categories declare freight & fees which are omitted in observation. | `outcome: 'INSUFFICIENT_EVIDENCE'`, `failed_checks: ['MANDATORY_COST_INPUT_MISSING']`, `binding_constraints` contains `DATA_REQUIRED`, `net_contribution_inr: null`. | **PASS** |
| **UEC-003** | Gross Spread Positive / Net Negative | Quote ₹260.00 vs ASP ₹320.00 (Gross spread +₹60.00, 1875 bps > 1000 bps hurdle), but variable deductions total ₹108.00, resulting in net contribution -₹48.00 (-1500 bps). | `outcome: 'INELIGIBLE'`, `evaluation_status: 'EVALUATED_UNATTRACTIVE'`, `failed_checks: ['NEGATIVE_NET_CONTRIBUTION']`. Transition to `PAPER_ELIGIBLE` throws `E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED`. | **PASS** |
| **UEC-004** | Gate Precedence over Economics | Viable economics (Net contribution ₹116.00), but candidate has active `EVIDENCE_CONFLICT_DETECTED` signal. | `outcome: 'INELIGIBLE'`, `failed_checks: ['ACTIVE_EVIDENCE_CONFLICT_DETECTED']`. Margin does not bypass integrity gates. | **PASS** |
| **UEC-005** | Capital Allocation & MOQ | Quote ₹115.00, Freight ₹18.00, Packaging ₹12.00 (Outlay ₹145.00/unit), MOQ 50 units. Lead 7d, Dwell 14d, Settlement 14d, Terms 0d. | `initial_cash_requirement_inr: 7250.00`, `working_capital_exposure_inr: 7250.00`, `cash_conversion_cycle_days: 35`, `capital_allocation_decision: 'ALLOCATE_CAPITAL'`. | **PASS** |
| **UEC-006** | Exact Integer Subunit Arithmetic | Quote ₹115.3333, Freight ₹18.6667 (exact ₹134.0000 outlay), MOQ 100 units, ASP ₹320.00. | `initial_cash_requirement_inr: 13400.00`, `net_contribution_inr: 186.00`. Zero floating-point drift. | **PASS** |
| **UEC-007** | Synthetic Isolation | Candidate observation origin class is `SYNTHETIC_SCENARIO`. | `evidence_summary.origin_class: 'SYNTHETIC_SCENARIO'`, `evidence_confidence.evidence_quality_rating: 'SYNTHETIC_SCENARIO'`. `authorizePaperCommit()` throws fail-closed error. | **PASS** |
| **UEC-008** | Idempotency & Attestation Parity | Repeated underwriting of identical candidate observation. | `d1.jcs_sha256 === d2.jcs_sha256`, identical net contribution, initial cash requirement, and margin bps. | **PASS** |
| **UEC-009** | Capital Safety & Confirmation Gate | Underwriting eligible candidate, attempting paper commit with rationale $<15$ characters. | Throws `E-OPP-COMMIT-RATIONALE-REQUIRED`. Real-money execution route is impossible. | **PASS** |

---

## 5. Traceable End-to-End Example

The following is an exact, reproducible evaluation trace from `UEC-001`:

```json
{
  "decision_id": "UWD-7BDFF89955F19672",
  "candidate_id": "OPP-38890787365A",
  "canonical_product_id": "PROD-BRASS-HOSE-CLAMP-SS304",
  "candidate_name": "SS304 Brass Hex Hose Clamp (Pack of 10)",
  "category": "PHYSICAL_GOODS",
  "outcome": "ELIGIBLE",
  "lifecycle_state": "DISCOVERED",
  "evaluation_status": "EVALUATED_VIABLE",
  "unit_economics": {
    "prevailing_retail_asp_inr": 320.0,
    "factory_gate_quote_inr": 115.0,
    "gross_spread_inr": 205.0,
    "estimated_margin_bps": 6406,
    "policy_min_margin_bps": 1000,
    "calculation_method": "PHYSICAL_ARBITRAGE_NET_SPREAD_V1",
    "net_contribution_inr": 116.0,
    "contribution_margin_bps": 3625,
    "contribution_margin_denominator": "RETAIL_SELLING_PRICE",
    "initial_cash_requirement_inr": 7250.0,
    "working_capital_exposure_inr": 7250.0,
    "cash_conversion_cycle_days": 35,
    "unit_batch_moq": 50,
    "purchase_quantity": 50,
    "applicable_cost_categories": [
      "SUPPLIER_PURCHASE",
      "INBOUND_FREIGHT",
      "PACKAGING_KITTING",
      "MARKETPLACE_FEES",
      "STATUTORY_TAX",
      "RETURN_DEFECT_DRAG"
    ],
    "cost_breakdown": {
      "supplier_purchase_cost_inr": 115.0,
      "inbound_freight_inr": 18.0,
      "packaging_kitting_inr": 12.0,
      "marketplace_fees_inr": 45.0,
      "statutory_tax_inr": 8.0,
      "return_defect_drag_inr": 6.0,
      "total_variable_deductions_inr": 204.0
    },
    "missing_cost_inputs": []
  },
  "evidence_summary": {
    "is_sufficient_for_underwriting": true,
    "sufficiency_score_bps": 10000,
    "missing_critical_fields": [],
    "uncorroborated_fields": [],
    "source_connector_id": "conn:verified:full-cost-audit",
    "origin_class": "RECORDED_GOLDEN_FIXTURE",
    "observed_at_utc": "2026-10-24T14:00:00.000Z"
  },
  "capital_allocation": {
    "initial_cash_requirement_inr": 7250.0,
    "working_capital_exposure_inr": 7250.0,
    "unit_batch_moq": 50,
    "recommended_batch_quantity": 50,
    "cash_conversion_cycle_days": 35,
    "annualized_rowc_bps": 37789,
    "break_even_price_inr": 204.0,
    "capital_allocation_decision": "ALLOCATE_CAPITAL"
  },
  "evidence_confidence": {
    "evidence_quality_rating": "VERIFIED_EMPIRICAL",
    "primary_origin_class": "RECORDED_GOLDEN_FIXTURE",
    "source_connector_id": "conn:verified:full-cost-audit",
    "observed_at_utc": "2026-10-24T14:00:00.000Z",
    "has_logistics_route": true,
    "has_regulatory_clearance": true
  },
  "binding_constraints": [],
  "failed_checks": [],
  "explanation": "Candidate 'SS304 Brass Hex Hose Clamp (Pack of 10)' satisfies all evidence sufficiency, commercial viability, and policy criteria. Unit economics: Prevailing ASP ₹320.00, Factory quote ₹115.00, Gross spread ₹205.00, Estimated gross margin 6406 bps (64.06%), Net contribution ₹116.00, Contribution margin 3625 bps (36.25%) exceeding policy minimum hurdle of 1000 bps (10.00%). Evidence score: 10000 bps.",
  "required_action_to_reconsider": null,
  "evaluated_at_utc": "2026-10-24T14:00:00.000Z",
  "jcs_sha256": "439247eb864d4c1daff4f58a8a44ec1eb9ec19d0865d1d668bc70dffdf7c050a"
}
```

---

## 6. Repository and Build Health

- **Working Directory:** `D:\Market HFT OS`
- **Tracked Modifications:**
  - `src/research/opportunityLifecycleEngine.ts`: Complete unit economics model, integer subunit arithmetic, fail-closed missing input handling, and capital-allocation parameterization.
  - `src/discovery/discoveryScreenerService.ts`: Investigation task result parameter forwarding for all declared variable cost categories and lead time/terms.
  - `src/mcp/mcpSubstrate.ts`: Preserved LIM-02 zero-seam baseline.
- **Untracked Tests & Modules Preserved:**
  - `tests/acceptance/suite55_complete_unit_economics_and_capital_gate.test.ts` (9 tests, passing)
  - `tests/acceptance/suite54_candidate_underwriting_workflow.test.ts` (8 tests, passing)
  - `tests/acceptance/suite53_slice2c_end_to_end_investigation_workflow.test.ts` (7 tests, passing)
  - `tests/acceptance/suite52_slice2c_investigation_orchestration.test.ts` (7 tests, passing)
  - `src/discovery/investigationPlanner.ts`
  - `src/discovery/investigationTaskQueue.ts`
- **TypeScript Compilation:** `tsc` passed with 0 errors (exit code 0).
- **Vitest Regression Suite:** 664 tests passing across 56 test files (0 failures, 0 skipped, exit code 0).
- **Git Hygiene:** 0 staged files, 0 commits, working directory preserved.
- **Security Freeze:** Strictly preserved. No changes made to `GovernedHttpConnector`, IANA policies, network boundaries, or sockets.

---

## 7. Remaining Blockers to Live Internet Candidate Evaluation

Before this workflow can discover and evaluate candidates directly from the live internet, the following specific items remain:

1. **Targeted Live Connectors for Investigation Workers**: 
   Currently, investigation workers (`worker:supply-agent:v1`, `worker:cost-accountant:v1`) claim tasks and commit results using captured/recorded fixtures or simulated observation inputs. Real live execution requires implementing governed, read-only connector fetches via `GovernedHttpConnector` to authoritative supplier and marketplace quote endpoints.
2. **Category-Specific Cost Structure Profiles**:
   Different categories incur distinct fee structures (e.g. Amazon Referral Fee tier schedules by category, GST tax slabs of 18% vs 12%, Amazon Easy Ship / FBA weight slab tables). Dynamic ingestion of category commission schedules will replace manual specification of applicable cost categories.
3. **Automated Cross-Source Conflict Reconciliation**:
   When live supplier quotes conflict with secondary directory listings, the conflict resolution workflow currently halts with `EVIDENCE_CONFLICT_DETECTED`. Connecting the automated red-team corroboration worker (`RedTeamConflictWorker`) to live re-verification will allow resolving transient discrepancies.
4. **Owner Authorization for Stage 2 Live Internet Ingestion**:
   As mandated by the Master Directive, live internet crawling remains frozen until formal Stage 2 sign-off.
