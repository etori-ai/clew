import { expect, test } from 'bun:test';
import { allExtensions } from 'dependency-cruiser';

/**
 * The backend structure rules (D20, `bun run deps`) only judge what dependency-cruiser can parse, and a file it cannot
 * parse is skipped without a word. TypeScript 7 gives it no compiler, so it reads TypeScript through `@swc/core`;
 * when that package left the lockfile with another dependency on 2026-11-09, the rules passed over 80 JavaScript
 * modules and none of the TypeScript. This fails instead.
 */
test('the dependency rules can read TypeScript', () => {
  const readable = allExtensions.filter(e => e.available).map(e => e.extension);
  expect(readable).toContain('.ts');
  expect(readable).toContain('.tsx');
});
