#!/bin/sh
# Runs the WCAG 2.2 AA suite in the pinned Playwright image. Arguments go to `playwright test`.
set -eu
exec sh "$(dirname "$0")/compose.sh" --profile a11y run --rm a11y node_modules/.bin/playwright test -c tests/a11y "$@"
