export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from './providers';

const inter = Inter({ subsets: ['latin'] });

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return {
    title: 'Launch Connect | AI Website, SEO, CRM & Social Publishing Platform',
    description: 'Launch Connect by Launch Marketing helps local businesses turn websites, offers, local news, and competitor insights into website previews, SEO pages, social posts, CRM forms, and scheduled social publishing.',
    metadataBase: new URL(baseUrl),
    icons: {
      icon: '/favicon.svg',
      shortcut: '/favicon.svg',
    },
    openGraph: {
      title: 'Launch Connect | AI Website, SEO, CRM & Social Publishing Platform',
      description: 'Launch Connect by Launch Marketing helps local businesses turn websites, offers, local news, and competitor insights into website previews, SEO pages, social posts, CRM forms, and scheduled social publishing.',
      images: ['/og-image.png'],
    },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: '[data-hydration-error] { display: none !important; }' }} />
      </head>
      <body className={inter.className} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
