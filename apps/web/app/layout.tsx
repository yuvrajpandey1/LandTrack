import './globals.css';
import type { Metadata } from 'next';
import { SessionProvider } from './session-provider';

export const metadata: Metadata = {
  title: 'LandTrack | Property management for NRIs',
  description: 'Register and track Hyderabad property, appointments, and communications with LandTrack.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><SessionProvider>{children}</SessionProvider></body>
    </html>
  );
}
