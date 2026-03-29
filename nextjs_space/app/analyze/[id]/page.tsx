import Header from '../../components/header';
import Footer from '../../components/footer';
import AnalysisTracker from './_components/analysis-tracker';

export default function AnalyzePage({ params }: { params: { id: string } }) {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <AnalysisTracker analysisId={params?.id ?? ''} />
      </main>
      <Footer />
    </div>
  );
}
