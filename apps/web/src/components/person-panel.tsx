import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { EntityAction, EntityDetail } from '@clew/contracts';
import {
  Avatar,
  Button,
  DropdownMenu,
  EmptyState,
  HStack,
  Icon,
  Link,
  Text,
  VStack,
  useAnimatedLayout,
  useMediaQuery,
} from '@clew/ui';
import { ApiError } from '../api';
import { entityDetailQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { actionMenuItems, useEntityAction } from '../entity-actions';
import {
  PERSON,
  PERSON_SECTION,
  originLabel,
  personPageHref,
  withPersonSection,
  withoutPerson,
} from '../person-address';
import { usePanel, type PanelFrame, type PanelSize } from './panel';
import { mobileQuery, shortQuery } from './shell';
import {
  NEEDS_YOU,
  NeedsYouSection,
  PersonLine,
  PersonSections,
  SectionNav,
  SourceSection,
  drawnSections,
  sectionNavRows,
  useSectionAnswers,
  type SectionAnswer,
} from './entity-sections';

/**
 * The person opened beside a list (D97 item 5, D83 rule 1): the selection is `?person=<key>` in the address of the page
 * that shows the list. The page spreads `end` into its `Layout`, renders `overlay`, and draws its list compact while
 * `occupied` is true.
 */
export interface PersonPanelSlot {
  end: ReactNode | undefined;
  overlay: ReactNode;
  /** Whether the person takes width beside the page. */
  occupied: boolean;
  /** The key in the address, whether or not the panel fits beside the page. */
  person: string | undefined;
  /** The opened person's name once it has arrived, for the page's title. */
  name: string | undefined;
}
/** The address of a person opened beside the list at `pathname`, keeping the list's own selection (`search`). */
export const personHref = (pathname: string, search: string, key: string): string => {
  const params = new URLSearchParams(search);
  params.delete(PERSON_SECTION);
  params.set(PERSON, key);
  return pathname + '?' + params.toString();
};
/** The person's panel is wider than the shared one (artboard C: 520 to 600 px), its width remembered on its own. */
const PERSON_PANEL: PanelSize = { default: 560, min: 440, max: 640, id: 'clew-person-panel-width' };
/** What the list beside the person keeps: its names and one mark each (artboard C). */
const LIST_MIN = 440;

/**
 * The opened person's actions (artboard C): the first two as buttons, the rest under Fler grouped by the system they
 * act in, as the row menu on Personal is (artboard A3), and the way to the person's page. On a phone one button,
 * Åtgärder, the width of the drawer, holds them all (artboard D). An action starts on the server and opens its card
 * (`entity-actions.ts`); a source's refusal is said aloud and stands under the buttons until the next action.
 */
export function PersonActions({
  detail,
  mobile,
  pageHref,
}: {
  detail: EntityDetail;
  mobile: boolean;
  pageHref?: string;
}) {
  const { start, error } = useEntityAction();
  const { kind, key, name } = detail.entity;
  const run = (a: EntityAction) => start(a, { kind, key, name });
  const actions = detail.actions;
  const refusal = error ? <Text as="p">{error}</Text> : null;
  if (mobile)
    return actions.length > 0 ? (
      <VStack gap={2}>
        <DropdownMenu
          renderTrigger={trigger => (
            <Button
              {...trigger}
              variant="secondary"
              label="Åtgärder"
              aria-label={`Åtgärder för ${name}`}
              width="100%"
            />
          )}
          presentation="adaptive"
          items={actionMenuItems(actions, run)}
        />
        {refusal}
      </VStack>
    ) : null;
  const shown = actions.slice(0, 2),
    rest = actions.slice(2);
  if (shown.length === 0 && !pageHref) return null;
  const buttons = (
    <HStack gap={2} wrap="wrap" vAlign="center">
      {shown.map(a => (
        <Button key={a.capability} variant="secondary" label={a.title} onClick={() => run(a)} />
      ))}
      {rest.length > 0 && (
        // The menu is named by its button, which says whose actions they are (Astryx's renderTrigger).
        <DropdownMenu
          renderTrigger={trigger => (
            <Button {...trigger} variant="secondary" label="Fler" aria-label={`Fler åtgärder för ${name}`} />
          )}
          presentation="adaptive"
          items={actionMenuItems(rest, run)}
        />
      )}
      {pageHref && (
        <Link href={pageHref} weight="semibold" isStandalone>
          Öppna som sida
        </Link>
      )}
    </HStack>
  );
  // One shape with or without a refusal, so the button that was pressed keeps the focus when the refusal appears.
  return (
    <VStack gap={2}>
      {buttons}
      {refusal}
    </VStack>
  );
}

/** Beside the list, and over it on a narrow window: the actions, then every section as it arrives. */
function PersonBody({
  detail,
  answers,
  pageHref,
  fullerHref,
}: {
  detail: EntityDetail;
  answers: SectionAnswer[];
  pageHref: string;
  fullerHref: (capability: string) => string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const animatedLayout = useAnimatedLayout({ containerRef: root });
  const settled = answers.every(a => !a.query.isPending);
  const nothing = detail.cards.length === 0 && drawnSections(answers).length === 0;
  return (
    <VStack ref={root} gap={5}>
      <PersonActions detail={detail} mobile={false} pageHref={pageHref} />
      {settled && nothing ? (
        <EmptyState isCompact headingLevel={3} title={`Inget mer att visa om ${detail.entity.name}`} />
      ) : (
        <PersonSections
          cards={detail.cards}
          answers={answers}
          personKey={detail.entity.key}
          personId={detail.entity.id}
          name={detail.entity.name}
          fullerHref={fullerHref}
          animatedLayout={animatedLayout}
        />
      )}
    </VStack>
  );
}

/**
 * On a phone (artboard D): Åtgärder, then the sections as rows with one line each, a row leading into its section
 * (`person-section` in the address) and Tillbaka out of it. Focus follows: into the section it lands on Tillbaka, out
 * of it on the row it came from.
 */
function PhoneBody({
  detail,
  answers,
  drill,
  rowHref,
  fullerHref,
}: {
  detail: EntityDetail;
  answers: SectionAnswer[];
  drill: string | undefined;
  rowHref: (section: string | null) => string;
  fullerHref: (capability: string) => string;
}) {
  const back = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const last = useRef(drill);
  useEffect(() => {
    const was = last.current;
    last.current = drill;
    if (was === drill) return;
    if (drill) back.current?.focus();
    else if (was) root.current?.querySelector<HTMLElement>(`a[href="${CSS.escape(rowHref(was))}"]`)?.focus();
  }, [drill]);
  const answer = drill ? answers.find(a => a.source.capability === drill) : undefined;
  const { key, name, id } = detail.entity;
  return (
    <VStack ref={root} gap={4}>
      <PersonActions detail={detail} mobile />
      {drill && (drill === NEEDS_YOU || answer) ? (
        <VStack gap={3}>
          <HStack>
            <Button
              ref={back}
              size="sm"
              variant="ghost"
              label="Tillbaka"
              aria-label={`Tillbaka till ${name}`}
              icon={<Icon icon="chevronLeft" />}
              href={rowHref(null)}
            />
          </HStack>
          {drill === NEEDS_YOU ? (
            <NeedsYouSection cards={detail.cards} />
          ) : (
            answer && (
              <SourceSection
                answer={answer}
                personKey={key}
                personId={id}
                fullerHref={fullerHref(answer.source.capability)}
              />
            )
          )}
        </VStack>
      ) : (
        <SectionNav label={`Om ${name}`} rows={sectionNavRows(detail.cards, answers, rowHref, undefined)} />
      )}
    </VStack>
  );
}

/**
 * The person beside the list (D97 item 5, artboard C), in the one panel (D50), wired as a tool's page wires its view:
 * opening moves focus to the person's name, Esc and ✕ close and give focus back to the link that opened them, one person
 * taking another's place is named aloud, and where the panel does not fit beside the list it is the drawer over it.
 */
export function usePersonPanel(): PersonPanelSlot {
  const [search] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: on a short screen nothing is pinned beside the page, as on a tool's page.
  const short = useMediaQuery(shortQuery);
  const key = search.get(PERSON) || undefined;
  const drill = search.get(PERSON_SECTION) || undefined;
  // The person on screen stays until the next one has arrived: one takes the other's place in one step.
  const read = useQuery({
    ...entityDetailQuery('person', key ?? ''),
    enabled: !!key,
    placeholderData: keepPreviousData,
  });
  const detail = key && !read.isError ? read.data : undefined;
  const answers = useSectionAnswers(detail?.entity.key, detail?.sections ?? []);
  const missing = !!key && read.isError && read.error instanceof ApiError && read.error.status === 404;
  const list = withoutPerson(pathname, search);
  // The unit's page leads back here, with the person still open (D83 rule 4).
  const here = search.toString() ? `${pathname}?${search.toString()}` : pathname;
  const close = () => navigate(list);
  const origin = originLabel(pathname) ?? 'listan';
  const frame: PanelFrame | null = !key
    ? null
    : detail
      ? {
          id: `person:${detail.entity.key}`,
          title: detail.entity.name,
          // On a phone the drawer's start is the way back, a link to the list named after where the person was opened
          // ("‹ Personal", artboard D).
          lead: mobile ? (
            <Button
              size="sm"
              variant="ghost"
              label={origin}
              aria-label={`Tillbaka till ${origin}`}
              icon={<Icon icon="chevronLeft" />}
              href={list}
            />
          ) : (
            <Avatar name={detail.entity.name} size={48} tooltip={false} aria-hidden />
          ),
          ...(detail.entity.detail || detail.entity.unit
            ? { subtitle: <PersonLine entity={detail.entity} relation={detail.relation} from={here} /> }
            : {}),
          // The address of the link that opened the person: a list drawn compact beside the panel draws its rows
          // anew, so the focus finds the row by where it leads when the person is closed.
          address: personHref(pathname, withoutPerson('', search), detail.entity.key),
          onClose: close,
          body: () =>
            mobile ? (
              <PhoneBody
                detail={detail}
                answers={answers}
                drill={drill}
                rowHref={section => withPersonSection(pathname, search, section)}
                fullerHref={section => personPageHref(detail.entity.key, { section, from: list })}
              />
            ) : (
              <PersonBody
                detail={detail}
                answers={answers}
                pageHref={personPageHref(detail.entity.key, { from: list })}
                fullerHref={section => personPageHref(detail.entity.key, { section, from: list })}
              />
            ),
        }
      : missing
        ? {
            id: `person:${key}`,
            title: 'Personen finns inte',
            onClose: close,
            body: () => (
              <Text as="p">Det finns ingen sådan person, eller så har du inte tillgång till uppgifterna om hen.</Text>
            ),
          }
        : read.isError
          ? {
              id: `person:${key}`,
              title: 'Personen kunde inte hämtas',
              onClose: close,
              body: () => (
                <VStack gap={3}>
                  <Text as="p">{errorMessage(read.error, 'Uppgifterna kunde inte hämtas just nu.')}</Text>
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
              ),
            }
          : null;
  const slot = usePanel(frame, { minMain: LIST_MIN, size: PERSON_PANEL, replaces: true, overlayOnly: short });
  // The list is drawn whole again in the same step as the person closes, so the row that opened them is there to
  // take the focus back.
  return { ...slot, occupied: slot.occupied && !!key, person: key, name: key ? detail?.entity.name : undefined };
}
