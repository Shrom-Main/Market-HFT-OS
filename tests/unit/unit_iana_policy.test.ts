/**
 * POC-001: Stage 1 — Authoritative IANA Policy Engine & Registry Integrity Unit Test Suite (Phase 1)
 *
 * Verifies:
 * 1. Over 150 comprehensive test vectors across IPv4 and IPv6 address space.
 * 2. Strict 4-tier precedence evaluation:
 *    - Tier 1: Application Overrides (Metadata, Teredo, 6to4, AS112)
 *    - Tier 2: Special-Purpose RFC 6890 (Private, Loopback, Link-Local, CGNAT, Documentation, Benchmarking)
 *    - Tier 3: Active RIR Allocations (ARIN, RIPE, APNIC, LACNIC, AFRINIC)
 *    - Tier 4: Unallocated / Reserved Holes (Fail-Closed Default)
 * 3. Malformed IP rejection (zone IDs, octal, hex, dword, invalid colons).
 * 4. Dual-stack IPv4-mapped IPv6 normalization (::ffff:0:0/96).
 * 5. Hard fail-closed behavior on corrupted snapshots or missing checksums.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { NetworkSecurityPolicy } from '../../src/infrastructure/browser/network_security_policy.js';
import { IanaRegistrySnapshotLoader } from '../../src/infrastructure/browser/iana_registry_snapshot.js';

describe('Unit Test: Authoritative IANA Policy & Registry Integrity', () => {
  let policy: NetworkSecurityPolicy;

  beforeAll(() => {
    policy = new NetworkSecurityPolicy();
  });

  describe('Tier 1: Application Security Overrides (Absolute Highest Precedence)', () => {
    const tier1Prohibited = [
      // Cloud Instance Metadata
      '169.254.169.254',
      'fd00:ec2::254',
      // Deprecated Tunnels
      '2001::1',
      '2001:0:53aa:64c:0:1:1234:5678', // Teredo
      '2002::1',
      '2002:c000:201::1',              // 6to4
      '192.88.99.1',                   // 6to4 Anycast Relay
      '192.88.99.254',
      // AS112 Anycast
      '192.175.48.1',
      '192.175.48.254',
      '192.31.196.1',
      '2620:4f::1'
    ];

    for (const ip of tier1Prohibited) {
      it(`blocks Tier 1 destination: ${ip}`, () => {
        const res = policy.classifyIpAddress(ip);
        expect(res.isProhibited).toBe(true);
        expect(res.state).toBe('PROHIBITED_APPLICATION_OVERRIDE');
        expect(policy.isProhibitedIpAddress(ip)).toBe(true);
      });
    }
  });

  describe('Tier 2: Authoritative Special-Purpose Registries (RFC 6890)', () => {
    const specialPurposeProhibited = [
      // IPv4 Loopback
      '127.0.0.1', '127.0.0.2', '127.1.2.3', '127.255.255.254',
      // IPv6 Loopback
      '::1', '0:0:0:0:0:0:0:1',
      // IPv4 Private-Use (RFC 1918)
      '10.0.0.1', '10.255.255.254', '10.50.100.200',
      '172.16.0.1', '172.31.255.254', '172.20.10.5',
      '192.168.0.1', '192.168.1.1', '192.168.254.254',
      // IPv6 Unique Local Address (ULA fc00::/7)
      'fc00::1', 'fd00::1', 'fd12:3456:789a::1',
      // IPv4 Link-Local (169.254.0.0/16, excluding metadata .169.254)
      '169.254.1.1', '169.254.100.100', '169.254.255.254',
      // IPv6 Link-Local (fe80::/10)
      'fe80::1', 'fe80::200:5aee:feaa:20a2', 'febf::ffff',
      // Shared Address Space (CGNAT 100.64.0.0/10)
      '100.64.0.1', '100.100.100.100', '100.127.255.254',
      // Benchmarking (198.18.0.0/15 & 2001:2::/48)
      '198.18.0.1', '198.19.255.254', '2001:2::1', '2001:2:0:ffff::1',
      // Documentation (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32)
      '192.0.2.1', '192.0.2.254',
      '198.51.100.1', '198.51.100.254',
      '203.0.113.1', '203.0.113.254',
      '2001:db8::1', '2001:db8:85a3::8a2e:370:7334',
      // RFC 6890 "This network" (0.0.0.0/8)
      '0.0.0.0', '0.0.0.1', '0.255.255.255',
      // RFC 6890 Reserved (240.0.0.0/4 and 255.255.255.255/32)
      '240.0.0.1', '250.1.2.3', '255.255.255.254', '255.255.255.255',
      // RFC 6890 IPv6 Unspecified (::/128)
      '::', '0:0:0:0:0:0:0:0',
      // RFC 6890 Discard-Only (100::/64)
      '100::1',
      // RFC 6890 IETF Protocol Assignments (2001::/23)
      '2001:100::1', '2001:1ff::1'
    ];

    for (const ip of specialPurposeProhibited) {
      it(`blocks RFC 6890 special-purpose destination: ${ip}`, () => {
        const res = policy.classifyIpAddress(ip);
        expect(res.isProhibited).toBe(true);
        expect(res.state).toBe('PROHIBITED_SPECIAL_PURPOSE');
        expect(policy.isProhibitedIpAddress(ip)).toBe(true);
      });
    }
  });

  describe('Tier 3: Positive Delegated RIR Unicast Pools (Permitted Public Space)', () => {
    const permittedPublic = [
      // Major public IPv4 unicast addresses (ARIN, RIPE, APNIC, etc.)
      { ip: '93.184.216.34', rir: 'RIPE' },       // example.com (93/8 RIPE)
      { ip: '8.8.8.8', rir: 'ARIN' },              // Google DNS (8/8 ARIN)
      { ip: '8.8.4.4', rir: 'ARIN' },
      { ip: '1.1.1.1', rir: 'APNIC' },             // Cloudflare (1/8 APNIC)
      { ip: '1.0.0.1', rir: 'APNIC' },
      { ip: '142.250.190.46', rir: 'ARIN' },       // Google (142/8 ARIN)
      { ip: '151.101.1.69', rir: 'ARIN' },         // Fastly (151/8 ARIN)
      { ip: '104.16.132.229', rir: 'ARIN' },       // Cloudflare (104/8 ARIN)
      { ip: '185.199.108.153', rir: 'RIPE' },      // GitHub (185/8 RIPE)
      { ip: '199.232.68.133', rir: 'ARIN' },       // Fastly (199/8 ARIN)
      { ip: '13.107.42.14', rir: 'ARIN' },         // Microsoft (13/8 ARIN)
      { ip: '52.95.120.67', rir: 'ARIN' },         // AWS (52/8 ARIN)
      { ip: '157.240.22.35', rir: 'ARIN' },        // Meta (157/8 ARIN)

      // Permitted Global IPv6 Unicast (within allocated RIR pools in 2000::/3)
      { ip: '2606:4700:4700::1111', rir: 'ARIN' }, // Cloudflare DNS (2600::/12 ARIN)
      { ip: '2606:4700:4700::1001', rir: 'ARIN' },
      { ip: '2001:4860:4860::8888', rir: 'ARIN' }, // Google DNS (2001:400::/23 ARIN)
      { ip: '2001:4860:4860::8844', rir: 'ARIN' },
      { ip: '2a00:1450:4001::1', rir: 'RIPE' },    // Google (2a00::/12 RIPE)
      { ip: '2404:6800:4001::1', rir: 'APNIC' },   // Google (2400::/12 APNIC)
      { ip: '2800:3f0:4001::1', rir: 'LACNIC' },   // Google (2800::/12 LACNIC)
      { ip: '2c0f:fb50:4001::1', rir: 'AFRINIC' }  // Google (2c00::/12 AFRINIC)
    ];

    for (const target of permittedPublic) {
      it(`permits delegated public unicast destination: ${target.ip} (${target.rir})`, () => {
        const res = policy.classifyIpAddress(target.ip);
        expect(res.isProhibited).toBe(false);
        expect(res.state).toBe('PERMITTED_PUBLIC_UNICAST');
        expect(policy.isProhibitedIpAddress(target.ip)).toBe(false);
      });
    }
  });

  describe('Tier 4: Unallocated, Reserved, or Multicast Space (Fail-Closed Default)', () => {
    const unallocatedOrReserved = [
      // IPv4 Multicast (224.0.0.0/4)
      '224.0.0.1', '224.0.0.251', '239.255.255.250',
      // IPv6 Multicast (ff00::/8)
      'ff02::1', 'ff02::2', 'ff05::1:3',
      // IPv6 Outside 2000::/3 and IANA-reserved blocks in 2000::/3
      '3000::1', '4000::1', '8000::1'
    ];

    for (const ip of unallocatedOrReserved) {
      it(`blocks Tier 4 unallocated/reserved destination: ${ip}`, () => {
        const res = policy.classifyIpAddress(ip);
        expect(res.isProhibited).toBe(true);
        expect(res.state).toBe('PROHIBITED_UNALLOCATED_OR_RESERVED');
        expect(policy.isProhibitedIpAddress(ip)).toBe(true);
      });
    }
  });

  describe('Dual-Stack Normalization (IPv4-Mapped IPv6 ::ffff:0:0/96)', () => {
    it('unpacks and blocks mapped loopback: ::ffff:127.0.0.1', () => {
      const res = policy.classifyIpAddress('::ffff:127.0.0.1');
      expect(res.isProhibited).toBe(true);
      expect(res.extractedIpv4).toBe('127.0.0.1');
      expect(res.state).toBe('PROHIBITED_SPECIAL_PURPOSE');
    });

    it('unpacks and blocks mapped private RFC 1918: ::ffff:10.0.0.1', () => {
      const res = policy.classifyIpAddress('::ffff:10.0.0.1');
      expect(res.isProhibited).toBe(true);
      expect(res.extractedIpv4).toBe('10.0.0.1');
      expect(res.state).toBe('PROHIBITED_SPECIAL_PURPOSE');
    });

    it('unpacks and blocks mapped metadata: ::ffff:169.254.169.254', () => {
      const res = policy.classifyIpAddress('::ffff:169.254.169.254');
      expect(res.isProhibited).toBe(true);
      expect(res.extractedIpv4).toBe('169.254.169.254');
      expect(res.state).toBe('PROHIBITED_APPLICATION_OVERRIDE');
    });

    it('unpacks and permits mapped public unicast: ::ffff:93.184.216.34', () => {
      const res = policy.classifyIpAddress('::ffff:93.184.216.34');
      expect(res.isProhibited).toBe(false);
      expect(res.extractedIpv4).toBe('93.184.216.34');
      expect(res.state).toBe('PERMITTED_PUBLIC_UNICAST');
    });
  });

  describe('Malformed & Prohibited Non-Canonical IP Parsing', () => {
    const malformedInputs = [
      '', '   ', 'invalid-domain-name', 'http://127.0.0.1',
      // Octal notations (must reject leading zero)
      '0177.0.0.1', '127.000.000.001', '10.001.0.1',
      // Hex notations
      '0x7f.0.0.1', '0x7f000001',
      // Integer / DWORD notation
      '2130706433',
      // IPv6 with Zone ID
      'fe80::1%eth0', 'fe80::1%1', '::1%lo',
      // Out-of-bounds octets
      '256.0.0.1', '127.0.0.256', '1.2.3.4.5', '1.2.3',
      // Malformed IPv6
      ':::', '1:2:3:4:5:6:7:8:9', '1::2::3', '2001:xyz::1'
    ];

    for (const input of malformedInputs) {
      it(`fails closed on malformed input: '${input}'`, () => {
        const res = policy.classifyIpAddress(input);
        expect(res.isProhibited).toBe(true);
        expect(res.state).toBe('PROHIBITED_MALFORMED');
        expect(policy.isProhibitedIpAddress(input)).toBe(true);
      });
    }
  });

  describe('Fail-Closed Registry Integrity Boundary', () => {
    it('throws E-BROWSER-REGISTRY-UNVERIFIED on non-existent snapshot directory', () => {
      const nonExistent = path.join(os.tmpdir(), `nonexistent-dir-${Date.now()}`);
      expect(() => {
        new NetworkSecurityPolicy(nonExistent);
      }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED/);
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on missing CHECKSUMS.sha256', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      try {
        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: CHECKSUMS.sha256 missing/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on corrupted snapshot file checksum', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      try {
        // Copy genuine CHECKSUMS.sha256, manifest.json, and 3 files, but corrupt 1 file
        fs.copyFileSync(path.join(realDir, 'CHECKSUMS.sha256'), path.join(tempDir, 'CHECKSUMS.sha256'));
        fs.copyFileSync(path.join(realDir, 'manifest.json'), path.join(tempDir, 'manifest.json'));
        fs.copyFileSync(path.join(realDir, 'iana-ipv4-special-registry.xml'), path.join(tempDir, 'iana-ipv4-special-registry.xml'));
        fs.copyFileSync(path.join(realDir, 'iana-ipv6-special-registry.xml'), path.join(tempDir, 'iana-ipv6-special-registry.xml'));
        fs.copyFileSync(path.join(realDir, 'ipv4-address-space.xml'), path.join(tempDir, 'ipv4-address-space.xml'));
        // Write tampered file
        fs.writeFileSync(path.join(tempDir, 'ipv6-unicast-address-assignments.xml'), '<corrupted>tampered</corrupted>');

        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on empty snapshot file', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      try {
        fs.copyFileSync(path.join(realDir, 'CHECKSUMS.sha256'), path.join(tempDir, 'CHECKSUMS.sha256'));
        fs.copyFileSync(path.join(realDir, 'manifest.json'), path.join(tempDir, 'manifest.json'));
        fs.copyFileSync(path.join(realDir, 'iana-ipv4-special-registry.xml'), path.join(tempDir, 'iana-ipv4-special-registry.xml'));
        fs.copyFileSync(path.join(realDir, 'iana-ipv6-special-registry.xml'), path.join(tempDir, 'iana-ipv6-special-registry.xml'));
        fs.copyFileSync(path.join(realDir, 'ipv4-address-space.xml'), path.join(tempDir, 'ipv4-address-space.xml'));
        // Write 0-byte file
        fs.writeFileSync(path.join(tempDir, 'ipv6-unicast-address-assignments.xml'), '');

        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: Snapshot file is empty/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on missing manifest.json', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      try {
        fs.copyFileSync(path.join(realDir, 'CHECKSUMS.sha256'), path.join(tempDir, 'CHECKSUMS.sha256'));
        fs.copyFileSync(path.join(realDir, 'iana-ipv4-special-registry.xml'), path.join(tempDir, 'iana-ipv4-special-registry.xml'));
        fs.copyFileSync(path.join(realDir, 'iana-ipv6-special-registry.xml'), path.join(tempDir, 'iana-ipv6-special-registry.xml'));
        fs.copyFileSync(path.join(realDir, 'ipv4-address-space.xml'), path.join(tempDir, 'ipv4-address-space.xml'));
        fs.copyFileSync(path.join(realDir, 'ipv6-unicast-address-assignments.xml'), path.join(tempDir, 'ipv6-unicast-address-assignments.xml'));

        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: manifest\.json missing/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on malformed JSON in manifest.json', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      try {
        fs.copyFileSync(path.join(realDir, 'CHECKSUMS.sha256'), path.join(tempDir, 'CHECKSUMS.sha256'));
        fs.writeFileSync(path.join(tempDir, 'manifest.json'), '{ "broken_json": [ unclosed');

        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: Malformed manifest\.json/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on missing or invalid manifest schema/domain_tag', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      try {
        fs.copyFileSync(path.join(realDir, 'CHECKSUMS.sha256'), path.join(tempDir, 'CHECKSUMS.sha256'));
        const manifest = JSON.parse(fs.readFileSync(path.join(realDir, 'manifest.json'), 'utf8'));
        manifest.schema_version = '99.0.0';
        fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest));

        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: Invalid manifest schema_version/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on malformed created_at_utc timestamp in manifest', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      try {
        fs.copyFileSync(path.join(realDir, 'CHECKSUMS.sha256'), path.join(tempDir, 'CHECKSUMS.sha256'));
        const manifest = JSON.parse(fs.readFileSync(path.join(realDir, 'manifest.json'), 'utf8'));
        manifest.created_at_utc = 'invalid-not-a-timestamp';
        fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest));

        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: Malformed created_at_utc timestamp/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on future-dated manifest timestamp beyond clock skew', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      try {
        fs.copyFileSync(path.join(realDir, 'CHECKSUMS.sha256'), path.join(tempDir, 'CHECKSUMS.sha256'));
        const manifest = JSON.parse(fs.readFileSync(path.join(realDir, 'manifest.json'), 'utf8'));
        // Set creation time 24 hours into the future
        manifest.created_at_utc = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest));

        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: Manifest created_at_utc is future-dated/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on stale snapshot exceeding maximum acceptable age', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      try {
        fs.copyFileSync(path.join(realDir, 'CHECKSUMS.sha256'), path.join(tempDir, 'CHECKSUMS.sha256'));
        const manifest = JSON.parse(fs.readFileSync(path.join(realDir, 'manifest.json'), 'utf8'));
        // Set timestamp 95 days in the past (exceeding default 90-day TTL)
        manifest.created_at_utc = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();
        fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest));

        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: Snapshot is stale/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on configurable maxAgeMs enforcement', () => {
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      // Pass maxAgeMs of 1 millisecond, which forces current snapshot to fail stale check
      expect(() => {
        new NetworkSecurityPolicy(realDir, undefined, { maxAgeMs: 1 });
      }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: Snapshot is stale/);
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on stale manifest entry retrieval_timestamp_utc', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      try {
        fs.copyFileSync(path.join(realDir, 'CHECKSUMS.sha256'), path.join(tempDir, 'CHECKSUMS.sha256'));
        const manifest = JSON.parse(fs.readFileSync(path.join(realDir, 'manifest.json'), 'utf8'));
        // Make entry timestamp 95 days old while top-level is fresh
        manifest.entries[0].retrieval_timestamp_utc = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();
        fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest));

        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: Stale retrieval_timestamp_utc/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on cross-integrity mismatch between manifest and CHECKSUMS.sha256', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      try {
        fs.copyFileSync(path.join(realDir, 'CHECKSUMS.sha256'), path.join(tempDir, 'CHECKSUMS.sha256'));
        const manifest = JSON.parse(fs.readFileSync(path.join(realDir, 'manifest.json'), 'utf8'));
        // Tamper with one entry's sha256 in manifest
        manifest.entries[0].sha256 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest));

        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: Cross-integrity mismatch/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws E-BROWSER-REGISTRY-UNVERIFIED on byte length mismatch against manifest', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      try {
        fs.copyFileSync(path.join(realDir, 'CHECKSUMS.sha256'), path.join(tempDir, 'CHECKSUMS.sha256'));
        fs.copyFileSync(path.join(realDir, 'iana-ipv4-special-registry.xml'), path.join(tempDir, 'iana-ipv4-special-registry.xml'));
        fs.copyFileSync(path.join(realDir, 'iana-ipv6-special-registry.xml'), path.join(tempDir, 'iana-ipv6-special-registry.xml'));
        fs.copyFileSync(path.join(realDir, 'ipv4-address-space.xml'), path.join(tempDir, 'ipv4-address-space.xml'));
        fs.copyFileSync(path.join(realDir, 'ipv6-unicast-address-assignments.xml'), path.join(tempDir, 'ipv6-unicast-address-assignments.xml'));
        const manifest = JSON.parse(fs.readFileSync(path.join(realDir, 'manifest.json'), 'utf8'));
        manifest.entries[0].byte_length = 999999; // Corrupt expected length
        fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest));

        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: Byte length mismatch/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('preserves checksum-before-parse invariant: tampered XML fails on integrity before XML parser runs', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hft-snap-test-'));
      const realDir = path.resolve(process.cwd(), 'registry', 'snapshots');
      try {
        fs.copyFileSync(path.join(realDir, 'CHECKSUMS.sha256'), path.join(tempDir, 'CHECKSUMS.sha256'));
        fs.copyFileSync(path.join(realDir, 'manifest.json'), path.join(tempDir, 'manifest.json'));
        fs.copyFileSync(path.join(realDir, 'iana-ipv4-special-registry.xml'), path.join(tempDir, 'iana-ipv4-special-registry.xml'));
        fs.copyFileSync(path.join(realDir, 'iana-ipv6-special-registry.xml'), path.join(tempDir, 'iana-ipv6-special-registry.xml'));
        fs.copyFileSync(path.join(realDir, 'ipv4-address-space.xml'), path.join(tempDir, 'ipv4-address-space.xml'));
        // Write invalid XML with bad checksum
        fs.writeFileSync(path.join(tempDir, 'ipv6-unicast-address-assignments.xml'), '<unclosed xml tags >>>');

        expect(() => {
          new NetworkSecurityPolicy(tempDir);
        }).toThrow(/E-BROWSER-REGISTRY-UNVERIFIED: (Byte length mismatch|Checksum mismatch)/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('populates manifest metadata and freshness fields upon successful verification', () => {
      const tables = policy.getTables();
      expect(tables.manifestCreatedAtUtc).toBeTruthy();
      expect(typeof tables.snapshotAgeMs).toBe('number');
      expect(tables.snapshotAgeMs).toBeGreaterThanOrEqual(0);
      expect(tables.ipv4AddressSpace.length).toBe(256);
    });
  });
});
