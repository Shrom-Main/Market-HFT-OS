# Market HFT OS (POC-001)

High-Frequency Market Trading Operating System — Core Architecture, Gate M1 Foundation, Gate M2 Execution Engine & Gate M3 Persistence / Crash Recovery (Simulation Milestone).

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4.5-blue.svg)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1.12-green.svg)](https://vitest.dev/)
[![RFC 8785](https://img.shields.io/badge/RFC_8785-json--canonicalize@3.0.1-purple.svg)](https://www.rfc-editor.org/rfc/rfc8785)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16.8-blue.svg)](https://www.postgresql.org/)
[![Status](https://img.shields.io/badge/Gate_M6.8_Conformance-Passing_(257_Tests_/_30_Suites)-brightgreen.svg)]()

---

## 1. Architectural Invariants & Governance Baseline

- **Frozen Specification Baseline**: [`POC-001_Gate_M1_Design_Readiness_Specification.md`](https://github.com/Shrom-Main/ADRs/blob/77eff71c3807c8852b49355f50e814bd75eb90ad/POC-001_Gate_M1_Design_Readiness_Specification.md) (v1.13 Final, pinned to commit `77eff71c3807c8852b49355f50e814bd75eb90ad`, blob `ac8899da3a6dcccb2c612247302e6f57fc566472`).
- **Quarantine Isolation**: All legacy code (`_salvage/AIStudio/`, `_salvage/external/`) is strictly quarantined and git-ignored. Zero imports or execution of legacy salvage code exist in `src/` or `tests/`.
- **Three-State Conformance Model**: All requirements are strictly tracked as `Specified — Pending Verification`, `Design Reviewed`, or `Verified — Test Evidence Recorded`.
- **Epistemic & Operational Boundary**: Gate M3 integrates durable persistence, crash recovery, multi-stream integration, and live PostgreSQL 16.8 concurrency. Market feeds utilize local loopback WebSocket networking (`ws://127.0.0.1`) with fail-closed provenance (`is_authenticated_source_feed: false`). Order execution is simulated via `SimulatedExecutionGateway`. Dual-ledger protection (`ActualsGuard`) strictly isolates simulations from production actuals. Zero live exchange access, real order routing, or actual money movement is permitted or enabled.
- **Gate M4 Research & Capital-Allocation Gate**: Evaluates physical commodity arbitrage vertical slices (DIN 3017 W4 SS304 worm-drive hose clamp) with cryptographic provenance envelopes, exact rational/integer subunit financial and tax arithmetic (GST, TCS, TDS), 7-bucket inventory conservation, working-capital hurdle rate gating, and deterministic edge-decay detection.
- **Gate M5 Signal Bus, 4D Evidence & Group Strategy Simulator Gate**: 6-channel continuous signal bus (`NEWS_TRADE_PRESS`, `YOUTUBE_VIDEO_TRANSCRIPT`, `SOCIAL_FORUM_CHATTER`, `MACROECONOMIC_INDICATOR`, `LATERAL_FINANCIAL_MARKET`, `GOVERNMENT_SCHEME_POLICY`), 4 orthogonal evidence dimensions with fail-closed promotion firewall, 9-stage Deep Research DAG contract, 6-status return vocabulary, and Silo vs. Simultaneous Group Strategy Simulator across the SS304 DIN 3017 matrix (4 sizes x 2 packs) under ₹50,000 treasury budget, correlated LME steel shocks, concentration limits, Conviction vs Allocation separation firewall, and T-Bill sweep.
- **Gate M6 Multi-Agent Research Swarm & Bitemporal Replay Gate**: Governed multi-agent research swarm with strict operational boundary firewall (`AgentSecurityFirewall` prohibiting financial calculations, ledger writes, and unvetted URLs), `TinyFishScopedBrowserAgent` executing scoped read-only web extractions, 4 specialist sub-agents (`MediaAndChatterSubAgent`, `MacroAndLateralMarketSubAgent`, `GovtSchemeAndTaxSubAgent`, `RedTeamReviewerSubAgent`), 9-stage DAG coordinator (`ResearchSchedulerAndManager`) with graceful degraded-mode partial-failure handling, and `BitemporalRestatementEngine` providing immutable $t_0$ decision state reconstruction and non-destructive retrospective restatements under RFC 8785 JCS determinism.
- **Gate M6.1 Capability-Aware MCP Substrate & Broker Gate**: Standardized JSON-RPC 2.0 / MCP tool schema envelopes (`McpToolDescriptor`, `McpToolCallRequest`, `McpToolCallResponse`), `McpServerAdapter` with forbidden capability firewall (shell, SQL, ledger mutation, promotion, order routing, secrets), task-scoped immutable `CapabilityGrant` (`Object.freeze`), `McpCapabilityBroker` enforcing strict SSRF and private/loopback/metadata IP blocking (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`, `localhost`, `0.0.0.0`, `::1`), GET-only methods, redirect blocking, 4-quota enforcement (`requests_made`, `wall_clock_ms`, `payload_bytes`, `tokens_used`), `McpRunLedger` with RFC 8785 JCS hash-chained execution events, conflict-preserving join (`joinSupplementaryClaims`), bitemporal append-only immutability proof with duplicate overwrite prevention (`E-ERR-BITEMPORAL-OVERWRITE`), and genuine subagent wiring.
- **Gate M6.2 Micro-Agent #1 SourceCaptureWorker & 6-Layer DOM Sieve Gate**: Zero-trust extraction pipeline (`src/agents/workers/sourceCaptureWorker.ts`) invoking `mcp://source-capture/http_get_snapshot` strictly via `McpCapabilityBroker`, 6-Layer DOM Sanitization Sieve (`sanitizeHtmlDomSieve` byte cap, active tag purge, anti-cloaking/invisible element purge, attribute allowlisting with `data-min-qty`/`data-max-qty`, Unicode NFC/homograph normalization, and canonical digest), 4-Layer Prompt-Injection & Canary Defense (`InjectionCanaryGuard` zero-LLM BigInt subunit parsing, IndiaMART Deterministic Tiered MOQ Bracket Resolver `resolveTieredMoqPrice`, canary scanner, hardcoded `UNVERIFIED` / `ADVERTISED_LISTING` ceiling, and cryptographic spotlighting), and deterministic fixture replay & live HTTPS GET.
- **Gate M6.3 Micro-Agent #2 MediaAndChatterWorker & Tiered Batch Optimization Gate**: Micro-Agent #2 (`src/agents/workers/mediaChatterWorker.ts`) routing read-only requests exclusively through `McpCapabilityBroker` under tool `mcp://media-corpus/fetch_transcript`, mandatory verbatim citation span verification (`verifyVerbatimCitationSpan` substring matching, 10–280 char bounds), empirical defect rate math (`observed_defect_rate_bps`), hardcoded 4D evidence ceiling (`UNVERIFIED` / `NOT_APPLICABLE`), prompt injection defense (`QUARANTINED_INJECTION`), trigger helper (`evaluateChatterSupplementTrigger`), and Tiered MOQ Batch Optimizer (`evaluateOptimalBatchSize` in `src/research/m5SiloAndGroupSimulator.ts`) with statutory subunit arithmetic under treasury budget and concentration caps.
- **Gate M6.4 Micro-Agent #3 MacroAndLateralMarketWorker & Dynamic Regime Classifier Gate**: Micro-Agent #3 (`src/agents/workers/macroLateralWorker.ts`) routing read-only queries exclusively through `McpCapabilityBroker` under tool `mcp://macro-feeds/query_series`, zero-default series ingestion, pure BigInt FX conversion & physical scrap floor derivation (`derivePhysicalScrapFloor`), Formula-RAG dynamic growth driver evaluation via `FormulaRegistry` pure-BigInt rational AST arithmetic without hardcoding static function calls, Sustained Signal vs Fast Opportunity Regime Classifier (`OpportunityTemporalRegime`, Tactical Horizon Gate `E-MLW-EDGE-DECAYS-BEFORE-CASH-RECOVERY`), and empirical factor efficacy learning ledger (`FactorEfficacyLedger`).
- **Gate M6.5 Micro-Agent #4 GovtAndStatutoryWorker & Formula Non-Mutation Firewall Gate**: Micro-Agent #4 (`src/agents/workers/govtStatutoryWorker.ts`) routing read-only queries exclusively through `McpCapabilityBroker` under tool `mcp://policy-bulletins/fetch_circular`, immutable statutory citation verification (`verifyStatutoryCitation` with CBIC, CBDT, DGFT, MINISTRY_OF_MSME), zero-default statutory series resolution (`E-GSW-STATUTORY-CIRCULAR-REQUIRED`), MSME Section 43B(h) credit ceiling cross-check (`evaluateMsmePaymentTermLimit`, 45d with agreement / 15d without), FormulaRegistry non-mutation firewall (`proposeStatutoryFormulaCandidate` failing closed with `E-ERR-GOV-002` on normative cards), prompt injection quarantine (`E-GSW-PROMPT-INJECTION-DETECTED`), and deterministic RFC 8785 JCS canonicalization.
- **Gate M6.6 Micro-Agent #5 RedTeamAndConflictWorker & Context-Routing State Machine Gate**: Micro-Agent #5 (`src/agents/workers/redTeamWorker.ts`) routing read-only queries exclusively through `McpCapabilityBroker` under tool `mcp://audit-corpus/read_joined_claims` with zero network egress (`allowed_hosts: []`), 7 authoritative red-team adversarial & conflict rules (`RT-01` physical scrap floor defense, `RT-02` strict conflict preservation, `RT-03` high-return illusion defense on advertised listing, `RT-04` metallurgy defect & corrosion chatter contradiction quarantine, `RT-05` statutory MSME Sec 43B(h) credit ceiling enforcement, `RT-06` zero-cost substitution ban on mandatory costs, `RT-07` evidence staleness and future clock skew firewall), hard disposition ceiling (`HOLD_BLOCKED_BY_RED_TEAM`, `REQUIRES_SUPPLEMENTARY_CORROBORATION`, `ELIGIBLE_FOR_HUMAN_REVIEW` with `E-RTW-DISPOSITION-CEILING-BREACH` on `APPROVED_FOR_EXECUTION`), and Deterministic Context-Routing State Machine (`src/agents/scheduler/contextRoutingStateMachine.ts`) coordinating Pass 1 (Horizontal gap-filling across Stages 2, 4, 5), Pass 2 (Supplementary corroboration & conflict-preserving join), and Pass 3 (Red-team audit & deterministic join) under bit-for-bit RFC 8785 JCS canonical attestation.
- **Gate M6.7 Typed DAG Scheduler, Bounded Concurrency, Deduplication & Capital Gate**: Upgrades the multi-agent orchestrator to a typed DAG scheduler (`ContextRoutingStateMachine`, `DagTaskNode`, `DagExecutionPlan`), Kahn-algorithm cycle detection (`validateDagAcyclicity`, `E-DAG-CYCLE-DETECTED`), bounded parallel worker execution (`runBoundedParallel`, default 3 concurrent workers) with deterministic barrier sorting `(pass_number, node_id)` ensuring bit-for-bit identical RFC 8785 JCS digests under asynchronous event loop jitter, idempotent task deduplication (`DEDUPLICATED_REPLAY` without consuming MCP broker quotas), Pass 4 Deterministic Capital Gate connecting 5 micro-agents, Regime Classifier (`SUSTAINED_STRUCTURAL_SIGNAL` vs `FAST_TACTICAL_OPPORTUNITY`), `FactorEfficacyLedger`, and `evaluateOptimalBatchSize` with bitemporal restatements ($t_d$ and $t_k$) in `BitemporalRestatementEngine`, and fail-closed degraded hold / red-team / refutation / tactical edge-decay firewalls.
- **Gate M6.8 Read-Only Operator Terminal Projection, 3-Tier Kill Switch & 12-Point Release Gate**: Full implementation of the Read-Only Operator Terminal Projection Layer (8 logical workspaces: Command Center, Opportunity Radar, Evidence Workbench, Economics Lab, Capital Allocator, Simulation & Positions, Reconciliation & Performance, Risk & System Health), deeply frozen immutability, ban on single vanity profit figures (POC.docx §10.1), 10 required capital-allocation comparison dimensions without composite score, Conviction vs Allocation separation firewall, 3-tier Kill Switch Controller (HALT_NEW_ALLOCATIONS, HALT_ALL_SIMULATION_PROCESSING, ENTER_RECOVERY_ONLY_MODE) preserving 100% of historical records, Two-Level Error Presentation with secret scrubbing and timeout outcome_unknown distinction, self-contained dark-mode HTML5/SVG interactive workstation renderer, and 12-Point Release Gate verification engine with bit-for-bit reproducible RFC 8785 JCS SHA-256 certificate.


---

## 2. Core Production Modules (`src/`)

```
src/
├── agents/             # Multi-agent framework, specialist workers, context DAG scheduler
├── canonical/          # RFC 8785 JCS, currency rational math, product normalization, crypto
├── checkpoint/         # Virtual genesis head and trust anchor verification
├── execution/          # Simulated execution gateway, order books, fill engines
├── feeds/              # Market data normalization, replay buffering, sequence checking
├── financial/          # Cash flow engine, two-tier clearing, outlay recovery, RoPF/XIRR
├── ledger/             # Dual-ledger isolation guard (ActualsGuard, tickets, nonces)
├── mcp/                # Capability-aware MCP broker, JSON-RPC 2.0 substrate, contracts
├── persistence/        # File-backed WAL, crash recovery engine, PostgreSQL adapter, locks
├── portfolio/          # Simulation portfolio, anchored cumulative COGS, positions
├── research/           # SS304 physical vertical slice, formula registry, signal engine
├── simulation/         # End-to-end simulation pipeline coordinator
├── terminal/           # Operator terminal projection, kill-switch engine, HTML/SVG workstation
└── verification/       # 4-claim verification gate, attester auth, commercial reconciliation
```

---

## 3. Pinned Dependencies

All dependencies are strictly pinned with zero semver range operators (`^` or `~`) in accordance with Spec §1.3 and §6.1 (`AUDIT-45`):

| Package | Version | Exact Integrity Hash (SHA-512) / Reference | Purpose |
|---|---|---|---|
| `json-canonicalize` | `3.0.1` | `sha512-xEzkTucfHhDooWOSMOvrlll9oTk6/mXZIerF2DFWA2chHZsnc2zrmAKjVOyDbSYHr0e3Djx9F89nZ3U2Bn+lSw==` | RFC 8785 JSON Canonicalization Scheme (JCS) |
| `ws` | `8.22.0` | Pinned in lockfile | High-performance local loopback WebSocket transport |
| `pg` | `8.23.1` | Pinned in lockfile | PostgreSQL 16.8 ACID persistence and row locking |
| `typescript` | `5.4.5` | Pinned in lockfile | Static typechecker |
| `vitest` | `4.1.12` | Pinned in lockfile | Deterministic test runner |
| `@types/node` | `20.12.7` | Pinned in lockfile | Node.js typings |
| `@types/pg` | `8.23.1` | Pinned in lockfile | PostgreSQL typings |
| `@types/ws` | `8.18.2` | Pinned in lockfile | WebSocket typings |
| `tsx` | `4.23.15` | Pinned in lockfile | TypeScript execution runner |

---

## 4. Reproducible Verification Instructions

### Prerequisites
- Node.js >= 20.12.0 (Verified on Node.js v24.14.0)
- npm >= 10.0.0
- (Optional) PostgreSQL 16.8 on `localhost:5432` for `suite17` native database tests

### Step 1: Clean Installation
```bash
npm ci
```

### Step 2: Strict TypeScript Compilation
```bash
npm run typecheck
```
*Expected output: Exit code 0, zero compilation errors.*

### Step 3: Run Acceptance Test Suite
```bash
# Standard run (skips live PostgreSQL tests cleanly if DATABASE_URL is unset)
npm test

# Full run with live PostgreSQL 16.8 (runs all 249 tests across 29 suites)
$env:DATABASE_URL = "postgresql://postgres@localhost:5432/market_hft_test"
npm test
```
*Expected output: 29 test files passed, 249 tests passed (Exit code 0).*

### Step 4: Generate Machine-Readable Audit Report
```bash
npm run test:json
```
*Generates `test-results.json` recording 29 passed test files and 249 passed tests.*


---

## 5. Acceptance Test Suite Mapping

- **`suite01_serialization.test.ts` (6 tests)**: RFC 8785 JCS canonicalization, KAT-01 (`f656707...`), KAT-02 (`103316c...`), non-finite number rejection.
- **`suite02_currency.test.ts` (6 tests)**: Canonical Money 3-scale registry, KAT-04 Parts A & B (865086, 865260, 779122735535095894 with ₹0.0086 Float64 drift exposure), equity-invariant peak funding.
- **`suite03_promotion_gate.test.ts` (6 tests)**: Two-phase promotion gate, EvaluatorDecisionSigningPayload HMAC (`timingSafeEqual`), CAS optimistic locking, atomic stream head updates.
- **`suite04_historical_exclusion.test.ts` (2 tests)**: Backfilled evidence exclusion (`E-ERR-032`), fail-closed 18-tuple allowlist (`E-ERR-001`).
- **`suite05_claim_derivation.test.ts` (3 tests)**: KAT-05A direct Ed25519 signature proof, KAT-05B gateway endorsement receipt proof (exact 300,000 ms lifetime).
- **`suite06_commercial_reconciliation.test.ts` (4 tests)**: Zero-tolerance matching on unit price (`E-ERR-028`), MOQ (`E-ERR-029`), payment terms (`E-ERR-030`), Incoterms (`E-ERR-031`).
- **`suite07_financial_engine.test.ts` (21 tests)**: Acceptance fixture `REC-OUTLAY-001`, product normalization (`PROD-NORM-NFC-HSN-025`, `HSN-LEGAL-ASSIGNMENT-SYNTAX-032`, `PROD-NORM-DETERMINISTIC-004`, `PROD-COLL-001`, `PROD-NORM-SAFE-003`), physical dimensions, safe-integer volumetric proof (`KAT-03`), inventory quantity bounds (`INV-QTY-BOUND-002`), 7-bucket inventory fuzzing conservation (`PROP-INV-001`), Amazon closing fee monotonicity (`META-FEE-001`), canonical March 2026 SS304 pack-of-10 clamp fixture replay (`HIST-REPLAY-001`), RoPF (`FIN-ROPF-PEAK-007`), CoC, HPR (`FIN-CONV-HPR-008`), XIRR polynomial root solver, committed capital netting, Two-Tier Gross-Clearing ledger (`FIN-GROSS-CLEARING-TIER-037`), transient recovery detection (`FIN-RECOVERY-TRANSIENT-001`), CanonicalMoney/integer subunits and cross-currency guard (`FIN-CASHFLOW-SUBUNITS-002`), and pre-inception timestamp rejection (`FIN-CASHFLOW-PREINCEPTION-003`).
- **`suite08_quarantine_isolation.test.ts` (2 tests)**: Zero legacy imports assertion and `.gitignore` integrity.
- **`suite09_virtual_genesis.test.ts` (2 tests)**: Virtual genesis head convention ($H_{-1} = 0^{64}$) and monotonic hash chaining.
- **`suite10_checkpoint_anchor.test.ts` (3 tests)**: Stream checkpoint trust anchor verification with operational vs historical modes.
- **`suite11_cross_currency.test.ts` (2 tests)**: Cross-currency summation prohibition (`E-ERR-008`), signed oracle FX conversion receipt verification.
- **`suite12_durable_persistence.test.ts` (11 tests)**: PostgreSQL DDL schema validation, exclusive row-locking on first-time stream head initialization (`SELECT ... FOR UPDATE` re-read after `INSERT ON CONFLICT DO NOTHING`), serialized concurrency CAS conflict handling (`E-ERR-037`), 6-path ambiguous commit reconciliation, and stream event `previous_event_hash` hash-chaining verification (`PERSIST-STREAM-HASH-CHAIN-008`).
- **`suite13_market_feed_execution.test.ts` (22 tests)**: Market feed normalization, exact decimal price parsing to integer subunits (`parseDecimalPriceToSubunits` without precision truncation), monotonic sequence enforcement, duplicate rejection, sequence gap buffering & replay, clock skew bounds (`FUZZ-CLOCK-001`, `M2-FEED-SKEW-BOUND-007`), commercial spread dry-run execution, MOQ/expiration gating, and dual-ledger quarantine guard.
- **`suite14_websocket_portfolio.test.ts` (19 tests)**: Local loopback WebSocket streaming transport, exponential backoff, sequence gap recovery, immutable order lifecycle journal (`SimulatedOrderTransitionEvent`), two-step cancellation with fill-cancel race invariance ($Q_{\text{filled}} + Q_{\text{remaining}} \equiv Q_{\text{total}}$), intent idempotency conflict prevention (`E-ERR-039`), and simulation portfolio ledger.
- **`suite15_e2e_simulation_pipeline.test.ts` (13 tests)**: End-to-end simulation coordinator (`SimulationPipeline`), exact aggregate cost basis, anchored cumulative COGS allocation ($A(s) = \operatorname{divideHalfEven}(C_0 \cdot s, Q_0)$) proving strict fill-partition invariance across arbitrary order splits, interleaved purchase epoch transitions, unsupported short-position prohibition (`E-ERR-044`), cumulative quantity overflow guards (`E-ERR-045`), byte-accurate WebSocket payload limits (`Buffer.byteLength`), connection stabilization window preventing endless reconnect retry loops, reproducible event replay producing bit-identical state digests, continuous capital and quantity invariant verification, fault injection recovery, and dual-ledger safety isolation.
- **`suite16_crash_recovery_persistence.test.ts` (18 tests)**: Gate M3 crash recovery and persistence:
  - Conflicting fill ID reuse detection (`E-ERR-046: FILL_IDEMPOTENCY_CONFLICT`) with snapshot atomic invariance (`M3-IDEMPOTENCY-CONFLICT-001`).
  - Idempotent identical fill replay with zero balance mutation or duplicate journal entries (`M3-IDEMPOTENCY-EXACT-REPLAY-002`).
  - Bit-identical deterministic virtual clock & counter ID generator replay producing exact state digests (`M3-DETERMINISTIC-CLOCK-REPLAY-003`).
  - High-fidelity PostgreSQL concurrent `SELECT ... FOR UPDATE` row lock wait queue serialization (`M3-POSTGRES-CONCURRENCY-ROWLOCK-004`).
  - Fail-closed row lock timeout (`E-ERR-038: PERSISTENCE_LOCK_TIMEOUT`) under severe contention (`M3-POSTGRES-LOCK-TIMEOUT-FAILCLOSED-005`).
  - Clean rollback isolation leaving zero dirty events or nonces (`M3-POSTGRES-ROLLBACK-DIRTY-ISOLATION-006`).
  - Ambiguous commit network disconnect reconciliation resolving verified committed promotion stream heads (`M3-POSTGRES-AMBIGUOUS-COMMIT-007`).
  - Connection pool capacity wait queue serialization (`M3-POSTGRES-CONNECTION-POOL-QUEUE-008`).
  - Durable write-ahead recovery journal reconciling orphaned gateway fills after simulated process termination with exact-once accounting parity (`M3-CRASH-FAULT-INJECTION-JOURNAL-RECOVERY-009`).
  - Concurrent multi-symbol WebSocket streaming feeds across separate handlers without cross-talk or sequence gaps (`M3-MULTI-STREAM-CONCURRENCY-010`).
  - In-flight fill recovery with simulated process termination (`M3-CRASH-SEPARATE-PROCESS-RECOVERY-011`).
  - Snapshot persistence roundtrip and verification (`M3-SNAPSHOT-DURABILITY-ROUNDTRIP-012`).
  - Corrupt snapshot rejection with hash-binding validation (`M3-SNAPSHOT-CORRUPT-DIGEST-REJECT-013`).
  - Torn WAL record detection and repair (`M3-WAL-TORN-RECORD-TRUNCATE-014`).
  - Mid-log bit-flip corruption fail-closed rejection (`M3-WAL-INTERIOR-CORRUPTION-FAILCLOSED-015`).
  - WAL write ordering verification (`M3-WAL-WRITE-ORDER-BEFORE-CHECKPOINT-016`).
  - Valid unterminated final record normalization and flush (`M3-WAL-VALID-UNTERMINATED-RECORD-017`).
  - CRLF delimiter normalization, interior blank line resilience, and safe append (`M3-WAL-CRLF-DELIMITER-NORMALIZATION-018`).
- **`suite17_real_postgres_integration.test.ts` (6 tests)**: Real PostgreSQL 16.8 native database integration (running on `localhost:5432`, conditionally gated on `DATABASE_URL`):
  - Live server engine verification (`M3-REAL-POSTGRES-SERVER-VERSION-001`).
  - Real concurrent row-lock serialization across independent PostgreSQL backend connections (`M3-REAL-POSTGRES-ROWLOCK-002`).
  - Real transaction rollback isolation (`M3-REAL-POSTGRES-ROLLBACK-003`).
  - Genuine lost-acknowledgment commit disconnect reconciliation (`M3-REAL-POSTGRES-AMBIGUOUS-COMMIT-004`).
  - Genuine pre-commit socket severance rollback reconciliation (`M3-REAL-POSTGRES-AMBIGUOUS-ROLLBACK-005`).
  - Clean table cleanup, zero row leakage, and repeatability (`M3-REAL-POSTGRES-CLEANUP-REPEATABILITY-006`).
- **`suite18_adversarial_remediation.test.ts` (9 tests)**: Independent audit review notes adversarial remediation suite:
  - Cryptographic gateway receipt binding & cross-offer replay rejection (`ADV-CRYPTO-01`).
  - Attester authority fail-closed revocation & compromise rejection (`ADV-CRYPTO-02`).
  - Exact rational FX scaling, non-positive rate rejection, and trusted oracle authentication (`ADV-FIN-01`).
  - Cash flow timestamp epoch sort, NaN fail-closed validation, and PO lifecycle integrity (`ADV-FIN-02`).
  - Polynomial NPV / XIRR solver convergence and multiple root detection (`ADV-FIN-03`).
  - WAL blank-line byte offset accounting and torn-tail truncation preservation (`ADV-PERSIST-01`).
  - Reverse simulation guard (`E-ERR-025`) and strict JSON duplicate key detection (`ADV-PERSIST-02`).
  - SimulationPipeline offer inventory depletion and expiration (`ADV-SIM-01`).
  - Feed handler non-numeric sequence rejection, crossed-price rejection, and bounded replay buffer (`ADV-SEC-01`).
- **`suite19_actuals_guard_dual_ledger.test.ts` (6 tests)**: Gate M1 SUITE-06 ActualsGuard dual-ledger cryptographic verification:
  - Simulation-to-actuals direct write blocking with `E-ERR-020` (`ACTUALS-GUARD-001`).
  - Actuals-to-simulation direct write blocking with `E-ERR-025` (`SIM-GUARD-002`).
  - Valid Ed25519 `ActualsAuthTicketEnvelope` cryptographic authentication (`ACTUALS-AUTH-003`).
  - Exact 300,000ms ticket validity lifetime enforcement and expiry rejection with `E-ERR-026` (`ACTUALS-AUTH-EXACT-004`).
  - Atomic transaction rollback on actuals write failure (`ACTUALS-TX-ATOMIC-005`).
  - Single-use ticket nonce replay prevention with `E-ERR-023` (`TEST-CONCURRENCY-NONCE-01`).
- **`suite20_m4_ss304_vertical_slice.test.ts` (17 tests)**: Gate M4 end-to-end SS304 physical commodity research and capital-allocation simulation engine:
  - Viable opportunity capital allocation in `PAPER_SIMULATION` mode with exact landed cost ₹38.2100 (`M4-SCENARIO-A-001`).
  - Economic deterioration, fee creep, and return spike edge-decay detection emitting `DO_NOT_ALLOCATE_CAPITAL` (`M4-SCENARIO-B-002`).
  - Cryptographic attestation and unverified signature fail-closed quarantine (`M4-SCENARIO-C1-003`).
  - Stale evidence TTL expiration fail-closed quarantine (`M4-SCENARIO-C2-004`).
  - Missing mandatory evidence fail-closed rejection without silent fallbacks (`M4-SCENARIO-C3-005`).
  - Forward clock skew fail-closed rejection enforcing FUZZ-CLOCK-001 (`M4-SCENARIO-C4-006`).
  - 7-bucket inventory transition audit bitwise conservation (`M4-INVENTORY-CONSERV-007`).
  - Deterministic bit-for-bit decision reproducibility under RFC 8785 JCS (`M4-REPRODUCIBLE-JCS-008`).
  - Verified statutory and cash-conversion cycle sensitivity with MATH-01 to MATH-04 remediation (`M4-STATUTORY-MATH-009`).
  - Formula Registry BM25 retrieval, JCS cryptographic integrity, and test vector execution (`M4-FORMULA-REGISTRY-RAG-010`).
  - CANDIDATE_UI_MODEL sandboxing prevents unpromoted execution in production (`M4-FORMULA-GOVERNANCE-ISOLATION-011`).
  - Groq API credentials loaded and verified from Groq_Key.env with fallback support (`M4-GROQ-CREDENTIALS-012`).
  - LLM candidate proposal generation produces schema-compliant FormulaCard with deterministic fallback (`M4-GROQ-ADVISOR-PROPOSAL-013`).
  - LLM candidate evaluation registers card, validates test vector, and governance firewall prohibits unpromoted execution in production (`M4-GROQ-ADVISOR-EVAL-ISOLATION-014`).
  - Pure BigInt rational AST evaluation computes fractional bps without IEEE-754 precision loss on values > MAX_SAFE_INTEGER (`M4-PURE-BIGINT-RATIONAL-AST-015`).
  - Local RAG sufficiency gate resolves existing statutory/economic concepts via RAG_CACHE_HIT and deterministic rules via DETERMINISTIC_APPEND with zero LLM calls (`M4-RAG-FIRST-SUFFICIENCY-GATE-016`).
  - Multi-step lifecycle proves asymptotic LLM decay flywheel, RAG-refined prompt injection, and persistent corpus reload (`M4-ASYMPTOTIC-LLM-DECAY-FLYWHEEL-017`).
- **`suite21_m5_silo_group_and_signals.test.ts` (7 tests)**: Gate M5 6-channel signal bus, 4D evidence architecture, and Silo vs. Simultaneous Group Strategy Simulator:
  - 4D evidence dimensions and fail-closed promotion firewall blocking illegal promotion to verified offer without cryptographic attestation or corroboration (`M5-4D-EVIDENCE-ORTHOGONALITY-001`).
  - Normalization of testable signals across all 6 operational channels into typed economic factor shocks with JCS integrity and 9-stage DAG pipeline contract (`M5-SIX-CHANNEL-SIGNAL-INGEST-002`).
  - 6-status return vocabulary distinguishing incomplete and unrecovered lifecycles rather than collapsing to 0% return (`M5-SIX-STATUS-VOCABULARY-003`).
  - SS304 DIN 3017 matrix evaluation across 4 diameters and 2 pack hypotheses with price/breakeven bands, J-curve cash-flow series, and Arbitrage Greeks (`M5-SILO-PACK-SIZE-MATRIX-004`).
  - Simultaneous group simulation under ₹50,000 treasury budget, correlated LME steel shock, concentration limits, discrete MOQ lot-sizing, and sovereign T-Bill cash sweep (`M5-SIMULTANEOUS-GROUP-CORRELATION-005`).
  - Conviction-allocation firewall strictly allocating ₹0 capital to unverified advertised listings while funding verified offers (`M5-CONVICTION-VS-ALLOCATION-SEPARATION-006`).
  - Bit-for-bit RFC 8785 JCS determinism and SHA-256 digest reproducibility across simulation runs (`M5-TRADING-CHART-JCS-DETERMINISM-007`).
- **`suite22_m6_agent_swarm_and_bitemporal.test.ts` (7 tests)**: Gate M6 governed multi-agent research framework, scoped browser extraction, and bitemporal replay:
  - Scoped TinyFish browser agent extracts structured market data while blocking unapproved domains, non-GET methods, and execution attempts (`M6-TINYFISH-SCOPED-BROWSER-001`).
  - Agent security firewall strictly blocks financial math hallucination, code generation, ledger writes, and production promotion attempts (`M6-AGENT-SECURITY-FIREWALL-002`).
  - Specialist sub-agent swarm processes multi-channel inputs and red-teams unverified signals into typed factor shocks with JCS hashing (`M6-SPECIALIST-SWARM-COLLABORATION-003`).
  - Degraded-mode resilience allows research DAG completion and capital preservation when individual sub-agents timeout or fail (`M6-DEGRADED-MODE-RESILIENCE-004`).
  - Red-team reviewer sub-agent identifies false-positive arbitrage, unverified suppliers, and seasonal demand traps with mandatory human review flags (`M6-RED-TEAM-ADVERSARIAL-SCRUTINY-005`).
  - Bitemporal restatement engine reproduces $t_0$ decision state and computes retrospective restatement deltas without mutating historical records (`M6-BITEMPORAL-REPLAY-AND-RESTATEMENT-006`).
  - End-to-end multi-agent research tick produces bit-for-bit identical telemetry, signal hashes, and decision digests under RFC 8785 JCS (`M6-END-TO-END-POLISH-AND-PRESENT-JCS-007`).
- **`suite23_m6_1_mcp_substrate_and_broker.test.ts` (8 tests)**: Gate M6.1 capability-aware MCP substrate, read-only micro-agent broker, and hardened bitemporal store:
  - JSON-RPC 2.0 / MCP tool schema envelopes & McpServerAdapter forbidden capability firewall (`MCP-SUBSTRATE-SCHEMA-AND-FORBIDDEN-TOOLS-001`).
  - Deeply frozen CapabilityGrant & strict broker policy on allowed tools, allowed hosts, GET-only methods, and redirect blocking (`MCP-BROKER-CAPABILITY-AND-HOST-POLICY-002`).
  - Strict SSRF & private IP / loopback / metadata egress blocking across IPv4 and IPv6 (`MCP-BROKER-SSRF-PRIVATE-IP-BLOCK-003`).
  - Multi-quota deterministic enforcement across all 4 resource dimensions: requests_made, wall_clock_ms, payload_bytes, tokens_used (`MCP-BROKER-MULTI-QUOTA-ENFORCEMENT-004`).
  - McpRunLedger append-only hash chains under RFC 8785 JCS with fail-closed tampering detection (`MCP-RUN-LEDGER-HASH-CHAIN-005`).
  - Conflict-preserving supplementary claims join without averaging, voting, or guessing (`MCP-SUPPLEMENTARY-CONFLICT-JOIN-006`).
  - Bitemporal decision immutability proof, duplicate overwrite rejection (`E-ERR-BITEMPORAL-OVERWRITE`), and distinct $t_d$ / $t_k$ timestamps (`MCP-BITEMPORAL-IMMUTABILITY-PROOF-007`).
  - Full research scheduler worker invocation verifying genuine sub-agent execution, red-team auditing, and RFC 8785 JCS telemetry (`MCP-SCHEDULER-FULL-WORKER-INVOCATION-008`).
- **`suite24_m6_2_source_capture_worker.test.ts` (9 tests)**: Gate M6.2 Micro-Agent #1 SourceCaptureWorker, 6-Layer DOM Sanitization Sieve, and Prompt-Injection & Canary Defense:
  - Clean extraction on Amazon India (`1050000`) and Howrah Supplier (`250000`) with distinct raw vs sanitized DOM hashes and status ceiling (`MCP-SCW-CLEAN-EXTRACT-001`).
  - Missing freight or non-numeric string returns `DATA_REQUIRED` with `E-SCW-MANDATORY-COST-MISSING` and never substitutes 0 or 0n (`MCP-SCW-MISSING-FIELD-NO-ZERO-002`).
  - Layer 3 strips cloaked hidden nodes (`display:none`, `hidden`, `opacity:0`, off-screen `left:-9999px`) and HTML comments, extracting exact visible ₹38.21 (`382100`) (`MCP-SCW-HIDDEN-DOM-CLOAKING-003`).
  - Canary scanner triggers `E-SCW-PROMPT-INJECTION-DETECTED` on adversarial overrides and domain spoofing (`MCP-SCW-PROMPT-INJECTION-CANARY-004`).
  - Broker blocks `file://`, `http://`, `POST`, unapproved hosts, and HTTP redirects (`MCP-SCW-HOST-METHOD-REDIRECT-SCHEME-005`).
  - Broker blocks `127.0.0.1`, IPv4-mapped IPv6, IPv6 ULA, and payloads $> 524,288$ bytes (`MCP-SCW-SSRF-IPV6-AND-OVERSIZE-006`).
  - Layer 5 strips zero-width chars (`₹3\u200B8.21` -> `382100`) and rejects fullwidth/Cyrillic homographs (`E-SCW-HOMOGRAPH-DETECTED`) (`MCP-SCW-UNICODE-HOMOGRAPH-007`).
  - IndiaMART quantity-slab bracket resolver selects exact price bracket for target batch quantity, fails closed on below-MOQ (`E-SCW-BELOW-MINIMUM-TIER-MOQ`), and rejects overlapping slabs (`E-SCW-AMBIGUOUS-TIER-BRACKET`) (`MCP-SCW-INDIAMART-TIERED-MOQ-008`).
  - Bit-for-bit reproducible JCS response and SHA-256 digest with monotonic hash-chained `McpRunLedger` (`MCP-SCW-REPRODUCIBLE-JCS-009`).
- **`suite25_m6_3_media_chatter_worker.test.ts` (8 tests)**: Gate M6.3 Micro-Agent #2 MediaAndChatterWorker, Verbatim Citation Span Verification, and Tiered MOQ Batch Optimization:
  - Extracts metallurgy defect (`METALLURGY_GRADE_DEFECT` — SS202 rust/magnet failure) and torque failure claims with exact verbatim citation spans, media timestamps, and empirical defect rates (`MCP-MCW-VERBATIM-CITATION-EXTRACT-001`).
  - Fails closed on uncited claims (`E-MCW-UNCITED-CLAIM-REJECTED`) and character offset mismatches (`E-MCW-INVALID-CITATION-SPAN`) (`MCP-MCW-UNCITED-AND-OFFSET-MISMATCH-REJECT-002`).
  - Injects adversarial instructions into transcript stream, triggering `QUARANTINED_INJECTION` / `E-MCW-PROMPT-INJECTION-DETECTED` with zero claims emitted (`MCP-MCW-PROMPT-INJECTION-QUARANTINE-003`).
  - Enforces hardcoded `UNVERIFIED` / `NOT_APPLICABLE` ceiling and throws `E-MCW-COMMERCIAL-STATUS-FORBIDDEN` on commercial elevation (`MCP-MCW-COMMERCIAL-STATUS-AND-AUTHORITY-CEILING-004`).
  - Enforces MCP Broker security policy: blocks unapproved hosts, POST method, payloads > 256 KB (`E-MCP-PAYLOAD-TOO-LARGE`), and >3 requests per task quota (`MCP-MCW-BROKER-POLICY-AND-QUOTA-005`).
  - Evaluates chatter supplement trigger: dispatches `COMPLEMENTARY_GAP_FILL` when return data is absent and `SUPPLEMENTARY_ANOMALY_CHECK` when supplier quote is within 15% of physical scrap floor (`MCP-MCW-COMPLEMENTARY-VS-SUPPLEMENTARY-TRIGGER-006`).
  - Optimizes batch quantities across IndiaMART price brackets under treasury budget and concentration constraints, selecting 500 packs @ 399.41% RoWC under ₹50k budget, and 250 packs under ₹15k budget with `E-M5-BUDGET-EXHAUSTED` on 500+ (`MCP-SCW-M5-TIERED-BATCH-OPTIMIZATION-007`).
  - Verifies bit-for-bit identical RFC 8785 JCS SHA-256 digests and deep immutability (`deepFreeze`) across repeated runs (`MCP-MCW-REPRODUCIBLE-JCS-008`).
- **`suite26_m6_4_macro_lateral_and_regime_worker.test.ts` (8 tests)**: Gate M6.4 Micro-Agent #3 MacroAndLateralMarketWorker, Formula-RAG Dynamic Growth Driver Engine, and Dynamic Regime Classifier:
  - Ingests RBI 91d T-Bill (650 bps), FBIL USD/INR (₹84.0500), and LME SS304 coil, deriving exact BigInt physical scrap floor for 140g clamp pack (₹25.8874 raw metal, ₹29.7705 with 15% stamping) (`MCP-MLW-CORE-SERIES-AND-SCRAP-FLOOR-001`).
  - Proves expired timestamps fail closed and missing series require data with zero fabricated fallbacks (`MCP-MLW-STALE-AND-MISSING-NO-DEFAULT-002`).
  - Proves querying USD/tonne without fresh FBIL USD/INR rate fails closed with `UNIT_MISMATCH_REJECTED` (`E-MLW-MISSING-FX-REFERENCE`) (`MCP-MLW-UNIT-AND-FX-FIREWALL-003`).
  - Evaluates dynamic growth driver by resolving formula from `FormulaRegistry` with pure BigInt rational arithmetic (`MCP-MLW-DYNAMIC-FORMULA-RAG-DRIVER-004`).
  - Contrasts 60-day sustained structural signal vs 10-day fast opportunity with Tactical Horizon Gate (`E-MLW-EDGE-DECAYS-BEFORE-CASH-RECOVERY`) (`MCP-MLW-SUSTAINED-VS-FAST-REGIME-CLASSIFIER-005`).
  - Tracks forecast vs realized cycles in `FactorEfficacyLedger`, promoting capex signal and refuting noisy social hype (`MCP-MLW-EMPIRICAL-EFFICACY-LEARNING-006`).
  - Verifies broker policy, prompt injection quarantine (`E-MLW-PROMPT-INJECTION-DETECTED`), status ceiling (`E-MLW-COMMERCIAL-STATUS-FORBIDDEN`), and Stage 3 MCW-01 citation span SHA-256 rejection (`MCP-MLW-BROKER-SECURITY-AND-INJECTION-007`).
  - Verifies bit-for-bit identical RFC 8785 JCS SHA-256 digests and deep immutability (`deepFreeze`) across repeated runs (`MCP-MLW-REPRODUCIBLE-JCS-008`).
- **`suite27_m6_5_govt_statutory_worker.test.ts` (8 tests)**: Gate M6.5 Micro-Agent #4 GovtAndStatutoryWorker & Formula Non-Mutation Firewall:
  - Extracts authoritative CBIC HSN 73269099 GST rate (1800 bps = 18%), CBIC Sec 52 TCS (100 bps = 1%), CBDT Sec 194-O TDS (100 bps = 1%), and DGFT Customs BCD (750 bps = 7.5%) with UNVERIFIED status ceiling (`MCP-GSW-CORE-HSN-AND-TCS-TDS-EXTRACTION-001`).
  - Fails closed with `DATA_REQUIRED` (`E-GSW-STATUTORY-CIRCULAR-REQUIRED`) on unknown circular or missing HSN with zero fabricated default tax rates (`MCP-GSW-ZERO-DEFAULT-POLICY-002`).
  - Rejects unauthorized statutory authorities, invalid ISO dates, and malformed document hashes with `E-GSW-INVALID-CITATION` (`MCP-GSW-CITATION-COMPLETENESS-AND-TAMPER-DEFENSE-003`).
  - Proves overwriting normative tax formula `FIN-STATUTORY-TCS-TDS-003` fails closed with `E-ERR-GOV-002: CANNOT_OVERWRITE_NORMATIVE_FORMULA`, while candidate formulas register into sandboxed `CANDIDATE_UI_MODEL` tier (`MCP-GSW-NO-AUTONOMOUS-TAX-FORMULA-MUTATION-004`).
  - Computes MSME Section 43B(h) credit ceilings (45d with written agreement, 15d without) and emits structured cross-check envelope (`MCP-GSW-MSME-SEC43BH-PAYMENT-TERM-CROSS-CHECK-005`).
  - Quarantines adversarial circular injection payload via `InjectionCanaryGuard`, returning `QUARANTINED_INJECTION` / `E-GSW-PROMPT-INJECTION-DETECTED` (`MCP-GSW-PROMPT-INJECTION-QUARANTINE-006`).
  - Enforces MCP Broker host allowlist, commercial status ceiling (`E-GSW-COMMERCIAL-STATUS-FORBIDDEN`), and task grant boundaries (`MCP-GSW-BROKER-SECURITY-AND-AUTHORITY-CEILING-007`).
  - Guarantees bit-for-bit identical RFC 8785 JCS SHA-256 digests and deep immutability (`deepFreeze`) across repeated runs (`MCP-GSW-DETERMINISTIC-JCS-AND-IMMUTABILITY-008`).
- **`suite28_m6_6_red_team_conflict_worker.test.ts` (8 tests)**: Gate M6.6 Micro-Agent #5 RedTeamAndConflictWorker & Context-Routing State Machine:
  - Blocks candidate quotes below LME SS304 physical scrap floor (RT-01) -> `HOLD_BLOCKED_BY_RED_TEAM`, and passes quotes above scrap floor (`MCP-RTW-SCRAP-FLOOR-AND-METALLURGY-DEFENSE-001`).
  - Strictly preserves cross-source conflict on raw material prices (₹28 vs ₹35) without voting or averaging (RT-02) -> `HOLD_BLOCKED_BY_RED_TEAM` (`MCP-RTW-UNRESOLVED-CROSS-SOURCE-CONFLICT-002`).
  - Flags RoWC > 100% resting solely on `ADVERTISED_LISTING` (RT-03) -> `REQUIRES_SUPPLEMENTARY_CORROBORATION`, and passes on verified purchase invoices (`MCP-RTW-HIGH-RETURN-ILLUSION-ON-ADVERTISED-003`).
  - Quarantines candidate quotes contradicted by customer review transcripts or forum chatter identifying SS202 adulteration or defect rates > 1000 bps (RT-04) -> `HOLD_BLOCKED_BY_RED_TEAM` (`MCP-RTW-METALLURGY-CHATTER-CONTRADICTION-004`).
  - Blocks credit term assumptions exceeding statutory MSME Section 43B(h) limits (DPO > 45 days) (RT-05) -> `HOLD_BLOCKED_BY_RED_TEAM`, and passes compliant terms (`MCP-RTW-ILLEGAL-MSME-CREDIT-TERM-DEFENSE-005`).
  - Enforces zero-cost substitution ban on mandatory freight/packaging (RT-06) and blocks future clock skew or expired evidence TTL (RT-07) -> `HOLD_BLOCKED_BY_RED_TEAM` (`MCP-RTW-MANDATORY-COST-DATA-AND-CLOCK-SKEW-006`).
  - Enforces zero network egress (`allowed_hosts: []`) and hard disposition ceiling (`HOLD_BLOCKED_BY_RED_TEAM`, `REQUIRES_SUPPLEMENTARY_CORROBORATION`, `ELIGIBLE_FOR_HUMAN_REVIEW`), failing closed on `APPROVED_FOR_EXECUTION` with `E-RTW-DISPOSITION-CEILING-BREACH` (`MCP-RTW-DISPOSITION-CEILING-AND-ZERO-NETWORK-EGRESS-007`).
  - Executes 3-pass `ContextRoutingStateMachine` coordinating horizontal gap-filling, supplementary corroboration & join, and red-team audit with bit-for-bit RFC 8785 JCS canonical attestation and SHA-256 telemetry digest (`MCP-RTW-3PASS-SCHEDULER-STATE-MACHINE-008`).


