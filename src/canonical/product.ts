import { canonicalizeJCS } from './jcs.js';
import { sha256 } from './crypto.js';

export interface ProductIdentityCore {
  category_hsn: string;                 // e.g. "73269099" (syntax validated against 4, 6, or 8 digit tariff hierarchy)
  unit_of_measure: 'PIECE' | 'PACK' | 'KG';
  units_per_pack: number;               // Positive integer, e.g. 10
  standard_specification?: string;      // e.g. "DIN_3017_SS304_W4"
  manufacturer_id?: string;             // Stable manufacturer identity slug/hash, e.g. "mfr:in:bhiwadi-precision-clamps"
  manufacturer_part_number?: string;    // e.g. "BPC-3017-16-25"
  critical_dimension_key?: string;      // e.g. "clamping_range_mm:16-25;band_width_mm:9"
}

export interface ManufacturerNamespaceConfig {
  manufacturer_id: string;
  case_insensitive?: boolean;          // If true, MPN is uppercase-folded; default false preserves exact casing
}

/**
 * Deterministic Namespace-Specific Normalization Routine (AUDIT-17, AUDIT-25, AUDIT-33)
 */
export function normalizeProductIdentityCore(
  raw: ProductIdentityCore,
  namespace_registry?: Record<string, ManufacturerNamespaceConfig>
): ProductIdentityCore {
  // 0. Unicode Normalization Form C (NFC) & Control Character Sanitization
  const sanitizeUnicode = (s: string, fieldName: string): string => {
    const nfc = s.normalize('NFC');
    if (/[\u0000-\u001F\u007F-\u009F]/.test(nfc)) {
      throw new Error(`E-ERR-024: MALFORMED_IDENTIFIER: Control characters prohibited in field '${fieldName}'`);
    }
    return nfc;
  };

  // 1. HSN Tariff Syntax & Length Validation (4, 6, or 8 digits)
  const rawHsn = sanitizeUnicode(raw.category_hsn, 'category_hsn').trim().replace(/\s+/g, '');
  if (!/^\d{4}(\d{2}(\d{2})?)?$/.test(rawHsn)) {
    throw new Error('E-ERR-024: INVALID_HSN_FORMAT: category_hsn must be 4, 6, or 8 numeric digits matching Chapter/Heading/Subheading tariff hierarchy');
  }

  // 2. Unit of measure & pack quantity
  if (!['PIECE', 'PACK', 'KG'].includes(raw.unit_of_measure)) {
    throw new Error('E-ERR-024: INVALID_UNIT_OF_MEASURE');
  }
  if (!Number.isSafeInteger(raw.units_per_pack) || raw.units_per_pack <= 0) {
    throw new Error('E-ERR-024: INVALID_UNITS_PER_PACK: Must be positive safe integer');
  }

  const normalized: ProductIdentityCore = {
    category_hsn: rawHsn,
    unit_of_measure: raw.unit_of_measure,
    units_per_pack: raw.units_per_pack
  };

  // 3. Standard Specification (uppercase, single underscore, sanitized Unicode)
  if (raw.standard_specification && raw.standard_specification.trim()) {
    const spec = sanitizeUnicode(raw.standard_specification, 'standard_specification').trim();
    normalized.standard_specification = spec.toUpperCase().replace(/[\s-]+/g, '_');
  }

  // 4. Manufacturer ID & MPN Normalization (Safe Casing & Punctuation Preservation)
  if (raw.manufacturer_part_number && raw.manufacturer_part_number.trim()) {
    if (!raw.manufacturer_id || !raw.manufacturer_id.trim()) {
      throw new Error('E-ERR-013: UNNAMESPACED_MANUFACTURER_PART_NUMBER: manufacturer_id is mandatory when MPN is specified');
    }
    const mfrId = sanitizeUnicode(raw.manufacturer_id, 'manufacturer_id').trim();
    const rawMpn = sanitizeUnicode(raw.manufacturer_part_number, 'manufacturer_part_number').trim();
    normalized.manufacturer_id = mfrId;

    const nsConfig = namespace_registry?.[mfrId];
    if (nsConfig?.case_insensitive) {
      normalized.manufacturer_part_number = rawMpn.toUpperCase();
    } else {
      // Default: preserve exact character casing, hyphens, and internal punctuation
      normalized.manufacturer_part_number = rawMpn;
    }
  } else {
    // Generic item must provide critical dimension key
    if (!raw.critical_dimension_key || !raw.critical_dimension_key.trim()) {
      throw new Error('E-ERR-009: INSUFFICIENT_IDENTITY_DISAMBIGUATION: Generic item requires critical_dimension_key');
    }
    const sanitizedDimKey = sanitizeUnicode(raw.critical_dimension_key, 'critical_dimension_key');
    const rawPairs = sanitizedDimKey.trim().split(';')
      .map(p => p.trim())
      .filter(p => p.length > 0);
    
    // Check for duplicate dimension keys
    const seenKeys = new Set<string>();
    const normalizedPairs: string[] = [];
    for (const pair of rawPairs) {
      const idx = pair.indexOf(':');
      if (idx === -1) throw new Error('E-ERR-024: MALFORMED_DIMENSION_KEY_PAIR: Missing colon separator');
      const k = pair.substring(0, idx).trim().toLowerCase();
      const v = pair.substring(idx + 1).trim();
      if (!k || !v) throw new Error('E-ERR-024: MALFORMED_DIMENSION_KEY_PAIR: Empty dimension key or value');
      if (seenKeys.has(k)) {
        throw new Error(`E-ERR-024: DUPLICATE_DIMENSION_KEY: Key '${k}' duplicated in critical_dimension_key`);
      }
      seenKeys.add(k);
      normalizedPairs.push(`${k}:${v}`);
    }
    normalized.critical_dimension_key = normalizedPairs.sort().join(';');
  }

  return normalized;
}

export function generateCanonicalProductId(core: ProductIdentityCore): string {
  const json = canonicalizeJCS(core);
  return 'prod:' + sha256(Buffer.from(json, 'utf8'));
}

export function calculateVolumetricWeightGrams(length_mm: number, width_mm: number, height_mm: number): number {
  if (!Number.isSafeInteger(length_mm) || !Number.isSafeInteger(width_mm) || !Number.isSafeInteger(height_mm) ||
      length_mm < 1 || length_mm > 10000 || width_mm < 1 || width_mm > 10000 || height_mm < 1 || height_mm > 10000) {
    throw new Error('E-ERR-021: DIMENSION_BOUNDS_EXCEEDED');
  }
  const volume_product = length_mm * width_mm * height_mm;
  const quotient = Math.floor(volume_product / 5000);
  const remainder = volume_product % 5000;
  return remainder >= 2500 ? quotient + 1 : quotient;
}

export interface PhysicalDimensions {
  length_mm: number;
  width_mm: number;
  height_mm: number;
  net_weight_g: number;
  gross_packaged_weight_g: number;
  calculated_volumetric_weight_g: number;
}

export function createPhysicalDimensions(
  length_mm: number,
  width_mm: number,
  height_mm: number,
  net_weight_g: number,
  gross_packaged_weight_g: number
): PhysicalDimensions {
  const vol_g = calculateVolumetricWeightGrams(length_mm, width_mm, height_mm);
  if (!Number.isSafeInteger(net_weight_g) || net_weight_g < 1 || net_weight_g > 100000000 ||
      !Number.isSafeInteger(gross_packaged_weight_g) || gross_packaged_weight_g < 1 || gross_packaged_weight_g > 100000000) {
    throw new Error('E-ERR-021: DIMENSION_BOUNDS_EXCEEDED');
  }
  return {
    length_mm,
    width_mm,
    height_mm,
    net_weight_g,
    gross_packaged_weight_g,
    calculated_volumetric_weight_g: vol_g
  };
}

export function validateInventoryQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1000000000) {
    throw new Error('E-ERR-034: INVALID_INVENTORY_QUANTITY: Quantity must be non-negative safe integer <= 10^9');
  }
}
