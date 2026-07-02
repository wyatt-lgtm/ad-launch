import { Suspense } from 'react';
import Header from '../../components/header';
import Footer from '../../components/footer';
import WebsiteSection from './_components/website-section';
import StaticBuildCard from './_components/static-build-card';
import StaticSiteBuildCard from './_components/static-site-build-card';
import MobileQaCard from './_components/mobile-qa-card';
import PreviewApprovalCard from './_components/preview-approval-card';
import DeploymentSettingsCard from './_components/deployment-settings-card';
import SitemapPlannerCard from './_components/sitemap-planner-card';

export default function WebsitePage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
          <SitemapPlannerCard />
          <StaticSiteBuildCard />
          <MobileQaCard />
          <PreviewApprovalCard />
          <StaticBuildCard />
          <DeploymentSettingsCard />
        </div>
        <Suspense>
          <WebsiteSection />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
