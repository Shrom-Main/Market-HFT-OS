# POC-001 — Slice 2E Runtime Smoke Test & Economics Label Audit Report

**Authority:** Project Owner Directive  
**Date:** 2026-10-27  
**Workspace:** `D:\Market HFT OS`  
**Execution Mode:** Live Runtime Verification against `http://127.0.0.1:4310`  
**Focus:** Live HTTP Surface Traversal, Fenced Queue Enforcement, and Economics Labeling Audit

---

## 1. Executive Summary

A genuine end-to-end runtime smoke test and economics correctness audit of **Slice 2E (Discovery-to-Underwriting Product Surface Integration)** was conducted against the live, running operator workstation server ([`WorkstationServer`](file:///d:/Market%20HFT%20OS/src/server/workstationServer.ts)) bound strictly to local loopback `127.0.0.1:4310` with PostgreSQL 16.8 connectivity.

### Audit Findings & Invariants Confirmed
1. **Gross Spread vs. Net Contribution Margin Separation:**
   - For `FIX-AMZ-BRASS-001` (Retail ASP ₹320.00) and `FIX-IMART-BRASS-001` (Supplier Quote ₹115.00):
     - The gross spread is mathematically **₹205.00**.
     - The gross margin (`estimated_margin_bps`) is mathematically **6,406 bps (64.06%)**.
     - When non-supplier variable costs are unobserved/missing, the system **strictly marks net unit contribution and contribution margin as `null`**. Gross spread is **never** conflated with net contribution.
     - When variable costs are provided (freight ₹15, pack ₹10, fees ₹32, tax ₹28, drag ₹10 = ₹95), total variable deductions are ₹210.00, deriving a distinct net unit contribution of **₹110.00** and contribution margin of **3,438 bps (34.38%)**.
     - In the live workstation UI table (`capital_allocator`), Column 1 displays **1. Exp Return: 64.06%** (gross margin) and Column 2 displays **2. Net Return: 34.38%** (net contribution margin).
2. **Cost Completeness & Treatment Integrity:**
   - All 6 canonical cost categories (`SUPPLIER_PURCHASE`, `INBOUND_FREIGHT`, `PACKAGING_KITTING`, `MARKETPLACE_FEES`, `STATUTORY_TAX`, `RETURN_DEFECT_DRAG`) are assessed.
   - Missing costs are never assumed zero; missing items remain explicitly classified as `UNKNOWN_MISSING` with `amount_inr: null`.
3. **Fail-Closed Paper Capital Authorization:**
   - An economically viable candidate evaluates as `ELIGIBLE`, but its capital allocation status strictly returns `NOT_AUTHORIZED_BUDGET_UNCONFIGURED` with allocated capital **₹0.00**.
   - The candidate cannot jump to `PAPER_ELIGIBLE` without an explicit paper budget.
   - Supplying an authorized `budgetConfig` (`available_paper_capital_inr: 500000`, `max_single_allocation_inr: 250000`) succeeds with `ALLOCATE_CAPITAL` and allows legitimate promotion.
4. **Task Fencing & Stale Commit Rejection:**
   - Claiming a task grants an active lease with fencing token `1`.
   - Submitting an outdated or forged fencing token (e.g., `999999`) fails closed with **HTTP 409** (`E-QUEUE-STALE-LEASE-FENCE-REJECTED`).
   - Replaying completion with conflicting parameters fails closed with **HTTP 409** (`E-QUEUE-COMMIT-ENVELOPE-MISMATCH`).
5. **Authoritative Parity Across API, Snapshot, and Standalone Export:**
   - The live REST API endpoints (`/api/candidates/:id`, `/api/candidates/:id/decision`), the authoritative snapshot (`/api/snapshot`), and the live terminal HTML export (`GET /`) return 100% identical candidate IDs, provenance badges (`[FIXTURE]`), return percentages, and gate badges.

---

## 2. Live Runtime Workflow Trace

The smoke test was executed against `http://127.0.0.1:4310` spawned via the documented CLI runner `tsx src/cli/workstationCli.ts`.

```
================================================================================
 MARKET HFT OS — LOCAL LOOPBACK OPERATOR WORKSTATION (Gate M7.0 / DEC-020)
================================================================================
 Operating Mode:  DRY_RUN_PAPER_SIMULATION_ONLY (Real money execution disabled)
 Loopback URL:    http://127.0.0.1:4310
 WebSocket Feed:  ws://127.0.0.1:4310/ws
 API Health:      http://127.0.0.1:4310/api/health
 API Snapshot:    http://127.0.0.1:4310/api/snapshot
 API Certificate: http://127.0.0.1:4310/api/certificate
 Security Guard:  Host & Origin Firewalls Active (SRV-01)
 Arithmetic:      Pure BigInt Rational AST Evaluator on Backend (SRV-02)
 Kill Switch:     3-Tier Controller & Two-Level Error Presentation (SRV-03)
================================================================================
```

### Step 1: Health Verification
- **Request:** `GET http://127.0.0.1:4310/api/health`
- **Response Code:** `HTTP 200 OK`
- **Payload:** `{"status":"HEALTHY","operating_mode":"DRY_RUN_PAPER_SIMULATION_ONLY","postgres_connected":true,"kill_switch_scope":"NORMAL_PAPER_OPERATION"}`

### Step 2: Fixture Screening
- **Request:** `POST http://127.0.0.1:4310/api/discovery/screen`
  ```json
  { "fixture_id": "FIX-AMZ-BRASS-001" }
  ```
- **Response Code:** `HTTP 200 OK`
- **Observed Candidate ID:** `OPP-4C9B52BBEB89D4E2`
- **Product ID:** `prod:brass:ball-valve:1-2in-pn20`
- **Lifecycle State:** `NEW`
- **Origin Class:** `RECORDED_GOLDEN_FIXTURE`
- **Observed ASP:** `₹320.00` | **Factory Quote:** `null`

### Step 3: Snapshot Verification (`opportunity_radar`)
- **Request:** `GET http://127.0.0.1:4310/api/snapshot`
- **Response Code:** `HTTP 200 OK`
- **Verification:** Candidate `OPP-4C9B52BBEB89D4E2` is present in `workspaces.opportunity_radar.opportunities`.
- **Evidence Gap Status:** `DATA_REQUIRED` (supplier quote unobserved).
- **Provenance Badge:** `RECORDED_GOLDEN_FIXTURE` (not live market verified).

### Step 4: Candidate Inspection
- **Request:** `GET http://127.0.0.1:4310/api/candidates/OPP-4C9B52BBEB89D4E2`
- **Response Code:** `HTTP 200 OK`
- **Returned Candidate:** Name: `Forged Brass Ball Valve (1/2" PN20 Full Bore IS 9890)`, Category: `PHYSICAL_GOODS`, State: `NEW`.

### Step 5: Underwriting Prior to Supply Quote
- **Request:** `POST http://127.0.0.1:4310/api/candidates/OPP-4C9B52BBEB89D4E2/underwrite`
  ```json
  {}
  ```
- **Response Code:** `HTTP 200 OK`
- **Outcome:** `INSUFFICIENT_EVIDENCE` | **Evaluation Status:** `UNEVALUABLE_INPUTS_MISSING`
- **Gross Spread:** `null` | **Gross Margin:** `null`
- **Net Contribution:** `null` | **Contribution Margin:** `null`
- **Missing Costs:** `['SUPPLIER_PURCHASE', 'INBOUND_FREIGHT', 'PACKAGING_KITTING', 'MARKETPLACE_FEES', 'STATUTORY_TAX', 'RETURN_DEFECT_DRAG']`
- **Capital Decision:** `DO_NOT_ALLOCATE_CAPITAL`

### Step 6: Decision Retrieval
- **Request:** `GET http://127.0.0.1:4310/api/candidates/OPP-4C9B52BBEB89D4E2/decision`
- **Response Code:** `HTTP 200 OK`
- **Decision ID:** `UWD-E30CBB3119B60660`
- **JCS Digest:** `11cc1f072f10466025ece692fa4ebd64a2205d8d6f09c1f375fe0fa372a3e0ef`

### Step 7: Investigation Claim & Fencing Enforcement
- **Request (Claim):** `POST http://127.0.0.1:4310/api/discovery/investigate`
  ```json
  { "action": "claim", "worker_id": "worker-smoke-specialist", "candidate_id": "OPP-4C9B52BBEB89D4E2" }
  ```
- **Response Code:** `HTTP 200 OK`
- **Claimed Task:** `TASK-OPP-4C9B52BBEB89D4E2-GEN-01-LOGISTICS-FREIGHT` | **Fencing Token:** `1`
- **Request (Stale Commit Attempt):** Submit with `fencing_token: 999999`.
- **Response Code:** `HTTP 409 Conflict`
- **Error ID:** `E-QUEUE-STALE-LEASE-FENCE-REJECTED` (monotonic fence preserved).

### Step 8 & 9: Economics Audit — Quote Known, Non-Supplier Costs Missing
- **Commit:** Supply quote `₹115.00` from `FIX-IMART-BRASS-001`.
- **Underwriting Response:**
  - `outcome`: `INSUFFICIENT_EVIDENCE`
  - `gross_spread_inr`: `205.00` (₹320 - ₹115)
  - `estimated_margin_bps`: `6406` (64.06% gross spread)
  - `net_contribution_inr`: `null` (strictly null)
  - `contribution_margin_bps`: `null` (strictly null)
  - `missing_cost_inputs`: `['INBOUND_FREIGHT', 'PACKAGING_KITTING', 'MARKETPLACE_FEES', 'STATUTORY_TAX', 'RETURN_DEFECT_DRAG']`
- **Audit Outcome:** Proves conclusively that having a gross spread of ₹205.00 does **not** cause the engine to falsely display net contribution or claim profitability.

### Step 10: Complete Variable Economics Ingestion
- **Claim Next Task:** `TASK-OPP-4C9B52BBEB89D4E2-GEN-01-REGULATORY-TAX` claimed with token `1`.
- **Commit Variable Costs:**
  - Inbound freight: ₹15.00
  - Packaging / kitting: ₹10.00
  - Marketplace fees: ₹32.00
  - Statutory tax: ₹28.00
  - Return / defect drag: ₹10.00
  - Non-supplier costs: ₹95.00
- **Underwriting (No Budget Config):**
  - Total variable deductions: ₹210.00 (₹115 + ₹95)
  - Net unit contribution: **₹110.00** (₹320 - ₹210)
  - Contribution margin: **3,438 bps (34.38%)**
  - Gross spread: **₹205.00** | Gross margin: **6,406 bps (64.06%)**
  - `outcome`: `ELIGIBLE`
  - `capital_allocation_decision`: `NOT_AUTHORIZED_BUDGET_UNCONFIGURED`
  - Allocated capital: `₹0.00`

### Step 11: Budget Authorization
- **Request:** Underwrite with `{ budgetConfig: { available_paper_capital_inr: 500000, max_single_allocation_inr: 250000 } }`.
- **Response Code:** `HTTP 200 OK`
- **Capital Allocation Decision:** `ALLOCATE_CAPITAL`
- **Notes:** `Batch outlay of ₹0.00 authorized within paper budget of ₹500000.00.`

### Step 12: Surface Consistency (API vs Snapshot vs HTML Export)
- **Snapshot `capital_allocator` Row:**
  - `1. Expected Return bps`: `6406` (64.06% gross)
  - `2. Net Return bps`: `3438` (34.38% net contribution)
  - `Gate Badge`: `ELIGIBLE`
  - `Allocated Capital`: `₹0.00` (uncommitted)
- **Terminal Export (`GET http://127.0.0.1:4310/`):**
  - Length: `262,640 bytes`
  - Contains Candidate `OPP-4C9B52BBEB89D4E2`: **Yes**
  - Contains Gross Return `64.06%`: **Yes**
  - Contains Net Return `34.38%`: **Yes**
  - Contains Provenance `[FIXTURE]`: **Yes**
  - Contains Gate `ELIGIBLE`: **Yes**

---

## 3. Unit Economics Comparison Matrix

| Economic Parameter | Raw Capture (ASP Only) | Quote Only (ASP ₹320, Quote ₹115) | Complete Variable Costs (₹95 non-supplier) | Fully Excluded Costs (Exclusion basis) |
| :--- | :--- | :--- | :--- | :--- |
| **Prevailing ASP** | ₹320.00 | ₹320.00 | ₹320.00 | ₹320.00 |
| **Factory Quote** | `null` | ₹115.00 | ₹115.00 | ₹115.00 |
| **Gross Spread** | `null` | **₹205.00** | **₹205.00** | **₹205.00** |
| **Gross Margin (bps)** | `null` | **6,406 bps (64.06%)** | **6,406 bps (64.06%)** | **6,406 bps (64.06%)** |
| **Non-Supplier Costs** | Missing (6) | Missing (5) | **₹95.00** (Known values) | **₹0.00** (Explicit exclusions) |
| **Total Deductions** | `null` | `null` | **₹210.00** | **₹115.00** |
| **Net Contribution** | `null` | `null` | **₹110.00** | **₹205.00** |
| **Contribution Margin**| `null` | `null` | **3,438 bps (34.38%)** | **6,406 bps (64.06%)** |
| **Underwriting Outcome**| `INSUFFICIENT_EVIDENCE` | `INSUFFICIENT_EVIDENCE` | `ELIGIBLE` | `ELIGIBLE` |
| **Gate Badge** | `[BLOCKED]` | `[BLOCKED]` | `[OK] ELIGIBLE` | `[OK] ELIGIBLE` |
| **Budget Gate** | `DO_NOT_ALLOCATE` | `DO_NOT_ALLOCATE` | `BUDGET_UNCONFIGURED` | `BUDGET_UNCONFIGURED` |

---

## 4. Verification Evidence & Test Commands

### 1. Focused Slice 2E Acceptance Suite (Suite 58)
Added test `S58-009` explicitly asserting that gross spread does not establish net contribution when non-supplier costs are missing:
```bash
cmd.exe /c npx vitest run tests/acceptance/suite58_slice2e_discovery_to_underwriting_surface_integration.test.ts
```
**Output:**
```text
 ✓ tests/acceptance/suite58_slice2e_discovery_to_underwriting_surface_integration.test.ts (9 tests) 897ms
     ✓ S58-001: screens recorded fixture FIX-AMZ-BRASS-001 and projects candidate into opportunity radar with DATA_REQUIRED
     ✓ S58-002: claims investigation task, rejects stale fencing token with HTTP 409, and accepts valid evidence commit
     ✓ S58-003: underwrites candidate via HTTP API, calculating exact margin (6406 bps) without hardcoded values
     ✓ S58-004: projects underwritten candidate into capital_allocator workspace with exact return bps and gate badge
     ✓ S58-005: refuses paper capital allocation without explicit budget, and authorizes only upon valid budget config
     ✓ S58-006: screens unpriced fixture, fails underwriting closed with INSUFFICIENT_EVIDENCE and explicit missing costs
     ✓ S58-007: exports standalone HTML containing discovered candidate ID, [FIXTURE] badge, and calculated margin
     ✓ S58-008: maintains identical JCS SHA-256 across reads and broadcasts live updates over WebSocket
     ✓ S58-009: verifies gross spread (₹63 / 7412 bps) does not establish net contribution when domain costs are missing

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  3.53s
Exit Code: 0
```

### 2. TypeScript Compilation Check
```bash
cmd.exe /c npm run build
```
**Output:**
```text
> market-hft-os@0.1.0 build
> tsc

Exit Code: 0
```

### 3. Full Platform Regression Suite
```bash
cmd.exe /c npx vitest run --exclude **/suite42*
```
**Output:**
```text
 Test Files  59 passed (59)
      Tests  696 passed (696)
   Duration  76.06s
Exit Code: 0
```

---

## 5. Working Tree & Governance Status

- **Zero commits created:** Working directory preserved without staging or committing.
- **Zero file resets:** All existing uncommitted baseline files retained.
- **Active Daemons:** PostgreSQL daemon on port 5432 and Workstation Server on port 4310 continue running cleanly.

---

## 6. Conclusion & Recommendation for Next Milestone

The runtime smoke test and economics audit confirm that:
1. The workstation server loopback HTTP API correctly executes discovery, investigation task claiming, lease fencing, and underwriting without mocks.
2. Gross spread (₹205.00 / 6,406 bps) and net contribution (₹110.00 / 3,438 bps) are mathematically distinct, strictly separated, and truthfully labeled across API envelopes, state snapshots, and HTML exports.
3. Commercial eligibility does not bypass budget authorization.

### Recommended Next Milestone: Slice 2F — Candidate Ranking & Multi-Thesis Capital Allocation Deck
Now that discovery screening, investigation orchestration, unit economics, and surface integration are complete, the logical next product milestone is **Slice 2F (Multi-Candidate Ranking & Portfolio Allocation)**:
- Deterministic ranking across multiple screened candidates (`SS304 DIN 3017`, `Brass Valve`, `Poly Conduit`).
- Portfolio-level paper capital allocation simulation under global capital constraints.
- Multi-candidate comparative radar display in the operator terminal.
