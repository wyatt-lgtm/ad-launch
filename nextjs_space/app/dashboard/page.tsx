import Header from '../components/header';
import Footer from '../components/footer';
import DashboardContent from './_components/dashboard-content';

export default function DashboardPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <DashboardContent />
      </main>
      <Footer />
    </div>
  );
}
