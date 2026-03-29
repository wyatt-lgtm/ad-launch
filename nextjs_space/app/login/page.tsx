import Header from '../components/header';
import Footer from '../components/footer';
import LoginContent from './_components/login-content';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1 flex items-center justify-center py-12">
        <LoginContent />
      </main>
      <Footer />
    </div>
  );
}
