import { useMemo, useRef } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PanelViewSpec, SessionUser } from '@clew/contracts';
import {
  Banner,
  Button,
  EmptyState,
  Heading,
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  Skeleton,
  Text,
  VisuallyHidden,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { areasQuery, viewQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { withView } from '../panel-address';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { toolHref, useRail } from '../components/nav';
import { DeclaredView } from '../components/view';
import { CONVERSATION_MIN, PanelBody, panelBesideQuery, usePanel, type PanelFrame } from '../components/panel';
import { Composer, type ComposerAbout } from '../components/composer';

/** The table needs 970 px beside the rail, so a 1280 px laptop gets it, with a scrollbar too; a narrower window draws the same rows as a list. */
const tableQuery = '(min-width: 1280px)';
const parse = (json: string | null): Record<string, unknown> => {
  try {
    const v: unknown = json ? JSON.parse(json) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
type Shown = {
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
function useView(
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

/**
 * A tool as a page (D42): a view an administrator has chosen for the menu (D40) is opened at `/tools/:capability`,
 * inside the one shell, as Kalender is. The page follows Astryx's `table-page` template: the name as the heading, the
 * view's own search field and choice, then the rows, all in one scrolling column. The view is drawn by the one renderer
 * (D38). A row's own view, a contact card, opens in the panel: beside the page where there is room for both, over it
 * where there is not (D50); the address names both, so a reload, a link and the back button land where the person was.
 * The box at the foot asks about the page: the answer opens as a conversation with this view beside it.
 */
export function ToolPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: with 480 px or less in height nothing is pinned; the box joins the page's flow.
  const short = useMediaQuery(shortQuery);
  const besideTranscript = useMediaQuery(panelBesideQuery(CONVERSATION_MIN));
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
  const side = useView(opened, search.get('open-input'), {
    title: search.get('open-title') ?? opened ?? '',
    via: search.get('via') === '1',
    address,
  });
  const detail = side.shown;
  const title = detail?.title ?? entry?.label ?? (missing ? 'Verktyget finns inte' : null);
  usePageTitle(title, detail ? false : (title ?? false));
  const input = tool?.input ?? {};
  const failed =
    areasQ.isError && areasQ.data === undefined
      ? {
          message: errorMessage(areasQ.error, 'Sidan kunde inte läsas.'),
          retry: () => {
            void areasQ.refetch();
          },
        }
      : main.failed
        ? { message: errorMessage(main.failed, 'Kunde inte hämta.'), retry: main.retry }
        : side.failed
          ? { message: errorMessage(side.failed, 'Kunde inte hämta.'), retry: side.retry }
          : null;
  const frame: PanelFrame | null = detail
    ? {
        id: `view:${detail.capability}`,
        title: detail.title,
        address: detail.address,
        wide: detail.spec?.kind === 'table',
        onClose: () => navigate(toolHref(capability, input)),
        body: inline => (
          <PanelBody
            output={detail.output}
            view={detail.spec}
            input={detail.input}
            isLoading={side.isLoading}
            inline={inline}
            onInput={
              detail.capability === opened
                ? next =>
                    navigate(
                      toolHref(
                        capability,
                        input,
                        { capability: detail.capability, title: detail.title, input: next },
                        detail.via,
                      ),
                      { replace: true },
                    )
                : undefined
            }
            hrefFor={v => toolHref(capability, input, v, true)}
            onBack={detail.via ? () => navigate(-1) : undefined}
          />
        ),
      }
    : null;
  // A table keeps the width it needs: the panel is beside it only on a screen wide enough for both, else over it as before.
  const slot = usePanel(frame, { minMain: tool?.spec?.kind === 'table' ? 1060 : 600, overlayOnly: short });
  // What the box asks about (D50): this view with its search as it stands, which the conversation keeps beside the
  // transcript where both fit. On a narrower screen the conversation opens alone, and the view goes with it as a chip.
  const about: ComposerAbout | undefined = entry
    ? {
        label: entry.label,
        search: besideTranscript ? withView('', '', { capability, title: entry.label, input }) : '',
        chips: [{ ref: `capability:${capability}`, kind: 'capability', label: entry.label }],
      }
    : undefined;
  const box = !missing && <Composer place="page" about={about} />;
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {/* `padding={0}` on the content and the padding on the stack is the template's way to keep a table on the heading's line. */}
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        end={slot.end}
        footer={box && !short ? <LayoutFooter>{box}</LayoutFooter> : undefined}
        content={
          <LayoutContent padding={0}>
            <VStack paddingInline={mobile ? 3 : 8} paddingBlock={mobile ? 3 : 5} gap={4}>
              {missing ? (
                <EmptyState
                  headingLevel={1}
                  title="Verktyget finns inte"
                  description="Det är inte påslaget för dig, eller så har adressen ändrats."
                  actions={<Button label="Till startsidan" href="/" />}
                />
              ) : (
                <>
                  {/* The page's heading (artboard I): the view's name drawn at 20 px with its source under it; with a table it stands at the start of the controls' line. */}
                  {entry
                    ? !tool?.spec && (
                        <Heading level={2} accessibilityLevel={1}>
                          {entry.label}
                        </Heading>
                      )
                    : !failed && <Skeleton height={28} width={200} />}
                  {failed && (
                    <Banner status="error" title={failed.message}>
                      <Button label="Försök igen" size="sm" variant="secondary" onClick={failed.retry} />
                    </Banner>
                  )}
                  {tool ? (
                    tool.spec ? (
                      <DeclaredView
                        view={tool.spec}
                        output={tool.output}
                        input={tool.input}
                        isLoading={main.isLoading}
                        headingLevel={2}
                        tableQuery={tableQuery}
                        header={
                          <HStack gap={3} vAlign="center">
                            <VStack gap={0.5}>
                              <Heading level={2} accessibilityLevel={1}>
                                {entry!.label}
                              </Heading>
                              <Text type="supporting">{tool.spec.source}</Text>
                            </VStack>
                          </HStack>
                        }
                        /* The view's controls rewrite the address in place, so a search is addressable and one step back leaves the tool. */
                        onInput={next => navigate(toolHref(capability, next), { replace: true })}
                        hrefFor={v => toolHref(capability, tool.input, v)}
                      />
                    ) : (
                      <EmptyState headingLevel={2} title="Inget att visa" />
                    )
                  ) : (
                    !failed && (
                      <VStack gap={3}>
                        <VisuallyHidden>Hämtar …</VisuallyHidden>
                        {Array.from({ length: 6 }, (_, i) => (
                          <Skeleton key={i} height={20} width={i % 2 ? '70%' : '100%'} index={i} />
                        ))}
                      </VStack>
                    )
                  )}
                  {short && box}
                </>
              )}
            </VStack>
          </LayoutContent>
        }
      />
      {slot.overlay}
    </Shell>
  );
}
