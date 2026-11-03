import type { AssistantStatus } from '@clew/contracts';
import { createProvider } from './model';

/**
 * The provider's health is a first-class status (D8): configured from the environment, available while the last
 * generation or probe succeeded. A failed generation flips it at once; the probe brings it back.
 */
let provider: ReturnType<typeof createProvider> | undefined;
let loaded = false;
const state: { available: boolean; checkedAt: string | null } = { available: false, checkedAt: null };
export function providerOf() {
  if (!loaded) { provider = createProvider(); loaded = true; }
  return provider;
}
export function providerStatus(): AssistantStatus {
  const p = providerOf();
  return { configured: !!p, available: !!p && state.available, model: p?.model ?? null, checkedAt: state.checkedAt };
}
export const markAvailable = () => { state.available = true; state.checkedAt = new Date().toISOString(); };
export const markUnavailable = () => { state.available = false; state.checkedAt = new Date().toISOString(); };
/** GET {baseURL}/models every minute; any 2xx counts as reachable. */
export async function probe() {
  const p = providerOf();
  if (!p) return;
  try {
    const response = await fetch(p.baseURL.replace(/\/$/, '') + '/models', { headers: p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}, signal: AbortSignal.timeout(3_000) });
    if (response.ok) markAvailable(); else markUnavailable();
  } catch { markUnavailable(); }
}
export function startAssistantProbe(intervalMs = 60_000) {
  if (!providerOf()) return;
  void probe();
  const timer = setInterval(() => void probe(), intervalMs);
  timer.unref?.();
}
