# Contributing

Thanks for helping out. This is a small plugin — the bar is low, and issues
are as welcome as PRs.

## Reporting a bug

Open an [issue](https://github.com/andrewmp1/omarchy-magic-trackpad/issues/new/choose)
with the **Bug report** template. The three things that make a bug fixable:

```sh
omarchy version
hyprctl version | head -1
bash scripts/check.sh        # or at least `npm test`
```

Plus: what you clicked, what you expected, what happened, and — if the panel
misbehaved — the relevant lines from `journalctl --user -e | grep magic-trackpad`.

## Requesting a feature

Use the **Feature request** template. If it's a touchpad option Hyprland
already exposes (`hyprctl getoption input:touchpad:<name>`), it's probably a
small addition to `Model.TOUCHPAD_TOGGLES`. Anything needing a daemon or
device access belongs to a later phase — see the roadmap in the README.

## Sending a PR

1. **Read [`AGENTS.md`](AGENTS.md)** first — it has the architecture and every
   Omarchy-plugin gotcha that has already bitten this repo (why it's
   `hyprctl eval`, not `keyword`; why `Toggle` is wrapped in an `Item`
   delegate; the `\uXXXX`-is-4-digits rule; …).
2. **Keep `Model.js` pure.** All logic — the setting catalogue, the generated
   `hl.config` / Lua, the loader-line guard — lives there with no QML imports,
   so `node --test` covers it. If you add a setting, add a test.
3. **Run the checks:**
   ```sh
   bash scripts/check.sh
   ```
   Layers 1-3 (unit / manifest / Lua-syntax) must pass anywhere. Layers 4-6
   (Hyprland contract, shell smoke, panel e2e) need a live Omarchy desktop and
   are what you should run before opening the PR. CI runs 1-3.
4. **One change per PR**, a plain commit message, and update the README /
   `docs/TESTING.md` if behaviour changed.

## Project layout

| File | Role |
|---|---|
| `manifest.json` | Omarchy plugin manifest (`bar-widget`, entry `BarWidget.qml`) |
| `Model.js` | all pure logic + `node --test` fixtures |
| `BarWidget.qml` | the bar button + popup (the `barWidget` entry point) |
| `ConfigStore.qml` | `~/.config/omarchy/magic-trackpad.json` on disk |
| `HyprSync.qml` | live apply (`hyprctl eval`), read-back, the managed `.lua` |
| `tests/` | `*.test.js` (portable) + `*.sh` (on-desktop) |
| `scripts/check.sh` | runs every layer |
| `bin/magic-haptic`, `setup.sh` | staged for the haptics phase; unused in v0.1 |

## Cutting a release (maintainers)

1. Land the changes; add them under `## [Unreleased]` in `CHANGELOG.md`.
2. **Actions → release → Run workflow**, enter the version (`0.2.0`, no `v`).
   Tick *dry_run* first if you want to see the diff and notes in the log.
3. The workflow runs the portable test layers, bumps `manifest.json` /
   `package.json`, rolls `[Unreleased]` into `## [x.y.z] — <date>`, commits,
   tags `vx.y.z`, pushes to `main`, and creates the GitHub Release with a
   source tarball.

Local preview: `scripts/release.sh 0.2.0 --dry-run`.

## Code of conduct

Be decent. Assume good faith. That's it.
