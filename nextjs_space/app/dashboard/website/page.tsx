import { Suspense } from 'react';
import Header from '../../components/header';
import Footer from '../../components/footer';
import WebsiteSection from './_components/website-section';
import StaticBuildCard from './_components/static-build-card';

export default function WebsitePage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <StaticBuildCard />
        </div>
        <Suspense>
          <WebsiteSection />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
