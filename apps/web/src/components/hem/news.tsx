import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NewsResult, ViewRef } from '@clew/contracts';
import { BoardCard, Link, List, ListItem, Text } from '@clew/ui';
import { newsQuery } from '../../queries';
import { toolHref } from '../shell/nav';
import { isWebAddress } from '../../web-address';

/** The combined news list (D112, amended 2026-11-11): Clew's core read over every news source the person may read. */
export const NEWS_CAPABILITY = 'clew.news';
/** How many pieces of news Hem shows (board Hem): the newest; the rest are in "Alla nyheter". */
const ON_HEM = 3;
const day = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', timeZone: 'Europe/Stockholm' });
const shortDay = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' });
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
  // The day first, as the reference's news card has it ("2 okt."), then who published it.
  const at = Date.parse(row.publishedAt);
  const line = [Number.isNaN(at) ? '' : shortDay.format(at), row.sender].filter(Boolean).join(' · ');
  // A link the source gave is an http(s) address or none (D145): the server holds it to that, and the page again.
  const out = row.link && isWebAddress(row.link) ? row.link : undefined;
  const href = out ?? (row.view ? hrefFor(row.view) : undefined);
  const description = (
    <Text type="supporting" color="secondary" maxLines={2}>
      {line}
    </Text>
  );
  if (!href)
    return (
      <ListItem
        itemKey={key}
        label={
          <Text weight="bold" maxLines={3}>
            {row.title}
          </Text>
        }
        description={description}
      />
    );
  return (
    <ListItem
      id={`news-${key}`}
      itemKey={key}
      interactiveRef={link}
      label={
        <Link ref={link} href={href} color="primary" weight="bold" maxLines={3} isExternalLink={!!out}>
          {row.title}
        </Link>
      }
      description={description}
    />
  );
}

/**
 * "Nyheter" on Hem (D112, amended 2026-11-11; D130 item 13): the newest pieces of news from every news source the
 * person may read, in a board card in the board's narrow column, and the way to all of them. Drawn only when there is news: a person with no news
 * source, a read that fails and sources that answered nothing all leave no block and say nothing (Hem is not where a
 * news source's silence is reported).
 */
export function NewsBlock({ hrefFor }: { hrefFor: (view: ViewRef) => string }) {
  const read = useQuery(newsQuery);
  const rows = read.data?.rows ?? [];
  if (!rows.length) return null;
  return (
    <BoardCard id="nyheter" title="Nyheter" list action={<Link href={allNewsHref()}>Alla nyheter</Link>}>
      <List hasDividers aria-label="Nyheter">
        {rows.slice(0, ON_HEM).map(row => (
          <NewsRowItem key={row.connector + ':' + row.ref} row={row} hrefFor={hrefFor} />
        ))}
      </List>
    </BoardCard>
  );
}
