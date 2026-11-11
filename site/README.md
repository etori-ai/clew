# Documentation site

`docs/` built to static pages with VitePress and published to GitHub Pages. The documents are read where they
are; this folder holds only the configuration. How it works, how to build it and how it is published:
[docs/maintainers/documentation-site.md](../docs/maintainers/documentation-site.md).

```sh
docker exec -w /workspace clew-app-1 bun run docs:site
```
