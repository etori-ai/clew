import type { IncomingMessage, ServerResponse } from 'node:http';
export declare const BODY_LIMIT: number;
export declare function listener(
  handle: (request: Request) => Promise<Response>,
  options?: { limit?: number; log?: (name: unknown) => void },
): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
