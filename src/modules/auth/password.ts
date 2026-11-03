import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Password hashing on node:crypto's scrypt rather than bcrypt: memory-hard,
// built into Node (no native module to compile/download on this machine's
// flaky registry connection), and not subject to bcrypt's silent 72-byte
// input truncation.
//
// Stored format: scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>. The cost params
// travel WITH each hash so they can be raised later without invalidating
// existing rows -- verify reads params from the stored string, never from
// the current constants. Params are one of OWASP's equivalent-strength
// scrypt settings (N=2^15, r=8, p=3), chosen to stay at ~32 MiB per hash.
//
// Also imported by prisma/scripts/seed-dev-user.js (via ts-node) so the dev
// seed can never drift from the real format.

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const PARAMS = { N: 2 ** 15, r: 8, p: 3 } as const;
// Node's default maxmem (32 MiB) is exactly 128*N*r for these params and
// rejects them -- headroom, not a cost increase.
const MAX_MEM = 64 * 1024 * 1024;

function deriveKey(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEM });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

// Returns false (never throws) for any stored value it can't parse -- e.g.
// the "not-a-real-hash" placeholder older seed/test rows carry. A malformed
// hash must read as "wrong password", not surface as a 500.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [N, r, p] = parts.slice(1, 4).map((v) => Number.parseInt(v, 10));
  if (![N, r, p].every((v) => Number.isSafeInteger(v) && v > 0)) return false;

  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await deriveKey(password, salt, expected.length, { N, r, p, maxmem: MAX_MEM });
  } catch {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

// Login runs a full verify even when the email doesn't exist, against this
// throwaway hash, so response time doesn't reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}
