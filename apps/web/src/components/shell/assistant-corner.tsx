import {
  createContext,
  createRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useLocation } from 'react-router';
import { Button, Icon, SparklesIcon } from '@clew/ui';
import { useConversation } from '../conversation/conversation-context';

/** The button's distance from the window's edges. */
const EDGE = 24;
/** Hem's line to ask (`start.tsx`), which the button leads to while Hem is the page. */
export const hemLine = createRef<HTMLInputElement>();

/**
 * Whether the keyboard's focus is on something the button would hide where it rests, the lower corner at the end of
 * the line: more than half of the focused control lies under it. The button stands over the page, so a control the
 * browser has just scrolled into view at the window's lower edge can be under it (2.4.11); the button then stands in
 * the other corner for as long as the focus is there. Scrolling and resizing can move a focused control under it too.
 */
function useYieldToFocus(corner: { current: HTMLDivElement | null }): boolean {
  const [yields, setYields] = useState(false);
  useEffect(() => {
    let frame: number | undefined;
    const read = () => {
      frame = undefined;
      const box = corner.current;
      const active = document.activeElement;
      if (!box || !active || active === document.body) return setYields(false);
      // On the button itself it stays where it is.
      if (box.contains(active)) return;
      if (!active.matches(':focus-visible')) return setYields(false);
      const { width, height } = box.getBoundingClientRect();
      const { clientWidth, clientHeight } = document.documentElement;
      const left = getComputedStyle(box).direction === 'rtl' ? EDGE : clientWidth - EDGE - width;
      const top = clientHeight - EDGE - height;
      const a = active.getBoundingClientRect();
      const across = Math.min(a.right, left + width) - Math.max(a.left, left);
      const down = Math.min(a.bottom, top + height) - Math.max(a.top, top);
      const covered = across > 0 && down > 0 ? across * down : 0;
      setYields(covered > (a.width * a.height) / 2);
    };
    const scheduleRead = () => {
      if (frame === undefined) frame = requestAnimationFrame(read);
    };
    document.addEventListener('focusin', scheduleRead);
    document.addEventListener('scroll', scheduleRead, true);
    window.addEventListener('resize', scheduleRead);
    scheduleRead();
    return () => {
      document.removeEventListener('focusin', scheduleRead);
      document.removeEventListener('scroll', scheduleRead, true);
      window.removeEventListener('resize', scheduleRead);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [corner]);
  return yields;
}

/**
 * What the button does on the page that stands in the shell, as the page's frame says it (D138 items 3 and 5):
 *
 * - `pane`: the page has a subject, so the button opens the assistant's pane about it and the page stays (on a phone it
 *   leads to the conversation's page with the subject beside it, item 11). The frame's `open` does either.
 * - `question`: the page has no subject (Administration, a frame that is no page of the person's work) or there is no
 *   model to answer beside it: the button starts a new question on the conversation's page with this page as the way
 *   back, as main's D130 item 10 has it. On Hem it leads to Hem's own line whatever the page says.
 * - `hidden`: a box already stands on the page (the assistant's pane, or a pane of the page's own with the box at its
 *   foot: Att göra's item, Kalender's entry), or the page does not know its subject yet: the button is not drawn.
 */
export type CornerDoor = 'pane' | 'question' | 'hidden';

/** What a page's frame and the shell's corner say to each other. A context, not the DOM (D138). */
interface CornerChannel {
  /** A page's claim on the window's lower edge; what it returns gives the claim up. */
  claim(): () => void;
  /** The page says what the button does, with the press for `pane`; what it returns takes it back. */
  door(kind: CornerDoor, open: () => void): () => void;
  /**
   * The assistant's pane has closed: the focus goes back to the button that opened it (D135 rule 2,
   * D138 item 3), once the button is drawn again.
   */
  returnFocus(): void;
}
const noop = () => undefined;
const Corner = createContext<CornerChannel>({ claim: () => noop, door: () => noop, returnFocus: noop });

/**
 * The floating way to the assistant (D130 item 14, D138 items 1, 3 and 5): "Fråga AI" in the lower corner, as the
 * startsidan prototype has it. Since 2026-11-20 a page with a frame draws its own "Fråga AI" at the end of its title's
 * line and tells this one to stay away (`useCornerDoor('hidden')`, D138 as amended), so the floating button stands on Hem
 * and on a page with no frame. On Hem it leads to Hem's own line, as the reference's does: the line
 * takes the focus and is scrolled into view. On a page with a subject it opens the assistant's pane about it beside the
 * page (`door` `pane`, the page's frame does the opening); on a page with none it starts a new question about the page
 * the person is on, as the rail's "Ny fråga" did (`question`): the conversation's own page opens, with this page as the
 * way back.
 *
 * The button is Astryx's `Button` raised with `elevation`, as the `ButtonFloating` template raises one. Astryx places
 * nothing in a corner of the window, so the one `style` here does, and with it the rule that keeps the button off the
 * control the keyboard is on (`useYieldToFocus`): the gap is recorded in D130 with this exception.
 */
function AssistantCorner({
  door,
  open,
  button,
  focusPending,
}: {
  door: Exclude<CornerDoor, 'hidden'>;
  open: () => void;
  button: RefObject<HTMLButtonElement | null>;
  focusPending: { current: boolean };
}) {
  const talk = useConversation();
  const { pathname, search } = useLocation();
  const corner = useRef<HTMLDivElement>(null);
  const yields = useYieldToFocus(corner);
  // Drawn again after the pane closed: the focus comes back to it (D138 item 3).
  useLayoutEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    button.current?.focus();
  });
  const icon = <Icon icon={SparklesIcon} color="inherit" />;
  return (
    <div
      ref={corner}
      style={{
        position: 'fixed',
        insetBlockEnd: EDGE,
        zIndex: 10,
        ...(yields ? { insetInlineStart: EDGE } : { insetInlineEnd: EDGE }),
      }}
    >
      {pathname === '/' ? (
        // Hem has its own "Fråga AI" at the line; this one is named by what it does here, so the two are told apart.
        <Button
          variant="ai"
          label="Fråga AI: gå till frågefältet"
          icon={icon}
          size="lg"
          elevation="med"
          onClick={() => {
            hemLine.current?.scrollIntoView({ block: 'center' });
            hemLine.current?.focus();
          }}
        >
          Fråga AI
        </Button>
      ) : door === 'pane' ? (
        <Button ref={button} variant="ai" label="Fråga AI" icon={icon} size="lg" elevation="med" onClick={open} />
      ) : (
        <Button
          ref={button}
          variant="ai"
          label="Fråga AI"
          icon={icon}
          size="lg"
          elevation="med"
          href="/conversations/new"
          onClick={() => talk.newConversation({ from: pathname + search, stay: true })}
        />
      )}
    </div>
  );
}

/**
 * For a page that pins controls of its own at the window's foot (the review's decision, `PageFrame`'s `footer`): the
 * floating button is not drawn while the page stands, so it never lies over what the person must press.
 */
export function useClearCorner(clear: boolean) {
  const { claim } = useContext(Corner);
  useEffect(() => (clear ? claim() : undefined), [clear, claim]);
}

/**
 * The page's frame says what the corner's button does on it (D138 items 3 and 5, `CornerDoor`). A layout effect, so the
 * button is drawn or left out before the browser paints: it is never seen over a pane that has just opened. `open` is
 * read when the button is pressed, so a frame may pass a new function on every render.
 */
export function useCornerDoor(kind: CornerDoor, open: () => void = noop) {
  const { door } = useContext(Corner);
  const press = useRef(open);
  press.current = open;
  useLayoutEffect(() => door(kind, () => press.current()), [door, kind]);
}

/** The pane has closed: the focus goes back to the corner's button once it is drawn (D138 item 3). */
export const useReturnFocusToCorner = () => useContext(Corner).returnFocus;

/**
 * The shell's content with the floating way to the assistant over it (D130 item 14, D138 item 5): on every page but a
 * conversation's, which has its own box, a page that keeps the lower edge for its own controls (`useClearCorner`), and a
 * page whose frame says a box already stands on it (`useCornerDoor`).
 */
export function WithAssistantCorner({ children }: { children: ReactNode }) {
  const { open } = useConversation();
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims(n => n + 1);
    return () => setClaims(n => n - 1);
  }, []);
  // The page's door, by identity: a page's frame that has gone takes back its own door and never the next page's.
  const [door, setDoor] = useState<{ kind: CornerDoor; open: () => void } | null>(null);
  const said = useCallback((kind: CornerDoor, open: () => void) => {
    const mine = { kind, open };
    setDoor(mine);
    return () => setDoor(current => (current === mine ? null : current));
  }, []);
  const button = useRef<HTMLButtonElement>(null);
  const focusPending = useRef(false);
  const returnFocus = useCallback(() => {
    if (button.current?.isConnected) button.current.focus();
    else focusPending.current = true;
  }, []);
  const channel = useMemo(() => ({ claim, door: said, returnFocus }), [claim, said, returnFocus]);
  // A page with no frame of its own says nothing: the button starts a new question there, as main's D130 item 10 has it.
  const kind = door?.kind ?? 'question';
  return (
    <Corner.Provider value={channel}>
      {children}
      {open || claims > 0 || kind === 'hidden' ? null : (
        <AssistantCorner door={kind} open={door?.open ?? noop} button={button} focusPending={focusPending} />
      )}
    </Corner.Provider>
  );
}
