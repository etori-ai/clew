import { createProvider } from '../model';
import type { ModelProvider } from '../ports';

/**
 * The live model provider: configured from the environment (`AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`), available while
 * the last generation or probe succeeded. The probe asks `{baseURL}/models` every minute; any 2xx counts as reachable.
 * D24 moves the configuration into the product; this adapter is what it will replace.
 */
export function liveModelProvider(env: Record<string, string | undefined> = process.env): ModelProvider & { probe(): Promise<void>; startProbe(intervalMs?: number): void } {
  const provider = createProvider(env);
  const state: { available: boolean; checkedAt: string | null } = { available: false, checkedAt: null };
  const adapter = {
    status: () => ({ configured: !!provider, available: !!provider && state.available, model: provider?.model ?? null, checkedAt: state.checkedAt }),
    generate: provider?.generate,
    markAvailable() { state.available = true; state.checkedAt = new Date().toISOString(); },
    markUnavailable() { state.available = false; state.checkedAt = new Date().toISOString(); },
    async probe() {
      if (!provider) return;
      try {
        const response = await fetch(provider.baseURL.replace(/\/$/, '') + '/models', { headers: provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}, signal: AbortSignal.timeout(3_000) });
        if (response.ok) adapter.markAvailable(); else adapter.markUnavailable();
      } catch { adapter.markUnavailable(); }
    },
    startProbe(intervalMs = 60_000) {
      if (!provider) return;
      void adapter.probe();
      const timer = setInterval(() => void adapter.probe(), intervalMs);
      timer.unref?.();
    },
  };
  return adapter;
}
