import { useMemo, useRef } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PanelViewSpec, SessionUser } from '@clew/contracts';
import { Banner, Button, EmptyState, Heading, Layout, LayoutContent, Skeleton, VisuallyHidden, VStack, useMediaQuery } from '@clew/ui';
import { areasQuery, viewQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { Shell, mobileQuery } from '../components/shell';
import { toolHref, useRail } from '../components/nav';
import { DeclaredView } from '../components/view';
import { PanelView } from '../components/panel';

/** The table needs about 960 px beside the rail, so a 1280 px laptop gets it; a narrower window draws the same rows as a list. */
const tableQuery = '(min-width: 1260px)';
const parse = (json: string | null): Record<string, unknown> => { try { const v: unknown = json ? JSON.parse(json) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; } };
type Shown = { capability: string; title: string; output: unknown; spec: PanelViewSpec | undefined; input: Record<string, unknown>; via: boolean; address: string };

/**
 * One view read for an address. What is on screen stays until the next answer has arrived: typing in a view's own field
 * keeps its rows, and a view that takes another's place does so with its title, in one step.
 */
function useView(capability: string | null, inputJson: string | null, at: { title: string; via: boolean; address: string }) {
  const query = useQuery({ ...viewQuery(capability ?? '', inputJson), enabled: !!capability, placeholderData: keepPreviousData });
  const input = useMemo(() => parse(inputJson), [inputJson]);
  const shown = useRef<Shown | null>(null);
  const arrived = query.data && (!query.isPlaceholderData || query.data.view?.capability === capability) ? query.data : undefined;
  if (!capability || query.isError) shown.current = null;
  else if (arrived) shown.current = { capability, title: at.title, output: arrived.output, spec: arrived.view, input, via: at.via, address: at.address };
  return { shown: capability ? shown.current : null, isLoading: query.isFetching && query.isPlaceholderData, failed: query.isError ? query.error : null, retry: () => { void query.refetch(); } };
}

/**
 * A tool as a page (D42): a view an administrator has chosen for the menu (D40) is opened at `/tools/:capability`,
 * inside the one shell, as Kalender is. The page follows Astryx's `table-page` template: the name as the heading, the
 * view's own search field and choice, then the rows, all in one scrolling column. The view is drawn by the one renderer
 * (D38). A row's own view, a contact card, opens in the side panel over the page, as an entry does on the calendar; the
 * address names both, so a reload, a link and the back button land where the person was.
 */
export function ToolPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const { capability = '' } = useParams<{ capability: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const address = location.pathname + location.search;
  const areasQ = useQuery(areasQuery);
  // A tool is a row the person has in the menu: a view that is not chosen, or not theirs, has no page.
  const entry = areasQ.data?.menu?.find(e => e.capability === capability) ?? null;
  const missing = areasQ.data !== undefined && !entry;
  const nav = useRail({ current: { surface: 'verktyg', view: capability }, admin });
  const inputJson = search.get('input');
  const main = useView(entry ? capability : null, inputJson, { title: entry?.label ?? '', via: false, address });
  const tool = main.shown?.capability === capability ? main.shown : null;
  const opened = entry ? search.get('open') : null;
  const side = useView(opened, search.get('open-input'), { title: search.get('open-title') ?? opened ?? '', via: search.get('via') === '1', address });
  const detail = side.shown;
  const title = detail?.title ?? entry?.label ?? (missing ? 'Verktyget finns inte' : null);
  usePageTitle(title, detail ? false : title ?? false);
  const input = tool?.input ?? {};
  const failed = areasQ.isError && areasQ.data === undefined ? { message: errorMessage(areasQ.error, 'Sidan kunde inte läsas.'), retry: () => { void areasQ.refetch(); } }
    : main.failed ? { message: errorMessage(main.failed, 'Kunde inte hämta.'), retry: main.retry }
    : side.failed ? { message: errorMessage(side.failed, 'Kunde inte hämta.'), retry: side.retry } : null;
  return <Shell user={user} nav={nav}>
    {/* `padding={0}` on the content and the padding on the stack is the template's way to keep a table on the heading's line. */}
    <Layout height="fill" contentWidth={tool?.spec?.kind === 'table' ? 1180 : 720} content={<LayoutContent padding={0}>
      <VStack padding={mobile ? 3 : 4} gap={6}>
        {missing
          ? <EmptyState headingLevel={1} title="Verktyget finns inte" description="Det är inte påslaget för dig, eller så har adressen ändrats." actions={<Button label="Till startsidan" href="/" />} />
          : <>
            {entry ? <Heading level={1}>{entry.label}</Heading> : !failed && <Skeleton height={28} width={200} />}
            {failed && <Banner status="error" title={failed.message}><Button label="Försök igen" size="sm" variant="secondary" onClick={failed.retry} /></Banner>}
            {tool
              ? tool.spec
                ? <DeclaredView view={tool.spec} output={tool.output} input={tool.input} isLoading={main.isLoading} headingLevel={2} tableQuery={tableQuery}
                  /* The view's controls rewrite the address in place, so a search is addressable and one step back leaves the tool. */
                  onInput={next => navigate(toolHref(capability, next), { replace: true })}
                  hrefFor={v => toolHref(capability, tool.input, v)} />
                : <EmptyState headingLevel={2} title="Inget att visa" />
              : !failed && <VStack gap={3}>
                <VisuallyHidden>Hämtar …</VisuallyHidden>
                {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={20} width={i % 2 ? '70%' : '100%'} index={i} />)}
              </VStack>}
          </>}
      </VStack>
    </LayoutContent>} />
    <PanelView title={detail?.title ?? null} output={detail?.output} view={detail?.spec} input={detail?.input ?? {}} isLoading={side.isLoading} address={detail?.address}
      onClose={() => navigate(toolHref(capability, input))}
      onInput={detail && detail.capability === opened ? next => navigate(toolHref(capability, input, { capability: detail.capability, title: detail.title, input: next }, detail.via), { replace: true }) : undefined}
      hrefFor={v => toolHref(capability, input, v, true)} onBack={detail?.via ? () => navigate(-1) : undefined} />
  </Shell>;
}
