/**
 * POC-001: Stage 1 — Authoritative Registry Snapshot Ingestion Script (Phase 1)
 *
 * Downloads authoritative IANA address registries:
 * 1. IPv4 Special-Purpose Address Registry (RFC 6890)
 * 2. IPv6 Special-Purpose Address Registry (RFC 6890)
 * 3. IPv4 Address Space Registry (All 256 /8 allocations)
 * 4. IPv6 Global Unicast Address Assignments (Allocations within 2000::/3)
 *
 * Enforces:
 * - Genuine SHA-256 generation
 * - Manifest generation recording source URLs, retrieval timestamps, byte lengths, ETags, and version tags
 * - Strict reproducibility and auditability
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

interface RegistrySource {
  readonly id: string;
  readonly filename: string;
  readonly url: string;
  readonly description: string;
}

const REGISTRY_SOURCES: readonly RegistrySource[] = [
  {
    id: 'iana-ipv4-special',
    filename: 'iana-ipv4-special-registry.xml',
    url: 'https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xml',
    description: 'IANA IPv4 Special-Purpose Address Registry (RFC 6890)'
  },
  {
    id: 'iana-ipv6-special',
    filename: 'iana-ipv6-special-registry.xml',
    url: 'https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xml',
    description: 'IANA IPv6 Special-Purpose Address Registry (RFC 6890)'
  },
  {
    id: 'iana-ipv4-space',
    filename: 'ipv4-address-space.xml',
    url: 'https://www.iana.org/assignments/ipv4-address-space/ipv4-address-space.xml',
    description: 'IANA IPv4 Address Space Registry (All 256 /8 allocations)'
  },
  {
    id: 'iana-ipv6-unicast',
    filename: 'ipv6-unicast-address-assignments.xml',
    url: 'https://www.iana.org/assignments/ipv6-unicast-address-assignments/ipv6-unicast-address-assignments.xml',
    description: 'IANA IPv6 Global Unicast Address Assignments (2000::/3 allocations)'
  }
];

export interface SnapshotManifestEntry {
  readonly id: string;
  readonly filename: string;
  readonly source_url: string;
  readonly description: string;
  readonly byte_length: number;
  readonly sha256: string;
  readonly http_last_modified: string | null;
  readonly http_etag: string | null;
  readonly registry_updated: string | null;
  readonly retrieval_timestamp_utc: string;
}

export interface SnapshotManifest {
  readonly schema_version: '1.0.0';
  readonly domain_tag: 'POC-001-REGISTRY-SNAPSHOT-MANIFEST-V1';
  readonly created_at_utc: string;
  readonly entries: readonly SnapshotManifestEntry[];
}

export async function fetchAllSnapshots(targetDir: string): Promise<SnapshotManifest> {
  fs.mkdirSync(targetDir, { recursive: true });

  const retrievalTimestamp = new Date().toISOString();
  const entries: SnapshotManifestEntry[] = [];
  const checksumLines: string[] = [];

  for (const src of REGISTRY_SOURCES) {
    console.log(`Fetching ${src.id} from ${src.url}...`);
    const resp = await fetch(src.url);
    if (!resp.ok) {
      throw new Error(`Failed to fetch ${src.url}: HTTP ${resp.status} ${resp.statusText}`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const byteLength = buffer.length;
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const filePath = path.join(targetDir, src.filename);
    fs.writeFileSync(filePath, buffer);

    const httpLastModified = resp.headers.get('last-modified');
    const httpEtag = resp.headers.get('etag');

    // Extract <updated>YYYY-MM-DD</updated> if present in XML text
    const textSample = buffer.toString('utf8', 0, Math.min(byteLength, 4096));
    const updatedMatch = textSample.match(/<updated>([^<]+)<\/updated>/);
    const registryUpdated = updatedMatch ? updatedMatch[1].trim() : null;

    entries.push({
      id: src.id,
      filename: src.filename,
      source_url: src.url,
      description: src.description,
      byte_length: byteLength,
      sha256,
      http_last_modified: httpLastModified,
      http_etag: httpEtag,
      registry_updated: registryUpdated,
      retrieval_timestamp_utc: retrievalTimestamp
    });

    checksumLines.push(`${sha256}  ${src.filename}`);
    console.log(`  ✓ Saved ${src.filename} (${byteLength} bytes, SHA-256: ${sha256})`);
  }

  const manifest: SnapshotManifest = {
    schema_version: '1.0.0',
    domain_tag: 'POC-001-REGISTRY-SNAPSHOT-MANIFEST-V1',
    created_at_utc: retrievalTimestamp,
    entries: Object.freeze(entries)
  };

  const manifestPath = path.join(targetDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const checksumsPath = path.join(targetDir, 'CHECKSUMS.sha256');
  fs.writeFileSync(checksumsPath, checksumLines.join('\n') + '\n', 'utf8');

  console.log(`\nManifest written to ${manifestPath}`);
  console.log(`Checksums written to ${checksumsPath}`);

  return manifest;
}

// Allow direct CLI execution
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('fetch_iana_snapshots.ts')) {
  const defaultDir = path.resolve(process.cwd(), 'registry', 'snapshots');
  fetchAllSnapshots(defaultDir)
    .then(() => {
      console.log('Snapshot ingestion completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Snapshot ingestion failed:', err);
      process.exit(1);
    });
}
