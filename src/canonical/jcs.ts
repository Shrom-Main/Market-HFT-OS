import { canonicalize } from 'json-canonicalize';

function validateJCSValue(val: unknown): void {
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new Error('E-ERR-022: CANONICAL_SERIALIZATION_ERROR: NaN or Infinity values are not permitted in RFC 8785 JCS');
    }
  } else if (typeof val === 'string') {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(val)) {
      throw new Error('E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Lone UTF-16 surrogates are not permitted in RFC 8785 JCS');
    }
  } else if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      validateJCSValue(val[i]);
    }
  } else if (val !== null && typeof val === 'object') {
    for (const key of Object.keys(val)) {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(key)) {
        throw new Error('E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Lone UTF-16 surrogates are not permitted in object keys');
      }
      validateJCSValue((val as Record<string, unknown>)[key]);
    }
  }
}

/**
 * Deterministic RFC 8785 JSON Canonicalization Scheme (JCS)
 * Pinned to json-canonicalize@3.0.1
 * Enforces strict RFC 8785 semantics: UTF-16 lexicographical property sorting,
 * no insignificant whitespace, IEEE 754 canonical number formatting,
 * and fail-closed rejection on invalid inputs (NaN, Infinity, lone surrogates).
 */
export function canonicalizeJCS(input: unknown): string {
  if (input === undefined) {
    throw new Error('E-ERR-024: JCS_UNDEFINED_INPUT');
  }
  validateJCSValue(input);
  return canonicalize(input);
}

export const canonicalizeJcs = canonicalizeJCS;

/**
 * Parse JSON strictly rejecting duplicate keys in any object at any nesting depth.
 * Throws E-ERR-022: CANONICAL_SERIALIZATION_DUPLICATE_KEY_ERROR on duplicates.
 */
export function parseStrictJSONWithoutDuplicateKeys(jsonText: string): unknown {
  if (typeof jsonText !== 'string' || jsonText.trim().length === 0) {
    throw new Error('E-ERR-022: CANONICAL_SERIALIZATION_ERROR: JSON input cannot be empty');
  }

  let index = 0;

  function skipWhitespace(): void {
    while (index < jsonText.length) {
      const ch = jsonText.charCodeAt(index);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        index++;
      } else {
        break;
      }
    }
  }

  function parseString(): string {
    if (jsonText.charCodeAt(index) !== 34) { // '"'
      throw new Error(`E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Expected string at position ${index}`);
    }
    index++; // skip open quote
    let result = '';
    while (index < jsonText.length) {
      const ch = jsonText.charAt(index);
      if (ch === '"') {
        index++;
        return result;
      }
      if (ch === '\\') {
        index++;
        if (index >= jsonText.length) {
          throw new Error('E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Unterminated string escape');
        }
        const esc = jsonText.charAt(index);
        if (esc === '"' || esc === '\\' || esc === '/') {
          result += esc;
          index++;
        } else if (esc === 'b') { result += '\b'; index++; }
        else if (esc === 'f') { result += '\f'; index++; }
        else if (esc === 'n') { result += '\n'; index++; }
        else if (esc === 'r') { result += '\r'; index++; }
        else if (esc === 't') { result += '\t'; index++; }
        else if (esc === 'u') {
          const hex = jsonText.substring(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new Error(`E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Invalid unicode escape \\u${hex}`);
          }
          result += String.fromCharCode(parseInt(hex, 16));
          index += 5;
        } else {
          throw new Error(`E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Invalid escape char \\${esc}`);
        }
      } else {
        result += ch;
        index++;
      }
    }
    throw new Error('E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Unterminated string');
  }

  function parseObject(): Record<string, unknown> {
    index++; // skip '{'
    skipWhitespace();
    const obj: Record<string, unknown> = {};
    const seenKeys = new Set<string>();

    if (index < jsonText.length && jsonText.charAt(index) === '}') {
      index++;
      return obj;
    }

    while (index < jsonText.length) {
      skipWhitespace();
      if (jsonText.charAt(index) !== '"') {
        throw new Error(`E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Expected key string at position ${index}`);
      }
      const key = parseString();
      if (seenKeys.has(key)) {
        throw new Error(`E-ERR-022: CANONICAL_SERIALIZATION_DUPLICATE_KEY_ERROR: Duplicate key detected in JSON: '${key}'`);
      }
      seenKeys.add(key);

      skipWhitespace();
      if (jsonText.charAt(index) !== ':') {
        throw new Error(`E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Expected ':' after key at position ${index}`);
      }
      index++; // skip ':'
      skipWhitespace();
      const val = parseValue();
      obj[key] = val;

      skipWhitespace();
      const nextCh = jsonText.charAt(index);
      if (nextCh === ',') {
        index++;
      } else if (nextCh === '}') {
        index++;
        return obj;
      } else {
        throw new Error(`E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Expected ',' or '}' at position ${index}`);
      }
    }
    throw new Error('E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Unterminated object');
  }

  function parseArray(): unknown[] {
    index++; // skip '['
    skipWhitespace();
    const arr: unknown[] = [];
    if (index < jsonText.length && jsonText.charAt(index) === ']') {
      index++;
      return arr;
    }

    while (index < jsonText.length) {
      skipWhitespace();
      const val = parseValue();
      arr.push(val);

      skipWhitespace();
      const nextCh = jsonText.charAt(index);
      if (nextCh === ',') {
        index++;
      } else if (nextCh === ']') {
        index++;
        return arr;
      } else {
        throw new Error(`E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Expected ',' or ']' at position ${index}`);
      }
    }
    throw new Error('E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Unterminated array');
  }

  function parseValue(): unknown {
    skipWhitespace();
    if (index >= jsonText.length) {
      throw new Error('E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Unexpected end of input');
    }
    const ch = jsonText.charAt(index);
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"') return parseString();
    if (ch === 't' && jsonText.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (ch === 'f' && jsonText.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (ch === 'n' && jsonText.startsWith('null', index)) {
      index += 4;
      return null;
    }
    // Number
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(jsonText.substring(index));
    if (match) {
      const numStr = match[0];
      index += numStr.length;
      const num = Number(numStr);
      if (!Number.isFinite(num)) {
        throw new Error(`E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Invalid number '${numStr}'`);
      }
      return num;
    }
    throw new Error(`E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Unexpected character '${ch}' at position ${index}`);
  }

  const parsed = parseValue();
  skipWhitespace();
  if (index !== jsonText.length) {
    throw new Error(`E-ERR-022: CANONICAL_SERIALIZATION_ERROR: Unexpected trailing characters at position ${index}`);
  }
  return parsed;
}
