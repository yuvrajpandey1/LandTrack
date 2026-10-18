/// <reference types="jest" />
import { createTotpSecret, createTotpUrl, verifyTotp } from './totp';

describe('TOTP helpers', () => {
  it('creates a full-length base32 secret', () => {
    expect(createTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('creates an authenticator URI with the account and issuer', () => {
    const uri = createTotpUrl(createTotpSecret(), 'admin@example.com');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain(encodeURIComponent('NRI Land Tracking System'));
    expect(uri).toContain('admin@example.com');
  });

  it('verifies the RFC 6238 SHA-1 vector using six-digit codes', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(verifyTotp(secret, '287082', 59_000)).toBe(true);
    expect(verifyTotp(secret, '287083', 59_000)).toBe(false);
  });

  it('rejects malformed secrets and codes', () => {
    expect(verifyTotp('not-base32!', '287082', 59_000)).toBe(false);
    expect(verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '28708', 59_000)).toBe(false);
  });
});
