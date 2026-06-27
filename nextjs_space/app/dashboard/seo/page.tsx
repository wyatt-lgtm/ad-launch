import { Suspense } from 'react';
import Header from '../../components/header';
import Footer from '../../components/footer';
import SeoSection from './_components/seo-section';

export default function SeoPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <Suspense>
          <SeoSection />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
