import { cardKind, dayWord, streamGroup, type Thread } from '@clew/contracts';
import { Badge, Button, Card, Divider, HStack, Link, List, ListItem, Skeleton, Text, VisuallyHidden, VStack } from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { PrimaryAction } from './card';
import { useConversation } from './conversation-context';
import { AddToConversation } from './add-to-conversation';

type Props = {
  threads: Thread[];
  areaTitle: (id: string) => string;
  /** Where a row's title leads: the card itself, open. */
  cardHref: (threadId: string) => string;
  onChange: (thread: Thread) => void;
  onOpenCardView: (threadId: string, actionId: string) => void;
  /** A phone: the actions sit under the text instead of beside it. */
  compact?: boolean;
};
const sentence = (text: string) => text.replace(/\.$/, '');
/**
 * The brief above the box (D34, artboard G): a List in a Card with at most three rows of what the push found, each with
 * its day where it has one, the title, one short line (the area and why now), and the next step as the one button. A
 * requirement due today carries the red day; a proposal gets a soft button and no day. A card whose action needs a
 * choice first (attest the invoices you tick) gets "Granska", which opens the card, never a button that starts disabled.
 * The title is a link to the card (a link wraps at 320 px, a button's label does not). "Lägg till i samtalet" puts the
 * card in the box as a token, as on the card itself.
 */
export function Brief({ threads, areaTitle, cardHref, onChange, onOpenCardView, compact = false }: Props) {
  const now = today();
  const talk = useConversation();
  if (threads.length === 0) return null;
  return <Card padding={2}>
    <List hasDividers density="compact" edge="bleed" aria-label="Det som behöver dig">
      {threads.map(t => {
        const kind = cardKind(t);
        const due = t.deadline ? streamGroup(t, now) === 'nu' : false;
        const day = due ? <Badge variant="error" label="i dag" />
          : t.deadline ? <Text type="supporting" weight="semibold" hasTabularNumbers>{dayWord(t.deadline.slice(0, 10), now)}</Text> : undefined;
        const choose = t.items.some(i => i.selectable);
        const next = kind === 'forslag' || choose
          ? <Button size="sm" variant={due && kind !== 'forslag' ? 'primary' : 'secondary'} label={kind === 'forslag' ? 'Visa förslaget' : t.items.length > 1 ? `Granska ${t.items.length}` : 'Granska'} href={cardHref(t.id)} />
          : <PrimaryAction thread={t} onChange={onChange} onOpenCardView={onOpenCardView} />;
        // The day has its own column, empty where there is no day, so every title starts on one line (G).
        // The card can go into the box from here, as from the card itself: a token in the box's drawer, "I samtalet" once there.
        const ref = 'thread:' + t.id;
        const added = talk.chipped.includes(ref);
        const add = <AddToConversation added={added} onAdd={() => talk.addChip({ ref, kind: 'thread', label: t.title, threadId: t.id })} />;
        const line = <Text type="supporting">{areaTitle(t.area)} · {sentence(t.trigger.reason)}</Text>;
        // On a phone the actions go under the text, as on the G phone artboard: two buttons beside a title do not fit 320 px (1.4.10).
        const actions = <HStack gap={1} vAlign="center" wrap="wrap" justify={compact ? 'start' : 'end'}>
          {compact ? <>{next}{add}</> : <>{add}{next}</>}
        </HStack>;
        return <ListItem key={t.id} align={compact ? 'first-line' : 'center'} startContent={<VStack width={56}>{day}</VStack>}
          label={<Link href={cardHref(t.id)} color="primary" weight="semibold">{t.title}</Link>}
          description={compact ? <VStack gap={2}>{line}{actions}</VStack> : line}
          endContent={compact ? undefined : actions} />;
      })}
    </List>
  </Card>;
}

/**
 * The brief while the cards load (D36): rows of the brief's own shape (the day, the title over its line, the button),
 * so the box under it is where it will stay when they arrive. The shimmer is for the eye; a reader hears one line.
 */
export function BriefSkeleton({ rows = 3, compact = false }: { rows?: number; compact?: boolean }) {
  return <Card padding={2}>
    <VisuallyHidden>Hämtar det som behöver dig …</VisuallyHidden>
    <VStack gap={0}>
      {Array.from({ length: rows }, (_, i) => <VStack key={i} gap={0}>
        {i > 0 && <Divider />}
        <HStack gap={3} vAlign="center" padding={2}>
          <VStack width={56}><Skeleton height={14} width={40} index={i} /></VStack>
          <VStack gap={1.5} width="100%"><Skeleton height={18} width="60%" index={i} /><Skeleton height={14} width="40%" index={i} /></VStack>
          {!compact && <Skeleton height={32} width={104} radius="rounded" index={i} />}
        </HStack>
      </VStack>)}
    </VStack>
  </Card>;
}
