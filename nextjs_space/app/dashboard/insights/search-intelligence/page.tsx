import Header from '../../../components/header';
import Footer from '../../../components/footer';
import SearchIntelligenceManager from './_components/search-intelligence-manager';

export const metadata = {
  title: 'Search Intelligence | Launch OS',
  description: 'Ongoing keyword, rank, paid, local pack and competitor tracking powered by compliant data providers.',
};

export default function SearchIntelligencePage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <SearchIntelligenceManager />
      </main>
      <Footer />
    </div>
  );
}
