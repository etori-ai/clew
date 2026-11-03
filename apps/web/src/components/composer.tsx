import { useRef, useState } from 'react';
import type { Thread } from '@clew/contracts';
import { ChatComposer, ChatComposerInput, ChatDictationButton, Heading, HStack, List, ListItem, Text, VStack, useChatDictation } from '@clew/ui';

type Props = { completions: string[]; openThreads: Thread[]; busy: boolean; onAsk: (question: string) => Promise<void>; heading?: boolean };

/** Microphone inside the composer; the browser's speech recognition writes into the same input. */
function Dictation({ onResult }: { onResult: (text: string) => void }) {
  const dictation = useChatDictation({ lang: 'sv-SE', onResult });
  return <ChatDictationButton dictation={dictation} />;
}

/**
 * The question box is the page: one composer card with suggestion chips, and a "Menar du" list under it while typing
 * that also offers the open threads to continue. The answer unfolds as a thread under the box; nothing overlays.
 */
export function QuestionComposer({ completions, openThreads, busy, onAsk, heading = true }: Props) {
  const [value, setValue] = useState('');
  const submitting = useRef(false);
  const submit = async (text: string) => {
    const question = text.trim();
    if (!question || submitting.current) return;
    submitting.current = true;
    try { await onAsk(question); setValue(''); } finally { submitting.current = false; }
  };
  const query = value.trim().toLowerCase();
  const matches = query.length >= 2 ? completions.filter(c => c.toLowerCase().includes(query) && c.toLowerCase() !== query).slice(0, 4) : [];
  const continuing = query.length >= 2 ? openThreads.filter(t => t.title.toLowerCase().includes(query)).slice(0, 3) : [];
  // The composer row from the canvas: one line, the scope as a prefix, nothing above it until you type.
  return <VStack gap={2}>
    {heading && <Heading level={1}>Vad vill du få gjort?</Heading>}
    <ChatComposer value={value} onChange={setValue} onSubmit={text => void submit(text)} isDisabled={busy} density="compact" elevation="low"
      placeholder="Fråga, be om något eller svara i en tråd …"
      input={<ChatComposerInput label="Fråga, be om något eller svara i en tråd" maxRows={3} hasHistory={false} />}
      sendActions={<Dictation onResult={text => setValue(current => (current + ' ' + text).trim())} />}
      headerContext={<HStack gap={1} vAlign="center"><Text type="supporting" weight="semibold">Allt</Text><Text type="supporting">· svaret kommer under frågan</Text></HStack>} />
    {(matches.length > 0 || continuing.length > 0) && <List hasDividers density="compact" aria-label="Förslag">
      {matches.length > 0 && <ListItem label={<Text type="supporting" weight="semibold">Menar du</Text>} />}
      {matches.map(c => <ListItem key={c} label={c} onClick={() => void submit(c)} />)}
      {continuing.length > 0 && <ListItem label={<Text type="supporting" weight="semibold">Fortsätt tråd</Text>} />}
      {continuing.map(t => <ListItem key={t.id} label={t.title} description={`${t.trigger.source} · väntar på dig`} href={`#thread-${t.id}`} />)}
    </List>}
  </VStack>;
}
