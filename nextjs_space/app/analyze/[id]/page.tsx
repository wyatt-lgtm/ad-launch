import Header from '../../components/header';
import Footer from '../../components/footer';
import AnalysisTracker from './_components/analysis-tracker';
import AnalyzeErrorBoundary from './_components/error-boundary';

export default function AnalyzePage({ params }: { params: { id: string } }) {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <AnalyzeErrorBoundary>
          <AnalysisTracker analysisId={params?.id ?? ''} />
        </AnalyzeErrorBoundary>
      </main>
      <Footer />
    </div>
  );
}
