#!/usr/bin/env bash
# Cut a release: bump the version everywhere, roll CHANGELOG's [Unreleased]
# into a dated section, commit, tag, and print that version's notes on stdout
# (the GitHub workflow feeds them to `gh release create`).
#
#   scripts/release.sh 0.2.0            # do it
#   scripts/release.sh 0.2.0 --dry-run  # show what would change, touch nothing
#
# Run by .github/workflows/release.yml; also usable by hand.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:?usage: release.sh <version> [--dry-run]}"
DRY=0; [ "${2:-}" = "--dry-run" ] && DRY=1
TAG="v$VERSION"
DATE="$(date +%F)"
REPO="andrewmp1/omarchy-magic-trackpad"
FILES=(CHANGELOG.md manifest.json package.json)

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not semver: $VERSION" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && { echo "$TAG already exists" >&2; exit 1; }
grep -q "^## \[Unreleased\]$" CHANGELOG.md || { echo "no '## [Unreleased]' heading in CHANGELOG.md" >&2; exit 1; }

if [ "$DRY" -eq 1 ]; then
  BK="$(mktemp -d)"; for f in "${FILES[@]}"; do cp "$f" "$BK/"; done
  trap 'for f in "${FILES[@]}"; do cp "$BK/$f" "$f"; done; rm -rf "$BK"' EXIT
fi

# --- CHANGELOG: insert a dated section, leaving [Unreleased] empty above it --
# and everything that was under [Unreleased] now sits under [x.y.z].
node - "$VERSION" "$DATE" "$REPO" <<'NODE'
const fs = require("fs")
const [version, date, repo] = process.argv.slice(2)
const esc = version.replace(/\./g, "\\.")
let c = fs.readFileSync("CHANGELOG.md", "utf8")

c = c.replace(/^## \[Unreleased\]$/m, `## [Unreleased]\n\n## [${version}] — ${date}`)

c = c.replace(/^\[Unreleased\]:.*$/m,
  `[Unreleased]: https://github.com/${repo}/compare/v${version}...HEAD`)
if (!new RegExp(`^\\[${esc}\\]:`, "m").test(c)) {
  c = c.replace(/^\[Unreleased\]:.*$/m,
    m => `${m}\n[${version}]: https://github.com/${repo}/releases/tag/v${version}`)
}
fs.writeFileSync("CHANGELOG.md", c)
NODE

# --- version in manifest.json + package.json --------------------------------
node -e '
  const fs=require("fs"), v=process.argv[1];
  for (const f of ["manifest.json","package.json"]) {
    const j=JSON.parse(fs.readFileSync(f,"utf8")); j.version=v;
    fs.writeFileSync(f, JSON.stringify(j,null,2)+"\n");
  }
' "$VERSION"

# --- notes = the body of the new version's section ------------------------
NOTES="$(awk -v ver="## [$VERSION] —" '
  index($0, ver) == 1 {grab=1; next}
  grab && /^## \[/ {exit}
  grab && /^\[[^]]+\]: / {exit}
  grab {print}
' CHANGELOG.md | awk 'NF{p=1} p' | sed -e :a -e '/^\n*$/{$d;N;ba}')"
[ -n "$NOTES" ] || NOTES="See CHANGELOG.md for $TAG."

if [ "$DRY" -eq 1 ]; then
  echo "=== DRY RUN — no commit, no tag ===" >&2
  git --no-pager diff --no-index -- "$BK/CHANGELOG.md" CHANGELOG.md || true
  git --no-pager diff -- manifest.json package.json >&2 || true
  echo >&2; echo "=== release notes for $TAG ===" >&2
  printf '%s\n' "$NOTES"
  exit 0
fi

git add "${FILES[@]}"
git commit -m "release: $TAG"
git tag -a "$TAG" -m "$TAG"

printf '%s\n' "$NOTES"   # stdout = notes; caller pushes + creates the release
