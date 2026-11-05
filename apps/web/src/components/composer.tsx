import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClewObject } from '@clew/contracts';
import { Button, ChatComposer, ChatComposerDrawer, ChatComposerInput, ChatDictationButton, DropdownMenu, DropdownMenuRadioGroup, DropdownMenuRadioItem, HStack, Kbd, Text, Token, useChatDictation, useToast, type ChatComposerTrigger, type SearchableItem } from '@clew/ui';
import { api } from '../api';
import { assistantQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage } from '../query-policy';
import { tokenValue, useConversation } from './conversation-context';

/**
 * The model choice (D24), in the composer's footer slot that Astryx keeps for a model selector: the person's models
 * with what each is good for, shown only when they have more than one. Choosing saves their own preference on the
 * server, which resolves the model on every question; the toast says which one the next question uses.
 */
function ModelMenu({ isDisabled }: { isDisabled: boolean }) {
  const status = useQuery(assistantQuery).data;
  const client = useQueryClient();
  const toast = useToast();
  const choose = useMutation({
    mutationFn: (modelId: string) => api.chooseModel(modelId),
    onSuccess: next => { client.setQueryData(keys.assistant, next); toast({ body: `Nästa fråga besvaras av ${next.current?.title ?? 'den inbyggda routern'}.`, uniqueID: 'model-choice' }); },
    onError: e => toast({ body: errorMessage(e, 'Modellen kunde inte väljas.'), isAutoHide: false, uniqueID: 'model-choice' }),
  });
  if (!status || status.choices.length < 2 || !status.current) return null;
  const current = status.current;
  return <DropdownMenu button={{ label: `Modell: ${current.title}`, children: current.title, variant: 'ghost', size: 'sm', isDisabled: isDisabled || choose.isPending }} menuWidth={280}>
    <DropdownMenuRadioGroup label="Modell" value={current.id} onChange={id => { if (id !== current.id) choose.mutate(id); }}>
      {status.choices.map(c => <DropdownMenuRadioItem key={c.id} value={c.id} label={c.isDefault ? `${c.title} (standard)` : c.title} description={c.description || undefined} />)}
    </DropdownMenuRadioGroup>
  </DropdownMenu>;
}

/** Microphone inside the composer; the browser's speech recognition writes into the same input. */
function Dictation({ onResult }: { onResult: (text: string) => void }) {
  const dictation = useChatDictation({ lang: 'sv-SE', onResult });
  return <ChatDictationButton dictation={dictation} />;
}
/**
 * The conversation row (D31): Astryx's ChatComposer, docked by ChatLayout. The chips the person pointed at sit in the
 * composer's drawer as removable tokens; `@` in the field inserts a token for anything on the page. With one chip and
 * nothing typed the footer offers the verbs about it. The row keeps focus throughout; sending never moves it.
 */
export function Composer() {
  const talk = useConversation();
  // `@` in the row: what is on the page first, then everything in scope.
  const trigger = useMemo<ChatComposerTrigger>(() => {
    const toItems = (objects: ClewObject[]): SearchableItem<ClewObject>[] => objects.map(o => ({ id: o.ref, label: o.label, auxiliaryData: o }));
    return {
      character: '@', hasMultiWordQuery: true, menuLabel: 'Objekt', emptySearchText: 'Inget på sidan matchar', loadingText: 'Söker …',
      searchSource: { search: async q => toItems((await api.objects(q)).objects), bootstrap: async () => toItems((await api.objects('')).objects), cancel: () => undefined },
      renderItem: item => { const o = (item as SearchableItem<ClewObject>).auxiliaryData; return <HStack gap={2} vAlign="center" justify="between"><Text>{item.label}</Text>{o && <Text type="supporting">{o.detail}</Text>}</HStack>; },
      onSelect: item => { const o = (item as SearchableItem<ClewObject>).auxiliaryData!; talk.rememberObject(o); return { value: tokenValue(o.ref), label: o.label, variant: 'neutral' }; },
    };
  }, [talk.rememberObject]);
  const placeholder = talk.open ? 'Fråga vidare … (fokus ligger kvar här)' : 'Fråga, be om något, eller @ för att peka på något på sidan …';
  const plain = talk.value.replace(/@\[[^\]]+\]/g, '').trim();
  return <ChatComposer value={talk.value} onChange={talk.setValue} onSubmit={text => void talk.submit(text)} isDisabled={talk.busy} density="compact" elevation="low" placeholder={placeholder}
    drawer={talk.chips.length > 0 ? <ChatComposerDrawer count={talk.chips.length} label="Objekt i samtalet">
      {talk.chips.map(c => <Token key={c.ref} label={c.label} onRemove={() => talk.removeChip(c.ref)} data-chip-remove="" />)}
    </ChatComposerDrawer> : undefined}
    input={<ChatComposerInput handleRef={talk.input} label="Fråga, be om något eller svara om ett kort" maxRows={3} hasHistory={false} triggers={[trigger]} placeholder={placeholder} />}
    headerActions={<Text type="supporting"><Text as="span" weight="semibold" color="primary">{talk.open ? 'Samtalet' : 'Allt'}</Text> · svaret kommer under frågan</Text>}
    headerContext={<Kbd keys="mod+k" />}
    footerActions={<HStack gap={1} wrap="wrap">
      {talk.chips.length === 1 && !plain && talk.verbs.length > 0 && <HStack gap={1} wrap="wrap" role="group" aria-label="Om kortet">{talk.verbs.map(v => <Button key={v.id} size="sm" variant="ghost" label={v.label} isDisabled={talk.busy} onClick={() => talk.ask(v.label)} />)}</HStack>}
      <ModelMenu isDisabled={talk.busy} />
    </HStack>}
    sendActions={<Dictation onResult={text => talk.setValue((talk.value + ' ' + text).trim())} />}
    status={talk.error ? { type: 'error', message: talk.error } : undefined} />;
}
