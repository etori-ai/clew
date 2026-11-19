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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  HStack,
  Token,
  TypeaheadItem,
  VisuallyHidden,
  useChatDictation,
  useEntryAnimation,
  useToast,
  type ChatComposerTrigger,
  type SearchableItem,
} from '@clew/ui';
import { api } from '../api';
import { assistantQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage } from '../query-policy';
import { tokenValue, useClaimBox, useConversation, type AskFrom, type ChipRef } from './conversation-context';
import { useObjectMark } from '../marks';

/**
 * The model choice (D24), in the composer's footer slot that Astryx keeps for a model selector: the person's models
 * with what each is good for. It is there whenever one of Clew's models answers, also when there is only one, so the
 * box always says which model the next question goes to (D36); without a model the router answers and there is nothing
 * to choose. Choosing saves their own preference on the server, which resolves the model on every question; the toast
 * says which one the next question uses.
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
 * Where the box sits (D126 item 4: the assistant has two homes): `landing` is the box on Ny fråga, under the greeting,
 * which starts a conversation; `conversation` is the box docked under a conversation's transcript, which continues it.
 * Hem has one line that starts a conversation with its question (`HemQuestion`). `pane` is the box beside a page (D130
 * rules 3 and 10): the plain one, with no `@`, drawer, model, dictation or verbs, which belong to the conversation's
 * page; flat and at Astryx's own density (the product owner, 2026-11-18: the compact one put its text too close to its
 * border). It is not a conversation's own box, so "Lägg till i samtalet" is not offered for it.
 */
export type ComposerPlace = 'landing' | 'conversation' | 'pane';
/**
 * The box (D31, D34; boards NyFraga and Samtal): Astryx's ChatComposer, in the page flow on Ny fråga and docked by
 * ChatLayout in a conversation. It only ever goes to Clew: another system's assistant is talked to in the panel beside a
 * conversation, which has a box of its own. The chips the person pointed at sit in the composer's drawer as removable tokens;
 * `@` in the field inserts a token for anything in scope. With one chip and nothing typed the footer offers the verbs
 * about it. The row keeps focus throughout; sending never moves it. `about` is what the conversation's page is about by
 * its address, the thing beside the transcript: it goes with every question and is drawn beside, not in the drawer.
 */
export function Composer({
  place,
  about,
  placeholder: aboutPlaceholder,
}: {
  place: ComposerPlace;
  about?: ChipRef[] | undefined;
  /** What the empty box says in a conversation about someone ("Fråga om Johan"); else whom it writes to. */
  placeholder?: string | undefined;
}) {
  const talk = useConversation();
  // While a conversation's own box is on the page, "Lägg till i samtalet" is offered: no other page has a box.
  useClaimBox(place === 'conversation');
  // A token and an `@` row carry the glyph of the system the ref belongs to (D71, artboard 8): the glyph beside the word, no hue.
  const markOf = useObjectMark();
  const glyph = (ref: string, threadId?: string) => {
    const icon = markOf(ref, threadId)?.icon;
    return icon ? <AreaGlyph icon={icon} /> : undefined;
  };
  // Ny fråga's box hands the conversation nothing to ask about, only the way back: Esc returns to where the person was.
  // A conversation's own box has nothing to hand over.
  const from: AskFrom | undefined = place === 'landing' ? { chips: [], search: '' } : undefined;
  // What `@` treats as the context: what is in the drawer and the field, and in a conversation every card and row it
  // has touched (the chips of its turns, a draft's card, a proposal's card).
  const context = useRef<string[]>([]);
  context.current = [
    ...new Set([
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
  // Whom the box writes to, as the boards say it; Ny fråga's says what the box is for; beside a page, what it asks about.
  const placeholder =
    place === 'conversation'
      ? (aboutPlaceholder ?? 'Skriv till assistenten')
      : place === 'pane'
        ? (aboutPlaceholder ?? 'Fråga assistenten')
        : 'Fråga något eller be assistenten göra det åt dig';
  const pane = place === 'pane';
  const plain = talk.value.replace(/@\[[^\]]+\]/g, '').trim();
  const announced = useAddedAnnouncement(talk.chips);
  // While an answer is on its way the send button is Stoppa and the field stays open, so the person can write the next
  // question meanwhile (D36); Enter waits until the answer is written (the input empties itself on a submit, so it is
  // held back through the input's own key seam). Acting on a card's verbs still rests the whole box.
  return (
    <ChatComposer
      value={talk.value}
      onChange={talk.setValue}
      onSubmit={text => void talk.submit(text, from, about)}
      isDisabled={talk.busy && !talk.pending}
      /* While a turn runs the send button is Stop (D126 item 5); a suggestion waiting for the person's answer is no turn to stop. */
      isStopShown={!!talk.pending && !talk.pending.offer}
      onStop={talk.stop}
      {...(pane ? { elevation: 'none' as const } : { density: 'compact' as const })}
      placeholder={placeholder}
      drawer={
        !pane && talk.chips.length > 0 ? (
          <Drawer count={talk.chips.length} label="Objekt i samtalet">
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
          // Beside a page the box is named by what it asks about, as its empty field says it.
          label={place === 'conversation' ? 'Svara i samtalet' : pane ? placeholder : 'Vad vill du göra'}
          maxRows={place === 'landing' ? 4 : 3}
          hasHistory={false}
          {...(pane ? {} : { triggers: [trigger] })}
          placeholder={placeholder}
          onKeyDown={e => {
            if (talk.pending && e.key === 'Enter' && !e.shiftKey) e.preventDefault();
          }}
        />
      }
      footerActions={
        pane ? undefined : (
          <HStack gap={1} wrap="wrap">
            {/* The verbs about a card the person added with "Lägg till i samtalet", the one chip with nothing typed. */}
            {talk.chips.length === 1 && !plain && talk.verbs.length > 0 && (
              <HStack gap={1} wrap="wrap" role="group" aria-label="Om ärendet">
                {talk.verbs.map(v => (
                  <Verb
                    key={v.id}
                    size="sm"
                    variant="ghost"
                    label={v.label}
                    isDisabled={talk.busy}
                    onClick={() => talk.ask(v.label, from, about)}
                  />
                ))}
              </HStack>
            )}
            <ModelMenu isDisabled={talk.busy} />
            <VisuallyHidden role="status">{announced}</VisuallyHidden>
          </HStack>
        )
      }
      sendActions={pane ? undefined : <Dictation onResult={text => talk.setValue((talk.value + ' ' + text).trim())} />}
      {...(talk.error ? { status: { type: 'error' as const, message: talk.error } } : {})}
    />
  );
}
