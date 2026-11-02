# POC-001: Stage 1 — Milestone 1 Remediation Pass 2 Security Audit & Reconciliation

**Status:** AUDIT & TECHNICAL RECONCILIATION COMPLETE  
**Mode:** Strict Read-Only (Implementation Freeze ACTIVE)  
**Security Governance State:** Stage 1 OPEN; 0/14 Formal Gates Passed; GATE-03 UNVERIFIED  
**Repository Working Directory:** `D:\Market HFT OS`  
**Companion Repository:** `D:\ADRs`  
**Execution Timestamp:** 2026-10-26T23:06:00+05:30  

---

## 1. Executive Summary & Response to Review Findings

The owner's review of Remediation Pass 2 identified critical structural and lifecycle questions that required a strict read-only audit:
1. **LIM-02 (Test-Seam Enforcement):** Confirmed. Relying on `process.env.VITEST === 'true'` or `globalThis.__vitest_worker__` does not constitute an authentic security boundary against runtime manipulation. Furthermore, a detailed audit of [`src/infrastructure/browser/governed_http_connector.ts`](file:///d:/Market%20HFT%20OS/src/infrastructure/browser/governed_http_connector.ts) reveals that while `seam.socketFactory` is checked against the environment and production lock, **`seam.onResourceAllocated`**, **`seam.policy`**, and **`seam.dnsResolver`** are currently completely unguarded by that boundary check. A structural separation keeping all test seams out of production-facing APIs is required.
2. **LIM-03 (Redirect Response Lifecycle):** An exhaustive trace of the Node.js HTTP response event lifecycle confirms that `destroySocket()` is executed strictly after `res.on('end')` has fired. At this point, the HTTP response body has already been completely received and buffered, and no further data events occur. The `fail()` handler's `if (isSettled) return;` guard prevents late error emissions from causing unhandled rejections. Cleanup on redirect denial, latency timeout, and TLS mismatch is strictly fail-closed.
3. **LIM-01 (IPv6 Literal TLS Transport):** Formally recorded as **conditionally verified**, with live-handshake testing against local sockets explicitly deferred to avoid weakening production loopback policies.
4. **Regression Integrity:** The full test run of 52 files and 630 passed tests represents 100% of the 51 baseline files (606 tests) plus exactly 1 new unit test file (`tests/unit/unit_governed_collector.test.ts`, 24 tests), with zero regressions and zero failures (exit code 0).

---

## 2. LIM-02: Comprehensive Read-Only Audit of Seam Entry Points

### 2.1 Audit of Production-Reachable Seam Entry Points

An audit of all call sites across `src/` was conducted:
- Only a single production-facing caller exists: [`src/mcp/mcpSubstrate.ts`](file:///d:/Market%20HFT%20OS/src/mcp/mcpSubstrate.ts#L936-L950) via `ConstrainedHttpsConnector.fetch`.
- `ConstrainedHttpsConnector.fetch` accepts `ConstrainedHttpsOptions`:
  ```typescript
  export interface ConstrainedHttpsOptions {
    readonly method?: 'GET';
    readonly headers?: Record<string, string>;
    readonly max_payload_bytes: number;
    readonly timeout_ms: number;
    readonly allow_redirects?: boolean;
    readonly dnsLookupFn?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  }
  ```
- `ConstrainedHttpsConnector` routes `dnsLookupFn` into the seam:
  ```typescript
  [GOVERNED_CONNECTOR_INTERNAL_SEAM]: options.dnsLookupFn
    ? { dnsResolver: options.dnsLookupFn }
    : undefined
  ```
- Production callers invoking `ConstrainedHttpsConnector` cannot pass a `socketFactory`, `policy`, or `onResourceAllocated` through `ConstrainedHttpsOptions`.
- **However**, `GovernedHttpConnector` and `GOVERNED_CONNECTOR_INTERNAL_SEAM` are both exported at the module level in [`src/infrastructure/browser/governed_http_connector.ts`](file:///d:/Market%20HFT%20OS/src/infrastructure/browser/governed_http_connector.ts#L63). Any Node.js module that imports `GovernedHttpConnector` can also import `GOVERNED_CONNECTOR_INTERNAL_SEAM` and call `GovernedHttpConnector.fetch(url, { [GOVERNED_CONNECTOR_INTERNAL_SEAM]: { ... } })`.

### 2.2 Vulnerability to `VITEST=true` When Environment Variables Are Unset

In [`src/infrastructure/browser/governed_http_connector.ts`](file:///d:/Market%20HFT%20OS/src/infrastructure/browser/governed_http_connector.ts#L109-L119):
```typescript
public static isTestHarnessEnvironment(): boolean {
  if (GovernedHttpConnector._simulateNonTestRuntimeForTesting) {
    return false;
  }
  if (process.env.NODE_ENV === 'production' || process.env.MARKET_HFT_ENV === 'production') {
    return false;
  }
  const hasVitestWorker = typeof (globalThis as any).__vitest_worker__ !== 'undefined';
  const hasVitestEnv = process.env.VITEST === 'true';
  return hasVitestWorker || hasVitestEnv;
}
```
**Audit Finding:**
If an operator runs in an environment where `NODE_ENV` and `MARKET_HFT_ENV` are unset (e.g. default Node container or developer machine), setting `VITEST=true` (or `process.env.VITEST = 'true'`) evaluates `hasVitestEnv === true`, bypassing `isTestHarnessEnvironment()`.
If `GovernedHttpConnector.lockForProduction()` was not explicitly called at startup, a caller can successfully call `unlockTestSeamForTesting()` and supply an arbitrary `socketFactory`.

### 2.3 Protection Status of Other Seam Properties

Examining [`src/infrastructure/browser/governed_http_connector.ts`](file:///d:/Market%20HFT%20OS/src/infrastructure/browser/governed_http_connector.ts#L202-L227):
```typescript
const seam = options[GOVERNED_CONNECTOR_INTERNAL_SEAM];
const policy = GovernedHttpConnector.getPolicy(seam?.policy);

// Enforce production boundary on socket factory injection
if (seam?.socketFactory) {
  if (GovernedHttpConnector.isLockedForProduction) { ... }
  if (process.env.NODE_ENV === 'production' || process.env.MARKET_HFT_ENV === 'production') { ... }
  if (!GovernedHttpConnector.isTestHarnessEnvironment()) { ... }
  if (!GovernedHttpConnector.isTestSeamExplicitlyEnabled) { ... }
}
```
**Critical Audit Findings:**
1. **`onResourceAllocated` is completely unprotected:** The boundary check explicitly guards `if (seam?.socketFactory)`. If a caller passes `[GOVERNED_CONNECTOR_INTERNAL_SEAM]: { onResourceAllocated: (type, res) => ... }` without a `socketFactory`, the check is bypassed. The caller receives direct, live references to Node's internal `http.ClientRequest`, `net.Socket` / `tls.TLSSocket`, and `zlib` stream instances, allowing socket hijacking or listener modification.
2. **`policy` is completely unprotected:** `GovernedHttpConnector.getPolicy(seam?.policy)` replaces the entire `NetworkSecurityPolicy` instance if `seam?.policy` is provided, with zero boundary checks. A caller could pass a dummy policy where `classifyIpAddress()` always returns `{ isProhibited: false }`.
3. **`dnsResolver` is unprotected by the seam guard:** While resolved IPs are still subjected to IP classification, `seam.dnsResolver` is accepted without verifying the seam lock.

### 2.4 Preferred Resolution for LIM-02

To resolve LIM-02 permanently without relying on runtime environment heuristics or startup call conventions:
- **Complete Elimination of Seams from Production Types & Method Signatures:**
  `GovernedHttpOptions` in production should contain only operational networking properties: `method`, `headers`, `max_payload_bytes`, `max_decompressed_bytes`, `timeout_ms`, `dns_timeout_ms`, and `allow_redirects`.
- **Physical Test-Seam Encapsulation:**
  If unit tests require injecting mock sockets or observing decompressors, the test hooks should not exist in the production class `GovernedHttpConnector`. Instead:
  - Option A: Implement a separate test subclass or companion module residing strictly in `tests/` or a non-production test fixture directory (e.g. `tests/fixtures/testable_governed_connector.ts`) that overrides internal protected methods.
  - Option B: If an internal seam is retained, fail closed if `options[GOVERNED_CONNECTOR_INTERNAL_SEAM]` is defined under ANY circumstance unless an authentic private symbol held exclusively within test files is passed, with ALL seam properties (`socketFactory`, `policy`, `dnsResolver`, `onResourceAllocated`) rejected unconditionally if present in production.

---

## 3. LIM-03: Detailed Inspection of Redirect Response Lifecycle

### 3.1 Timing of `destroySocket()` Execution

In [`src/infrastructure/browser/governed_http_connector.ts`](file:///d:/Market%20HFT%20OS/src/infrastructure/browser/governed_http_connector.ts#L380-L388):
```typescript
const statusCode = attemptResult.status;
if (statusCode >= 300 && statusCode < 400) {
  // Explicitly destroy the first-hop socket before following redirect or failing
  attemptResult.destroySocket?.();

  if (!allowRedirects) {
    throw new Error(
      `E-MCP-REDIRECT-DENIED: Server returned redirect status ${statusCode} but redirects are disallowed.`
    );
  }
  ...
```

**Lifecycle Inspection:**
1. **When is `destroySocket` created?**
   In `executeSocketRequest`, `destroySocket` is defined inside `res.on('end')` (lines 706-713) or `decompressStream.on('end')` (lines 663-670).
2. **State of the stream when `destroySocket` is called:**
   Because `resolve()` is only called inside the `'end'` callback of the HTTP response or decompressor stream, the incoming HTTP message has **already emitted `'end'`**. The entire HTTP response (headers and status code, plus any redirect HTML body) has been completely read and buffered into memory.
3. **Absence of Stream Races:**
   Because `'end'` has already fired:
   - Node's HTTP parser has completed parsing the response.
   - No subsequent `'data'` events will ever be emitted.
   - Calling `activeSocket.destroy()` on an already-ended socket safely tears down the underlying TCP socket and file descriptor without truncating in-flight response data.
4. **Unhandled Stream Error Protection:**
   In `executeSocketRequest`, `res.on('error', ...)` forwards errors to `fail(err)`. The `fail` routine begins with:
   ```typescript
   if (isSettled) return;
   isSettled = true;
   ```
   Because `isSettled` was already set to `true` when `'end'` resolved the promise, any subsequent event emitted during socket destruction is safely discarded, preventing unhandled rejections or uncaught exceptions.

### 3.2 Error-Path Cleanup Verification

| Failure Mode | Failure Point | Socket State | Decompressor State | Verified By |
| :--- | :--- | :--- | :--- | :--- |
| **Redirect Denied (`allowRedirects: false`)** | Line 384: after 3xx received | Destroyed at line 382 prior to throwing `E-MCP-REDIRECT-DENIED`. | Destroyed / unallocated. | Verified by code structure. |
| **Redirect Hop Limit (`currentHop >= 3`)** | Line 391: after 3xx received | Destroyed at line 382 prior to throwing `E-MCP-MAX-REDIRECTS-EXCEEDED`. | Destroyed / unallocated. | Verified by code structure. |
| **Redirect Revalidation Failure (SSRF target)** | Line 271/289 on Hop 2 | First-hop socket destroyed at line 382; second-hop socket blocked before allocation. | None allocated. | Verified in `COL-16D`. |
| **Request Latency Timeout** | `requestTimer` fires | `fail()` destroys `activeSocket` and `activeRequest`. | None allocated (or destroyed if active). | Verified in `COL-16A`. |
| **Malformed Decompression** | `decompressStream.on('error')` | `fail()` destroys `activeSocket` and `activeRequest`. | `fail()` destroys `activeDecompressor`. | Verified in `COL-16B`. |
| **TLS Certificate Mismatch** | `req.on('error')` | `fail()` destroys `activeSocket` and `activeRequest`. | None allocated. | Verified in `COL-16C`. |

---

## 4. LIM-01: Retention of Conditional Acceptance Status

- **Current Implementation:** Fully adheres to RFC standards:
  - Connects directly to unbracketed IPv6 literal (e.g. `2606:2800:220:1:248:1893:25c8:1946`) via `host: pinnedIp`.
  - Retains square brackets in HTTP Host header per RFC 3986 §3.2.2 / RFC 9110 §7.2 (`Host: [2606:2800:...]`).
  - Omits TLS SNI ClientHello extension for IP literals per RFC 6066 §3 (`servername: undefined`).
  - Validates certificate identity against unbracketed IP literal using Node's native `tls.checkServerIdentity`.
- **Status Clarification:** As acknowledged, live TLS handshake verification against a local socket is **formally deferred** to avoid weakening or punching exceptions into the production loopback policy (`127.0.0.1` / `::1`).
- **Disposition:** LIM-01 is maintained as **Conditionally Verified**, not end-to-end verified across live wire transport.

---

## 5. Regression Test Evidence Breakdown

The full regression test suite was executed via background task `task-25195`.
- **Command:** `cmd.exe /c npx vitest run --exclude "**/suite42*"`
- **Exit Code:** `0`
- **Duration:** 60.99s
- **Total Test Files:** 52 passed (52)
- **Total Tests:** 630 passed (630)

### 5.1 Test Count Delta & Lineage Reconciliation
- **Pre-Milestone 1 Baseline:** 606 passed tests across 51 files.
- **Milestone 1 Implementation:** Added [`tests/unit/unit_governed_collector.test.ts`](file:///d:/Market%20HFT%20OS/tests/unit/unit_governed_collector.test.ts) (+15 tests = 621 tests).
- **Remediation Pass 1:** Added `COL-15` through `COL-17C` (+8 tests = 629 tests).
- **Remediation Pass 2:** Added `COL-17D` (+1 test = 630 tests).
- **Regression Audit:** All 51 baseline files (606 tests) passed with zero errors or skips. Exactly 24 tests exist in the new unit test file. 606 + 24 = 630. Zero regressions occurred.

### 5.2 Key Security & Substrate Suite Results
- `tests/acceptance/suite31_m6_9_mcp_hardening_and_terminal_certification.test.ts`: 12/12 passed (226ms).
- `tests/acceptance/suite24_m6_2_source_capture_worker.test.ts`: 9/9 passed (43ms).
- `tests/unit/unit_iana_policy.test.ts`: 134/134 passed (252ms).
- `tests/unit/unit_nat64_extraction.test.ts`: 21/21 passed (40ms).
- `tests/integration/suite51_governed_proxy_socket_boundary.test.ts`: 8/8 passed (152ms).
- `tests/acceptance/suite50_browser_network_security_boundary.test.ts`: 8/8 passed (85ms).

---

## 6. Git Status & Working Tree Integrity

### 6.1 Tracked Files
```text
 M src/mcp/mcpSubstrate.ts
```
- Exactly 1 tracked modified file (+19 / -124 diff).
- Zero files staged; zero commits executed.

### 6.2 Preserved Untracked Files (14 files)
All 14 pre-existing untracked files remain physically intact:
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

### 6.3 Authorized Untracked Files (2 files)
15. `src/infrastructure/browser/governed_http_connector.ts`
16. `tests/unit/unit_governed_collector.test.ts`

### 6.4 Companion ADR Repository (`D:\ADRs`)
100% clean on `main` at `5d4e7b5a5c879817a41fd03b0db045ffeb1adc9b`.

---

## 7. Governance Status Reconciliation

- **Remediation Pass 2:** Complete; audit and reconciliation documented.
- **LIM-01 (IPv6 TLS):** Conditionally verified; live-handshake testing deferred.
- **LIM-02 (Test-Seam Enforcement):** **OPEN** pending structural relocation of test seams outside production-facing APIs.
- **LIM-03 (Resource Cleanup):** Verified and closed pending owner sign-off.
- **Stage 1 Security Gates:** **0/14 Passed**.
- **GATE-03 Status:** **UNVERIFIED**.
- **Implementation Freeze:** **ACTIVE**.
- **Milestone 2 Status:** **NOT AUTHORIZED**.
