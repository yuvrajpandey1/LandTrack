import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  OTP_HASH_SECRET: z.string().min(32),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().email(),
  SMS_PROVIDER: z.enum(['fake', 'cloud', 'twilio_verify']).default('fake'),
  SMS_API_URL: z.string().url().optional(),
  SMS_API_TOKEN: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[0-9a-fA-F]{32}$/).optional().or(z.literal('')),
  TWILIO_AUTH_TOKEN: z.string().min(32).optional().or(z.literal('')),
  TWILIO_API_KEY_SID: z.string().regex(/^SK[0-9a-fA-F]{32}$/).optional().or(z.literal('')),
  TWILIO_API_KEY_SECRET: z.string().min(32).optional().or(z.literal('')),
  TWILIO_VERIFY_SERVICE_SID: z.string().regex(/^VA[0-9a-fA-F]{32}$/).optional().or(z.literal('')),
  WHATSAPP_PROVIDER: z.enum(['fake', 'cloud']).default('fake'),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  PAYMENT_PROVIDER: z.enum(['fake', 'razorpay']).default('fake'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  JITSI_DOMAIN: z.string().min(1),
  JITSI_APP_ID: z.string().min(1),
  JITSI_APP_SECRET: z.string().optional(),
  JITSI_WEBHOOK_SECRET: z.string().min(1),
  CLAMAV_HOST: z.string().min(1),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_NAME: z.string().min(2).max(120).optional(),
  ADMIN_MOBILE: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  ADMIN_INITIAL_PASSWORD: z.string().optional(),
  ADMIN_SIGNUP_CODE: z.string().min(32).optional().or(z.literal('')),
  ADMIN_NOTIFY_EMAIL: z.string().email()
}).superRefine((env, context) => {
  if (env.SMS_PROVIDER === 'twilio_verify') {
    const hasApiKey = Boolean(env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET);
    const hasAccountCredentials = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
    if (!env.TWILIO_VERIFY_SERVICE_SID || (!hasApiKey && !hasAccountCredentials)) {
      context.addIssue({ code: 'custom', message: 'A Twilio Verify Service SID and either API key credentials or Account SID/Auth Token are required when SMS_PROVIDER=twilio_verify.' });
    }
    if (Boolean(env.TWILIO_API_KEY_SID) !== Boolean(env.TWILIO_API_KEY_SECRET)) {
      context.addIssue({ code: 'custom', message: 'TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET must be configured together.' });
    }
    if (Boolean(env.TWILIO_ACCOUNT_SID) !== Boolean(env.TWILIO_AUTH_TOKEN)) {
      context.addIssue({ code: 'custom', message: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be configured together.' });
    }
  }
  if (env.SMS_PROVIDER === 'cloud' && (!env.SMS_API_URL || !env.SMS_API_TOKEN)) {
    context.addIssue({ code: 'custom', message: 'SMS_API_URL and SMS_API_TOKEN are required when SMS_PROVIDER=cloud.' });
  }
  if (env.NODE_ENV === 'production') {
    for (const provider of [env.SMS_PROVIDER, env.WHATSAPP_PROVIDER, env.PAYMENT_PROVIDER]) {
      if (provider === 'fake') context.addIssue({ code: 'custom', message: 'Fake providers cannot be enabled in production.' });
    }
    const hasInitialAdminPassword = Boolean(env.ADMIN_INITIAL_PASSWORD && env.ADMIN_INITIAL_PASSWORD.length >= 12);
    const hasAdminSignupCode = Boolean(env.ADMIN_SIGNUP_CODE && env.ADMIN_SIGNUP_CODE.length >= 32);
    if (!hasInitialAdminPassword && !hasAdminSignupCode) {
      context.addIssue({ code: 'custom', message: 'Production requires either an ADMIN_INITIAL_PASSWORD of at least 12 characters or an ADMIN_SIGNUP_CODE of at least 32 characters.' });
    }
    if (env.PAYMENT_PROVIDER === 'razorpay' && (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)) {
      context.addIssue({ code: 'custom', message: 'Razorpay API and webhook credentials are required.' });
    }
    if (env.WHATSAPP_PROVIDER === 'cloud' && (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)) {
      context.addIssue({ code: 'custom', message: 'WhatsApp Cloud API credentials are required.' });
    }
    if (env.WHATSAPP_PROVIDER === 'cloud' && !env.WHATSAPP_APP_SECRET) {
      context.addIssue({ code: 'custom', message: 'WHATSAPP_APP_SECRET is required to validate webhooks.' });
    }
  }
});

export function validateEnvironment(environment: Record<string, unknown>): Record<string, unknown> {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid NRI Land Tracking System API environment: ${reasons}`);
  }
  return parsed.data;
}
