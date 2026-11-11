import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DefaultTheme } from 'vitepress';

type Item = DefaultTheme.SidebarItem;

/**
 * The sidebar is drawn from `docs/` at build time, so a new document or decision appears without editing the site.
 * A document's label is its first heading; a folder's order is the order its README links to its documents.
 */
export function navigation(docsDir: string, isPage: (path: string) => boolean) {
  const read = (path: string) => readFileSync(join(docsDir, path), 'utf8');
  /** The sidebar renders labels as HTML: keep the words of the heading, drop its Markdown and escape the rest. */
  const label = (path: string) =>
    (read(path).match(/^# (.+)$/m)?.[1] ?? path)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replaceAll('`', '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;');
  const link = (path: string) => '/' + path.replace(/(^|\/)README\.md$/, '$1').replace(/\.md$/, '');
  const item = (path: string): Item => ({ text: label(path), link: link(path) });

  function documents(folder: string): string[] {
    const prefix = folder ? folder + '/' : '';
    const names = readdirSync(join(docsDir, folder)).filter(
      name => name.endsWith('.md') && name !== 'README.md' && isPage(prefix + name),
    );
    const readme = existsSync(join(docsDir, prefix + 'README.md')) ? read(prefix + 'README.md') : '';
    const linked = [...readme.matchAll(/\]\((?:\.\/)?([\w.-]+\.md)[#)]/g)].map(match => match[1]);
    const rank = (name: string) => (linked.includes(name) ? linked.indexOf(name) : linked.length);
    return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map(name => prefix + name);
  }
  const section = (text: string, folder: string): Item => ({
    text,
    link: `/${folder}/`,
    collapsed: false,
    items: documents(folder).map(item),
  });

  const status = documents('reference/status');
  const general: Item[] = [
    { text: 'Clew', items: [{ text: 'Start here', link: '/' }, ...documents('').map(item)] },
    section('Architecture', 'architecture'),
    section('Guides', 'guides'),
    {
      text: 'Reference',
      collapsed: false,
      items: [
        ...documents('reference').map(path =>
          path === 'reference/status.md' ? { ...item(path), collapsed: true, items: status.map(item) } : item(path),
        ),
        { text: 'Generated references', link: '/generated/', collapsed: true, items: documents('generated').map(item) },
      ],
    },
    section('Maintainers', 'maintainers'),
  ];

  /** The same reading of a record as scripts/docs.ts: the standing is the first word of its status. */
  const field = (source: string, name: string) =>
    source
      .replaceAll('**', '')
      .match(new RegExp(`(?:^| · )${name}:\\s*([^\\n·]+)`, 'm'))?.[1]
      ?.trim() ?? '';
  const records = readdirSync(join(docsDir, 'decisions'))
    .filter(name => /^D\d+-.+\.md$/.test(name))
    .map(name => {
      const source = read(`decisions/${name}`);
      return {
        path: `decisions/${name}`,
        number: Number(name.match(/^D(\d+)/)![1]),
        standing:
          field(source, 'Status')
            .toLowerCase()
            .match(/^[a-z]+/)?.[0] ?? '',
        area: field(source, 'Area').split(',')[0]!.trim().toLowerCase(),
      };
    })
    .sort((a, b) => a.number - b.number || a.path.localeCompare(b.path));
  const group = (text: string, members: typeof records): Item[] =>
    members.length
      ? [{ text: `${text} (${members.length})`, collapsed: true, items: members.map(r => item(r.path)) }]
      : [];
  const inForce = records.filter(r => r.standing === 'accepted' || r.standing === 'provisional');
  const areas = ['product', 'integrations', 'identity', 'platform', 'ui'];
  const areaNames: Record<string, string> = { ui: 'Interface' };
  const decisions: Item[] = [
    {
      text: 'Decisions',
      items: [
        { text: 'In force, one line each', link: '/decisions/in-force' },
        { text: 'Every record', link: '/decisions/' },
      ],
    },
    ...[...areas, ...[...new Set(inForce.map(r => r.area))].filter(area => !areas.includes(area)).sort()].flatMap(
      area =>
        group(
          `In force · ${areaNames[area] ?? area[0]!.toUpperCase() + area.slice(1)}`,
          inForce.filter(r => r.area === area),
        ),
    ),
    ...group(
      'Proposed',
      records.filter(r => r.standing === 'proposed'),
    ),
    ...group(
      'Superseded or withdrawn',
      records.filter(r => r.standing === 'superseded' || r.standing === 'withdrawn'),
    ),
  ];

  const nav: DefaultTheme.NavItem[] = [
    { text: 'Overview', link: '/overview' },
    { text: 'Architecture', link: '/architecture/', activeMatch: '^/architecture/' },
    { text: 'Guides', link: '/guides/', activeMatch: '^/guides/' },
    { text: 'Reference', link: '/reference/status', activeMatch: '^/(reference|generated)/' },
    { text: 'Decisions', link: '/decisions/in-force', activeMatch: '^/decisions/' },
    { text: 'Maintainers', link: '/maintainers/', activeMatch: '^/maintainers/' },
  ];
  return { nav, sidebar: { '/decisions/': decisions, '/': general } satisfies DefaultTheme.Sidebar };
}
