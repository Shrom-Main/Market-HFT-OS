# POC-001 — Project Establishment Report

**Date:** 2026-10-10  
**Phase:** 1 — Project Establishment and Context Acquisition  
**Status:** Awaiting project-owner review  
**Workspace:** `d:\Market HFT OS`

---

## Workspace State — Observed Facts

| Item | Finding |
|---|---|
| **Git repository** | **None.** `d:\Market HFT OS` is not a Git repository. No `.git` directory, no version history, no branches. |
| **Application code** | **None.** No source files, configuration files, build artefacts, package manifests, test suites, database schemas or deployment scripts exist in the workspace. |
| **Existing POC codebase** | **Not present.** The corpus documents reference a prior POC-001 implementation (React + TypeScript + Vite, a frozen financial engine, Step 6 work, prior audits). That codebase is not in this workspace. Its current location, condition and recoverability are unknown to me. |
| **What is present** | Nine `.docx` files totalling ≈ 1.5 MB. These constitute the project's research corpus — a series of architectural deliberations, design decisions, operating-model definitions and a staged engineering plan produced in prior conversations (likely in AI Studio / ChatGPT). |

> [!IMPORTANT]
> There is no code to audit, no tests to run, and no prior implementation state to preserve in this workspace. The project begins from a documented design intent and a research corpus, not from a running application.

---

## A. Concise Understanding of POC-001

POC-001 is a **commercial intelligence and market-simulation engine** for discovering, evaluating and monitoring arbitrage opportunities in physical products.

It draws architectural metaphors from high-frequency trading — market data feeds, signal generation, pre-trade risk gates, order management, portfolio construction, surveillance and reconciliation — but applies them to a fundamentally different domain: buying, holding and selling physical goods through marketplaces and trade channels.

The system's initial operating mode is **research and paper simulation**. It does not execute real purchases, commit real capital or modify live marketplace listings. The first real-world test case is SS304 DIN 3017 hose clamps (Product Signal #001), but the architecture must be product-agnostic.

---

## B. The Problem Being Solved and the Intended Operating Model

### The problem

A small commercial operator (initially India-based, selling industrial consumables via Amazon India, B2B channels and potentially other marketplaces) needs to:

1. **Discover** pricing, sourcing and channel inefficiencies across suppliers, manufacturers, marketplaces and geographies.
2. **Quantify** whether an apparent opportunity remains profitable after all costs — acquisition, logistics, marketplace fees, taxes (GST), returns, packaging, advertising, holding costs, financing and capital opportunity costs.
3. **Test** whether identified patterns are genuine, repeatable and predictive — or are artefacts of the model, stale data or survivorship bias.
4. **Monitor** how competition, supply changes, demand shifts, fee changes and external shocks cause an opportunity's edge to decay.
5. **Control capital risk** by enforcing exposure limits, cash-recovery timelines, concentration limits and exit rules.
6. **Learn** by comparing forecasts to subsequent outcomes and updating strategy reliability without rewriting historical evidence.

### The intended operating model

```mermaid
flowchart LR
    A["Observe Reality"] --> B["Discover Edge"]
    B --> C["Test Hypothesis"]
    C --> D["Control Capital Risk"]
    D --> E["Paper Deploy"]
    E --> F["Monitor & Learn"]
    F --> A
    
    style A fill:#e8f4fd
    style E fill:#fff3cd
    style D fill:#fde8e8
```

- **Autonomous discovery loop** — event-driven monitoring, scheduled exploration and hypothesis-driven research allocation, bounded by budgets and policies.
- **Paper portfolio** — simulated positions, simulated cash, simulated transactions. Clearly labelled. Never conflated with real inventory, real orders or real bank balances.
- **Human-gated consequential decisions** — real procurement, real listing changes, real capital commitment require explicit human authorisation, envisioned as a separately approved future stage.

---

## C. The Epistemic Hierarchy — Reality vs. Model vs. Simulation vs. Actuality

The corpus insists (correctly) on maintaining six distinct epistemic categories:

| Category | Definition | Examples |
|---|---|---|
| **1. Observed evidence** | Empirical data with traceable provenance | A marketplace listing scraped at a specific time; a verified supplier quotation |
| **2. Verified / executable offer** | An observation confirmed as actionable | A supplier quote with confirmed MOQ, price, availability and validity period |
| **3. Model assumption** | An explicitly stated input that is not observed | Assumed return rate, demand elasticity, lead-time distribution |
| **4. Forecast** | A model output predicting a future state | Projected sales velocity, expected contribution margin |
| **5. Simulated decision / position** | A paper-trading action within the simulation | A simulated purchase order, a simulated inventory lot, a simulated listing |
| **6. Actual real-world event** | A separately recorded fact about what actually happened | A real purchase, a real customer order, a real bank settlement |

> [!CAUTION]
> The system must enforce these boundaries structurally — in the data model, in the calculation pipeline and in the user interface. A forecast must never silently become observed evidence. A simulated profit must never be presented as realised revenue.

---

## D. Major Functional Capabilities Implied by the Objectives

The corpus converges on six interconnected engines, mapped here to their HFT analogues:

| # | Capability | HFT Analogue | Purpose |
|---|---|---|---|
| **01** | **Market Surveillance & Data Feeds** | Market data feed handlers | Ingest supplier quotes, marketplace listings, B2B prices, fees, commodity indices, availability, demand signals. Normalise, deduplicate, timestamp, provenance-tag. |
| **02** | **Evidence Store & Knowledge Graph** | Reference data, order book | Canonical product/variant/pack/supplier model. Observation envelopes with full provenance. Temporal history. RAG index. Dependency graph. |
| **03** | **Opportunity Detection & Strategy Engine** | Signal generation, alpha research | Identify pricing/sourcing/channel inefficiencies. Calculate expected contribution, capital required, time-to-recovery, edge decay. Rank opportunities by risk-adjusted return on capital over time. |
| **04** | **Deterministic Economic Engine** | Pricing model, P&L engine | Frozen, versioned, independently testable. Landed cost → fees → GST → contribution → cash conversion → break-even → scenario surface. LLMs may assist research; they do not override calculations. |
| **05** | **Pre-Trade Risk & Capital Controls** | Risk management gateway | Capital limits, concentration limits, downside scenarios, working-capital requirements, supplier/SKU exposure, kill switch. Independent of opportunity engine — cannot be bypassed. |
| **06** | **Paper Portfolio, Reconciliation & Surveillance** | Order management, post-trade, compliance | Simulated positions with full lifecycle (proposed → committed → received → listed → sold → settled). Forecast-vs-actual reconciliation. Edge-decay tracking. Opportunity-state machine (investigate → approve → monitor → scale → exit). |

**Cross-cutting capabilities:**
- Emergent market simulation (agent-based: suppliers, competitors, buyers)
- Statistical validation and alpha testing (out-of-sample, baseline comparisons)
- Tail-risk and ruin engine (Monte Carlo, adverse scenarios, cash-flow stress)
- Dependency and contagion analysis (shared suppliers, correlated demand)
- Persistent learning (forecast error tracking, model reliability updates)
- Browser-agent for evidence collection (with SSRF protection, prompt-injection defence, budget controls)

---

## E. Principal Risks

### E1. Financial and economic risks

| Risk | Description |
|---|---|
| **Incorrect unit economics** | Fee structures, GST treatment, return rates, shipping costs or working-capital assumptions may be wrong, producing misleading profitability conclusions. |
| **Simulation-to-reality confusion** | Users or downstream processes may mistake simulated profits for real outcomes, especially as the system matures. |
| **Overfitting to historical data** | Strategies optimised on past data may not survive out-of-sample or changed market conditions. |
| **Capital lock-up** | Slow-moving inventory ties up capital even when accounting shows no loss. The system must model liquidity risk, not just P&L. |
| **Hidden cost omissions** | Holding costs, financing costs, opportunity costs, advertising costs, quality failures and obsolescence may be missing from early models. |

### E2. Evidence-quality risks

| Risk | Description |
|---|---|
| **Stale or unverifiable data** | Scraped prices may be outdated, fictional or not executable. An advertised price is not a confirmed order. |
| **Product identity errors** | Similar-looking SKUs may differ in material, grade, size, pack count or certification. Mis-matching destroys arbitrage analysis. |
| **Survivorship bias** | Only successful listings or price points may be visible; failed products, delisted items and withdrawn suppliers are not observed. |
| **Source reliability variance** | A manufacturer's RFQ response, a marketplace listing and a B2B directory entry carry different credibility and should not be weighted equally. |

### E3. Simulation and modelling risks

| Risk | Description |
|---|---|
| **Emergence ≠ prediction ≠ profitability** | An agent-based model can produce interesting patterns; that does not mean they forecast real outcomes or generate profit. These are three distinct claims requiring escalating evidence. |
| **Model assumptions masquerading as evidence** | Assumed distributions, demand curves or competitor behaviours may dominate results while appearing to be derived from data. |
| **Complexity without validation** | Adding fractal models, evolutionary optimisation or contagion analysis without measured improvement over simple baselines is cost without value. |

### E4. Governance and operational risks

| Risk | Description |
|---|---|
| **No version control** | The workspace currently has no Git repository. Without version history, there is no audit trail, no ability to reproduce prior states and no safe mechanism for concurrent work. |
| **No prior codebase available** | The corpus references an existing POC-001 implementation. It is not present. If it cannot be recovered, the project starts from zero — a different planning baseline. |
| **Scope creep** | The corpus describes an extremely ambitious system. Without disciplined phasing, the project risks building breadth without depth, producing many partially functional modules that cannot be trusted. |
| **LLM boundary enforcement** | The system uses LLMs for research and analysis. Ensuring they cannot silently mutate authoritative financial state requires architectural enforcement, not just policy. |

---

## F. Key Unanswered Product and Architectural Questions

These must be resolved before or during early implementation phases. I am recording them, not answering them speculatively.

### F1. Prior codebase

1. **Does the earlier POC-001 codebase (React + TypeScript + Vite, frozen financial engine, Step 6) still exist?** Where is it? Can it be recovered and brought into this workspace?
2. **If it exists, what is its actual condition?** The corpus calls for an audit before reuse. Has that audit been performed? What were the findings?
3. **If it cannot be recovered, does the project accept starting from a clean implementation?** This changes the roadmap significantly.

### F2. Data and evidence

4. **What real-world data is currently available?** Supplier quotes, marketplace observations, transaction history, fee schedules — what has actually been collected, in what format, with what provenance?
5. **What are the initial data-collection targets and permitted sources?** Which marketplaces, supplier directories, B2B platforms and commodity indices should the system observe first?
6. **What are the legal and terms-of-service constraints on automated data collection** from Amazon India, IndiaMART, GeM and other target sources?

### F3. Technology and architecture

7. **What is the target technology stack?** The corpus suggests React + TypeScript + Vite (frontend), Python + FastAPI (backend), PostgreSQL (persistence). Is this confirmed, or should alternatives be evaluated?
8. **What is the deployment target?** Local-only for now? Cloud-hosted (Google Cloud Run suggested)? Hybrid?
9. **Should the initial build be a monolithic application, or should backend services be separated from the start?**
10. **What is the persistence strategy for the initial phases?** Start with local files / SQLite, or establish PostgreSQL immediately?

### F4. Operating model

11. **Who are the intended users?** The project owner only, or a small team?
12. **What is the capital base for paper simulation?** What starting simulated cash, what currency, what constraints?
13. **What is the research budget for automated discovery?** API costs, model inference costs, browser-agent execution costs.
14. **What constitutes "sufficient evidence" to advance from paper simulation to real-world pilot?** What approval process governs that transition?

### F5. Commercial domain

15. **Beyond SS304 hose clamps, what product categories should be prioritised for the discovery engine?**
16. **What are the actual marketplace fee structures, GST rules and return policies that the economic engine must model?** Are reference documents available?
17. **What supplier relationships already exist?** Are there verified quotes, MOQ schedules or payment-term agreements that can seed the evidence store?

---

## G. Proposed Project-Document Structure

The following documents should be created as the project progresses. Documents marked **authoritative** are the source of truth for their domain; all other materials (including chat transcripts, corpus documents and research notes) are informational inputs.

```
POC-001/
├── docs/
│   ├── PROJECT_CHARTER.md              ← Authoritative: scope, objectives, constraints, approval
│   ├── ARCHITECTURE_DECISION_RECORDS/
│   │   ├── ADR-001-*.md                ← Authoritative: each significant design decision
│   │   └── ...
│   ├── DOMAIN_MODEL.md                 ← Authoritative: canonical entities, relationships, invariants
│   ├── EPISTEMIC_FRAMEWORK.md          ← Authoritative: evidence categories, confidence rules, provenance
│   ├── FINANCIAL_ENGINE_SPEC.md        ← Authoritative: deterministic calculation contracts, frozen versions
│   ├── RISK_FRAMEWORK.md              ← Authoritative: capital controls, exposure limits, kill-switch rules
│   ├── SIMULATION_PROTOCOL.md          ← Authoritative: paper-trading rules, simulation-reality boundary
│   ├── ROADMAP.md                      ← Authoritative: phased plan with gates and acceptance criteria
│   ├── GLOSSARY.md                     ← Authoritative: term definitions to prevent ambiguity
│   └── RESEARCH_CORPUS_INDEX.md        ← Informational: index of the .docx files and their key decisions
│
├── src/                                ← Application source code (when implementation begins)
├── tests/                              ← Test suites
├── data/                               ← Seed data, schemas, sample evidence (no secrets)
├── scripts/                            ← Development and operational scripts
├── .gitignore
├── README.md                           ← Project overview and setup
└── CHANGELOG.md                        ← Change history
```

> [!NOTE]
> The nine `.docx` files currently in the workspace are research inputs, not authoritative project documents. Their decisions and design intent should be distilled into the authoritative documents above during the project-definition phase.

---

## H. Staged Plan — From Definition Through Controlled Expansion

### Phase 0 — Project Definition *(current phase)*

| Step | Deliverable | Gate |
|---|---|---|
| 0.1 | Workspace discovery and context acquisition | ✅ Complete (this report) |
| 0.2 | Project-owner review of this report | Awaiting approval |
| 0.3 | Resolve unanswered questions (Section F) — especially prior codebase status | Owner decision required |
| 0.4 | Create `PROJECT_CHARTER.md` with approved scope | Owner sign-off |
| 0.5 | Initialise Git repository | Repository exists with initial commit |
| 0.6 | Distil corpus documents into authoritative project documents | Documents reviewed and approved |

### Phase 1 — Architectural Foundation

| Step | Deliverable | Gate |
|---|---|---|
| 1.1 | Technology-stack decision and ADR | Approved ADR |
| 1.2 | Domain model: Product → Variant → PackOffer → Supplier → Observation → Opportunity | Model reviewed, invariants specified |
| 1.3 | Epistemic framework: evidence categories, provenance schema, confidence model | Framework approved |
| 1.4 | Financial engine specification (or recovery and audit of frozen engine from prior POC) | Contract tests pass; deterministic replay verified |
| 1.5 | Risk-framework specification: capital controls, exposure limits, simulation-reality boundary | Framework approved |

### Phase 2 — Core Implementation (Integrity)

| Step | Deliverable | Gate |
|---|---|---|
| 2.1 | Evidence store: observation envelopes, provenance, temporal history | Import → store → retrieve → trace to source works correctly |
| 2.2 | Product registry: product-agnostic model, identity resolution, pack-size normalisation | A new product category can be added without domain-specific code |
| 2.3 | Deterministic economic engine: landed cost → fees → GST → contribution → cash conversion | Same inputs produce same outputs; contract and adversarial tests pass |
| 2.4 | Scenario laboratory: interactive what-if analysis through the deterministic engine | Scenarios recalculate reproducibly |

### Phase 3 — Risk and Paper Portfolio

| Step | Deliverable | Gate |
|---|---|---|
| 3.1 | Capital model: simulated cash, allocation limits, concentration limits | No simulated commitment bypasses risk rules |
| 3.2 | Paper portfolio: simulated positions with full lifecycle | All simulated balances reconcile |
| 3.3 | Opportunity state machine: investigate → approve → monitor → scale → exit | State transitions follow explicit rules with recorded reasons |

### Phase 4 — Market Intelligence and Strategy Testing

| Step | Deliverable | Gate |
|---|---|---|
| 4.1 | Browser-agent MVP: controlled evidence collection from approved sources | Captures are accurate, provenanced, and subject to budget/security controls |
| 4.2 | Agent-based market simulation: suppliers, competitors, buyers | Emergent patterns can be reproduced from initial conditions |
| 4.3 | Statistical validation: baseline comparisons, out-of-sample testing | Strategies that fail to beat baselines are labelled unproven |
| 4.4 | Tail-risk engine: adverse scenarios, Monte Carlo, cash-flow stress | Ruin probabilities and recovery times are quantified |

### Phase 5 — Surveillance, Learning and Expansion

| Step | Deliverable | Gate |
|---|---|---|
| 5.1 | Forecast-vs-actual reconciliation | Systematic tracking of prediction errors |
| 5.2 | Edge-decay tracking and opportunity-lifecycle alerts | Opportunities expire or deteriorate according to explicit rules |
| 5.3 | Cross-product portfolio analysis: dependency, contagion, diversification | Correlated risks are identified and quantified |
| 5.4 | Controlled real-world readiness assessment | Separately authorised; not automatic |

> [!WARNING]
> Phase transitions require explicit project-owner approval at each gate. No phase should begin until the prior gate has been verified. Estimated durations are deliberately omitted — they depend on answers to the open questions in Section F and the actual complexity discovered during implementation.

---

## I. Assumptions Deliberately Not Made

I have intentionally avoided assuming the following:

| # | Assumption NOT made | Why |
|---|---|---|
| 1 | That the prior POC-001 codebase exists, is recoverable, or is in any particular condition | It is not in this workspace. Its status is an open question. |
| 2 | That any specific technology stack is confirmed | The corpus suggests React/TypeScript/Vite + Python/FastAPI + PostgreSQL, but this has not been approved as a decision for this workspace. |
| 3 | That any real-world market data has been collected | No datasets, price histories, supplier quotes or marketplace observations are present. |
| 4 | That the frozen financial engine (v1.0.0-FROZEN) and its 66 passing tests exist or can be recovered | Referenced in the corpus; not present here. |
| 5 | That marketplace fee structures, GST rules or return policies are documented and available | These are domain inputs the economic engine needs; they have not been provided. |
| 6 | That the browser-agent, RAG, DAG, knowledge graph or any other subsystem has been prototyped | No code of any kind exists in this workspace. |
| 7 | That the system will necessarily use any particular AI/LLM provider | Gemini and Groq are mentioned in the corpus; these are possibilities, not commitments. |
| 8 | That the project is ready for cloud deployment | The corpus discusses Cloud Run and managed PostgreSQL; no deployment infrastructure exists. |
| 9 | That the simulation will be accurate or predictive | Emergence, prediction and profitability are separate claims requiring escalating evidence. |
| 10 | That any prior audit or approval from another environment carries over to this workspace | Each capability must be verified in its actual implementation context. |
| 11 | That the nine `.docx` files represent a complete or final specification | They are a research corpus that informed this report; authoritative documents remain to be written. |
| 12 | That I understand the project owner's commercial domain, operational capabilities or capital position | These are inputs I need, not facts I can infer. |

---

## Next Steps — Awaiting Your Direction

This report is ready for your review. Before proceeding, I need your decisions on:

1. **Prior codebase:** Can the earlier POC-001 implementation be brought into this workspace, or does the project start clean?
2. **Open questions:** Which items from Section F should be resolved before Phase 1 begins?
3. **Report corrections:** Does this report accurately reflect your intent, or are there misunderstandings to correct?
4. **Approval to proceed:** When you are satisfied with the shared understanding, I will begin Phase 0.4 (Project Charter) and Phase 0.5 (Git initialisation).

No code will be written until you approve the project definition.
