/**
 * Phase 3 — deployment target constants (frontend mirror of the backend
 * adapter registry). Platform-neutral; the default static target is HostGator
 * static hosting. Live deploy is globally disabled this phase.
 */

export const DEPLOYMENT_TARGET_TYPES = [
  'hostgator_static',
  'cloudflare_pages',
  'vercel',
  'wordpress_export',
  'manual_export',
] as const;

export type DeploymentTargetType = (typeof DEPLOYMENT_TARGET_TYPES)[number];

export const DEFAULT_DEPLOYMENT_TARGET: DeploymentTargetType = 'hostgator_static';

export const LIVE_DEPLOY_ENABLED = false;
