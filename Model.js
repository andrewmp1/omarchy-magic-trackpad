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
// Every entry is a boolean toggle. `drag_lock` / `drag_3fg` read back from
// `getoption` as an int (0/1); the plugin still writes `true`/`false` and
// Hyprland coerces (verified), and the read side coerces `> 0` → true.
var TOUCHPAD_TOGGLES = [
  { key: "tapToClick",         field: "tap_to_click",             option: "input:touchpad:tap_to_click",             label: "Tap to click",          help: "Tap the pad to click without pressing down." },
  { key: "twoFingerRight",     field: "clickfinger_behavior",     option: "input:touchpad:clickfinger_behavior",     label: "Two-finger right-click", help: "Two fingers = right click, three = middle. Off uses corner zones." },
  { key: "naturalScroll",      field: "natural_scroll",           option: "input:touchpad:natural_scroll",           label: "Natural scroll",        help: "Content follows the fingers, like a phone." },
  { key: "disableWhileTyping", field: "disable_while_typing",      option: "input:touchpad:disable_while_typing",     label: "Disable while typing",   help: "Ignore the pad for a moment after a keypress." },
  { key: "tapAndDrag",         field: "tap_and_drag",             option: "input:touchpad:tap_and_drag",             label: "Tap and drag",          help: "Tap-tap-hold to start dragging." },
  { key: "dragLock",           field: "drag_lock",                option: "input:touchpad:drag_lock",                label: "Drag lock",             help: "Keep dragging through a brief finger lift." },
  { key: "threeFingerDrag",    field: "drag_3fg",                 option: "input:touchpad:drag_3fg",                 label: "Three-finger drag",     help: "Move a window with three fingers." },
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

// Pointer speed is libinput `sensitivity`, −1..1, 0 = system default. In a
// global `hl.config` it sits one level up from `touchpad` (under `input`
// directly); in an `hl.device` block it is a flat key like everything else.
// Hyprland does NOT clamp it, so pointerStopValue() does.
var POINTER_FIELD = "sensitivity"
var POINTER_LEVEL = "input"
var POINTER_OPTION = "input:sensitivity"
var POINTER_STOPS = [
  { key: "slowest", value: -0.6, label: "Slowest" },
  { key: "slow",    value: -0.3, label: "Slow" },
  { key: "default", value: 0,    label: "Default" },
  { key: "fast",    value: 0.35, label: "Fast" },
  { key: "fastest", value: 0.7,  label: "Fastest" }
]

// Small string-enum settings: one Lua string field, a closed value allow-list
// (values NEVER come from user input — they are picked from this table by
// key). `level` says where the field nests in a global `hl.config`:
//   "input"    -> hl.config({ input = { <field> = … } })
//   "touchpad" -> hl.config({ input = { touchpad = { <field> = … } } })
// A device scope is always flat: hl.device({ name = …, <field> = … }).
// `section` places the control in the panel and the keyboard-nav order:
// "scroll" (with scroll speed), "pointer" (with pointer speed), "touchpad"
// (with the toggle rows).
var ENUM_SETTINGS = [
  {
    key: "accelProfile", field: "accel_profile", level: "input", section: "pointer",
    option: "input:accel_profile", label: "Pointer acceleration",
    help: "Adaptive ramps with speed; Flat is 1:1.",
    values: [
      { key: "adaptive", lua: "adaptive", label: "Adaptive" },
      { key: "flat",     lua: "flat",     label: "Flat" }
    ]
  },
  {
    key: "scrollMethod", field: "scroll_method", level: "input", section: "scroll",
    option: "input:scroll_method", label: "Scroll method",
    help: "Two-finger drag anywhere, or drag along the right edge.",
    values: [
      { key: "2fg",  lua: "2fg",  label: "Two-finger" },
      { key: "edge", lua: "edge", label: "Edge" }
    ]
  },
  {
    key: "tapButtonMap", field: "tap_button_map", level: "touchpad", section: "touchpad",
    option: "input:touchpad:tap_button_map", label: "Two-finger tap",
    help: "Whether a two-finger tap is a right-click or a middle-click.",
    values: [
      { key: "right",  lua: "lrm", label: "Right" },
      { key: "middle", lua: "lmr", label: "Middle" }
    ]
  }
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
  // `enabled` is device-scope only: null = the pad works normally, false =
  // the plugin has turned it off (hl.device({ enabled = false })). Global
  // entries carry the key but never set it.
  var e = { touchpad: {}, scrollSpeed: null, pointerSpeed: null, enabled: null }
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) e.touchpad[TOUCHPAD_TOGGLES[i].key] = null
  for (var j = 0; j < ENUM_SETTINGS.length; j++) e[ENUM_SETTINGS[j].key] = null
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
  out.pointerSpeed = POINTER_STOPS.some(function (s) { return s.key === src.pointerSpeed })
    ? src.pointerSpeed : null
  out.enabled = (src.enabled === false) ? false : null
  for (var j = 0; j < ENUM_SETTINGS.length; j++) {
    var es = ENUM_SETTINGS[j]
    out[es.key] = es.values.some(function (v) { return v.key === src[es.key] })
      ? src[es.key] : null
  }
  return out
}

function scopeEntry(cfg, scope) {
  var c = normalizeConfig(cfg)
  if (!scope || scope === GLOBAL) return c.global
  return c.devices[scope] || emptyEntry()
}

// -------------------------------------------------------------- hyprctl I/O

// `hyprctl -j getoption <name>` → current value, or null if unset/absent.
// Hyprland reports an unset string option as the literal "[[EMPTY]]".
function parseGetOption(raw) {
  try {
    var json = JSON.parse(String(raw || "").trim() || "{}")
    if (json.bool !== undefined) return !!json.bool
    if (json.int !== undefined) return Number(json.int)
    if (json.float !== undefined) return Number(json.float)
    if (json.str !== undefined) {
      var s = String(json.str)
      return (s === "" || s === "[[EMPTY]]") ? null : s
    }
    return null
  } catch (e) {
    return null
  }
}

function scrollStopValue(key) {
  for (var i = 0; i < SCROLL_STOPS.length; i++) if (SCROLL_STOPS[i].key === key) return SCROLL_STOPS[i].value
  return 0.4
}

// libinput sensitivity is defined only over [-1, 1]; Hyprland does not clamp.
function pointerStopValue(key) {
  for (var i = 0; i < POINTER_STOPS.length; i++) {
    if (POINTER_STOPS[i].key === key) return Math.max(-1, Math.min(1, POINTER_STOPS[i].value))
  }
  return 0
}

// The Lua string for an enum setting's value, taken from the closed table —
// returns null if either key is unknown (caller skips it).
function enumValue(settingKey, valueKey) {
  for (var i = 0; i < ENUM_SETTINGS.length; i++) {
    if (ENUM_SETTINGS[i].key !== settingKey) continue
    for (var j = 0; j < ENUM_SETTINGS[i].values.length; j++) {
      if (ENUM_SETTINGS[i].values[j].key === valueKey) return ENUM_SETTINGS[i].values[j].lua
    }
  }
  return null
}

function enumSetting(settingKey) {
  for (var i = 0; i < ENUM_SETTINGS.length; i++) if (ENUM_SETTINGS[i].key === settingKey) return ENUM_SETTINGS[i]
  return null
}

function _merge(a, b) {
  var o = {}
  for (var k in a) o[k] = a[k]
  for (var k2 in b) o[k2] = b[k2]
  return o
}

// Minimal Lua-literal for the value types we emit: bool, number, and a
// bare-word string (enum values — [a-z0-9_-] only, defensively stripped).
function luaValue(v) {
  if (v === true) return "true"
  if (v === false) return "false"
  if (typeof v === "string") return '"' + v.replace(/[^A-Za-z0-9_-]/g, "") + '"'
  return String(Number(v))
}

function assignParts(assign) {
  var parts = []
  for (var k in assign) parts.push(k + " = " + luaValue(assign[k]))
  return parts.join(", ")
}

// ---- global (hl.config) -----------------------------------------------------

// `touchpadAssign` keys nest under `input.touchpad`; `inputAssign` keys nest
// under `input` directly (sensitivity, accel_profile, scroll_method). With no
// `inputAssign` this is exactly the v0.2 single-level form, so existing
// callers and their asserted strings are unchanged.
function configLua(touchpadAssign, inputAssign) {
  var tpParts = assignParts(touchpadAssign || {})
  var inpParts = assignParts(inputAssign || {})
  var segs = []
  if (inpParts) segs.push(inpParts)
  if (tpParts || !inpParts) segs.push("touchpad = { " + tpParts + " }")
  return "hl.config({ input = { " + segs.join(", ") + " } })"
}

function configEvalArgs(touchpadAssign, inputAssign) {
  return ["hyprctl", "eval", configLua(touchpadAssign, inputAssign)]
}

// One global field change (used on each click in the Global scope). `level`
// is "input" for the section-level keys, anything else for `input.touchpad`.
function toggleEvalArgs(field, value, level) {
  var a = {}
  a[field] = value
  return level === "input" ? configEvalArgs({}, a) : configEvalArgs(a)
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

// A device scope the plugin has turned off.
function deviceDisabled(cfg, name) {
  if (!name || name === GLOBAL) return false
  var e = normalizeConfig(cfg).devices[name]
  return !!(e && e.enabled === false)
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
  assign[POINTER_FIELD] = pointerStopValue(effectivePointer(cfg, live, GLOBAL))
  for (var j = 0; j < ENUM_SETTINGS.length; j++) {
    var es = ENUM_SETTINGS[j]
    var lv = enumValue(es.key, effectiveEnum(cfg, live, GLOBAL, es.key))
    if (lv !== null) assign[es.field] = lv
  }
  assign.enabled = true   // clears a previous "disable this touchpad"
  return deviceEvalArgs(name, assign)
}

// ---- assemble ----------------------------------------------------------------

// An entry's set options, split by where they nest in a global `hl.config`:
//   { touchpad: { … }, input: { … } }
// A device scope flattens both halves into one `hl.device` table.
function entryAssign(entry) {
  var touchpad = {}, input = {}
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) {
    var t = TOUCHPAD_TOGGLES[i]
    var v = entry.touchpad[t.key]
    if (v === true || v === false) touchpad[t.field] = v
  }
  if (entry.scrollSpeed) touchpad[SCROLL_FIELD] = scrollStopValue(entry.scrollSpeed)
  if (entry.pointerSpeed) input[POINTER_FIELD] = pointerStopValue(entry.pointerSpeed)
  for (var j = 0; j < ENUM_SETTINGS.length; j++) {
    var es = ENUM_SETTINGS[j]
    var lv = enumValue(es.key, entry[es.key])
    if (lv === null) continue
    ;(es.level === "input" ? input : touchpad)[es.field] = lv
  }
  return { touchpad: touchpad, input: input }
}

function assignCount(split) {
  return Object.keys(split.touchpad).length + Object.keys(split.input).length
}

// Every command to reconcile Hyprland with `cfg`: one `hl.config` for the
// global section, then one `hl.device` per device that overrides anything.
function applyPlan(cfg) {
  var c = normalizeConfig(cfg)
  var plan = []

  var g = entryAssign(c.global)
  if (assignCount(g) > 0) plan.push(configEvalArgs(g.touchpad, g.input))

  for (var name in c.devices) {
    if (!isDeviceName(name)) continue
    if (c.devices[name].enabled === false) {
      plan.push(deviceEvalArgs(name, { enabled: false }))
      continue                                  // a disabled pad needs nothing else
    }
    var d = entryAssign(c.devices[name])
    if (assignCount(d) > 0) plan.push(deviceEvalArgs(name, _merge(d.input, d.touchpad)))
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
  if (assignCount(g) > 0) out.push(configLua(g.touchpad, g.input))

  for (var name in c.devices) {
    if (!isDeviceName(name)) continue
    if (c.devices[name].enabled === false) {
      out.push("pcall(function() " + deviceLua(name, { enabled: false }) + " end)")
      continue
    }
    var d = entryAssign(c.devices[name])
    if (assignCount(d) > 0) out.push("pcall(function() " + deviceLua(name, _merge(d.input, d.touchpad)) + " end)")
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
  // Live values are bool for most options, int (0/1) for drag_lock / drag_3fg.
  return l === true || (typeof l === "number" && l > 0)
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

function nearestStop(stops, val) {
  var best = stops[0].key, bestD = Infinity
  for (var i = 0; i < stops.length; i++) {
    var d = Math.abs(stops[i].value - val)
    if (d < bestD) { bestD = d; best = stops[i].key }
  }
  return best
}

// Pointer speed for a scope: device value → global value → the live
// `input:sensitivity` float snapped to the nearest stop → "default".
function effectivePointer(cfg, live, scope) {
  var s = scope || GLOBAL
  var c = normalizeConfig(cfg)
  if (s !== GLOBAL) {
    var dv = (c.devices[s] || emptyEntry()).pointerSpeed
    if (dv) return dv
  }
  if (c.global.pointerSpeed) return c.global.pointerSpeed
  var lv = (live && typeof live === "object") ? Number(live.pointerSpeed) : NaN
  return isFinite(lv) ? nearestStop(POINTER_STOPS, lv) : "default"
}

// Enum setting value-key for a scope: device → global → the live Lua string
// mapped back to a value key → the setting's first value (its libinput
// default). Returns null only for an unknown settingKey.
function effectiveEnum(cfg, live, scope, settingKey) {
  var es = enumSetting(settingKey)
  if (!es) return null
  var s = scope || GLOBAL
  var c = normalizeConfig(cfg)
  if (s !== GLOBAL) {
    var dv = (c.devices[s] || emptyEntry())[settingKey]
    if (dv) return dv
  }
  if (c.global[settingKey]) return c.global[settingKey]
  var raw = (live && typeof live === "object") ? live[settingKey] : null
  for (var i = 0; i < es.values.length; i++) if (es.values[i].lua === raw) return es.values[i].key
  return es.values[0].key
}

// True when a device scope has not set this option itself (it inherits
// global). `key` is a touchpad-toggle key, "scrollSpeed", "pointerSpeed", or
// an ENUM_SETTINGS key.
function isInherited(cfg, scope, key) {
  if (!scope || scope === GLOBAL) return false
  var e = normalizeConfig(cfg).devices[scope] || emptyEntry()
  if (key in e.touchpad) {
    var v = e.touchpad[key]
    return v !== true && v !== false
  }
  return !e[key]
}

// How many options a device scope overrides (0 → "Reset to global" is hidden).
function deviceOverrideCount(cfg, scope) {
  if (!scope || scope === GLOBAL) return 0
  var e = normalizeConfig(cfg).devices[scope]
  if (!e) return 0
  if (e.enabled === false) return 1   // "disabled" is the only override that matters
  var n = 0
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) {
    var v = e.touchpad[TOUCHPAD_TOGGLES[i].key]
    if (v === true || v === false) n++
  }
  if (e.scrollSpeed) n++
  if (e.pointerSpeed) n++
  for (var j = 0; j < ENUM_SETTINGS.length; j++) if (e[ENUM_SETTINGS[j].key]) n++
  return n
}

// Back-compatible: summaryLine(cfg) means the global scope.
function summaryLine(cfg, scope) {
  var s = scope || GLOBAL
  if (deviceDisabled(cfg, s)) return "disabled"
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
    POINTER_STOPS: POINTER_STOPS,
    POINTER_FIELD: POINTER_FIELD,
    POINTER_LEVEL: POINTER_LEVEL,
    POINTER_OPTION: POINTER_OPTION,
    ENUM_SETTINGS: ENUM_SETTINGS,
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
    pointerStopValue: pointerStopValue,
    enumValue: enumValue,
    enumSetting: enumSetting,
    luaValue: luaValue,
    configLua: configLua,
    configEvalArgs: configEvalArgs,
    toggleEvalArgs: toggleEvalArgs,
    deviceLua: deviceLua,
    deviceEvalArgs: deviceEvalArgs,
    deviceToggleEvalArgs: deviceToggleEvalArgs,
    deviceDisabled: deviceDisabled,
    resetDeviceEvalArgs: resetDeviceEvalArgs,
    applyPlan: applyPlan,
    needsLoader: needsLoader,
    withLoader: withLoader,
    generateLua: generateLua,
    effectiveToggle: effectiveToggle,
    effectiveScroll: effectiveScroll,
    effectivePointer: effectivePointer,
    effectiveEnum: effectiveEnum,
    isInherited: isInherited,
    deviceOverrideCount: deviceOverrideCount,
    summaryLine: summaryLine,
    touchpadDevices: touchpadDevices
  }
}
