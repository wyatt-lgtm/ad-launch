import { redirect } from 'next/navigation';

/**
 * /dashboard/insights → redirects to /dashboard/marketing
 * (Marketing page is the existing analytics/insights page)
 * We keep the original marketing page and redirect from insights to it.
 */
export default function InsightsPage() {
  redirect('/dashboard/marketing');
}
