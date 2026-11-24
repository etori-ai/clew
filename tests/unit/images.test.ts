import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * What every image Clew builds or starts must hold to (BL-5 and BL-12 of the review of 2026-11-23), read from the
 * files as licence.test.ts reads the connectors' Dockerfiles: no image is named without its registry and digest, Bun
 * comes from Oven's image and not from npm, and a connector that keeps SQLite in /data can be run by any user in
 * group 0 on a volume another user made.
 */
const root = resolve(import.meta.dirname, '../..');
const SKIP = new Set(['node_modules', '.git', 'dist', '.claude', '.vitepress']);
function files(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : files(path, match);
    return entry.isFile() && match(entry.name) ? [relative(root, join(root, path))] : [];
  });
}
const dockerfiles = files('.', name => name === 'Dockerfile' || name.endsWith('.Dockerfile'));
const composeFiles = files('.', name => /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(name));
const read = (file: string) => readFileSync(join(root, file), 'utf8');
// A registry with a dot in its name (docker.io, quay.io, mcr.microsoft.com), a path, a tag or none, and a digest.
const PINNED = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?\/[a-z0-9._/-]+(:[\w.-]+)?@sha256:[0-9a-f]{64}$/;
// An image Clew builds itself in the development stack, which no registry holds.
const LOCAL = /^clew-[a-z0-9-]+:local$/;

describe('the images Clew builds and starts', () => {
  test('are found where they are kept: the development stack, the two apps and the connectors', () => {
    expect(dockerfiles).toEqual(
      expect.arrayContaining(['.devcontainer/Dockerfile', 'apps/server/Dockerfile', 'connectors/hr/Dockerfile']),
    );
    expect(dockerfiles.length).toBeGreaterThan(20);
    expect(composeFiles).toContain('.devcontainer/compose.yaml');
  });
  test('name every base image and every image a file is copied from with its registry and digest', () => {
    const unpinned: string[] = [];
    for (const file of dockerfiles) {
      const stages = new Set<string>();
      for (const line of read(file).split('\n')) {
        const from = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
        const copy = /^COPY\s+(?:--\S+\s+)*?--from=(\S+)/i.exec(line);
        const image = from?.[1] ?? copy?.[1];
        if (image && !PINNED.test(image) && !stages.has(image)) unpinned.push(`${file}: ${line}`);
        if (from?.[2]) stages.add(from[2]);
      }
    }
    for (const file of composeFiles)
      for (const [line, image] of read(file).matchAll(/^\s*image:\s*["']?([^\s"'#]+)/gm))
        if (!PINNED.test(image!) && !LOCAL.test(image!)) unpinned.push(`${file}: ${line.trim()}`);
    expect(unpinned).toEqual([]);
  });
  test('take Bun from its own image, never from npm', () => {
    const fromNpm = dockerfiles.filter(file =>
      /\b(npm|npx|yarn|pnpm)\b[^\n]*\b(install|add|i)\b[^\n]*\bbun(@|\s|$)/m.test(read(file)),
    );
    expect(fromNpm).toEqual([]);
    // Every image that runs Bun copies the binary from Oven's image, by digest.
    const running = dockerfiles.filter(file => /^RUN\s.*\bbun\b/m.test(read(file)));
    expect(running).toEqual(expect.arrayContaining(['.devcontainer/Dockerfile', 'apps/server/Dockerfile']));
    for (const file of running)
      expect({
        file,
        copied: /^COPY --from=docker\.io\/oven\/bun:[\w.-]+@sha256:[0-9a-f]{64} /m.test(read(file)),
      }).toEqual({ file, copied: true });
  });
  test('keep SQLite in /data so that any user in group 0 writes what another made', () => {
    const withData = dockerfiles.filter(file => /^ENV\s.*\b\w+_DB=\/data\//m.test(read(file)));
    expect(withData.length).toBe(7);
    for (const file of withData) {
      const text = read(file);
      const variable = /^ENV\s.*\b(\w+_DB)=\/data\//m.exec(text)![1];
      const made = text.indexOf('RUN install -d -o node -g 0 -m 2770 /data\n');
      const user = text.indexOf('\nUSER node:0\n');
      // The folder, owned by node and group 0 with the setgid bit, before the image stops being root; node in group 0.
      expect({ file, made: made >= 0, user: user >= 0, before: made < user }).toEqual({
        file,
        made: true,
        user: true,
        before: true,
      });
      // SQLite makes a database 0644 whatever the umask: the command makes it first, group-writable, then starts Node.
      expect({ file, command: /^CMD .*$/m.exec(text)![0] }).toEqual({
        file,
        command: `CMD ["sh", "-c", "umask 002 && touch \\"$${variable}\\" && exec node server.mjs"]`,
      });
    }
  });
});
