export type UserRole = 'NRI' | 'AGENT' | 'ADMIN' | 'AUDITOR';
export type PropertyStatus =
  | 'DRAFT'
  | 'PAYMENT_PENDING'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export interface HealthResponse {
  status: 'ok';
  service: 'landtrack-api';
  timestamp: string;
}

export const supportedCountries = [
  { code: 'AU', name: 'Australia' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CN', name: 'China' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IN', name: 'India' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'PH', name: 'Philippines' },
  { code: 'QA', name: 'Qatar' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'US', name: 'United States' },
  { code: 'ZA', name: 'South Africa' }
];

export const landtrackConfig = {
  appName: 'LandTrack',
  version: '1.3.0',
  supportedRegion: 'Hyderabad, Telangana',
  registrationChargeInr: 500,
  defaultTimezone: 'Asia/Kolkata'
};
