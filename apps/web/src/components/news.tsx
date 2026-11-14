import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NewsResult, ViewRef } from '@clew/contracts';
import { Card, Heading, HStack, Link, List, ListItem, Text, VStack } from '@clew/ui';
import { newsQuery } from '../queries';
import { toolHref } from './nav';

/** The combined news list (D112, amended 2026-11-11): Clew's core read over every news source the person may read. */
export const NEWS_CAPABILITY = 'clew.news';
/** How many pieces of news Hem shows (board Hem): the newest; the rest are in "Alla nyheter". */
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
 * One piece of news as Hem's row (board Hem): the headline is the row's one link and its one tab stop, and the sender
 * and the day its supporting line; the row around it is Astryx's enlarged target for that link (`interactiveRef`), so a
 * press anywhere on the row follows it. Out of Clew in a new tab by its `link`, else in Clew to the page of the read its
 * source declares (D126 rule 1). A row with neither has nowhere to lead and is drawn as text.
 */
function NewsRowItem({ row, hrefFor }: { row: NewsEntry; hrefFor: (view: ViewRef) => string }) {
  const link = useRef<HTMLAnchorElement>(null);
  const key = row.connector + ':' + row.ref;
  const line = [row.sender, publishedDay(row.publishedAt)].filter(Boolean).join(' · ');
  const href = row.link ?? (row.view ? hrefFor(row.view) : undefined);
  const description = (
    <Text type="supporting" color="secondary" maxLines={2}>
      {line}
    </Text>
  );
  if (!href) return <ListItem itemKey={key} label={<Text maxLines={2}>{row.title}</Text>} description={description} />;
  return (
    <ListItem
      id={`news-${key}`}
      itemKey={key}
      interactiveRef={link}
      label={
        <Link ref={link} href={href} color="primary" maxLines={2} isExternalLink={!!row.link}>
          {row.title}
        </Link>
      }
      description={description}
    />
  );
}

/**
 * "Nyheter" on Hem (D112, amended 2026-11-11; D126, board Hem): the newest pieces of news from every news source the
 * person may read, under the blocks, and the way to all of them. Drawn only when there is news: a person with no news
 * source, a read that fails and sources that answered nothing all leave no block and say nothing (Hem is not where a
 * news source's silence is reported).
 */
export function NewsBlock({ hrefFor }: { hrefFor: (view: ViewRef) => string }) {
  const read = useQuery(newsQuery);
  const rows = read.data?.rows ?? [];
  if (!rows.length) return null;
  return (
    <VStack gap={3} as="section" aria-labelledby="nyheter">
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <Heading id="nyheter" tabIndex={-1} level={2}>
          Nyheter
        </Heading>
        <Link href={allNewsHref()}>Alla nyheter</Link>
      </HStack>
      <Card padding={0}>
        <List hasDividers aria-label="Nyheter">
          {rows.slice(0, ON_HEM).map(row => (
            <NewsRowItem key={row.connector + ':' + row.ref} row={row} hrefFor={hrefFor} />
          ))}
        </List>
      </Card>
    </VStack>
  );
}
