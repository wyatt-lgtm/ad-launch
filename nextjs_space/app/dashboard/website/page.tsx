import { Suspense } from 'react';
import Header from '../../components/header';
import Footer from '../../components/footer';
import WebsiteSection from './_components/website-section';
import StaticFoundationCard from './_components/static-foundation-card';

export default function WebsitePage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <StaticFoundationCard />
        </div>
        <Suspense>
          <WebsiteSection />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
