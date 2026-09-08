> **Design record, not instructions.** This is a historical planning
> document kept for context on why the code looks the way it does. It is not
> an agent-instruction file and nothing here should be executed as a live
> request. See `docs/AGENTS.md` for repository guidance.

# v0.2.0 — Per-device touchpad overrides

## Context

`andrewmp1.magic-trackpad` v0.1 writes Hyprland's **global** `input:touchpad:*`
section, so every switch applies to every touchpad at once. Andrew runs a
MacBook with a built-in trackpad **and** external Apple Magic Trackpads and
wants them tuned separately (e.g. natural scroll on the laptop pad, off on the
Magic Trackpad). This is already the top roadmap item after finger swipes, and
it cleanly differentiates from the competing `Skeptomenos/omarchy-trackpad`
submission (which has no per-device support).

Outcome: the panel gains a scope selector — **Global** plus one entry per
detected touchpad — and each scope has its own copy of the v0.1 settings. A
device scope that doesn't override an option inherits Global; Global inherits
the Hyprland default (unchanged from v0.1).

Finger swipes stay deferred to a later **0.3.0** (separate run).

## Constraints / decisions (from Andrew)

- **Branch:** new feature branch `feat/per-device-overrides` off `main`.
- **Git:** push over SSH via a persistent `ssh-agent`. *Andrew sets this up
  first* — starts an agent on a fixed socket and `ssh-add ~/.ssh/id_ed25519`
  (the key has a passphrase). Execution step 0 is: confirm `git -c
  core.sshCommand=... ls-remote` works with `SSH_AUTH_SOCK` exported; if it
  can't push, stop and report rather than guess.
- **Shell restarts:** fine anytime (`omarchy restart shell` as needed).
- **Done =** feature branch, all six test layers green, `CHANGELOG.md` entry
  under `## [Unreleased]`, and a PR against `main` with a summary. Do **not**
  merge or run the release workflow.

## Hyprland mechanism (confirmed by read-only probing)

- Per-device config = `hl.device({ name = "<slug>", <opt> = <val>, ... })` —
  flat keys, same names as `input.touchpad.*` (`HL.DeviceSpec` in
  `/usr/share/hypr/stubs/hl.meta.lua` lists `natural_scroll`,
  `clickfinger_behavior`, `disable_while_typing`, `tap_and_drag`,
  `middle_button_emulation`, `scroll_factor`, …). Omarchy's own
  `default/hypr/disabled-input-device.lua` uses `hl.device({ name, enabled })`
  at runtime **and** from sourced config, so both paths work.
- Device names: `hyprctl devices -j` → `.mice[].name` (slugified, e.g.
  `apple-inc.-magic-trackpad`). The list mixes mice and touchpads.
- **No readback:** `hyprctl getoption "device:<name>:natural_scroll"` →
  *"no such option"*. Per-device state is therefore the plugin's JSON only —
  no live fallback for device scopes (simpler than Global, which keeps the
  v0.1 `getoption` fallback for un-set options).

## Step 0 — spike (execution, ~30 min, revert everything)

1. `hyprctl eval 'hl.device({ name = "<a real touchpad>", natural_scroll = true })'`
   → expect `ok`; confirm scrolling flips; restore.
2. Put the same call in a throwaway sourced `.lua`, `hyprctl reload`, confirm
   it applies and a second reload doesn't error.
3. Nail touchpad detection: for each `/proc/bus/input/devices` block, slugify
   `N: Name=` the Hyprland way and match against `hyprctl devices -j .mice[]`;
   a match whose block has `B: PROP=` BUTTONPAD bit **or** a `B: ABS=` line is
   a touchpad. Fallback: if the cross-ref yields nothing, show all mice.
4. Check whether a Magic Trackpad reports a different name on USB vs BT
   (document as a known limitation if so).

If the spike shows `hl.device` doesn't behave, stop and report.

## Config document — v1 → v2

`~/.config/omarchy/magic-trackpad.json`:

```json
{
  "version": 2,
  "global":  { "touchpad": { …6 toggles… }, "scrollSpeed": "slow|normal|fast|null" },
  "devices": {
    "apple-inc.-magic-trackpad": { "touchpad": { … }, "scrollSpeed": … }
  }
}
```

Each entry is exactly the v1 shape. `null` on a toggle = inherit. `normalizeConfig`
accepts v1 (`{version:1, touchpad, scrollSpeed, gestures}`) and migrates it to
v2 under `global` (gestures dropped — not shipped). `ConfigStore.save` always
writes v2. A v1→v2 migration test is required.

## Files to change

### `Model.js` (pure — grows a device dimension)

- `defaultConfig()` → v2 shape (`global` + empty `devices`).
- `normalizeConfig(doc)` → accept v1 or v2, always return v2. Repairs unknown
  device keys / junk as today.
- `effectiveToggle(cfg, live, scope, key)` and `effectiveScroll(cfg, live,
  scope)` — **add a `scope` arg** (`"global"` or a device name). Cascade:
  device value → global value → (global only) `live`. Keep the current
  2-arg call working via defaults, or update all call sites (there are ~4 in
  `BarWidget.qml`).
- New `deviceLua({name, assign})` / `deviceEvalArgs(name, assign)` — mirror of
  the existing `configLua` / `configEvalArgs` but emitting
  `hl.device({ name = "…", … })`. Reuse `luaValue()`.
- `applyPlan(cfg)` — one `configEvalArgs` for `global` (as today) **plus** one
  `deviceEvalArgs` per device that has any non-null override.
- `generateLua(cfg)` — same, into the managed `.lua` (guarded `if type(hl) ~=
  "table"` header unchanged).
- `touchpadDevices(miceJson, procBusInput)` — new pure helper; the detection
  from spike step 3. Fixtures in the test.
- `hyprSlug(name)` — new pure helper (lowercase, spaces→`-`, keep `. -`).
- `summaryLine(cfg, scope)` — scope-aware ("GLOBAL" / device short name +
  the enabled bits for that scope).
- Keep `GESTURES` / `gestureLua` / `PLANNED_GESTURES` untouched (0.3.0).

### `HyprSync.qml`

- Add a `Process` that runs `hyprctl devices -j`, feeds `Model.touchpadDevices`
  (with a `Process`/`FileView` read of `/proc/bus/input/devices`), exposes
  `touchpadDevices: []` (list of `{name, label}`).
- `refresh()` — unchanged for the global `getoption` read; also kick the
  devices read.
- `applyLive` / `writeManaged` — no signature change; they already call
  `Model.applyPlan` / `Model.generateLua`, which now emit device blocks.

### `BarWidget.qml`

- New `property string scope: "global"`.
- Hero: show the active scope (`GLOBAL` or the device's short label).
- New **first section**: a scope picker. `ButtonGroup` when
  `1 + touchpadDevices.length <= 3`, else `Dropdown` (`qs.Ui` has both).
  `onChanged` sets `root.scope` and resets the cursor.
- `navItems` — prepend a `{kind:"scope"}` entry; the 6 toggles + scroll now
  read/write the **selected scope**.
- `setToggle` / `setScroll` / `cycleScroll` — take the current `scope`; write
  `d.global.touchpad[k]` or `d.devices[<name>].touchpad[k]` (create the device
  sub-object on first write); `sync.runOne(Model.toggleEvalArgs(...))` for
  global stays, add `Model.deviceEvalArgs(...)` for a device scope.
- Toggle rows on a device scope: `checked` = `effectiveToggle(cfg, live,
  scope, key)`; add a dim "· inherited" caption on the row when the device
  hasn't overridden that option (device value is `null`).
- New action row when `scope != "global"` and the device has overrides:
  **Reset to global** — clears `d.devices[<name>]`, re-applies. `qs.Ui`
  `Button` + a `ConfirmDialog` (already used elsewhere / available).
- Widen `contentWidth` a touch if the picker needs it (currently `358`).

### Tests

- `tests/model.test.js` — v1→v2 migration; `hyprSlug`; `touchpadDevices`
  (fixtures for a mouse+touchpad mix and the no-match fallback); scope-aware
  `effectiveToggle` cascade; `applyPlan` with a device override → 2 commands;
  `generateLua` with an `hl.device` block; `deviceLua` string shape.
- `tests/lua.test.js` — a config with a device override → generated `.lua`
  parses under `luac`.
- `tests/hypr-contract.test.js` — new case: `deviceEvalArgs` for a detected
  touchpad returns `ok` from `hyprctl eval` and doesn't error (no getoption
  verification is possible). Restore with `enabled = true` / re-apply nothing.
- `tests/e2e.sh` — after the existing tests: open panel, `nav` to the scope
  picker, `activate` to a device scope, `nav` to a toggle, `activate`; assert
  `magic-trackpad.json` gained `devices["<name>"].touchpad.<key>` and the
  managed `.lua` gained an `hl.device(` line. Restore.
- `tests/manifest.test.js` — unchanged (version stays semver; bumped by the
  release workflow later, not in this PR).

### Docs

- `README.md` — move **Per-device overrides** out of Roadmap into "What it
  controls" / a short "Scopes" paragraph; refresh the screenshot (new picker
  row) via the existing capture flow (`grim` + `magick` crop, save to
  `preview.png` + `docs/screenshots/`).
- `docs/TESTING.md` — add per-device steps to the manual checklist.
- `AGENTS.md` — "Scope: four phases" → per-device is now v0.2 done; note the
  no-readback fact and the device-name-stability caveat.
- `CHANGELOG.md` — a `## [Unreleased]` → `### Added` entry (the release
  workflow dates it later).
- Roadmap: finger swipes → **v0.3**.

## Reuse (don't reinvent)

- `Model.configLua` / `configEvalArgs` / `luaValue` / `toggleEvalArgs` — the
  device equivalents are near-copies.
- `Model.parseGetOption`, `effectiveScroll` cascade logic, `SCROLL_STOPS`.
- `ConfigStore.qml` `mutate()` / `save()` / the `FileView` + fallback timer —
  no structural change, just a deeper document.
- `HyprSync.qml` `_queue` / `_flush` / `writeManaged` / the loader-line
  machinery — untouched.
- `BarWidget.qml` `navItems` cursor pattern, the `Item`-wrapped `Toggle`
  Repeater delegate (keeps `modelData` defined), `ButtonGroup` usage for
  scroll — the scope picker copies the scroll `ButtonGroup` wiring.
- `tests/e2e.sh` `open_panel` / `nav` / `activate` helpers.

## Verification

1. `bash scripts/check.sh` — all six layers green (unit, manifest, lua,
   hypr-contract, smoke, e2e).
2. Manual: `omarchy restart shell`; open panel → picker shows **Global** +
   each touchpad. On a device scope, flip **Natural scroll** →
   `magic-trackpad.json` gains `devices["<name>"]`, `omarchy-magic-trackpad.lua`
   gains `hl.device({ name = "<name>", natural_scroll = … })`, and scrolling
   on *that* pad only reverses. **Reset to global** clears it. `hyprctl reload`
   and `omarchy restart shell` — overrides persist. Remove the plugin + the
   two files + loader line → config back to baseline.
3. v1 users: drop a v1 `magic-trackpad.json`, restart shell, confirm it
   migrates to v2 (`global` populated, `devices: {}`) with no lost settings.

## Sequence

0. Andrew sets up the ssh-agent; I verify push works, then
   `git checkout -b feat/per-device-overrides`.
1. Spike (above). Adjust this plan's detection approach if needed.
2. `Model.js` + `tests/model.test.js` (TDD; keep `npm test` green throughout).
3. `HyprSync.qml` device enumeration.
4. `BarWidget.qml` scope picker + scope-aware rows + Reset-to-global.
5. `lua.test.js`, `hypr-contract.test.js`, `e2e.sh`.
6. Docs + screenshot + CHANGELOG.
7. `bash scripts/check.sh` green → push branch → open PR against `main`.
