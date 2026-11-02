# POC-001 — External Repository Salvage Audit Report v1.2
**Read-Only Static Inspection, Provenance Review & Cross-Repository Reuse Matrix**

**Document Status:** PROPOSED — awaiting project-owner formal review  
**Date:** 2026-10-10  
**Supersedes:** External Salvage Report v1.1  
**Operating Mode:** Strict Read-Only Source Inspection (No dependencies installed; no code executed; no root Git initialization)  
**Quarantine Location:** `D:\Market HFT OS\_salvage\external\`  
**Target Pool:** 7 candidate repositories compared against legacy baseline `D:\Market HFT OS\_salvage\AIStudio`

---

## 1. Executive Summary & Audit Limitations

An empirical, read-only source inspection was conducted across seven candidate repositories cloned into `D:\Market HFT OS\_salvage\external\` alongside the recovered legacy codebase at `D:\Market HFT OS\_salvage\AIStudio`. Each repository was inspected statically at an exact, pinned commit SHA.

### 1.1 Authoritative Scope Boundary
This report evaluates candidate repositories for potential architectural inspiration, data adapter design, research workflows, and component reuse. **This report does not authorize indiscriminate code migration, file copying, or root repository initialization.**

### 1.2 Key Audit Findings & Owner Directives
1. **Confirmed First-Party Ownership (`AIStudio` & `RANDOM`)**:
   - The project owner has explicitly affirmed sole ownership of both `AIStudio` and `RANDOM` (*"It's mine, I own this AIstudio product"*, *"This is mine"*). Legal reuse rights and intellectual property permissions for both repositories are established as first-party assets.
   - `RANDOM` (commit `55d5701`) implements a **Global Temporal Investment Graph & Statutory Partnership Tax Engine** (§ 704(c), § 743(b), § 754, § 751, § 752). While its primary tax domain is distinct from Strategy #1 (physical-product arbitrage), its underlying temporal analysis mechanics, discrete state transition bridge, and UI/architecture patterns are confirmed as available for selective adaptation.
2. **Continuous Research Pipeline & Local Browser Agent (Architecture Roadmap TODO)**:
   - The market data monitoring, historical polling, and web research patterns in `RANDOM` (SEC EDGAR, EulerPool, Alpaca paper trading, and TinyFish web research) establish the blueprint for an automated continuous research pipeline.
   - **Architectural TODO**: Design a continuous research agent that monitors market data feeds, polls for historical patterns, detects candidate anomalies, and triggers the **local browser agent** for deep, autonomous web verification and evidence capture.
3. **Open-Source Architectural Learning & Transformative Adaptation**:
   - The project owner has affirmed the project's approach to open-source components: we learn from and substantially transform open-source architectures, adopting good ideas with appropriate credit and attribution.
   - For copyleft-sensitive repositories (`openalgo` AGPL-3.0, `nsepython` GPL-3.0), transformative reimplementation in TypeScript prevents licensing contamination while retaining architectural benefits.
4. **Evidence Discipline & Surveillance (`BrandPulse`)**:
   - `BrandPulse` (commit `7251ad9`) provides the strongest reference for evidentiary discipline: **deterministic z-score spike/crisis detection without LLMs**, **zero-cost recorded test replay** (`BP_FIXTURE_MODE=replay`), and **explicit `raw: {"synthetic": true}` envelope stamping**. Approved for transformative TypeScript implementation.
5. **Declarative Research Workflows (`Brand-building-skills`)**:
   - Permissively licensed under **MIT**, providing 34 clean Markdown agent skills covering brand strategy, competitor branding, positioning, and packaging. Approved for adoption as human-in-the-loop research prompts under MIT attribution.

---

## 2. Repository-Level Inspection Table

All 7 repositories were inspected at pinned commits on 2026-10-10:

| Repository Name | Remote URL | Pinned Commit SHA | Commit Date & Author | Tracked Files | Primary Languages | Declared License / Provenance | Test Framework Found | CI Workflows |
|---|---|:---:|---|:---:|---|:---:|---|:---:|
| **`RANDOM`** | `https://github.com/Shrom-Main/RANDOM.git` | `55d5701ece0b0cbb4c290c0b3e03dd56afa7f6f7` | 2026-10-10 10:22 UTC<br>`AI Studio <bot@aistudio.google.com>` | 87 | TypeScript (43 .tsx, 33 .ts) | **First-Party Owned**<br>(Affirmed by project owner) | In-app automated test modal; no CLI test runner | None |
| **`Bharat-SM-Data`** | `https://github.com/Sampad-Hegde/Bharat-SM-Data.git` | `054102e7e865cd397ac67709065af8564aa1fec3` | 2026-03-24 19:35 IST<br>`Sampad Hegde` | 129 | Python (16 .py, 12 .ipynb) | **Apache-2.0**<br>(Root `LICENSE`); upstream data permissions disclaimed | `tests/` directory with 5 unittest scripts | GitHub Actions (`python-app.yml`) |
| **`nsepython`** | `https://github.com/aeron7/nsepython.git` | `32d82eafcedc3c6db880f83586be690e18f42814` | 2026-10-08 01:37 IST<br>`Aeron7 Inc` | 9 | Python (3 .py) | **GPL-3.0**<br>(Root `LICENSE`) | **None**<br>(Zero test files) | GitHub Actions (`python-publish.yml`) |
| **`openalgo`** | `https://github.com/marketcalls/openalgo.git` | `12e1114657981a3e50dde8c8ce04eb778ae1cf2f` | 2026-10-09 20:52 IST<br>`Kalaiviswa` | 3,494 | Python (1,547 .py), TSX (459), TS (358) | **AGPL-3.0**<br>(Root `License.md`) | Pytest (`tests/` with 120+ test files) | GitHub Actions (CI & Docker builds) |
| **`BrandPulse`** | `https://github.com/Shub3am/BrandPulse.git` | `7251ad900d5a265b4d6c62db524011d2a0a4ad63` | 2026-09-14 21:55 IST<br>`Shub3am` | 359 | Go (114 .go), JSON (109), TS/TSX (50) | **Open-Source Reference**<br>(Attribution on transformative use) | Go test (`go test ./...` with 53 test files) | GitHub Actions (`ci.yml`) |
| **`HotFix`** | `https://github.com/Vaani-pathariya/HotFix-Market-Intelligence-for-D2C-Brands.git` | `99ea1aa453250c509bbcb97088e71c6da34cdcdf` | 2026-03-08 20:59 IST<br>`Vaani` | 56 | Python (25 .py), TSX (8), TS (5) | **Open-Source Reference**<br>(Adversarial scraping violates charter) | **None**<br>(Zero test files) | None |
| **`Brand-building-skills`** | `https://github.com/arnabbagxd/Brand-building-skills.git` | `4a0a8b5b7a0f64bf0fc551978a18a591670a5223` | 2026-06-12 00:21 IST<br>`Arnab Bag` | 42 | Markdown (34 skills), JSON (5) | **MIT**<br>(Root `LICENSE`) | N/A (Declarative Markdown specs) | None |

---

## 3. Deep Component Inspection & Architectural Analysis

### 3.1 `RANDOM` vs `AIStudio.git`: The Twin AI Studio Branches

A direct file-by-file comparison between `D:\Market HFT OS\_salvage\AIStudio` (commit `0c67e26`) and `D:\Market HFT OS\_salvage\external\RANDOM` (commit `55d5701`) established their exact relationship:

```
[Owner-Owned AI Studio Codebase Family]
├── AIStudio.git (Physical Product Arbitrage: SS304 Clamps)
│   ├── calculators.ts (Landed COGS, Amazon Fees, Volume Slabs)
│   ├── financialContract.ts (Frozen Financial Core v1.0, 66 Invariant Tests)
│   ├── equationRegistry.ts (15 Fastener & Freight Models, 22 Fixtures)
│   └── canonicalCatalog.ts (SS304 DIN 3017 Pack Sizes & Dimensions)
└── RANDOM.git (Multi-Asset Fund & Institutional Tax Engine)
    ├── deterministic-tax-engine.ts (IRC §704c, §743b, §754, §751)
    ├── correlation-divergence-engine.ts (Pearson/Spearman p-values)
    ├── canonical-state-bridge.ts (State Transitions & Fund Isolation)
    ├── tinyfishAuditEngine.ts (Web Agent Run Receipts)
    └── Continuous Research Pipeline (Alpaca, SEC EDGAR, EulerPool, Browser Agent Triggers)
```

#### Detailed Findings on `RANDOM`
1. **First-Party Provenance**: Both codebases were developed by the project owner under Google AI Studio. Full legal rights to inspect, adapt, or reuse components are established.
2. **Domain Divergence**:
   - `AIStudio` models physical product inventory, manufacturing batch costs, carton dimensions, volumetric freight penalties, and marketplace commission cliffs in India.
   - `RANDOM` models private equity fund structures, partnership capital accounts, built-in tax gain allocations under IRC § 704(c), § 754 basis adjustments, partner death step-up (§ 1014), and book-tax disparities.
3. **Reusable Mechanics & Architecture**:
   - **Continuous Research Pipeline with Local Browser Agent (TODO)**: `RANDOM`'s pattern of polling external market endpoints (Alpaca, EulerPool) and generating automated audit receipts (`tinyfishAuditEngine.ts`) provides a strong foundation for building our continuous market surveillance agent that triggers the local browser agent.
   - [`deterministic-tax-engine.ts`](file:///d:/Market%20HFT%20OS/_salvage/external/RANDOM/src/engine/deterministic-tax-engine.ts) (524 lines): Implements pure closed-form statutory arithmetic with zero LLM guesswork. Serves as a reference for deterministic tax logic.
   - [`canonical-state-bridge.ts`](file:///d:/Market%20HFT%20OS/_salvage/external/RANDOM/src/engine/canonical-state-bridge.ts) (196 lines): Formalizes discrete state transitions $S_{t+1} = \delta(S_t, e_t, \rho_t)$ and asserts cross-fund memory isolation (`verifyStateIsolation`).
4. **Governed Decision**:
   - Maintain in read-only quarantine until Gate M1+.
   - Architectural patterns, temporal analysis mechanics, and research agent ideas are approved for selective adoption and learning.
   - US partnership tax models remain excluded from the Strategy #1 physical arbitrage engine.

---

### 3.2 Evidence Discipline & Surveillance (`BrandPulse`)

`BrandPulse` is an Indian D2C brand surveillance platform architected as 9 Go microservices communicating via HTTP protocols.

#### Architectural Principles Worth Adopting
1. **Statistical Anomaly Detection Without LLMs**:
   [`agents/bp-detector/rules.go`](file:///d:/Market%20HFT%20OS/_salvage/external/BrandPulse/agents/bp-detector/rules.go) strictly enforces:
   > *"bp-detector never calls a model. The five rules are spike, crisis, review_bomb, influencer_mention and competitor_move, all z-scores and thresholds evaluated over the profile's baseline... A pipeline that decides what counts as a crisis is a model that cannot be audited at 11pm."*
2. **Four-Level Replay Taxonomy**:
   `BrandPulse` demonstrates transport replay (`BP_FIXTURE_MODE=replay go test ./...`). POC-001 adopts a four-level replay taxonomy:
   - **Transport Replay**: Reproduce recorded HTTP network responses bit-for-bit from local JSON recordings.
   - **Parsing Replay**: Generate identical structured observation records from recorded payloads across parser versions.
   - **Economic Replay**: Reproduce identical net contribution, fees, and margins under identical input and engine versions.
   - **Decision Replay**: Reproduce identical commercial recommendations (`KILL`, `SCALE`, `HOLD`) using historical evidence, assumptions, model versions, and risk policies active at decision time.
3. **Typed Evidence Envelopes & Explicit State Transitions**:
   Going beyond a simple boolean flag, POC-001 establishes an orthogonal 4-dimensional typed evidence envelope with fail-closed validation and explicit state transition records.

---

### 3.3 Scraping Evasion & Substandard Engineering (`HotFix`)

#### Exact Evidence Citations of Evasion & Fragility
1. **Anti-Bot Scraping Evasion**:
   In [`backend/app/services/amazon_scraper.py`](file:///d:/Market%20HFT%20OS/_salvage/external/HotFix/backend/app/services/amazon_scraper.py#L5-L10):
   ```python
   # Anti-bot strategy:
   # - Realistic User-Agent and browser headers
   # - Random delays between page loads (3-8 seconds)
   # - Graceful fallback on CAPTCHA or blocking
   ```
   Lines 26–30 define spoofed User-Agents (`Mozilla/5.0...`), and lines 37–48 implement `_is_blocked()` to detect Amazon bot-block signals.
   *Charter Violation*: POC-001 Charter Section 9 explicitly prohibits adversarial scraping and bot-evasion techniques.
2. **Synthetic Data Template Injection**:
   In [`backend/app/services/simulator.py`](file:///d:/Market%20HFT%20OS/_salvage/external/HotFix/backend/app/services/simulator.py#L11-L24): Reviews are generated by concatenating hardcoded names with fixed string templates.
3. **Disposition: REJECT**.

---

### 3.4 Copyleft Risks & Execution Boundaries (`openalgo`, `nsepython`, `Bharat-SM-Data`)

1. **`openalgo` (AGPL-3.0)**:
   - [`License.md`](file:///d:/Market%20HFT%20OS/_salvage/external/openalgo/License.md) enforces AGPL v3.
   - *Policy*: To eliminate copyleft risks, zero code will be copied directly. Abstract gateway and sandbox interfaces are studied, with clean-room TypeScript implementations.
   - *Boundary*: Live broker execution pathways violate POC-001's simulation boundary.
   - **Disposition: STUDY ONLY (Clean-room TypeScript reimplementation)**.
2. **`nsepython` (GPL-3.0)**:
   - In [`nsepython/rahu.py`](file:///d:/Market%20HFT%20OS/_salvage/external/nsepython/nsepython/rahu.py), requests rely on spoofed session headers to evade Akamai Bot Manager on `nseindia.com`.
   - **Disposition: REJECT**. Fragile scraping wrapper; copyleft incompatible.
3. **`Bharat-SM-Data` (Apache-2.0)**:
   - Queries private unauthenticated endpoints of Screener.in and MoneyControl.
   - **Disposition: DEFER**. Defer to Phase 4 benchmarks. Prefer official historical CSV files (RBI / NSE Bhavcopy) over scraping wrappers.

---

### 3.5 Declarative Brand Research Workflows (`Brand-building-skills`)

- **License**: Permissively licensed under **MIT** ([`LICENSE`](file:///d:/Market%20HFT%20OS/_salvage/external/Brand-building-skills/LICENSE)).
- **Content**: 34 clean Markdown skills.
- **Relevant Workflows**:
  - [`skills/competitor-branding/SKILL.md`](file:///d:/Market%20HFT%20OS/_salvage/external/Brand-building-skills/skills/competitor-branding/SKILL.md): Structured workflow for analyzing competitor positioning, price tiering, and claim verification.
  - [`skills/brand-positioning/SKILL.md`](file:///d:/Market%20HFT%20OS/_salvage/external/Brand-building-skills/skills/brand-positioning/SKILL.md): Category differentiation and value proposition mapping.
- **Disposition: SALVAGE WITH LICENSE CONDITIONS** (selective adoption preserving MIT copyright and attribution notices).

---

## 4. Component-Level Candidate Matrix

| Repository | Pinned SHA | Exact Component / File Path | Architectural Role | Provenance / License | Recommended Disposition | Implementation Policy |
|---|:---:|---|---|:---:|:---:|---|
| **`RANDOM`** | `55d5701` | [`src/engine/canonical-state-bridge.ts`](file:///d:/Market%20HFT%20OS/_salvage/external/RANDOM/src/engine/canonical-state-bridge.ts) | State Transition & Isolation Function | First-Party Owned | **STUDY & ADAPT** | Adopt discrete state transition equation $S_{t+1} = \delta(S_t, e_t, \rho_t)$ and multi-entity memory isolation patterns. |
| **`RANDOM`** | `55d5701` | `Continuous Research Pipeline` / `tinyfishAuditEngine.ts` | Continuous Market Surveillance & Agent Trigger | First-Party Owned | **ARCHITECTURE TODO** | Design continuous market monitoring agent that polls feeds and triggers local browser agent for verification. |
| **`RANDOM`** | `55d5701` | [`src/engine/deterministic-tax-engine.ts`](file:///d:/Market%20HFT%20OS/_salvage/external/RANDOM/src/engine/deterministic-tax-engine.ts) | Statutory Tax Calculation Engine | First-Party Owned | **STUDY REFERENCE** | Reference for deterministic statutory tax modeling; domain (US IRC §704c) is excluded from Strategy #1. |
| **`BrandPulse`** | `7251ad9` | [`agents/bp-detector/rules.go`](file:///d:/Market%20HFT%20OS/_salvage/external/BrandPulse/agents/bp-detector/rules.go) | Deterministic Z-Score Anomaly Detector | Open-Source Reference | **TRANSFORMATIVE REIMPLEMENTATION** | Reimplement deterministic z-score spike/crisis algorithms in clean TypeScript; strictly prohibits LLM involvement. |
| **`BrandPulse`** | `7251ad9` | `fixtures/` & `BP_FIXTURE_MODE=replay` | Four-Level Deterministic Replay | Open-Source Reference | **TRANSFORMATIVE REIMPLEMENTATION** | Independently specify and implement transport, parsing, economic, and decision replay in TypeScript. |
| **`openalgo`** | `12e1114` | `openalgo/broker/` | Modular Broker / Sandbox Gateway | AGPL-3.0 Copyleft | **STUDY ONLY** | Study interface boundaries; clean-room TypeScript interfaces to eliminate AGPL copyleft risk. |
| **`Bharat-SM-Data`** | `054102e` | `Bharat_sm_data/Fundamentals/` | Indian Equity & Financial Data | Apache-2.0 | **DEFER** | Defer to Phase 4 benchmark research; prefer official NSE Bhavcopy CSV downloads over unofficial scraping wrappers. |
| **`nsepython`** | `32d82ea` | `nsepython/rahu.py` | NSE REST API Wrapper | GPL-3.0 Copyleft | **REJECT** | Incompatible copyleft license; fragile anti-bot bypass mechanism that breaks under NSE security updates. |
| **`HotFix`** | `99ea1aa` | `backend/app/services/amazon_scraper.py` | Playwright Evasion Scraper | Adversarial Scraping | **REJECT** | Violates POC-001 Charter Section 9 (prohibits adversarial scraping); zero unit tests. |
| **`Brand-building-skills`**| `4a0a8b5` | `skills/competitor-branding/SKILL.md` | Competitor Analysis Workflow | MIT Permissive | **SALVAGE WITH ATTRIBUTION** | Declarative research prompt template; adopt under MIT attribution for Phase 2 qualitative research. |

---

## 5. Refined Salvage Shortlist & Architecture Roadmap

The candidate salvage pool establishes four core design directions:

1. **Continuous Research Pipeline & Local Browser Agent (Architecture Roadmap TODO — Inspired by RANDOM)**:
   - Polling feeds and market data sources continuously to detect anomalies.
   - When a candidate opportunity is detected, dispatch the local browser agent (using Antigravity browser tools) to perform deep, interactive market validation, capture screenshots/DOM receipts, and record cryptographically hashed evidence envelopes.
2. **Four-Level Deterministic Replay (Architectural Pattern — Transformed from BrandPulse)**:
   - Independently specify and implement transport, parsing, economic, and decision replay against static JSON fixture recordings.
3. **Evidence Classification & Fail-Closed Validation (Architectural Pattern — Transformed from BrandPulse)**:
   - Implement the 4-dimensional typed evidence envelope (`OBSERVED`, `EXTERNALLY_PUBLISHED`, `MANUALLY_SUPPLIED`, `SYNTHETIC_TEST`, `SCENARIO`, `FORECAST`, `DERIVED`).
   - Downstream calculations fail closed if required envelope metadata is missing.
4. **Selective Research Prompt Templates (Salvage — Brand-building-skills under MIT)**:
   - Adopt `competitor-branding` and `brand-positioning` as optional human-audited prompt templates for research synthesis, preserving MIT attribution notices.
