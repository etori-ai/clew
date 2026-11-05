#!/bin/sh
# Runs the WCAG 2.2 AA suite in the pinned Playwright image. Arguments go to `playwright test`.
# CI runs this script too, after filling the node_modules volume, so the image is pinned in compose.yaml alone.
set -eu
exec sh "$(dirname "$0")/compose.sh" --profile a11y run --rm \
  -e CLEW_A11Y_BRAND_PROFILE="${CLEW_A11Y_BRAND_PROFILE:-neutral}" \
  a11y node_modules/.bin/playwright test -c tests/a11y "$@"
