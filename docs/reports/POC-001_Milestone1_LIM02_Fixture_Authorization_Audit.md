# POC-001: Stage 1 — LIM-02 Test Fixture Authorization & Runtime Reachability Audit

**Scope:** Strict Read-Only Audit of LIM-02 Test Fixture Authorization Mechanism  
**Status:** AUDIT COMPLETE — IMPLEMENTATION DEFECT CONFIRMED  
**Security Governance State:** Stage 1 OPEN; 0/14 Formal Gates Passed; GATE-03 UNVERIFIED  
**Repository Working Directory:** `D:\Market HFT OS`  
**Companion Repository:** `D:\ADRs`  
**Execution Timestamp:** 2026-10-26T23:29:00+05:30  

---

## 1. Executive Summary & Audit Conclusion

A strict read-only audit of the test-fixture authorization mechanism in [`src/infrastructure/browser/governed_http_connector.ts`](file:///d:/Market%20HFT%20OS/src/infrastructure/browser/governed_http_connector.ts) and [`tests/fixtures/testable_governed_connector.ts`](file:///d:/Market%20HFT%20OS/tests/fixtures/testable_governed_connector.ts) was conducted across the four requested criteria:

1. **`registerAuthorizedTestSubclass` is exported from the production module:** It is declared as a top-level named export at line 81 of `src/infrastructure/browser/governed_http_connector.ts`. Any production caller can import it.
2. **Arbitrary subclass registration is possible in production:** In a production runtime where `tests/fixtures/testable_governed_connector.ts` is never imported, `authorizedTestSubclass` starts as `null`. Any production code can call `registerAuthorizedTestSubclass(ArbitraryClass)` to register its own class, thereby satisfying `this === authorizedTestSubclass` and gaining access to arbitrary `testSeam` injection.
3. **`executeFetchInternal` is runtime-accessible:** Because TypeScript `protected` is compile-time only, `GovernedHttpConnector.executeFetchInternal` exists as an ordinary static property in JavaScript and can be reached via `(GovernedHttpConnector as any).executeFetchInternal` or `Function.prototype.call`.
4. **Production module and build retain registration paths:** `tsconfig.json` compiles `./tests` into `./dist/tests`, and the production module `./dist/src/infrastructure/browser/governed_http_connector.js` retains the exported `registerAuthorizedTestSubclass` function.

**Audit Verdict:** LIM-02 must **remain OPEN**. The registration mechanism is a demonstrable architectural loophole in the production module. The correct resolution is to **completely eliminate `registerAuthorizedTestSubclass`, `GovernedConnectorTestSeam`, and the `testSeam` parameter from `governed_http_connector.ts` entirely**. Test mocking must be achieved through clean subclass method overriding encapsulated solely within `tests/fixtures/`.

---

## 2. Four-Point Technical Audit Breakdown

### 2.1 Audit Item 1: Reachability of `registerAuthorizedTestSubclass` from Production Code

In [`src/infrastructure/browser/governed_http_connector.ts`](file:///d:/Market%20HFT%20OS/src/infrastructure/browser/governed_http_connector.ts#L75-L86):
```typescript
let authorizedTestSubclass: any = null;

/**
 * Registers an authorized test fixture subclass.
 * Only an explicitly registered subclass can supply a GovernedConnectorTestSeam to executeFetchInternal.
 */
export function registerAuthorizedTestSubclass(subclass: any): void {
  if (authorizedTestSubclass && authorizedTestSubclass !== subclass) {
    throw new Error('E-MCP-TEST-SEAM-FORBIDDEN: Test fixture subclass is already registered.');
  }
  authorizedTestSubclass = subclass;
}
```

**Finding:**
- `registerAuthorizedTestSubclass` is an exported function of the production module.
- Any file in `src/` (or any dynamic caller in Node.js) can execute:
  ```typescript
  import { registerAuthorizedTestSubclass } from './governed_http_connector.js';
  ```
- While currently no file in `src/` imports this function, its presence in the production module's export table makes it part of the runtime surface.

---

### 2.2 Audit Item 2: Ability of Production Callers to Register an Arbitrary Class

**Finding: Confirmed Vulnerability.**
In a production deployment:
1. `tests/fixtures/testable_governed_connector.ts` is never executed or imported.
2. Therefore, `authorizedTestSubclass` remains uninitialized (`null`).
3. An untrusted or compromised production caller can construct an arbitrary class:
   ```typescript
   import {
     GovernedHttpConnector,
     registerAuthorizedTestSubclass
   } from './governed_http_connector.js';

   class RogueConnector extends GovernedHttpConnector {
     public static exploit(targetUrl: string, customFactory: any) {
       return this.executeFetchInternal(targetUrl, {}, 0, { socketFactory: customFactory });
     }
   }

   // Register the rogue subclass before any test fixture can run
   registerAuthorizedTestSubclass(RogueConnector);

   // Successfully executes with custom socket factory, bypassing all policy checks
   await RogueConnector.exploit('https://169.254.169.254/latest/meta-data', evilSocketFactory);
   ```
4. Execution trace:
   - `registerAuthorizedTestSubclass(RogueConnector)` succeeds because `authorizedTestSubclass` is `null`.
   - `RogueConnector.exploit` calls `this.executeFetchInternal(...)` where `this === RogueConnector`.
   - Inside `executeFetchInternal`:
     ```typescript
     if (testSeam !== undefined) {
       if (!authorizedTestSubclass || this !== authorizedTestSubclass) { ... }
     }
     ```
     `!authorizedTestSubclass` is `false`, and `this !== authorizedTestSubclass` is `false`.
   - The boundary check passes completely, and the rogue caller achieves arbitrary socket injection, DNS resolver replacement, or policy override in production.

---

### 2.3 Audit Item 3: Runtime Reachability of `executeFetchInternal` and Test Seam

**Finding:**
- TypeScript's `protected static` modifier is erased upon compilation to JavaScript.
- In Node.js runtime, `GovernedHttpConnector.executeFetchInternal` is an ordinary enumerable property:
  `typeof GovernedHttpConnector.executeFetchInternal === 'function'`.
- If a caller calls `GovernedHttpConnector.fetch(url, options)`, the intrinsic scanner `assertNoSeamInjection(options)` properly rejects options with injection keys, and `fetch()` invokes `executeFetchInternal(url, options, 0, undefined)` without passing any seam.
- **However**, if a caller directly invokes `(GovernedHttpConnector as any).executeFetchInternal`:
  - If called directly as `GovernedHttpConnector.executeFetchInternal(url, options, 0, seam)`, `this === GovernedHttpConnector`. Since `GovernedHttpConnector !== authorizedTestSubclass`, it throws `E-MCP-TEST-SEAM-FORBIDDEN`.
  - But if called via `Function.prototype.call`:
    `GovernedHttpConnector.executeFetchInternal.call(authorizedTestSubclass, url, options, 0, seam)`
    The `this` check is satisfied, allowing direct execution of the test seam.

---

### 2.4 Audit Item 4: Build Output & Production Module Seam Elimination

**Finding:**
1. **Build Configuration (`tsconfig.json`):**
   ```json
   "include": ["src/**/*", "tests/**/*", "scripts/**/*"]
   ```
   Compiling with `npm run build` (`tsc`) places test fixtures directly into `./dist/tests/fixtures/testable_governed_connector.js`.
2. **Production Module Exports:**
   Even if `./dist/tests` were stripped from the deployment artifact, the production module `./dist/src/infrastructure/browser/governed_http_connector.js` physically contains and exports `registerAuthorizedTestSubclass`.
   As long as `governed_http_connector.js` retains this function, the production module contains an intrinsic mechanism to authorize test-seam bypasses.

---

## 3. Recommended Architectural Fix (Zero-Seam Elimination)

To close LIM-02 permanently without ANY registration functions, mutable module state, or seam parameters in the production module:

### 3.1 Strip `governed_http_connector.ts` of ALL Seams
1. **Delete:**
   - Delete `registerAuthorizedTestSubclass`.
   - Delete `let authorizedTestSubclass`.
   - Delete `GovernedConnectorTestSeam` interface from the module.
   - Delete the `testSeam` parameter from `executeFetchInternal` (and `executeSocketRequest` / `resolveDnsCandidates`).
2. **Pure Production Class:**
   `GovernedHttpConnector` becomes a 100% production-only class with NO test seam parameters anywhere in its implementation:
   ```typescript
   export class GovernedHttpConnector {
     public static assertNoSeamInjection(options: unknown): void { ... }

     public static async fetch(
       targetUrl: string,
       options: GovernedHttpOptions = {}
     ): Promise<GovernedHttpResponse> {
       GovernedHttpConnector.assertNoSeamInjection(options);
       return GovernedHttpConnector.executeFetchWithRedirects(targetUrl, options, 0);
     }
     ...
   ```

### 3.2 Standard OOP Override in `tests/fixtures/testable_governed_connector.ts`
How do unit tests mock DNS and sockets without modifying the production module?
By using standard OOP method overriding in `TestableGovernedHttpConnector`:
1. In `src/infrastructure/browser/governed_http_connector.ts`:
   Expose protected modular methods:
   - `protected static async performDnsResolution(hostname, timeout)`
   - `protected static async performSocketRequest(url, ip, options, ...)`
   Neither method accepts a seam; they execute normal production DNS and HTTPS requests.
2. In `tests/fixtures/testable_governed_connector.ts`:
   `TestableGovernedHttpConnector extends GovernedHttpConnector` declares its own private fields for mocks:
   ```typescript
   export class TestableGovernedHttpConnector extends GovernedHttpConnector {
     private static activeSeam: GovernedConnectorTestSeam | null = null;

     public static async fetchWithSeam(targetUrl, options, seam) {
       this.activeSeam = seam;
       try {
         return await this.executeFetchWithRedirects(targetUrl, options, 0);
       } finally {
         this.activeSeam = null;
       }
     }

     protected static override async performDnsResolution(hostname, timeout) {
       if (this.activeSeam?.dnsResolver) return this.activeSeam.dnsResolver(hostname);
       return super.performDnsResolution(hostname, timeout);
     }

     protected static override async performSocketRequest(...) {
       if (this.activeSeam?.socketFactory) {
         // Run with mock socket factory and capture resources via activeSeam.onResourceAllocated
       }
       return super.performSocketRequest(...);
     }
   }
   ```
**Advantages of this Architecture:**
- `src/infrastructure/browser/governed_http_connector.ts` has **zero seam exports, zero registration functions, zero seam types, and zero seam parameters**.
- No production caller can ever call `registerAuthorizedTestSubclass` because the function does not exist.
- No production caller can pass a seam to `executeFetchInternal` because the method does not accept one.
- In production, `GovernedHttpConnector` only knows how to do real DNS and real HTTPS pinned connections.
- Mocking is 100% encapsulated within `tests/fixtures/testable_governed_connector.ts`.

---

## 4. Governance Status

- **LIM-02:** **OPEN — MATERIAL ISSUE CONFIRMED.** (Pending authorization of the zero-seam elimination fix).
- **LIM-03:** Provisionally accepted.
- **LIM-01:** Conditionally verified; live-handshake verification deferred.
- **Stage 1:** OPEN.
- **Formal Security Gates:** 0/14 Passed.
- **GATE-03:** UNVERIFIED.
- **Implementation Freeze:** **ACTIVE** (Strict Read-Only Mode Maintained; zero edits, zero staging, zero commits).
- **Milestone 2:** NOT AUTHORIZED.
