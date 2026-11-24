#!/usr/bin/env bash

tag=$1

if ! awk -v version="${tag#v}" '
  BEGIN { heading = "## [" version "] - " }
  /^##[[:space:]]/ {
    if (found) exit
    if (index($0, heading) == 1) found = 1
    next
  }
  found {
    print
    if ($0 ~ /[^[:space:]]/) has_notes = 1
  }
  END { if (!has_notes) exit 1 }
' CHANGELOG.md; then
  printf 'CHANGELOG.md has no release notes for %s\n' "$tag" >&2
  exit 1
fi
