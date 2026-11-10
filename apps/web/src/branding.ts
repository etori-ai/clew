import { useSyncExternalStore } from 'react';
import { NEUTRAL_BRANDING, readBranding, type Branding } from '@clew/ui/branding';

/**
 * The installation's appearance in the browser (D97). It is read from `GET /api/appearance`, which is public, because
 * the sign-in page is drawn with it. A copy is kept in the browser so that the next visit is drawn in the right colours
 * from its first frame; the copy is colours, a name and the logo's address, nothing about a person, and it is read back
 * through `readBranding`, which drops anything that is not a known colour token or a same-origin logo.
 *
 * A first visit has no copy and waits a moment for the answer rather than drawing Neutral and then changing colour;
 * if the answer does not come the page is Neutral (D46) and corrects itself when it does.
 */
const KEY = 'clew:appearance';
const FIRST_VISIT_WAIT_MS = 1500;
const listeners = new Set<() => void>();
let current: Branding = NEUTRAL_BRANDING;

function kept(): Branding | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? readBranding(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}
/** The appearance to draw from now on: what the server answered, or what an administrator just saved. */
export function setBranding(value: unknown) {
  const next = readBranding(value);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* A browser that keeps nothing asks again on the next visit. */
  }
  for (const listener of listeners) listener();
}
async function refresh(signal?: AbortSignal) {
  const response = await fetch('/api/appearance', { ...(signal ? { signal } : {}) });
  if (response.ok) setBranding(await response.json());
}
/** Before the first render: the kept copy at once with a fresh read behind it, else the read itself, briefly. */
export async function loadBranding(): Promise<void> {
  const copy = kept();
  if (copy) {
    current = copy;
    void refresh().catch(() => undefined);
    return;
  }
  await refresh(AbortSignal.timeout(FIRST_VISIT_WAIT_MS)).catch(() => {
    void refresh().catch(() => undefined);
  });
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useBranding = () => useSyncExternalStore(subscribe, () => current);
