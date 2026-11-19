import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';

export type RowStatus = 'error' | 'warning' | 'info' | 'success' | 'neutral';

/**
 * A row in a card that lists what needs the person (D130 item 13), as the startsidan prototype draws one: on the
 * ground's colour with an edge at its start in the row's status colour, the title in bold over its supporting line, and
 * at its end what says the status in words (a badge) and "Öppna", the row's one link, named with the title so it is not
 * one of several links called the same. Where the row is narrow the end goes under the title.
 */
export function StatusRow({
  id,
  status = 'neutral',
  title,
  meta,
  href,
  end,
}: {
  id?: string;
  status?: RowStatus;
  title: string;
  meta?: ReactNode;
  href: string;
  end?: ReactNode;
}) {
  return (
    <Card variant={`row-${status}`} padding={3}>
      <HStack id={id} gap={4} vAlign="center" wrap="wrap" paddingInlineStart={2}>
        <StackItem size="fill">
          <VStack gap={0.5}>
            <Text weight="bold">{title}</Text>
            {meta !== undefined && (
              <Text type="supporting" color="secondary">
                {meta}
              </Text>
            )}
          </VStack>
        </StackItem>
        <HStack gap={2} vAlign="center" wrap="wrap">
          {end}
          <Button size="sm" variant="secondary" label="Öppna" aria-label={`Öppna ${title}`} href={href} />
        </HStack>
      </HStack>
    </Card>
  );
}
