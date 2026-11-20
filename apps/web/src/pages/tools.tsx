import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { MenuEntry, SessionUser } from '@clew/contracts';
import {
  Button,
  ClickableCard,
  Divider,
  EmptyState,
  Grid,
  Heading,
  HStack,
  Icon,
  Link,
  StackItem,
  Text,
  TextInput,
  VStack,
  clewIcon,
  useAnnounce,
  useMediaQuery,
} from '@clew/ui';
import { areasQuery, headerQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { narrowTools, toolboxPage, toolGroups, toolsOf, whatItIs } from '../tool-catalogue';
import { Shell, shortQuery } from '../components/shell/shell';
import { toolHref, useNav } from '../components/shell/nav';
import { AsyncContent, ContentSkeleton } from '../components/shell/loading';
import { PageFrame } from '../components/shell/page-frame';
import { pageSubject } from '../components/conversation/page-conversation';

/** The search field's words in the address (D43): the narrowed catalogue survives a reload and Back. */
const FILTER = 'filter';
const EMPTY_MENU: MenuEntry[] = [];
/** "1 verktyg", "3 verktyg": the word is the same in both numbers. */
const counted = (n: number) => `${n} verktyg`;

/** One tool as a tile (the `library` template's card): its icon, its name, what it is and its system, the tile its link. */
function ToolTile({ tool, from }: { tool: MenuEntry; from: string }) {
  const what = whatItIs(tool);
  return (
    <ClickableCard label={tool.label} href={toolHref(tool.capability, from)} padding={4} height="100%">
      <HStack gap={3} vAlign="start">
        <Icon icon={clewIcon[tool.icon]} size="lg" color="secondary" />
        <StackItem size="fill">
          <VStack gap={1}>
            <Heading level={3}>{tool.label}</Heading>
            {what && (
              <Text type="body" size="sm" color="secondary">
                {what}
              </Text>
            )}
            <Text type="supporting" color="secondary">
              {tool.source}
            </Text>
          </VStack>
        </StackItem>
      </HStack>
    </ClickableCard>
  );
}

/**
 * Alla verktyg (D126 rule 7, the `library` template): every tool the person may open, where the rail's first few end.
 * The title and how many there are, a search field that narrows the tiles in place (its words in the address, the count
 * said aloud as it changes), then the tools as uniform tiles in sections by the system they belong to (`toolGroups`).
 * A tile leads to the tool's own page (D42) with this page as the way back, so Back returns to the tile. At the foot the
 * intranet's own page of tools, when the shared header names one (D88, D112 amended 2026-11-11). The tools are what the
 * rail reads (`toolsOf`): the views an administrator placed (D40) and Clew's own lists the person has; nothing else is
 * asked of the server. The corner's "Fråga AI" opens the assistant's pane beside the tiles (D135, D138), about the
 * person's tools (`clew.tools`).
 */
export function ToolsPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  // 1.4.10: with 480 px or less in height nothing is pinned; the whole page scrolls.
  const short = useMediaQuery(shortQuery);
  const nav = useNav({ current: { surface: 'tools' }, admin, manager: user.role === 'manager' });
  usePageTitle('Alla verktyg');
  const navigate = useNavigate();
  const { pathname, search: address } = useLocation();
  const [search] = useSearchParams();
  const typed = search.get(FILTER) ?? '';
  const read = useQuery(areasQuery);
  const header = useQuery(headerQuery).data;
  const all = useMemo(() => toolsOf(read.data?.menu ?? EMPTY_MENU, read.data?.areas ?? []), [read.data]);
  const shown = useMemo(() => narrowTools(all, typed), [all, typed]);
  const groups = useMemo(() => toolGroups(shown, read.data?.systems), [shown, read.data?.systems]);
  const more = toolboxPage(header);
  const here = pathname + address;
  const narrow = (value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(FILTER, value);
    else next.delete(FILTER);
    const q = next.toString();
    navigate(q ? `${pathname}?${q}` : pathname, { replace: true });
  };
  // The tiles change in place under the field: how many are left is said as one message, the latest (4.1.3).
  const announce = useAnnounce({ hasReplace: true });
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!read.data) return;
    if (said.current !== null && said.current !== typed)
      announce(shown.length === 0 ? 'Inget verktyg matchar sökningen' : counted(shown.length));
    said.current = typed;
  }, [typed, shown.length, !!read.data, announce]);
  // "Rensa sökningen" leaves with the empty state it stands in: the focus goes to the field it emptied (2.4.3).
  const field = useRef<HTMLInputElement>(null);
  const clear = () => {
    narrow('');
    field.current?.focus();
  };
  const failed = read.isError && !read.data;
  // What the pane beside the page is about (D135 rule 4): the person's tools, as the assistant reads them.
  const subject = pageSubject({
    key: 'tools',
    title: 'Alla verktyg',
    reads: [{ capability: 'clew.tools', own: true, label: 'Alla verktyg' }],
    views: read.data?.views,
  });
  const tiles = failed ? (
    <VStack gap={2}>
      <Text as="p" role="alert">
        {errorMessage(read.error, 'Verktygen kunde inte hämtas just nu.')}
      </Text>
      <HStack>
        <Button
          size="sm"
          variant="secondary"
          label="Försök igen"
          isLoading={read.isFetching}
          onClick={() => void read.refetch()}
        />
      </HStack>
    </VStack>
  ) : all.length === 0 ? (
    <EmptyState
      headingLevel={2}
      title="Inga verktyg för dig än"
      description="En administratör väljer vilka vyer från de anslutna systemen som är verktyg. De som är valda för dig finns här."
    />
  ) : shown.length === 0 ? (
    <EmptyState
      headingLevel={2}
      icon={<Icon icon="search" size="lg" color="secondary" />}
      title="Inget verktyg matchar sökningen"
      description={`Inget verktyg har ”${typed.trim()}” i sitt namn, i vad det är eller i systemets namn.`}
      actions={<Button label="Rensa sökningen" variant="secondary" onClick={clear} />}
    />
  ) : (
    <VStack gap={6}>
      {groups.map(group => (
        <VStack key={group.connector} gap={6}>
          <Divider />
          <VStack gap={4} as="section" aria-labelledby={`verktyg-${group.connector}`}>
            <Heading id={`verktyg-${group.connector}`} level={2}>
              {group.source}
            </Heading>
            <Grid columns={{ minWidth: 320, max: 4 }} gap={4}>
              {group.tools.map(tool => (
                <ToolTile key={tool.capability} tool={tool} from={here} />
              ))}
            </Grid>
          </VStack>
        </VStack>
      ))}
    </VStack>
  );
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <PageFrame
        ask={{ subject }}
        cards
        title="Alla verktyg"
        meta={
          read.data && all.length > 0
            ? typed.trim()
              ? `${shown.length} av ${counted(all.length)}`
              : counted(all.length)
            : undefined
        }
        label="Alla verktyg"
      >
        <VStack gap={6}>
          {all.length > 0 && (
            <TextInput
              ref={field}
              type="search"
              enterKeyHint="search"
              label="Sök bland verktygen"
              isLabelHidden
              placeholder="Sök bland verktygen"
              startIcon="search"
              size="lg"
              hasClear
              value={typed}
              onChange={narrow}
            />
          )}
          <AsyncContent
            pending={read.isPending}
            fallback={<ContentSkeleton label="Hämtar verktygen …" rows={3} heading={false} />}
          >
            {tiles}
          </AsyncContent>
          {/* The intranet's own page of tools, at the foot, in a new tab: Clew never makes up the address. */}
          {more && (
            <VStack gap={4}>
              <Divider />
              <Text type="supporting">
                <Link href={more.href} isExternalLink hasUnderline>
                  Fler verktyg på intranätet
                </Link>
              </Text>
            </VStack>
          )}
        </VStack>
      </PageFrame>
    </Shell>
  );
}
