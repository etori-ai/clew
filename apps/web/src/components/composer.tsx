import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClewObject } from '@clew/contracts';
import {
  AreaGlyph,
  Button,
  ChatComposer,
  ChatComposerDrawer,
  ChatComposerInput,
  ChatDictationButton,
  DropdownMenu,
  DropdownMenuDivider,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  HStack,
  Link,
  Text,
  Token,
  TypeaheadItem,
  VisuallyHidden,
  useChatDictation,
  useEntryAnimation,
  useToast,
  type ChatComposerTrigger,
  type SearchableItem,
  useMediaQuery,
} from '@clew/ui';
import { mobileQuery } from './shell';
import { api } from '../api';
import { assistantQuery, handoverAssistantsQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage } from '../query-policy';
import { tokenValue, useClaimBox, useConversation, type AskFrom, type Handed } from './conversation-context';
import { useObjectMark } from '../marks';

/** What Clew's own side of the menu is called when no model is configured: the router answers (D8). */
const CLEW = 'clew';
/**
 * Who answers the next question, in the composer's footer slot that Astryx keeps for a model selector: Clew's own
 * models with what each is good for (D24), and under them the assistants of other systems the person may hand the
 * conversation to (the assistants profile). It is there whenever there is something to say: a model answers, also when
 * there is only one, so the box always says which model the next question goes to (D36), or another system's assistant
 * can be picked. Choosing a model saves the person's own preference on the server, which resolves the model on every
 * question. Choosing an assistant of another system saves nothing: from then on what the person writes in this box goes
 * to it, and the box says so above the field until they go back to Clew. A conversation is handed to one assistant, so
 * once it is, the menu offers that one only.
 */
function AnswerMenu({ isDisabled }: { isDisabled: boolean }) {
  const talk = useConversation();
  const status = useQuery(assistantQuery).data;
  const listed = useQuery(handoverAssistantsQuery).data ?? [];
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
  const kept = talk.conversation?.handover;
  const assistants: Handed[] = kept
    ? [{ id: kept.assistant, name: kept.name, source: kept.source }]
    : listed.map(a => ({ id: a.id, name: a.name, source: a.source }));
  const described = new Map(listed.map(a => [a.id, a.description]));
  const current = status?.current;
  if (!current && assistants.length === 0) return null;
  const handed = talk.handed;
  const title = handed?.name ?? current?.title ?? 'Clew';
  return (
    <DropdownMenu
      button={{
        label: handed
          ? `Svarar: ${handed.name} i ${handed.source}`
          : current
            ? `Modell: ${current.title}`
            : 'Svarar: Clew',
        children: title,
        variant: 'ghost',
        size: 'sm',
        isDisabled: isDisabled || choose.isPending,
      }}
      menuWidth={280}
    >
      <DropdownMenuRadioGroup
        label={current ? 'Modell' : 'Clew'}
        value={handed ? undefined : (current?.id ?? CLEW)}
        onChange={id => {
          if (handed) talk.leaveHandover();
          if (current && id !== current.id) choose.mutate(id);
        }}
      >
        {current ? (
          status.choices.map(c => (
            <DropdownMenuRadioItem
              key={c.id}
              value={c.id}
              label={c.isDefault ? `${c.title} (standard)` : c.title}
              description={c.description || undefined}
            />
          ))
        ) : (
          <DropdownMenuRadioItem value={CLEW} label="Clew" />
        )}
      </DropdownMenuRadioGroup>
      {assistants.length > 0 && <DropdownMenuDivider />}
      {assistants.length > 0 && (
        <DropdownMenuRadioGroup
          label="Assistenter i andra system"
          value={handed?.id}
          onChange={id => {
            const picked = assistants.find(a => a.id === id);
            if (picked && picked.id !== handed?.id) talk.handTo(picked);
          }}
        >
          {assistants.map(a => (
            <DropdownMenuRadioItem
              key={a.id}
              value={a.id}
              label={`${a.name} · ${a.source}`}
              description={described.get(a.id) || undefined}
            />
          ))}
        </DropdownMenuRadioGroup>
      )}
    </DropdownMenu>
  );
}

/**
 * What goes into the box enters, it does not pop (D92). Pressing "Lägg till i samtalet" changes four things in one frame,
 * a card's button far from the box among them, so the drawer slides open, the chip scales in and the verbs fade in, each
 * on Astryx's own entry motion: its tokens, nothing when the element was on the page from the first paint, and still
 * under reduced motion. Nothing waits for it; the field has the focus from the same click.
 */
function Drawer(props: ComponentProps<typeof ChatComposerDrawer>) {
  const entry = useEntryAnimation('slideDown');
  return <ChatComposerDrawer {...props} xstyle={entry ?? undefined} />;
}
function Chip(props: ComponentProps<typeof Token>) {
  const entry = useEntryAnimation('scaleIn');
  return <Token {...props} xstyle={entry ?? undefined} />;
}
function Verb(props: ComponentProps<typeof Button>) {
  const entry = useEntryAnimation('fadeIn');
  return <Button {...props} xstyle={entry ?? undefined} />;
}
/** A screen reader hears what the eye sees enter: the chip's name, once, when it is added. Removing is the chip's own button. */
function useAddedAnnouncement(chips: { ref: string; label: string }[]) {
  const seen = useRef<Set<string> | null>(null);
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    const refs = new Set(chips.map(c => c.ref));
    const before = seen.current;
    seen.current = refs;
    if (!before) return;
    const added = chips.filter(c => !before.has(c.ref));
    if (added.length > 0) setAnnounced(`${added[added.length - 1]!.label} är med i samtalet`);
  }, [chips]);
  return announced;
}

/** Microphone inside the composer; the browser's speech recognition writes into the same input. */
function Dictation({ onResult }: { onResult: (text: string) => void }) {
  const dictation = useChatDictation({ lang: 'sv-SE', onResult });
  return <ChatDictationButton dictation={dictation} />;
}
/**
 * Where the box sits decides what it says about itself (the canvas's rule H3.3: the scope line always says what the box
 * talks to). On Hem it is the page and says nothing above the field, also with a card open beside it: opening is not
 * asking (D111 rule 6), and a card is what the box asks about only once the person has added it as a chip. In a
 * conversation (H1) it says "Det här samtalet" with the way to a new question; at the foot of a tool's page (D50) the
 * placeholder says what the box asks about, or that it starts a new conversation, and the box keeps to one line.
 * `thing` is the box at the foot of the panel beside an opened thing (D112 item 7): it asks about that thing only, so it
 * has no drawer, no `@`, no model menu and no verbs, and its placeholder names the thing ("Fråga om ärendet …").
 */
export type ComposerPlace = 'landing' | 'conversation' | 'page' | 'thing';
/** What a box asks about (D50): its name in the placeholder, and what the conversation takes with it. */
export type ComposerAbout = AskFrom & { label: string };
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
  // While a conversation's own box is on the page, "Lägg till i samtalet" is offered (D112 item 7): elsewhere an opened
  // thing has its own box beside it, which asks about that thing.
  useClaimBox(place === 'conversation');
  const thing = place === 'thing';
  // A token and an `@` row carry the glyph of the system the ref belongs to (D71, artboard 8): the glyph beside the word, no hue.
  const markOf = useObjectMark();
  const glyph = (ref: string, threadId?: string) => {
    const icon = markOf(ref, threadId)?.icon;
    return icon ? <AreaGlyph icon={icon} /> : undefined;
  };
  // A tool page's box hands the conversation what the page shows. Hem's box hands over nothing to ask about, only the
  // way back: the card or view open beside Hem goes beside the transcript and "Stäng samtalet" returns to Hem as it
  // stood (D111 rule 6). A conversation's own box has nothing to hand over.
  const from: AskFrom | undefined =
    place === 'conversation' ? undefined : { chips: about?.chips ?? [], search: about?.search ?? '' };
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
      emptySearchText: 'Inget här matchar. Skriv för att söka bland alla ärenden, rader och system.',
      searchSource: {
        search: async q => toItems((await api.objects(q, context.current)).objects),
        bootstrap: async () => toItems((await api.objects('', context.current)).objects),
        cancel: () => undefined,
      },
      renderItem: item => {
        const o = (item as SearchableItem<ClewObject>).auxiliaryData;
        return <TypeaheadItem item={item} icon={o ? glyph(o.ref, o.threadId) : undefined} description={o?.detail} />;
      },
      onSelect: item => {
        const o = (item as SearchableItem<ClewObject>).auxiliaryData!;
        talk.rememberObject(o);
        return { value: tokenValue(o.ref), label: o.label, variant: 'neutral' };
      },
    };
  }, [talk.rememberObject, markOf]);
  // Handed to another system's assistant: the box says whom it talks to, takes no chips and no `@`, and offers the way back.
  const handed = thing ? null : talk.handed;
  const placeholder = handed
    ? `Fråga ${handed.name} …`
    : place === 'conversation'
      ? 'Svara, eller @ för att peka på något …'
      : about
        ? `Fråga om ${about.label} …`
        : place === 'page'
          ? 'Nytt samtal: skriv eller säg vad du vill göra …'
          : 'Skriv eller säg vad du vill göra …';
  const plain = talk.value.replace(/@\[[^\]]+\]/g, '').trim();
  // The thing beside the box is named in the panel's header and in the placeholder; its chip is not drawn again here.
  const aboutChips = thing ? [] : (about?.chips ?? []).filter(c => !talk.chips.some(t => t.ref === c.ref));
  const announced = useAddedAnnouncement(talk.chips);
  const mobile = useMediaQuery(mobileQuery);
  // The scope line (H3.3): in a conversation, the conversation. Hem's box has none, also with a card open beside it.
  const scope = handed ? (
    <Text type="supporting">
      <Text as="span" weight="semibold" color="primary">
        Du pratar med {handed.name}
      </Text>
      {`\u00a0· ${handed.source}`}
      {mobile ? '' : '. Det du skriver skickas dit, inget annat från samtalet.'}
    </Text>
  ) : place === 'conversation' ? (
    <Text type="supporting">
      <Text as="span" weight="semibold" color="primary">
        Det här samtalet
      </Text>
      {mobile ? '' : '\u00a0· svaret kommer under frågan'}
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
        !handed && (talk.chips.length > 0 || aboutChips.length > 0) ? (
          <Drawer
            {...(talk.chips.length > 0 ? { count: talk.chips.length + aboutChips.length } : {})}
            label="Objekt i samtalet"
          >
            {/* What a tool page's box asks about: the page's own view as a token, which stays while the page does. */}
            {aboutChips.map(c => (
              <Chip key={c.ref} label={c.label} icon={glyph(c.ref)} />
            ))}
            {talk.chips.map(c => (
              <Chip
                key={c.ref}
                label={c.label}
                icon={glyph(c.ref)}
                onRemove={() => talk.removeChip(c.ref)}
                data-chip-remove=""
              />
            ))}
          </Drawer>
        ) : undefined
      }
      input={
        <ChatComposerInput
          handleRef={talk.input}
          label={
            handed
              ? `Fråga ${handed.name}`
              : place === 'conversation'
                ? 'Svara i samtalet'
                : thing
                  ? 'Fråga Clew'
                  : 'Vad vill du göra'
          }
          maxRows={place === 'landing' ? 4 : 3}
          style={place === 'landing' && roomy ? landingField : undefined}
          hasHistory={false}
          triggers={thing || handed ? [] : [trigger]}
          placeholder={placeholder}
          onKeyDown={e => {
            if (talk.pending && e.key === 'Enter' && !e.shiftKey) e.preventDefault();
          }}
        />
      }
      headerActions={scope}
      headerContext={
        handed || place === 'conversation' ? (
          <HStack gap={3} wrap="wrap">
            {handed && (
              <Link
                href="/"
                onClick={e => {
                  e.preventDefault();
                  talk.leaveHandover();
                }}
              >
                Tillbaka till Clew
              </Link>
            )}
            {place === 'conversation' && (
              <Link
                href="/"
                onClick={e => {
                  e.preventDefault();
                  talk.newConversation();
                }}
              >
                Ny fråga i stället
              </Link>
            )}
          </HStack>
        ) : undefined
      }
      footerActions={
        <HStack gap={1} wrap="wrap">
          {/* The verbs about a card the person added with "Lägg till i samtalet", the one chip with nothing typed;
              a card merely open beside Hem brings none (D111 rule 6). */}
          {!thing && !handed && talk.chips.length === 1 && !plain && talk.verbs.length > 0 && (
            <HStack gap={1} wrap="wrap" role="group" aria-label="Om ärendet">
              {talk.verbs.map(v => (
                <Verb
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
          {place !== 'page' && !thing && <AnswerMenu isDisabled={talk.busy} />}
          <VisuallyHidden role="status">{announced}</VisuallyHidden>
        </HStack>
      }
      sendActions={<Dictation onResult={text => talk.setValue((talk.value + ' ' + text).trim())} />}
      status={talk.error ? { type: 'error', message: talk.error } : undefined}
    />
  );
}
