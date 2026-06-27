import { Suspense } from 'react';
import Header from '../../components/header';
import Footer from '../../components/footer';
import WebsiteSection from './_components/website-section';

export default function WebsitePage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <Suspense>
          <WebsiteSection />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
