# Market HFT OS (POC-001)

High-Frequency Market Trading Operating System — Core Architecture, Gate M1 Foundation & Gate M2 Execution Engine Integration (Simulation Milestone).

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4.5-blue.svg)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Vitest-1.6.0-green.svg)](https://vitest.dev/)
[![RFC 8785](https://img.shields.io/badge/RFC_8785-json--canonicalize@3.0.1-purple.svg)](https://www.rfc-editor.org/rfc/rfc8785)
[![Status](https://img.shields.io/badge/Gate_M3_Preflight-Passing_(146_Tests)-brightgreen.svg)]()

---

## 1. Architectural Invariants & Governance Baseline

- **Frozen Specification Baseline**: [`POC-001_Gate_M1_Design_Readiness_Specification.md`](https://github.com/Shrom-Main/ADRs/blob/77eff71c3807c8852b49355f50e814bd75eb90ad/POC-001_Gate_M1_Design_Readiness_Specification.md) (v1.13 Final, pinned to commit `77eff71c3807c8852b49355f50e814bd75eb90ad`, blob `ac8899da3a6dcccb2c612247302e6f57fc566472`).
- **Quarantine Isolation**: All legacy code (`_salvage/AIStudio/`, `_salvage/external/`) is strictly quarantined and git-ignored. Zero imports or execution of legacy salvage code exist in `src/` or `tests/`.
- **Three-State Conformance Model**: All requirements are strictly tracked as `Specified — Pending Verification`, `Design Reviewed`, or `Verified — Test Evidence Recorded`.
- **Epistemic & Operational Boundary**: Gate M3 Pre-flight integrates durable persistence, crash recovery, and multi-stream integration. Market feeds utilize local loopback WebSocket networking (`ws://127.0.0.1`) with fail-closed provenance (`is_authenticated_source_feed: false`). Order execution is simulated via `SimulatedExecutionGateway`. Dual-ledger protection (`ActualsGuard`) strictly isolates simulations from production actuals. Zero live exchange access, real order routing, or actual money movement is permitted or enabled.

---

## 2. Pinned Dependencies

| Package | Version | Exact Integrity Hash (SHA-512) / Reference | Purpose |
|---|---|---|---|
| `json-canonicalize` | `3.0.1` | `sha512-xEzkTucfHhDooWOSMOvrlll9oTk6/mXZIerF2DFWA2chHZsnc2zrmAKjVOyDbSYHr0e3Djx9F89nZ3U2Bn+lSw==` | RFC 8785 JSON Canonicalization Scheme (JCS) |
| `ws` | `8.19.0` | Pinned in lockfile | High-performance local loopback WebSocket transport |
| `typescript` | `5.4.5` | Pinned in lockfile | Static typechecker |
| `vitest` | `1.6.0` | Pinned in lockfile | Deterministic test runner |
| `@types/node` | `20.12.7` | Pinned in lockfile | Node.js typings |
| `@types/ws` | `8.18.2` | Pinned in lockfile | WebSocket typings |

---

## 3. Reproducible Verification Instructions

### Prerequisites
- Node.js >= 20.12.0 (Verified on Node.js v24.14.0)
- npm >= 10.0.0

### Step 1: Clean Installation
```bash
npm ci
```

### Step 2: Strict TypeScript Compilation
```bash
npm run typecheck
```
*Expected output: Exit code 0, zero compilation errors.*

### Step 3: Run All Acceptance Suites
```bash
npm test
```
*Expected output: 18 test files passed, 146 tests passed (Exit code 0).*

### Step 4: Generate Machine-Readable Audit Report
```bash
npm run test:json
```
*Generates `test-results.json` recording 18 passed suites and 146 passed tests.*

---

## 4. Test Suite Mapping

- **`suite01_serialization.test.ts` (6 tests)**: RFC 8785 JCS canonicalization, KAT-01 (`f656707...`), KAT-02 (`103316c...`), non-finite number rejection.
- **`suite02_currency.test.ts` (6 tests)**: Canonical Money 3-scale registry, KAT-04 Parts A & B (865086, 865260, 779122735535095894 with ₹0.0086 Float64 drift exposure), equity-invariant peak funding.
- **`suite03_promotion_gate.test.ts` (6 tests)**: Two-phase promotion gate, EvaluatorDecisionSigningPayload HMAC (`timingSafeEqual`), CAS optimistic locking, atomic stream head updates.
- **`suite04_historical_exclusion.test.ts` (2 tests)**: Backfilled evidence exclusion (`E-ERR-032`), fail-closed 18-tuple allowlist (`E-ERR-001`).
- **`suite05_claim_derivation.test.ts` (3 tests)**: KAT-05A direct Ed25519 signature proof, KAT-05B gateway endorsement receipt proof (exact 300,000 ms lifetime).
- **`suite06_commercial_reconciliation.test.ts` (4 tests)**: Zero-tolerance matching on unit price (`E-ERR-028`), MOQ (`E-ERR-029`), payment terms (`E-ERR-030`), Incoterms (`E-ERR-031`).
- **`suite07_financial_engine.test.ts` (15 tests)**: Acceptance fixture `REC-OUTLAY-001`, product normalization, physical dimensions, safe-integer volumetric proof, RoPF, CoC, HPR, XIRR polynomial root solver, committed capital netting, and Two-Tier Gross-Clearing ledger (`B_clearing` vs `B_bank`).
- **`suite08_quarantine_isolation.test.ts` (2 tests)**: Zero legacy imports assertion and `.gitignore` integrity.
- **`suite09_virtual_genesis.test.ts` (2 tests)**: Virtual genesis head convention ($H_{-1} = 0^{64}$) and monotonic hash chaining.
- **`suite10_checkpoint_anchor.test.ts` (3 tests)**: Stream checkpoint trust anchor verification with operational vs historical modes.
- **`suite11_cross_currency.test.ts` (2 tests)**: Cross-currency summation prohibition (`E-ERR-008`), signed oracle FX conversion receipt verification.
- **`suite12_durable_persistence.test.ts` (10 tests)**: PostgreSQL DDL schema validation, exclusive row-locking on first-time stream head initialization (`SELECT ... FOR UPDATE` re-read after `INSERT ON CONFLICT DO NOTHING`), serialized concurrency CAS conflict handling (`E-ERR-037`), and 6-path ambiguous commit reconciliation.
- **`suite13_market_feed_execution.test.ts` (21 tests)**: Market feed normalization, exact decimal price parsing to integer subunits (`parseDecimalPriceToSubunits` without precision truncation), monotonic sequence enforcement, duplicate rejection, sequence gap buffering & replay, commercial spread dry-run execution, MOQ/expiration gating, and dual-ledger quarantine guard.
- **`suite14_websocket_portfolio.test.ts` (19 tests)**: Local loopback WebSocket streaming transport, exponential backoff, sequence gap recovery, immutable order lifecycle journal (`SimulatedOrderTransitionEvent`), two-step cancellation with fill-cancel race invariance ($Q_{\text{filled}} + Q_{\text{remaining}} \equiv Q_{\text{total}}$), intent idempotency conflict prevention (`E-ERR-039`), and simulation portfolio ledger.
- **`suite15_e2e_simulation_pipeline.test.ts` (13 tests)**: End-to-end simulation coordinator (`SimulationPipeline`), exact aggregate cost basis, anchored cumulative COGS allocation ($A(s) = \operatorname{divideHalfEven}(C_0 \cdot s, Q_0)$) proving strict fill-partition invariance across arbitrary order splits (including reviewer's $C_0=5, Q_0=3$ case and multi-partition randomizations), interleaved purchase epoch transitions, unsupported short-position prohibition (`E-ERR-044`), cumulative quantity overflow guards against `Number.MAX_SAFE_INTEGER` (`E-ERR-045`), byte-accurate WebSocket payload limits (`Buffer.byteLength`) guarding against multibyte UTF-8 expansion, transport native `maxPayload`, connection stabilization window preventing endless reconnect retry loops under peer bombardment (`M2-WS-LIFECYCLE-OVERSIZED-BOMB-012`), reproducible event replay producing bit-identical state digests (Condition A), continuous capital and quantity invariant verification (Condition B), fault injection recovery (Condition C), and dual-ledger safety isolation (Condition D).
- **`suite16_crash_recovery_persistence.test.ts` (17 tests)**: Gate M3 crash recovery and persistence:
  - Conflicting fill ID reuse detection (`E-ERR-046: FILL_IDEMPOTENCY_CONFLICT`) with snapshot atomic invariance (`M3-IDEMPOTENCY-CONFLICT-001`).
  - Idempotent identical fill replay with zero balance mutation or duplicate journal entries (`M3-IDEMPOTENCY-EXACT-REPLAY-002`).
  - Bit-identical deterministic virtual clock & counter ID generator replay producing exact state digests (`M3-DETERMINISTIC-CLOCK-REPLAY-003`).
  - High-fidelity PostgreSQL concurrent `SELECT ... FOR UPDATE` row lock wait queue serialization (`M3-POSTGRES-CONCURRENCY-ROWLOCK-004`).
  - Fail-closed row lock timeout (`E-ERR-038: PERSISTENCE_LOCK_TIMEOUT`) under severe contention (`M3-POSTGRES-LOCK-TIMEOUT-FAILCLOSED-005`).
  - Clean rollback isolation leaving zero dirty events or nonces (`M3-POSTGRES-ROLLBACK-DIRTY-ISOLATION-006`).
  - Ambiguous commit network disconnect reconciliation resolving verified committed promotion stream heads (`M3-POSTGRES-AMBIGUOUS-COMMIT-007`).
  - Connection pool capacity wait queue serialization (`M3-POSTGRES-CONNECTION-POOL-QUEUE-008`).
  - Durable write-ahead recovery journal (`DurableRecoveryJournal` & `CrashRecoveryEngine`) reconciling orphaned gateway fills after simulated process termination with exact-once accounting parity (`M3-CRASH-FAULT-INJECTION-JOURNAL-RECOVERY-009`).
  - Concurrent multi-symbol WebSocket streaming feeds across separate handlers without cross-talk or sequence gaps (`M3-MULTI-STREAM-CONCURRENCY-010`).
  - In-flight fill recovery with simulated process termination (`M3-CRASH-SEPARATE-PROCESS-RECOVERY-011`).
  - Snapshot persistence roundtrip and verification (`M3-SNAPSHOT-DURABILITY-ROUNDTRIP-012`).
  - Corrupt snapshot rejection with hash-binding validation (`M3-SNAPSHOT-CORRUPT-DIGEST-REJECT-013`).
  - Torn WAL record detection and repair (`M3-WAL-TORN-RECORD-TRUNCATE-014`).
  - Mid-log bit-flip corruption fail-closed rejection (`M3-WAL-INTERIOR-CORRUPTION-FAILCLOSED-015`).
  - WAL write ordering verification (`M3-WAL-WRITE-ORDER-BEFORE-CHECKPOINT-016`).
  - Valid unterminated final record normalization and flush (`M3-WAL-VALID-UNTERMINATED-RECORD-017`).
- **`suite17_real_postgres_integration.test.ts` (6 tests)**: Real PostgreSQL 16.8 native database integration (running on `localhost:5432`):
  - Live server engine verification (`M3-REAL-POSTGRES-SERVER-VERSION-001`).
  - Real concurrent row-lock serialization across independent PostgreSQL backend connections (`M3-REAL-POSTGRES-CONCURRENT-ROWLOCK-002`).
  - Real transaction rollback isolation on simulated network error (`M3-REAL-POSTGRES-ROLLBACK-ISOLATION-003`).
  - Ambiguous commit recovery against real PostgreSQL stream heads (`M3-REAL-POSTGRES-AMBIGUOUS-COMMIT-RECOVERY-004`).
  - Real connection pool exhaustion and queueing (`M3-REAL-POSTGRES-POOL-EXHAUSTION-QUEUE-005`).
  - Exact state reconciliation between PostgreSQL stream heads and offer assessment store (`M3-REAL-POSTGRES-STATE-RECONCILIATION-006`).
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
