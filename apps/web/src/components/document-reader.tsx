import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentBundle, DocumentDescriptor } from '@clew/contracts';
import {
  Button,
  ArrowDownTrayIcon,
  DocumentSurface,
  HStack,
  Icon,
  Selector,
  StackItem,
  Text,
  VStack,
  type DocumentPosition,
} from '@clew/ui';
import { api } from '../api';
import { errorMessage } from '../query-policy';
import { documentQuery } from '../queries';
import { keys } from '../query-keys';

export function DocumentReader({
  bundle,
  capability,
  input,
  compact,
  onReady,
}: {
  bundle: DocumentBundle;
  capability: string;
  input: Record<string, unknown>;
  compact?: boolean;
  onReady?: (id: string, revision: string, ready: boolean) => void;
}) {
  const [selected, setSelected] = useState(bundle.documents[0]!.id);
  const [positions, setPositions] = useState<Record<string, DocumentPosition>>({});
  const document = bundle.documents.find(d => d.id === selected) ?? bundle.documents[0]!;
  const key = bundle.revision + ':' + document.id + ':' + document.revision;
  if (compact)
    return (
      <Text>
        {bundle.title} · {bundle.documents.length} dokument. Öppna vyn för att läsa underlagen.
      </Text>
    );
  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="end">
        <StackItem size="fill">
          <Selector
            label="Dokument och bilagor"
            isLabelHidden
            value={document.id}
            onChange={setSelected}
            width="100%"
            options={bundle.documents.map(d => ({
              value: d.id,
              label: `${d.title}${d.required ? ' · krävs för beslut' : ''}`,
            }))}
          />
        </StackItem>
        <Button
          variant="ghost"
          isIconOnly
          icon={<Icon icon={ArrowDownTrayIcon} />}
          label="Hämta originalet"
          tooltip={`Hämta ${document.filename} · ${(document.size / 1024).toLocaleString('sv-SE', { maximumFractionDigits: 0 })} kB`}
          href={api.documentHref({
            capability,
            input,
            ref: bundle.ref,
            revision: bundle.revision,
            document: document.id,
            documentRevision: document.revision,
          })}
        />
      </HStack>
      <Document
        key={key}
        bundle={bundle}
        document={document}
        capability={capability}
        input={input}
        onReady={onReady}
        position={positions[key]}
        onPosition={position => setPositions(prev => ({ ...prev, [key]: position }))}
      />
    </VStack>
  );
}
function Document({
  bundle,
  document,
  capability,
  input,
  onReady,
  position,
  onPosition,
}: {
  bundle: DocumentBundle;
  document: DocumentDescriptor;
  capability: string;
  input: Record<string, unknown>;
  onReady?: (id: string, revision: string, ready: boolean) => void;
  position?: DocumentPosition;
  onPosition: (position: DocumentPosition) => void;
}) {
  const request = {
    capability,
    input,
    ref: bundle.ref,
    revision: bundle.revision,
    document: document.id,
    documentRevision: document.revision,
  };
  const callbacks = useRef(onReady);
  callbacks.current = onReady;
  const client = useQueryClient();
  const content = useQuery(documentQuery(request));
  useEffect(() => {
    if (content.isFetching || content.isError) callbacks.current?.(document.id, document.revision, false);
  }, [content.isFetching, content.isError]);
  return (
    <VStack gap={2}>
      {content.isFetching || content.isPending ? (
        <Text role="status">Hämtar underlaget …</Text>
      ) : content.isError ? (
        <VStack gap={2}>
          <Text role="alert">{errorMessage(content.error, 'Underlaget kunde inte läsas.')}</Text>
          <HStack gap={2} wrap="wrap">
            <Button label="Försök igen" variant="secondary" onClick={() => void content.refetch()} />
            <Button
              label="Läs in underlagen igen"
              variant="ghost"
              onClick={() => {
                void client.invalidateQueries({ queryKey: keys.viewAll });
                void client.invalidateQueries({ queryKey: keys.previewAll });
              }}
            />
          </HStack>
        </VStack>
      ) : (
        <DocumentSurface
          bytes={content.data}
          document={document}
          position={position}
          onPosition={onPosition}
          onReady={() => callbacks.current?.(document.id, document.revision, true)}
          onError={() => callbacks.current?.(document.id, document.revision, false)}
        />
      )}
    </VStack>
  );
}
