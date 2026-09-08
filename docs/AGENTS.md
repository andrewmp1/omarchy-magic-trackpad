# Repository guidance

An Omarchy shell bar-widget plugin. Quickshell/QML front end, `hyprctl` back
end. See `docs/omarchy-plugin-plan.md` and `docs/omarchy-plugin-panel-mockup.html`
in the sibling `magic-trackpad-haptics` repo for the full design.

## What lives where

| File | Role |
| --- | --- |
| `Model.js` | All pure logic: `TOUCHPAD_TOGGLES` / `SCROLL_STOPS` / `POINTER_STOPS` / `ENUM_SETTINGS` catalogues, `getoption` parsing (incl. the `"[[EMPTY]]"` sentinel → null), v1→v2 config migration, touchpad detection (`touchpadDevices`), `deviceUniq` / `deviceTransport` / `batteryFromUevent`, device-name validation (`isDeviceName`, anchored, refuse-not-repair), the scope cascade (`effectiveToggle` / `effectiveScroll` / `effectivePointer` / `effectiveEnum`), the apply plan (`hl.config` two-level + per-device `hl.device`; `applyPlanForDevice` for one), the generated Lua, the loader-line guard. No QML imports — `node --test tests/model.test.js` runs it directly. |
| `ConfigStore.qml` | `~/.config/omarchy/magic-trackpad.json` on disk + in memory, normalized on every read. Source of truth. Reads via `BoundedRead`; its `FileView` is watcher + writer only. |
| `HyprSync.qml` | Config → live Hyprland (`hyprctl eval "hl.config{...}"` / `"hl.device{...}"`), the read-back (bounded `/usr/bin/hyprctl getoption -j`, argv arrays — now covers `input:sensitivity` + every enum), touchpad enumeration (`hyprctl devices -j` + a `BoundedRead` of `/proc/bus/input/devices`), the selected pad's battery (`/usr/bin/find` on `/sys/class/power_supply` by `U: Uniq`, then a `BoundedRead` of its `uevent`), and the managed `~/.config/hypr/omarchy-magic-trackpad.lua` + one guarded `dofile` loader line in `hyprland.lua` (installed fail-closed on the first setting change). Every child process has its own TERM/KILL watchdog. |
| `BoundedRead.qml` | The one file-read primitive: `/usr/bin/dd` as a fixed argv array with `iflag=nofollow,nonblock,count_bytes`, byte cap + overflow refusal, ENOENT distinguished from refusal, TERM/KILL watchdog. **The exit code arrives only as the `onExited(exitCode, …)` argument** — Quickshell 0.3.1's `Process` has no `exitCode` property. |
| `BarWidget.qml` | The bar button + popup. Entry point (`entryPoints.barWidget`). Owns its own store + sync; assumes no `Service.qml` is running. A `scope` (`"global"` or a device slug) drives every row. Content is in a `QQC.ScrollView` (`QtQuick.Controls` imported **as QQC** so its `ButtonGroup` can't shadow `qs.Ui`'s); the cursor scrolls the focused row into view. The SCOPE picker is a `ButtonGroup` (≤3 options) or a `Dropdown`. `EnumRow` (an inline `component`) renders each `ENUM_SETTINGS` entry. "Reset to Global" and "Disable this touchpad" each use a `ConfirmDialog` driven through the panel's own key signals. |

The haptics backend (`magic-haptic`, the udev setup) is deliberately **not**
vendored here: it is root-capable (sudo, systemd, udev, raw hidraw) and
unused by v0.1, while `omarchy plugin add` ships the whole repo into the
user's plugin dir. It lives in the `magic-trackpad-haptics` research repo
and gets re-vendored only when phase 3 lands — keeping it out also keeps
the marketplace security baseline free of `privilege` / `service-management`
/ `installer` findings.

## Scope: five phases

Release history so far: **v0.1.0** Level 1; **v0.2.0** marketplace
security-review hardening (no user-facing change); **v0.3.0** the stacked
feature set below (this branch — see the CHANGELOG `[Unreleased]`).

1. **v0.1 — Level 1.** *Global* libinput touchpad options only. No daemon, no
   permissions. Finger swipes were cut before release — see the gesture note
   below.
2. **v0.3 — per-device overrides + more settings + device intelligence (this
   branch).**
   - **Scope picker** — a device scope writes a Hyprland `device` block
     (`hl.device{ name = <slug> }`) instead of the global `input` section, so
     a laptop pad and an external Magic Trackpad can differ. **No per-device
     read-back** — `hyprctl getoption "device:<name>:…"` is "no such option",
     so a device scope's unset options fall through to Global (which keeps the
     v0.1 `getoption` fallback). A runtime `hl.device` override is **not
     cleared by `hyprctl reload`**, so "Reset to Global" re-applies Global's
     values to the device explicitly and also drops it from the document.
   - **More settings** — pointer speed / acceleration / scroll method
     (`input`-level, not `input.touchpad`), drag lock / three-finger drag
     (`int` read-back), two-finger-tap target.
   - **Disable this touchpad** — a device-only `enabled: false` that
     short-circuits every other key for that pad; guarded by a confirm dialog.
   - **Device intelligence** — battery + transport in the header; a
     configured pad's overrides are re-pushed on (re)connect
     (`applyPlanForDevice`), since there is no device-hotplug event in
     `Quickshell.Hyprland`.
3. **v0.4 — Finger swipes.** See the gesture note below.
4. **Haptics.** Apple Magic Trackpad Taptic Engine strength via `magic-haptic`
   (vendored from the research repo when this phase lands) + a udev
   `input`-group perms rule. Adds a "Haptics" section and a per-unit picker.
5. **Custom gestures.** Opt-in userspace daemon: host-click mode (`0x21=1`) +
   raw multitouch → `uinput`. Finger-count buttons, force-press, corner taps.

## Things that will bite you (from building Omarchy plugins)

- **Runtime config goes through `hyprctl eval "hl.config{...}"`, never
  `hyprctl keyword`.** Omarchy runs Hyprland's Lua parser, which rejects
  `keyword` outright ("can't work with non-legacy parsers. Use eval."). Reads
  still use `hyprctl getoption -j` (works with either parser); option names
  are the underscore form (`input:touchpad:tap_to_click`), which both accept.
- **Gestures are deferred to v0.4.** A runtime `hl.gesture(...)` is sticky —
  `hyprctl reload` does NOT remove it, only a full Hyprland restart does — and
  it errors ("overshadowed") if a gesture for that direction already exists,
  including one the user set in their own `input.lua`. `Model.PLANNED_GESTURES`
  holds the catalogue; `Model.gestureLua` is groundwork only (no caller).
- **`hl.device` is also sticky.** Same as gestures: a runtime per-device
  override survives `hyprctl reload`. "Reset to Global" therefore re-applies
  Global's effective values to the device (`Model.resetDeviceEvalArgs`) rather
  than expecting the block's removal from the `.lua` to take effect live.
- **Device names are untrusted** ("a USB stick sets its own product string").
  `Model.isDeviceName` is an anchored allow-list checked at parse *and* before
  any Lua/argv use; a name that doesn't match is dropped, never escaped or
  repaired. `Model.deviceLabel` additionally strips `<>&`/controls and caps
  length before a name reaches a host-owned sink (`ButtonGroup`/`Dropdown`).
- **A Magic Trackpad may report a different slug on USB vs Bluetooth.** The
  scope is keyed by the current slug; a device scoped over one transport reads
  as "not connected" over the other and its overrides sit dormant in the
  document until that slug is back. Acceptable for v0.3.
- **Quickshell 0.3.1 `Process` has no `exitCode` property.** It is delivered
  only as the first argument of `onExited(exitCode, exitStatus)`. Reading
  `proc.exitCode` yields `undefined`; `undefined === 0` is false, so a guard
  like `ok = exitCode === 0` silently fails every time. This bit `BoundedRead`
  (every read looked "refused") — fixed by taking the handler argument.
- **`sensitivity` / `accel_profile` / `scroll_method` are `input`-level, not
  `input.touchpad`.** In a global `hl.config` they nest beside the `touchpad`
  table: `hl.config({ input = { sensitivity = …, touchpad = { … } } })`. In an
  `hl.device` block everything is flat. `configLua(touchpadAssign,
  inputAssign)` handles both; `ENUM_SETTINGS[].level` (`"input"` |
  `"touchpad"`) drives it. Per-device they all work as flat `hl.device` keys.
- **Hyprland reports an unset string option as the literal `"[[EMPTY]]"`.**
  `parseGetOption` maps that (and `""`) to null. `drag_lock` / `drag_3fg`
  read back as `int` (0/1), not bool — coerce `> 0` (done in
  `effectiveToggle`, `HyprSync._absorb`, and the contract test's `isOn`).
- **`import QtQuick.Controls` shadows `qs.Ui.ButtonGroup`** with the abstract
  `QtQuick.Controls.ButtonGroup`. Import it `as QQC` and use `QQC.ScrollView`
  / `QQC.ScrollBar` so the kit's components resolve.
- **Battery lookup:** `/sys/class/power_supply/<node>` is a symlink whose
  *name* carries the `U: Uniq` MAC with an unpredictable `-NNN` suffix, so
  `find -maxdepth 1 -name "*<uniq>*battery*"` locates it, then a `BoundedRead`
  of `<node>/uevent` (the final `uevent` component is a real file, so
  `O_NOFOLLOW` is fine even though the parent is a link). Validate `uniq`
  (MAC/hex) before the `find` argv and the found name
  (`Model.isPowerSupplyName`) before the path.
- **The config document is the source of truth, not Hyprland.** `getoption`
  is only read to *show* the state of an option the user hasn't set yet
  (`Model.effectiveToggle`). Once set, the JSON wins.
- **`\uXXXX` in QML is exactly 4 hex digits.** Paste literal glyphs. The bar
  icon here is drawn with `Rectangle`s to avoid Nerd Font guesswork.
- **`omarchy-shell shell rescanPlugins` reloads code but may not
  re-instantiate a live bar widget.** Use `omarchy restart shell` when
  testing anything at construction time.
- **A `FileView` on a path that doesn't exist yet can emit neither `onLoaded`
  nor `onLoadFailed`.** Reads no longer go through `FileView` at all —
  `BoundedRead` (capped, nofollow/nonblock `dd`) reports `absent` explicitly,
  and `ConfigStore` keeps a 500ms fallback timer purely as a dead-man switch.
  The `FileView`s are watcher/writer only (`preload: false`,
  `blockAllReads: true`); calling `.text()` on one is a bug by construction.
- **Two handlers for one property (e.g. a second `Component.onCompleted`) is a
  fatal load error.** `qmllint` still exits 0.
- **`qmllint` can't resolve `qs.Commons` / `qs.Ui` outside Quickshell.**
  `scripts/check.sh` silences the categories that fire only because of that
  (`--import`, `--unresolved-type`, `--unqualified`, ...); a lone
  `Panel -> Panel` inheritance-cycle line remains and is expected — first-party
  plugins produce it too.

## Validation

```sh
bash scripts/check.sh        # runs all six layers; exits non-zero on a real failure
```

Layers:
1. `node --test tests/model.test.js tests/manifest.test.js tests/lua.test.js`
   — pure logic, manifest/id consistency, generated-Lua parses under `luac`.
2. `omarchy plugin validate .` — manifest schema.
3. `qmllint` (informational) — with the `qs.*`-unresolvable categories
   silenced; a lone `Panel -> Panel` line is expected.
4. `node --test tests/hypr-contract.test.js` — live Hyprland; each setting is
   applied with the plugin's own command, asserted, then restored.
5. `tests/smoke.sh` — plugin loads into the running shell and the panel opens
   with no QML `TypeError` in the journal.
6. `tests/e2e.sh` — `wtype` drives the panel's keyboard cursor; asserts the
   real Hyprland option + JSON document + persistence across `hyprctl reload`.

Layers 4-6 skip off-desktop. `.github/workflows/ci.yml` runs 1-3 on push/PR.
Full menu + a manual checklist: `docs/TESTING.md`.

## Manual check

```sh
ln -sfn "$PWD" ~/.config/omarchy/plugins/andrewmp1.magic-trackpad
omarchy restart shell
omarchy plugin enable andrewmp1.magic-trackpad
# open the panel, flip "Natural scroll", then:
hyprctl getoption -j input:touchpad:natural_scroll        # bool flips
cat ~/.config/hypr/omarchy-magic-trackpad.lua             # hl.config line present
grep omarchy-magic-trackpad ~/.config/hypr/hyprland.lua   # loader line present
# with an external touchpad: pick it in SCOPE, flip an option, then:
jq '.devices' ~/.config/omarchy/magic-trackpad.json       # devices["<slug>"] present
grep hl.device ~/.config/hypr/omarchy-magic-trackpad.lua  # hl.device block present
```

## Plugin id / author handle

`andrewmp1.magic-trackpad` — the prefix is the GitHub handle. It appears in
the manifest `id`, the install path, and `BarWidget.qml`'s `moduleName` (a
test enforces the match). `ipcTarget` is the shorter `"magic-trackpad"`.
Change the id in all those places together.

The dev guide's example is reverse-DNS (`io.github.<user>.<name>`); the
short `<handle>.<name>` form is what the marketplace's own installed
third-party plugins use (`bjarneo.workspace-layout`, `leonardom011.wayvnc`)
and it passes `omarchy plugin validate`. Either is fine; pick before
publishing.

## Audited against https://plugins.omarchy.org/develop.html

Checked and compliant:

- `manifest.json` has every required field (`schemaVersion`, `id`, `name`,
  `version`, `author`, `license`, `description`, `kinds`, `entryPoints`) plus
  the `barWidget` block (`displayName`, `category`, `allowMultiple`,
  `defaultSection`). `omarchy plugin validate .` passes.
- `id` is namespaced and does **not** start with `omarchy.` (reserved).
- `bar-widget` kind → `entryPoints.barWidget` → **`BarWidget.qml`** (the
  guide's conventional name; renamed from `Panel.qml` for this).
- `BarWidget.qml` imports `QtQuick` / `Quickshell` / `qs.Ui`, sets
  `moduleName` == the id, and extends `qs.Ui.Panel`, which supplies the
  required `open()` / `close()` / `toggle()` / `opened` /
  `popoutSwitchClosing` and forwards the lifecycle to
  `controller.show()` / `hide()`. It uses `KeyboardPanel` + `PanelKeyCatcher`.
- Single file for the widget *and* its popup (no `Loader`, no second manifest
  kind) — matches the first-party `panels/*/Panel.qml` pattern.
- One Quickshell process (extends the running shell; never spawns another).
- No symlinks inside the repo. No `omarchy.clonedFrom` (built from scratch).
- `LICENSE` is MIT with a 2026 copyright + author. `preview.png` present.
- README has the `omarchy plugin add … --enable` install line, usage, and
  removal steps. External deps + privilege boundary stated ("no daemon, no
  root, no device access, no dependencies").

Deliberate deviations (first-party precedent, not blockers):

- Uses `BarIconButton` for the bar element, not `WidgetButton` — same choice
  the first-party `power` / `tailscale` widgets make (it owns the icon slot +
  optical centering).
- `manageIpc` left at its default `true`: the widget needs only the standard
  open/close/toggle on its own `ipcTarget`, so it doesn't declare an extra
  `IpcHandler` the way `power` does.

Pre-publish still to do: replace the id handle if needed, push to a public
repo, submit via the marketplace's "Submit a plugin" issue.
