import type { ComponentProps, ReactNode, Ref } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Spinner } from '@astryxdesign/core/Spinner';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  ExclamationCircleIcon,
  HandRaisedIcon,
  LockClosedIcon,
  MinusCircleIcon,
  MinusIcon,
  QuestionMarkCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { DOT } from './dot';
import { STATUS, statusDot, type StatusKind } from './status-words';

export { STATUS, statusDot, type StatusKind, type StatusTone, type StatusWords } from './status-words';

/**
 * The status vocabulary's three sizes (D126 item 13, the canvas boards Status, StatusPanel and StatusElsewhere): the
 * mark in a row, the badge beside a title and the notice under one. The tone says how it went, the words whose move it
 * is; a state is never told by colour alone (1.4.1): the word is always there, and the badge and the notice carry the
 * state's icon too.
 */
const ICONS: Record<StatusKind, { mark: typeof CheckIcon; notice: typeof CheckIcon }> = {
  'needs-you': { mark: HandRaisedIcon, notice: ExclamationCircleIcon },
  sending: { mark: ArrowPathIcon, notice: ArrowPathIcon },
  waiting: { mark: ClockIcon, notice: ClockIcon },
  done: { mark: CheckIcon, notice: CheckCircleIcon },
  partial: { mark: MinusIcon, notice: MinusCircleIcon },
  unconfirmed: { mark: QuestionMarkCircleIcon, notice: QuestionMarkCircleIcon },
  failed: { mark: XMarkIcon, notice: XCircleIcon },
  blocked: { mark: LockClosedIcon, notice: LockClosedIcon },
};
/** The state's word with what it concerns after it: "Obekräftat · 1 av 3", "Behöver dig · försenad". */
export const statusText = (kind: StatusKind, detail?: string | null) =>
  detail ? `${STATUS[kind].word}${DOT}${detail}` : STATUS[kind].word;

/**
 * Size 1, the mark: in a table cell or a list row, where the row itself is the link. The dot beside the word is
 * decoration with no name of its own, so the state is heard once, in the words. Where the list already names the state
 * (`isWordHidden`: Att göra's "Behöver dig" tab, whose every row would say it again) the word is not drawn: the dot
 * stands with what the state concerns ("försenad"), or alone, and carries the whole mark as its name ("Behöver dig,
 * försenad"), so it is still heard once and in full.
 */
export function StatusMark({
  kind,
  detail,
  weight,
  isWordHidden = false,
}: {
  kind: StatusKind;
  detail?: string | null | undefined;
  /** Semibold where the row is the one still unresolved (board StatusPanel's first invoice). */
  weight?: 'normal' | 'semibold' | undefined;
  /** The list around the mark already says the state's word: only what it concerns is drawn beside the dot. */
  isWordHidden?: boolean;
}) {
  if (isWordHidden)
    return (
      <HStack gap={2} vAlign="center" wrap="nowrap">
        <StatusDot
          variant={statusDot(kind)}
          label={detail ? `${STATUS[kind].word}, ${detail}` : STATUS[kind].word}
          isPulsing={kind === 'sending'}
        />
        {detail && (
          <Text aria-hidden {...(weight ? { weight } : {})}>
            {detail}
          </Text>
        )}
      </HStack>
    );
  return (
    <HStack gap={2} vAlign="center" wrap="nowrap">
      <StatusDot variant={statusDot(kind)} label={STATUS[kind].word} isPulsing={kind === 'sending'} aria-hidden />
      <Text {...(weight ? { weight } : {})}>{statusText(kind, detail)}</Text>
    </HStack>
  );
}
/** Size 2, the badge: at the end of a row or beside a title. "Väntar" is neutral: nothing is asked of the person. */
export function StatusBadge({ kind, detail }: { kind: StatusKind; detail?: string | null | undefined }) {
  const s = STATUS[kind];
  return (
    <Badge
      variant={kind === 'waiting' ? 'neutral' : s.tone}
      icon={<Icon icon={ICONS[kind].mark} size="sm" />}
      label={detail ? `${s.word} ${detail}` : s.word}
    />
  );
}

/**
 * The one move a notice offers: a button that runs (`clickAction`, waited on while it runs) or leads (`href`), or one
 * that opens a short list of choices (`menu`: when to be reminded). `ref` and `attributes` are the button's own, so a
 * dialog it opens, or a page it leads to, can give the focus back to it.
 */
export interface StatusMove {
  label: string;
  href?: string | undefined;
  clickAction?: (() => void | Promise<void>) | undefined;
  isLoading?: boolean | undefined;
  menu?: ComponentProps<typeof DropdownMenu>['items'];
  ref?: Ref<HTMLButtonElement> | undefined;
  attributes?: Record<`data-${string}`, string> | undefined;
}
function MoveButton({ move, variant }: { move: StatusMove; variant: 'primary' | 'secondary' }) {
  if (move.menu)
    return (
      <DropdownMenu
        button={{ label: move.label, variant }}
        presentation="adaptive"
        menuMaxHeight={480}
        items={move.menu}
      />
    );
  const common = { ref: move.ref, variant, label: move.label, isLoading: move.isLoading, ...move.attributes };
  if (move.href) return <Button {...common} href={move.href} />;
  return <Button {...common} {...(move.clickAction ? { clickAction: move.clickAction } : {})} />;
}
/**
 * Size 3, the notice: directly under a thing's title, once something has happened or is in the way (a plain to-do has
 * none: its title and its buttons say what is expected). The title says what the state is about in the person's words,
 * the description why and since when, and there is at most one move: filled when it is the person's (`action`), a
 * secondary button when it is an offer (`offer`: remind, undo). What it concerns may stand inside it (`children`).
 * Astryx's Banner, never folded. It is no live region, so the page says a change of state aloud itself (`useAnnounce`),
 * as Astryx asks of a Banner.
 */
export function StatusNotice({
  kind,
  title,
  description,
  action,
  offer,
  children,
}: {
  kind: StatusKind;
  title: string;
  description?: string | undefined;
  action?: StatusMove | undefined;
  offer?: StatusMove | undefined;
  children?: ReactNode;
}) {
  const move = action ?? offer;
  return (
    <Banner
      status={STATUS[kind].tone}
      icon={
        kind === 'sending' ? <Spinner size="md" aria-label={STATUS.sending.word} /> : <Icon icon={ICONS[kind].notice} />
      }
      title={title}
      description={description}
      collapsible={false}
      endContent={move ? <MoveButton move={move} variant={action ? 'primary' : 'secondary'} /> : undefined}
    >
      {children}
    </Banner>
  );
}
