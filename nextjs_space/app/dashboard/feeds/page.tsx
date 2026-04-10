import Header from '../../components/header';
import Footer from '../../components/footer';
import FeedPreferences from './_components/feed-preferences';

export default function FeedsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <FeedPreferences />
      </main>
      <Footer />
    </div>
  );
}
