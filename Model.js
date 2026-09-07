// Pure logic for the Magic Trackpad plugin. No QML imports — `node --test
// tests/model.test.js` runs this file directly.
//
// Level 1 only: the libinput touchpad options Hyprland already exposes, plus
// finger-swipe gestures. The plugin's own JSON document is the source of
// truth; `hyprctl getoption` is read once to seed first-run defaults.

// ---------------------------------------------------------------- catalogue

// Each touchpad toggle: the Hyprland option, how `hyprctl keyword` wants the
// value, and the human label. `invert` means the stored/displayed boolean is
// the opposite of the Hyprland option (so the UI can say "Disable while
// typing" for the option named `disable_while_typing`, both true = on).
var TOUCHPAD_TOGGLES = [
  { key: "tapToClick",        option: "input:touchpad:tap-to-click",         label: "Tap to click",            help: "Tap the pad to click without pressing down." },
  { key: "twoFingerRight",    option: "input:touchpad:clickfinger_behavior", label: "Two-finger right-click",   help: "Two fingers = right click, three = middle. Off uses corner zones." },
  { key: "naturalScroll",     option: "input:touchpad:natural_scroll",       label: "Natural scroll",          help: "Content follows the fingers, like a phone." },
  { key: "disableWhileTyping",option: "input:touchpad:disable_while_typing", label: "Disable while typing",     help: "Ignore the pad for a moment after a keypress." },
  { key: "tapAndDrag",        option: "input:touchpad:tap-and-drag",         label: "Tap and drag",            help: "Tap-tap-hold to start dragging." },
  { key: "middleClickPaste",  option: "input:touchpad:middle_button_emulation", label: "Middle-click emulation", help: "Left + right together acts as a middle click." }
]

// Scroll speed is a float; expose it as three named stops.
var SCROLL_STOPS = [
  { key: "slow",   value: 0.2, label: "Slow" },
  { key: "normal", value: 0.4, label: "Normal" },
  { key: "fast",   value: 0.8, label: "Fast" }
]

// Finger-swipe gesture. Hyprland 0.51+ registers these with the `gesture`
// keyword: `gesture = <fingers>, <direction>, <action>`.
var GESTURES = [
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

// `hyprctl -j getoption <name>` → the current value, or null if unset/absent.
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

function boolWord(v) { return v ? "true" : "false" }

// Live-apply commands for one setting change. Returns an array of argv arrays
// for `hyprctl` (the caller runs each). Gestures can't be read back or
// unset cleanly at runtime, so toggling one off asks for a full reload.
function keywordArgs(option, value) {
  return ["hyprctl", "keyword", option, String(value)]
}

function scrollStopValue(key) {
  for (var i = 0; i < SCROLL_STOPS.length; i++) if (SCROLL_STOPS[i].key === key) return SCROLL_STOPS[i].value
  return 0.4
}

function gestureKeywordArgs(fingers, direction, action) {
  return ["hyprctl", "keyword", "gesture", fingers + ", " + direction + ", " + action]
}

// Every live command to reconcile Hyprland with `cfg` (used on first apply
// and after a settings import).
function applyPlan(cfg) {
  var plan = []
  var c = normalizeConfig(cfg)
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) {
    var t = TOUCHPAD_TOGGLES[i]
    if (c.touchpad[t.key] === true || c.touchpad[t.key] === false) {
      plan.push(keywordArgs(t.option, boolWord(c.touchpad[t.key])))
    }
  }
  if (c.scrollSpeed) plan.push(keywordArgs("input:touchpad:scroll_factor", scrollStopValue(c.scrollSpeed)))
  for (var g = 0; g < GESTURES.length; g++) {
    var def = GESTURES[g]
    var gv = c.gestures[def.key]
    if (gv && gv.enabled) plan.push(gestureKeywordArgs(gv.fingers, def.direction, def.action))
  }
  return plan
}

// ---------------------------------------------------------------- persistence

var LOADER_MARK = "omarchy-magic-trackpad"
var LOADER_LINE = 'if os.getenv and true then pcall(dofile, (os.getenv("HOME") or "") .. "/.config/hypr/omarchy-magic-trackpad.lua") end'

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
// settings survive a restart. Uses `hl.keyword` / `hl.gesture` — the same
// API Omarchy's own hyprland.lua uses.
function generateLua(cfg) {
  var c = normalizeConfig(cfg)
  var out = [
    "-- " + LOADER_MARK + " — generated by the Magic Trackpad Omarchy plugin.",
    "-- Source of truth is ~/.config/omarchy/magic-trackpad.json. Safe to delete;",
    "-- the plugin rewrites this on the next change.",
    "local ok, hl_ = pcall(function() return hl end)",
    "if not ok or not hl_ then return end"
  ]
  for (var i = 0; i < TOUCHPAD_TOGGLES.length; i++) {
    var t = TOUCHPAD_TOGGLES[i]
    var v = c.touchpad[t.key]
    if (v === true || v === false) {
      out.push('hl.keyword("' + t.option + '", "' + boolWord(v) + '")')
    }
  }
  if (c.scrollSpeed) {
    out.push('hl.keyword("input:touchpad:scroll_factor", "' + scrollStopValue(c.scrollSpeed) + '")')
  }
  for (var g = 0; g < GESTURES.length; g++) {
    var def = GESTURES[g]
    var gv = c.gestures[def.key]
    if (gv && gv.enabled) {
      out.push('pcall(function() hl.gesture({ fingers = ' + gv.fingers +
        ', direction = "' + def.direction + '", action = "' + def.action + '" }) end)')
    }
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
    GESTURES: GESTURES,
    defaultConfig: defaultConfig,
    normalizeConfig: normalizeConfig,
    parseGetOption: parseGetOption,
    keywordArgs: keywordArgs,
    gestureKeywordArgs: gestureKeywordArgs,
    scrollStopValue: scrollStopValue,
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
