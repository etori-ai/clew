import { useMemo, useState } from 'react';
import { Button, Typeahead, createStaticSource } from '@clew/ui';

type Item = { id: string; label: string };
/** The question box is the page. Typeahead completions on desktop; the same box opens in a bottom sheet on a phone. */
export function QuestionBox({ completions, onAsk, busy }: { completions: string[]; onAsk: (question: string) => Promise<void>; busy: boolean }) {
  const [value, setValue] = useState<Item | null>(null);
  const [query, setQuery] = useState('');
  const source = useMemo(() => createStaticSource<Item>(completions.map(c => ({ id: c, label: c }))), [completions]);
  const question = (value?.label ?? query).trim();
  const submit = async () => { if (!question) return; await onAsk(question); setValue(null); setQuery(''); };
  return <form className="question" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <Typeahead<Item> label="Vad vill du veta eller göra?" placeholder="Fråga om dagen, läget eller samtalen …" searchSource={source} value={value}
      onChange={item => { setValue(item); if (item) setQuery(item.label); }} onChangeQuery={setQuery} hasEntriesOnFocus minQueryLength={0} debounceMs={0} size="lg"
      emptySearchText="Skicka frågan som den är" />
    <div className="thread-actions">
      <Button type="submit" variant="primary" label="Fråga" isDisabled={!question || busy} isLoading={busy} />
    </div>
  </form>;
}
