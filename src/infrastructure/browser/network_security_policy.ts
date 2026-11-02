/**
 * POC-001: Stage 1 — Authoritative Network Security Policy Engine (Phase 1)
 *
 * Implements deterministic 4-tier destination IP evaluation and RFC 6052 NAT64 structural extraction.
 *
 * Security Invariants & Policy Boundaries:
 * 1. Strict Fail-Closed Defaults:
 *    Allocation != Delegation != BGP Announcement != Reachability != Permission.
 *    Any unallocated, reserved, special-purpose (non-global), link-local, private,
 *    or malformed destination address fails closed immediately.
 * 2. Four-Tier Precedence Hierarchy & Semantic Boundaries:
 *    - Tier 1: Application Security Overrides (Absolute Highest Precedence: Metadata, Teredo, 6to4, AS112).
 *    - Tier 2: Authoritative Special-Purpose Registries (RFC 6890 longest-prefix match, globallyRoutable=false).
 *    - Tier 3: Positive Delegated RIR Unicast Pools:
 *      * IPv4 Scope & Limitation: Evaluates destination against IANA's 256 /8 top-level address space allocations
 *        (ipv4-address-space.xml). An 'ALLOCATED' or 'LEGACY' assignment to an RIR (ARIN, RIPE, APNIC, LACNIC, AFRINIC)
 *        establishes that the /8 block has been assigned by IANA to an RIR, but DOES NOT establish fine-grained
 *        daily RIR delegation, active BGP route announcement, network reachability, host liveness, or destination safety.
 *      * IPv6 Scope: Evaluates destination within 2000::/3 against IANA unicast allocations with status ALLOCATED
 *        and non-IANA description.
 *    - Tier 4: Unallocated / Reserved / Retained Space (Fail-Closed Default):
 *      Any destination not positively classified in Tier 3 (or falling into reserved/unallocated blocks) fails closed.
 * 3. Full RFC 6052 Structural Validation:
 *    Validates prefix match against immutable configured prefixes across all 6 lengths (/32, /40, /48, /56, /64, /96).
 *    Enforces byte 8 'u' octet === 0x00 and all trailing suffix bits === 0.
 * 4. Dual-Stack Unwrapping:
 *    Unpacks dual-stack IPv4-mapped IPv6 (::ffff:0:0/96) to underlying IPv4.
 * 5. Registry Fail-Closed Defense & Freshness Policy:
 *    If snapshot tables or manifest are missing, corrupt, stale (> maxAgeMs), future-dated, or unverified,
 *    initialization throws `E-BROWSER-REGISTRY-UNVERIFIED` and freezes execution.
 */

import {
  IanaRegistrySnapshotLoader,
  VerifiedRegistryTables,
  SnapshotVerificationOptions,
  SpecialPurposeRecord,
  Ipv4SpaceRecord,
  Ipv6UnicastRecord
} from './iana_registry_snapshot.js';

export type DestinationClassificationState =
  | 'PERMITTED_PUBLIC_UNICAST'
  | 'PROHIBITED_APPLICATION_OVERRIDE'
  | 'PROHIBITED_SPECIAL_PURPOSE'
  | 'PROHIBITED_UNALLOCATED_OR_RESERVED'
  | 'PROHIBITED_MALFORMED';

export interface IpClassificationResult {
  readonly state: DestinationClassificationState;
  readonly isProhibited: boolean;
  readonly inputIp: string;
  readonly canonicalIp: string | null;
  readonly addressFamily: 'IPv4' | 'IPv6' | null;
  readonly matchedPrefix: string | null;
  readonly ruleDescription: string;
  readonly extractedIpv4: string | null;
}

export interface Nat64ConfiguredPrefix {
  readonly prefixString: string;
  readonly prefixBytes: Uint8Array;
  readonly prefixLength: 32 | 40 | 48 | 56 | 64 | 96;
}

export interface Nat64ExtractionResult {
  readonly isValidNat64: boolean;
  readonly extractedIpv4: string | null;
  readonly failureReason: string | null;
}

export class NetworkSecurityPolicy {
  private static defaultTables: VerifiedRegistryTables | null = null;

  // Tier 1 Hardcoded Application Security Overrides (Absolute Highest Precedence)
  private static readonly TIER1_IPV4_OVERRIDES: readonly { prefix: string; mask: number; desc: string }[] = [
    { prefix: '169.254.169.254/32', mask: 32, desc: 'Cloud Instance Metadata Service (AWS/Azure/GCP)' },
    { prefix: '192.88.99.0/24', mask: 24, desc: '6to4 Anycast Relay (RFC 7526 Deprecated)' },
    { prefix: '192.175.48.0/24', mask: 24, desc: 'Direct Delegation AS112 Service (RFC 7534)' },
    { prefix: '192.31.196.0/24', mask: 24, desc: 'AS112-OARC Service (RFC 7535)' }
  ];

  private static readonly TIER1_IPV6_OVERRIDES: readonly { prefix: string; mask: number; desc: string }[] = [
    { prefix: 'fd00:ec2::254/128', mask: 128, desc: 'AWS IPv6 Instance Metadata Service' },
    { prefix: '2001::/32', mask: 32, desc: 'Teredo IPv6 Tunneling (RFC 4380 Deprecated)' },
    { prefix: '2002::/16', mask: 16, desc: '6to4 IPv6 Transition (RFC 3056 Deprecated)' },
    { prefix: '2620:4f::/48', mask: 48, desc: 'AS112 IPv6 Anycast Service (RFC 7534)' }
  ];

  private readonly tables: VerifiedRegistryTables;
  private readonly configuredNat64Prefixes: readonly Nat64ConfiguredPrefix[];

  constructor(
    customSnapshotDir?: string,
    customNat64Prefixes?: readonly Nat64ConfiguredPrefix[],
    options?: SnapshotVerificationOptions
  ) {
    if (customSnapshotDir || options) {
      this.tables = IanaRegistrySnapshotLoader.loadAndVerify(customSnapshotDir, options);
    } else {
      if (!NetworkSecurityPolicy.defaultTables) {
        NetworkSecurityPolicy.defaultTables = IanaRegistrySnapshotLoader.loadAndVerify();
      }
      this.tables = NetworkSecurityPolicy.defaultTables;
    }

    if (customNat64Prefixes && customNat64Prefixes.length > 0) {
      // Sort descending by prefixLength to ensure longest-prefix matching
      this.configuredNat64Prefixes = Object.freeze(
        [...customNat64Prefixes].sort((a, b) => b.prefixLength - a.prefixLength)
      );
    } else {
      // Default: RFC 6052 Well-Known Prefix 64:ff9b::/96
      this.configuredNat64Prefixes = Object.freeze([
        NetworkSecurityPolicy.parseConfiguredNat64Prefix('64:ff9b::/96')
      ]);
    }
  }

  /**
   * Main entry point: returns true if IP is prohibited, false if permitted public unicast.
   */
  public isProhibitedIpAddress(ip: string): boolean {
    const res = this.classifyIpAddress(ip);
    return res.isProhibited;
  }

  /**
   * Returns verified registry tables powering this policy instance.
   */
  public getTables(): VerifiedRegistryTables {
    return this.tables;
  }

  /**
   * Evaluates an IP address through canonical parsing, dual-stack/NAT64 unpacking,
   * and the 4-tier precedence model.
   */
  public classifyIpAddress(ip: string): IpClassificationResult {
    if (!ip || typeof ip !== 'string') {
      return {
        state: 'PROHIBITED_MALFORMED',
        isProhibited: true,
        inputIp: String(ip),
        canonicalIp: null,
        addressFamily: null,
        matchedPrefix: null,
        ruleDescription: 'Malformed: Input is not a non-empty string',
        extractedIpv4: null
      };
    }

    const trimmed = ip.trim();

    // 1. Check for prohibited non-canonical features (zone ID, leading zero octal, hex, dword)
    if (trimmed.includes('%')) {
      return {
        state: 'PROHIBITED_MALFORMED',
        isProhibited: true,
        inputIp: trimmed,
        canonicalIp: null,
        addressFamily: null,
        matchedPrefix: null,
        ruleDescription: 'Malformed: IPv6 Zone Identifiers (%interface) are prohibited',
        extractedIpv4: null
      };
    }

    // Attempt IPv4 parsing
    const ipv4Parsed = NetworkSecurityPolicy.parseCanonicalIpv4(trimmed);
    if (ipv4Parsed !== null) {
      return this.evaluateIpv4(ipv4Parsed, trimmed, null);
    }

    // Attempt IPv6 parsing
    const ipv6Parsed = NetworkSecurityPolicy.parseCanonicalIpv6(trimmed);
    if (ipv6Parsed !== null) {
      // Step 2A: Check for IPv4-mapped IPv6 (::ffff:0:0/96)
      const mappedIpv4 = NetworkSecurityPolicy.extractIpv4MappedIpv6(ipv6Parsed.bytes);
      if (mappedIpv4 !== null) {
        const v4Num = NetworkSecurityPolicy.parseCanonicalIpv4(mappedIpv4);
        if (v4Num !== null) {
          return this.evaluateIpv4(v4Num, trimmed, mappedIpv4);
        }
      }

      // Step 2B: Check for configured NAT64 prefix match & structural extraction
      const nat64Result = this.extractIpv4FromNat64Bytes(ipv6Parsed.bytes, this.configuredNat64Prefixes);
      if (nat64Result.matchedConfiguredPrefix) {
        if (!nat64Result.isValidNat64 || !nat64Result.extractedIpv4) {
          return {
            state: 'PROHIBITED_MALFORMED',
            isProhibited: true,
            inputIp: trimmed,
            canonicalIp: ipv6Parsed.canonical,
            addressFamily: 'IPv6',
            matchedPrefix: nat64Result.matchedPrefixString,
            ruleDescription: nat64Result.failureReason || 'Malformed NAT64 address layout',
            extractedIpv4: null
          };
        }

        // Extracted IPv4 exists: evaluate extracted address through standard IPv4 policy
        const extractedV4Num = NetworkSecurityPolicy.parseCanonicalIpv4(nat64Result.extractedIpv4);
        if (extractedV4Num !== null) {
          return this.evaluateIpv4(extractedV4Num, trimmed, nat64Result.extractedIpv4);
        }
      }

      // Standard Native IPv6 Evaluation
      return this.evaluateIpv6(ipv6Parsed.bigInt, ipv6Parsed.canonical, trimmed);
    }

    return {
      state: 'PROHIBITED_MALFORMED',
      isProhibited: true,
      inputIp: trimmed,
      canonicalIp: null,
      addressFamily: null,
      matchedPrefix: null,
      ruleDescription: 'Malformed: Input cannot be canonically parsed as valid IPv4 or IPv6',
      extractedIpv4: null
    };
  }

  /**
   * Evaluates parsed IPv4 address against 4-tier model.
   */
  private evaluateIpv4(ipNum: number, originalInput: string, extractedFrom: string | null): IpClassificationResult {
    const canonical = NetworkSecurityPolicy.ipv4NumToString(ipNum);

    // TIER 1: Application Security Overrides
    for (const ov of NetworkSecurityPolicy.TIER1_IPV4_OVERRIDES) {
      const { num: prefNum, mask: prefMask } = NetworkSecurityPolicy.parseIpv4Cidr(ov.prefix);
      if ((ipNum & prefMask) === (prefNum & prefMask)) {
        return {
          state: 'PROHIBITED_APPLICATION_OVERRIDE',
          isProhibited: true,
          inputIp: originalInput,
          canonicalIp: canonical,
          addressFamily: 'IPv4',
          matchedPrefix: ov.prefix,
          ruleDescription: `Tier 1 Prohibited Application Override: ${ov.desc}`,
          extractedIpv4: extractedFrom
        };
      }
    }

    // TIER 2: RFC 6890 Special-Purpose Registries (Longest-Prefix Match)
    for (const rec of this.tables.ipv4SpecialPurpose) {
      const cidr = NetworkSecurityPolicy.parseIpv4Cidr(rec.prefix);
      if ((ipNum & cidr.mask) === (cidr.num & cidr.mask)) {
        if (!rec.globallyRoutable) {
          return {
            state: 'PROHIBITED_SPECIAL_PURPOSE',
            isProhibited: true,
            inputIp: originalInput,
            canonicalIp: canonical,
            addressFamily: 'IPv4',
            matchedPrefix: rec.prefix,
            ruleDescription: `Tier 2 Prohibited Special-Purpose IP (RFC 6890): ${rec.name}`,
            extractedIpv4: extractedFrom
          };
        }
        // If globally routable = true, continue to check Tier 3 allocation
        break;
      }
    }

    // TIER 3: Positive Delegated RIR Unicast Allocation (Checked against 256 /8 blocks)
    const firstOctet = (ipNum >>> 24) & 0xff;
    const spaceRec = this.tables.ipv4AddressSpace.find(r => r.prefixNumber === firstOctet);

    if (spaceRec) {
      if (spaceRec.status === 'ALLOCATED' || spaceRec.status === 'LEGACY') {
        return {
          state: 'PERMITTED_PUBLIC_UNICAST',
          isProhibited: false,
          inputIp: originalInput,
          canonicalIp: canonical,
          addressFamily: 'IPv4',
          matchedPrefix: spaceRec.prefixString,
          ruleDescription: `Tier 3 Permitted RIR Allocation: ${spaceRec.designation} (${spaceRec.status})`,
          extractedIpv4: extractedFrom
        };
      }
    }

    // TIER 4: Unallocated, Reserved, or Retained Space (Fail-Closed Default)
    const desig = spaceRec ? `${spaceRec.designation} (${spaceRec.status})` : 'Unallocated /8 Block';
    return {
      state: 'PROHIBITED_UNALLOCATED_OR_RESERVED',
      isProhibited: true,
      inputIp: originalInput,
      canonicalIp: canonical,
      addressFamily: 'IPv4',
      matchedPrefix: spaceRec ? spaceRec.prefixString : `${firstOctet}/8`,
      ruleDescription: `Tier 4 Prohibited Unallocated or Reserved Space: ${desig}`,
      extractedIpv4: extractedFrom
    };
  }

  /**
   * Evaluates parsed IPv6 address against 4-tier model.
   */
  private evaluateIpv6(ipBigInt: bigint, canonical: string, originalInput: string): IpClassificationResult {
    // TIER 1: Application Security Overrides
    for (const ov of NetworkSecurityPolicy.TIER1_IPV6_OVERRIDES) {
      const cidr = NetworkSecurityPolicy.parseIpv6Cidr(ov.prefix);
      if ((ipBigInt & cidr.mask) === (cidr.bigInt & cidr.mask)) {
        return {
          state: 'PROHIBITED_APPLICATION_OVERRIDE',
          isProhibited: true,
          inputIp: originalInput,
          canonicalIp: canonical,
          addressFamily: 'IPv6',
          matchedPrefix: ov.prefix,
          ruleDescription: `Tier 1 Prohibited Application Override: ${ov.desc}`,
          extractedIpv4: null
        };
      }
    }

    // TIER 2: RFC 6890 Special-Purpose Registries (Longest-Prefix Match)
    for (const rec of this.tables.ipv6SpecialPurpose) {
      const cidr = NetworkSecurityPolicy.parseIpv6Cidr(rec.prefix);
      if ((ipBigInt & cidr.mask) === (cidr.bigInt & cidr.mask)) {
        if (!rec.globallyRoutable) {
          return {
            state: 'PROHIBITED_SPECIAL_PURPOSE',
            isProhibited: true,
            inputIp: originalInput,
            canonicalIp: canonical,
            addressFamily: 'IPv6',
            matchedPrefix: rec.prefix,
            ruleDescription: `Tier 2 Prohibited Special-Purpose IP (RFC 6890): ${rec.name}`,
            extractedIpv4: null
          };
        }
        break;
      }
    }

    // TIER 3: Positive Delegated RIR Unicast Pools in 2000::/3
    // Check if within 2000::/3
    const globalUnicastCidr = NetworkSecurityPolicy.parseIpv6Cidr('2000::/3');
    const isGlobalUnicast = (ipBigInt & globalUnicastCidr.mask) === (globalUnicastCidr.bigInt & globalUnicastCidr.mask);

    if (isGlobalUnicast) {
      // Check specific RIR allocations in 2000::/3
      for (const alloc of this.tables.ipv6UnicastAllocations) {
        const cidr = NetworkSecurityPolicy.parseIpv6Cidr(alloc.prefix);
        if ((ipBigInt & cidr.mask) === (cidr.bigInt & cidr.mask)) {
          // If status is not ALLOCATED or description is IANA, it is reserved/unassigned protocol space
          if (alloc.status !== 'ALLOCATED' || alloc.description === 'IANA') {
            return {
              state: 'PROHIBITED_UNALLOCATED_OR_RESERVED',
              isProhibited: true,
              inputIp: originalInput,
              canonicalIp: canonical,
              addressFamily: 'IPv6',
              matchedPrefix: alloc.prefix,
              ruleDescription: `Tier 4 Prohibited: ${alloc.description} (${alloc.status})`,
              extractedIpv4: null
            };
          }

          return {
            state: 'PERMITTED_PUBLIC_UNICAST',
            isProhibited: false,
            inputIp: originalInput,
            canonicalIp: canonical,
            addressFamily: 'IPv6',
            matchedPrefix: alloc.prefix,
            ruleDescription: `Tier 3 Permitted RIR Allocation: ${alloc.description} (${alloc.prefix})`,
            extractedIpv4: null
          };
        }
      }
    }

    // TIER 4: Unallocated, Reserved, or Multicast (Fail-Closed Default)
    return {
      state: 'PROHIBITED_UNALLOCATED_OR_RESERVED',
      isProhibited: true,
      inputIp: originalInput,
      canonicalIp: canonical,
      addressFamily: 'IPv6',
      matchedPrefix: isGlobalUnicast ? '2000::/3 (Unallocated Hole)' : 'Non-Global Unicast',
      ruleDescription: 'Tier 4 Prohibited: Outside active delegated RIR unicast allocations (Fail-Closed)',
      extractedIpv4: null
    };
  }

  // --- Strict Parsing Utilities ---

  public static parseCanonicalIpv4(ip: string): number | null {
    // Regex strictly requiring 4 decimal octets with no leading zeros (except single 0)
    const ipv4Regex = /^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/;
    if (!ipv4Regex.test(ip)) return null;

    const parts = ip.split('.');
    if (parts.length !== 4) return null;

    let num = 0;
    for (let i = 0; i < 4; i++) {
      const p = parts[i];
      if (p.length > 1 && p.startsWith('0')) return null; // Reject octal / leading zeros
      const octet = parseInt(p, 10);
      if (octet < 0 || octet > 255 || isNaN(octet)) return null;
      num = (num << 8) | octet;
    }
    return num >>> 0;
  }

  public static ipv4NumToString(num: number): string {
    return [
      (num >>> 24) & 0xff,
      (num >>> 16) & 0xff,
      (num >>> 8) & 0xff,
      num & 0xff
    ].join('.');
  }

  public static parseIpv4Cidr(cidr: string): { num: number; mask: number } {
    const [ipStr, lenStr] = cidr.split('/');
    const len = lenStr ? parseInt(lenStr, 10) : 32;
    const num = NetworkSecurityPolicy.parseCanonicalIpv4(ipStr) || 0;
    const mask = len === 0 ? 0 : (~0 << (32 - len)) >>> 0;
    return { num, mask };
  }

  public static parseCanonicalIpv6(ip: string): { bigInt: bigint; canonical: string; bytes: Uint8Array } | null {
    // Basic structural checks: must have at least 2 colons, max 1 '::', only valid hex chars and colons
    if (!ip.includes(':')) return null;
    if (ip.includes(':::')) return null;
    if (ip.split('::').length > 2) return null;

    // Check if trailing is dotted-decimal IPv4 (e.g. ::ffff:192.0.2.1)
    const lastColon = ip.lastIndexOf(':');
    const tail = ip.slice(lastColon + 1);
    let fullIp = ip;

    if (tail.includes('.')) {
      const v4Num = NetworkSecurityPolicy.parseCanonicalIpv4(tail);
      if (v4Num === null) return null;
      const hex1 = (((v4Num >>> 16) & 0xffff).toString(16)).padStart(4, '0');
      const hex2 = ((v4Num & 0xffff).toString(16)).padStart(4, '0');
      fullIp = `${ip.slice(0, lastColon)}:${hex1}:${hex2}`;
    }

    // Expand '::'
    let groups: string[];
    if (fullIp.includes('::')) {
      const [left, right] = fullIp.split('::');
      const leftGroups = left ? left.split(':') : [];
      const rightGroups = right ? right.split(':') : [];
      const missing = 8 - (leftGroups.length + rightGroups.length);
      if (missing < 1) return null;
      const middle = Array(missing).fill('0');
      groups = [...leftGroups, ...middle, ...rightGroups];
    } else {
      groups = fullIp.split(':');
    }

    if (groups.length !== 8) return null;

    const bytes = new Uint8Array(16);
    let bigInt = 0n;

    for (let i = 0; i < 8; i++) {
      const g = groups[i];
      if (g.length === 0 || g.length > 4 || !/^[0-9a-fA-F]+$/.test(g)) return null;
      const val = parseInt(g, 16);
      if (val < 0 || val > 0xffff || isNaN(val)) return null;
      bytes[i * 2] = (val >>> 8) & 0xff;
      bytes[i * 2 + 1] = val & 0xff;
      bigInt = (bigInt << 16n) | BigInt(val);
    }

    // Canonical formatting (RFC 5952)
    const canonical = NetworkSecurityPolicy.formatCanonicalIpv6(groups.map(g => parseInt(g, 16)));
    return { bigInt, canonical, bytes };
  }

  public static formatCanonicalIpv6(groups: number[]): string {
    // Find longest run of consecutive zeros for '::' compression
    let longestStart = -1;
    let longestLen = 0;
    let currentStart = -1;
    let currentLen = 0;

    for (let i = 0; i < 8; i++) {
      if (groups[i] === 0) {
        if (currentStart === -1) {
          currentStart = i;
          currentLen = 1;
        } else {
          currentLen++;
        }
        if (currentLen > longestLen) {
          longestLen = currentLen;
          longestStart = currentStart;
        }
      } else {
        currentStart = -1;
        currentLen = 0;
      }
    }

    // Single zero does not compress per RFC 5952 Section 4.2.2
    if (longestLen < 2) {
      return groups.map(g => g.toString(16)).join(':');
    }

    const left = groups.slice(0, longestStart).map(g => g.toString(16)).join(':');
    const right = groups.slice(longestStart + longestLen).map(g => g.toString(16)).join(':');
    return `${left}::${right}`;
  }

  public static parseIpv6Cidr(cidr: string): { bigInt: bigint; mask: bigint } {
    const [ipStr, lenStr] = cidr.split('/');
    const len = lenStr ? parseInt(lenStr, 10) : 128;
    const parsed = NetworkSecurityPolicy.parseCanonicalIpv6(ipStr);
    const bigInt = parsed ? parsed.bigInt : 0n;
    const mask = len === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << (128n - BigInt(len))) - 1n);
    return { bigInt, mask };
  }

  // --- Dual-Stack & NAT64 Extraction ---

  public static extractIpv4MappedIpv6(bytes: Uint8Array): string | null {
    // ::ffff:0:0/96 has bytes 0..9 as 0x00, bytes 10..11 as 0xff
    for (let i = 0; i < 10; i++) {
      if (bytes[i] !== 0x00) return null;
    }
    if (bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
    return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
  }

  public static parseConfiguredNat64Prefix(cidr: string): Nat64ConfiguredPrefix {
    const [ipStr, lenStr] = cidr.split('/');
    const prefixLength = parseInt(lenStr, 10) as 32 | 40 | 48 | 56 | 64 | 96;
    if (![32, 40, 48, 56, 64, 96].includes(prefixLength)) {
      throw new Error(`E-BROWSER-BLOCKED-IP: Invalid NAT64 prefix length /${lenStr}. Must be 32, 40, 48, 56, 64, or 96`);
    }

    const parsed = NetworkSecurityPolicy.parseCanonicalIpv6(ipStr);
    if (!parsed) {
      throw new Error(`E-BROWSER-BLOCKED-IP: Invalid NAT64 prefix IPv6 address: ${ipStr}`);
    }

    return Object.freeze({
      prefixString: cidr,
      prefixBytes: parsed.bytes,
      prefixLength
    });
  }

  private extractIpv4FromNat64Bytes(
    ipv6Bytes: Uint8Array,
    configuredPrefixes: readonly Nat64ConfiguredPrefix[]
  ): { matchedConfiguredPrefix: boolean; matchedPrefixString: string | null; isValidNat64: boolean; extractedIpv4: string | null; failureReason: string | null } {
    if (ipv6Bytes.length !== 16) {
      return { matchedConfiguredPrefix: false, matchedPrefixString: null, isValidNat64: false, extractedIpv4: null, failureReason: 'Invalid byte length' };
    }

    const matched = configuredPrefixes.find(p => this.matchesPrefixBytes(ipv6Bytes, p.prefixBytes, p.prefixLength));
    if (!matched) {
      return { matchedConfiguredPrefix: false, matchedPrefixString: null, isValidNat64: false, extractedIpv4: null, failureReason: null };
    }

    const pl = matched.prefixLength;

    // RFC 6052 Section 2.2: Validate 'u' octet (byte index 8, bits 64-71) must be 0x00 for PL < 96
    if (pl !== 96) {
      if (ipv6Bytes[8] !== 0x00) {
        return {
          matchedConfiguredPrefix: true,
          matchedPrefixString: matched.prefixString,
          isValidNat64: false,
          extractedIpv4: null,
          failureReason: `E-BROWSER-BLOCKED-IP: Malformed NAT64: non-zero 'u' octet (0x${ipv6Bytes[8].toString(16).padStart(2, '0')})`
        };
      }
    }

    let o0: number, o1: number, o2: number, o3: number;

    switch (pl) {
      case 32:
        o0 = ipv6Bytes[4];
        o1 = ipv6Bytes[5];
        o2 = ipv6Bytes[6];
        o3 = ipv6Bytes[7];
        // Suffix bytes 9..15 must be 0
        if (this.hasNonZeroBytes(ipv6Bytes, 9, 15)) {
          return {
            matchedConfiguredPrefix: true,
            matchedPrefixString: matched.prefixString,
            isValidNat64: false,
            extractedIpv4: null,
            failureReason: 'E-BROWSER-BLOCKED-IP: Malformed NAT64: non-zero suffix in /32'
          };
        }
        break;

      case 40:
        o0 = ipv6Bytes[5];
        o1 = ipv6Bytes[6];
        o2 = ipv6Bytes[7];
        o3 = ipv6Bytes[9];
        // Suffix bytes 10..15 must be 0
        if (this.hasNonZeroBytes(ipv6Bytes, 10, 15)) {
          return {
            matchedConfiguredPrefix: true,
            matchedPrefixString: matched.prefixString,
            isValidNat64: false,
            extractedIpv4: null,
            failureReason: 'E-BROWSER-BLOCKED-IP: Malformed NAT64: non-zero suffix in /40'
          };
        }
        break;

      case 48:
        o0 = ipv6Bytes[6];
        o1 = ipv6Bytes[7];
        o2 = ipv6Bytes[9];
        o3 = ipv6Bytes[10];
        // Suffix bytes 11..15 must be 0
        if (this.hasNonZeroBytes(ipv6Bytes, 11, 15)) {
          return {
            matchedConfiguredPrefix: true,
            matchedPrefixString: matched.prefixString,
            isValidNat64: false,
            extractedIpv4: null,
            failureReason: 'E-BROWSER-BLOCKED-IP: Malformed NAT64: non-zero suffix in /48'
          };
        }
        break;

      case 56:
        o0 = ipv6Bytes[7];
        o1 = ipv6Bytes[9];
        o2 = ipv6Bytes[10];
        o3 = ipv6Bytes[11];
        // Suffix bytes 12..15 must be 0
        if (this.hasNonZeroBytes(ipv6Bytes, 12, 15)) {
          return {
            matchedConfiguredPrefix: true,
            matchedPrefixString: matched.prefixString,
            isValidNat64: false,
            extractedIpv4: null,
            failureReason: 'E-BROWSER-BLOCKED-IP: Malformed NAT64: non-zero suffix in /56'
          };
        }
        break;

      case 64:
        o0 = ipv6Bytes[9];
        o1 = ipv6Bytes[10];
        o2 = ipv6Bytes[11];
        o3 = ipv6Bytes[12];
        // Suffix bytes 13..15 must be 0
        if (this.hasNonZeroBytes(ipv6Bytes, 13, 15)) {
          return {
            matchedConfiguredPrefix: true,
            matchedPrefixString: matched.prefixString,
            isValidNat64: false,
            extractedIpv4: null,
            failureReason: 'E-BROWSER-BLOCKED-IP: Malformed NAT64: non-zero suffix in /64'
          };
        }
        break;

      case 96:
        o0 = ipv6Bytes[12];
        o1 = ipv6Bytes[13];
        o2 = ipv6Bytes[14];
        o3 = ipv6Bytes[15];
        break;
    }

    return {
      matchedConfiguredPrefix: true,
      matchedPrefixString: matched.prefixString,
      isValidNat64: true,
      extractedIpv4: `${o0}.${o1}.${o2}.${o3}`,
      failureReason: null
    };
  }

  private matchesPrefixBytes(target: Uint8Array, prefix: Uint8Array, prefixLen: number): boolean {
    const fullBytes = Math.floor(prefixLen / 8);
    const remBits = prefixLen % 8;

    for (let i = 0; i < fullBytes; i++) {
      if (target[i] !== prefix[i]) return false;
    }

    if (remBits > 0) {
      const mask = (~0 << (8 - remBits)) & 0xff;
      if ((target[fullBytes] & mask) !== (prefix[fullBytes] & mask)) return false;
    }

    return true;
  }

  private hasNonZeroBytes(bytes: Uint8Array, start: number, end: number): boolean {
    for (let i = start; i <= end; i++) {
      if (bytes[i] !== 0x00) return true;
    }
    return false;
  }
}
