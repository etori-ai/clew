<script setup lang="ts">
import { useData } from 'vitepress';
import { onMounted, ref, watch } from 'vue';

/**
 * A ```mermaid block of a document, drawn in the browser. Until the drawing is ready, and where scripts do not
 * run, the diagram's source is shown as the code block it is in the repository.
 */
const props = defineProps<{ code: string; id: string }>();
const source = decodeURIComponent(props.code);
const { isDark } = useData();
const svg = ref('');
let drawn = 0;

async function draw() {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark.value ? 'dark' : 'default' });
  svg.value = (await mermaid.render(`${props.id}-${++drawn}`, source)).svg;
}
onMounted(draw);
watch(isDark, draw);
</script>

<template>
  <div v-if="svg" v-html="svg" />
  <div v-else class="language-mermaid">
    <pre><code>{{ source }}</code></pre>
  </div>
</template>
