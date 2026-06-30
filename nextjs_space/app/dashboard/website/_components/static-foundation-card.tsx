'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Layers, Lock } from 'lucide-react';

/**
 * Phase 2 placeholder. Surfaces that the static-first site generation
 * foundation is installed and shows the default deployment target. Deployment
 * is intentionally disabled in this phase (dry-run only), so the action button
 * is non-functional/disabled.
 */
export default function StaticFoundationCard() {
  const defaultTarget = 'hostgator_static';
  const supportedTargets = [
    'hostgator_static',
    'cloudflare_pages',
    'vercel',
    'wordpress_export',
    'manual_export',
  ];

  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-indigo-600" />
            <CardTitle className="text-lg">Static-first site generation foundation installed</CardTitle>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Lock className="h-3 w-3" />
            Preview
          </Badge>
        </div>
        <CardDescription>
          The platform-neutral site blueprint, static package renderer, and deployment
          adapters are in place. Live deployment is disabled in this phase (dry-run only).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">Default deployment target:</span>
          <Badge className="bg-indigo-600 hover:bg-indigo-600">{defaultTarget}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500">Supported targets:</span>
          {supportedTargets.map((t) => (
            <Badge key={t} variant="outline" className="font-normal">
              {t}
            </Badge>
          ))}
        </div>
        <Button disabled variant="outline" title="Deployment is disabled in this phase">
          <Lock className="mr-2 h-4 w-4" />
          Deploy (disabled — dry-run only)
        </Button>
      </CardContent>
    </Card>
  );
}
