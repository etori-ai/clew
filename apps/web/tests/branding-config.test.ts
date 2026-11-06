import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import type { Branding } from '../../../packages/ui/src/branding';
import { a11yBrandProfile, brandingFixtures, type A11yBrandProfile } from '../../../tests/a11y/branding-fixtures';
import { a11yWebConfig } from '../../../tests/a11y/vite.config';

const profiles: A11yBrandProfile[] = ['sundsvall', 'neutral', 'custom'];
const environmentKeys = [
  'VITE_BRAND_PROFILE',
  'VITE_BRAND_ACCENT',
  'VITE_BRAND_ACCENT_MUTED',
  'VITE_HEADER_LOGO_SRC',
  'VITE_HEADER_LOGO_ALT',
  'VITE_HEADER_LOGO_DARK_SRC',
] as const;

describe('browser-test branding isolation', () => {
  for (const profile of profiles)
    test(`${profile} reaches the actual browser branding entry despite conflicting operator values`, async () => {
      const previous = environmentKeys.map(key => [key, process.env[key]] as const);
      const previousNodeEnv = process.env.NODE_ENV;
      const directory = await mkdtemp(resolve(tmpdir(), 'clew-branding-test-'));
      try {
        for (const key of environmentKeys) process.env[key] = 'invalid-operator-value';
        await writeFile(
          resolve(directory, '.env.local'),
          environmentKeys.map(key => `${key}=invalid-local-file-value`).join('\n'),
        );
        const config = a11yWebConfig(profile);
        expect(config.envDir).toBe(false);
        const built = await build({
          ...config,
          root: directory,
          configFile: false,
          publicDir: false,
          logLevel: 'silent',
          build: {
            write: false,
            emptyOutDir: false,
            minify: false,
            lib: { entry: resolve(import.meta.dirname, '../src/branding.ts'), formats: ['es'], fileName: 'branding' },
          },
        });
        const outputs = Array.isArray(built) ? built : [built];
        expect(outputs).toHaveLength(1);
        const output = outputs[0];
        if (!output || !('output' in output)) throw new Error('Expected one isolated branding bundle');
        const entry = output.output.find(file => file.type === 'chunk');
        if (!entry) throw new Error('The isolated branding entry was not produced');
        const source = entry.code;
        const file = resolve(directory, 'branding.mjs');
        await writeFile(file, source);
        const module: { branding: Branding } = await import(pathToFileURL(file).href);
        expect(module.branding).toEqual(brandingFixtures[profile].expected);
        expect(source).not.toContain('invalid-operator-value');
        expect(source).not.toContain('invalid-local-file-value');
      } finally {
        for (const [key, value] of previous) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        await rm(directory, { recursive: true, force: true });
      }
    });

  test('the runner defaults to Neutral and rejects unknown fixture names', () => {
    expect(a11yBrandProfile(undefined)).toBe('neutral');
    expect(() => a11yBrandProfile('unknown')).toThrow('CLEW_A11Y_BRAND_PROFILE');
  });
});
