import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';

export type RowStatus = 'error' | 'warning' | 'info' | 'success' | 'neutral';

/**
 * A row in a card that lists what needs the person (D130 item 13), as the startsidan prototype draws one: on the
 * ground's colour with an edge at its start in the row's status colour, the title in bold over its supporting line, and
 * at its end what says the status in words (a badge) and "Öppna", the row's one link, named with the title so it is not
 * one of several links called the same. Where the row is narrow the end goes under the title.
 *
 * The button names the next press where the page gives it another name (`open`: "Granska 3", which may lead to a place
 * in the thing's page). Where the next press is made on the row itself (`action`: a button that runs), the title is the
 * link to the thing's page, so the page is never out of reach (D142).
 */
export function StatusRow({
  id,
  status = 'neutral',
  title,
  meta,
  href,
  end,
  open,
  action,
}: {
  id?: string;
  status?: RowStatus;
  title: string;
  meta?: ReactNode;
  href: string;
  end?: ReactNode;
  /** The link at the row's end under another name, and to another place in the thing's page, than "Öppna". */
  open?: { label: string; href?: string };
  /** A button that runs in the link's place; the title is then the link. */
  action?: ReactNode;
}) {
  return (
    <Card variant={`row-${status}`} padding={3}>
      <HStack id={id} gap={4} vAlign="center" wrap="wrap" paddingInlineStart={2}>
        <StackItem size="fill">
          <VStack gap={0.5}>
            {action ? (
              <Link href={href} color="primary" weight="bold">
                {title}
              </Link>
            ) : (
              <Text weight="bold">{title}</Text>
            )}
            {meta !== undefined && (
              <Text type="supporting" color="secondary">
                {meta}
              </Text>
            )}
          </VStack>
        </StackItem>
        <HStack gap={2} vAlign="center" wrap="wrap">
          {end}
          {action ?? (
            <Button
              size="sm"
              variant="secondary"
              label={open?.label ?? 'Öppna'}
              aria-label={open ? `${open.label}: ${title}` : `Öppna ${title}`}
              href={open?.href ?? href}
            />
          )}
        </HStack>
      </HStack>
    </Card>
  );
}
