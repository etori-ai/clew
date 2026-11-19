import type { KeyboardEvent, ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Avatar,
  EmptyState,
  Heading,
  HStack,
  Icon,
  IconButton,
  Link,
  StackItem,
  Text,
  VStack,
  VisuallyHidden,
  XMarkIcon,
} from '@clew/ui';
import { ApiError } from '../api';
import { entityDetailQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { NEEDS_YOU, personPageHref, unitPageHref } from '../person-address';
import { paneTabHref, type EntitySubjectKind } from '../conversation-about';
import { ContentSkeleton } from '../components/shell/loading';
import { PageSection, ThingTabs } from '../components/people/entity-page';
import {
  NeedsYouRows,
  PersonSourceBody,
  SourceBadge,
  UnitSourceBody,
  drawnSections,
  useSectionAnswers,
} from '../components/people/entity-sections';
import { OVERVIEW, OverviewSection, entityTabs, nameLine } from './person';

/** A source's fuller read is never a table in the pane: its 440 px hold it as a list. */
const NO_TABLE = '(min-width: 99999px)';

/**
 * The person or the unit a conversation is about, beside the transcript (D126 rule 2: the pane draws the same parts as
 * the page; the product owner, 2026-11-14: one conversation per person, not one per tab). At the top the person's
 * avatar, their name as the link to their page (at the tab the pane shows) and the line under it; then the page's own
 * tabs, small, each a link that changes only the pane's tab in the conversation's address (`section`), so a reload and
 * Back keep it and the conversation and what it is about stay as they are; then the tab's read as the page draws it,
 * a level down. Only the reads: the actions that write, the talk's and the dialogue's own work and the reader's own
 * Kompetens and Introduktion stay on the page. ✕ lets go of the person; the conversation stays.
 */
export function EntityPane({
  kind,
  entityKey,
  tab: wanted,
  onClose,
  onKeyDown,
}: {
  kind: EntitySubjectKind;
  entityKey: string;
  /** The tab the address names (`section`); Översikt when it names none, or one the pane does not have. */
  tab: string | null;
  onClose: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}) {
  const { pathname, search } = useLocation();
  const here = pathname + search;
  const read = useQuery(entityDetailQuery(kind, entityKey));
  const detail = read.data;
  const answers = useSectionAnswers(detail?.entity.key, detail?.sections ?? [], kind);
  const drawn = drawnSections(answers);
  const tabs = detail ? entityTabs(detail, drawn) : [];
  // A source still on its way keeps the tab the address names, so the pane is on it when the source answers.
  const pending = answers.some(a => a.source.capability === wanted && a.query.isPending);
  const tab = wanted && (tabs.some(t => t.value === wanted) || pending) ? wanted : OVERVIEW;
  const tabHref = (value: string) => paneTabHref(pathname, search, value === OVERVIEW ? null : value);
  const close = (
    <IconButton label="Stäng" variant="ghost" icon={<Icon icon={XMarkIcon} size="sm" />} onClick={onClose} />
  );
  if (!detail) {
    const missing = read.isError && read.error instanceof ApiError && read.error.status === 404;
    return (
      <VStack gap={4} padding={6} onKeyDown={onKeyDown}>
        <HStack justify="end">{close}</HStack>
        {missing ? (
          <EmptyState
            isCompact
            headingLevel={2}
            title={kind === 'person' ? 'Personen finns inte' : 'Enheten finns inte'}
            description="Du kanske inte har tillgång till uppgifterna längre."
          />
        ) : read.isError ? (
          <Text as="p" role="alert">
            {errorMessage(read.error, 'Uppgifterna kunde inte hämtas just nu.')}
          </Text>
        ) : (
          <ContentSkeleton label={kind === 'person' ? 'Hämtar personen …' : 'Hämtar enheten …'} rows={2} />
        )}
      </VStack>
    );
  }
  const { name } = detail.entity;
  const section = tab === OVERVIEW ? undefined : tab;
  // The name leads to the page at the tab the pane shows, with this conversation as the way back.
  const pageHref =
    kind === 'person'
      ? personPageHref(entityKey, { ...(section ? { section } : {}), from: here })
      : unitPageHref(entityKey, { ...(section ? { section } : {}), from: here });
  const answer = drawn.find(a => a.source.capability === tab);
  let sections: Array<{ key: string; node: ReactNode }>;
  if (tab === NEEDS_YOU)
    sections = [
      {
        key: NEEDS_YOU,
        node: (
          <PageSection title="Ärenden" level={3}>
            <NeedsYouRows cards={detail.cards} />
          </PageSection>
        ),
      },
    ];
  else if (answer)
    sections = [
      {
        key: answer.source.capability,
        node: (
          // The talk's and the dialogue's tab is their own work on the page; here it is their read.
          <PageSection title={answer.source.title} level={3} badge={<SourceBadge source={answer.source} />}>
            {kind === 'person' ? (
              <PersonSourceBody answer={answer} tableQuery={NO_TABLE} about={name} />
            ) : (
              <UnitSourceBody answer={answer} />
            )}
          </PageSection>
        ),
      },
    ];
  else
    sections = [
      ...(detail.cards.length > 0
        ? [
            {
              key: NEEDS_YOU,
              node: (
                <PageSection
                  title="Behöver dig"
                  level={3}
                  end={
                    <Link href={tabHref(NEEDS_YOU)} isStandalone>
                      Visa allt
                      <VisuallyHidden> om ärenden</VisuallyHidden>
                    </Link>
                  }
                >
                  <NeedsYouRows cards={detail.cards} />
                </PageSection>
              ),
            },
          ]
        : []),
      ...drawn.map(a => ({
        key: a.source.capability,
        node: <OverviewSection answer={a} href={tabHref(a.source.capability)} level={3} />,
      })),
    ];
  const line = kind === 'person' ? nameLine(detail) : 'Enhet';
  return (
    <VStack gap={5} padding={6} onKeyDown={onKeyDown}>
      <HStack justify="between" vAlign="start" gap={3}>
        <StackItem size="fill">
          <HStack gap={3} vAlign="center">
            {/* The avatar is decoration, as on the page: the name beside it says who it is. */}
            {kind === 'person' && <Avatar name={name} size={40} tooltip={false} aria-hidden />}
            <VStack gap={1}>
              <Heading level={2}>
                <Link href={pageHref} color="primary" type="inherit" weight="semibold">
                  {name}
                </Link>
              </Heading>
              {line && (
                <Text type="supporting" color="secondary">
                  {line}
                </Text>
              )}
            </VStack>
          </HStack>
        </StackItem>
        {close}
      </HStack>
      <ThingTabs
        label={`Om ${name}`}
        value={tab}
        compact
        tabs={tabs.map(t => ({
          ...t,
          href: tabHref(t.value),
          ...(t.value === NEEDS_YOU ? { count: detail.cards.length } : {}),
        }))}
      />
      {sections.length > 0 ? (
        <VStack gap={6}>
          {sections.map(s => (
            <VStack key={s.key}>{s.node}</VStack>
          ))}
        </VStack>
      ) : (
        <EmptyState isCompact headingLevel={3} title={`Inget mer att visa om ${name}`} />
      )}
    </VStack>
  );
}
