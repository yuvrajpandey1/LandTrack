import './globals.css';
import type { Metadata } from 'next';
import { SessionProvider } from './session-provider';

const description = 'Register and track Hyderabad property, appointments, and communications with the NRI Land Tracking System.';

export const metadata: Metadata = {
  // Absolute base for the social preview image (app/opengraph-image.jpg); override with NEXT_PUBLIC_SITE_URL.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://landtrack-50046989602.development.catalystappsail.in'),
  title: 'LandTrack | NRI Land Tracking System',
  applicationName: 'LandTrack',
  description,
  openGraph: { siteName: 'LandTrack', title: 'LandTrack | NRI Land Tracking System', description, type: 'website' }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Manrope:wght@400;500;600;700&display=swap" />
      </head>
      <body><SessionProvider>{children}</SessionProvider></body>
    </html>
  );
}
