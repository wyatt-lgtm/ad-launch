import Header from '../../../components/header';
import Footer from '../../../components/footer';
import TrackingPixelsManager from './_components/tracking-pixels-manager';

export const metadata = {
  title: 'Tracking Pixels | Launch OS',
  description: 'Manage tracking pixels, funnel events and retargeting audiences for your business.',
};

export default function TrackingPixelsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <TrackingPixelsManager />
      </main>
      <Footer />
    </div>
  );
}
