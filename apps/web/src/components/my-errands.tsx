import { useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { viewRows, type Area, type ViewRef } from '@clew/contracts';
import { Button, Card, Heading, HStack, Text, VStack } from '@clew/ui';
import { viewQuery } from '../queries';
import { AsyncContent, ContentSkeleton } from './loading';
import { DeclaredView } from './view';

/** The combined errand list (D35 item 4, D89) and the area that offers it. */
export const ERRANDS_CAPABILITY = 'clew.errands';
export const ERRANDS_AREA = 'arenden';
/** How many errands Hem shows before the person asks for the rest: what waits on them comes first, so these are the ones that matter. */
const ROWS = 5;

/** Whether the person has a case system: the server offers the errand area only then (D89). */
export const hasErrands = (areas: Area[]) => areas.some(a => a.standing.some(s => s.capability === ERRANDS_CAPABILITY));

/**
 * Mina ärenden on Hem (D90): the person's errands from every case system as one list in the page's own column, after
 * the day's work. It is the combined list's declared view drawn by the one renderer, with its own choice between what
 * is assigned and what the person reported, the first rows and a button for the rest. A row opens the errand beside
 * the page, in the system it came from. Nothing is stored: the list is read as the person each time Hem is.
 *
 * It is drawn only for a person with a case system, and it never says "no errands" when the systems did not answer:
 * the read fails then, and the section says so with a way to try again.
 */
export function MyErrands({ areas, hrefFor }: { areas: Area[]; hrefFor: (view: ViewRef) => string }) {
  const offered = hasErrands(areas);
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [all, setAll] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useQuery({
    ...viewQuery(ERRANDS_CAPABILITY, Object.keys(input).length ? JSON.stringify(input) : null),
    enabled: offered,
    placeholderData: keepPreviousData,
    retry: false,
  });
  if (!offered) return null;
  const view = read.data?.view;
  const total = view ? (viewRows(view, read.data?.output)?.length ?? 0) : 0;
  const showAll = () => {
    setAll(true);
    // The button is gone once every row is shown, so the focus goes to the section's heading and not to the page's top.
    heading.current?.focus();
  };
  return (
    <VStack gap={2} as="section" aria-label="Mina ärenden">
      <Heading ref={heading} id="mina-arenden" tabIndex={-1} level={3} accessibilityLevel={2}>
        Mina ärenden
      </Heading>
      <AsyncContent
        pending={read.isPending}
        fallback={<ContentSkeleton label="Hämtar dina ärenden …" rows={3} heading={false} />}
        gap={2}
      >
        {view ? (
          <>
            <Card>
              <DeclaredView
                view={view}
                output={read.data?.output}
                input={input}
                onInput={next => {
                  setAll(false);
                  setInput(next);
                }}
                hrefFor={hrefFor}
                isLoading={read.isFetching && read.isPlaceholderData}
                {...(all ? {} : { limit: ROWS })}
              />
            </Card>
            {!all && total > ROWS && (
              <HStack>
                <Button size="sm" variant="secondary" label={`Visa alla ${total} ärenden`} onClick={showAll} />
              </HStack>
            )}
          </>
        ) : (
          <VStack gap={2}>
            <Text as="p" role="alert">
              {read.error instanceof Error ? read.error.message : 'Ärendena kunde inte hämtas just nu.'}
            </Text>
            <HStack>
              <Button
                size="sm"
                variant="secondary"
                label="Försök igen"
                isLoading={read.isFetching}
                onClick={() => void read.refetch()}
              />
            </HStack>
          </VStack>
        )}
      </AsyncContent>
    </VStack>
  );
}
