'use client';

import { useEffect, useState } from 'react';
import { Bot, Clock, Activity } from 'lucide-react';

interface AgentUsageSummary {
  agentTypes: string[];
  lastUsed: string | null;
  totalUses: number;
  recentLogs: Array<{
    id: string;
    agentType: string;
    intendedUse: string;
    workflowId?: string;
    createdAt: string;
  }>;
}

const AGENT_LABELS: Record<string, string> = {
  website: 'Website Generation',
  seo: 'SEO Content',
  social: 'Social Posts',
  video: 'Video / Reels',
  community_engagement: 'Community Engagement',
};

const AGENT_COLORS: Record<string, string> = {
  website: 'bg-blue-100 text-blue-700',
  seo: 'bg-green-100 text-green-700',
  social: 'bg-purple-100 text-purple-700',
  video: 'bg-orange-100 text-orange-700',
  community_engagement: 'bg-teal-100 text-teal-700',
};

export default function AssetAgentUsage({ assetId }: { assetId: string }) {
  const [data, setData] = useState<AgentUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!assetId) return;
    fetch(`/api/agent-assets/usage?assetId=${assetId}&summary=true`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [assetId]);

  if (loading) {
    return (
      <div className="mt-4 p-3 bg-gray-50 rounded-lg animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
        <div className="h-3 bg-gray-200 rounded w-48" />
      </div>
    );
  }

  if (!data || data.totalUses === 0) {
    return (
      <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Bot className="w-4 h-4" />
          <span>Not yet used by any agent workflow</span>
        </div>
      </div>
    );
  }

  const lastUsedDate = data.lastUsed
    ? new Date(data.lastUsed).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  return (
    <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <Bot className="w-4 h-4 text-blue-600" />
        <span className="text-sm font-medium text-gray-700">Used by agents</span>
        <span className="text-xs text-gray-400 ml-auto">
          {data.totalUses} use{data.totalUses !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {data.agentTypes.map(agent => (
          <span
            key={agent}
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              AGENT_COLORS[agent] || 'bg-gray-100 text-gray-700'
            }`}
          >
            {AGENT_LABELS[agent] || agent}
          </span>
        ))}
      </div>

      {lastUsedDate && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Clock className="w-3 h-3" />
          <span>Last used: {lastUsedDate}</span>
        </div>
      )}

      {data.recentLogs.length > 0 && (
        <div className="mt-2 space-y-1">
          {data.recentLogs.slice(0, 3).map(log => (
            <div key={log.id} className="flex items-center gap-1.5 text-xs text-gray-400">
              <Activity className="w-3 h-3" />
              <span>{AGENT_LABELS[log.agentType] || log.agentType}</span>
              <span>·</span>
              <span>
                {new Date(log.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
