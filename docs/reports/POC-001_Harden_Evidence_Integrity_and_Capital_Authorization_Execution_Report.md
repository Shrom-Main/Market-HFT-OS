# POC-001 Execution Report — Hardening Evidence Integrity & Capital Authorization Gate

**Directive:** POC-001 — NEXT DIRECTIVE: HARDEN EVIDENCE INTEGRITY & CAPITAL AUTHORIZATION  
**Project:** POC-001 Capital-Allocation Research and Market Simulation Platform  
**Workspace:** `D:\Market HFT OS` (branch `main`)  
**Companion repository:** `D:\ADRs` (branch `main`)  
**Date:** 2026-10-27  
**Status:** COMPLETE — Fully Verified (676/676 Tests Passing)

---

## 1. Executive Summary

This directive executed a bounded correctness and integrity pass to cleanly decouple three distinct operational concepts that were previously conflated:
1. **Evidence that a claim was recorded or processed** (`RECORDED_GOLDEN_FIXTURE` vs `LIVE_VERIFIED_CAPTURE` vs `SYNTHETIC_SCENARIO`).
2. **Evidence that a commercial opportunity is economically viable** (complete, non-bypassable variable cost deductions vs gross spread alone).
3. **Authorization to allocate capital in paper simulation** (commercial `ELIGIBLE` $\ne$ `ALLOCATE_CAPITAL`; paper budget configuration required).

All changes were implemented using pure BigInt integer subunit arithmetic (scale 10,000; 1 INR = 10,000 subunits) and canonical RFC 8785 JSON Canonicalization Scheme (JCS) SHA-256 digests. Zero live crawling was performed, the security implementation freeze was maintained, and no git staging or commits were executed.

---

## 2. Actual Files and Functions Modified

### Modified Production Files

1. [`src/research/opportunityLifecycleEngine.ts`](file:///D:/Market%20HFT%20OS/src/research/opportunityLifecycleEngine.ts)
   - **`CapitalAllocationDecision` Domain Type**: Extended to include `'ALLOCATE_CAPITAL' | 'DO_NOT_ALLOCATE_CAPITAL' | 'NOT_AUTHORIZED_BUDGET_UNCONFIGURED' | 'NOT_AUTHORIZED_BUDGET_EXCEEDED' | 'REJECTED_UNECONOMIC'`.
   - **`CostCategoryExclusion` & `CostCategoryAssessment`**: Added formal interfaces to represent non-applicable costs with recorded substantive rationale ($\ge 10$ characters) vs known zero vs known values vs missing.
   - **`CandidateObservationSnapshot` & `IngestObservationInput`**: Added `cost_category_exclusions?: readonly CostCategoryExclusion[]` to capture and persist explicit cost exclusions.
   - **`OpportunityLifecycleEngine.underwriteCandidate()`**:
     - Hardened evidence posture identification: `RECORDED_GOLDEN_FIXTURE` explicitly evaluates to `evidence_posture: 'RECORDED_FIXTURE_BASELINE'`, `evidence_quality_rating: 'RECORDED_REFERENCE_FIXTURE'`, `is_live_market_verified: false`.
     - `LIVE_VERIFIED_CAPTURE` with complete sufficiency achieves `evidence_posture: 'LIVE_VERIFIED_EMPIRICAL'`, `evidence_quality_rating: 'LIVE_EMPIRICAL_CORROBORATED'`, `is_live_market_verified: true`.
     - Non-bypassable cost-completeness evaluation: enforces that all 6 physical goods cost categories (`SUPPLIER_PURCHASE`, `INBOUND_FREIGHT`, `PACKAGING_KITTING`, `MARKETPLACE_FEES`, `STATUTORY_TAX`, `RETURN_DEFECT_DRAG`) must be accounted for by known value, known zero, or substantive exclusion basis ($\ge 10$ chars).
     - Separated `supplier_purchase_cost_inr` and `non_supplier_variable_costs_inr` (ensuring supplier quote is counted exactly once).
     - Decoupled capital allocation decision gate: returns `'NOT_AUTHORIZED_BUDGET_UNCONFIGURED'` when `budgetConfig` is missing/zero, `'NOT_AUTHORIZED_BUDGET_EXCEEDED'` when initial outlay exceeds available budget, and `'ALLOCATE_CAPITAL'` only when initial outlay is within configured paper budget.
     - Annualized RoWC metric: explicitly labeled with `annualized_rowc_interpretation: 'CONDITIONAL_ANNUALIZED_EXTRAPOLATION_NOT_REALIZED_RETURN'` and returns `null` when net contribution or cash conversion cycle is non-positive or missing.
   - **`OpportunityLifecycleEngine.computeEconomicEligibility()`**:
     - Updated to evaluate full 6-category cost model whenever declared costs or exclusions are present; fails closed as `UNEVALUABLE_INPUTS_MISSING` if any category is omitted without substantive rationale.
   - **`OpportunityLifecycleEngine.authorizePaperCommit()`**:
     - Enforces fail-closed validation when `this.requirePaperBudget` is active: blocks unconfigured budgets with `E-OPP-BUDGET-UNCONFIGURED` and outlays exceeding budget with `E-OPP-BUDGET-EXCEEDED`.
     - Pre-checks active signals (`EVIDENCE_CONFLICT_DETECTED`, `EVIDENCE_STALE`, `SYNTHETIC_SCENARIO`) to fail closed before economic checks.

2. [`src/discovery/discoveryScreenerService.ts`](file:///D:/Market%20HFT%20OS/src/discovery/discoveryScreenerService.ts)
   - **`SubmitInvestigationResultParams.extracted_fields`**: Added `cost_category_exclusions?: readonly CostCategoryExclusion[]`.
   - **`submitInvestigationResult()`**: Forwards `cost_category_exclusions` from investigation payloads to `lifecycleEngine.ingestObservation()`.
   - **`underwriteCandidate()`**: Extended to accept `options?: { budgetConfig?: PaperCapitalBudgetConfig }` and forward to `lifecycleEngine.underwriteCandidate()`.
   - **Exports**: Re-exports `CostCategoryExclusion`, `CostCategoryTreatment`, `CostCategoryAssessment`, `CapitalAllocationDecision`, and `PaperCapitalBudgetConfig`.

### Modified & Added Acceptance Suites

1. [`tests/acceptance/suite56_evidence_integrity_and_capital_authorization.test.ts`](file:///D:/Market%20HFT%20OS/tests/acceptance/suite56_evidence_integrity_and_capital_authorization.test.ts) (NEW)
   - 12/12 comprehensive acceptance tests covering:
     - `EIC-001`: Recorded fixture cannot masquerade as live empirical verification (`is_live_market_verified: false`).
     - `EIC-002`: Live verified capture achieves `is_live_market_verified: true` and `LIVE_EMPIRICAL_CORROBORATED`.
     - `EIC-003`: Synthetic scenario evidence fails closed at transition and commit authorization.
     - `EIC-004`: Omitting material cost categories fails closed with `INSUFFICIENT_EVIDENCE` and `DATA_REQUIRED`.
     - `EIC-005`: Explicitly not-applicable costs with $\ge 10$-char basis are permitted; flimsy bases fail closed.
     - `EIC-006`: Known zero costs are distinguished from missing costs (`KNOWN_ZERO` vs `UNKNOWN_MISSING`).
     - `EIC-007`: Supplier quote counted once and non-supplier variable deductions separated.
     - `EIC-008`: High gross spread (80%) cannot declare viability when variable deductions are unknown.
     - `EIC-009`: Commercial eligibility defaults to `NOT_AUTHORIZED_BUDGET_UNCONFIGURED` without budget.
     - `EIC-010`: Missing paper budget fails closed at commit authorization gate (`E-OPP-BUDGET-UNCONFIGURED`).
     - `EIC-011`: Annualized RoWC labeled as conditional extrapolation and returns null on negative net contribution.
     - `EIC-012`: Identical evidence and policy inputs produce deterministic RFC 8785 attestation parity.

2. [`tests/acceptance/suite55_complete_unit_economics_and_capital_gate.test.ts`](file:///D:/Market%20HFT%20OS/tests/acceptance/suite55_complete_unit_economics_and_capital_gate.test.ts)
   - Updated UEC-005 to test both unconfigured budget (`NOT_AUTHORIZED_BUDGET_UNCONFIGURED`) and explicit budget authorization (`ALLOCATE_CAPITAL`).
   - Updated UEC-006, UEC-007, UEC-008 to supply substantive cost exclusions for unmodeled physical goods categories.

3. [`tests/acceptance/suite54_candidate_underwriting_workflow.test.ts`](file:///D:/Market%20HFT%20OS/tests/acceptance/suite54_candidate_underwriting_workflow.test.ts)
   - Updated UWT-001, UWT-003, and UWT-007 to provide substantive `cost_category_exclusions` for categories not modeled in the early stage gross-spread regression tests.

---

## 3. Specific Defects Confirmed in Code & Remediation

| Defect ID | Defect in Previous Baseline | Specific Location | Remediation Implemented |
|---|---|---|---|
| **DEF-001** | Recorded test fixtures masquerading as live empirical verification | `OpportunityLifecycleEngine.underwriteCandidate()` lines 1167-1180 | Labeled `origin_class: 'RECORDED_GOLDEN_FIXTURE'` as `evidence_posture: 'RECORDED_FIXTURE_BASELINE'`, `evidence_quality_rating: 'RECORDED_REFERENCE_FIXTURE'`, and `is_live_market_verified: false`. Usable for deterministic testing, but explicitly barred from claiming live empirical status. |
| **DEF-002** | Bypassing variable cost categories without justification | `underwriteCandidate()` defaulted `applicable_cost_categories` to `['SUPPLIER_PURCHASE']` if unprovided | Enforced all 6 standard physical cost categories (`SUPPLIER_PURCHASE`, `INBOUND_FREIGHT`, `PACKAGING_KITTING`, `MARKETPLACE_FEES`, `STATUTORY_TAX`, `RETURN_DEFECT_DRAG`). Omitting any category without a substantive exclusion rationale ($\ge 10$ characters) fails closed as `INSUFFICIENT_EVIDENCE` (`DATA_REQUIRED`). |
| **DEF-003** | Commercial eligibility conflated with capital authorization | `capital_allocation_decision = 'ALLOCATE_CAPITAL'` whenever `outcome === 'ELIGIBLE'` | Decoupled commercial underwriting from paper simulation budget authorization. Without explicit `budgetConfig`, decision evaluates to `'NOT_AUTHORIZED_BUDGET_UNCONFIGURED'`. Commit authorization fails closed with `E-OPP-BUDGET-UNCONFIGURED` if budget is missing or zero. |
| **DEF-004** | Misleading annualized RoWC without extrapolation disclosure | Annualized RoWC computed without caveat or check for negative contribution | Added `annualized_rowc_interpretation: 'CONDITIONAL_ANNUALIZED_EXTRAPOLATION_NOT_REALIZED_RETURN'` and explanatory caveat. Returns `null` whenever net contribution or CCC is non-positive or missing. |

---

## 4. Before / After Behavioral Matrix

| Operation / Scenario | Before Remediation | After Remediation |
|---|---|---|
| **Underwriting Golden Fixture** | Tagged as `VERIFIED` and implied live verification | Labeled `RECORDED_FIXTURE_BASELINE`, `RECORDED_REFERENCE_FIXTURE`, `is_live_market_verified: false` |
| **Underwriting Live Collector Capture** | Treated identically to static fixtures | Labeled `LIVE_VERIFIED_EMPIRICAL`, `LIVE_EMPIRICAL_CORROBORATED`, `is_live_market_verified: true` |
| **Underwriting with Missing Freight/Taxes** | Omitted categories silently ignored; gross spread declared viable | Fails closed: `INSUFFICIENT_EVIDENCE`, `failed_checks: ['MANDATORY_COST_INPUT_MISSING']` |
| **Cost Category Exclusion Basis < 10 chars** | Accepted or unvalidated | Rejected as invalid exclusion; treated as `UNKNOWN_MISSING` and fails closed |
| **Zero Variable Costs (e.g. self-fulfillment)** | Indistinguishable from missing costs | Explicitly recognized as `treatment: 'KNOWN_ZERO'`, `amount_inr: 0` |
| **Supplier Quote Deduction** | Potentially double-deducted if listed in variable deductions | Broken out into `supplier_purchase_cost_inr` and `non_supplier_variable_costs_inr`; counted exactly once |
| **Candidate Economically Viable (No Budget)** | Granted `capital_allocation_decision: 'ALLOCATE_CAPITAL'` | Returns `outcome: 'ELIGIBLE'` with `capital_allocation_decision: 'NOT_AUTHORIZED_BUDGET_UNCONFIGURED'` |
| **Paper Commit Without Configured Budget** | Could commit without budget constraints | Throws `E-OPP-BUDGET-UNCONFIGURED` (fail-closed) |
| **Paper Commit Outlay > Available Budget** | Allowed unconstrained outlay | Throws `E-OPP-BUDGET-EXCEEDED` (fail-closed) |
| **Annualized RoWC with Negative Contribution** | Produced misleading extrapolation | Safely evaluates to `null` with explicit `UNAVAILABLE_MISSING_OR_NEGATIVE_CONTRIBUTION` interpretation |

---

## 5. Verification Commands and Exit Codes

| Command | Scope | Result | Exit Code |
|---|---|---|---|
| `cmd.exe /c npx vitest run tests/acceptance/suite56_evidence_integrity_and_capital_authorization.test.ts` | Acceptance Suite 56 (12 tests) | 12 passed / 0 failed | `0` |
| `cmd.exe /c npx vitest run tests/acceptance/suite55_complete_unit_economics_and_capital_gate.test.ts` | Acceptance Suite 55 (9 tests) | 9 passed / 0 failed | `0` |
| `cmd.exe /c npx vitest run tests/acceptance/suite54_candidate_underwriting_workflow.test.ts` | Acceptance Suite 54 (8 tests) | 8 passed / 0 failed | `0` |
| `cmd.exe /c npx vitest run tests/acceptance/suite53_slice2c_end_to_end_investigation_workflow.test.ts` | Acceptance Suite 53 (7 tests) | 7 passed / 0 failed | `0` |
| `cmd.exe /c npx vitest run tests/acceptance/suite48_pre_slice2c_safety_remediation.test.ts` | Acceptance Suite 48 (11 tests) | 11 passed / 0 failed | `0` |
| `cmd.exe /c npm run build` (`tsc`) | Full TypeScript Compilation | 0 errors | `0` |
| `cmd.exe /c npx vitest run --exclude **/suite42*` | Full Regression Test Suite (57 files) | 676 passed / 0 failed | `0` |

---

## 6. Remaining Limitations & Owner Configuration Requirements

1. **Owner Budget Configuration Required for Paper Simulation**:
   - Because `OpportunityLifecycleEngine` enforces strict separation between commercial underwriting and capital allocation, operators running paper simulation sessions must explicitly configure `PaperCapitalBudgetConfig` (`available_paper_capital_inr` and optional `max_single_allocation_inr`).
   - If unconfigured, candidates will successfully underwrite as `ELIGIBLE` commercially, but their capital allocation state will remain `NOT_AUTHORIZED_BUDGET_UNCONFIGURED`.

2. **Substantive Exclusion Rationale Requirement**:
   - Automated ingestion scripts or manual analysts wishing to exclude a material cost category (e.g., direct distribution where marketplace fees are zero) must provide an `exclusion_basis` of at least 10 non-whitespace characters. Shorter justifications (e.g., `"N/A"`, `"none"`) fail closed by design.

3. **Stage 2 Live Collector Prerequisites**:
   - While the evidence posture model now cleanly differentiates `LIVE_VERIFIED_CAPTURE` from `RECORDED_GOLDEN_FIXTURE`, live market crawling remains frozen pending owner authorization of Stage 2 live ingestion.

---

## 7. Final Working-Tree Status

```text
On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  modified:   src/discovery/discoveryScreenerService.ts
  modified:   src/mcp/mcpSubstrate.ts
  modified:   src/research/opportunityLifecycleEngine.ts

Untracked files:
  registry/
  scripts/fetch_iana_snapshots.ts
  src/discovery/investigationPlanner.ts
  src/discovery/investigationTaskQueue.ts
  src/infrastructure/
  tests/acceptance/suite49_category_agnostic_discovery_pipeline.test.ts
  tests/acceptance/suite50_browser_network_security_boundary.test.ts
  tests/acceptance/suite52_slice2c_investigation_orchestration.test.ts
  tests/acceptance/suite53_slice2c_end_to_end_investigation_workflow.test.ts
  tests/acceptance/suite54_candidate_underwriting_workflow.test.ts
  tests/acceptance/suite55_complete_unit_economics_and_capital_gate.test.ts
  tests/acceptance/suite56_evidence_integrity_and_capital_authorization.test.ts
  tests/integration/suite51_governed_proxy_socket_boundary.test.ts
  tests/unit/

no changes added to commit (use "git add" and/or "git commit -a")
```
- **Git Staging**: Clean (0 staged files).
- **Git Commits**: None created.
- **Security Scope Freeze**: Preserved with 100% integrity (zero changes to `GovernedHttpConnector`, IANA policies, network boundaries).
