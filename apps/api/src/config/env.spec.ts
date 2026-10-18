/// <reference types="jest" />
import { validateEnvironment } from './env';

const validEnvironment = {
  APP_URL: 'https://tracklan.netlify.app',
  API_URL: 'https://tracklan.netlify.app',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/landtrack',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  OTP_HASH_SECRET: 'c'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'local',
  S3_BUCKET: 'landtrack',
  S3_ACCESS_KEY: 'landtrack',
  S3_SECRET_KEY: 'local-secret',
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'no-reply@landtrack.example',
  WHATSAPP_VERIFY_TOKEN: 'local-token',
  JITSI_DOMAIN: 'localhost',
  JITSI_APP_ID: 'landtrack',
  JITSI_WEBHOOK_SECRET: 'local-webhook-secret',
  CLAMAV_HOST: 'localhost',
  ADMIN_EMAIL: 'admin@landtrack.example',
  ADMIN_NOTIFY_EMAIL: 'admin@landtrack.example'
};

describe('validateEnvironment', () => {
  it('allows Redis to be omitted for the configured Netlify Functions runtime', () => {
    expect(() => validateEnvironment({
      ...validEnvironment,
      LANDTRACK_NETLIFY_FUNCTIONS: 'true'
    })).not.toThrow();
  });

  it('requires Redis for non-Netlify deployments', () => {
    expect(() => validateEnvironment(validEnvironment)).toThrow('REDIS_URL is required outside Netlify Functions.');
  });
});
