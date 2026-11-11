import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import Mermaid from './Mermaid.vue';
import './layout.css';

/**
 * VitePress's own theme, plus the one component the documents need, a drawn Mermaid diagram, and one of the theme's
 * own variables set in layout.css so that the sidebar keeps its width on a wide screen.
 */
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Mermaid', Mermaid);
  },
} satisfies Theme;
