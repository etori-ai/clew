import { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClewObject } from '@clew/contracts';
import {
  Button,
  ChatComposer,
  ChatComposerDrawer,
  ChatComposerInput,
  ChatDictationButton,
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  HStack,
  Kbd,
  Link,
  List,
  ListItem,
  Text,
  Token,
  TypeaheadItem,
  useChatDictation,
  useToast,
  type ChatComposerTrigger,
  type SearchableItem,
  useMediaQuery,
} from '@clew/ui';
import { mobileQuery } from './shell';
import { api } from '../api';
import { assistantQuery, completionsQuery, threadsQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage } from '../query-policy';
import { addDays, displayDate, shortDayLabel, timeLabel, today } from '@clew/calendar/dates';
import { tokenValue, useConversation, type AskFrom } from './conversation-context';

/**
 * The model choice (D24), in the composer's footer slot that Astryx keeps for a model selector: the person's models
 * with what each is good for. It is there whenever a model answers, also when there is only one, so the box always says
 * which model the next question goes to (D36); without a model the router answers and there is nothing to choose.
 * Choosing saves their own preference on the server, which resolves the model on every question; the toast says which
 * one the next question uses.
 */
function ModelMenu({ isDisabled }: { isDisabled: boolean }) {
  const status = useQuery(assistantQuery).data;
  const client = useQueryClient();
  const toast = useToast();
  const choose = useMutation({
    mutationFn: (modelId: string) => api.chooseModel(modelId),
    onSuccess: next => {
      client.setQueryData(keys.assistant, next);
      toast({
        body: `Nästa fråga besvaras av ${next.current?.title ?? 'den inbyggda routern'}.`,
        uniqueID: 'model-choice',
      });
    },
    onError: e =>
      toast({ body: errorMessage(e, 'Modellen kunde inte väljas.'), isAutoHide: false, uniqueID: 'model-choice' }),
  });
  if (!status?.current) return null;
  const current = status.current;
  return (
    <DropdownMenu
      button={{
        label: `Modell: ${current.title}`,
        children: current.title,
        variant: 'ghost',
        size: 'sm',
        isDisabled: isDisabled || choose.isPending,
      }}
      menuWidth={280}
    >
      <DropdownMenuRadioGroup
        label="Modell"
        value={current.id}
        onChange={id => {
          if (id !== current.id) choose.mutate(id);
        }}
      >
        {status.choices.map(c => (
          <DropdownMenuRadioItem
            key={c.id}
            value={c.id}
            label={c.isDefault ? `${c.title} (standard)` : c.title}
            description={c.description || undefined}
          />
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  );
}

/** Microphone inside the composer; the browser's speech recognition writes into the same input. */
function Dictation({ onResult }: { onResult: (text: string) => void }) {
  const dictation = useChatDictation({ lang: 'sv-SE', onResult });
  return <ChatDictationButton dictation={dictation} />;
}
/**
 * Where the box sits decides what it says about itself (the canvas's rule H3.3: the scope line always says what the box
 * talks to). On Hem it is the page and says nothing above the field, until a card is open beside it, when it says "Om kortet" (D53); in a conversation (H1) it says "Det här
 * samtalet" with the way to a new question; at the foot of a page (D50: Att göra, a tool) the placeholder says what the
 * box asks about, or that it starts a new conversation, and the box keeps to one line.
 */
const STOP = new Set([
  'att',
  'och',
  'som',
  'för',
  'med',
  'den',
  'det',
  'ett',
  'jag',
  'vad',
  'hur',
  'när',
  'var',
  'min',
  'mitt',
  'mina',
  'har',
  'kan',
  'vill',
  'ska',
  'till',
  'från',
  'över',
  'om',
]);
export type ComposerPlace = 'landing' | 'conversation' | 'page';
/** What a page's box asks about (D50): its name in the scope line, and what the conversation takes with it. */
export type ComposerAbout = AskFrom & {
  label: string;
  /** Hem's box: the way to let go of the card and ask a new question instead. */ clearHref?: string;
};
/** The landing's field is three lines tall from the start, as the `ai-chat-landing` template sets it on its `ChatComposerInput` (D41). */
const landingField = { minHeight: 84 };
/**
 * The box (D31, D34): Astryx's ChatComposer, in the page flow on the landing and docked by ChatLayout in a
 * conversation. The chips the person pointed at sit in the composer's drawer as removable tokens; `@` in the field
 * inserts a token for anything on the page. With one chip and nothing typed the footer offers the verbs about it. The
 * row keeps focus throughout; sending never moves it. `roomy` is the landing's box in the page flow (D41); docked on a
 * phone it keeps the field's own height.
 */
export function Composer({
  place,
  near = [],
  roomy = false,
  about,
}: {
  place: ComposerPlace;
  near?: string[];
  roomy?: boolean;
  about?: ComposerAbout | undefined;
}) {
  const talk = useConversation();
  // A page's box hands the conversation what the page shows; the landing's and a conversation's own box have nothing to hand over.
  const from: AskFrom | undefined =
    place === 'page' || about ? { chips: about?.chips ?? [], search: about?.search ?? '' } : undefined;
  // What `@` treats as the context: what the page shows (`near`), what is in the drawer and the field, and in a
  // conversation every card and row it has touched (the chips of its turns, a draft's card, a proposal's card).
  const context = useRef<string[]>([]);
  context.current = [
    ...new Set([
      ...near,
      ...talk.chipped,
      ...(place === 'conversation'
        ? (talk.conversation?.messages ?? []).flatMap(m => [
            ...(m.meta?.chips ?? []).map(c => c.ref),
            ...(m.meta?.draft ? ['thread:' + m.meta.draft.threadId] : []),
          ])
        : []),
      ...(place === 'conversation' && talk.latest?.forslag ? ['thread:' + talk.latest.forslag.threadId] : []),
    ]),
  ].slice(0, 40);
  // `@` in the row: with nothing typed, only the context; typing searches everything in scope with the context first.
  const trigger = useMemo<ChatComposerTrigger>(() => {
    const toItems = (objects: ClewObject[]): SearchableItem<ClewObject>[] =>
      objects.map(o => ({ id: o.ref, label: o.label, auxiliaryData: o }));
    return {
      character: '@',
      hasMultiWordQuery: true,
      menuLabel: 'Objekt',
      loadingText: 'Söker …',
      emptySearchText: 'Inget här matchar. Skriv för att söka bland alla kort, rader och system.',
      searchSource: {
        search: async q => toItems((await api.objects(q, context.current)).objects),
        bootstrap: async () => toItems((await api.objects('', context.current)).objects),
        cancel: () => undefined,
      },
      renderItem: item => (
        <TypeaheadItem item={item} description={(item as SearchableItem<ClewObject>).auxiliaryData?.detail} />
      ),
      onSelect: item => {
        const o = (item as SearchableItem<ClewObject>).auxiliaryData!;
        talk.rememberObject(o);
        return { value: tokenValue(o.ref), label: o.label, variant: 'neutral' };
      },
    };
  }, [talk.rememberObject]);
  const placeholder =
    place === 'conversation'
      ? 'Svara, eller @ för att peka på något …'
      : about
        ? `Fråga om ${about.label} …`
        : place === 'page'
          ? 'Nytt samtal: skriv eller säg vad du vill göra …'
          : 'Skriv eller säg vad du vill göra …';
  const plain = talk.value.replace(/@\[[^\]]+\]/g, '').trim();
  const mobile = useMediaQuery(mobileQuery);
  const pointer = useMediaQuery('(pointer: fine)');
  const shortcut = !mobile && pointer ? <Kbd keys="mod+k" /> : null;
  // The scope line (H3.3): in a conversation the conversation; on Hem with a card open beside it, the card (D53, artboard E).
  const scope =
    place === 'conversation' ? (
      <Text type="supporting">
        <Text as="span" weight="semibold" color="primary">
          Det här samtalet
        </Text>
        {mobile ? '' : ' · svaret kommer under frågan'}
      </Text>
    ) : place === 'landing' && about ? (
      <Text type="supporting">
        <Text as="span" weight="semibold" color="primary">
          Om kortet
        </Text>
      </Text>
    ) : undefined;
  // While an answer is on its way the send button is Stoppa and the field stays open, so the person can write the next
  // question meanwhile (D36); Enter waits until the answer is written (the input empties itself on a submit, so it is
  // held back through the input's own key seam). Acting on a card's verbs still rests the whole box.
  return (
    <ChatComposer
      value={talk.value}
      onChange={talk.setValue}
      onSubmit={text => void talk.submit(text, from)}
      isDisabled={talk.busy && !talk.pending}
      isStopShown={!!talk.pending}
      onStop={talk.stop}
      density={place === 'landing' ? 'balanced' : 'compact'}
      placeholder={placeholder}
      drawer={
        talk.chips.length > 0 ? (
          <ChatComposerDrawer count={talk.chips.length} label="Objekt i samtalet">
            {talk.chips.map(c => (
              <Token key={c.ref} label={c.label} onRemove={() => talk.removeChip(c.ref)} data-chip-remove="" />
            ))}
          </ChatComposerDrawer>
        ) : undefined
      }
      input={
        <ChatComposerInput
          handleRef={talk.input}
          label={place === 'conversation' ? 'Svara i samtalet' : 'Vad vill du göra'}
          maxRows={place === 'landing' ? 4 : 3}
          style={place === 'landing' && roomy ? landingField : undefined}
          hasHistory={false}
          triggers={[trigger]}
          placeholder={placeholder}
          onKeyDown={e => {
            if (talk.pending && e.key === 'Enter' && !e.shiftKey) e.preventDefault();
          }}
        />
      }
      headerActions={scope}
      headerContext={
        place === 'conversation' ? (
          <HStack gap={2} vAlign="center">
            <Link
              href="/"
              onClick={e => {
                e.preventDefault();
                talk.newConversation();
              }}
            >
              Nytt samtal i stället
            </Link>
            {shortcut}
          </HStack>
        ) : place === 'landing' && about?.clearHref ? (
          <Link href={about.clearHref}>Ny fråga i stället</Link>
        ) : undefined
      }
      footerActions={
        <HStack gap={1} wrap="wrap">
          {talk.chips.length === 1 && !plain && talk.verbs.length > 0 && (
            <HStack gap={1} wrap="wrap" role="group" aria-label="Om kortet">
              {talk.verbs.map(v => (
                <Button
                  key={v.id}
                  size="sm"
                  variant="ghost"
                  label={v.label}
                  isDisabled={talk.busy}
                  onClick={() => talk.ask(v.label, from)}
                />
              ))}
            </HStack>
          )}
          {place !== 'page' && <ModelMenu isDisabled={talk.busy} />}
        </HStack>
      }
      sendActions={<Dictation onResult={text => talk.setValue((talk.value + ' ' + text).trim())} />}
      status={talk.error ? { type: 'error', message: talk.error } : undefined}
    />
  );
}

/**
 * "Menar du" under the box while the person types (G): what the router finds without the model (D8), an open card that
 * matches first, then the connectors' standing actions, then the questions a connector answers, then an earlier conversation to continue. A read
 * opens its view, everything else is asked in the box, a conversation opens. Nothing here waits for the model.
 */
export function Suggestions({
  viewHref,
  cardHref,
}: {
  viewHref: (capability: string, title: string) => string;
  cardHref: (threadId: string) => string;
}) {
  const talk = useConversation();
  const navigate = useNavigate();
  const completions = useQuery(completionsQuery).data;
  const threads = useQuery(threadsQuery).data?.threads;
  const query = talk.value
    .replace(/@\[[^\]]+\]/g, '')
    .trim()
    .toLowerCase();
  if (!completions || query.length < 2) return null;
  // Word stems, so "faktura" finds "fakturor"; short words and the little words of a question find nothing on their own.
  const words = query
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w))
    .map(w => (w.length > 5 ? w.slice(0, w.length - 2) : w));
  const hits = (text: string) => {
    const t = text.toLowerCase();
    return t !== query && words.length > 0 && words.some(w => t.includes(w));
  };
  const todayDate = today();
  const when = (at: string) => {
    const day = displayDate(at);
    return day === todayDate
      ? timeLabel(at)
      : day === addDays(todayDate, -1)
        ? `i går ${timeLabel(at)}`
        : shortDayLabel(day);
  };
  // The card the push already made comes first: asking for it and being told about it land on the same card (G).
  const cards = (threads ?? []).filter(t => t.state === 'open' && t.kind === 'pushed' && hits(t.title));
  const rows = [
    ...cards.map(t => ({
      key: 'card:' + t.id,
      label: t.title,
      detail: `${t.trigger.source} · öppnar kortet`,
      go: () => navigate(cardHref(t.id)),
    })),
    ...completions.do
      .filter(d => hits(d.text))
      .map(d => ({
        key: 'do:' + d.capability,
        label: d.text,
        detail: `${d.source} · ${d.kind === 'read' ? 'öppnar vyn' : 'öppnar kortet'}`,
        go: () => (d.kind === 'read' ? navigate(viewHref(d.capability, d.text)) : talk.ask(d.text)),
      })),
    ...completions.ask
      .filter(a => hits(a.text))
      .map(a => ({
        key: 'ask:' + a.capability,
        label: a.text,
        detail: `${a.source} · svarar utan modellen`,
        go: () => talk.ask(a.text),
      })),
    ...completions.recent
      .filter(r => hits(r.title))
      .map(r => ({
        key: 'recent:' + r.conversationId,
        label: `Fortsätt samtalet · ${r.title}`,
        detail: when(r.at),
        go: () => navigate(`/conversations/${r.conversationId}`),
      })),
  ].slice(0, 4);
  if (rows.length === 0) return null;
  return (
    <List
      density="compact"
      hasDividers
      header={
        <Text type="supporting" weight="semibold">
          Menar du
        </Text>
      }
    >
      {rows.map(r => (
        <ListItem
          key={r.key}
          label={<Text>{r.label}</Text>}
          endContent={<Text type="supporting">{r.detail}</Text>}
          onClick={r.go}
        />
      ))}
    </List>
  );
}
