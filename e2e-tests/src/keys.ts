// The RSA pair the apps sign with and the emulator verifies against.
//
// Generated rather than committed: `*.pem` is git-ignored repository wide, so a fixture key
// could not be committed even if we wanted one. The pair is written once and reused, because
// generating 2048 bits on every run is a second the suite does not need to spend.

import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TMP_DIR } from './settings.ts';

export const PRIVATE_KEY_PATH = join(TMP_DIR, 'private_key.pem');
export const PUBLIC_KEY_PATH = join(TMP_DIR, 'public_key.pem');

/** Writes the pair if it is not there yet. Safe to call repeatedly. */
export function ensureKeypair(): void {
  if (existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH)) {
    return;
  }

  // PKCS#8, which is what .env.example asks for and what all three examples parse.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  writeFileSync(PUBLIC_KEY_PATH, publicKey);
}
