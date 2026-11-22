#!/bin/sh
# Read-only production performance sampling. Run on the application host.
# It never changes services, data, configuration or credentials.
set -eu

since="${1:-2 hours ago}"
max_lines="${2:-30000}"

printf '%s\n' '--- deployment receipt ---'
if [ -r /var/lib/njuredcross-deploy/release.json ]; then
  cat /var/lib/njuredcross-deploy/release.json
else
  printf '%s\n' '{"ok":false,"reason":"release.json unavailable"}'
fi

printf '%s\n' '--- service state ---'
systemctl is-active njuredcross.service || true
systemctl show njuredcross.service -p NRestarts -p MemoryCurrent || true

printf '%s\n' '--- telemetry summary ---'
timeout -k 2 30 journalctl --namespace=njuredcross -u njuredcross \
  --since "$since" -n "$max_lines" -o cat --no-pager 2>/dev/null \
  | node scripts/summarize-telemetry.mjs

printf '%s\n' '--- queue phase sample ---'
timeout -k 2 30 journalctl --namespace=njuredcross -u njuredcross \
  --since "$since" -n "$max_lines" -o cat --no-pager 2>/dev/null \
  | rg '"type":"dependency","service":"queue"' \
  | rg -o '"operation":"[a-z-]+","durationMs":[0-9.]+' || true

printf '%s\n' '--- nginx timing tail ---'
if [ -r /var/log/nginx/njuredcross-timing.log ]; then
  tail -n 200 /var/log/nginx/njuredcross-timing.log
else
  printf '%s\n' 'timing log unavailable'
fi
