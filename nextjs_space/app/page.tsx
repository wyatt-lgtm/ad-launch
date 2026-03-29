import Header from './components/header';
import Footer from './components/footer';
import LandingContent from './components/landing-content';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <LandingContent />
      <Footer />
    </div>
  );
}
