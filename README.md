# Market HFT OS (POC-001)

High-Frequency Market Trading Operating System — Core Architecture & Normative Gate M1 Implementation.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4.5-blue.svg)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Vitest-1.6.0-green.svg)](https://vitest.dev/)
[![RFC 8785](https://img.shields.io/badge/RFC_8785-json--canonicalize@3.0.1-purple.svg)](https://www.rfc-editor.org/rfc/rfc8785)
[![Status](https://img.shields.io/badge/Gate_M1-Passing-brightgreen.svg)]()

---

## 1. Architectural Invariants & Governance Baseline

- **Frozen Specification Baseline**: [`POC-001_Gate_M1_Design_Readiness_Specification.md`](https://github.com/Shrom-Main/ADRs/blob/77eff71c3807c8852b49355f50e814bd75eb90ad/POC-001_Gate_M1_Design_Readiness_Specification.md) (v1.13 Final, pinned to commit `77eff71c3807c8852b49355f50e814bd75eb90ad`, blob `ac8899da3a6dcccb2c612247302e6f57fc566472`).
- **Quarantine Isolation**: All legacy code (`_salvage/AIStudio/`, `_salvage/external/`) is strictly quarantined and git-ignored. Zero imports or execution of legacy salvage code exist in `src/` or `tests/`.
- **Three-State Conformance Model**: All requirements are strictly tracked as `Specified — Pending Verification`, `Design Reviewed`, or `Verified — Test Evidence Recorded`.

---

## 2. Pinned Dependencies

| Package | Version | Exact Integrity Hash (SHA-512) | Purpose |
|---|---|---|---|
| `json-canonicalize` | `3.0.1` | `sha512-xEzkTucfHhDooWOSMOvrlll9oTk6/mXZIerF2DFWA2chHZsnc2zrmAKjVOyDbSYHr0e3Djx9F89nZ3U2Bn+lSw==` | RFC 8785 JSON Canonicalization Scheme (JCS) |
| `typescript` | `5.4.5` | Pinned in lockfile | Static typechecker |
| `vitest` | `1.6.0` | Pinned in lockfile | Deterministic test runner |
| `@types/node` | `20.12.7` | Pinned in lockfile | Node.js typings |

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
*Expected output: 12 test files passed, 50 tests passed (Exit code 0).*

### Step 4: Generate Machine-Readable Audit Report
```bash
npm run test:json
```
*Generates `test-results.json`.*

---

## 4. Test Suite Mapping

- **`suite01_serialization.test.ts`**: RFC 8785 JCS canonicalization, KAT-01 (`f656707...`), KAT-02 (`103316c...`), non-finite number rejection.
- **`suite02_currency.test.ts`**: Canonical Money 3-scale registry, KAT-04 Parts A & B (865086, 865260, 779122735535095894 with ₹0.0086 Float64 drift exposure), equity-invariant peak funding.
- **`suite03_promotion_gate.test.ts`**: Two-phase promotion gate, EvaluatorDecisionSigningPayload HMAC (`timingSafeEqual`), CAS optimistic locking, atomic stream head updates.
- **`suite04_historical_exclusion.test.ts`**: Backfilled evidence exclusion (`E-ERR-032`), fail-closed 18-tuple allowlist (`E-ERR-001`).
- **`suite05_claim_derivation.test.ts`**: KAT-05A direct Ed25519 signature proof, KAT-05B gateway endorsement receipt proof (exact 300,000 ms lifetime).
- **`suite06_commercial_reconciliation.test.ts`**: Zero-tolerance matching on unit price (`E-ERR-028`), MOQ (`E-ERR-029`), payment terms (`E-ERR-030`), Incoterms (`E-ERR-031`).
- **`suite07_financial_engine.test.ts`**: Acceptance fixture `REC-OUTLAY-001` (15-day outlay recovery, 25-day lifecycle recovery, 1,000 peak funding), KAT-03 safe-integer volumetric proof (1,200g), committed capital netting.
- **`suite08_quarantine_isolation.test.ts`**: Zero legacy imports assertion and `.gitignore` integrity.
- **`suite09_virtual_genesis.test.ts`**: Virtual genesis head convention ($H_{-1} = 0^{64}$) and monotonic hash chaining.
- **`suite10_checkpoint_anchor.test.ts`**: Stream checkpoint trust anchor verification with operational vs historical modes.
- **`suite11_cross_currency.test.ts`**: Cross-currency summation prohibition (`E-ERR-008`), signed oracle FX conversion receipt verification.
- **`suite12_durable_persistence.test.ts`**: PostgreSQL DDL schema validation, 6-path ambiguous commit reconciliation (subsequent event advance, definitive rollback, digest mismatch, lock timeout, network severing).
