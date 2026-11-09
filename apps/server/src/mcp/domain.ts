import type { McpTool } from '@clew/contracts';

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
