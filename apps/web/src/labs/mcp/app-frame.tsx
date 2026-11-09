import { useEffect, useRef, useState } from 'react';
import { Text } from '@clew/ui';
import sandbox from './sandbox.html?raw';
import type { McpResult } from '@clew/contracts';

export type ToolResult = McpResult;
export type ToolCall = { name: string; arguments?: Record<string, unknown> };

/** Standard wire messages for the fixture, not a complete MCP Apps host. See D81. */
export function AppFrame({
  title,
  html,
  result,
  call,
}: {
  title: string;
  html: string;
  result: ToolResult;
  call: (params: ToolCall) => Promise<ToolResult>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let initialized = false;
    let inputSent = false;
    setFailed(false);
    const timeout = window.setTimeout(() => setFailed(true), 8000);
    const send = (message: Record<string, unknown>) => {
      if (active) frame.current?.contentWindow?.postMessage({ jsonrpc: '2.0', ...message }, '*');
    };
    const receive = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null' || event.data?.jsonrpc !== '2.0')
        return;
      const message = event.data;
      if (message.method === 'ui/notifications/sandbox-proxy-ready') {
        send({ method: 'ui/notifications/sandbox-resource-ready', params: { html, title } });
      } else if (message.method === 'ui/initialize' && !initialized) {
        initialized = true;
        send({
          id: message.id,
          result: {
            protocolVersion: '2026-01-26',
            hostInfo: { name: 'clew-preview', version: '0.1.0' },
            hostCapabilities: { serverTools: {} },
            hostContext: {
              theme: 'light',
              locale: 'sv-SE',
              displayMode: 'inline',
              containerDimensions: { width: frame.current?.clientWidth ?? 300, maxHeight: 520 },
            },
          },
        });
      } else if (message.method === 'ui/notifications/initialized' && initialized && !inputSent) {
        inputSent = true;
        window.clearTimeout(timeout);
        send({ method: 'ui/notifications/tool-input', params: { arguments: {} } });
        send({ method: 'ui/notifications/tool-result', params: result });
      } else if (message.id !== undefined && message.method) {
        try {
          if (!inputSent || message.method !== 'tools/call' || typeof message.params?.name !== 'string')
            throw new Error('Åtgärden är inte tillåten i den här vyn.');
          send({ id: message.id, result: await call(message.params) });
        } catch (error) {
          send({
            id: message.id,
            error: { code: -32000, message: error instanceof Error ? error.message : 'Tjänsten kunde inte nås.' },
          });
        }
      }
    };
    window.addEventListener('message', receive);
    // A data URL is an opaque origin, including with allow-same-origin. Never use this with a same-origin URL.
    setSrc('data:text/html;charset=utf-8,' + encodeURIComponent(sandbox + '<!-- ' + crypto.randomUUID() + ' -->'));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
  }, [html, result, call, title]);
  if (failed) return <Text role="alert">Tjänstens vy kunde inte öppnas. Stäng den och försök igen.</Text>;
  return (
    <iframe
      ref={frame}
      src={src}
      title={`${title}, isolerad tjänst`}
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="no-referrer"
      width="100%"
      height="520"
    />
  );
}
