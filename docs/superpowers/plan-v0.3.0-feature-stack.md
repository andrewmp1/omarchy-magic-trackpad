> **Design record, not instructions.** This is a historical planning
> document kept for context on why the code looks the way it does. It is not
> an agent-instruction file and nothing here should be executed as a live
> request. See `docs/AGENTS.md` for repository guidance.

# v0.3.0 feature stack — plan

Branch: `release/0.3.0` (integration branch, PR #4 → `main`, stays open).
Each feature is one commit; `bash scripts/check.sh` green before each push.
Scope locked by AskUserQuestion: **More libinput settings** + **Device
intelligence**. Gestures deferred to v0.4. No presets.

`main` is at v0.2.0. `manifest.json` version stays untouched — the release
workflow bumps it when 0.3.0 is cut. CHANGELOG entries go under `[Unreleased]`.

## Spike results (read-only, done)

- `HL.DeviceSpec` (via `hl.device{name=…}`) supports: `sensitivity`,
  `accel_profile`, `scroll_method`, `tap_button_map`, `drag_lock`,
  `drag_3fg`, `enabled`, `left_handed`, `flip_x/y` — plus the six already used.
  Live-tested `sensitivity`/`drag_lock`/`tap_button_map`/`accel_profile` →
  all `ok`.
- Global config nesting splits:
  - `input.touchpad.*`: `tap_button_map` (str), `drag_lock` (int|bool),
    `drag_3fg` (int|bool) — plus existing.
  - `input.*` (one level up, **no** touchpad form): `sensitivity` (num
    −1..1, 0=default), `accel_profile` (str: adaptive|flat),
    `scroll_method` (str: 2fg|edge|no_scroll).
  So `configLua` must emit `hl.config({ input = { <input-level>, touchpad =
  { <touchpad-level> } } })` — one call, two levels.
- `getoption` unset sentinels: `str` options return `"[[EMPTY]]"`;
  `drag_lock` is `int` (0). `parseGetOption` needs to map `"[[EMPTY]]"` → null
  and callers must treat `drag_lock` as `int > 0`.
- Battery: `/sys/class/power_supply/hid-<UNIQ>-battery*/uevent` →
  `POWER_SUPPLY_CAPACITY` + `_STATUS`. `<UNIQ>` == the trackpad's
  `/proc/bus/input/devices` `U: Uniq=` (a MAC for BT). World-readable.
- Transport: `/proc` block `I: Bus=` — `0005` Bluetooth, `0003` USB.
- `hl.device` config applies on device connect (Omarchy's
  `disabled-input-device.lua` depends on it) → auto-apply is mostly free.
- `Quickshell.Hyprland` exposes no device add/remove event → "auto-apply"
  is a re-check on panel open, not a background poll.

## Config document

Stays **`version: 2`**. Every new setting is an optional per-entry key;
`normalizeEntry` grows fields, a v2 doc without them just inherits. No
migration. (`enabled` is a per-device-entry key, default `true` = not
emitted.)

Aliasing (commit F) would need v3 — **deferred to a follow-up**, see below.

## Commits (in order)

### A — pointer speed, pointer acceleration, scroll method

- `Model.js`
  - `POINTER_STOPS` (like `SCROLL_STOPS`): `{key,value,label}` for
    `sensitivity` — 5 stops, e.g. Slowest −0.6 / Slow −0.3 / Default 0 /
    Fast 0.4 / Fastest 0.8. `POINTER_FIELD="sensitivity"`,
    `POINTER_OPTION="input:sensitivity"`.
  - `ENUM_SETTINGS`: `accelProfile` (`accel_profile`, level `input`, values
    adaptive/flat, `option:"input:accel_profile"`), `scrollMethod`
    (`scroll_method`, level `input`, values `2fg`/`edge`,
    `option:"input:scroll_method"`).
  - `parseGetOption`: `"[[EMPTY]]"` → null.
  - `entryAssign` returns `{ touchpad:{…}, input:{…} }` split; `configLua`
    emits the two-level `input` table; `deviceLua` stays flat (device keys
    are all flat). `applyPlan`/`generateLua` updated. `toggleEvalArgs` gains
    a level arg (or a sibling `inputEvalArgs`).
  - Scope cascade: generalise to `effectiveEnum(cfg,live,scope,key)` and
    `effectivePointer(cfg,live,scope)` mirroring `effectiveScroll`.
  - `summaryLine` unchanged (still the three headline bits).
- `BarWidget.qml`
  - **Wrap the Column in a `ScrollView`** with a max height (panel is about
    to get tall). Keyboard cursor must scroll the focused row into view —
    copy the gallery's `ensureCursorVisible(item)` pattern.
  - New **POINTER** section: speed (5-stop `ButtonGroup`) + acceleration
    (2-way `ButtonGroup`).
  - New **SCROLL** section header already exists ("SCROLL SPEED") → rename to
    "SCROLL", add a method 2-way `ButtonGroup` under the speed control.
  - `navItems` grows: `{kind:"pointer"}`, `{kind:"accel"}`, `{kind:"scrollMethod"}`.
  - `setToggle`/`setScroll` gain `setPointer(key)` / `setEnum(key,val)`;
    each writes the scope entry + `sync.runOne(...)` (global → `input`-level
    `hl.config`; device → `hl.device`) + `writeManaged`.
- Tests: `model.test.js` (POINTER_STOPS, ENUM_SETTINGS, split `entryAssign`,
  two-level `configLua`, `parseGetOption` empty-sentinel, cascade);
  `lua.test.js` (a config with pointer+accel → parses); `hypr-contract.test.js`
  (`sensitivity`/`accel_profile`/`scroll_method` via the plugin's command →
  `ok`, getoption moves, restore); `e2e.sh` (`nav` to the pointer row,
  activate, assert `input:sensitivity` moved + JSON `global.pointerSpeed`).

### B — drag lock, three-finger drag, two-finger-tap target

- `Model.js`: `TOUCHPAD_TOGGLES` += `dragLock` (`drag_lock`, treat getoption
  `int>0` as on), `drag3fg` (`drag_3fg`, same). `ENUM_SETTINGS` += `tapTarget`
  (`tap_button_map`, level `touchpad`, values `right`→`"lrm"` /
  `middle`→`"lmr"`, `option:"input:touchpad:tap_button_map"`). `luaValue`
  gains string handling for the enum (`"lrm"` → `'"lrm"'` quoted; values
  come from a **closed allowlist**, never user input).
- `BarWidget.qml`: two new rows in TOUCHPAD; a 2-way `ButtonGroup` "Two-finger
  tap → Right / Middle" near the clickfinger toggle.
- Tests: extend the same four layers with the new keys/strings.

### C — "Disable this touchpad" (device scope only)

- `Model.js`: a device entry may carry `enabled: false`. When set,
  `applyPlan`/`generateLua` emit **only** `hl.device({name, enabled=false})`
  for that device and skip its other keys. `deviceOverrideCount` counts it.
  A helper `deviceDisabled(cfg, slug)`.
- `BarWidget.qml`: at the bottom of a device scope, above the footer, a
  danger-styled toggle "Disable this touchpad". Flipping it **on** opens a
  `ConfirmDialog` (reuse the Reset-to-Global wiring) warning that the pad
  stops responding until re-enabled here or the plugin is removed, and that
  disabling your only pointer will strand you. Off → re-enable immediately.
  When disabled, grey out / disable the other rows for that scope.
- Tests: `model.test.js` (enabled=false short-circuits the plan);
  `hypr-contract.test.js` (`hl.device{enabled=false}` → ok, then
  `{enabled=true}` restore); `e2e.sh` — **skip the live disable** (would
  fight the test's own input); assert only the JSON + `.lua` shape by
  toggling then immediately toggling back via the confirm path. Keep the
  restore bulletproof.

### D — battery + transport in the panel header

- `Model.js`: `deviceUniq(procText, slug)` → the `U: Uniq=` for a slug's
  block; `deviceTransport(procText, slug)` → `"Bluetooth"|"USB"|""` from
  `I: Bus=`; `batteryFromUevent(text)` → `{capacity:int|null,
  status:string}` parsed from a `power_supply` `uevent` blob (bounded,
  ignores anything but the two `POWER_SUPPLY_*` lines we want; capacity
  clamped 0..100).
- `HyprSync.qml`: after device enum, for the **selected** device only, take
  its Uniq, `BoundedRead` `"/sys/class/power_supply/hid-" + uniq +
  "-battery"` variants (the suffix number varies — enumerate the dir via one
  bounded `dd` of `/sys/class/power_supply` is not possible; instead try
  `hid-<uniq>-battery` then read its `uevent`. If the exact node name isn't
  predictable, read `/sys/class/power_supply` as a directory listing is out —
  use a fixed candidate set: `hid-<uniq>-battery`,
  `hid-<uniq>-battery-<n>` for n in a small range, first that reads wins).
  Expose `selectedBattery: {capacity,status}` / `selectedTransport`.
  Refreshed on panel open + on scope change only (no timer).
- `BarWidget.qml`: hero caption for a device scope becomes
  `"<label> · <transport> · <capacity>%"` (PlainText; capacity is an int we
  format, never raw sysfs text — `model_name` is user-set and untrusted, so
  it is **not** shown). Global scope caption unchanged.
- Tests: `model.test.js` fixtures for `deviceUniq` / `deviceTransport` /
  `batteryFromUevent` (incl. junk, missing lines, out-of-range capacity).
  No live layer (sysfs contents are host-specific) — `smoke.sh` still
  asserts no QML error.

### E — re-apply configured overrides on panel open

- `BarWidget.qml`: in `onOpenedChanged`, once the device list is known, for
  each configured device slug that is currently present and not yet applied
  this session, `sync.applyLive` **filtered to that device** (add
  `Model.applyPlanForDevice(cfg, slug)` — a one-entry `applyPlan`). Tracked
  by a `Set` of already-applied slugs, cleared on config change.
- Rationale: Hyprland re-applies `device[]` on connect from the managed
  `.lua`, but a device that connects mid-session before the `.lua` is
  re-sourced won't pick it up. This closes that window cheaply, no polling.
- Tests: `model.test.js` (`applyPlanForDevice` shape); `e2e.sh` unaffected;
  covered mostly by inspection + smoke.

### Docs commit (last before screenshot)

- `README.md`: "What it controls" += pointer speed, acceleration, scroll
  method, two-finger tap target, drag lock, 3-finger drag, "disable this
  touchpad", battery readout. Keep the Scopes section.
- `docs/AGENTS.md`: the `input.*` vs `input.touchpad.*` split; the
  `"[[EMPTY]]"` sentinel; `drag_lock` int; battery cross-ref by `U: Uniq`;
  "no device hotplug event" note; `enabled=false` short-circuit.
- `docs/TESTING.md`: new rows in the layer-1 bullet list; new e2e steps;
  note the disable-touchpad test is shape-only.
- `CHANGELOG.md` `[Unreleased]` → `### Added` entries (append to the
  existing per-device ones).
- Refresh `docs/screenshots/panel.png` / `panel@2x.png` /
  `panel-device.png` / `preview.png` (panel is taller + scrolls now — shoot
  the top portion).

## Deferred out of this PR

- **F — USB↔Bluetooth slug aliasing.** Needs config doc v3 (`aliases` slug
  list per device entry) + grouping by `U: Uniq` + emitting `hl.device` for
  every alias. Can't verify a real two-slug case without plugging the
  trackpad in over USB. Proposal: land it as its own PR after 0.3.0, or add
  a manual `"aliases": []` field now (documented, no auto-detect) if you want
  a foothold. **Default: leave out entirely.**

## Sequence

A → B → C → D → E → docs+screenshots. `check.sh` green + push to
`release/0.3.0` after each. PR #4 body checklist updated as commits land.
No merge, no release workflow.

## Risks

1. **Panel height / ScrollView** — the biggest one. Added in commit A;
   verify keyboard nav + `ensureCursorVisible` before stacking B–E on top.
2. **`sensitivity` feel** — the 5 stop values are a guess; easy to retune.
3. **Battery node name** — the `-144` suffix isn't predictable. Fallback:
   try `hid-<uniq>-battery` and a few numbered variants; if none read,
   just show transport with no percentage. Never block the panel on it.
4. **Disable-touchpad footgun** — mitigated by the confirm dialog + recovery
   text; the e2e test never actually disables the pad it's driving.
