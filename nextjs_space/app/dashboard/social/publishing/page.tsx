import Header from '../../../components/header';
import Footer from '../../../components/footer';
import PublishingDashboard from './_components/publishing-dashboard';

export default function PublishingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <PublishingDashboard />
      </main>
      <Footer />
    </div>
  );
}
