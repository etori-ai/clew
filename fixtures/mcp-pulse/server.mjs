import { readFile } from 'node:fs/promises';
import { serveMock } from '../mcp-http.mjs';
import { createPulseService } from './service.mjs';
const service = createPulseService(await readFile(new URL('./poll.html', import.meta.url), 'utf8'));
serveMock(service, 4035, { '/fixture/next-week': () => service.nextWeek() });
