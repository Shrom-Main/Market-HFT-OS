# POC-001 — Final Pre-Approval Correction Report
**Comprehensive Synthesis of Governance Revisions, Empirical Test Audits, Mathematical Solvers, and Workspace Isolation**

**Document Status:** PROPOSED — awaiting project-owner review  
**Date:** 2026-10-10  
**Target Repository:** `D:\Market HFT OS` (Workspace Root)  
**Legacy Reference Repository:** `D:\Market HFT OS\_salvage\AIStudio` (Git commit: `0c67e26e6e0f54da860b31dbcce6d587c7bdc91d`)  
**External Research Pool:** `D:\Market HFT OS\_salvage\external\` (7 pinned repositories)  
**Execution Environment:** Node.js v24.14.0, npm v11.9.0, Python 3.14.0, Windows 11 x64, PowerShell 5.1  
**Operating Mode:** Strict Read-Only (Preserved source untouched; zero workspace writes)  
**Authority Boundary:** Audit artifact only. Does **not** authorize implementation, code migration, dependency installation, or root Git initialization.

---

## 1. Executive Summary & Review Scope

This report synthesizes and concludes the pre-approval correction and consistency phase for **POC-001 (Capital-Allocation Research & Market Simulation Platform)**. Over multiple audit iterations, the project documents have been refined from initial directional proposals into rigorous, evidence-grounded specifications that strictly enforce epistemic integrity, mathematical validity, and structural isolation.

### 1.1 Reviewed Documents and Exact Versions

The final pre-approval governance package comprises four core documents located in the project artifact directory:

| Document Title | Version | File Path | Document Role |
|---|:---:|---|---|
| **Project Charter** | **v0.2.3** | `C:\Users\spaye\.gemini\antigravity\brain\f8d383dc-74a5-44e7-8222-da945383593a\POC-001_Project_Charter_v0.2.3.md` | Authoritative project constitution, epistemic principles, scope boundaries, and decision register |
| **Salvage Verification Gate Addendum** | **v1.3** | `C:\Users\spaye\.gemini\antigravity\brain\f8d383dc-74a5-44e7-8222-da945383593a\SALVAGE_VERIFICATION_GATE_ADDENDUM_v1.3.md` | Empirical defect resolution, test inventory counting reconciliation, solver math, and legacy disposition matrix |
| **External Salvage Verification Report** | **v1.1** | `C:\Users\spaye\.gemini\antigravity\brain\f8d383dc-74a5-44e7-8222-da945383593a\EXTERNAL_SALVAGE_VERIFICATION_REPORT.md` | Static audit, licensing risk classification, and quarantine disposition for 7 external repositories |
| **Pre-Approval Consistency Audit** | **v1.0** | `C:\Users\spaye\.gemini\antigravity\brain\f8d383dc-74a5-44e7-8222-da945383593a\FINAL_PRE_APPROVAL_CONSISTENCY_AUDIT.md` | Cross-document consistency verification and duplicate test mapping manifest |

---

## 2. Corrections Made with Detailed Section References

### 2.A Project Charter v0.2.3 Corrections

1. **Economic Dimension Independence & Honest Display (Section 2.1 & DEC-009)**:
   - *Issue Identified*: Earlier text suggested that real, after-tax, and risk-adjusted returns must always be shown numerically, creating the risk of fabricating tax or inflation numbers when deflators are unavailable.
   - *Correction Applied*: Section 2.1, Section 4.2, and Decision Register entry DEC-009 were amended to mandate that nominal and real returns are presented as distinct measures when calculable. Where inflation indices, tax schedules, or deflators are unavailable, unvalidated, or unsupported, the engine must honestly report that measure as unavailable (`DATA REQUIRED` / `DATA INSUFFICIENT`) rather than manufacturing numeric estimates.
2. **Qualified Numerical Return Solver Acceptance Criteria (Section 2.2 & DEC-012)**:
   - *Issue Identified*: Return solver acceptance was previously framed around a universal root-finding claim within a hardcoded bracket.
   - *Correction Applied*: Section 2.2 formalizes that acceptance is defined by documented domains, explicit convergence/failure statuses, and tested edge cases. Establishes:
     - Search interval $[-0.9999, 100.0]$ as a versioned operational policy parameter.
     - Cash-flow taxonomy distinguishing $C_0=0$ (invalidation of investment multiples, not necessarily IRR), zero net sum $\sum C_t = 0$ (exact $0.0\%$ IRR), and unsupported cash flows (`INVALID_CASH_FLOWS`).
     - Mathematical prerequisite for boundary inference: asserting root $> 100.0$ because $NPV(100.0) > 0$ strictly requires conventional monotonic cash flows. Non-conventional flows with multiple sign changes return `NO_ROOT_FOUND_IN_SEARCH_DOMAIN`.
     - Six typed statuses: `CONVERGED`, `NO_ROOT_FOUND_IN_SEARCH_DOMAIN`, `MULTIPLE_ROOTS_DETECTED`, `OUT_OF_SUPPORTED_DOMAIN`, `INVALID_CASH_FLOWS`, `NUMERICAL_FAILURE`.
3. **Capital Recovery Metrics on Open Positions (Section 2.2)**:
   - *Issue Identified*: Capital recovery duration cannot be calculated as a numeric day count on an open or unrecovered position without division by zero or forced artificial numbers.
   - *Correction Applied*: Mandated explicit status reporting: `Capital Recovery Duration: status = NOT_YET_RECOVERED` (with `duration_days: null`) and `HPR / CoC: status = OPEN_POSITION` for positions where cumulative inflows < cumulative outflows.
4. **Orthogonal Four-Dimensional Evidence Model (Section 3.1 & 3.2)**:
   - *Issue Identified*: Single-field provenance types conflated data origin, corroboration confidence, and commercial execution status.
   - *Correction Applied*: Decoupled into four orthogonal dimensions: (1) Evidence Kind, (2) Verification Status, (3) Commercial Offer Status, and (4) Provenance/Lineage. Mandated fail-closed validation and strict non-promotion of synthetic/scenario fixtures into real observed evidence.
5. **Scoped Physical Baseline Inventory Conservation Identity (Section 3.3)**:
   - *Issue Identified*: The initial formula $Opening + Procured - Sold - Damaged == Closing$ omitted warehouse state transitions and return channels.
   - *Correction Applied*: Scoped the identity explicitly to the initial Strategy #1 physical baseline, establishing a roadmap for incorporating customer returns, supplier returns, scrap, and multi-location states as operational capabilities expand.
6. **Financial Investments as Comparison Benchmarks (Section 2.3)**:
   - *Correction Applied*: Clarified that financial investments serve strictly as passive comparison benchmarks in Phase 1, not as an active trading strategy. Future activation remains a design hypothesis.

### 2.B Salvage Verification Gate Addendum v1.3 Corrections

1. **Reconciled Test Manifest and Downgraded Labels (Section 2.B.1)**:
   - *Issue Identified*: The headline "88 passing tests" was previously characterized as "independent property invariants," overstating coverage.
   - *Correction Applied*: Established three explicit counting levels:
     - **Level 1 (Assertion Executions)**: 186 total evaluations across nested execution runs.
     - **Level 2 (Distinct Assertion Sites)**: 126 unique assertion code locations.
     - **Level 3 (Reported Core Cases or Checks)**: 88 core calculation checks and fixture validations evaluated under static seed fixtures (6 contract + 60 adversarial + 22 fixtures).
2. **Identification and Disposition of `redTeamRunner.ts` (Section 2.B.2)**:
   - *Issue Identified*: Ambiguity regarding whether `scripts/redTeamRunner.ts` constituted independent test coverage.
   - *Correction Applied*: Line-by-line mapping proved that all 34 cases in `redTeamRunner.ts` are a 100% duplicate subset of `src/lib/financialContract.ts` (`runFullAdversarialSuite`). Designated as `REDUNDANT CANDIDATE — DO NOT MODIFY IN THIS AUDIT`. Retirement is documented as a future migration decision during Gate M2 contingent on equivalence verification.
3. **Cryptographic Hashing & RFC 8785 Audit (Section 2.D)**:
   - *Correction Applied*: Audited custom SHA-256 (identified deprecated `unescape` and 32-bit buffer limits) and canonical JSON (UTF-16 sort order vs UTF-8 code points; Date handling). Confirmed usage is isolated to `equationRegistry.ts` and not present in `financialContract.ts`. Planned upgrade to native Node `crypto` for Gate M3.
4. **Configuration Externalization Contract (Section 2.E)**:
   - *Correction Applied*: Audited hardcoded assumptions (specifically the ₹24 per 500g Amazon weight handling fee hardcoded inside `calculateAmazonFees`). Specified the versioned `FeeSchedule` contract.
5. **Persistence Lifecycle Survival Matrix (Section 2.F)**:
   - *Correction Applied*: Empirical restart verified that dynamic registrations in `equationRegistry` and `researchEngine` reset on process restart. Proved that `localStorage` is inaccessible in headless Node environments, validating the decision to reject browser-based storage.

### 2.C External Salvage Verification Report v1.1 Corrections

1. **Licensing Terminology Alignment (Sections 2.1, 2.5, 3.2)**:
   - *Issue Identified*: Repositories lacking an explicit license file were previously labeled "Unlicensed."
   - *Correction Applied*: Replaced with precise legal phrasing: *"No applicable license identified; reuse permission not established"*.
2. **Recorded Owner Governance Decisions (Sections 1.2, 3.2)**:
   - *Correction Applied*: Formalized that `RANDOM` code reuse is **not approved**, US partnership tax (IRC §704c, §743b, §754) is excluded from Strategy #1, and official published CSVs (RBI, NSE Bhavcopy) are preferred over scraping wrappers for financial benchmarks.
3. **External Pool Quarantine (Section 3.1 & 3.2)**:
   - *Correction Applied*: Reclassified all 7 external repositories into a **separate research reference backlog** held in permanent read-only quarantine. Zero code copying and zero dependency installations authorized.

---

## 3. Remaining Unresolved Issues Register

The following issues remain open and tracked for resolution during future phases (no blockers for Gate 1 or Gate 2 approval):

| Issue ID | Category | Summary | Current Impact | Resolution Timing |
|---|---|---|---|---|
| **ISS-001** | **Governance** | Root Git repository not initialized; `_salvage/` quarantine not active in Git | Implementation blocked | Gate M0 (Paused) |
| **ISS-003** | **Remediation** | XIRR Newton-Raphson diverges on short holding periods and near-total ruin | High-velocity simulations fail | Gate M4 |
| **ISS-004** | **Remediation** | Amazon fee schedule slab rate (₹24) hardcoded inside `calculateAmazonFees` | Historical replay vulnerable | Gate M4 |
| **ISS-005** | **Remediation** | Synthetic discovery agent emits `EXTERNAL_PUBLISHED` provenance | False provenance in mock signals | Phase 2 Build |
| **ISS-006** | **Remediation** | Ephemeral in-memory maps lose equations, theses, and ledgers on restart | Replay across CLI runs blocked | Phase 1 Architecture |
| **ISS-007** | **Architecture** | Database selection (SQLite vs DuckDB vs PostgreSQL) for audit trail | None for headless math audit | Phase 1 Architecture |
| **ISS-008** | **Capabilities** | Real headless web scraping & marketplace API connectors | Research inputs currently manual | Phase 3 Build |
| **ISS-009** | **UI** | React UI workspace migration | UI intentionally deferred | Phase 5 Build |
| **ISS-011** | **Salvage** | Formal retirement of `scripts/redTeamRunner.ts` | Redundant maintenance | Gate M2 Equivalence |
| **ISS-012** | **Benchmarks** | Ingestion pipeline for official static CSV downloads (RBI / Bhavcopy) | Financial benchmarks unpopulated | Phase 4 Architecture |

---

## 4. Report-Only Claims & Limitations

In accordance with objective auditing standards, the following items are explicitly recorded as **report-only claims** that were not independently verified by the project owner:

1. **Subagent Execution Telemetry**: The test pass rates (186 executions, 88 reported core checks, ₹0 drift) were produced by Antigravity subagent runs in headless Node environments. They represent reported audit results rather than owner-reproduced executions.
2. **Static Inspection of Quarantined Repositories**: The commit hashes and file contents of the 7 external repositories and `AIStudio` were verified via local Git commands and static file inspection; no full build, runtime execution, or security scanning was performed on the external repositories.
3. **Legal Status of External Code**: License assessments reflect visible repository text and root files; formal intellectual property clearance or ownership provenance has not been established by legal counsel.
4. **Simulated Marketplace Economics**: Amazon India fee schedules and HSN tax rates in `seedData.ts` reflect March 2026 test fixtures; they have not been reconciled against live seller account statements or verified executable contracts.

---

## 5. Final Document Integrity & Cryptographic SHA-256 Hashes

The SHA-256 cryptographic hashes for the authoritative pre-approval package documents were computed using standard SHA-256 digest algorithms:

```
====================================================================================================
POC-001 PRE-APPROVAL DOCUMENT INTEGRITY MANIFEST (FIPS 180-4 SHA-256)
====================================================================================================
Document:   POC-001_Project_Charter_v0.2.3.md
File Path:  C:\Users\spaye\.gemini\antigravity\brain\f8d383dc-74a5-44e7-8222-da945383593a\POC-001_Project_Charter_v0.2.3.md
SHA-256:    316AFEDE00F5936872C164AEAD060353891CBE0164C69DC3C8806E27B54ED853
Byte Size:  26,880 bytes

Document:   SALVAGE_VERIFICATION_GATE_ADDENDUM_v1.3.md
File Path:  C:\Users\spaye\.gemini\antigravity\brain\f8d383dc-74a5-44e7-8222-da945383593a\SALVAGE_VERIFICATION_GATE_ADDENDUM_v1.3.md
SHA-256:    325E691390A2F25A717323EE6490C6F56977D19B45D9C97D113A6D75B54C9A1E
Byte Size:  24,801 bytes

Document:   EXTERNAL_SALVAGE_VERIFICATION_REPORT.md (v1.1)
File Path:  C:\Users\spaye\.gemini\antigravity\brain\f8d383dc-74a5-44e7-8222-da945383593a\EXTERNAL_SALVAGE_VERIFICATION_REPORT.md
SHA-256:    C4B843D67F130421817B620CF56AF0077FBFC5F1B5885807831309ED893EC93E
Byte Size:  22,015 bytes

Document:   FINAL_PRE_APPROVAL_CONSISTENCY_AUDIT.md
File Path:  C:\Users\spaye\.gemini\antigravity\brain\f8d383dc-74a5-44e7-8222-da945383593a\FINAL_PRE_APPROVAL_CONSISTENCY_AUDIT.md
SHA-256:    0F9664F6E8E4E55F79AE646A5F53879135CFD043E0CD2654824E67B6A6A42F94
Byte Size:  19,128 bytes
====================================================================================================
```

---

## 6. Workspace Boundary Verification & State Confirmation

An empirical audit was executed on the working filesystem immediately prior to this report:

1. **Workspace Root (`D:\Market HFT OS`)**:
   - `git status` executed in `D:\Market HFT OS`:
     ```
     fatal: not a git repository (or any of the parent directories): .git
     ```
   - **Status**: Confirmed. Root Git remains completely uninitialized. Zero application code has been written or migrated to the workspace root.
2. **Quarantined Legacy Repo (`D:\Market HFT OS\_salvage\AIStudio`)**:
   - Commit: `0c67e26e6e0f54da860b31dbcce6d587c7bdc91d` (`main`)
   - Working Tree: 100% clean, 0 uncommitted diffs, 0 modified files.
3. **Quarantined External Pool (`D:\Market HFT OS\_salvage\external\`)**:
   - `Bharat-SM-Data`: Commit `054102e`, working tree clean.
   - `Brand-building-skills`: Commit `4a0a8b5`, working tree clean.
   - `BrandPulse`: Commit `7251ad9`, working tree clean.
   - `HotFix`: Commit `99ea1aa`, working tree clean.
   - `nsepython`: Commit `32d82ea`, working tree clean.
   - `openalgo`: Commit `12e1114`, working tree clean.
   - `RANDOM`: Commit `55d5701`, working tree clean.

---

## 7. Recommended Owner Decision Framework

The project is positioned cleanly at the three-gate boundary:

```
┌────────────────────────────────────────────────────────────────────────┐
│ GATE 1: PROJECT CHARTER APPROVAL (v0.2.3)                             │
│ Status: READY FOR APPROVAL                                             │
│ Scope: Project Constitution, 4D Evidence Model, Economic Scope         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ GATE 2: SALVAGE VERIFICATION GATE APPROVAL (Addendum v1.3 & Ext v1.1)  │
│ Status: READY FOR CONDITIONAL APPROVAL                                 │
│ Scope: Component Disposition Matrix, 6-Status Solver Contract,         │
│        Downgraded Test Labels, redTeamRunner Redundant Designation     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ GATE 3: IMPLEMENTATION AUTHORIZATION (Gate M0 Root Git Init Only)      │
│ Status: PAUSED — AWAITING EXPLICIT PROJECT OWNER INSTRUCTION           │
│ Scope: Root .gitignore isolation, git init, initial doc commits        │
│        (Code migration and Gate M1 remain strictly blocked)            │
└────────────────────────────────────────────────────────────────────────┘
```

The decision package is complete, mathematically qualified, and cryptographically verified.
