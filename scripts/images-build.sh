#!/bin/sh
# Builds the images listed in scripts/images.txt with Docker, on the host and from the repository root.
#
#   sh scripts/images-build.sh                         every image, tagged with the current commit
#   sh scripts/images-build.sh clew-server clew-web    only the named ones
#   REGISTRY=registry.example.org/clew sh scripts/images-build.sh clew-server
#
# The tag is the commit, and the server image is given it as its release (CLEW_RELEASE, D85). Nothing is pushed.
set -eu
cd "$(dirname "$0")/.."
tag="${TAG:-$(git rev-parse HEAD)}"
prefix="${REGISTRY:+$REGISTRY/}"
wanted="$*"
built=0
while read -r name dockerfile context; do
  case "$name" in '' | '#'*) continue ;; esac
  if [ -n "$wanted" ]; then
    case " $wanted " in *" $name "*) ;; *) continue ;; esac
  fi
  echo "Building ${prefix}${name}:${tag}"
  docker build -f "$dockerfile" -t "${prefix}${name}:${tag}" --build-arg "CLEW_RELEASE=${tag}" "$context"
  built=$((built + 1))
done <scripts/images.txt
if [ "$built" -eq 0 ]; then
  echo "No image in scripts/images.txt is named: ${wanted}" >&2
  exit 1
fi
echo "Built ${built} image(s) tagged ${tag}."
