/**
 * POC-001: Stage 1 — Authoritative IANA Registry Snapshot Parser & Integrity Validator (Phase 1)
 *
 * Implements auditable, reproducible ingestion and integrity verification of IANA
 * and Regional Internet Registry (RIR) address registries:
 * 1. IPv4 Special-Purpose Address Registry (RFC 6890)
 * 2. IPv6 Special-Purpose Address Registry (RFC 6890)
 * 3. IPv4 Address Space Registry (All 256 /8 allocations)
 * 4. IPv6 Global Unicast Address Assignments (Allocations within 2000::/3)
 *
 * Source-Authenticity Trust Model & Completeness Non-Claim:
 * - Upstream Trust Anchor: Internet Assigned Numbers Authority (IANA) at iana.org.
 * - Integrity Anchor: Pre-computed, genuine SHA-256 digests stored in CHECKSUMS.sha256.
 * - Mandatory Fail-Closed Boundary: Missing snapshot files, corrupted XML, or checksum
 *   mismatches immediately throw `E-BROWSER-REGISTRY-UNVERIFIED` and prevent proxy startup.
 * - Completeness Invariant: Record-count thresholds and anchor prefix validations are
 *   structural sanity checks to detect truncated snapshots; they do not mathematically
 *   prove completeness of the global address space.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface SpecialPurposeRecord {
  readonly prefix: string;
  readonly name: string;
  readonly globallyRoutable: boolean;
  readonly destination: boolean;
  readonly forwardable: boolean;
  readonly prefixLength: number;
}

export interface Ipv4SpaceRecord {
  readonly prefixNumber: number; // 0..255
  readonly prefixString: string; // e.g. "001/8"
  readonly designation: string;  // e.g. "APNIC", "Administered by ARIN"
  readonly status: 'ALLOCATED' | 'LEGACY' | 'RESERVED' | 'UNALLOCATED';
}

export interface Ipv6UnicastRecord {
  readonly prefix: string;       // e.g. "2001:200::/23"
  readonly description: string;  // e.g. "APNIC", "ARIN", "RIPE NCC"
  readonly status: string;       // e.g. "ALLOCATED"
  readonly prefixLength: number;
}

export interface SnapshotVerificationOptions {
  /** Maximum acceptable age of snapshot in milliseconds. Defaults to 90 days (7,776,000,000 ms). */
  readonly maxAgeMs?: number;
  /** Reference timestamp in milliseconds for freshness calculation. Defaults to Date.now(). */
  readonly referenceTimeMs?: number;
  /** Clock skew tolerance in milliseconds for future-dated timestamps. Defaults to 5 minutes (300,000 ms). */
  readonly clockSkewToleranceMs?: number;
}

export interface RegistryManifestEntry {
  readonly id: string;
  readonly filename: string;
  readonly source_url: string;
  readonly description: string;
  readonly byte_length: number;
  readonly sha256: string;
  readonly http_last_modified: string | null;
  readonly http_etag: string | null;
  readonly registry_updated: string;
  readonly retrieval_timestamp_utc: string;
}

export interface RegistryManifest {
  readonly schema_version: string;
  readonly domain_tag: string;
  readonly created_at_utc: string;
  readonly entries: readonly RegistryManifestEntry[];
}

export interface VerifiedRegistryTables {
  readonly ipv4SpecialPurpose: readonly SpecialPurposeRecord[];
  readonly ipv6SpecialPurpose: readonly SpecialPurposeRecord[];
  readonly ipv4AddressSpace: readonly Ipv4SpaceRecord[];
  readonly ipv6UnicastAllocations: readonly Ipv6UnicastRecord[];
  readonly snapshotDirectory: string;
  readonly verifiedAtUtc: string;
  readonly manifestCreatedAtUtc: string;
  readonly snapshotAgeMs: number;
}

export class IanaRegistrySnapshotLoader {
  /** Default maximum acceptable snapshot age: 90 days (quarterly refresh invariant). */
  public static readonly DEFAULT_MAX_SNAPSHOT_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  /** Default clock skew tolerance: 5 minutes. */
  public static readonly DEFAULT_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
  /** Expected schema version of manifest.json. */
  public static readonly EXPECTED_SCHEMA_VERSION = '1.0.0';
  /** Expected domain tag of manifest.json. */
  public static readonly EXPECTED_DOMAIN_TAG = 'POC-001-REGISTRY-SNAPSHOT-MANIFEST-V1';

  private static readonly MANDATORY_IPV4_ANCHORS = [
    '10.0.0.0/8',
    '127.0.0.0/8',
    '169.254.0.0/16'
  ];

  private static readonly MANDATORY_IPV6_ANCHORS = [
    '::1/128',
    '::/128',
    'fc00::/7',
    'fe80::/10'
  ];

  /**
   * Loads and validates authoritative snapshots from the given directory.
   *
   * Enforces:
   * 1. CHECKSUMS.sha256 existence and non-empty hash mappings.
   * 2. manifest.json existence, valid JSON, schema_version 1.0.0, and domain_tag matching.
   * 3. Snapshot Freshness Policy:
   *    - Rejects missing, unparseable, future-dated (beyond clock skew), or stale (> maxAgeMs) timestamps.
   * 4. Provenance & Cross-Integrity Invariant:
   *    - Manifest entry SHA-256 digests must match CHECKSUMS.sha256 exactly.
   * 5. Checksum-Before-Parse Invariant:
   *    - On-disk byte length and SHA-256 digest are strictly verified BEFORE any XML parsing is attempted.
   * 6. Structural Record Count & Anchor Invariants:
   *    - Validates minimum record counts and mandatory non-global anchors.
   *
   * Throws `E-BROWSER-REGISTRY-UNVERIFIED` on any missing file, corrupted checksum,
   * stale/future timestamp, schema failure, or XML parsing defect.
   */
  public static loadAndVerify(snapshotDir?: string, options?: SnapshotVerificationOptions): VerifiedRegistryTables {
    const dir = snapshotDir || path.resolve(process.cwd(), 'registry', 'snapshots');

    if (!fs.existsSync(dir)) {
      throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Snapshot directory does not exist: ${dir}`);
    }

    const checksumFile = path.join(dir, 'CHECKSUMS.sha256');
    if (!fs.existsSync(checksumFile)) {
      throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: CHECKSUMS.sha256 missing in: ${dir}`);
    }

    const checksumLines = fs.readFileSync(checksumFile, 'utf8').split('\n').filter(l => l.trim().length > 0);
    const expectedChecksums = new Map<string, string>();
    for (const line of checksumLines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        expectedChecksums.set(parts[1], parts[0].toLowerCase());
      }
    }

    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: manifest.json missing in: ${dir}`);
    }

    let manifestRaw: string;
    try {
      manifestRaw = fs.readFileSync(manifestPath, 'utf8');
    } catch (err: any) {
      throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Cannot read manifest.json: ${err.message}`);
    }

    let manifest: any;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch (err: any) {
      throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Malformed manifest.json: ${err.message}`);
    }

    if (!manifest || typeof manifest !== 'object') {
      throw new Error('E-BROWSER-REGISTRY-UNVERIFIED: manifest.json root must be a JSON object');
    }

    if (manifest.schema_version !== this.EXPECTED_SCHEMA_VERSION) {
      throw new Error(
        `E-BROWSER-REGISTRY-UNVERIFIED: Invalid manifest schema_version: expected ${this.EXPECTED_SCHEMA_VERSION}, got ${manifest.schema_version}`
      );
    }

    if (manifest.domain_tag !== this.EXPECTED_DOMAIN_TAG) {
      throw new Error(
        `E-BROWSER-REGISTRY-UNVERIFIED: Invalid manifest domain_tag: expected ${this.EXPECTED_DOMAIN_TAG}, got ${manifest.domain_tag}`
      );
    }

    if (typeof manifest.created_at_utc !== 'string' || manifest.created_at_utc.trim().length === 0) {
      throw new Error('E-BROWSER-REGISTRY-UNVERIFIED: Missing or empty created_at_utc in manifest.json');
    }

    const createdAtMs = Date.parse(manifest.created_at_utc);
    if (Number.isNaN(createdAtMs)) {
      throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Malformed created_at_utc timestamp: ${manifest.created_at_utc}`);
    }

    const nowMs = options?.referenceTimeMs ?? Date.now();
    const clockSkewMs = options?.clockSkewToleranceMs ?? this.DEFAULT_CLOCK_SKEW_TOLERANCE_MS;
    const maxAgeMs = options?.maxAgeMs ?? this.DEFAULT_MAX_SNAPSHOT_AGE_MS;

    // Check future-dated manifest timestamp (beyond clock skew tolerance)
    if (createdAtMs > nowMs + clockSkewMs) {
      throw new Error(
        `E-BROWSER-REGISTRY-UNVERIFIED: Manifest created_at_utc is future-dated: ${manifest.created_at_utc} exceeds reference time ${new Date(nowMs).toISOString()} (tolerance ${clockSkewMs}ms)`
      );
    }

    // Check stale snapshot age
    if (nowMs - createdAtMs > maxAgeMs) {
      const ageDays = Math.floor((nowMs - createdAtMs) / (24 * 60 * 60 * 1000));
      const maxDays = Math.floor(maxAgeMs / (24 * 60 * 60 * 1000));
      throw new Error(
        `E-BROWSER-REGISTRY-UNVERIFIED: Snapshot is stale (age ${ageDays} days exceeds maximum acceptable age ${maxDays} days)`
      );
    }

    const snapshotAgeMs = Math.max(0, nowMs - createdAtMs);

    if (!Array.isArray(manifest.entries)) {
      throw new Error('E-BROWSER-REGISTRY-UNVERIFIED: manifest.entries must be an array');
    }

    const requiredFiles = [
      'iana-ipv4-special-registry.xml',
      'iana-ipv6-special-registry.xml',
      'ipv4-address-space.xml',
      'ipv6-unicast-address-assignments.xml'
    ];

    for (const filename of requiredFiles) {
      const entry = manifest.entries.find((e: any) => e && e.filename === filename);
      if (!entry) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Missing manifest entry for required file: ${filename}`);
      }

      if (!entry.id || typeof entry.id !== 'string') {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Missing or invalid id in manifest entry for ${filename}`);
      }

      if (!entry.source_url || typeof entry.source_url !== 'string' || !entry.source_url.startsWith('https://www.iana.org/')) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Invalid source_url in manifest entry for ${filename}: ${entry.source_url}`);
      }

      if (!Number.isInteger(entry.byte_length) || entry.byte_length <= 0) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Invalid byte_length in manifest entry for ${filename}: ${entry.byte_length}`);
      }

      if (!entry.sha256 || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Invalid sha256 in manifest entry for ${filename}: ${entry.sha256}`);
      }

      if (!entry.retrieval_timestamp_utc || typeof entry.retrieval_timestamp_utc !== 'string') {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Missing retrieval_timestamp_utc for ${filename}`);
      }

      const retrievalMs = Date.parse(entry.retrieval_timestamp_utc);
      if (Number.isNaN(retrievalMs)) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Malformed retrieval_timestamp_utc for ${filename}: ${entry.retrieval_timestamp_utc}`);
      }

      if (retrievalMs > nowMs + clockSkewMs) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Future-dated retrieval_timestamp_utc for ${filename}: ${entry.retrieval_timestamp_utc}`);
      }

      if (nowMs - retrievalMs > maxAgeMs) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Stale retrieval_timestamp_utc for ${filename} (exceeds max age)`);
      }

      // Cross-integrity check between manifest and CHECKSUMS.sha256
      const expectedShaFromChecksums = expectedChecksums.get(filename);
      if (!expectedShaFromChecksums) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: No checksum entry for ${filename} in CHECKSUMS.sha256`);
      }

      if (entry.sha256.toLowerCase() !== expectedShaFromChecksums) {
        throw new Error(
          `E-BROWSER-REGISTRY-UNVERIFIED: Cross-integrity mismatch for ${filename}: manifest SHA (${entry.sha256.toLowerCase()}) != CHECKSUMS.sha256 (${expectedShaFromChecksums})`
        );
      }

      // CHECKSUM-BEFORE-PARSE INVARIANT: Verify physical file on disk before XML parse
      const filePath = path.join(dir, filename);
      if (!fs.existsSync(filePath)) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Required snapshot file missing: ${filename}`);
      }

      const fileBuffer = fs.readFileSync(filePath);
      if (fileBuffer.length === 0) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Snapshot file is empty: ${filename}`);
      }

      if (fileBuffer.length !== entry.byte_length) {
        throw new Error(
          `E-BROWSER-REGISTRY-UNVERIFIED: Byte length mismatch for ${filename}. Expected ${entry.byte_length}, got ${fileBuffer.length}`
        );
      }

      const actualSha = crypto.createHash('sha256').update(fileBuffer).digest('hex').toLowerCase();
      if (actualSha !== expectedShaFromChecksums) {
        throw new Error(
          `E-BROWSER-REGISTRY-UNVERIFIED: Checksum mismatch for ${filename}. Expected ${expectedShaFromChecksums}, got ${actualSha}`
        );
      }
    }

    // Parse files ONLY AFTER manifest, checksums, byte lengths, and SHA-256 integrity have been verified
    const ipv4SpecialXml = fs.readFileSync(path.join(dir, 'iana-ipv4-special-registry.xml'), 'utf8');
    const ipv6SpecialXml = fs.readFileSync(path.join(dir, 'iana-ipv6-special-registry.xml'), 'utf8');
    const ipv4SpaceXml = fs.readFileSync(path.join(dir, 'ipv4-address-space.xml'), 'utf8');
    const ipv6UnicastXml = fs.readFileSync(path.join(dir, 'ipv6-unicast-address-assignments.xml'), 'utf8');

    const ipv4Special = this.parseSpecialRegistry(ipv4SpecialXml, 'IPv4');
    const ipv6Special = this.parseSpecialRegistry(ipv6SpecialXml, 'IPv6');
    const ipv4Space = this.parseIpv4SpaceRegistry(ipv4SpaceXml);
    const ipv6Unicast = this.parseIpv6UnicastRegistry(ipv6UnicastXml);

    // Verify minimum record count thresholds
    if (ipv4Special.length < 15) {
      throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Insufficient IPv4 special-purpose records (${ipv4Special.length} < 15)`);
    }
    if (ipv6Special.length < 10) {
      throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Insufficient IPv6 special-purpose records (${ipv6Special.length} < 10)`);
    }
    if (ipv4Space.length !== 256) {
      throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: IPv4 address space must contain exactly 256 /8 records, found ${ipv4Space.length}`);
    }
    if (ipv6Unicast.length < 30) {
      throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Insufficient IPv6 unicast allocation records (${ipv6Unicast.length} < 30)`);
    }

    // Verify mandatory anchor prefixes
    for (const anchor of this.MANDATORY_IPV4_ANCHORS) {
      const match = ipv4Special.find(r => r.prefix === anchor);
      if (!match) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Mandatory IPv4 anchor prefix missing: ${anchor}`);
      }
      if (match.globallyRoutable !== false) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Mandatory IPv4 anchor prefix ${anchor} must have globallyRoutable=false`);
      }
    }

    for (const anchor of this.MANDATORY_IPV6_ANCHORS) {
      const match = ipv6Special.find(r => r.prefix === anchor);
      if (!match) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Mandatory IPv6 anchor prefix missing: ${anchor}`);
      }
      if (match.globallyRoutable !== false) {
        throw new Error(`E-BROWSER-REGISTRY-UNVERIFIED: Mandatory IPv6 anchor prefix ${anchor} must have globallyRoutable=false`);
      }
    }

    return Object.freeze({
      ipv4SpecialPurpose: Object.freeze(ipv4Special),
      ipv6SpecialPurpose: Object.freeze(ipv6Special),
      ipv4AddressSpace: Object.freeze(ipv4Space),
      ipv6UnicastAllocations: Object.freeze(ipv6Unicast),
      snapshotDirectory: dir,
      verifiedAtUtc: new Date(nowMs).toISOString(),
      manifestCreatedAtUtc: manifest.created_at_utc,
      snapshotAgeMs
    });
  }

  private static parseSpecialRegistry(xml: string, family: 'IPv4' | 'IPv6'): SpecialPurposeRecord[] {
    const records: SpecialPurposeRecord[] = [];
    const recordMatches = xml.match(/<record(\s[^>]*)?>([\s\S]*?)<\/record>/g) || [];

    for (const rawRecord of recordMatches) {
      const addrMatch = rawRecord.match(/<address>([^<]+)<\/address>/);
      if (!addrMatch) continue;
      const prefix = addrMatch[1].trim();

      const nameMatch = rawRecord.match(/<name>([^<]+)<\/name>/);
      const name = nameMatch ? nameMatch[1].trim() : 'Unnamed';

      const globalMatch = rawRecord.match(/<global>([^<]+)<\/global>/);
      const globalStr = globalMatch ? globalMatch[1].trim().toLowerCase() : 'false';
      const globallyRoutable = globalStr === 'true';

      const destMatch = rawRecord.match(/<destination>([^<]+)<\/destination>/);
      const destStr = destMatch ? destMatch[1].trim().toLowerCase() : 'false';
      const destination = destStr === 'true';

      const fwdMatch = rawRecord.match(/<forwardable>([^<]+)<\/forwardable>/);
      const fwdStr = fwdMatch ? fwdMatch[1].trim().toLowerCase() : 'false';
      const forwardable = fwdStr === 'true';

      const parts = prefix.split('/');
      const prefixLength = parts.length === 2 ? parseInt(parts[1], 10) : (family === 'IPv4' ? 32 : 128);

      records.push({
        prefix,
        name,
        globallyRoutable,
        destination,
        forwardable,
        prefixLength
      });
    }

    // Sort by prefix length descending for longest-prefix matching
    records.sort((a, b) => b.prefixLength - a.prefixLength);
    return records;
  }

  private static parseIpv4SpaceRegistry(xml: string): Ipv4SpaceRecord[] {
    const records: Ipv4SpaceRecord[] = [];
    const recordMatches = xml.match(/<record(\s[^>]*)?>([\s\S]*?)<\/record>/g) || [];

    for (const rawRecord of recordMatches) {
      const prefixMatch = rawRecord.match(/<prefix>([^<]+)<\/prefix>/);
      if (!prefixMatch) continue;
      const prefixString = prefixMatch[1].trim(); // e.g. "001/8"
      const prefixNumber = parseInt(prefixString.split('/')[0], 10);

      const statusMatch = rawRecord.match(/<status>([^<]+)<\/status>/);
      const rawStatus = statusMatch ? statusMatch[1].trim().toUpperCase() : 'UNALLOCATED';
      let status: 'ALLOCATED' | 'LEGACY' | 'RESERVED' | 'UNALLOCATED' = 'UNALLOCATED';
      if (rawStatus === 'ALLOCATED') status = 'ALLOCATED';
      else if (rawStatus === 'LEGACY') status = 'LEGACY';
      else if (rawStatus === 'RESERVED') status = 'RESERVED';

      const desigMatch = rawRecord.match(/<designation>([^<]+)<\/designation>/);
      const designation = desigMatch ? desigMatch[1].trim() : 'Unknown';

      records.push({
        prefixNumber,
        prefixString,
        designation,
        status
      });
    }

    records.sort((a, b) => a.prefixNumber - b.prefixNumber);
    return records;
  }

  private static parseIpv6UnicastRegistry(xml: string): Ipv6UnicastRecord[] {
    const records: Ipv6UnicastRecord[] = [];
    const recordMatches = xml.match(/<record(\s[^>]*)?>([\s\S]*?)<\/record>/g) || [];

    for (const rawRecord of recordMatches) {
      const prefixMatch = rawRecord.match(/<prefix>([^<]+)<\/prefix>/);
      if (!prefixMatch) continue;
      const prefix = prefixMatch[1].trim();

      const descMatch = rawRecord.match(/<description>([^<]+)<\/description>/);
      const description = descMatch ? descMatch[1].trim() : 'Unknown';

      const statusMatch = rawRecord.match(/<status>([^<]+)<\/status>/);
      const status = statusMatch ? statusMatch[1].trim().toUpperCase() : 'UNKNOWN';

      const slashParts = prefix.split('/');
      const prefixLength = slashParts.length === 2 ? parseInt(slashParts[1], 10) : 128;

      records.push({
        prefix,
        description,
        status,
        prefixLength
      });
    }

    records.sort((a, b) => b.prefixLength - a.prefixLength);
    return records;
  }
}
