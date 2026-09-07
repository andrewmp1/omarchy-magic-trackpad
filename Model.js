// Pure logic for the Magic Trackpad plugin. No QML imports — `node --test
// tests/model.test.js` runs this file directly.
//
// Level 1 only: the libinput touchpad options Hyprland already exposes, plus
// finger-swipe gestures. The plugin's own JSON document is the source of
// truth; `hyprctl getoption` is read to show the state of an option the user
// has not set yet.
//
// Omarchy runs Hyprland's Lua config parser, so runtime changes go through
// `hyprctl eval "hl.config{...}"` / `"hl.gesture{...}"` — `hyprctl keyword`
// is rejected ("can't work with non-legacy parsers"). Reads still use
// `hyprctl getoption -j`, which works either way.

// ---------------------------------------------------------------- catalogue

// `option` is the `getoption` path (underscores; Hyprland accepts them).
// `field` is the key inside `hl.config{ input = { touchpad = { ... } } }`.
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

// Finger-swipe gestures are DEFERRED to v0.2. Runtime `hl.gesture(...)` is
// sticky — `hyprctl reload` does not remove it (only a full Hyprland restart
// does) — and it errors ("overshadowed") if a gesture for that direction
// already exists, including one the user set in their own input.lua. A clean
// on/off toggle needs a register/unregister story we don't have yet. The
// catalogue is kept here for v0.2; nothing wires it up in v0.1.
var GESTURES = []
var PLANNED_GESTURES = [
  {
    key: "workspaceSwipe",
    label: "Swipe to switch workspace",
    help: "Horizontal N-finger swipe moves between workspaces.",
    direction: "horizontal",
    action: "workspace",
    fingerChoices: [3, 4],
    defaultFingers: 3
  }
]

function defaultConfig() {
  // null everywhere means "inherit — don't write this option at all".
  var cfg = { version: 1, touchpad: {}, scrollSpeed: null, gestures: {} }
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) cfg.touchpad[TOUCHPAD_TOGGLES[i].key] = null
  for (var g = 0; g < GESTURES.length; g++) {
    cfg.gestures[GESTURES[g].key] = { enabled: false, fingers: GESTURES[g].defaultFingers }
  }
  return cfg
}

// Repair anything a hand-edit got wrong rather than refuse it.
function normalizeConfig(doc) {
  var base = defaultConfig()
  if (!doc || typeof doc !== "object") return base
  base.version = 1

  var tp = (doc.touchpad && typeof doc.touchpad === "object") ? doc.touchpad : {}
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) {
    var k = TOUCHPAD_TOGGLES[i].key
    base.touchpad[k] = (tp[k] === true || tp[k] === false) ? tp[k] : null
  }

  base.scrollSpeed = SCROLL_STOPS.some(function (s) { return s.key === doc.scrollSpeed })
    ? doc.scrollSpeed : null

  var gs = (doc.gestures && typeof doc.gestures === "object") ? doc.gestures : {}
  for (var g = 0; g < GESTURES.length; g++) {
    var def = GESTURES[g]
    var got = (gs[def.key] && typeof gs[def.key] === "object") ? gs[def.key] : {}
    var fingers = def.fingerChoices.indexOf(Number(got.fingers)) >= 0
      ? Number(got.fingers) : def.defaultFingers
    base.gestures[def.key] = { enabled: got.enabled === true, fingers: fingers }
  }
  return base
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

// `assign` is { field: value, ... } for input.touchpad.*.
function configLua(assign) {
  var parts = []
  for (var k in assign) parts.push(k + " = " + luaValue(assign[k]))
  return "hl.config({ input = { touchpad = { " + parts.join(", ") + " } } })"
}

function configEvalArgs(assign) {
  return ["hyprctl", "eval", configLua(assign)]
}

// One touchpad field change (used on each click).
function toggleEvalArgs(field, value) {
  var a = {}
  a[field] = value
  return configEvalArgs(a)
}

function gestureLua(fingers, direction, action) {
  return 'hl.gesture({ fingers = ' + Number(fingers) +
    ', direction = "' + direction + '", action = "' + action + '" })'
}

function gestureEvalArgs(fingers, direction, action) {
  return ["hyprctl", "eval", gestureLua(fingers, direction, action)]
}

// Every command to reconcile Hyprland with `cfg` — one batched `hl.config`
// for the touchpad + scroll, then one `hl.gesture` per enabled gesture.
function applyPlan(cfg) {
  var c = normalizeConfig(cfg)
  var assign = {}
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) {
    var t = TOUCHPAD_TOGGLES[i]
    if (c.touchpad[t.key] === true || c.touchpad[t.key] === false) assign[t.field] = c.touchpad[t.key]
  }
  if (c.scrollSpeed) assign[SCROLL_FIELD] = scrollStopValue(c.scrollSpeed)

  var plan = []
  if (Object.keys(assign).length > 0) plan.push(configEvalArgs(assign))
  for (var g = 0; g < GESTURES.length; g++) {
    var def = GESTURES[g]
    var gv = c.gestures[def.key]
    if (gv && gv.enabled) plan.push(gestureEvalArgs(gv.fingers, def.direction, def.action))
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
// settings survive a restart. Same `hl.config` / `hl.gesture` calls Omarchy's
// own hyprland.lua uses.
function generateLua(cfg) {
  var c = normalizeConfig(cfg)
  var out = [
    "-- " + LOADER_MARK + " — generated by the Magic Trackpad Omarchy plugin.",
    "-- Source of truth is ~/.config/omarchy/magic-trackpad.json. Safe to delete;",
    "-- the plugin rewrites this on the next change.",
    "if type(hl) ~= \"table\" then return end"
  ]
  var assign = {}
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) {
    var t = TOUCHPAD_TOGGLES[i]
    if (c.touchpad[t.key] === true || c.touchpad[t.key] === false) assign[t.field] = c.touchpad[t.key]
  }
  if (c.scrollSpeed) assign[SCROLL_FIELD] = scrollStopValue(c.scrollSpeed)
  if (Object.keys(assign).length > 0) out.push(configLua(assign))

  for (var g = 0; g < GESTURES.length; g++) {
    var def = GESTURES[g]
    var gv = c.gestures[def.key]
    if (gv && gv.enabled) out.push("pcall(function() " + gestureLua(gv.fingers, def.direction, def.action) + " end)")
  }
  return out.join("\n") + "\n"
}

// ---------------------------------------------------------------- view model

// Effective on/off for a touchpad toggle: the config document wins if the
// user has set it, otherwise fall back to what Hyprland currently reports.
function effectiveToggle(cfg, live, key) {
  var c = normalizeConfig(cfg)
  if (c.touchpad[key] === true || c.touchpad[key] === false) return c.touchpad[key]
  var l = (live && typeof live === "object") ? live[key] : undefined
  return l === true
}

function effectiveScroll(cfg, live) {
  var c = normalizeConfig(cfg)
  if (c.scrollSpeed) return c.scrollSpeed
  var l = (live && typeof live === "object") ? live.scrollSpeed : undefined
  return (l === "slow" || l === "normal" || l === "fast") ? l : "normal"
}

function summaryLine(cfg) {
  var c = normalizeConfig(cfg)
  var bits = []
  if (c.touchpad.tapToClick) bits.push("tap")
  if (c.touchpad.twoFingerRight) bits.push("2-finger right")
  if (c.touchpad.naturalScroll) bits.push("natural scroll")
  var anyGesture = GESTURES.some(function (def) { return c.gestures[def.key] && c.gestures[def.key].enabled })
  if (anyGesture) bits.push("swipe")
  return bits.length ? bits.join(" · ") : "defaults"
}

function anyGestureEnabled(cfg) {
  var c = normalizeConfig(cfg)
  return GESTURES.some(function (def) { return c.gestures[def.key] && c.gestures[def.key].enabled })
}

if (typeof module !== "undefined") {
  module.exports = {
    TOUCHPAD_TOGGLES: TOUCHPAD_TOGGLES,
    SCROLL_STOPS: SCROLL_STOPS,
    SCROLL_FIELD: SCROLL_FIELD,
    SCROLL_OPTION: SCROLL_OPTION,
    GESTURES: GESTURES,
    PLANNED_GESTURES: PLANNED_GESTURES,
    defaultConfig: defaultConfig,
    normalizeConfig: normalizeConfig,
    parseGetOption: parseGetOption,
    scrollStopValue: scrollStopValue,
    configLua: configLua,
    configEvalArgs: configEvalArgs,
    toggleEvalArgs: toggleEvalArgs,
    gestureLua: gestureLua,
    gestureEvalArgs: gestureEvalArgs,
    applyPlan: applyPlan,
    needsLoader: needsLoader,
    withLoader: withLoader,
    generateLua: generateLua,
    effectiveToggle: effectiveToggle,
    effectiveScroll: effectiveScroll,
    summaryLine: summaryLine,
    anyGestureEnabled: anyGestureEnabled
  }
}
