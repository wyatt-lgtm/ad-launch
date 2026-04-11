import Header from '../components/header';
import Footer from '../components/footer';
import ResetPasswordContent from './_components/reset-password-content';
import { Suspense } from 'react';

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1 flex items-center justify-center py-12">
        <Suspense fallback={<div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />}>
          <ResetPasswordContent />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
