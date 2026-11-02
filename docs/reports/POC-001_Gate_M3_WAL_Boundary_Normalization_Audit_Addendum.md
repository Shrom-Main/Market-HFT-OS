# POC-001 — Gate M3 WAL Boundary Normalization Audit Addendum

**Document ID:** `POC-001-M3-ADDENDUM-001`  
**Version:** `1.0.0`  
**Date:** `2026-10-14`  
**Status:** `LOCAL AUDIT VERIFIED — AWAITING REVIEW DECISION`  
**Target Baseline:** `Market-HFT-OS` commit [`a1bd359`](https://github.com/Shrom-Main/Market-HFT-OS/commit/a1bd359) (local), expanding on [`8a89cf0`](https://github.com/Shrom-Main/Market-HFT-OS/commit/8a89cf051bc253fb82c1a685a74a0ddf1e0a7d36) (local)  
**Parent Baseline:** [`7415c61`](https://github.com/Shrom-Main/Market-HFT-OS/commit/7415c617be2cd680217ebb07b4209466c1084918) (published)  
**Frozen Specification:** [`POC-001_Gate_M1_Design_Readiness_Specification.md`](https://github.com/Shrom-Main/ADRs/blob/77eff71c3807c8852b49355f50e814bd75eb90ad/POC-001_Gate_M1_Design_Readiness_Specification.md) (v1.13 Final, pinned at `77eff71`)

---

## 1. Defect Analysis & Root Cause

At baseline `7415c61`, `FileBackedDurableRecoveryJournal` had an accounting defect when reading a WAL file ending with a valid JSON record without a trailing newline:
1. **Unconditional Delimiter Accounting:** In the loader loop, `validBytesLength += Buffer.byteLength(line, 'utf8') + 1` assumed that every parsed line was terminated by a newline on disk. When the file ended without a newline, `validBytesLength` exceeded the physical byte count on disk by 1 byte.
2. **Concatenation Vulnerability:** The file was subsequently reopened with mode `'a+'`. Because the physical disk file lacked a trailing newline delimiter, the next `appendEvent` wrote its new record directly against the final closing brace `}` of the prior record, concatenating them into a single corrupt line (`{...}{...}\n`).

---

## 2. Engineering Correction

1. **Exact Delimiter Detection:**
   The loader inspects the raw file buffer to determine physical termination:
   ```typescript
   const endsWithNewline = fileBuffer.length === 0 || fileBuffer[fileBuffer.length - 1] === 0x0a;
   ```
2. **Accurate Valid-Byte Accounting:**
   If the terminal line lacks a trailing newline, `validBytesLength` increments strictly by `Buffer.byteLength(line, 'utf8')` (without `+ 1`), and `needsNormalization` is flagged as `true`.
3. **Safe Normalization Prior to Append:**
   Before any subsequent write can proceed, `normalizeTrailingNewline()` appends `\n` to disk and synchronously flushes via `fs.fsyncSync(this.fileDescriptor)`. The valid record and its cryptographic SHA-256 header digest are completely preserved.
4. **Normalization Failure Poisoning:**
   If the normalization disk write or fsync fails, the journal sets `isPoisoned = true`, stores the error, closes the descriptor, and fail-closed rejects any subsequent write attempts with `E-ERR-024: JOURNAL_POISONED`.
5. **Preservation of Existing Policies:**
   - Trailing malformed records continue to be truncated to valid acknowledged bytes under `TRUNCATE_TORN_TAIL`.
   - Interior corruption continues to fail closed with `E-ERR-024: CORRUPT_JOURNAL`.

---

## 3. Test Evidence & Regression Suite

Expanded regression test [`M3-WAL-VALID-UNTERMINATED-RECORD-017`](file:///d:/Market%20HFT%20OS/tests/acceptance/suite16_crash_recovery_persistence.test.ts#L1175-L1330) validates the complete 5-point verification checklist:
1. **Physical Unterminated Detection & Preservation:**
   - Writes valid initial entry stripped of its trailing `\n`.
   - Reopens journal, normalizes newline delimiter, and appends sequence 2 without record concatenation.
   - Third reopen validates both records independently parse with unbroken SHA-256 hash chaining.
2. **Constructor-Time Flush Fault Injection (`fsyncSync` failure):**
   - Injects simulated I/O failure into `fs.fsyncSync` during constructor normalization.
   - Asserts `normalizationFsyncCalls === 1`.
   - Asserts instance is poisoned fail-closed (`getIsPoisoned() === true`) while valid pre-existing entries remain readable (`getEntryCount() === 1`).
3. **Fail-Closed Mutation Rejection:**
   - Asserts subsequent mutations (`appendEvent('ORDER_SUBMITTED')` and `appendEvent('PORTFOLIO_APPLIED')`) reject fail-closed with `E-ERR-024: JOURNAL_POISONED`.
   - Asserts mock restoration is guaranteed inside a `finally` block to protect test runner environment.
4. **Documented Recovery Policy on Clean Restart:**
   - Reopening the file after flush failure verifies integrity (`isValid === true`), accepts new appends, and verifies disk persistence with sequence 2 and intact hash chain.
5. **Constructor-Time Write Fault Injection (`writeSync` failure):**
   - Injects simulated I/O failure into `fs.writeSync` prior to newline writing.
   - Asserts immediate poisoning and fail-closed rejection.
   - Asserts clean subsequent reopen, normalization, and sequence 2 append.

### Execution Output
```
Test Files  17 passed (17)
     Tests  129 passed (129 total, 0 skipped, 0 failed)
  Duration  5.94s
Type Check  0 diagnostics (tsc --noEmit)
```

---

## 4. Epistemic Separation of Claims & Verified Evidence

1. **Locally Verified in Child Processes / File I/O:**
   - Physical newline detection and normalization of unterminated valid WAL records.
   - Prevention of record concatenation across reopen cycles.
   - Live journal poisoning upon normalization flush failure.
   - Bit-level recovery parity across independent operating system process crash workers.
2. **Native PostgreSQL 16.8 Verification (Suite 17):**
   - **Database Instance:** Native `PostgreSQL 16.8, compiled by Visual C++ build 1942, 64-bit` on `localhost:5432`.
   - **Environment:** `DATABASE_URL=postgresql://postgres@localhost:5432/market_hft_test`.
   - **Test Results:** 6/6 passed (0 skipped, 0 failed):
     - `M3-REAL-POSTGRES-SERVER-VERSION-001`: Exact database engine banner verified as `PostgreSQL 16.8, compiled by Visual C++ build 1942, 64-bit` via `SELECT version()`. (PASS)
     - `M3-REAL-POSTGRES-ROWLOCK-002`: Deterministic row lock wait verification via `pg_locks` (`granted = false`) and `pg_stat_activity` (`wait_event_type = 'Lock'`), eliminating arbitrary timer guesswork. (PASS)
     - `M3-REAL-POSTGRES-ROLLBACK-003`: Transaction abort & rollback isolation. (PASS)
     - `M3-REAL-POSTGRES-AMBIGUOUS-COMMIT-004`: Genuine lost-acknowledgment commit disconnect reconciled to `COMMITTED` via authoritative stream inspection and SHA-256 digest recomputation. (PASS)
     - `M3-REAL-POSTGRES-AMBIGUOUS-ROLLBACK-005`: Genuine pre-commit socket severance reconciled to `ROLLED_BACK`. (PASS)
     - `M3-REAL-POSTGRES-CLEANUP-REPEATABILITY-006`: Complete table cleanup, zero row leakage, and repeated execution without collision. (PASS)
3. **Operating System Cache vs. Power Loss Boundary:**
   - The reopen test after a simulated `fsyncSync` failure demonstrates clean process recovery within the test environment where the operating system's page cache retains written bytes, rather than physical media durability across complete unbuffered power loss.
   - The journal's fail-closed poisoning and descriptor closure is the correct programmatic defense to protect application state.
   - This test harness does not assert or prove physical media durability under sudden host power disruption.



