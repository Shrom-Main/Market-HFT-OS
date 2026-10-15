# Market HFT OS (POC-001)

High-Frequency Market Trading Operating System — Core Architecture, Gate M1 Foundation, Gate M2 Execution Engine & Gate M3 Persistence / Crash Recovery (Simulation Milestone).

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4.5-blue.svg)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1.12-green.svg)](https://vitest.dev/)
[![RFC 8785](https://img.shields.io/badge/RFC_8785-json--canonicalize@3.0.1-purple.svg)](https://www.rfc-editor.org/rfc/rfc8785)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16.8-blue.svg)](https://www.postgresql.org/)
[![Status](https://img.shields.io/badge/Gate_M3_Conformance-Passing_(158_Tests_/_19_Suites)-brightgreen.svg)]()

---

## 1. Architectural Invariants & Governance Baseline

- **Frozen Specification Baseline**: [`POC-001_Gate_M1_Design_Readiness_Specification.md`](https://github.com/Shrom-Main/ADRs/blob/77eff71c3807c8852b49355f50e814bd75eb90ad/POC-001_Gate_M1_Design_Readiness_Specification.md) (v1.13 Final, pinned to commit `77eff71c3807c8852b49355f50e814bd75eb90ad`, blob `ac8899da3a6dcccb2c612247302e6f57fc566472`).
- **Quarantine Isolation**: All legacy code (`_salvage/AIStudio/`, `_salvage/external/`) is strictly quarantined and git-ignored. Zero imports or execution of legacy salvage code exist in `src/` or `tests/`.
- **Three-State Conformance Model**: All requirements are strictly tracked as `Specified — Pending Verification`, `Design Reviewed`, or `Verified — Test Evidence Recorded`.
- **Epistemic & Operational Boundary**: Gate M3 integrates durable persistence, crash recovery, multi-stream integration, and live PostgreSQL 16.8 concurrency. Market feeds utilize local loopback WebSocket networking (`ws://127.0.0.1`) with fail-closed provenance (`is_authenticated_source_feed: false`). Order execution is simulated via `SimulatedExecutionGateway`. Dual-ledger protection (`ActualsGuard`) strictly isolates simulations from production actuals. Zero live exchange access, real order routing, or actual money movement is permitted or enabled.

---

## 2. Core Production Modules (`src/`)

```
src/
├── canonical/          # RFC 8785 JCS, currency rational math, product normalization, crypto
├── checkpoint/         # Virtual genesis head and trust anchor verification
├── execution/          # Simulated execution gateway, order books, fill engines
├── feeds/              # Market data normalization, replay buffering, sequence checking
├── financial/          # Cash flow engine, two-tier clearing, outlay recovery, RoPF/XIRR
├── ledger/             # Dual-ledger isolation guard (ActualsGuard, tickets, nonces)
├── persistence/        # File-backed WAL, crash recovery engine, PostgreSQL adapter, locks
├── portfolio/          # Simulation portfolio, anchored cumulative COGS, positions
├── simulation/         # End-to-end simulation pipeline coordinator
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

# Full run with live PostgreSQL 16.8 (runs all 158 tests across 19 suites)
$env:DATABASE_URL = "postgresql://postgres@localhost:5432/market_hft_test"
npm test
```
*Expected output: 19 test files passed, 158 tests passed (Exit code 0).*

### Step 4: Generate Machine-Readable Audit Report
```bash
npm run test:json
```
*Generates `test-results.json` recording 19 passed test files and 158 passed tests.*

---

## 5. Acceptance Test Suite Mapping

- **`suite01_serialization.test.ts` (6 tests)**: RFC 8785 JCS canonicalization, KAT-01 (`f656707...`), KAT-02 (`103316c...`), non-finite number rejection.
- **`suite02_currency.test.ts` (6 tests)**: Canonical Money 3-scale registry, KAT-04 Parts A & B (865086, 865260, 779122735535095894 with ₹0.0086 Float64 drift exposure), equity-invariant peak funding.
- **`suite03_promotion_gate.test.ts` (6 tests)**: Two-phase promotion gate, EvaluatorDecisionSigningPayload HMAC (`timingSafeEqual`), CAS optimistic locking, atomic stream head updates.
- **`suite04_historical_exclusion.test.ts` (2 tests)**: Backfilled evidence exclusion (`E-ERR-032`), fail-closed 18-tuple allowlist (`E-ERR-001`).
- **`suite05_claim_derivation.test.ts` (3 tests)**: KAT-05A direct Ed25519 signature proof, KAT-05B gateway endorsement receipt proof (exact 300,000 ms lifetime).
- **`suite06_commercial_reconciliation.test.ts` (4 tests)**: Zero-tolerance matching on unit price (`E-ERR-028`), MOQ (`E-ERR-029`), payment terms (`E-ERR-030`), Incoterms (`E-ERR-031`).
- **`suite07_financial_engine.test.ts` (18 tests)**: Acceptance fixture `REC-OUTLAY-001`, product normalization (`PROD-NORM-NFC-HSN-025`, `HSN-LEGAL-ASSIGNMENT-SYNTAX-032`, `PROD-NORM-DETERMINISTIC-004`, `PROD-COLL-001`, `PROD-NORM-SAFE-003`), physical dimensions, safe-integer volumetric proof (`KAT-03`), RoPF (`FIN-ROPF-PEAK-007`), CoC, HPR (`FIN-CONV-HPR-008`), XIRR polynomial root solver, committed capital netting, Two-Tier Gross-Clearing ledger (`FIN-GROSS-CLEARING-TIER-037`), transient recovery detection (`FIN-RECOVERY-TRANSIENT-001`), CanonicalMoney/integer subunits and cross-currency guard (`FIN-CASHFLOW-SUBUNITS-002`), and pre-inception timestamp rejection (`FIN-CASHFLOW-PREINCEPTION-003`).
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
