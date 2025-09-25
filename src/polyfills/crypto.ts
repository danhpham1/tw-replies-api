import { webcrypto } from 'crypto';

// Ensure global Web Crypto API exists in Node environments
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto as any;
}


