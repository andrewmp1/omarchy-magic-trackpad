// Pure logic for the Magic Trackpad plugin. No QML imports — `node --test
// tests/model.test.js` runs this file directly.
//
// Level 1: the libinput touchpad options Hyprland already exposes. As of v0.2
// each option has a scope: the global `input.touchpad` section, or a specific
// device via a Hyprland `device` block. The plugin's own JSON document is the
// source of truth. `hyprctl getoption` is read for the GLOBAL scope only, to
// show the state of an option the user has not set — per-device values have no
// getoption readback, so an unset device option shows the global effective
// value and is marked "inherited".
//
// Omarchy runs Hyprland's Lua config parser, so runtime changes go through
// `hyprctl eval "hl.config{...}"` / `"hl.device{...}"` — `hyprctl keyword` is
// rejected ("can't work with non-legacy parsers"). Reads still use `hyprctl
// getoption -j`, which works either way.

// ---------------------------------------------------------------- catalogue

// `option` is the `getoption` path (underscores; Hyprland accepts them).
// `field` is the key inside `hl.config{ input = { touchpad = { ... } } }` and,
// identically, inside `hl.device{ name = ..., ... }`.
var TOUCHPAD_TOGGLES = [
  { key: "tapToClick",         field: "tap_to_click",             option: "input:touchpad:tap_to_click",             label: "Tap to click",          help: "Tap the pad to click without pressing down." },
  { key: "twoFingerRight",     field: "clickfinger_behavior",     option: "input:touchpad:clickfinger_behavior",     label: "Two-finger right-click", help: "Two fingers = right click, three = middle. Off uses corner zones." },
  { key: "naturalScroll",      field: "natural_scroll",           option: "input:touchpad:natural_scroll",           label: "Natural scroll",        help: "Content follows the fingers, like a phone." },
  { key: "disableWhileTyping", field: "disable_while_typing",      option: "input:touchpad:disable_while_typing",     label: "Disable while typing",   help: "Ignore the pad for a moment after a keypress." },
  { key: "tapAndDrag",         field: "tap_and_drag",             option: "input:touchpad:tap_and_drag",             label: "Tap and drag",          help: "Tap-tap-hold to start dragging." },
  { key: "middleClickPaste",   field: "middle_button_emulation",  option: "input:touchpad:middle_button_emulation",  label: "Middle-click emulation", help: "Left + right together acts as a middle click." }
]

// Scroll speed is a float (`input.touchpad.scroll_factor`); three named stops.
var SCROLL_FIELD = "scroll_factor"
var SCROLL_OPTION = "input:touchpad:scroll_factor"
var SCROLL_STOPS = [
  { key: "slow",   value: 0.2, label: "Slow" },
  { key: "normal", value: 0.4, label: "Normal" },
  { key: "fast",   value: 0.8, label: "Fast" }
]

var GLOBAL = "global"

// Finger-swipe gestures are DEFERRED to v0.3. `GESTURES` stays empty and a
// stale document's `gestures` key is ignored (normalizeConfig never reads it),
// so nothing here reaches Hyprland yet. `gestureLua` / `PLANNED_GESTURES` are
// groundwork for that release and are exercised only by fixed catalogue data.
var GESTURES = []
var PLANNED_GESTURES = [
  { key: "workspaceSwipe", label: "Swipe to switch workspace", help: "Horizontal N-finger swipe moves between workspaces.",
    direction: "horizontal", action: "workspace", fingerChoices: [3, 4], defaultFingers: 3 }
]

function gestureLua(fingers, direction, action) {
  return 'hl.gesture({ fingers = ' + String(Number(fingers)) + ', direction = "' + direction + '", action = "' + action + '" })'
}

function gestureEvalArgs(fingers, direction, action) {
  return ["hyprctl", "eval", gestureLua(fingers, direction, action)]
}

// ---------------------------------------------------------------- device names

// A Hyprland device slug is lowercase and uses only [a-z0-9._-]. Device names
// reach a Lua string (`hl.device({ name = "..." })`) and an argv, so anything
// that is not this exact shape is REFUSED, never repaired or escaped — the
// device is simply not offered, written, or applied. Bounded length too.
var DEVICE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/

function isDeviceName(name) {
  return typeof name === "string" && DEVICE_NAME_RE.test(name)
}

// Slugify a `/proc/bus/input/devices` "Name" the way Hyprland does, so a
// touchpad found there can be matched to a `hyprctl devices` entry.
function hyprSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 128)
}

var VENDOR_TOKENS = { apple: 1, "inc.": 1, "inc": 1, logitech: 1, microsoft: 1, dell: 1, hp: 1,
  synaptics: 1, elan: 1, "elantech": 1, alps: 1, cirque: 1, "corp.": 1, "corp": 1, "co.": 1, "ltd.": 1 }

// A short, display-safe label for a device slug. The slug already passed
// isDeviceName so it holds no markup, but strip defensively and cap anyway —
// it lands in host-owned sinks (ButtonGroup labels) the plugin cannot pin to
// PlainText.
function deviceLabel(name) {
  var slug = String(name || "").replace(/[<>&\x00-\x1f\x7f-\x9f⁦-⁩‪-‮]/g, "")
  var parts = slug.split("-").filter(function (p) { return p.length > 0 })
  while (parts.length > 1 && VENDOR_TOKENS[parts[0]]) parts.shift()
  var label = parts.join(" ").replace(/\b([a-z])/g, function (m) { return m.toUpperCase() })
  if (label.length > 40) label = label.slice(0, 39) + "…"
  return label || "Device"
}

// ---------------------------------------------------------------- document

function emptyEntry() {
  var e = { touchpad: {}, scrollSpeed: null }
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) e.touchpad[TOUCHPAD_TOGGLES[i].key] = null
  return e
}

function defaultConfig() {
  return { version: 2, global: emptyEntry(), devices: {} }
}

// Repair anything a hand-edit got wrong rather than refuse it. Accepts a v1
// document ({ version:1, touchpad, scrollSpeed, gestures }) and migrates it
// under `global`; always returns a v2 document.
function normalizeConfig(doc) {
  var base = defaultConfig()
  if (!doc || typeof doc !== "object") return base

  var isV2 = doc.version === 2 || (doc.global && typeof doc.global === "object")
  if (isV2) {
    base.global = normalizeEntry(doc.global)
    var devs = (doc.devices && typeof doc.devices === "object") ? doc.devices : {}
    for (var name in devs) {
      if (!isDeviceName(name)) continue          // refuse a junk key, do not repair
      base.devices[name] = normalizeEntry(devs[name])
    }
  } else {
    // v1 (or bare): the whole document was the global entry.
    base.global = normalizeEntry(doc)
  }
  return base
}

function normalizeEntry(e) {
  var out = emptyEntry()
  var src = (e && typeof e === "object") ? e : {}
  var tp = (src.touchpad && typeof src.touchpad === "object") ? src.touchpad : {}
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) {
    var k = TOUCHPAD_TOGGLES[i].key
    out.touchpad[k] = (tp[k] === true || tp[k] === false) ? tp[k] : null
  }
  out.scrollSpeed = SCROLL_STOPS.some(function (s) { return s.key === src.scrollSpeed })
    ? src.scrollSpeed : null
  return out
}

function scopeEntry(cfg, scope) {
  var c = normalizeConfig(cfg)
  if (!scope || scope === GLOBAL) return c.global
  return c.devices[scope] || emptyEntry()
}

// -------------------------------------------------------------- hyprctl I/O

// `hyprctl -j getoption <name>` → current value, or null if unset/absent.
function parseGetOption(raw) {
  try {
    var json = JSON.parse(String(raw || "").trim() || "{}")
    if (json.bool !== undefined) return !!json.bool
    if (json.int !== undefined) return Number(json.int)
    if (json.float !== undefined) return Number(json.float)
    if (json.str !== undefined) return String(json.str)
    return null
  } catch (e) {
    return null
  }
}

function scrollStopValue(key) {
  for (var i = 0; i < SCROLL_STOPS.length; i++) if (SCROLL_STOPS[i].key === key) return SCROLL_STOPS[i].value
  return 0.4
}

// Minimal Lua-literal for the value types we emit (bool, number).
function luaValue(v) {
  if (v === true) return "true"
  if (v === false) return "false"
  return String(Number(v))
}

function assignParts(assign) {
  var parts = []
  for (var k in assign) parts.push(k + " = " + luaValue(assign[k]))
  return parts.join(", ")
}

// ---- global (input.touchpad) -------------------------------------------------

function configLua(assign) {
  return "hl.config({ input = { touchpad = { " + assignParts(assign) + " } } })"
}

function configEvalArgs(assign) {
  return ["hyprctl", "eval", configLua(assign)]
}

// One global touchpad field change (used on each click in the Global scope).
function toggleEvalArgs(field, value) {
  var a = {}
  a[field] = value
  return configEvalArgs(a)
}

// ---- per-device (hl.device) ----------------------------------------------

// Returns "" for an invalid name — every caller checks and skips it.
function deviceLua(name, assign) {
  if (!isDeviceName(name)) return ""
  return 'hl.device({ name = "' + name + '", ' + assignParts(assign) + ' })'
}

function deviceEvalArgs(name, assign) {
  var lua = deviceLua(name, assign)
  return lua ? ["hyprctl", "eval", lua] : null
}

function deviceToggleEvalArgs(name, field, value) {
  var a = {}
  a[field] = value
  return deviceEvalArgs(name, a)
}

// "Reset to global": a runtime `hl.device` that pins every field of `name`
// back to what the global scope currently resolves to. The plugin drops the
// device from its document at the same time, so the block disappears from the
// managed .lua and the device inherits global cleanly on the next reload —
// this call just makes the running session match immediately (a runtime
// `hl.device` override does not clear itself on reload).
function resetDeviceEvalArgs(cfg, live, name) {
  if (!isDeviceName(name)) return null
  var assign = {}
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) {
    var t = TOUCHPAD_TOGGLES[i]
    assign[t.field] = effectiveToggle(cfg, live, GLOBAL, t.key)
  }
  assign[SCROLL_FIELD] = scrollStopValue(effectiveScroll(cfg, live, GLOBAL))
  return deviceEvalArgs(name, assign)
}

// ---- assemble ----------------------------------------------------------------

function entryAssign(entry) {
  var assign = {}
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) {
    var t = TOUCHPAD_TOGGLES[i]
    if (entry.touchpad[t.key] === true || entry.touchpad[t.key] === false) assign[t.field] = entry.touchpad[t.key]
  }
  if (entry.scrollSpeed) assign[SCROLL_FIELD] = scrollStopValue(entry.scrollSpeed)
  return assign
}

// Every command to reconcile Hyprland with `cfg`: one `hl.config` for the
// global section, then one `hl.device` per device that overrides anything.
function applyPlan(cfg) {
  var c = normalizeConfig(cfg)
  var plan = []

  var g = entryAssign(c.global)
  if (Object.keys(g).length > 0) plan.push(configEvalArgs(g))

  for (var name in c.devices) {
    if (!isDeviceName(name)) continue
    var d = entryAssign(c.devices[name])
    if (Object.keys(d).length > 0) plan.push(deviceEvalArgs(name, d))
  }
  return plan
}

// ---------------------------------------------------------------- persistence

var LOADER_MARK = "omarchy-magic-trackpad"
var LOADER_LINE = 'pcall(dofile, (os.getenv("HOME") or "") .. "/.config/hypr/omarchy-magic-trackpad.lua")'

function needsLoader(hyprlandLua) {
  return String(hyprlandLua || "").indexOf(LOADER_MARK) === -1
}

function withLoader(hyprlandLua) {
  var text = String(hyprlandLua || "")
  if (!needsLoader(text)) return text
  var sep = text.length > 0 && text.charAt(text.length - 1) !== "\n" ? "\n" : ""
  return text + sep + "\n-- " + LOADER_MARK + ": load the Magic Trackpad plugin's managed settings (safe to remove)\n" + LOADER_LINE + "\n"
}

// The managed Lua file: applied by Hyprland on every config load, so the
// settings survive a restart. Same `hl.config` / `hl.device` calls Omarchy's
// own hyprland.lua uses. Contains only literal calls with literal values — it
// never reads a file, so there is no state-as-code path.
function generateLua(cfg) {
  var c = normalizeConfig(cfg)
  var out = [
    "-- " + LOADER_MARK + " — generated by the Magic Trackpad Omarchy plugin.",
    "-- Source of truth is ~/.config/omarchy/magic-trackpad.json. Safe to delete;",
    "-- the plugin rewrites this on the next change.",
    "if type(hl) ~= \"table\" then return end"
  ]

  var g = entryAssign(c.global)
  if (Object.keys(g).length > 0) out.push(configLua(g))

  for (var name in c.devices) {
    if (!isDeviceName(name)) continue
    var d = entryAssign(c.devices[name])
    if (Object.keys(d).length > 0) out.push("pcall(function() " + deviceLua(name, d) + " end)")
  }
  return out.join("\n") + "\n"
}

// ---------------------------------------------------------------- view model

// Effective on/off for a touchpad toggle in a scope. Cascade: the device's own
// value → the global value → what Hyprland currently reports (global scope
// only — there is no per-device getoption).
//
// Back-compatible: effectiveToggle(cfg, live, key) means the global scope.
function effectiveToggle(cfg, live, scopeOrKey, key) {
  var scope = key === undefined ? GLOBAL : scopeOrKey
  var k = key === undefined ? scopeOrKey : key
  var c = normalizeConfig(cfg)

  if (scope !== GLOBAL) {
    var dv = (c.devices[scope] || emptyEntry()).touchpad[k]
    if (dv === true || dv === false) return dv
  }
  var gv = c.global.touchpad[k]
  if (gv === true || gv === false) return gv
  var l = (live && typeof live === "object") ? live[k] : undefined
  return l === true
}

// Back-compatible: effectiveScroll(cfg, live) means the global scope.
function effectiveScroll(cfg, live, scope) {
  var s = scope || GLOBAL
  var c = normalizeConfig(cfg)
  if (s !== GLOBAL) {
    var dv = (c.devices[s] || emptyEntry()).scrollSpeed
    if (dv) return dv
  }
  if (c.global.scrollSpeed) return c.global.scrollSpeed
  var l = (live && typeof live === "object") ? live.scrollSpeed : undefined
  return (l === "slow" || l === "normal" || l === "fast") ? l : "normal"
}

// True when a device scope has not set this option itself (it inherits global).
function isInherited(cfg, scope, key) {
  if (!scope || scope === GLOBAL) return false
  var v = (normalizeConfig(cfg).devices[scope] || emptyEntry()).touchpad[key]
  return v !== true && v !== false
}

// How many options a device scope overrides (0 → "Reset to global" is hidden).
function deviceOverrideCount(cfg, scope) {
  if (!scope || scope === GLOBAL) return 0
  var e = normalizeConfig(cfg).devices[scope]
  if (!e) return 0
  var n = e.scrollSpeed ? 1 : 0
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) {
    var v = e.touchpad[TOUCHPAD_TOGGLES[i].key]
    if (v === true || v === false) n++
  }
  return n
}

// Back-compatible: summaryLine(cfg) means the global scope.
function summaryLine(cfg, scope) {
  var s = scope || GLOBAL
  var e = scopeEntry(cfg, s)
  var bits = []
  if (e.touchpad.tapToClick) bits.push("tap")
  if (e.touchpad.twoFingerRight) bits.push("2-finger right")
  if (e.touchpad.naturalScroll) bits.push("natural scroll")
  if (bits.length) return bits.join(" · ")
  return s === GLOBAL ? "defaults" : "inherits global"
}

// -------------------------------------------------------------- device list

// Which of Hyprland's pointer devices are touchpads. `hyprctlDevices` is the
// text of `hyprctl devices -j`; `procInput` is `/proc/bus/input/devices`. A
// Hyprland "mouse" whose slug matches a `/proc` block that reports BUTTONPAD
// or absolute axes is a touchpad. If nothing in `/proc` looks like a touchpad
// (unreadable, unusual kernel), fall back to offering every pointer device.
function touchpadDevices(hyprctlDevices, procInput) {
  var mice = []
  try {
    var j = typeof hyprctlDevices === "string" ? JSON.parse(hyprctlDevices || "{}") : (hyprctlDevices || {})
    var arr = Array.isArray(j.mice) ? j.mice : []
    for (var i = 0; i < arr.length && mice.length < 64; i++) {
      var n = arr[i] && arr[i].name
      if (isDeviceName(n) && mice.indexOf(n) === -1) mice.push(n)
    }
  } catch (e) { /* no devices */ }

  var padSlugs = _touchpadSlugs(procInput)
  var out = []
  var haveSignal = false
  for (var s in padSlugs) { haveSignal = true; break }

  for (var m = 0; m < mice.length; m++) {
    if (!haveSignal || padSlugs[mice[m]]) out.push({ name: mice[m], label: deviceLabel(mice[m]) })
  }
  return out
}

function _touchpadSlugs(procInput) {
  var slugs = {}
  var text = String(procInput || "")
  if (!text) return slugs
  var blocks = text.split(/\n\s*\n/)
  for (var b = 0; b < blocks.length && b < 256; b++) {
    var lines = blocks[b].split("\n")
    var name = "", prop = 0, hasAbs = false
    for (var l = 0; l < lines.length; l++) {
      var line = lines[l]
      if (line.length > 4096) continue
      var mn = line.match(/^N: Name="(.*)"$/)
      if (mn) name = mn[1]
      var mp = line.match(/^B: PROP=([0-9a-fA-F]+)/)
      if (mp) prop = parseInt(mp[1], 16) || 0
      var ma = line.match(/^B: ABS=([0-9a-fA-F ]+)/)
      if (ma && !/^0+$/.test(ma[1].replace(/\s/g, ""))) hasAbs = true
    }
    // PROP bit 2 (0x4) == INPUT_PROP_BUTTONPAD; absolute axes on a pointer
    // device also mean a touchpad/trackpoint rather than a mouse.
    if (name && ((prop & 0x4) || hasAbs)) slugs[hyprSlug(name)] = true
  }
  return slugs
}

if (typeof module !== "undefined") {
  module.exports = {
    TOUCHPAD_TOGGLES: TOUCHPAD_TOGGLES,
    SCROLL_STOPS: SCROLL_STOPS,
    SCROLL_FIELD: SCROLL_FIELD,
    SCROLL_OPTION: SCROLL_OPTION,
    GLOBAL: GLOBAL,
    GESTURES: GESTURES,
    PLANNED_GESTURES: PLANNED_GESTURES,
    gestureLua: gestureLua,
    gestureEvalArgs: gestureEvalArgs,
    defaultConfig: defaultConfig,
    normalizeConfig: normalizeConfig,
    scopeEntry: scopeEntry,
    isDeviceName: isDeviceName,
    hyprSlug: hyprSlug,
    deviceLabel: deviceLabel,
    parseGetOption: parseGetOption,
    scrollStopValue: scrollStopValue,
    luaValue: luaValue,
    configLua: configLua,
    configEvalArgs: configEvalArgs,
    toggleEvalArgs: toggleEvalArgs,
    deviceLua: deviceLua,
    deviceEvalArgs: deviceEvalArgs,
    deviceToggleEvalArgs: deviceToggleEvalArgs,
    resetDeviceEvalArgs: resetDeviceEvalArgs,
    applyPlan: applyPlan,
    needsLoader: needsLoader,
    withLoader: withLoader,
    generateLua: generateLua,
    effectiveToggle: effectiveToggle,
    effectiveScroll: effectiveScroll,
    isInherited: isInherited,
    deviceOverrideCount: deviceOverrideCount,
    summaryLine: summaryLine,
    touchpadDevices: touchpadDevices
  }
}
