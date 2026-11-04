import type { ModelProvider } from '../ports';

/** A provider for tests: `generate` given or absent, availability set by the test. */
export function memoryModelProvider(options: { generate?: ModelProvider['generate']; model?: string; available?: boolean } = {}): ModelProvider & { state: { available: boolean; checkedAt: string | null } } {
  const state = { available: options.available ?? !!options.generate, checkedAt: null as string | null };
  return {
    state,
    status: () => ({ configured: !!options.generate, available: !!options.generate && state.available, model: options.generate ? options.model ?? 'test-model' : null, checkedAt: state.checkedAt }),
    generate: options.generate,
    markAvailable() { state.available = true; state.checkedAt = 'marked'; },
    markUnavailable() { state.available = false; state.checkedAt = 'marked'; },
  };
}
