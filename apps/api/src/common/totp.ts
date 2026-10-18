import * as speakeasy from 'speakeasy';

export function createTotpSecret(): string {
  return speakeasy.generateSecret({ length: 20 }).base32;
}

export function createTotpUrl(secret: string, email: string): string {
  return speakeasy.otpauthURL({
    secret,
    encoding: 'base32',
    label: email,
    issuer: 'NRI Land Tracking System',
    algorithm: 'sha1',
    digits: 6,
    period: 30
  });
}

export function verifyTotp(secret: string, code: string, at = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: code,
    time: at / 1000,
    window: 1
  });
}
