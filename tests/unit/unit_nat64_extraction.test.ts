/**
 * POC-001: Stage 1 — Full-Path RFC 6052 NAT64 Extraction & Policy Unit Test Suite (Phase 1)
 *
 * Verifies:
 * 1. Round-trip structural extraction across all six RFC 6052 prefix lengths:
 *    /32, /40, /48, /56, /64, and /96.
 * 2. Strict RFC 6052 Table 1 format compliance:
 *    - Byte 8 'u' octet (bits 64-71) MUST be 0x00 for all prefix lengths < 96.
 *    - All trailing suffix bits MUST be zero.
 * 3. End-to-end destination policy evaluation of extracted IPv4 addresses:
 *    - Extracted public IP (93.184.216.34) -> PERMITTED
 *    - Extracted loopback IP (127.0.0.1) -> PROHIBITED (RFC 6890 Loopback)
 *    - Extracted private IP (10.0.0.1) -> PROHIBITED (RFC 1918 Private)
 *    - Extracted cloud metadata (169.254.169.254) -> PROHIBITED (Tier 1 Metadata)
 * 4. Failure behavior on non-zero 'u' octet, non-zero suffix, and unconfigured prefixes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { NetworkSecurityPolicy, Nat64ConfiguredPrefix } from '../../src/infrastructure/browser/network_security_policy.js';

describe('Unit Test: RFC 6052 NAT64 Extraction & End-to-End Policy', () => {
  let defaultPolicy: NetworkSecurityPolicy;
  let customPolicy: NetworkSecurityPolicy;

  // Custom configured prefixes for testing all 6 prefix lengths
  const testPrefixes: Nat64ConfiguredPrefix[] = [
    NetworkSecurityPolicy.parseConfiguredNat64Prefix('64:ff9b::/96'),     // Well-Known Prefix
    NetworkSecurityPolicy.parseConfiguredNat64Prefix('2001:db8:100::/32'),
    NetworkSecurityPolicy.parseConfiguredNat64Prefix('2001:db8:200::/40'),
    NetworkSecurityPolicy.parseConfiguredNat64Prefix('2001:db8:300::/48'),
    NetworkSecurityPolicy.parseConfiguredNat64Prefix('2001:db8:400::/56'),
    NetworkSecurityPolicy.parseConfiguredNat64Prefix('2001:db8:500::/64')
  ];

  beforeAll(() => {
    defaultPolicy = new NetworkSecurityPolicy();
    customPolicy = new NetworkSecurityPolicy(undefined, testPrefixes);
  });

  function buildNat64Address(
    prefixBytes: Uint8Array,
    pl: 32 | 40 | 48 | 56 | 64 | 96,
    ipv4Bytes: [number, number, number, number],
    uOctet: number = 0,
    corruptSuffixByteIndex?: number
  ): string {
    const bytes = new Uint8Array(16);
    const fullBytes = Math.floor(pl / 8);
    for (let i = 0; i < fullBytes; i++) bytes[i] = prefixBytes[i];

    if (pl !== 96) bytes[8] = uOctet;

    switch (pl) {
      case 32:
        bytes[4] = ipv4Bytes[0];
        bytes[5] = ipv4Bytes[1];
        bytes[6] = ipv4Bytes[2];
        bytes[7] = ipv4Bytes[3];
        break;
      case 40:
        bytes[5] = ipv4Bytes[0];
        bytes[6] = ipv4Bytes[1];
        bytes[7] = ipv4Bytes[2];
        bytes[9] = ipv4Bytes[3];
        break;
      case 48:
        bytes[6] = ipv4Bytes[0];
        bytes[7] = ipv4Bytes[1];
        bytes[9] = ipv4Bytes[2];
        bytes[10] = ipv4Bytes[3];
        break;
      case 56:
        bytes[7] = ipv4Bytes[0];
        bytes[9] = ipv4Bytes[1];
        bytes[10] = ipv4Bytes[2];
        bytes[11] = ipv4Bytes[3];
        break;
      case 64:
        bytes[9] = ipv4Bytes[0];
        bytes[10] = ipv4Bytes[1];
        bytes[11] = ipv4Bytes[2];
        bytes[12] = ipv4Bytes[3];
        break;
      case 96:
        bytes[12] = ipv4Bytes[0];
        bytes[13] = ipv4Bytes[1];
        bytes[14] = ipv4Bytes[2];
        bytes[15] = ipv4Bytes[3];
        break;
    }

    if (corruptSuffixByteIndex !== undefined && corruptSuffixByteIndex < 16) {
      bytes[corruptSuffixByteIndex] = 0x01;
    }

    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
    }
    return groups.join(':');
  }

  describe('Well-Known Prefix /96 (64:ff9b::/96)', () => {
    it('NAT-96-01: extracts public IPv4 (93.184.216.34) and permits destination', () => {
      const res = defaultPolicy.classifyIpAddress('64:ff9b::93.184.216.34');
      expect(res.isProhibited).toBe(false);
      expect(res.state).toBe('PERMITTED_PUBLIC_UNICAST');
      expect(res.extractedIpv4).toBe('93.184.216.34');
    });

    it('NAT-96-02: extracts loopback IPv4 (127.0.0.1) and blocks destination', () => {
      const res = defaultPolicy.classifyIpAddress('64:ff9b::127.0.0.1');
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_SPECIAL_PURPOSE');
      expect(res.extractedIpv4).toBe('127.0.0.1');
    });

    it('NAT-96-03: extracts metadata IPv4 (169.254.169.254) and blocks destination', () => {
      const res = defaultPolicy.classifyIpAddress('64:ff9b::169.254.169.254');
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_APPLICATION_OVERRIDE');
      expect(res.extractedIpv4).toBe('169.254.169.254');
    });

    it('NAT-96-04: extracts private RFC 1918 (10.0.0.1) and blocks destination', () => {
      const res = defaultPolicy.classifyIpAddress('64:ff9b::10.0.0.1');
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_SPECIAL_PURPOSE');
      expect(res.extractedIpv4).toBe('10.0.0.1');
    });
  });

  describe('Prefix Length /32 (2001:db8:100::/32)', () => {
    const p32 = testPrefixes.find(p => p.prefixLength === 32)!;

    it('NAT-32-01: extracts public IPv4 and permits destination', () => {
      const ip = buildNat64Address(p32.prefixBytes, 32, [93, 184, 216, 34], 0);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(false);
      expect(res.state).toBe('PERMITTED_PUBLIC_UNICAST');
      expect(res.extractedIpv4).toBe('93.184.216.34');
    });

    it('NAT-32-02: fails closed on corrupted non-zero u-octet (0x01)', () => {
      const ip = buildNat64Address(p32.prefixBytes, 32, [93, 184, 216, 34], 1);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_MALFORMED');
      expect(res.ruleDescription).toContain("non-zero 'u' octet");
    });

    it('NAT-32-03: fails closed on non-zero suffix byte', () => {
      const ip = buildNat64Address(p32.prefixBytes, 32, [93, 184, 216, 34], 0, 11);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_MALFORMED');
      expect(res.ruleDescription).toContain('non-zero suffix');
    });
  });

  describe('Prefix Length /40 (2001:db8:200::/40)', () => {
    const p40 = testPrefixes.find(p => p.prefixLength === 40)!;

    it('NAT-40-01: extracts public IPv4 and permits destination', () => {
      const ip = buildNat64Address(p40.prefixBytes, 40, [93, 184, 216, 34], 0);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(false);
      expect(res.state).toBe('PERMITTED_PUBLIC_UNICAST');
      expect(res.extractedIpv4).toBe('93.184.216.34');
    });

    it('NAT-40-02: fails closed on corrupted non-zero u-octet (0x02)', () => {
      const ip = buildNat64Address(p40.prefixBytes, 40, [93, 184, 216, 34], 2);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_MALFORMED');
      expect(res.ruleDescription).toContain("non-zero 'u' octet");
    });

    it('NAT-40-03: fails closed on non-zero suffix byte', () => {
      const ip = buildNat64Address(p40.prefixBytes, 40, [93, 184, 216, 34], 0, 13);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_MALFORMED');
      expect(res.ruleDescription).toContain('non-zero suffix');
    });
  });

  describe('Prefix Length /48 (2001:db8:300::/48)', () => {
    const p48 = testPrefixes.find(p => p.prefixLength === 48)!;

    it('NAT-48-01: extracts public IPv4 and permits destination', () => {
      const ip = buildNat64Address(p48.prefixBytes, 48, [93, 184, 216, 34], 0);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(false);
      expect(res.state).toBe('PERMITTED_PUBLIC_UNICAST');
      expect(res.extractedIpv4).toBe('93.184.216.34');
    });

    it('NAT-48-02: extracts embedded private IPv4 (10.0.0.1) and blocks destination', () => {
      const ip = buildNat64Address(p48.prefixBytes, 48, [10, 0, 0, 1], 0);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_SPECIAL_PURPOSE');
      expect(res.extractedIpv4).toBe('10.0.0.1');
    });

    it('NAT-48-03: fails closed on corrupted non-zero u-octet', () => {
      const ip = buildNat64Address(p48.prefixBytes, 48, [93, 184, 216, 34], 0xff);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_MALFORMED');
    });

    it('NAT-48-04: fails closed on non-zero suffix byte', () => {
      const ip = buildNat64Address(p48.prefixBytes, 48, [93, 184, 216, 34], 0, 14);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_MALFORMED');
    });
  });

  describe('Prefix Length /56 (2001:db8:400::/56)', () => {
    const p56 = testPrefixes.find(p => p.prefixLength === 56)!;

    it('NAT-56-01: extracts public IPv4 and permits destination', () => {
      const ip = buildNat64Address(p56.prefixBytes, 56, [93, 184, 216, 34], 0);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(false);
      expect(res.state).toBe('PERMITTED_PUBLIC_UNICAST');
      expect(res.extractedIpv4).toBe('93.184.216.34');
    });

    it('NAT-56-02: fails closed on corrupted non-zero u-octet', () => {
      const ip = buildNat64Address(p56.prefixBytes, 56, [93, 184, 216, 34], 0xaa);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_MALFORMED');
    });

    it('NAT-56-03: fails closed on non-zero suffix byte', () => {
      const ip = buildNat64Address(p56.prefixBytes, 56, [93, 184, 216, 34], 0, 15);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_MALFORMED');
    });
  });

  describe('Prefix Length /64 (2001:db8:500::/64)', () => {
    const p64 = testPrefixes.find(p => p.prefixLength === 64)!;

    it('NAT-64-01: extracts public IPv4 and permits destination', () => {
      const ip = buildNat64Address(p64.prefixBytes, 64, [93, 184, 216, 34], 0);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(false);
      expect(res.state).toBe('PERMITTED_PUBLIC_UNICAST');
      expect(res.extractedIpv4).toBe('93.184.216.34');
    });

    it('NAT-64-02: fails closed on corrupted non-zero u-octet', () => {
      const ip = buildNat64Address(p64.prefixBytes, 64, [93, 184, 216, 34], 0x55);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_MALFORMED');
    });

    it('NAT-64-03: fails closed on non-zero suffix byte', () => {
      const ip = buildNat64Address(p64.prefixBytes, 64, [93, 184, 216, 34], 0, 15);
      const res = customPolicy.classifyIpAddress(ip);
      expect(res.isProhibited).toBe(true);
      expect(res.state).toBe('PROHIBITED_MALFORMED');
    });
  });

  describe('Unconfigured NAT64 Prefixes', () => {
    it('NAT-UNCONF-01: does not extract on unconfigured prefix (evaluated as native IPv6)', () => {
      // 2001:2::1 (RFC 6890 Benchmarking) is not in testPrefixes; it should not extract IPv4 and fails closed in Tier 2
      const res = customPolicy.classifyIpAddress('2001:2::1');
      expect(res.isProhibited).toBe(true);
      expect(res.extractedIpv4).toBeNull();
      expect(res.state).toBe('PROHIBITED_SPECIAL_PURPOSE'); // Blocked by RFC 6890 Benchmarking
    });
  });
});
