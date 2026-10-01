/**
 * Topology provider list, same rule as the dashboard (UsageStats.js):
 * active LLM connections deduplicated by provider, plus free no-auth
 * providers. Pure — no `vscode` imports.
 */
import { ProviderConnection } from '../dashboard/types';
import { PROVIDER_META, providerMeta } from './providerMeta';

export interface TopologyProviderBase {
  provider: string;
  name: string;
  color: string;
  textIcon: string;
}

export function buildTopologyProviders(connections: readonly ProviderConnection[]): TopologyProviderBase[] {
  const seen = new Set<string>();
  const out: TopologyProviderBase[] = [];
  const add = (provider: string) => {
    const meta = providerMeta(provider);
    out.push({
      provider,
      name: meta.name,
      color: meta.color,
      textIcon: meta.textIcon ?? provider.slice(0, 2).toUpperCase(),
    });
  };
  for (const c of connections) {
    if (c.isActive === false || seen.has(c.provider) || PROVIDER_META[c.provider]?.llm === false) {
      continue;
    }
    seen.add(c.provider);
    add(c.provider);
  }
  for (const [id, meta] of Object.entries(PROVIDER_META)) {
    if (meta.freeNoAuth && meta.llm !== false && !seen.has(id)) {
      seen.add(id);
      add(id);
    }
  }
  return out;
}
