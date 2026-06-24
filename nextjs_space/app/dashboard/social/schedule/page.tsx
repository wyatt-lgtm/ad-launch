import { Suspense } from 'react';
import Header from '../../../components/header';
import Footer from '../../../components/footer';
import ScheduleDashboard from './_components/schedule-dashboard';

export default function SchedulePage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <Suspense>
          <ScheduleDashboard />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
