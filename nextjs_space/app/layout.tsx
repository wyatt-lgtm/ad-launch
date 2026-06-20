export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from './providers';

const inter = Inter({ subsets: ['latin'] });

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return {
    title: 'Launch OS | The AI-Powered Local Marketing Operating System',
    description: 'Launch OS by Launch Marketing is the AI-powered local marketing operating system for websites, SEO, social, CRM, and ads.',
    metadataBase: new URL(baseUrl),
    icons: {
      icon: '/favicon.svg',
      shortcut: '/favicon.svg',
    },
    openGraph: {
      title: 'Launch OS | The AI-Powered Local Marketing Operating System',
      description: 'Launch OS by Launch Marketing is the AI-powered local marketing operating system for websites, SEO, social, CRM, and ads.',
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
