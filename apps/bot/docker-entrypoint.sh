#!/bin/sh
set -eu

nub run db:migrate
if [ "$#" -eq 5 ] && [ "$1" = "nub" ] && [ "$2" = "--cwd" ] && [ "$3" = "apps/bot" ] && [ "$4" = "run" ] && [ "$5" = "start" ]; then
  nub --cwd apps/bot run sync
fi
exec "$@"
