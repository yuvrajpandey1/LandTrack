import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(value: string): Buffer | null {
  const normalized = value.toUpperCase().replace(/=+$/, '');
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) return null;
  let bits = '';
  for (const character of normalized) {
    bits += BASE32_ALPHABET.indexOf(character).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

export function createTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let accumulator = 0;
  let encoded = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32_ALPHABET[(accumulator >>> bits) & 31];
    }
  }
  if (bits > 0) encoded += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return encoded;
}

export function verifyTotp(secret: string, code: string, at = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const key = decodeBase32(secret);
  if (!key?.length) return false;
  const counter = Math.floor(at / 30_000);
  for (const step of [-1, 0, 1]) {
    const data = Buffer.alloc(8);
    data.writeBigUInt64BE(BigInt(counter + step));
    const digest = createHmac('sha1', key).update(data).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = digest.readUInt32BE(offset) & 0x7fffffff;
    const expected = String(binary % 1_000_000).padStart(6, '0');
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return true;
  }
  return false;
}
