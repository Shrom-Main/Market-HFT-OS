import { canonicalize } from 'json-canonicalize';

/**
 * Deterministic RFC 8785 JSON Canonicalization Scheme (JCS)
 * Pinned to json-canonicalize@3.0.1
 * Enforces strict RFC 8785 semantics: UTF-16 lexicographical property sorting,
 * no insignificant whitespace, IEEE 754 canonical number formatting,
 * and fail-closed rejection on invalid inputs.
 */
export function canonicalizeJCS(input: unknown): string {
  if (input === undefined) {
    throw new Error('E-ERR-024: JCS_UNDEFINED_INPUT');
  }
  return canonicalize(input);
}

export const canonicalizeJcs = canonicalizeJCS;
