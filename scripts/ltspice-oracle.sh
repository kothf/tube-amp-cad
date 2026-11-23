#!/usr/bin/env bash
# LTspice import against LTspice itself, on Linux with Wine (tests/ltspice-oracle.mjs):
#   scripts/ltspice-oracle.sh [work folder]
# downloads the schematics listed in tests/fixtures/ltspice/corpus.txt, gives each .op as its only
# analysis, has LTspice write its netlist and operating point, and compares them with the app's.
# LTspice: wine msiexec /i LTspice64.msi /qn (https://ltspice.analog.com/software/LTspice64.msi);
# LTSPICE= names LTspice.exe if it is not in the usual place.
set -u
cd "$(dirname "$0")/.."
W=${1:-/tmp/ltspice-oracle}
LTSPICE=${LTSPICE:-$(ls "${WINEPREFIX:-$HOME/.wine}"/drive_c/Program\ Files/ADI/LTspice/LTspice.exe 2>/dev/null | head -1)}
[ -f "$LTSPICE" ] || { echo "LTspice.exe not found: set LTSPICE=/path/to/LTspice.exe"; exit 1; }
export WINEDEBUG=-all
mkdir -p "$W/asc"
n=0
grep -v '^#' tests/fixtures/ltspice/corpus.txt | while read -r p; do
  n=$((n + 1)); [ -s "$W/asc/f$n.asc" ] || curl -sfL -o "$W/asc/f$n.asc" "https://raw.githubusercontent.com/$p" || echo "download failed: $p"
done
node tests/ltspice-oracle.mjs prepare "$W/asc" "$W/op"
cd "$W/op"
for f in *.asc; do
  s=${f%.asc}
  [ -s "$s.raw" ] && continue
  timeout 60 wine "$LTSPICE" -netlist "$f" >/dev/null 2>&1
  [ -s "$s.net" ] && timeout 120 wine "$LTSPICE" -b -ascii "$s.net" >/dev/null 2>&1
  [ -s "$s.raw" ] || echo "LTspice gave no result: $f"
done
cd - >/dev/null
node tests/ltspice-oracle.mjs compare "$W/op" "$W/results.json"
