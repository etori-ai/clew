import { useMemo, useRef } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PanelViewSpec } from '@clew/contracts';
import { viewQuery } from '../queries';

const parse = (json: string | null): Record<string, unknown> => {
  try {
    const v: unknown = json ? JSON.parse(json) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
export type Shown = {
  capability: string;
  title: string;
  output: unknown;
  spec: PanelViewSpec | undefined;
  input: Record<string, unknown>;
  via: boolean;
  address: string;
};

/**
 * One view read for an address. What is on screen stays until the next answer has arrived: typing in a view's own field
 * keeps its rows, and a view that takes another's place does so with its title, in one step.
 */
export function useView(
  capability: string | null,
  inputJson: string | null,
  at: { title: string; via: boolean; address: string },
) {
  const query = useQuery({
    ...viewQuery(capability ?? '', inputJson),
    enabled: !!capability,
    placeholderData: keepPreviousData,
  });
  const input = useMemo(() => parse(inputJson), [inputJson]);
  const shown = useRef<Shown | null>(null);
  const arrived =
    query.data && (!query.isPlaceholderData || query.data.view?.capability === capability) ? query.data : undefined;
  if (!capability || query.isError) shown.current = null;
  else if (arrived)
    shown.current = {
      capability,
      title: at.title,
      output: arrived.output,
      spec: arrived.view,
      input,
      via: at.via,
      address: at.address,
    };
  return {
    shown: capability ? shown.current : null,
    isLoading: query.isFetching && query.isPlaceholderData,
    failed: query.isError ? query.error : null,
    retry: () => {
      void query.refetch();
    },
  };
}
