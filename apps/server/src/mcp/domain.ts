import type { McpTool, McpWatch, McpResult } from '@clew/contracts';

export function atPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) return undefined;
  return pointer
    .slice(1)
    .split('/')
    .reduce<unknown>((current, segment) => {
      const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
      return current && typeof current === 'object' && Object.hasOwn(current, key)
        ? (current as Record<string, unknown>)[key]
        : undefined;
    }, value);
}
export function appUri(tool: McpTool): string | undefined {
  const ui = tool._meta?.ui as { resourceUri?: unknown } | undefined;
  const uri = ui?.resourceUri ?? tool._meta?.['ui/resourceUri'];
  return typeof uri === 'string' && uri.startsWith('ui://') ? uri : undefined;
}

/** A missing/error field is not evidence that attention has ended. */
export function watchEvidence(watch: McpWatch, result: McpResult) {
  if (result.isError || !result.structuredContent) return undefined;
  const identity = watch.identity.map(pointer => atPointer(result.structuredContent, pointer));
  if (!identity.length || identity.some(value => value === undefined)) return undefined;
  const condition = watch.condition ? atPointer(result.structuredContent, watch.condition.pointer) : true;
  if (condition === undefined) return undefined;
  return {
    identity,
    eligible: !watch.condition || JSON.stringify(condition) === JSON.stringify(watch.condition.equals),
  };
}
