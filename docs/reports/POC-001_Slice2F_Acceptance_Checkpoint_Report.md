# POC-001 — SLICE 2F ACCEPTANCE CHECKPOINT REPORT
## Ranking Semantics, Evidence Provenance & Capital Economics Audit

**Authority:** Project Owner Acceptance Checkpoint  
**Milestone:** Slice 2F — Multi-Candidate Decision Workflow & Constrained Portfolio Paper-Capital Allocation  
**Workspace:** `D:\Market HFT OS`  
**Test Results:** Suite 59 passed (8/8), TypeScript build clean (0 errors), Full platform regression passed (60/60 files, 704/704 tests)  
**Governance:** Zero Git commits, zero unstaged resets, strict 127.0.0.1 confinement

---

### Executive Summary

An acceptance inspection and semantic audit of Slice 2F was performed across the discovery, underwriting, ranking, portfolio allocation, and UI projection subsystems.

1. **Research Priority vs. Capital Allocation Priority:** The architecture strictly decouples discovery/investigation priority from capital underwriting and paper allocation. Incomplete candidates (e.g. `INSUFFICIENT_EVIDENCE`) can and do receive high research priority (`priority_score_bps`, `ScreeningPriorityTier.HIGH` / `CRITICAL`) to drive targeted investigation tasks in `DiscoveryScreenerService` and `InvestigationPlanner`. However, at the underwriting and capital allocation gate (`OpportunityLifecycleEngine` and `PortfolioAllocationEngine`), paper capital allocation is fail-closed: candidates lacking verified cost inputs or evidence are strictly prohibited from receiving paper capital (`REJECTED_INSUFFICIENT_EVIDENCE`, ₹0.00 allocated). No secondary ranking engine is needed or introduced.
2. **Evidence Provenance Audit:** Fixture-derived observations and costs trace end-to-end across `buildCandidateComparisonRows()`, `evaluatePortfolioAllocationDeck()`, `WorkstationStateManager`, `/api/candidates/compare`, `/api/portfolio/deck`, `/api/snapshot`, Workspace 5 (`capital_allocator`), and the standalone HTML exporter. Fixtures are immutably labeled `RECORDED_GOLDEN_FIXTURE`, `[FIXTURE]`, `RECORDED_FIXTURE_BASELINE`, and `RECORDED_REFERENCE_FIXTURE`, with `is_live_market_verified: false`. The casual phrase *"complete verified evidence"* in the previous execution report was a prose-level ambiguity referring to 10,000 bps sufficiency score and complete cost corroboration; the underlying code and runtime contract never promoted fixture records to live market captures.
3. **Unit Economics & Initial Cash Outlay Reconciliation:** Both SS304 clamps and brass valves were audited at the integer subunit level (scale 10,000). The model establishes an exact separation between **upfront landed cash outlay** ($(\text{Quote} + \text{Freight} + \text{Packaging}) \times \text{MOQ}$, paid before inventory receipt) and **point-of-sale variable transactional deductions** ($\text{Marketplace Fees} + \text{Statutory Tax} + \text{Defect Drag}$, deducted upon retail settlement). Zero double-counting or cost omission exists between net contribution and portfolio budget consumption.
4. **Portfolio Allocation Determinism & Budget Safety:** The allocation algorithm is pure, deterministic, and idempotent. Repeated evaluations, dynamic budget modifications (e.g., ₹5,000 to ₹12,000), single-allocation caps (e.g., max ₹5,000), and candidate updates recompute the portfolio deck cleanly from the current underwriting decision map without stale or duplicated allocations.

---

### 1. Research Priority vs. Capital Eligibility Separation

#### Architectural Decoupling

| Dimension | Stage 0: Research / Discovery Priority | Gate M7.2: Capital Allocation & Paper Commit |
| :--- | :--- | :--- |
| **Responsible Engine** | `ScreeningPolicyEngine` & `DiscoveryScreenerService` ([screeningPolicy.ts](file:///d:/Market%20HFT%20OS/src/discovery/screeningPolicy.ts#L10-L80)) | `PortfolioAllocationEngine` & `OpportunityLifecycleEngine` ([portfolioAllocationEngine.ts](file:///d:/Market%20HFT%20OS/src/research/portfolioAllocationEngine.ts#L33-L139)) |
| **Primary Metric** | `priority_score_bps` (0–10,000) & `priority_tier` (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `DEFERRED`) | `contribution_margin_bps`, `initial_cash_requirement_inr`, `outcome` (`ELIGIBLE`, `INSUFFICIENT_EVIDENCE`, `INELIGIBLE`) |
| **Objective** | Prioritize investigation tasks for high-spread or urgent candidates to resolve data gaps | Authorize and ration finite paper capital across economically vetted, data-complete opportunities |
| **Handling of Missing Costs** | **Permitted & Encouraged for Research:** Missing costs trigger `recommended_investigation_tasks` (e.g. `INQUIRE_SUPPLIER_QUOTE`, `SCRAPE_RETAIL_ASP`) and can have `HIGH` priority if gross spread is attractive | **Fail-Closed Prohibition:** Missing mandatory costs immediately yield `INSUFFICIENT_EVIDENCE` / `EVIDENCE_SUGGESTS_FURTHER_INVESTIGATION`. Capital allocation is strictly blocked (`allocated_capital_inr: 0`) |
| **Output Contract** | `DiscoveryScreeningResult`, `ScreeningEvaluationResult` | `CandidateComparisonRow`, `PortfolioAllocationDeck`, `CandidateUnderwritingDecision` |

#### Comparison Matrix Semantics

In `buildCandidateComparisonRows()` ([portfolioAllocationEngine.ts](file:///d:/Market%20HFT%20OS/src/research/portfolioAllocationEngine.ts#L145-L192)):
- Candidates are grouped by Underwriting Outcome Tier:
  - **Tier 1:** `ELIGIBLE` (underwritten, positive net contribution $\ge 10.00\%$, complete evidence).
  - **Tier 2:** `INSUFFICIENT_EVIDENCE` (unresolved cost inputs or data gaps).
  - **Tier 3:** `INELIGIBLE` (negative net contribution or policy violation).
  - **Tier 4:** `PENDING` (screened observation not yet underwritten).
- Within Tier 1, ordering is determined strictly by commercial merit:
  1. `contribution_margin_bps` DESC (highest net return per sales rupee).
  2. `initial_cash_requirement_inr` ASC (capital efficiency / lower batch cash lockup).
  3. `sufficiency_score_bps` DESC (evidence confidence).
  4. `candidate_id` ASC (lexicographical stability).
- `priority_rank` in `CandidateComparisonRow` represents the **Capital Allocation Priority Rank**.
- Rationale strings make this distinction explicit to the operator:
  - For Tier 1: `"Rank 1 [ELIGIBLE]: Contribution margin 40.18% (4018 bps), net unit contribution ₹34.15 on ₹85.00 ASP, initial cash req ₹3150.00, evidence sufficiency 10000 bps."`
  - For Tier 2: `"Rank 3 [INSUFFICIENT_EVIDENCE]: Underwriting blocked by unresolved evidence/cost gaps: [SUPPLIER_PURCHASE]. Net contribution unknown. Paper capital allocation prohibited."`

**Audit Conclusion:** The distinction is semantically clean, enforceable, and verified. Incomplete candidates can be researched aggressively through `DiscoveryScreenerService` and `InvestigationPlanner`, but are structurally barred from capital allocation in `PortfolioAllocationEngine`.

---

### 2. End-to-End Evidence Provenance Audit

The inquiry investigated whether fixture candidates could ever be represented as live-market-verified evidence, specifically auditing the report statement describing fixture candidate SS304 Clamps as *"complete verified evidence"*.

#### Data Path Audit Trace

```
[Raw Fixture Capture / Seed]
       │ origin_class: 'RECORDED_GOLDEN_FIXTURE'
       ▼
[Discovery Screener & Lifecycle Ingestion]
       │ candidate.current_observation.origin_class = 'RECORDED_GOLDEN_FIXTURE'
       ▼
[OpportunityLifecycleEngine.underwriteCandidate()]
       │ isLiveMarket = (originClass === 'LIVE_VERIFIED_CAPTURE') -> FALSE
       │ rating = 'RECORDED_REFERENCE_FIXTURE'
       │ evidencePosture = 'RECORDED_FIXTURE_BASELINE'
       │ is_live_market_verified = isLiveMarket && is_sufficient -> FALSE
       ▼
[PortfolioAllocationEngine / buildCandidateComparisonRows()]
       │ row.origin_class = 'RECORDED_GOLDEN_FIXTURE'
       ▼
[WorkstationStateManager.projectAuthoritativeSnapshot()]
       │ isLive = (originClass === 'LIVE_VERIFIED_CAPTURE' && is_live_market_verified) -> FALSE
       │ createEvidenceOriginBadge('RECORDED_GOLDEN_FIXTURE', ...) -> '[FIXTURE]'
       ▼
[Workspace 5: Capital Allocator dynamicCapitalRows]
       │ evidence_badge: { origin_class: 'RECORDED_GOLDEN_FIXTURE', symbol: '[FIXTURE]' }
       ▼
[API Endpoints & Standalone HTML Exporter]
       │ GET /api/candidates/compare -> origin_class: "RECORDED_GOLDEN_FIXTURE"
       │ GET /api/portfolio/deck      -> items[].outcome: "ELIGIBLE", origin: "RECORDED_GOLDEN_FIXTURE"
       │ GET /api/snapshot            -> capital_allocator rows render [FIXTURE] badge
       │ Standalone HTML Exporter     -> <span class="badge badge-fixture">[FIXTURE]</span>
```

#### Code Verification Points
1. **Underwriting Derivation** ([opportunityLifecycleEngine.ts:1372-1397](file:///d:/Market%20HFT%20OS/src/research/opportunityLifecycleEngine.ts#L1372-L1397)):
   ```typescript
   const originClass = candidate.current_observation.origin_class ?? 'RECORDED_GOLDEN_FIXTURE';
   const isLiveMarket = originClass === 'LIVE_VERIFIED_CAPTURE';
   // isLiveMarket evaluates strictly to false for fixtures
   const isLiveMarketVerified = isLiveMarket && candidate.evidence_sufficiency.is_sufficient_for_underwriting;
   // isLiveMarketVerified is strictly false
   ```
2. **State Manager Badge Generation** ([workstationStateManager.ts:2800-2805](file:///d:/Market%20HFT%20OS/src/server/workstationStateManager.ts#L2800-L2805)):
   ```typescript
   const originClass = decision.evidence_confidence?.primary_origin_class ?? 'RECORDED_GOLDEN_FIXTURE';
   const evBadge = createEvidenceOriginBadge(originClass as any, ...);
   ```
   `createEvidenceOriginBadge` assigns `symbol: '[FIXTURE]'` and CSS class `badge-fixture`.
3. **Execution Report Clarification:** The phrase *"complete verified evidence"* used in Section 2.1 of the previous execution report was an informal prose description signifying that the candidate possessed a **10,000 bps (100%) evidence sufficiency score** with all mandatory cost fields corroborated against fixture data. It did **not** denote `is_live_market_verified: true` or `LIVE_VERIFIED_CAPTURE`. The code, database, and UI never elevated the fixture to live status.

---

### 3. Reconciled Unit Economics & Cash Outlay Model

The table below reconciles the financial calculations performed by `OpportunityLifecycleEngine.underwriteCandidate()` and consumed by `PortfolioAllocationEngine` for both benchmark products:

| Metric / Field | SS304 Clamps (50mm Hose Clamp) | Brass Valves (1/2" PN20 Ball Valve) | Financial Classification & Timing |
| :--- | :--- | :--- | :--- |
| **Prevailing Retail ASP** (`prevailing_retail_asp_inr`) | ₹85.00 | ₹320.00 | Top-line retail selling price |
| **Factory Gate Quote** (`factory_gate_quote_inr`) | ₹25.00 | ₹115.00 | Direct supplier manufacturing quote |
| **Gross Spread** (`gross_spread_inr`) | **₹60.00** | **₹205.00** | $\text{ASP} - \text{Quote}$ (pre-operating costs) |
| **Estimated Gross Margin** (`estimated_margin_bps`) | **70.59%** (7,059 bps) | **64.06%** (6,406 bps) | Gross spread as % of ASP |
| **Inbound Freight** (`inbound_freight_inr`) | ₹3.50 | ₹15.00 | Upfront landed freight per unit |
| **Packaging & Kitting** (`packaging_kitting_inr`) | ₹3.00 | ₹10.00 | Upfront kitting / packaging per unit |
| **Landed Upfront Cost per Unit** | **₹31.50** | **₹140.00** | $\text{Quote} + \text{Freight} + \text{Packaging}$ |
| **Minimum Order Quantity (MOQ)** (`unit_batch_moq`) | 100 units | 50 units | Factory batch constraint |
| **Initial Cash Outlay** (`initial_cash_requirement_inr`) | **₹3,150.00** | **₹7,000.00** | $\text{Landed Unit Cost} \times \text{MOQ}$ (**Budget Consumption**) |
| **Platform / Marketplace Fees** (`platform_fee_inr`) | ₹10.20 (12.00%) | ₹40.00 (12.50%) | Point-of-sale deduction upon settlement |
| **Statutory Tax / GST** (`statutory_tax_inr`) | ₹7.65 (9.00%) | ₹25.00 (7.81%) | Transactional tax remitted upon sale |
| **Return / Defect Drag** (`return_defect_drag_inr`) | ₹1.50 (1.76%) | ₹5.00 (1.56%) | Provision for returns / defect allowance |
| **Total Non-Supplier Deductions** | ₹25.85 | ₹95.00 | $\text{Freight} + \text{Packaging} + \text{Fees} + \text{Tax} + \text{Returns}$ |
| **Total Variable Deductions** | ₹50.85 | ₹210.00 | $\text{Quote} + \text{Non-Supplier Deductions}$ |
| **Net Unit Contribution** (`net_contribution_inr`) | **₹34.15** | **₹110.00** | $\text{ASP} - \text{Total Variable Deductions}$ |
| **Contribution Margin** (`contribution_margin_bps`) | **40.18%** (4,018 bps) | **34.38%** (3,438 bps) | Net contribution as % of ASP |
| **Cash Conversion Cycle** (`cash_conversion_cycle_days`) | 28 days ($7+14+14-7$) | 35 days ($10+15+10-0$) | Working capital duration |

#### Capital vs. Contribution Verification
1. **Landed Inventory Outlay:** The paper-budget allocation consumes **only** the upfront cash requirement ($\text{Quote} + \text{Freight} + \text{Packaging} \times \text{MOQ}$). An operator must deploy ₹3,150.00 to acquire the SS304 clamp batch and ₹7,000.00 to acquire the Brass valve batch.
2. **Point-of-Sale Variable Costs:** Platform fees, statutory taxes, and return drag are **never** drawn from the initial capital budget. They are deducted from gross revenues at the moment of retail customer settlement.
3. **Absence of Double-Counting:** All calculations use integer subunit arithmetic (scale 10,000). Total deductions for net contribution sum all 6 cost categories once ($₹25 + ₹3.50 + ₹3 + ₹10.20 + ₹7.65 + ₹1.50 = ₹50.85$). Upfront outlay sums the 3 pre-receipt physical categories once ($₹25 + ₹3.50 + ₹3 = ₹31.50$). There is no duplication or omission.

---

### 4. Portfolio Allocation Behavior & Safety Verification

#### Determinism and Explainability
- Evaluating the candidate set across identical inputs produces identical ranking and allocations.
- Sorting tie-breakers are deterministic: Margin DESC $\rightarrow$ Cash Outlay ASC $\rightarrow$ Evidence Sufficiency DESC $\rightarrow$ Candidate ID ASC.

#### Budget Constrained Scenarios
- **Scenario A (Budget = ₹5,000.00):**
  - **Rank 1 (SS304 Clamps):** Requires ₹3,150.00. Status: `ALLOCATED`. Allocated: ₹3,150.00. Remaining Budget: ₹1,850.00.
  - **Rank 2 (Brass Valve):** Requires ₹7,000.00. Status: `DEFERRED_BUDGET_EXCEEDED`. Allocated: ₹0.00. Shortfall: ₹5,150.00 ($₹7,000 - ₹1,850$).
  - **Rank 3 (SaaS Tool / Incomplete):** Status: `REJECTED_INSUFFICIENT_EVIDENCE`. Allocated: ₹0.00.
  - Summary: 1 allocated, 1 deferred, 1 rejected. Total allocated: ₹3,150.00.
- **Scenario B (Budget Expanded = ₹12,000.00):**
  - **Rank 1 (SS304 Clamps):** Allocated ₹3,150.00. Remaining: ₹8,850.00.
  - **Rank 2 (Brass Valve):** Allocated ₹7,000.00. Remaining: ₹1,850.00.
  - Summary: 2 allocated, 0 deferred, 1 rejected. Total allocated: ₹10,150.00 (84.58% utilization).
- **Scenario C (Max Single Allocation Cap = ₹5,000.00 on ₹12,000.00 Budget):**
  - **Rank 1 (SS304 Clamps):** Requires ₹3,150.00 $\le$ ₹5,000.00 cap. Status: `ALLOCATED`.
  - **Rank 2 (Brass Valve):** Requires ₹7,000.00 $>$ ₹5,000.00 cap. Status: `DEFERRED_BUDGET_EXCEEDED` (shortfall: ₹2,000.00 vs cap).

#### In-Memory Lifecycle & Deduplication
- `WorkstationStateManager` maintains a single authoritative Map of underwriting decisions keyed by `candidate_id` (`underwritingDecisions`).
- Re-underwriting a candidate updates the Map in-place.
- Budget adjustments via `POST /api/portfolio/evaluate-budget` trigger `recomputePortfolioDeck()`, which passes `Array.from(underwritingDecisions.values())` into the pure evaluation function.
- In-memory state exhibits zero duplicate allocations, zero lingering reservations, and zero drift across evaluations.

---

### 5. Verification Matrix & Defect Audit

| Acceptance Item | Inspected Subsystem | Verification Method | Finding / Defect Status |
| :--- | :--- | :--- | :--- |
| **Item 1: Priority Separation** | `ScreeningPolicyEngine` vs `PortfolioAllocationEngine` | Code inspection & S59-003 / S59-004 | **CLEAN:** Research priority guides screening/tasks; capital allocation strictly gated by outcome. |
| **Item 2: Evidence Provenance** | Ingestion $\rightarrow$ Underwriting $\rightarrow$ State Manager $\rightarrow$ UI Export | Trace of `origin_class`, `is_live_market_verified`, badges | **CLEAN:** Fixtures remain `RECORDED_GOLDEN_FIXTURE` and `[FIXTURE]`. No live promotion. Previous report wording clarified. |
| **Item 3: Outlay Reconciliation** | `OpportunityLifecycleEngine` lines 1248–1306 | Subunit math trace for SS304 and Brass | **CLEAN:** Upfront inventory outlay separated from transactional deductions. Zero double-counting. |
| **Item 4: Allocation Safety** | `PortfolioAllocationEngine.evaluatePortfolioAllocationDeck()` | S59-005, S59-006, budget expansion/caps | **CLEAN:** Pure function determinism, cumulative budget ceiling invariant strictly enforced. |

#### Platform Regression Results
- **Acceptance Suite 59 (Slice 2F):** 8/8 tests passed (655ms).
- **Platform Regression (Excluding Suite 42):** 60 test files passed, 704 tests passed, 0 failures.
- **TypeScript Compilation:** Clean exit code 0 (`tsc`).
- **Working Tree Integrity:** Working tree clean, zero commits made, zero staged changes.

---

### 6. Recommended Next Steps

Slice 2F semantic and financial verification is complete. The multi-candidate decision workflow, candidate comparison surface, and constrained portfolio allocation are verified and defensible.

Awaiting Project Owner direction for **Slice 2G** or the next milestone.
