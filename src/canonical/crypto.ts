import crypto from 'node:crypto';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * SHA-256 Digest calculation
 */
export function sha256(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * HMAC-SHA256 calculation
 */
export function hmacSha256(secret: Buffer | string, data: Buffer | string): string {
  const secretBuf = typeof secret === 'string' ? Buffer.from(secret, 'hex') : secret;
  const dataBuf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return crypto.createHmac('sha256', secretBuf).update(dataBuf).digest('hex');
}

/**
 * Ed25519 signature verification against 32-byte raw public key hex
 */
export function ed25519Verify(data: Buffer, publicKeyHex: string, signatureHex: string): boolean {
  try {
    if (!/^[a-f0-9]{64}$/i.test(publicKeyHex) || !/^[a-f0-9]{128}$/i.test(signatureHex)) {
      return false;
    }
    const pubBuf = Buffer.from(publicKeyHex, 'hex');
    const sigBuf = Buffer.from(signatureHex, 'hex');
    const keyDer = Buffer.concat([ED25519_SPKI_PREFIX, pubBuf]);
    const key = crypto.createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
    return crypto.verify(null, data, key, sigBuf);
  } catch {
    return false;
  }
}

/**
 * Ed25519 signing using a 32-byte seed / private key hex
 */
export function ed25519Sign(data: Buffer, privateKeySeedHex: string): string {
  if (!/^[a-f0-9]{64}$/i.test(privateKeySeedHex)) {
    throw new Error('Invalid private key seed: must be 32-byte hex string');
  }
  const seedBuf = Buffer.from(privateKeySeedHex, 'hex');
  const keyDer = Buffer.concat([ED25519_PKCS8_PREFIX, seedBuf]);
  const privKey = crypto.createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8' });
  const sig = crypto.sign(null, data, privKey);
  return sig.toString('hex');
}
