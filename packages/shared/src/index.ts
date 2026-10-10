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

export const landtrackConfig = {
  appName: 'LandTrack',
  version: '1.3.0',
  supportedRegion: 'Hyderabad, Telangana',
  registrationChargeInr: 500,
  defaultTimezone: 'Asia/Kolkata'
};
