/**
 * The values Clew's theme adds to Astryx's components (`theme.ts`, Astryx's documented `prop:value` extension), typed
 * here in one place so a component's prop accepts them. A value is declared here in the change that adds it to the
 * theme and removed in the change that removes it; nothing else in the repository augments an Astryx module.
 */

declare module '@astryxdesign/core/Badge' {
  interface BadgeVariantMap {
    /** The sixth system hue, which Astryx has as a token and not as a Badge variant (D71, `mark.tsx`). */
    gray: true;
    /** The outlined mark of Clew's own systems (D71, `mark.tsx`). */
    house: true;
  }
}

declare module '@astryxdesign/core/Card' {
  interface CardVariantMap {
    /** A figure that needs the person: the card's ground with an error-coloured outline (D54, `figure.tsx`). */
    alert: true;
    /** A row that needs the person: the ground's colour with an edge in its status colour (D130, `status-row.tsx`). */
    'row-error': true;
    'row-warning': true;
    'row-info': true;
    'row-success': true;
    'row-neutral': true;
    /** Hem's ask pill and the round mark at its start (D130, the web app's `start.tsx`). */
    ask: true;
    'ai-mark': true;
  }
}

declare module '@astryxdesign/core/Button' {
  interface ButtonVariantMap {
    /** The assistant's own button: a pill in the assistant's blue (D130). */
    ai: true;
  }
}

declare module '@astryxdesign/core/theme' {
  interface CustomTextTypes {
    /** A label in small capitals: a key figure's, a register's column heading (D130, `key-figure.tsx`). */
    eyebrow: true;
  }
}

declare module '@astryxdesign/core/Text' {
  interface TextColorMap {
    /** The status colours as text colours, for a key figure's value; its word stands beside it (1.4.1). */
    success: true;
    warning: true;
    error: true;
  }
}

export {};
