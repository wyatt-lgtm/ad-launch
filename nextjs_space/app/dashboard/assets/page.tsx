import Header from '../../components/header';
import Footer from '../../components/footer';
import AssetsContent from './_components/assets-content';

export default function AssetsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <AssetsContent />
      </main>
      <Footer />
    </div>
  );
}
