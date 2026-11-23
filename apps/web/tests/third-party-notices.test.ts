import { describe, expect, test } from 'bun:test';
import { noticesText, packageRoot } from '../third-party-notices';

describe("the web build's third-party notices", () => {
  test('a bundled file is traced to the package folder it comes from, scoped or not, through Bun’s store', () => {
    expect(packageRoot('/app/node_modules/.bun/react@19.3.1/node_modules/react/cjs/react.production.js')).toBe(
      '/app/node_modules/.bun/react@19.3.1/node_modules/react',
    );
    expect(packageRoot('/app/node_modules/@fontsource-variable/raleway/wght.css?inline')).toBe(
      '/app/node_modules/@fontsource-variable/raleway',
    );
  });
  test('Clew’s own sources and virtual modules are no third party', () => {
    expect(packageRoot('/app/packages/ui/src/index.tsx')).toBeUndefined();
    expect(packageRoot('\0vite/preload-helper.js')).toBeUndefined();
    expect(packageRoot('/app/node_modules/react')).toBeUndefined();
  });
  test('the notice names Clew’s licence, then each package with its licence text, or says it carries none', () => {
    const text = noticesText([
      { name: 'a', version: '1.0.0', license: 'MIT', notices: [{ file: 'LICENSE', text: 'MIT License …' }] },
      { name: 'b', version: '2.0.0', license: 'MIT', notices: [] },
    ]);
    expect(text).toContain('GNU Affero General Public License v3.0');
    expect(text).toContain('a 1.0.0 (MIT)\n');
    expect(text).toContain('--- LICENSE\n\nMIT License …');
    expect(text).toContain('b 2.0.0 (MIT)\n');
    expect(text).toContain('The package carries no licence file. It declares: MIT.');
  });
});
