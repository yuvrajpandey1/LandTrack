import './globals.css';
import type { Metadata } from 'next';
import { SessionProvider } from './session-provider';

export const metadata: Metadata = {
  title: 'NRI Land Tracking System',
  description: 'Register and track Hyderabad property, appointments, and communications with the NRI Land Tracking System.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><SessionProvider>{children}</SessionProvider></body>
    </html>
  );
}
