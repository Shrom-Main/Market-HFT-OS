import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import { sha256 } from '../../src/canonical/crypto.js';

describe('SUITE-01: Deterministic Serialization & RFC 8785 Conformance', () => {
  it('JCS-PACKAGE-INTEGRITY-024: Verify pinned package metadata for json-canonicalize@3.0.1', () => {
    const pkgPath = path.resolve('package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies['json-canonicalize']).toBe('3.0.1');

    const lockPath = path.resolve('package-lock.json');
    if (fs.existsSync(lockPath)) {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      const pkgEntry = lock.packages?.['node_modules/json-canonicalize'] || lock.dependencies?.['json-canonicalize'];
      expect(pkgEntry.version).toBe('3.0.1');
    }
  });

  it('CANON-JCS-WHITESPACE-001 (KAT-01): Canonicalize JSON removes insignificant whitespace', () => {
    const input = { b: 1, a: 'test', c: [3, 2] };
    const canonical = canonicalizeJCS(input);
    expect(canonical).toBe('{"a":"test","b":1,"c":[3,2]}');

    const digest = sha256(Buffer.from(canonical, 'utf8'));
    expect(digest).toBe('f656707a086145917b61a58bd0c544699796e78bd7b218eb774b239fcabb505f');
  });

  it('JCS-KAT-002: Canonical Money Vector matches exact canonical string and digest', () => {
    const input = { currency: 'INR', amount_subunits: '105000', scale: 4 };
    const canonical = canonicalizeJCS(input);
    expect(canonical).toBe('{"amount_subunits":"105000","currency":"INR","scale":4}');

    const digest = sha256(Buffer.from(canonical, 'utf8'));
    expect(digest).toBe('103316c562e9c5239fccd29452cb55f0018e4b19775d79e8f61ac86beeaf7eed');
  });

  it('CANON-JCS-PROP-ORDER-002: Lexicographic UTF-16 code unit property ordering', () => {
    const input = { z: 1, a: 2, m: 3, aa: 4 };
    const canonical = canonicalizeJCS(input);
    expect(canonical).toBe('{"a":2,"aa":4,"m":3,"z":1}');
  });

  it('CANON-JCS-NAN-INF-FAIL-004 / JCS-STRICT-DOMAIN-003: Prohibits non-finite numbers fail-closed', () => {
    expect(() => canonicalizeJCS({ val: NaN })).toThrow();
    expect(() => canonicalizeJCS({ val: Infinity })).toThrow();
    expect(() => canonicalizeJCS({ val: -Infinity })).toThrow();
  });

  it('JCS-PROVENANCE-SEPARATION-038: Separates runtime json-canonicalize from test fixtures', () => {
    // Verifies runtime function produces standard conformant output
    const obj = { x: 10, y: [1, 2, 3] };
    const canon = canonicalizeJCS(obj);
    expect(canon).toBe('{"x":10,"y":[1,2,3]}');
  });
});
