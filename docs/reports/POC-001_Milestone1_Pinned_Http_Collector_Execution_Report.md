# POC-001: Stage 1 — Milestone 1 Execution Report
**Scope:** Lean Pinned HTTP Collector (`GovernedHttpConnector`) & Adversarial Unit Verification  
**Status:** IMPLEMENTATION COMPLETE — READY FOR OWNER AUDIT  
**Security Governance State:** Stage 1 OPEN; 0/14 Formal Gates Passed  
**Repository Working Directory:** `D:\Market HFT OS`  
**Companion Repository:** `D:\ADRs`  
**Execution Timestamp:** 2026-10-26T20:53:30+05:30  

---

## 1. Executive Summary

Under explicit conditional owner authorization for **Milestone 1 only**, the lean IP-pinned HTTP collector (`GovernedHttpConnector`) has been implemented, the existing egress choke point (`ConstrainedHttpsConnector` in [`src/mcp/mcpSubstrate.ts`](file:///d:/Market%20HFT%20OS/src/mcp/mcpSubstrate.ts)) has been refactored to delegate to it, and the comprehensive adversarial unit test suite (`COL-01` through `COL-14B`) has been authored and verified.

The pre-change baseline of 606 passing tests across 51 test files was confirmed prior to touching any code. Following implementation, all 621 tests across 52 test files passed with zero failures and zero regressions. Exactly three files were touched or created, strictly within authorized boundaries, and all 14 pre-existing untracked files remain intact.

---

## 2. Pre-Change Regression Baseline

Before making any modifications, the full regression suite was executed:
- **Command:** `cmd.exe /c npx vitest run --exclude "**/suite42*"`
- **Exit Code:** `0`
- **Baseline Test Files:** 51 passed (51)
- **Baseline Tests:** 606 passed (606)
- **Duration:** 56.48s
- **Tracked Repository Status:** Clean (transient workstation export artifact `dist/POC-001_Standalone_Workstation.html` restored immediately after run).

---

## 3. Scope of Authorized Modifications

Milestone 1 was executed strictly within the three authorized files:

| File Path | Status | Purpose / Invariants |
| :--- | :--- | :--- |
| [`src/infrastructure/browser/governed_http_connector.ts`](file:///d:/Market%20HFT%20OS/src/infrastructure/browser/governed_http_connector.ts) | **Created** (New) | Production `GovernedHttpConnector` class: IP-literal socket pinning via `node:https`, conservative mixed-answer rejection, deterministic family ordering, single bounded retry to pre-validated secondary IP literal, DNS cancellation guard, dual stream caps, hop-by-hop redirect revalidation, and isolated test seam. |
| [`src/mcp/mcpSubstrate.ts`](file:///d:/Market%20HFT%20OS/src/mcp/mcpSubstrate.ts) | **Modified** (Lines 24–28, 936–957) | Refactored `ConstrainedHttpsConnector.fetch()` to delegate directly to `GovernedHttpConnector.fetch()`, maintaining 100% interface and error-code compatibility for existing callers (`sourceCaptureWorker.ts` and `suite31`). |
| [`tests/unit/unit_governed_collector.test.ts`](file:///d:/Market%20HFT%20OS/tests/unit/unit_governed_collector.test.ts) | **Created** (New) | 15 adversarial test vectors (`COL-01` to `COL-14B`) verifying network security and error handling without external network egress. |

**No other files were created, modified, staged, or committed.**

---

## 4. Architectural & Security Implementation Details

### 4.1 DNS Cancellation & No-Late-Connect Invariant
In accordance with owner guidance, `GovernedHttpConnector` avoids relying on `Promise.race()` alone to abort background DNS operations. An explicit cancellation guard (`isDnsAborted`) is maintained:
```typescript
let isDnsAborted = false;
let timerHandle: NodeJS.Timeout | undefined;

const timeoutPromise = new Promise<never>((_, reject) => {
  timerHandle = setTimeout(() => {
    isDnsAborted = true;
    reject(new Error(`E-MCP-DNS-TIMEOUT: DNS resolution timed out after ${dnsTimeoutMs}ms for '${hostname}'.`));
  }, dnsTimeoutMs);
});

const lookupPromise = (async (): Promise<string[]> => {
  // parallel IPv4 and IPv6 lookups...
  if (isDnsAborted) return [];
  // return resolved IP addresses...
})();
```
If the DNS timer fires, `isDnsAborted` is set to `true`. Late-resolving DNS queries in `lookupPromise` inspect `isDnsAborted` and immediately drop their results, ensuring late results can **never** initiate a TCP connection or socket allocation.

### 4.2 Conservative Mixed-Answer Evaluation
All candidate IPs from parallel lookups are evaluated against [`NetworkSecurityPolicy.classifyIpAddress()`](file:///d:/Market%20HFT%20OS/src/infrastructure/browser/network_security_policy.ts). If **any** candidate IP is prohibited (private, loopback, cloud metadata, link-local, unallocated), the entire resolution fails closed immediately (`E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED`) before any socket is requested.

### 4.3 Deterministic Family Ordering & Bounded Single Retry
Candidate IPs are sorted deterministically:
1. IPv4 addresses precede IPv6 addresses.
2. Ties within each family are sorted lexicographically (`localeCompare`).
3. Connection is attempted to `primaryIp = orderedCandidates[0]`.
4. If connecting to `primaryIp` experiences a network-level socket failure (`ECONNREFUSED`, `ETIMEDOUT`, `ENETUNREACH`, `EHOSTUNREACH`, `EADDRNOTAVAIL`), and a pre-validated `secondaryIp` exists, exactly one retry is attempted.
5. **Critical Invariant:** The retry connects directly to the pre-validated `secondaryIp` literal and **never** re-queries DNS or hostname.

### 4.4 True IP-Literal Socket Pinning in Node.js
When initiating requests via `node:https`:
```typescript
const requestOptions: https.RequestOptions = {
  host: pinnedIp, // Direct IP literal connect — bypasses libc getaddrinfo
  port: 443,
  path: parsedUrl.pathname + parsedUrl.search,
  method: options.method ?? 'GET',
  headers: {
    ...options.headers,
    Host: parsedUrl.host
  },
  servername: parsedUrl.hostname, // Sets TLS SNI ClientHello to original domain
  agent: false, // Disables connection pooling
  checkServerIdentity: (host, cert) => tls.checkServerIdentity(parsedUrl.hostname, cert)
};
```
TLS identity verification is enforced strictly against `parsedUrl.hostname`, rejecting certificate host mismatches with `E-MCP-TLS-CERT-INVALID`.

### 4.5 Dual Streaming Payload Caps & Decompression Bounds
- **Wire chunks:** Accumulated against `max_payload_bytes` (default 512 KB). Exceeding this cap immediately terminates the socket in-flight (`E-MCP-STREAM-PAYLOAD-TOO-LARGE`).
- **Decompressed chunks:** When `content-encoding` is `gzip`, `deflate`, or `br`, decompressed bytes are accumulated against `max_decompressed_bytes` (default 1 MB). Exceeding this cap destroys both the decompressor stream and the underlying socket (`E-MCP-DECOMPRESSED-PAYLOAD-TOO-LARGE`).
- **Operational Limitation Note:** Streaming byte limits protect process memory against expansion bombs. CPU-time exhaustion during software decompression is an inherent software operational boundary acknowledged as a bounded limitation rather than an absolute mathematical guarantee of zero CPU consumption.

### 4.6 Hop-by-Hop Redirect Revalidation
- Maximum redirect limit: 3 hops (`E-MCP-MAX-REDIRECTS-EXCEEDED`).
- Disallowed redirects throw `E-MCP-REDIRECT-DENIED`.
- Target URLs are resolved against the current URL and verified for `https:` and port `443`.
- Sensitive headers (`Authorization`, `Cookie`, `Proxy-Authorization`) are stripped on cross-origin redirects.
- Every redirect hop performs fresh DNS resolution, full IP classification, and socket re-pinning.

### 4.7 Structurally Protected Test Seam
The socket factory and DNS resolver injection seams are keyed by a unique Symbol:
```typescript
export const GOVERNED_CONNECTOR_INTERNAL_SEAM = Symbol('GOVERNED_CONNECTOR_INTERNAL_SEAM');
```
Production option wrappers (`ConstrainedHttpsOptions`) and normal callers cannot access these seams by string property injection, preserving structural isolation.

---

## 5. Adversarial Unit Test Suite Results

The dedicated adversarial test suite [`tests/unit/unit_governed_collector.test.ts`](file:///d:/Market%20HFT%20OS/tests/unit/unit_governed_collector.test.ts) executed all 15 targeted vectors:

| Vector ID | Test Vector Description | Result |
| :--- | :--- | :--- |
| `COL-01` | Direct private IPv4 address literals (`10.0.0.1`, `172.16.0.1`, `192.168.1.1`) fail closed | **PASS** (1ms) |
| `COL-02` | Direct cloud instance metadata IP literal (`169.254.169.254`) fails closed | **PASS** (1ms) |
| `COL-03` | Direct IPv6 loopback (`::1`) and ULA (`fc00::/7`) fail closed | **PASS** (1ms) |
| `COL-04` | Proves socket connects to pinned IP literal, eliminating DNS rebinding window | **PASS** (10ms) |
| `COL-05` | Conservative mixed-answer rejection fails closed if ANY candidate is prohibited (0 connections) | **PASS** (2ms) |
| `COL-06` | Deterministic family ordering and single bounded retry to pre-validated IP literal | **PASS** (12ms) |
| `COL-07` | Permitted upstream retrieval succeeds and preserves SNI / Host headers | **PASS** (10ms) |
| `COL-08` | TLS certificate hostname mismatch fails closed with `E-MCP-TLS-CERT-INVALID` | **PASS** (8ms) |
| `COL-09` | Unsafe redirect to cloud metadata IP literal is intercepted and rejected | **PASS** (9ms) |
| `COL-10` | Relative redirect is resolved safely against current origin and followed | **PASS** (16ms) |
| `COL-11` | Exceeding maximum redirect limit (3 hops) fails closed with `E-MCP-MAX-REDIRECTS-EXCEEDED` | **PASS** (22ms) |
| `COL-12` | Sensitive credentials (`Authorization`, `Cookie`) are stripped across origin changes | **PASS** (16ms) |
| `COL-13` | DNS timeout rejects request and late results NEVER initiate socket connections | **PASS** (204ms) |
| `COL-14A` | Wire chunks exceeding `max_payload_bytes` terminate socket in-flight | **PASS** (8ms) |
| `COL-14B` | Compressed payload exceeding `max_decompressed_bytes` terminates stream and socket | **PASS** (9ms) |

**Total Unit Tests:** 15 passed, 0 failed. Duration: 547ms.

---

## 6. Post-Implementation Full Regression Verification

Following implementation and unit test passing, the complete regression test suite was executed:
- **Command:** `cmd.exe /c npx vitest run --exclude "**/suite42*"`
- **Exit Code:** `0`
- **Post-Change Test Files:** 52 passed (52)
- **Post-Change Tests:** 621 passed (621)
- **Net Delta:** Exactly +15 tests, +1 test file, 0 failures, 0 regressions.
- **Key Egress Suites:**
  - `suite31_m6_9_mcp_hardening_and_terminal_certification.test.ts`: 12/12 passed (including test 3 port/scheme/IP checks and test 4 streaming byte cutoff).
  - `suite24_m6_2_source_capture_worker.test.ts`: 9/9 passed.
  - `unit_iana_policy.test.ts`: 134/134 passed.
  - `unit_nat64_extraction.test.ts`: 21/21 passed.

---

## 7. Git Status & Untracked File Preservation Reconciliation

### 7.1 Tracked Modifications in `d:\Market HFT OS`
```text
 M src/mcp/mcpSubstrate.ts
```
Only the single authorized file has tracked modifications. No files are staged; zero commits have been made.

### 7.2 Untracked Files Reconciliation
Exactly 16 untracked files are present on disk:
- **14 Pre-existing preserved files:**
  1. `registry/snapshots/CHECKSUMS.sha256`
  2. `registry/snapshots/iana-ipv4-special-registry.xml`
  3. `registry/snapshots/iana-ipv6-special-registry.xml`
  4. `registry/snapshots/ipv4-address-space.xml`
  5. `registry/snapshots/ipv6-unicast-address-assignments.xml`
  6. `registry/snapshots/manifest.json`
  7. `scripts/fetch_iana_snapshots.ts`
  8. `src/infrastructure/browser/iana_registry_snapshot.ts`
  9. `src/infrastructure/browser/network_security_policy.ts`
  10. `tests/acceptance/suite49_category_agnostic_discovery_pipeline.test.ts`
  11. `tests/acceptance/suite50_browser_network_security_boundary.test.ts`
  12. `tests/integration/suite51_governed_proxy_socket_boundary.test.ts`
  13. `tests/unit/unit_iana_policy.test.ts`
  14. `tests/unit/unit_nat64_extraction.test.ts`
- **2 Newly authorized Milestone 1 files:**
  15. `src/infrastructure/browser/governed_http_connector.ts`
  16. `tests/unit/unit_governed_collector.test.ts`

### 7.3 Status of `d:\ADRs`
```text
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean
```
Repository `d:\ADRs` remains 100% clean and untouched.

---

## 8. Governance State & Next Step Recommendation

- **Stage 1 Security Gates:** Still recorded as 0/14 passed. Completion of Milestone 1 provides a functional, pinned HTTP collector with adversarial test coverage; it does not constitute unverified claims of production security gate passage.
- **GATE-03 Status:** Demarcated as Tier 3 IANA `/8` top-level allocation check only; fine-grained daily RIR delegation ingestion remains unverified.
- **Freeze Status:** Implementation freeze is reinstated pending owner review of this Milestone 1 evidence package.
- **Next Milestone:** Upon owner review and approval, Milestone 2 (Live Public Retrieval & Market Observation Verification) may be planned and authorized.
