import { webcrypto } from 'node:crypto';

const globalWithCrypto = globalThis as typeof globalThis & { crypto?: Crypto };

if (!globalWithCrypto.crypto?.getRandomValues) {
  globalWithCrypto.crypto = webcrypto as Crypto;
}
