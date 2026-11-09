import { serveMock } from '../mcp-http.mjs';
import { createStatusFixture } from './service.mjs';
const service = createStatusFixture();
serveMock(service, 4036, {
  '/fixture/down': () => service.setDown(true),
  '/fixture/up': () => service.setDown(false),
});
