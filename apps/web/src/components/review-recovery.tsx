import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentReview } from '@clew/contracts';
import { Button, Card, CompletionFeedback, Heading, HStack, Text, TextInput, VStack, useToast } from '@clew/ui';
import { api } from '../api';
import { errorMessage } from '../query-policy';

/** Connector-described corrections use the existing human execution ledger, not a direct capability write. */
export function ReviewRecovery({
  document,
  editable,
  onSaved,
}: {
  document: DocumentReview;
  editable: boolean;
  onSaved: () => Promise<void>;
}) {
  const correction = editable ? document.recovery?.correction : undefined;
  const source = document.recovery?.source;
  const [values, setValues] = useState(() => Object.fromEntries(correction?.fields.map(f => [f.key, f.value]) ?? []));
  const [operation, setOperation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useQueryClient(),
    toast = useToast();
  const handled = useRef<string | null>(null);
  const latest = useRef(onSaved);
  latest.current = onSaved;
  const result = useQuery({
    queryKey: ['correction', operation],
    enabled: !!operation,
    queryFn: () => api.correctionExecution(operation!),
    refetchInterval: query => (['pending', 'running'].includes(query.state.data?.state ?? 'pending') ? 1500 : false),
  });
  const link = useQuery({
    queryKey: ['review-source', source?.capability, document.bundle.ref],
    enabled: !!source,
    queryFn: async () => {
      const { output } = await api.capability(source!.capability, { ref: document.bundle.ref });
      const value = (output as { url?: unknown })?.url;
      if (typeof value !== 'string') throw new Error('Källans länk saknas.');
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Källans länk är ogiltig.');
      return url.href;
    },
  });
  useEffect(() => {
    if (!operation || result.data?.state !== 'succeeded' || handled.current === operation) return;
    handled.current = operation;
    toast({
      body: (
        <CompletionFeedback
          title={result.data.result?.headline ?? 'Rättelsen är sparad'}
          detail="Granska det uppdaterade underlaget innan du skickar igen."
        />
      ),
      uniqueID: `correction:${operation}`,
      isAutoHide: true,
    });
    void latest.current().catch(e => setError(errorMessage(e, 'Underlaget kunde inte läsas om.')));
  }, [operation, result.data, toast]);
  const pending = !!operation && (!result.data || ['pending', 'running', 'unknown'].includes(result.data.state));
  const save = async () => {
    if (!correction || busy || pending) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { ref: document.bundle.ref, revision: document.bundle.revision, changes: values };
      const bytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify({ operation: correction.capability, payload })),
      );
      const decisionId =
        'correction:' + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
      const next = await api.approveCorrection({ decisionId, operation: correction.capability, payload });
      client.setQueryData(['correction', next.id], next);
      setOperation(next.id);
    } catch (e) {
      setError(errorMessage(e, 'Rättelsen kunde inte sparas.'));
    } finally {
      setBusy(false);
    }
  };
  if (!correction && !source) return null;
  return (
    <Card padding={3} variant="muted">
      <VStack gap={3}>
        {correction && (
          <>
            <Heading level={4} accessibilityLevel={3}>
              Rätta uppgifter
            </Heading>
            <Text type="supporting">Rättelsen sparas i källan. Attesten skickas först efter en ny granskning.</Text>
            {correction.fields.map(field => (
              <TextInput
                key={field.key}
                label={field.label}
                value={values[field.key] ?? ''}
                isRequired={field.required}
                status={
                  (values[field.key]?.length ?? 0) > field.maxLength
                    ? { type: 'error', message: `Högst ${field.maxLength} tecken.` }
                    : undefined
                }
                isReadOnly={pending || busy}
                onChange={value => setValues(v => ({ ...v, [field.key]: value }))}
              />
            ))}
            <HStack gap={2} wrap="wrap">
              <Button
                label={correction.label}
                isLoading={busy}
                isDisabled={
                  pending ||
                  correction.fields.every(f => values[f.key] === f.value) ||
                  correction.fields.some(
                    f => (f.required && !values[f.key]?.trim()) || (values[f.key]?.length ?? 0) > f.maxLength,
                  )
                }
                onClick={() => void save()}
              />
              {pending && (
                <Button
                  label="Kontrollera rättelsen"
                  clickAction={async () => {
                    try {
                      await api.checkCorrection(operation!);
                      await result.refetch();
                    } catch (e) {
                      setError(errorMessage(e, 'Rättelsen kunde inte kontrolleras.'));
                    }
                  }}
                />
              )}
            </HStack>
          </>
        )}
        {pending && (
          <Text role="status">
            {result.data?.state === 'unknown'
              ? 'Källans besked saknas. Kontrollera rättelsen innan du försöker igen.'
              : 'Rättelsen väntar på källans bekräftelse.'}
          </Text>
        )}
        {result.data && ['failed', 'partial'].includes(result.data.state) && (
          <Text role="alert">{result.data.result?.rows.map(r => r.detail).join(' ') || 'Rättelsen avvisades.'}</Text>
        )}
        {(error || result.isError) && (
          <Text role="alert">{error ?? errorMessage(result.error, 'Status kunde inte läsas.')}</Text>
        )}
        {source &&
          (link.data ? (
            <Button variant="ghost" label={source.label} href={link.data} target="_blank" rel="noopener noreferrer" />
          ) : link.isError ? (
            <Text role="alert">Källans länk kunde inte hämtas.</Text>
          ) : (
            <Text type="supporting">Hämtar länken till källan…</Text>
          ))}
      </VStack>
    </Card>
  );
}
