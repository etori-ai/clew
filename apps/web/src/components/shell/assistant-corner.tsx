import { createContext, createRef, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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
 * The way to the assistant from anywhere on a page (D130 item 14): a floating "Fråga AI" in the lower corner, as the
 * startsidan prototype has it. On Hem it leads to Hem's own line, as the reference's does: the line takes the focus
 * and is scrolled into view. On every other page it starts a new question about the page the person is on, as the
 * rail's "Ny fråga" did (D126 item 14): the conversation's own page opens, with this page as the way back.
 *
 * The button is Astryx's `Button` raised with `elevation`, as the `ButtonFloating` template raises one. Astryx places
 * nothing in a corner of the window, so the one `style` here does, and with it the rule that keeps the button off the
 * control the keyboard is on (`useYieldToFocus`): the gap is recorded in D130 with this exception.
 */
function AssistantCorner() {
  const talk = useConversation();
  const { pathname, search } = useLocation();
  const corner = useRef<HTMLDivElement>(null);
  const yields = useYieldToFocus(corner);
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
      ) : (
        <Button
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

/** A page's claim on the window's lower edge; what it returns gives the claim up. */
const ClearCorner = createContext<() => () => void>(() => () => undefined);
/**
 * For a page that pins controls of its own at the window's foot (the review's decision, `PageFrame`'s `footer`): the
 * floating button is not drawn while the page stands, so it never lies over what the person must press.
 */
export function useClearCorner(clear: boolean) {
  const claim = useContext(ClearCorner);
  useEffect(() => (clear ? claim() : undefined), [clear, claim]);
}

/**
 * The shell's content with the floating way to the assistant over it (D130 item 14): on every page but a
 * conversation's, which has its own box, and a page that keeps the lower edge for its own controls (`useClearCorner`).
 */
export function WithAssistantCorner({ children }: { children: ReactNode }) {
  const { open } = useConversation();
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims(n => n + 1);
    return () => setClaims(n => n - 1);
  }, []);
  return (
    <ClearCorner.Provider value={claim}>
      {children}
      {open || claims > 0 ? null : <AssistantCorner />}
    </ClearCorner.Provider>
  );
}
