import Header from '../components/header';
import Footer from '../components/footer';
import SearchContent from './_components/search-content';

export default function SearchPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <SearchContent />
      <Footer />
    </div>
  );
}
