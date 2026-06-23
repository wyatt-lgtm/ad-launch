import Header from '../../components/header';
import Footer from '../../components/footer';
import MarketingDashboard from './_components/marketing-dashboard';

export default function MarketingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <MarketingDashboard />
      </main>
      <Footer />
    </div>
  );
}
