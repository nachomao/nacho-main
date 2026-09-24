#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  printf 'usage: %s TARGET BACKUP\n' "$0" >&2
  exit 2
fi

cp -- "$2" "$1"
cmp -s "$1" "$2"
printf 'restored %s from %s\n' "$1" "$2"
