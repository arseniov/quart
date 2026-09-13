import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-256-GCM payload layout: `iv(12) || ciphertext || tag(16)`.
 *  GCM authenticates ciphertext+tag, so the receiver reads the tag from the end.
 *  A fresh random IV is generated per DEK wrap so equal DEKs produce different
 *  ciphertexts. */
const IV_LEN = 12;
const TAG_LEN = 16;
const KEK_LEN = 32;

/** Wrap a per-city DEK with the KEK using AES-256-GCM.
 *  Returns `iv || ciphertext || tag` ready for `bytea` storage. */
export function encryptDek(dek: Buffer, kek: Buffer): Buffer {
  assertKek(kek);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]);
}

/** Inverse of {@link encryptDek}. Throws if the GCM tag check fails (tampered
 *  ciphertext, wrong KEK, or corrupt bytes). */
export function decryptDek(stored: Buffer, kek: Buffer): Buffer {
  assertKek(kek);
  if (stored.length < IV_LEN + TAG_LEN) throw new Error('stored DEK too short');
  const iv = stored.subarray(0, IV_LEN);
  const tag = stored.subarray(stored.length - TAG_LEN);
  const ciphertext = stored.subarray(IV_LEN, stored.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function assertKek(kek: Buffer): void {
  if (kek.length !== KEK_LEN) {
    throw new Error(`KEK must be ${KEK_LEN} bytes for AES-256-GCM (got ${kek.length})`);
  }
}
