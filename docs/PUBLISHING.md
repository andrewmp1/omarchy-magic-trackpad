# Publishing to the Omarchy plugin marketplace

Checked against <https://plugins.omarchy.org/publish.html>.

## Pre-flight

- [x] Public GitHub repo with `manifest.json` at the root, `README.md`,
      `LICENSE`, and a `preview.png`.
- [x] Safe install (`omarchy plugin add …`) and removal (README → Uninstall)
      documented, and the removal genuinely restores the prior config.
- [x] `manifest.json` has every required field, `id` is namespaced and does
      not start with `omarchy.`, `version` is ≤ 64 chars, no `clonedFrom`
      field, `description` is a one-liner for the marketplace card.
- [x] External dependencies and privilege boundary stated in the README
      ("no daemon, no root, no device access, no dependencies").
- [x] Validate the current commit:
      ```sh
      omarchy plugin validate .
      ```
- [ ] Cut the release: **Actions → release → Run workflow**, enter the
      version (e.g. `0.1.0`). It bumps `manifest.json` / `package.json`, rolls
      `CHANGELOG.md`'s `[Unreleased]` into a dated section, tags `v<version>`,
      and publishes the GitHub Release. (`scripts/release.sh <v> --dry-run`
      previews it locally.)
- [ ] Turn on GitHub Pages (Settings → Pages → Source: **GitHub Actions**) so
      the `Website` link in the README resolves.

## Submit

Open the marketplace submission form:

**<https://github.com/omacom/omarchy-plugin-marketplace/issues/new?template=submit-plugin.yml>**

Provide:

| Field | Value |
|---|---|
| Repository | `https://github.com/andrewmp1/omarchy-magic-trackpad` |
| Category | Input / System |
| Tags | `trackpad`, `touchpad`, `libinput`, `bar-widget`, `hyprland` |

A maintainer reviews and approves the listing. **The marketplace validates
the listing, not the plugin's security** — reviewers (and users) are trusting
the code, so keep the diff readable and the privilege story honest.

## After it's listed

- Bump `version` in `manifest.json` for each change, add a `CHANGELOG.md`
  entry, and tag. `omarchy plugin update` fast-forwards users' checkouts.
- Keep `scripts/check.sh` green before every tag.
