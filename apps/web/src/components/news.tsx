import { useQuery } from '@tanstack/react-query';
import type { NewsResult, ViewRef } from '@clew/contracts';
import { Card, Heading, HStack, Link, ListItem, Text, VStack } from '@clew/ui';
import { newsQuery } from '../queries';
import { toolHref } from './nav';
import { LinkRow, WorkList } from './work-row';

/** The combined news list (D112, amended 2026-11-11): Clew's core read over every news source the person may read. */
export const NEWS_CAPABILITY = 'clew.news';
/** How many pieces of news Hem shows (board Hem10): the newest; the rest are in "Alla nyheter". */
const ON_HEM = 3;
const day = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', timeZone: 'Europe/Stockholm' });
/** The day something was published, as the board writes it beside the sender: "11 november". */
export function publishedDay(instant: string): string {
  const at = Date.parse(instant);
  return Number.isNaN(at) ? '' : day.format(at);
}
/** The address "Alla nyheter" has: the joined read's own tool page, whether or not an administrator placed it in the rail. */
export const allNewsHref = () => toolHref(NEWS_CAPABILITY);

type NewsEntry = NewsResult['rows'][number];

/**
 * One piece of news as Hem's row: the headline, and the sender and the day as its supporting line. The row is the one
 * link row a work item has (`LinkRow`): out of Clew in a new tab by its `link`, else in Clew by the read its source
 * declares, beside the page. A row with neither has nowhere to lead and is drawn as text.
 */
function NewsRowItem({ row, hrefFor }: { row: NewsEntry; hrefFor: (view: ViewRef) => string }) {
  const key = row.connector + ':' + row.ref;
  const line = [row.sender, publishedDay(row.publishedAt)].filter(Boolean).join(' · ');
  const href = row.link ?? (row.view ? hrefFor(row.view) : undefined);
  if (!href)
    return (
      <ListItem
        itemKey={key}
        align="first-line"
        label={
          <Text weight="semibold" maxLines={2}>
            {row.title}
          </Text>
        }
        description={
          <Text type="supporting" color="secondary" maxLines={2}>
            {line}
          </Text>
        }
      />
    );
  return (
    <LinkRow
      id={`news-${key}`}
      itemKey={key}
      href={href}
      title={row.title}
      description={line}
      isExternal={!!row.link}
    />
  );
}

/**
 * "Nyheter" on Hem (D112, amended 2026-11-11, board Hem10): the third block beside "Behöver dig" and "I dag", the three
 * newest pieces of news from every news source the person may read, and the way to all of them. Drawn only when there
 * is news: a person with no news source, a read that fails and sources that answered nothing all leave no block and
 * say nothing (Hem is not where a news source's silence is reported).
 */
export function NewsBlock({ hrefFor }: { hrefFor: (view: ViewRef) => string }) {
  const read = useQuery(newsQuery);
  const rows = read.data?.rows ?? [];
  if (!rows.length) return null;
  return (
    <Card padding={4}>
      <VStack gap={1} as="section" aria-labelledby="nyheter">
        <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
          <Heading id="nyheter" tabIndex={-1} level={3} accessibilityLevel={2}>
            Nyheter
          </Heading>
          <Text type="supporting" weight="medium">
            <Link href={allNewsHref()} color="primary" hasUnderline>
              Alla nyheter
            </Link>
          </Text>
        </HStack>
        <WorkList label="Nyheter">
          {rows.slice(0, ON_HEM).map(row => (
            <NewsRowItem key={row.connector + ':' + row.ref} row={row} hrefFor={hrefFor} />
          ))}
        </WorkList>
      </VStack>
    </Card>
  );
}
