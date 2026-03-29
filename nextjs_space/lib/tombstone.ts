const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api.onrender.com';

export async function createMission(websiteUrl: string) {
  try {
    const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
    const res = await fetch(`${TOMBSTONE_URL}/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: `Create 3 minimal Facebook posts for ${normalizedUrl}. Analysis rules: Max 5-7 pages (Home, Services, About, Contact priority). Image rules: Real photos, high-res only, no icons/logos. Quality rules: No hallucinations, specific industry, identify what/who/why.`,
        domain: normalizedUrl,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { success: res.ok, data, missionId: data?.id ?? data?.mission_id ?? null };
  } catch (err: any) {
    console.error('Tombstone create mission error:', err?.message);
    return { success: false, data: null, missionId: null };
  }
}

export async function getMissionStatus(missionId: string) {
  try {
    const res = await fetch(`${TOMBSTONE_URL}/missions/${missionId}`);
    const data = await res.json().catch(() => ({}));
    return { success: res.ok, data, status: data?.status ?? 'unknown' };
  } catch (err: any) {
    console.error('Tombstone mission status error:', err?.message);
    return { success: false, data: null, status: 'error' };
  }
}

export async function getMissionResults(missionId: string) {
  try {
    const res = await fetch(`${TOMBSTONE_URL}/tasks?workflow_id=${missionId}`);
    const data = await res.json().catch(() => ({}));
    return { success: res.ok, data };
  } catch (err: any) {
    console.error('Tombstone results error:', err?.message);
    return { success: false, data: null };
  }
}

export function extractAdsFromResults(results: any): { ads: any[]; seoData: any; postingPlan: any } {
  const tasks = Array.isArray(results) ? results : results?.tasks ?? results?.data ?? [];
  const ads: any[] = [];
  let seoData: any = null;
  let postingPlan: any = null;

  for (const task of (tasks ?? [])) {
    const output = task?.output ?? task?.result ?? task?.data ?? {};
    if (typeof output === 'string') {
      try {
        const parsed = JSON.parse(output);
        if (parsed?.ads) ads.push(...(parsed.ads ?? []));
        if (parsed?.seo) seoData = parsed.seo;
        if (parsed?.posting_plan ?? parsed?.postingPlan) postingPlan = parsed.posting_plan ?? parsed.postingPlan;
      } catch {
        // Check for ad-like content in text
        if (task?.type?.includes?.('hopkins') || task?.name?.includes?.('ad') || task?.name?.includes?.('post')) {
          ads.push({ caption: output, imageUrl: null, headline: task?.name ?? 'Ad' });
        }
      }
    } else {
      if (output?.ads) ads.push(...(output.ads ?? []));
      if (output?.ad) ads.push(output.ad);
      if (output?.seo) seoData = output.seo;
      if (output?.posting_plan ?? output?.postingPlan) postingPlan = output.posting_plan ?? output.postingPlan;
      if (output?.caption || output?.image_url || output?.text) {
        ads.push({
          caption: output.caption ?? output.text ?? '',
          imageUrl: output.image_url ?? output.imageUrl ?? null,
          headline: output.headline ?? output.title ?? 'Ad',
        });
      }
    }
  }

  return { ads: ads.slice(0, 3), seoData, postingPlan };
}
