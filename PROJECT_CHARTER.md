# POC-001 — Capital-Allocation Research and Market Simulation Platform
## Project Charter v0.2.4

**Document Status:** PROPOSED — awaiting project-owner approval  
**Date:** 2026-10-10  
**Target Repository:** `D:\Market HFT OS` (Workspace Root)  
**Legacy Reference Repository:** `D:\Market HFT OS\_salvage\AIStudio` (Preserved in read-only quarantine)  
**External Research Pool:** `D:\Market HFT OS\_salvage\external\` (Preserved in read-only quarantine)  
**Operating Mode:** Strict Read-Only prior to Gate M0 authorization

---

## 1. Project Overview

### 1.1 Core purpose
POC-001 is a **capital-allocation research and market simulation platform** designed to identify, evaluate, and simulate capital deployments across commercial and financial opportunities. The platform operates on an **evidence-first principle**: no capital allocation — simulated or real — is considered without verifiable, provenance-tracked market evidence.

### 1.2 First active strategy: physical-product arbitrage
The initial implementation focuses on a single end-to-end commercial strategy: **physical-product arbitrage**, beginning with the **SS304 DIN 3017 hose clamp** opportunity identified in the research corpus. This strategy serves as the proof-of-concept for the entire platform architecture: evidence ingestion, economic modeling, risk controls, paper execution, and outcome reconciliation.

### 1.3 Epistemic discipline
The platform maintains strict, uncompromised separation between:
- **Observations** (raw market data, supplier quotes, marketplace fees)
- **Verified offers** (corroborated, actionable commercial terms)
- **Assumptions** (explicit, versioned economic parameters)
- **Forecasts** (model-generated projections with confidence bounds)
- **Paper positions** (simulated executions against simulated capital)
- **Actual events** (real-world transactions, bank movements, and inventory changes)

Under no circumstances may simulation output masquerade as market evidence, nor may unverified assumptions be treated as verified facts.

---

## 2. Platform Architecture Principles

### 2.1 Strategy-agnostic capital allocation
The platform architecture separates **portfolio-level capital allocation** from **strategy-specific economics**:

```
┌─────────────────────────────────────────────────────────────┐
│               PORTFOLIO CAPITAL ALLOCATOR                   │
│   Compares opportunities across strategies using a common   │
│   risk/return/liquidity/recovery-period comparison contract  │
│   Tracks Real vs Paper Money Ratio & Bank Reconciliation    │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
┌──────────────▼──────────────┐┌──────────────▼───────────────┐
│     ACTIVE STRATEGY #1      ││     FUTURE STRATEGIES        │
│  Physical-Product Arbitrage ││  Financial Instruments,      │
│  - Supplier procurement     ││  Digital Products, B2B       │
│  - Marketplace fee schedules││  (Design hypothesis;         │
│  - Inventory holding & GST  ││   comparison benchmarks      │
│  - Packaging, freight, QA   ││   in initial release)        │
└─────────────────────────────┘└──────────────────────────────┘
```

#### Common comparison metrics
Every strategy evaluates and exposes a common set of metrics:

| Metric | Purpose | Reporting Rule |
|---|---|---|
| **Nominal cash return & HPR** | Gross economic result and holding-period return before inflation and tax adjustments | Reported when cash flows are defined |
| **Real (inflation-adjusted) return** | Purchasing-power-preserving result; deflator methodology and period convention documented | Reported when deflator is validated; reports `DATA REQUIRED` otherwise |
| **After-tax return** | Result after estimated tax impact, with tax assumptions versioned independently | Reported when tax schedule is validated; reports `DATA REQUIRED` otherwise |
| **Risk-adjusted return** | Return relative to uncertainty, downside exposure and probability of adverse outcomes | Reported when risk model is validated; reports `DATA REQUIRED` otherwise |
| **Liquidity** | How quickly and at what cost committed capital can be recovered | Documented per channel/asset basis |
| **Holding period** | Duration from capital commitment to recovery | Measured in elapsed days |
| **Capital recovery timeline** | When and under what conditions committed capital becomes available again | Exposes numeric duration when recovered; reports explicit status otherwise |
| **Capital opportunity cost** | Return forgone by deploying capital here rather than in next-best available alternative | Reported distinctly from absolute and relative returns |

#### Common comparison contract
**[C]** The common layer standardises definitions, reporting periods, units, capital basis and disclosure of comparison measures wherever meaningful. It does not assume that different strategy types share identical risk distributions, liquidity characteristics, tax treatments or uncertainty models.

**[C]** **Nominal and real returns are presented as distinct measures when calculable.** Where inflation indices, tax schedules, or deflators are unavailable, unvalidated, or unsupported, the engine must honestly report that measure as unavailable (`DATA REQUIRED` / `DATA INSUFFICIENT`) rather than manufacturing numeric estimates. The same principle applies to after-tax and benchmark-relative performance.

**[C]** The platform must preserve domain-specific measures and disclose non-comparable or insufficiently supported measures. It must not force every strategy into a single composite score or ranking unless a separately specified and validated methodology is approved.

**[C]** Absolute return, benchmark-relative return and capital opportunity cost must be reported distinctly. Opportunity cost must not be deducted twice when the same benchmark is already used to calculate relative performance.

**[C]** Each strategy retains its own **domain-specific economics and risk model**. For physical-product arbitrage, this includes supplier costs, marketplace fees, GST, inventory holding, returns, packaging, shipping, advertising and working capital.

---

### 2.2 Numerical return solver acceptance criteria

**[C]** Acceptance of a numerical return solver (such as an annualized internal rate of return or root-finding algorithm) is defined by its **documented domain of definition, explicit convergence and failure statuses, tested edge cases, and mathematical validity rules** — not by a claim that a particular algorithm universally converges.

#### 1. Versioned policy parameters
**[C]** The search interval (such as $[-0.9999, 100.0]$) and convergence tolerance (such as $\epsilon = 10^{-6}$, max iterations $N = 50$) are **versioned operational policy parameters**, not universal mathematical guarantees. Valid annualized economic returns may theoretically exist outside this interval.

#### 2. Cash-flow structural validity & input taxonomy
**[C]** The solver contract must distinguish among:
- **Zero Initial Outlay ($C_0 = 0$)**: Invalidation of conventional investment multiples (such as Cash-on-Cash multiple or simple HPR), but not necessarily of an IRR calculation if subsequent negative outflows establish a basis.
- **Zero Net Cash-Flow Sum ($\sum C_t = 0$)**: An exact nominal breakeven ($HPR = 0\%$). **A zero net cash-flow sum does NOT, by itself, guarantee a unique 0.0% IRR.** Non-conventional cash-flow sequences can sum to zero yet yield multiple roots (for example, cash flows `[-100, 300, -200]` sum to zero, yet have roots at both $r = 0.0\%$ and $r = 100.0\%$, since $NPV(0) = 0$ and $NPV(1.0) = -100 + 150 - 50 = 0$). The solver must evaluate the actual polynomial NPV equation rather than inferring a unique rate from the net sum alone.
- **Unsupported / Invalid Cash Flows**: Sequences with fewer than 2 transactions, zero total capital outlay across all periods, or cash flows where all non-zero terms share the same sign (zero sign changes). The engine must return `INVALID_CASH_FLOWS` rather than computing a misleading rate.

#### 3. Mathematical prerequisites for boundary inference & non-exhaustive grid scans
**[C]** Inferring that an economic root lies outside the supported search domain from boundary signs (e.g. asserting root $> 100.0$ because $NPV(100.0) > 0$) **strictly requires the assumption of a conventional cash-flow profile** (a single negative outflow followed exclusively by positive inflows), where $NPV(r) = \sum C_t (1+r)^{-t}$ is provably strictly monotonically decreasing for $r > -1$.
**[C]** For non-conventional cash flows with multiple sign changes, $NPV(r)$ is non-monotonic; boundary values do **not** establish the location or existence of roots outside the bracket. In such cases, if no bracket is found, the solver must return `NO_ROOT_FOUND_IN_SEARCH_DOMAIN` rather than inferring an out-of-domain root.
**[C]** A grid scan is a discrete search heuristic, not an exhaustive root finder. It can miss tangential roots or multiple roots between grid points. Multiple sign changes in the cash-flow sequence indicate *potential* multiple IRRs by Descartes' rule of signs, but do not prove that multiple roots exist in the supported domain. The contract must rigorously distinguish:
1. Observed numerical roots (identified by bracketed convergence)
2. Detected ambiguity (multiple sign changes and/or multiple detected roots)
3. Unresolved root existence (discrete search does not prove non-existence outside or between grid points)

#### 4. Explicit solver statuses
The solver contract defines six mutually exclusive, typed statuses:
1. `CONVERGED`: Root found within tolerance $\epsilon$ within the search interval.
2. `NO_ROOT_FOUND_IN_SEARCH_DOMAIN`: Search procedure found no root in the interval; does not prove no root exists elsewhere.
3. `MULTIPLE_ROOTS_DETECTED`: Cash flows yield multiple sign changes, producing multiple qualifying internal rates within the domain. Ambiguity diagnostic reported alongside primary economic root.
4. `OUT_OF_SUPPORTED_DOMAIN`: Returned only when cash flows satisfy monotonicity prerequisites and boundary evaluations prove the root lies outside $[-0.9999, 100.0]$.
5. `INVALID_CASH_FLOWS`: Structurally invalid cash flows (e.g. zero sign changes, zero outlay).
6. `NUMERICAL_FAILURE`: Bracket identified, but solver exhausted iteration budget or encountered arithmetic breakdown.

#### 5. Independent reporting of closed-form metrics
**[C]** In all cases, the platform must expose simple **Holding Period Return (HPR)**, **Cash-on-Cash multiple**, and **Capital Recovery Duration** or their explicit status.
**[C]** For open, incomplete, or unrecovered positions (where cumulative inflows < cumulative outflows), the engine must return an explicit status:
- `Capital Recovery Duration: status = NOT_YET_RECOVERED` (with `duration_days: null`)
- `HPR / CoC: status = OPEN_POSITION` (reported on realized cash flows to date)
The engine must **never force a meaningless or fabricated numeric duration**.

---

### 2.3 Financial investments as benchmarks

**[C]** In the initial implementation, financial investments (e.g. fixed deposits, market indices, inflation-indexed instruments) serve as **comparison benchmarks** — reference points for evaluating whether a commercial opportunity offers returns that justify the additional risk, effort and capital lock-up relative to passive alternatives.

**[C]** Financial investments are **not** an active strategy in the first release. The system does not model, recommend or simulate financial-investment transactions.

**[H]** The architecture should be designed so that financial investments *could* become an active strategy in a future release, if separately approved. This is a design hypothesis, not a current implementation requirement.

---

### 2.4 Geographic scope

**[C]** Global discovery defines the permissible research scope, not a first-release coverage commitment. Initial research prioritisation and evidence collection may be limited by approved budgets, source availability and the India-first commercialisation objective.

**[C]** India is an initial portfolio allocation, not a hard-coded architectural constraint. The system may surface opportunities in other markets if evidence supports them. Acting on such opportunities requires separate approval.

---

## 3. Epistemic Framework & Evidence Model

*Default classification: Commitment.*

### 3.1 Orthogonal four-dimensional evidence model

To prevent conflation between data origin, verification level, and commercial actionability, every evidence record in POC-001 must separate four distinct, orthogonal dimensions:

```
[Typed Evidence Envelope]
├── 1. Evidence Kind (Origin & Epistemic Nature)
│      └── OBSERVED | EXTERNALLY_PUBLISHED | MANUALLY_SUPPLIED | SYNTHETIC_TEST | SCENARIO | FORECAST | DERIVED
├── 2. Verification Status (Epistemic Trust Level)
│      └── UNVERIFIED | PARTIALLY_VERIFIED | VERIFIED | REJECTED | STALE | UNKNOWN
├── 3. Commercial Offer Status (Execution Actionability)
│      └── INDICATIVE_QUOTE | VERIFIED_EXECUTABLE_OFFER | EXPIRED_OFFER | REJECTED_OFFER | NOT_APPLICABLE
└── 4. Provenance & Lineage
       └── Source Identity, Observation Time, Retrieval Time, Product/Pack Identity,
           Parent Evidence References, Transformation/Model Version
```

#### 1. Dimension 1: Evidence Kind (Origin)
- `OBSERVED`: Direct first-party capture of an empirical market event or listing.
- `EXTERNALLY_PUBLISHED`: Published third-party catalogue, tariff, or price schedule.
- `MANUALLY_SUPPLIED`: Direct human input or operator-supplied quotation.
- `SYNTHETIC_TEST`: Injected fixture, simulation stub, or regression test case.
- `SCENARIO`: User-defined parameter set for sensitivity analysis.
- `FORECAST`: Model projection of future states.
- `DERIVED`: Computed output from an equation, analytical model, or cost aggregator.

#### 2. Dimension 2: Verification Status (Epistemic Trust)
- `UNVERIFIED`: Raw capture without corroboration or independent check.
- `PARTIALLY_VERIFIED`: Corroborated by some fields, pending confirmation of critical terms (e.g. MOQ, tax inclusion).
- `VERIFIED`: Formally confirmed by independent corroboration, supplier confirmation, or documentation.
- `REJECTED`: Falsified, contradictory, or failed validation checks.
- `STALE`: Previously verified, but exceeded validity period or freshness threshold.
- `UNKNOWN`: Verification state cannot be determined.

#### 3. Dimension 3: Commercial Offer Status (Actionability)
- `INDICATIVE_QUOTE`: Advertised or estimated price not yet confirmed as binding.
- `VERIFIED_EXECUTABLE_OFFER`: Confirmed actionable offer at stated terms, MOQ, and validity period.
- `EXPIRED_OFFER`: Formerly executable offer whose validity window has elapsed.
- `REJECTED_OFFER`: Offer terms rejected by supplier or failing risk gates.
- `NOT_APPLICABLE`: Non-offer evidence (e.g. commodity benchmark, macroeconomic deflator).

#### 4. Dimension 4: Provenance & Lineage
Every record must retain source identity, observation timestamp, retrieval timestamp, product/pack identity, parent evidence references, and model/transformation version.

---

### 3.2 Evidence promotion state machine & transition rules

**[C]** **Explicit State Transitions**: Evidence promotion must be executed as an **explicit, logged state transition machine** rather than a mutable field overwrite.

```
[SYNTHETIC_TEST / SCENARIO] ──(PROMOTION BLOCKED)──> [OBSERVED / VERIFIED FACT]

[INDICATIVE_QUOTE] ──(Supplier Corroboration Event + MOQ/Terms)──> [VERIFIED_EXECUTABLE_OFFER]
                                                                             │
                                                                   (Procurement Event)
                                                                             │
                                                                             ▼
                                                                   [REALIZED INVENTORY]
```

#### Strict Promotion Invariants:
1. **`SYNTHETIC_TEST` $\rightarrow$ `OBSERVED`**: Strictly prohibited. Injected simulation stubs or fixtures can never transition into observed real-world market evidence.
2. **`SCENARIO` $\rightarrow$ Verified Market Fact**: Strictly prohibited. Sensitivity parameters can never transition into empirical market facts.
3. **Observed Asking Price $\rightarrow$ Executable Supplier Offer**: Requires an explicit corroboration event confirming actionable supplier terms, MOQ, tax inclusion, and delivery timeline.
4. **Verified Quotation $\rightarrow$ Realized Inventory / Margin**: Requires an actual procurement confirmation event (purchase order and receipt).

#### Mandatory Transition Event Record:
Every evidence promotion must emit an immutable event record containing:
- Unique `transition_event_id`
- Pre-transition and post-transition envelope states
- References to supporting corroborating evidence
- Authorized agent or operator identity
- Monotonic audit timestamp
- SHA-256 cryptographic receipt hash

**[C]** **Historical Immutability**: Correcting an earlier observation must generate a new versioned event record rather than silently overwriting the historical basis of prior decisions.

---

### 3.3 Real-money fidelity, capital allocation & reconciliation module

**[C]** **Real-Money Simulation Fidelity**: The platform simulates capital allocation with the discipline of real money. The allocation of balance, seed money, capital contributions, and distributions must form an explicit accounting ledger.

**[C]** **Dual-Ledger Reconciliation Module**: The main dashboard must include an explicit module tracking the **Real Money vs Paper Money Ratio**:
- **Paper Capital Ledger**: Simulated allocations, committed balances, expected proceeds, and simulated return profiles.
- **Real Capital Ledger**: Actual bank account movements, capital injections, supplier disbursements, marketplace payouts, and withdrawals.
- **Reconciliation Checkpoints**:
  1. Manual confirmation via structured verification templates.
  2. Documented reconciliation via uploaded bank statements or marketplace settlement reports.
  3. Slippage & friction tracking: Explicitly measures the gap between simulated paper execution and actual real-money cash recovery.

**[C]** **Scoped Inventory Conservation Identity**: The simulated cash and inventory ledgers must reconcile independently under documented conservation identities. In the initial Strategy #1 physical baseline, inventory conforms to:
$$\text{Opening} + \text{Procured} - \text{Sold} - \text{Damaged} == \text{Closing}$$
$$\text{Opening Cash} + \text{Inflow} - \text{Outflow} == \text{Closing Cash}$$
As operational capabilities expand, additional event types (customer returns, supplier returns, scrap, manual adjustments, and inventory-state transitions) must be incorporated with explicit, auditable conservation rules.

---

### 3.4 Three-tier evidence standard for strategies

**[C]** Three distinct claims, each requiring stronger evidence than the previous:
1. **Emergence**: A market pattern can arise from simulated rules. *(Weakest claim.)*
2. **Prediction**: The pattern provides information about future outcomes beyond a baseline. *(Requires out-of-sample testing.)*
3. **Profitability**: Acting on that information produces positive risk-adjusted returns after all costs. *(Requires economic validation.)*

---

## 4. Economic Engine — Boundaries and Versioning

*Default classification: Commitment.*

### 4.1 Deterministic and independently testable

**[C]** Given the same inputs, assumptions and engine version, the system must produce the same economic result.

**[C]** An LLM may assist with research and explanation but must not silently override deterministic calculations or risk controls.

### 4.2 Assumption independence & honest availability

**[C]** Economic dimensions must be **independently representable and versioned, while unsupported calculations may remain unavailable. The initial release must not fabricate tax, inflation, or benchmark values to satisfy a display requirement.**

| Dimension | Notes | Initial status |
|---|---|---|
| **Acquisition costs** | Supplier price, MOQ, payment terms, freight, customs | To be specified per strategy |
| **Marketplace fees** | Referral, closing, FBA/FBM, advertising, returns processing | To be specified per channel |
| **GST treatment** | Collected on behalf of government ≠ revenue; input tax credit ≠ irrecoverable cost | **[H]** Requires validated tax-rule specification |
| **Income tax** | Estimated separately; not conflated with GST | **[H]** Reports `DATA REQUIRED` if unvalidated |
| **Inflation adjustment** | Nominal and real returns shown separately; deflator methodology documented | **[H]** Reports `DATA REQUIRED` if unvalidated |
| **Financing costs** | Cost of capital, interest on working capital, payment terms | **[H]** Assumptions to be specified and versioned |
| **Capital opportunity cost** | Return forgone by deploying capital here rather than in next-best alternative | **[H]** Benchmark definition to be specified |

---

## 5. Risk Engine and Portfolio Controls

*Default classification: Commitment.*

### 5.1 Pre-trade capital admission controls
Every simulated commitment must pass explicit pre-trade risk checks: available cash, thesis concentration, supplier concentration, maximum downside, working capital lock-up duration, and minimum return threshold. A strategy cannot override these controls.

### 5.2 System-wide kill switch
Immediate halt to simulated commitments when data integrity checks fail, reconciliation discrepancies exceed tolerance, risk parameters breach limits, or manual intervention pauses execution.

### 5.3 Working capital and inventory impairment
Model when capital is actually tied up, when it is recovered, inventory aging, impairment haircuts, and liquidation costs.

---

## 6. Simulation Engine

*Default classification: Commitment.*

### 6.1 Purpose: stress-testing, not reality replacement
Stress-test hypotheses against adverse conditions — supplier failure, price wars, fee hikes, demand shocks — not to produce optimistic scenarios.

### 6.2 Agent-based market simulation
**[H]** Modeling competing sellers, supplier behaviour and buyer preferences through interpretable agent rules is a research hypothesis. It must demonstrate out-of-sample predictive validity before being used for capital decisions.

### 6.3 Separation of concerns
The simulation engine must never modify historical evidence, change verified offer records, or alter deterministic calculations.

---

## 7. Opportunity Lifecycle and Surveillance

*Default classification: Commitment.*

### 7.1 Explicit state machine
`Discovered` → `Investigating` → `Verified` → `Paper Approved` → `Simulated Active` → `Scaling Eligible` → `Decaying / Under Review` → `Exited / Rejected`

### 7.2 Edge decay modeling
Explicitly model deterioration through competitor entry, supplier price increases, marketplace fee changes, demand seasonality, and regulatory standards.

---

## 8. Implementation Boundary & Repository Synchronization

*Default classification: Commitment.*

- **[C]** Development environment: Antigravity on laptop. Sole implementation workspace.
- **[C]** **Root Git Initialization & Legacy Isolation**: Before root Git is initialized in `D:\Market HFT OS`, an explicit root `.gitignore` must exclude `/_salvage/` to prevent embedding or accidental tracking of legacy files.
- **[C]** **Automated Sync & Secret Environment Variable Handling**:
  The secret file `D:\Market HFT OS\GithubPersonalAccessTokenFORAG.env` must be utilized as the secret environment configuration for authenticated GitHub read/write access and automated synchronization scripts. **The contents of this file must never be read, displayed, logged, or checked into version control.**
- **[C]** Initial deployment target: Local-first.
- **[C]** No competing implementations.

---

## 9. Controlled Evidence Collection

*Default classification: Commitment.*

**[C]** Autonomous discovery is explicitly deferred. Before any automated collection system is built, permitted sources, collection rates, source budgets, ToS compliance, security controls, and schemas must be approved. Initial evidence will be small, manually curated or imported, and fully traceable.

---

## 10. Governance & Separate Approvals

*Default classification: Commitment.*

### 10.1 Three independent decision gates
1. **Gate 1 — Charter Approval**: Approves project scope, invariants, first-release boundary, and governance rules (this document).
2. **Gate 2 — Salvage Approval**: Accepts specific audited legacy components, verified remediations, and external reference dispositions.
3. **Gate 3 — Implementation Authorization (Gate M0 Only)**: Authorizes root repository setup, requirements baselining, and component-by-component migration.

*Approval of one gate does not imply authorization of the others.*

### 10.2 Phase gates & decision records
Each phase has explicit acceptance criteria recorded in ADRs. Changes to authoritative documents require versioned updates.

---

## 11. Decision Register

*Default classification: Commitment.*

| ID | Decision | Date | Rationale |
|---|---|---|---|
| **DEC-001** | Legacy code recovery and disposition | 2026-10-10 | Workspace and recovered legacy repo (`_salvage/AIStudio`) are separate until audited and approved. Recovery is non-blocking. |
| **DEC-002** | Strategy-agnostic capital-allocation platform | 2026-10-10 | Common comparison layer with pluggable strategy-specific economics |
| **DEC-003** | Physical-product arbitrage is Strategy #1 | 2026-10-10 | Proves complete chain before expanding |
| **DEC-004** | Financial investments are comparison benchmarks | 2026-10-10 | Reference points for opportunity comparison; not an active strategy in first release |
| **DEC-005** | First implementation proves one complete chain | 2026-10-10 | Validates integrity before expanding breadth |
| **DEC-006** | Technology stack decided after functional requirements | 2026-10-10 | Prevents premature architectural lock-in |
| **DEC-007** | Autonomous discovery deferred | 2026-10-10 | Security, budget, compliance and evidence quality controls come first |
| **DEC-008** | Economic assumptions independently versioned; unavailable dimensions report DATA REQUIRED | 2026-10-10 | Dimensions cannot be conflated; no fabricated data to satisfy display requirements |
| **DEC-009** | Nominal and real returns presented distinctly when calculable | 2026-10-10 | Real return reports DATA REQUIRED if deflator unvalidated; prevents inflation masking capital erosion |
| **DEC-010** | Charter distinguishes commitments from hypotheses | 2026-10-10 | Approved principles authoritative; provisional methods remain hypotheses |
| **DEC-011** | Common comparison contract standardizes reporting | 2026-10-10 | Prohibits forced universal scores; preserves domain measures and reports unsupported fields as DATA REQUIRED |
| **DEC-012** | Numerical return solver acceptance based on domain, statuses, and edge cases | 2026-10-10 | Search brackets are operational policy; boundary inference requires monotonicity; closed-form metrics expose explicit status |
| **DEC-013** | Four-dimensional orthogonal evidence envelope with fail-closed validation | 2026-10-10 | Separates Evidence Kind, Verification Status, Commercial Offer Status, and Lineage; synthetic data cannot become real |
| **DEC-014** | Polynomial evaluation for return solvers; non-exhaustive grid scans | 2026-10-10 | Zero net sum does not imply unique 0% IRR; grid scan is heuristic; distinguishes observed roots from ambiguity |
| **DEC-015** | Explicit evidence promotion state machine | 2026-10-10 | Promotion requires documented transition event, corroborating evidence, and timestamp; historical records immutable |
| **DEC-016** | Real-money fidelity and dual-ledger reconciliation module | 2026-10-10 | Real vs paper money ratio tracked; bank statement / settlement reconciliation module on dashboard |
| **DEC-017** | Secret environment variable configuration for GitHub operations | 2026-10-10 | `GithubPersonalAccessTokenFORAG.env` used for remote operations; never read, printed, or tracked in git |

---

## 12. Staged Plan

### Phase 0 — Project Definition & Governance *(current phase)*

| Step | Deliverable | Gate | Status |
|---|---|---|---|
| 0.1 | Workspace discovery and context acquisition | Discovery report produced | ✅ Complete |
| 0.2 | Legacy repository recovery & independent audit | Salvage Report & Addendum v1.4 completed | ✅ Complete |
| 0.3 | Project Charter produced | This document (v0.2.4) | ⏳ Ready for owner approval |
| 0.4 | Root Git repository initialization & `_salvage/` quarantine | Repository exists with charter as initial commit | Blocked on 0.3 & Gate 3 |
| 0.5 | Create `RESEARCH_CORPUS_INDEX.md` | Corpus documents indexed with key decisions | Blocked on 0.4 |

### Phase 1 — Requirements Baseline and Architecture Decisions

| Step | Deliverable | Gate |
|---|---|---|
| 1.1 | Functional requirements for first-release boundary | Requirements reviewed and approved |
| 1.2 | Technology-stack evaluation and ADR-001 | ADR approved |
| 1.3 | Domain model: canonical entities, strategy interface, common comparison contract | Model reviewed and approved |
| 1.4 | Epistemic framework: evidence schemas, provenance rules, governed assumptions | Framework approved |
| 1.5 | Economic engine specification: Strategy #1 cost model + common comparison measures | Specification approved; contract tests defined |
| 1.6 | Risk-framework specification: capital controls, exposure limits, simulated ledgers | Framework approved |

---

*This document will be maintained under version control once the Git repository is initialized. Changes require explicit project-owner approval and a versioned update.*
