import { Suspense } from 'react';
import Header from '../../../components/header';
import Footer from '../../../components/footer';
import CommunityEngagementSection from './_components/community-engagement-section';

export default function CommunityEngagementPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <Suspense>
          <CommunityEngagementSection />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
