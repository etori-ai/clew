import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import Mermaid from './Mermaid.vue';

/** VitePress's own theme, unchanged, plus the one component the documents need: a drawn Mermaid diagram. */
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Mermaid', Mermaid);
  },
} satisfies Theme;
