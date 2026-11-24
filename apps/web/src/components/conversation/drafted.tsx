import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationResponse, PanelViewSpec, RecordDraft } from '@clew/contracts';
import {
  Badge,
  Button,
  Card,
  ChatMessageBubble,
  HStack,
  Link,
  MetadataList,
  MetadataListItem,
  StatusDot,
  Text,
  VStack,
} from '@clew/ui';
import { filledIn } from '../../action-path';
import { DOT } from '../../dot';
import { useEntityAction } from '../../entity-actions';
import { areasQuery, recordActionsQuery, threadQuery } from '../../queries';
import { keys } from '../../query-keys';
import { draftedAction, draftMessage, recordDraftPhase, sameRecord, sentState } from '../../record-actions';
import { addressInput, viewPageHref } from '../../view-address';
import { itemPageHref } from '../../work-items';
import { useConversation } from './conversation-context';

/**
 * An action the assistant filled in, drawn in the transcript (D112 item 8, D137 item 4, D138 item 8): a work item's
 * (`conversation.tsx`, `ActionDraftCard`) and a record's (`RecordDraftCard`). Beside a page it is the row of the board's
 * own kind that needs the person, its edge in the assistant's blue (`Drafted`); on the conversation's own page the card
 * a work item's draft has always had there (`DraftCard`). Its words are Clew's, never the model's: the action's own
 * title, what the action asks as the dialog labels it and each value as the dialog says it. Its one button opens the
 * action's own dialog with the values filled in, and nothing is sent before that dialog's last button.
 */

/** One filled-in value, as "Det här händer" lists it (`filledIn`). */
export type Filled = ReturnType<typeof filledIn>[number];
/** What became of a draft since it was written, said in place of its buttons. */
export type DraftState = { variant: 'success' | 'warning' | 'neutral'; label: string };
/** A draft that a later one of the same action about the same thing replaced. */
export const REPLACED: DraftState = { variant: 'neutral', label: 'Ersatt av ett nyare utkast' };
/** "Granska och boka" for "Boka samtalet": the action's own first word, as the verb (the conversation's own page). */
export const verbOf = (label: string) => (label.split(' ')[0] ?? label).toLocaleLowerCase('sv-SE');

/** The way to what a sent draft became: its work item. */
export type DraftLink = { label: string; href: string };

/** The state's word with its dot beside it; the dot is decoration, so the state is heard once. */
function StateLine({ state }: { state: DraftState }) {
  return (
    <HStack gap={1.5} vAlign="center">
      <StatusDot variant={state.variant} label={state.label} aria-hidden />
      <Text type="supporting">{state.label}</Text>
    </HStack>
  );
}

/**
 * Beside a page (D138 item 8; the reference's `Drafted`, artboard AttGoraArende): "Ifyllt åt dig", what the action is,
 * what was filled in, one line per ask with its label, and "Granska och skicka". Once the person has acted on it, what
 * became of it stands in the button's place, with the way to the work item it became where it has one of its own; a
 * draft a newer one replaced drops its values, which count in the newer.
 */
export function Drafted({
  title,
  filled,
  state,
  detail,
  link,
  onReview,
}: {
  title: string;
  filled: readonly Filled[];
  state?: DraftState | null;
  /** Under the state: what the source answered, or that the decision is on its way. */
  detail?: string | null;
  /** Under the state: the work item the draft became, when the draft is not the work item's own (D137). */
  link?: DraftLink | null;
  onReview: () => void;
}) {
  return (
    <Card variant="row-info" padding={3}>
      <VStack as="section" aria-label={`Ifyllt åt dig: ${title}`} gap={2} paddingInlineStart={2}>
        <VStack gap={0.5}>
          <Text type="eyebrow">Ifyllt åt dig</Text>
          <Text weight="bold">{title}</Text>
          {filled.map(f => (
            <Text key={f.property} type="supporting" color="secondary" maxLines={4}>
              {`${f.label}: ${f.text}`}
            </Text>
          ))}
        </VStack>
        {state ? (
          <VStack gap={0.5}>
            <StateLine state={state} />
            {detail && <Text type="supporting">{detail}</Text>}
            {link && (
              <Text type="supporting">
                <Link href={link.href}>{link.label}</Link>
              </Text>
            )}
          </VStack>
        ) : (
          <HStack gap={2} wrap="wrap">
            <Button size="sm" variant="primary" label="Granska och skicka" onClick={onReview} />
          </HStack>
        )}
      </VStack>
    </Card>
  );
}

/**
 * On the conversation's own page (D112 item 8, boards Assistant and Calendar): the thing the draft is about by name and
 * as the way to it, the action's name with an "Utkast" badge, the filled-in values as a short list, and two buttons.
 * "Granska och <verb>" opens the action's own dialog at its last step with these values, "Ändra" at its first. Once
 * the person has acted on it, what became of it stands in the badge's place, and the way to the work item it became,
 * where it has one of its own, in the buttons'.
 */
export function DraftCard({
  about,
  title,
  filled,
  state,
  detail,
  link,
  reviewLabel,
  onReview,
  onChange,
  children,
}: {
  about: { source: string; name: string; href: string };
  title: string;
  filled: readonly Filled[];
  state?: DraftState | null;
  detail?: string | null;
  /** In the buttons' place once acted on: the work item the draft became, when the draft is not the work item's own (D137). */
  link?: DraftLink | null;
  /** The first button's words; "Granska och <the action's first word>" unless said. */
  reviewLabel?: string;
  onReview: () => void;
  onChange: () => void;
  /** The action's dialog. */
  children?: ReactNode;
}) {
  return (
    <ChatMessageBubble variant="ghost" width="100%">
      <Card padding={4}>
        <VStack gap={3} as="section" aria-label={`Utkast: ${title}`}>
          {/* The thing the draft belongs to, by name and as the way to it: it is not drawn whole above its draft. */}
          <Text type="supporting">
            {`${about.source}${DOT}`}
            <Link href={about.href}>{about.name}</Link>
          </Text>
          <HStack gap={2} justify="between" vAlign="center" wrap="wrap">
            <Text weight="semibold">{title}</Text>
            {state ? <StateLine state={state} /> : <Badge variant="neutral" label="Utkast" />}
          </HStack>
          {filled.length > 0 && (
            <MetadataList columns="single">
              {filled.map(f => (
                <MetadataListItem key={f.property} label={f.label}>
                  <Text>{f.text}</Text>
                </MetadataListItem>
              ))}
            </MetadataList>
          )}
          {detail && <Text type="supporting">{detail}</Text>}
          {state ? (
            link && (
              <Text type="supporting">
                <Link href={link.href}>{link.label}</Link>
              </Text>
            )
          ) : (
            <HStack gap={2} wrap="wrap">
              <Button
                size="sm"
                variant="primary"
                label={reviewLabel ?? `Granska och ${verbOf(title)}`}
                onClick={onReview}
              />
              <Button size="sm" variant="secondary" label="Ändra" onClick={onChange} />
            </HStack>
          )}
        </VStack>
      </Card>
      {children}
    </ChatMessageBubble>
  );
}

/**
 * What a record is called (D137): its name as its page heads it, from the read the page already made of it (the
 * record's page, or the record beside the conversation), never a read of its own; else the read's own title.
 */
function useRecordName(record: RecordDraft['record']): string {
  const client = useQueryClient();
  const views = useQuery(areasQuery).data?.views;
  const made = client.getQueriesData<{ output: unknown; view?: PanelViewSpec }>({
    queryKey: keys.viewRead(record.capability),
  });
  for (const [key, answer] of made) {
    const spec = answer?.view;
    if (!spec || (spec.kind !== 'record' && spec.kind !== 'detail')) continue;
    if (!sameRecord(addressInput(typeof key[2] === 'string' ? key[2] : null), record.input)) continue;
    const own = answer.output && typeof answer.output === 'object' ? (answer.output as Record<string, unknown>) : {};
    const name = own[spec.title];
    if (typeof name === 'string' && name.trim()) return name;
  }
  return views?.find(v => v.capability === record.capability)?.title ?? '';
}

/**
 * The assistant's draft of an action about the record that stood open (D137 item 4). A stored draft carries no action:
 * it is the record's own, as the server lists it for the person now (`recordActionsQuery`, the list the record's page
 * draws its buttons from), or, until that has come, the one the answer carried. One the record no longer offers draws
 * nothing. "Granska och skicka" (and on the conversation's page "Ändra") opens the dialog the record's page opens, with
 * the values filled in; what the person sends from it is theirs, and the work item it makes opens as from the page.
 * The send names the conversation's message that keeps the draft, and the server marks the draft as sent with the work
 * item it became: from then on, after a reload too, the draft says it was sent, in the words a work item's sent draft
 * uses, with the way to that work item where the button was. The conversation is read again after the send
 * (`useEntityAction`), so the draft says it at once, before the transcript itself is read again.
 */
export function RecordDraftCard({
  draft,
  fresh,
  replaced,
  compact,
}: {
  draft: RecordDraft;
  /** The latest answer's draft, which carries its action (`ConversationResponse.recordDraft`). */
  fresh?: ConversationResponse['recordDraft'] | null | undefined;
  replaced: boolean;
  /** Beside a page: the row (`Drafted`); else the card on the conversation's page (`DraftCard`). */
  compact: boolean;
}) {
  const { capability: read, input } = draft.record;
  const listed = useQuery(recordActionsQuery(read, input));
  const action = draftedAction(draft, listed.isError ? [] : listed.data?.actions, fresh);
  const { start, dialog } = useEntityAction();
  const name = useRecordName(draft.record);
  // The message that keeps the draft, which the send names; and that message as the conversation is read now.
  const { conversation } = useConversation();
  const message = conversation ? draftMessage(conversation.messages, draft) : undefined;
  const from = conversation && message ? { conversationId: conversation.id, messageId: message.id } : undefined;
  const kept = useQuery({ ...threadQuery(from?.conversationId ?? ''), enabled: !!from && !draft.sent });
  const seen = kept.data?.messages.find(m => m.id === from?.messageId)?.meta?.recordDraft;
  const phase = recordDraftPhase(draft, replaced, seen);
  // What the work item it became says of itself: its receipt, or the decision on its way.
  const sentAs = phase.phase === 'sent' ? phase.threadId : null;
  const item = useQuery({ ...threadQuery(sentAs ?? ''), enabled: !!sentAs });
  if (!action) return null;
  const subject = { kind: 'record' as const, read, input, name: name || action.source };
  const filled = phase.phase === 'replaced' ? [] : filledIn(action.path.asks, draft.values);
  const sent = sentAs ? sentState(item.data) : null;
  const state: DraftState | null = sent
    ? { variant: sent.variant, label: sent.label }
    : phase.phase === 'replaced'
      ? REPLACED
      : null;
  const here = window.location.pathname + window.location.search;
  const link = sentAs ? { label: 'Visa ärendet', href: itemPageHref(sentAs, here) } : null;
  const review = () => start(action, subject, draft.values, 'effect', from);
  if (compact)
    return (
      <>
        <Drafted
          title={action.title}
          filled={filled}
          state={state}
          detail={sent?.detail ?? null}
          link={link}
          onReview={review}
        />
        {dialog}
      </>
    );
  // "Granska och skicka", as beside a page: an action about a record is sent to its system whatever its first word
  // ("Lägg till en kommentar" is no verb to review).
  return (
    <DraftCard
      about={{ source: action.source, name: subject.name, href: viewPageHref({ capability: read, input }, here) }}
      title={action.title}
      filled={filled}
      state={state}
      detail={sent?.detail ?? null}
      link={link}
      reviewLabel="Granska och skicka"
      onReview={review}
      onChange={() => start(action, subject, draft.values, 'fill-in', from)}
    >
      {dialog}
    </DraftCard>
  );
}
