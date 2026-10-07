#!/bin/sh
set -eu

nub run db:migrate
exec "$@"
