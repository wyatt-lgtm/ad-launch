import Header from '../components/header';
import Footer from '../components/footer';
import ConfirmContent from './_components/confirm-content';

export default function ConfirmPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <ConfirmContent />
      </main>
      <Footer />
    </div>
  );
}
