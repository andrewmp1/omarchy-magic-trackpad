# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- Add new entries under "## [Unreleased]". The release workflow
     (.github/workflows/release.yml) rolls that heading into a dated version
     section and cuts the tag + GitHub Release. -->

## [Unreleased]

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

[Unreleased]: https://github.com/andrewmp1/omarchy-magic-trackpad/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/andrewmp1/omarchy-magic-trackpad/releases/tag/v0.1.0
