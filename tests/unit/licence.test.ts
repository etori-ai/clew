import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** What D143 says every part of Clew carries: the AGPL's text, and the licence named in each package. */
const root = resolve(import.meta.dirname, '../..');
const licence = readFileSync(join(root, 'LICENSE'), 'utf8');
const folders = (dir: string) =>
  readdirSync(join(root, dir), { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => join(dir, e.name));

describe("Clew's licence (D143)", () => {
  test('is the AGPL v3', () => {
    expect(licence).toStartWith(
      '                    GNU AFFERO GENERAL PUBLIC LICENSE\n                       Version 3',
    );
  });
  test('travels into every connector image: each folder with a Dockerfile holds the same text and copies it', () => {
    const built = folders('connectors').filter(d => existsSync(join(root, d, 'Dockerfile')));
    expect(built.length).toBeGreaterThan(0);
    for (const dir of built) {
      expect({ dir, same: readFileSync(join(root, dir, 'LICENSE'), 'utf8') === licence }).toEqual({ dir, same: true });
      expect(readFileSync(join(root, dir, 'Dockerfile'), 'utf8')).toMatch(/^COPY LICENSE /m);
    }
  });
  test('is declared by every named package of Clew', () => {
    const manifests = ['.', 'site', ...folders('apps'), ...folders('packages')]
      .map(d => join(root, d, 'package.json'))
      .filter(existsSync)
      .map(file => ({ file, json: JSON.parse(readFileSync(file, 'utf8')) as { name?: string; license?: string } }))
      .filter(m => m.json.name);
    expect(manifests.length).toBe(11);
    for (const m of manifests)
      expect({ file: m.file, license: m.json.license }).toEqual({ file: m.file, license: 'AGPL-3.0-only' });
  });
});
