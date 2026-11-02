# POC-001 — Slice 2F Multi-Candidate Decision Workflow & Constrained Portfolio Allocation Execution Report

**Authority:** Project Owner Directive — Slice 2F: Candidate Ranking & Multi-Thesis Capital Allocation Deck  
**Date:** 2026-10-28  
**Workspace:** `D:\Market HFT OS`  
**Git Branch:** `main` (commit baseline: clean working tree preserved, 0 staging, 0 commits)  
**Status:** COMPLETE — Authorized for Project Owner Review

---

## 1. Executive Summary

Slice 2F transitions the POC-001 research-to-decision engine from single-candidate isolated underwriting to an operator-facing **Multi-Candidate Decision Workflow** and **Constrained Portfolio Paper-Capital Allocation Deck**.

Prior to Slice 2F, candidates could be individually underwritten against an isolated budget, but there was no native surface for comparing multiple candidates side-by-side, deterministically ranking hypotheses by unit profitability, or enforcing portfolio-level paper capital constraints where multiple candidates compete for a limited paper budget.

Slice 2F implements:
1. **Multi-Candidate Side-by-Side Comparison Matrix:** An authoritative matrix exposing all screened and underwritten candidates with their provenance, category, observed timestamps, freshness in seconds, evidence sufficiency score, and unresolved gaps.
2. **Strict Financial Metric Separation:** Prevailing retail ASP, factory-gate quote, gross spread, gross margin (bps), net unit contribution, and contribution margin (bps) are strictly separated. Missing costs remain explicitly unknown (`null` / `UNKNOWN_MISSING`) and are never defaulted to zero or conflated with gross margin.
3. **Deterministic, Explainable Ranking Engine:** Candidates are ranked through deterministic criteria:
   - Primary: Underwriting outcome tier (`ELIGIBLE` $\rightarrow$ `INSUFFICIENT_EVIDENCE` $\rightarrow$ `INELIGIBLE` $\rightarrow$ `PENDING`).
   - Tier 1 Ordering: Net contribution margin (bps) DESC $\rightarrow$ initial cash outlay ASC $\rightarrow$ evidence conviction score (bps) DESC $\rightarrow$ candidate ID ASC (lexicographical stability).
   - Explainability: Every candidate receives a human-readable, deterministic `ranking_rationale` articulating its exact competitive positioning or blocking gaps.
4. **Constrained Portfolio Paper-Capital Allocation Deck:** Enforces cumulative portfolio budget limits. When candidates compete for a limited paper budget, allocations are made in priority order without double-allocating capital. Any candidate exceeding the remaining budget is deferred (`DEFERRED_BUDGET_EXCEEDED`) with explicit reporting of remaining budget, capital required, and exact shortfall in INR.
5. **Single Authoritative State Parity:** The portfolio deck directly updates `WorkstationStateManager` and its projected `OperatorTerminalSnapshot`. REST API (`/api/snapshot`, `/api/candidates/compare`, `/api/portfolio/deck`), Workspace 5 (`capital_allocator`), and the offline Standalone HTML export (`exportStandaloneHtml`) read from the identical authoritative state.

---

## 2. Architectural & Integration Changes

### A. Domain Contracts & Engine Modules
- **`src/research/portfolioAllocationTypes.ts`**:
  - `CandidateComparisonRow`: Full side-by-side comparison row separating gross spread/margin from net contribution/contribution margin, tracking freshness, gap status, and ranking.
  - `PortfolioAllocationItem`: Evaluated candidate item detailing allocation rank, financial metrics, allocated capital, status (`ALLOCATED`, `DEFERRED_BUDGET_EXCEEDED`, `REJECTED_...`), rationale, and remaining budget after allocation.
  - `PortfolioDeferredItem` & `PortfolioRejectedItem`: Explicit records detailing deferred shortfalls or rejection reasons.
  - `PortfolioAllocationDeck`: Portfolio-level record containing configured budget, cumulative allocated capital, remaining budget, utilization bps, allocations, deferrals, and rejections.
- **`src/research/portfolioAllocationEngine.ts`**:
  - `buildCandidateComparisonRows()`: Maps discovered candidates and authoritative underwriting decisions into deterministic comparison rows with strict null preservation for unprovided costs.
  - `evaluatePortfolioAllocationDeck()`: Deterministic sequential rationing engine enforcing cumulative budget limits ($\sum \text{allocated} \le \text{configured}$), maximum single allocation caps, and explicit shortfall tracking.

### B. Authoritative State Manager (`src/server/workstationStateManager.ts`)
- Added internal portfolio budget configuration and current portfolio deck state.
- Automatically recomputes the portfolio allocation deck upon each completed candidate underwriting event (`underwriteDiscoveredCandidate()`).
- Exposed `evaluatePortfolioBudget(options)` to allow operators to adjust portfolio paper budgets dynamically.
- Exposed `compareCandidates()` to produce side-by-side multi-candidate comparison tables directly from discovery screener and underwriting decisions.
- Updated `projectAuthoritativeSnapshot()`:
  - Dynamically updates `capital_allocator.total_paper_budget_inr`, `allocated_paper_capital_inr`, `unallocated_paper_capital_inr`, and `badge` (`[OK]` / `[WARN] ALLOC_CONSTRAINED`).
  - Sets each dynamic row's `allocated_capital_inr` and `conviction_vs_allocation_rationale` to reflect its true portfolio allocation status (e.g. ₹0.00 with shortfall rationale if deferred due to budget rationing).

### C. HTTP API Endpoints (`src/server/workstationServer.ts`)
- **`GET /api/candidates/compare`** (Route 34): Returns side-by-side comparison of all discovered and underwritten candidates.
- **`POST /api/portfolio/evaluate-budget`** (Route 35): Accepts `{ total_paper_budget_inr: number, max_single_allocation_inr?: number }`, validates inputs, re-evaluates the portfolio allocation deck, and broadcasts snapshot updates.
- **`GET /api/portfolio/deck`** (Route 36): Returns the current authoritative portfolio allocation deck.

---

## 3. Mathematical & Economic Determinism Demonstration

To verify the ranking and allocation rules, the engine was tested against three distinct golden fixtures:

| Candidate | ASIN / SKU | Retail ASP | Factory Quote | Gross Spread / Margin | Variable Deductions | Net Contribution / Margin | Landed Outlay (MOQ) | Underwriting Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SS304 Clamps** | `HOWRAH-SS304-16-25` | ₹85.00 | ₹25.00 | ₹60.00 (7,059 bps) | ₹25.85 (freight ₹3.5, pack ₹3, fees ₹10.2, tax ₹7.65, drag ₹1.5) | ₹34.15 (**4,018 bps**) | ₹3,150.00 (MOQ 100 landed) | `ELIGIBLE` |
| **Brass Valve** | `JAMNAGAR-BRASS-15MM` | ₹320.00 | ₹115.00 | ₹205.00 (6,406 bps) | ₹95.00 (freight ₹15, pack ₹10, fees ₹40, tax ₹25, drag ₹5) | ₹110.00 (**3,438 bps**) | ₹7,000.00 (MOQ 50 landed) | `ELIGIBLE` |
| **SaaS Tool** | `unpriced-saas-tool` | `null` | `null` | `null` | Missing domain cost inputs | `null` (**`null`**) | `null` | `INSUFFICIENT_EVIDENCE` |

### Ranking Derivation:
1. **Rank 1:** SS304 Clamps. Higher net contribution margin (40.18% > 34.38%), lower initial cash outlay (₹3,150.00 vs ₹7,000.00), complete verified evidence.
2. **Rank 2:** Brass Valve. Viable net contribution margin (34.38%), higher capital outlay (₹7,000.00).
3. **Rank 3:** SaaS Tool. Missing critical pricing and cost inputs; fails closed against capital allocation.

### Budget Rationing Scenarios:
1. **Constrained Budget (₹5,000.00):**
   - Rank 1 (SS304) requires ₹3,150.00 $\le$ ₹5,000.00 $\rightarrow$ **`ALLOCATED` ₹3,150.00**. Remaining budget: ₹1,850.00.
   - Rank 2 (Brass Valve) requires ₹7,000.00 > ₹1,850.00 $\rightarrow$ **`DEFERRED_BUDGET_EXCEEDED` ₹0.00**. Shortfall: ₹5,150.00.
   - Rank 3 (SaaS Tool) $\rightarrow$ **`REJECTED_INSUFFICIENT_EVIDENCE` ₹0.00**.
   - Cumulative Allocated: strictly ₹3,150.00 $\le$ ₹5,000.00.
2. **Expanded Budget (₹12,000.00):**
   - Both candidates fit: ₹3,150.00 + ₹7,000.00 = ₹10,150.00 $\le$ ₹12,000.00.
   - Rank 1 $\rightarrow$ **`ALLOCATED` ₹3,150.00**.
   - Rank 2 $\rightarrow$ **`ALLOCATED` ₹7,000.00**.
   - Remaining Budget: ₹1,850.00. Deferred count: 0.
3. **Max Single Allocation Cap (₹4,000.00 within ₹12,000.00 Budget):**
   - Rank 1 (SS304) requires ₹3,150.00 $\le$ ₹4,000.00 $\rightarrow$ **`ALLOCATED` ₹3,150.00**.
   - Rank 2 (Brass Valve) requires ₹7,000.00 > ₹4,000.00 cap $\rightarrow$ **`DEFERRED_BUDGET_EXCEEDED` ₹0.00**. Shortfall: ₹3,000.00 against single cap.

---

## 4. Verification & Acceptance Results

### A. Acceptance Suite 59 (`tests/acceptance/suite59_slice2f_multi_candidate_decision_workflow.test.ts`)
```
✓ S59-001: ingests multiple fixtures and surfaces them side-by-side in GET /api/candidates/compare (71ms)
✓ S59-002: enforces strict separation between gross spread/margin and net contribution/margin (51ms)
✓ S59-003: ranks candidates deterministically with higher net contribution margin first and explainable rationale (10ms)
✓ S59-004: strictly prohibits capital allocation to unverified or insufficient evidence candidate (3ms)
✓ S59-005: evaluates constrained ₹5,000 budget, allocating to Rank 1 and deferring Rank 2 with explicit shortfall (10ms)
✓ S59-006: expands budget to ₹12,000 allocating both candidates, and enforces max single allocation limit (6ms)
✓ S59-007: confirms state parity between GET /api/snapshot, capital allocator workspace, and standalone export (9ms)
✓ S59-008: preserves investigation lease fencing, task queue integrity, and Slice 2E regression immunity (4ms)

Test Files:  1 passed (1)
Tests:       8 passed (8)
Duration:    2.92s
```

### B. TypeScript Compilation (`tsc`)
```bash
cmd.exe /c npm run build
> market-hft-os@0.1.0 build
> tsc
# Exited with code 0 (zero errors, strict mode compliant)
```

### C. Full Platform Regression Suite
```bash
cmd.exe /c npx vitest run --exclude **/suite42*

Test Files:  60 passed (60)
Tests:       704 passed (704)
Duration:    73.66s
```
*100% test pass rate across all 60 acceptance and integration suites; zero regressions introduced.*

---

## 5. Artifacts and Working Tree Integrity

- **New Source Files (Untracked):**
  - `src/research/portfolioAllocationTypes.ts`
  - `src/research/portfolioAllocationEngine.ts`
  - `tests/acceptance/suite59_slice2f_multi_candidate_decision_workflow.test.ts`
- **Modified Existing Files (Unstaged):**
  - `src/server/workstationStateManager.ts` (Integrated portfolio allocation engine, state methods, and snapshot projection)
  - `src/server/workstationServer.ts` (Exposed Routes 34, 35, 36)
- **Preservation Policy:**
  - Zero git staging performed (`git add` not invoked).
  - Zero commits performed (`git commit` not invoked).
  - Zero resets or discards performed (`git reset` / `git clean` not invoked).
  - Loopback network confinement strictly preserved (127.0.0.1 only).

---

## 6. Known Limitations & Recommendations

1. **Static Seed Candidates in Workspace 5:** At cold boot before dynamic candidates are underwritten, the two static baseline seed opportunities (`CAND-SS304-16-25MM-P10`, `CAND-SS304-20-32MM-P20`) populate the table to satisfy legacy M7.0/M7.1 readiness criteria. Once dynamic candidates are screened and underwritten, dynamic candidates are ranked and prioritized in the portfolio deck.
2. **Single Currency Model:** All budget and landed cost rationing calculations operate in exact Indian Rupees (INR) with rational BigInt subunits. Multi-currency cross-border trade financing will be evaluated in subsequent milestones.
3. **Stage 2 Reservation Ledger:** The portfolio evaluation deck accurately models cumulative paper-budget rationing and deferrals in memory and snapshot projections. The Stage 2 persistent reservation ledger across restart cycles remains frozen as planned.

---

## 7. Next Steps & Stop for Review

Slice 2F is complete, fully verified, and ready for Project Owner inspection.

**Execution stopped.** Awaiting Project Owner review and directive for the next milestone.
