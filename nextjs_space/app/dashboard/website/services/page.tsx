import { Suspense } from 'react';
import Header from '../../../components/header';
import Footer from '../../../components/footer';
import ServicesManager from './_components/services-manager';

export default function ServicesOfferedPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <Suspense>
          <ServicesManager />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
