import { expect, test } from 'bun:test';
import { requireFixtureDevelopment } from '../../scripts/fixture-development';
test('fixture tooling requires an explicit nonproduction development environment', () => {
  expect(() => requireFixtureDevelopment({})).toThrow('CLEW_POC');
  expect(() => requireFixtureDevelopment({ CLEW_POC: 'true', NODE_ENV: 'production' })).toThrow('production');
  expect(() => requireFixtureDevelopment({ CLEW_POC: 'true' })).not.toThrow();
});
