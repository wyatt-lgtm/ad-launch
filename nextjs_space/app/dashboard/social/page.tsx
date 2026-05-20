import { Suspense } from 'react';
import Header from '../../components/header';
import Footer from '../../components/footer';
import SocialDashboard from './_components/social-dashboard';

export default function SocialPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <Suspense>
          <SocialDashboard />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
