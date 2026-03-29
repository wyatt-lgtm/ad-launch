import Header from '../../components/header';
import Footer from '../../components/footer';
import ResultsContent from './_components/results-content';

export default function ResultsPage({ params }: { params: { id: string } }) {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <ResultsContent analysisId={params?.id ?? ''} />
      </main>
      <Footer />
    </div>
  );
}
