# POC-001 — Stage 1 Local Proxy Socket Boundary Verification Report

**Document ID:** `POC-001-STAGE1-SEC-003`  
**Date:** 2026-10-25  
**Governance Status:** BOUNDED TEST-ONLY INVESTIGATION (Implementation Freeze Active; Zero Production Code Modifications; Zero Commits)  
**Applicability:** POC-001 Market HFT OS (`d:/Market HFT OS`) and Architectural Decision Records (`d:/ADRs`)  

---

## 1. Executive Summary & Authorization Compliance

In accordance with owner directive **POC-001 — Authorization: Stage 1 Local Proxy Socket Tests**, this report records the execution and connection-level findings of real local proxy socket integration tests.

### Boundary Invariants Preserved
- **Zero Production Changes:** No source files in [`src/`](file:///d:/Market%20HFT%20OS/src) were modified.
- **Zero Manifest / Dependency Changes:** `package.json` remains untouched; Playwright is **not** installed.
- **Zero External Network / Crawling:** All tests operated exclusively on local loopback TCP sockets (`127.0.0.1`); zero external requests, zero real cloud metadata contacted.
- **Zero Database / Ledger Writes:** PostgreSQL schemas and tables remain untouched.
- **Zero Commits:** Working trees remain uncommitted and unstaged.

---

## 2. Exact Git Working-Tree Reconciliation

### 2.1 Before vs. After State

| Repository | HEAD Commit SHA | `git status --short` Before | `git status --short` After | Tracked Files Status |
| :--- | :--- | :--- | :--- | :---: |
| [`d:/Market HFT OS`](file:///d:/Market%20HFT%20OS) | `4ba8191f1f9e539a109d020265a0351f32e99d23` | `?? tests/acceptance/suite49...`<br>`?? tests/acceptance/suite50...` | `?? tests/acceptance/suite49...`<br>`?? tests/acceptance/suite50...`<br>`?? tests/integration/suite51...` | **100% Clean** (0 modified, 0 staged) |
| [`d:/ADRs`](file:///d:/ADRs) | `5d4e7b5a5c879817a41fd03b0db045ffeb1adc9b` | *(Clean — no output)* | *(Clean — no output)* | **100% Clean** (0 untracked, 0 modified) |

### 2.2 Reconciled Test Inventory (Deterministic Baseline)
- **Baseline before Suite 49:** 46 files, 427 tests passed.
- **After Suite 49:** 47 files, 435 tests passed.
- **After Suite 50:** 48 files, 443 tests passed.
- **Current Baseline (including Suite 51):** **49 test files passed (49), 451 tests passed (451)** in 57.68s (excluding live provider suite `suite42`). Zero regressions, zero skipped, zero failed.

---

## 3. Suite 51 Implementation & Connection-Level Evidence

Suite 51 was authored in [`tests/integration/suite51_governed_proxy_socket_boundary.test.ts`](file:///d:/Market%20HFT%20OS/tests/integration/suite51_governed_proxy_socket_boundary.test.ts). It instantiates real TCP/HTTP listeners on ephemeral ports:
1. `PermittedServer` (`127.0.0.1:<portA>`): Tracks every accepted TCP connection and incoming HTTP request.
2. `ProhibitedServer` (`127.0.0.1:<portB>`): Simulates cloud IMDS (`169.254.169.254`) or internal LAN endpoints. Instruments a `server.on('connection')` listener that logs socket remote addresses, ports, and timestamps.
3. `GovernedProxyServer` (`127.0.0.1:<portP>`): Real forwarding HTTP/HTTPS proxy implementing connection-time destination validation, destination IP pinning, Host preservation, and redirect pre-checking.

```mermaid
flowchart TD
    Client["Client / Subprocess"]
    Proxy["Governed Proxy (Port P)"]
    Permitted["Permitted Server (Port A)<br>permittedConnections counter"]
    Prohibited["Prohibited Server (Port B)<br>prohibitedConnections counter"]

    Client -->|HTTP GET / CONNECT| Proxy
    Proxy -->|Pre-socket check: ALLOWED| Permitted
    Proxy -.->|Pre-socket check: BLOCKED (403)| Prohibited

    Client -.->|TEST-08: Direct raw socket bypass (No OS firewall)| Prohibited

    style Prohibited fill:#ffcccc,stroke:#cc0000,stroke-width:2px;
    style Permitted fill:#ccffcc,stroke:#009900,stroke-width:2px;
```

### 3.1 Test Execution Results & Socket-Level Proof
- **Execution Command:** `npx.cmd vitest run tests/integration/suite51_governed_proxy_socket_boundary.test.ts`
- **Result:** **8 passed (8)** in 152ms.

| Test ID | Test Scenario | Client Response | Permitted Hits | Prohibited TCP Sockets | Socket-Level Evidence & Audit Detail |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `TEST-01` | **Permitted Upstream Retrieval** | `200 OK` | `1` | **`0`** | Upstream socket created directly to validated IP `127.0.0.1:<portA>`; `Host: 127.0.0.1:<portA>` preserved. |
| `TEST-02` | **Direct Prohibited Destination** | `403 Forbidden` (`E-BROWSER-BLOCKED-IP`) | `0` | **`0`** | Proxy evaluated destination before socket creation; TCP handshake was **never initiated** to Port B (`prohibitedSocketEvents.length === 0`). |
| `TEST-03` | **HTTP 302 Redirect Interception** | `403 Forbidden` (`E-BROWSER-REDIRECT-PROHIBITED`) | `1` | **`0`** | Permitted server returned 302 pointing to Port B. Proxy intercepted `Location:` header; validated destination IP/port; aborted before secondary socket creation. |
| `TEST-04` | **Dynamic DNS Rebinding Defense** | Req 1: `200 OK`<br>Req 2: `403 Forbidden` | `1` | **`0`** | Hostname resolved to Port A on call 1, Port B on call 2. Proxy re-evaluated destination before call 2 socket; aborted fail-closed (`prohibitedConnections === 0`). |
| `TEST-05` | **Blocked Subresource Isolation** | Primary: `200 OK`<br>Subresource: `403` | `1` | **`0`** | Primary document parsed successfully; secondary `<img>` request through proxy blocked fail-closed without crashing session. |
| `TEST-06` | **Fail-Closed Proxy Shutdown** | `ECONNREFUSED` | `0` | **`0`** | Proxy server was closed. Client connection was immediately refused. Zero upstream connections occurred to either listener. |
| `TEST-07` | **HTTPS CONNECT Tunnel Blocked** | `403 Forbidden` (`SSRF-PREVENTION`) | `0` | **`0`** | Client sent `CONNECT 127.0.0.1:<portB>`. Proxy rejected destination before creating upstream socket and destroyed client socket. |
| `TEST-08` | **Direct Connection Bypass Exposure** | `200 OK` (`PROHIBITED_LEAK`) | `0` | **`1`** | Raw socket connection made directly to Port B, bypassing the proxy. Prohibited server received TCP connection (`prohibitedConnections === 1`). |

### 3.2 Key Finding from `TEST-08`
`TEST-08` provides absolute empirical proof of the owner's core requirement: **Proxy configuration alone does NOT prevent SSRF if a browser process or subprocess can open direct sockets.** When a process bypasses the proxy port, the prohibited server accepts the TCP connection. This demonstrates why OS-level egress enforcement is an indispensable requirement, not an optional hardening measure.

---

## 4. Test Classification Taxonomy

To prevent conflating test-helper code with verified production infrastructure, all tests are explicitly classified below:

| Suite | File Path | Tests | Test Classification | Scope of Proof |
| :---: | :--- | :---: | :--- | :--- |
| **49** | `tests/acceptance/suite49_category_agnostic_discovery_pipeline.test.ts` | 8 | **Production Integration & Replay Fixture Verification** | Proves candidate evaluation, citation-span grounding, category-neutral ranking, and missing-data penalties in [`src/`](file:///d:/Market%20HFT%20OS/src). Does not prove live external crawling. |
| **50** | `tests/acceptance/suite50_browser_network_security_boundary.test.ts` | 8 | **Unit-Level Policy-Logic Tests** | Proves CIDR range calculations, IPv6 normalization, and in-memory URL validation logic. Does not prove deployed proxy or browser confinement. |
| **51** | `tests/integration/suite51_governed_proxy_socket_boundary.test.ts` | 8 | **Proxy-Level Socket Integration Tests (Real Sockets)** | Proves real proxy server enforces destination IP pinning, pre-socket DNS validation, redirect interception, and subresource blocking with instrumented zero-hit socket proof. |
| **OS** | *OS-Level Kernel Egress Gate (WFP / nftables)* | 0 | **Untested Design Specification** | **Not yet proven.** Windows firewall / Linux namespace rules require elevated admin privileges and separate verification. |

---

## 5. Security Clarifications & Architectural Corrections

### 5.1 Upstream Destination IP Pinning & Host Preservation
In standard forward proxies, establishing an upstream socket by hostname (e.g. `net.connect(port, hostname)`) causes the operating system's resolver to perform a second, uncontrolled DNS lookup at connect time. This introduces a Time-Of-Check to Time-Of-Use (TOCTOU) vulnerability where DNS rebinding can occur between proxy validation and socket creation.

**Implemented Defense:**
The governed proxy resolves the hostname authoritatively (`dns.lookup` with `{ all: true }`), verifies that every resolved IP is public, and then connects the upstream socket **directly to the validated IP address**:
```typescript
const upstreamReq = http.request({
  host: validation.resolvedIp, // Pinned pre-validated IP address
  port: port,
  path: targetUrl.pathname + targetUrl.search,
  method: req.method,
  headers: {
    ...req.headers,
    host: targetUrl.host // Preserved virtual host for HTTP virtual hosting / SNI
  }
});
```

### 5.2 Redirect Pre-Socket Interception
When an upstream server returns an HTTP 301, 302, or 307 redirect, standard HTTP clients follow the `Location:` header automatically. If the redirect points to `http://169.254.169.254/latest/meta-data`, a socket to the metadata service would be opened.

**Implemented Defense:**
The proxy intercepts all HTTP 3xx responses with a `Location:` header. Before piping the redirect to the client or initiating any subsequent request, the proxy parses the target URL and subjects its resolved IP to the complete prohibited CIDR filter. If prohibited, it emits `E-BROWSER-REDIRECT-PROHIBITED` and drops the connection fail-closed.

### 5.3 Proxy Shutdown vs. Browser Confinement
- **What Proxy Shutdown Proves:** When the proxy terminates, clients configured to route through the proxy receive immediate `ECONNREFUSED`. Upstream leakage does not occur through the proxy.
- **What Proxy Shutdown Does NOT Prove:** It does **not** prove browser confinement. If the browser process has direct internet egress, a proxy failure could theoretically cause a buggy browser or extension to fall back to direct connection if proxy failover is misconfigured. Only kernel-level firewall rules eliminate direct fallback.

### 5.4 Truthful Reporting of OS-Level Enforcement Status
- **Status:** **UNTESTED / DESIGN SPECIFICATION ONLY.**
- Vitest executes in a standard unprivileged user session. Installing Windows Defender Firewall rules (`New-NetFirewallRule`) requires elevated Administrator privileges. We explicitly report that OS-level egress enforcement has **not** been tested in the test runner and cannot be marked as verified until run in an elevated environment.

### 5.5 Corrected Linux Network-Namespace Topology
The previous specification contained a conceptual flaw: placing Chromium in an isolated namespace without external egress while expecting it to communicate with a proxy without a defined forwarding path.

**Corrected Dual-Namespace Topology:**
```
+-------------------------------------------------------------------------------+
| Host Network Namespace (ns_host)                                              |
|                                                                               |
|  +-------------------------------------+      +----------------------------+  |
|  | Governed Proxy Process              |      | External Network Interface |  |
|  | Listens on 10.200.1.1:PROXY_PORT    |      | (eth0 / Internet Egress)   |  |
|  +------------------^------------------+      +-------------^--------------+  |
|                     |                                       |                 |
|  +------------------+------------------+                    | (Proxy TCP only)|
|  | Host Veth Peer (veth_host)          |                    |                 |
|  | IP: 10.200.1.1/30                   |                    |                 |
|  +------------------^------------------+                    |                 |
+---------------------|---------------------------------------|-----------------+
                      | Virtual Ethernet Pair (veth)          |
+---------------------|---------------------------------------|-----------------+
| Isolated Browser Namespace (ns_browser)                     |                 |
|                                                             |                 |
|  +------------------v------------------+                    |                 |
|  | Browser Veth Peer (veth_browser)    |                    |                 |
|  | IP: 10.200.1.2/30                   |                    |                 |
|  | Default Gateway: 10.200.1.1         |                    |                 |
|  +------------------^------------------+                    |                 |
|                     |                                       |                 |
|  +------------------+------------------+                    |                 |
|  | Chromium Process (Headless)         |                    |                 |
|  | Proxy: http://10.200.1.1:PROXY_PORT |                    |                 |
|  +-------------------------------------+                    |                 |
+-------------------------------------------------------------|-----------------+
                                                              |
                       nftables in ns_host:                   |
                       1. Allow TCP from 10.200.1.2 to 10.200.1.1:PROXY_PORT
                       2. DROP all other TCP from 10.200.1.2
                       3. DROP all UDP from 10.200.1.2 (WebRTC / QUIC / DNS)
                       4. ZERO IP forwarding / NAT from ns_browser to eth0!
```
- **Invariant:** `ns_browser` has **zero** default route or NAT forwarding to `eth0`. The browser can physically reach only `10.200.1.1:PROXY_PORT`. All external traffic must be originated by the proxy process in `ns_host`.

---

## 6. Known Limitations & Prerequisites for Production Authorization

Before production implementation of the browser adapter or live retrieval can be authorized, the following items remain outstanding:

1. **OS Firewall Rule Verification Script:** Author an elevated verification script (PowerShell for Windows, bash for Linux) that verifies direct outbound sockets from a test process are rejected at the kernel level.
2. **Production Proxy Packaging:** Move the proxy implementation from test fixtures into a dedicated, isolated service module in `src/discovery/proxy/` once explicitly authorized.
3. **Playwright Runner Installation:** Install `playwright` dependencies under owner authorization and bind Chromium launch arguments to the verified proxy and firewall configuration.
4. **CBIC Document Parser Specification:** Verify whether target CBIC tariff notifications require PDF stream parsing or whether pure static HTML table mirrors are authoritative.

---

## 7. Next Actions

In accordance with owner instructions, all work has stopped. The test suite, connection-level evidence, and architectural clarifications are ready for owner review. Implementation of production code, installation of Playwright, and external requests await separate explicit authorization.
