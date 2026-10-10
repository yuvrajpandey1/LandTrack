import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'LandTrack | Property management for NRIs',
  description: 'Register and track Hyderabad property, appointments, and communications with LandTrack.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
