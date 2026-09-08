# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- Add new entries under "## [Unreleased]". The release workflow
     (.github/workflows/release.yml) rolls that heading into a dated version
     section and cuts the tag + GitHub Release. -->

## [Unreleased]

Targets **v0.3.0**. (v0.2.0 shipped the marketplace security-review
hardening.)

### Added

- **Per-device touchpad overrides.** A **Scope** picker switches the panel
  between **Global** (`hl.config` — Hyprland's `input.touchpad` section, the
  v0.1 behaviour) and each detected touchpad (`hl.device({ name = "<slug>",
  … })`). A device scope inherits any option it hasn't overridden from Global;
  toggle rows show an "Inherited from Global" caption until you change them.
  **Reset to Global** (with a confirm step) clears a device's overrides.
- Touchpad detection: `hyprctl devices -j` cross-referenced with
  `/proc/bus/input/devices` (BUTTONPAD / absolute-axis bits); falls back to
  offering every pointer device if nothing there looks like a touchpad. Device
  names are accepted only if they match Hyprland's slug shape
  (`^[a-z0-9][a-z0-9._-]{0,127}$`) — refused, never repaired.
- Config document is now v2: `{ version: 2, global: {…}, devices: { "<slug>":
  {…} } }`. A v0.1 document is migrated to `global` on first load with nothing
  lost; `ConfigStore` always writes v2. New settings are optional keys — no
  further schema bump.
- **Pointer speed** (5-stop `sensitivity`), **pointer acceleration**
  (Adaptive / Flat), and **scroll method** (Two-finger / Edge), per scope.
  These are `input`-level keys, so a global `hl.config` now nests them beside
  the `touchpad` table: `hl.config({ input = { sensitivity = …, touchpad =
  { … } } })`.
- **Drag lock**, **Three-finger drag** (`drag_lock` / `drag_3fg` — read back
  as int, coerced), and **Two-finger tap → Right / Middle** (`tap_button_map`).
- **Disable this touchpad** — a device scope only, guarded by a confirm
  dialog; writes `enabled: false` / `hl.device({ name, enabled = false })`,
  dims the settings, and shows "disabled" in the hero. Re-enabling drops the
  override (inherits Global again).
- **Battery + transport** in the panel header for the selected device —
  transport from `/proc/bus/input/devices` (`I: Bus=`), battery from
  `/sys/class/power_supply/<node>/uevent` located by the device's `U: Uniq`
  MAC. Read-only, no root; absent just means no percentage.
- A configured device's overrides are re-pushed when it (re)connects
  mid-session (`Model.applyPlanForDevice`), covering the window before
  Hyprland re-sources the managed `.lua`.
- Read-back now covers `input:sensitivity` and every enum option, so an
  unconfigured control shows the value actually in effect rather than always
  the libinput default.
- The panel content is in a `ScrollView` — the keyboard cursor scrolls the
  focused row into view.

### Fixed

- `BoundedRead` treated every read as refused. It checked `proc.exitCode`,
  which does not exist on Quickshell 0.3.1's `Process` (the code arrives only
  as the `onExited(exitCode, …)` argument), so `exitCode === 0` was always
  false. This silently disabled config read-back (external edits to
  `magic-trackpad.json` were ignored) and forced v0.3's touchpad detection
  into its fallback path.

## [0.2.0] — 2026-09-08

### Security

Marketplace security-review hardening (skill: omarchy-plugin-security):

- Every `Text` sink in `BarWidget.qml` is pinned to `textFormat: Text.PlainText`
  (the panel summary can render `hyprctl` stderr; rich-text auto-detection
  would let markup in that string fetch `file:`/network resources).
- `HyprSync` no longer runs a generated `bash -c` script: each read-back is a
  fixed-argv `/usr/bin/hyprctl getoption -j` invocation (option names come
  only from the closed catalogue — no shell, no interpolation).
- Both `StdioCollector`s replaced with byte-capped `SplitParser`s: output over
  the cap (4 KiB per option read, 2 KiB for stderr) kills the process and
  refuses the value instead of buffering it whole.
- All file reads go through a bounded `BoundedRead` component (`/usr/bin/dd`
  as a fixed argv array with `iflag=nofollow,nonblock,count_bytes`): a planted
  symlink or FIFO fails the read instead of being followed or blocking the
  shell, and a file over the size cap is refused, not truncated. The
  `FileView`s are demoted to watcher/writer only (`preload: false`,
  `blockAllReads: true`), so an accidental in-process read cannot happen.
- The `hyprland.lua` loader install is fail-closed: if the shared config
  cannot be read as itself (symlink, FIFO, oversized), it is not modified.
- Every child process is under a watchdog (TERM at 10 s, KILL at 13 s) — no
  `hyprctl` call can hang the shell.
- Startup is read-only: the managed Lua file and the `hyprland.lua` loader
  line are now written on the first setting change, not when the plugin
  loads. This matches the README's "an option is written only after you flip
  its switch" claim and the submission checklist's "does not overwrite user
  configuration without explicit consent".
- CI: GitHub Actions pinned to full commit SHAs; workflow granted
  `permissions: contents: read` only.

### Removed

- `bin/magic-haptic` and `setup.sh` — staged for the planned haptics phase
  but unused (and root-capable: sudo, systemd, udev, raw hidraw). They were
  shipped inside the plugin directory and triggered the marketplace
  security baseline's `privilege` / `service-management` / `installer`
  findings, contradicting the plugin's documented "no root, no daemon"
  boundary. They remain in the
  [magic-trackpad-haptics](https://github.com/andrewmp1/magic-trackpad-haptics)
  research repo and will be re-vendored, separately reviewed, when haptics
  ships.

### Changed

- `AGENTS.md` moved to `docs/AGENTS.md`: agent-instruction files at the repo
  root are auto-discovered by coding agents, and `omarchy plugin add` ships
  the repository verbatim into the user's plugin directory — so a root-level
  agent file is a prompt-injection surface. `docs/` is not auto-loaded.
- README: new "Security boundary" section documenting the plugin's exact
  footprint (what it runs, writes, and never touches).

## [0.1.0] — 2026-09-07

First release. Level 1: the libinput touchpad options Hyprland already
exposes, driven from a bar-widget popup.

### Added

- Toggles: tap-to-click, two-finger right-click, natural scroll,
  disable-while-typing, tap-and-drag, middle-click emulation.
- Scroll speed: Slow / Normal / Fast (`scroll_factor` 0.2 / 0.4 / 0.8).
- Live apply via `hyprctl eval "hl.config{…}"`; persisted to
  `~/.config/hypr/omarchy-magic-trackpad.lua` through one guarded loader line
  in `hyprland.lua`. Fully reversible.
- Reads Hyprland's current value for options you haven't set; writes only the
  ones you change.
- Keyboard-navigable panel (`j`/`k`, `Enter`, `Esc`).
- Six-layer test suite (`scripts/check.sh`): unit, manifest, generated-Lua
  syntax, live Hyprland contract, shell smoke, synthetic-keystroke e2e.
- GitHub Pages site (`docs/`) and CI.

### Not included

- Finger-swipe gestures — prototyped and cut for this release; a runtime
  `hl.gesture` can't be cleanly un-registered yet. Kept in
  `Model.PLANNED_GESTURES` for v0.2.

[Unreleased]: https://github.com/andrewmp1/omarchy-magic-trackpad/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/andrewmp1/omarchy-magic-trackpad/releases/tag/v0.2.0
[0.1.0]: https://github.com/andrewmp1/omarchy-magic-trackpad/releases/tag/v0.1.0
