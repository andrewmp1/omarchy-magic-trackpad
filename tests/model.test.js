const test = require("node:test")
const assert = require("node:assert/strict")
const M = require("../Model.js")

// -------------------------------------------------------------- document shape

test("defaultConfig is a v2 doc that inherits everything", () => {
  const c = M.defaultConfig()
  assert.equal(c.version, 2)
  assert.deepEqual(c.devices, {})
  assert.equal(c.global.scrollSpeed, null)
  for (const t of M.TOUCHPAD_TOGGLES) assert.equal(c.global.touchpad[t.key], null)
})

test("normalizeConfig migrates a v1 document under `global` with nothing lost", () => {
  const v1 = {
    version: 1,
    touchpad: { tapToClick: true, naturalScroll: false },
    scrollSpeed: "fast",
    gestures: { workspaceSwipe: { enabled: true, fingers: 3 } }
  }
  const c = M.normalizeConfig(v1)
  assert.equal(c.version, 2)
  assert.equal(c.global.touchpad.tapToClick, true)
  assert.equal(c.global.touchpad.naturalScroll, false)
  assert.equal(c.global.touchpad.tapAndDrag, null)
  assert.equal(c.global.scrollSpeed, "fast")
  assert.deepEqual(c.devices, {})
  assert.equal("gestures" in c, false) // gestures dropped in v2
})

test("normalizeConfig migrates a bare v0.1 document (no version key)", () => {
  const c = M.normalizeConfig({ touchpad: { middleClickPaste: true }, scrollSpeed: "slow" })
  assert.equal(c.version, 2)
  assert.equal(c.global.touchpad.middleClickPaste, true)
  assert.equal(c.global.scrollSpeed, "slow")
})

test("normalizeConfig repairs junk in an entry", () => {
  const c = M.normalizeConfig({
    version: 2,
    global: { touchpad: { tapToClick: "yes", naturalScroll: true }, scrollSpeed: "warp" }
  })
  assert.equal(c.global.touchpad.tapToClick, null) // "yes" is not a boolean
  assert.equal(c.global.touchpad.naturalScroll, true)
  assert.equal(c.global.scrollSpeed, null)         // unknown stop -> inherit
})

test("normalizeConfig keeps valid device entries and drops junk device keys", () => {
  const c = M.normalizeConfig({
    version: 2,
    global: { touchpad: {}, scrollSpeed: null },
    devices: {
      "apple-inc.-magic-trackpad": { touchpad: { naturalScroll: false }, scrollSpeed: "slow" },
      "../etc/passwd": { touchpad: { naturalScroll: true } },
      "Has Spaces": { touchpad: { naturalScroll: true } },
      "name\"); os.execute('x": { touchpad: { naturalScroll: true } }
    }
  })
  assert.deepEqual(Object.keys(c.devices), ["apple-inc.-magic-trackpad"])
  assert.equal(c.devices["apple-inc.-magic-trackpad"].touchpad.naturalScroll, false)
  assert.equal(c.devices["apple-inc.-magic-trackpad"].scrollSpeed, "slow")
})

test("normalizeConfig round-trips its own output", () => {
  const once = M.normalizeConfig({ version: 1, touchpad: { tapToClick: true }, scrollSpeed: "fast" })
  assert.deepEqual(M.normalizeConfig(once), once)
})

// -------------------------------------------------------------- device names

test("isDeviceName is an anchored allow-list, not a repair", () => {
  assert.equal(M.isDeviceName("apple-inc.-magic-trackpad"), true)
  assert.equal(M.isDeviceName("elan1200:00-04f3:3078-touchpad"), false) // ':' not allowed
  assert.equal(M.isDeviceName("logitech-m720"), true)
  assert.equal(M.isDeviceName("-leading-dash"), false)
  assert.equal(M.isDeviceName("has space"), false)
  assert.equal(M.isDeviceName("../x"), false)
  assert.equal(M.isDeviceName('a"); os.execute("x'), false)
  assert.equal(M.isDeviceName("a\nb"), false)
  assert.equal(M.isDeviceName("x".repeat(129)), false) // 1 + 127 max
  assert.equal(M.isDeviceName("x".repeat(128)), true)
  assert.equal(M.isDeviceName(42), false)
  assert.equal(M.isDeviceName(null), false)
})

test("hyprSlug matches Hyprland's device slugging", () => {
  assert.equal(M.hyprSlug("Apple Inc. Magic Trackpad"), "apple-inc.-magic-trackpad")
  assert.equal(M.hyprSlug("SynPS/2 Synaptics TouchPad"), "synps2-synaptics-touchpad")
  assert.equal(M.hyprSlug("  weird   spacing  "), "-weird-spacing-")
  assert.ok(M.hyprSlug("x".repeat(400)).length <= 128)
})

test("deviceLabel drops vendor noise, strips markup, and caps length", () => {
  assert.equal(M.deviceLabel("apple-inc.-magic-trackpad"), "Magic Trackpad")
  assert.equal(M.deviceLabel("logitech-m720-triathlon"), "M720 Triathlon")
  assert.equal(M.deviceLabel(""), "Device")
  // markup must not survive into a host-owned sink
  const dirty = M.deviceLabel("a<img src=x>&b")
  assert.ok(!/[<>&]/.test(dirty))
  assert.ok(M.deviceLabel("z".repeat(80)).length <= 40)
})

// -------------------------------------------------------------- hyprctl I/O

test("parseGetOption reads bool/int/float/str and unset", () => {
  assert.equal(M.parseGetOption('{"bool": true, "set": true}'), true)
  assert.equal(M.parseGetOption('{"int": 2}'), 2)
  assert.equal(M.parseGetOption('{"float": 0.4}'), 0.4)
  assert.equal(M.parseGetOption('{"str": "x"}'), "x")
  assert.equal(M.parseGetOption("no such option"), null)
  assert.equal(M.parseGetOption(""), null)
})

test("configLua / configEvalArgs / toggleEvalArgs build the global hl.config", () => {
  assert.equal(
    M.configLua({ natural_scroll: false }),
    "hl.config({ input = { touchpad = { natural_scroll = false } } })"
  )
  assert.deepEqual(
    M.configEvalArgs({ scroll_factor: 0.8 }),
    ["hyprctl", "eval", "hl.config({ input = { touchpad = { scroll_factor = 0.8 } } })"]
  )
  assert.deepEqual(
    M.toggleEvalArgs("tap_to_click", true),
    ["hyprctl", "eval", "hl.config({ input = { touchpad = { tap_to_click = true } } })"]
  )
})

test("deviceLua / deviceEvalArgs build hl.device and refuse a bad name", () => {
  assert.equal(
    M.deviceLua("apple-inc.-magic-trackpad", { natural_scroll: false }),
    'hl.device({ name = "apple-inc.-magic-trackpad", natural_scroll = false })'
  )
  assert.deepEqual(
    M.deviceEvalArgs("logitech-m720", { scroll_factor: 0.2 }),
    ["hyprctl", "eval", 'hl.device({ name = "logitech-m720", scroll_factor = 0.2 })']
  )
  assert.equal(M.deviceLua('bad"); x', { natural_scroll: true }), "")
  assert.equal(M.deviceEvalArgs("../x", { natural_scroll: true }), null)
  assert.deepEqual(
    M.deviceToggleEvalArgs("logitech-m720", "tap_to_click", false),
    ["hyprctl", "eval", 'hl.device({ name = "logitech-m720", tap_to_click = false })']
  )
})

test("resetDeviceEvalArgs pins a device to the global effective values", () => {
  const cfg = {
    version: 2,
    global: { touchpad: { tapToClick: true, naturalScroll: false }, scrollSpeed: "fast" },
    devices: { "logitech-m720": { touchpad: { naturalScroll: true }, scrollSpeed: "slow" } }
  }
  const args = M.resetDeviceEvalArgs(cfg, {}, "logitech-m720")
  assert.equal(args[0], "hyprctl")
  assert.equal(args[1], "eval")
  assert.ok(args[2].startsWith('hl.device({ name = "logitech-m720"'))
  assert.ok(args[2].includes("tap_to_click = true"))
  assert.ok(args[2].includes("natural_scroll = false")) // global value, not the device's
  assert.ok(args[2].includes("scroll_factor = 0.8"))
  assert.equal(M.resetDeviceEvalArgs(cfg, {}, 'bad"; x'), null)
})

test("gestureLua / gestureEvalArgs (0.3 groundwork, catalogue data only)", () => {
  assert.equal(
    M.gestureLua(4, "horizontal", "workspace"),
    'hl.gesture({ fingers = 4, direction = "horizontal", action = "workspace" })'
  )
  assert.equal(M.gestureEvalArgs(3, "horizontal", "workspace")[1], "eval")
})

// -------------------------------------------------------------- apply plan

test("applyPlan: global only -> one hl.config eval", () => {
  const plan = M.applyPlan({
    version: 2,
    global: { touchpad: { tapToClick: true, twoFingerRight: false }, scrollSpeed: "fast" },
    devices: {}
  })
  assert.equal(plan.length, 1)
  assert.ok(plan[0][2].includes("tap_to_click = true"))
  assert.ok(plan[0][2].includes("clickfinger_behavior = false"))
  assert.ok(plan[0][2].includes("scroll_factor = 0.8"))
})

test("applyPlan: global + device override -> two evals, hl.config then hl.device", () => {
  const plan = M.applyPlan({
    version: 2,
    global: { touchpad: { tapToClick: true }, scrollSpeed: null },
    devices: { "apple-inc.-magic-trackpad": { touchpad: { naturalScroll: false }, scrollSpeed: "slow" } }
  })
  assert.equal(plan.length, 2)
  assert.ok(plan[0][2].startsWith("hl.config("))
  assert.ok(plan[1][2].startsWith('hl.device({ name = "apple-inc.-magic-trackpad"'))
  assert.ok(plan[1][2].includes("natural_scroll = false"))
  assert.ok(plan[1][2].includes("scroll_factor = 0.2"))
})

test("applyPlan: device override only (global untouched) -> one hl.device", () => {
  const plan = M.applyPlan({
    version: 2,
    global: { touchpad: {}, scrollSpeed: null },
    devices: { "logitech-m720": { touchpad: { naturalScroll: true }, scrollSpeed: null } }
  })
  assert.equal(plan.length, 1)
  assert.ok(plan[0][2].startsWith('hl.device({ name = "logitech-m720"'))
})

test("applyPlan: nothing set -> empty plan; stale gestures produce nothing", () => {
  assert.equal(M.applyPlan(M.defaultConfig()).length, 0)
  assert.equal(M.applyPlan({}).length, 0)
  assert.equal(M.applyPlan({ gestures: { workspaceSwipe: { enabled: true, fingers: 3 } } }).length, 0)
  assert.equal(M.GESTURES.length, 0)
})

// -------------------------------------------------------------- managed lua

test("loader line is idempotent and marker-guarded", () => {
  const once = M.withLoader("")
  assert.ok(once.includes("omarchy-magic-trackpad"))
  assert.ok(once.includes("pcall(dofile"))
  assert.equal(M.needsLoader(once), false)
  assert.equal(M.withLoader(once), once)
})

test("generateLua emits a guarded stub when nothing is set", () => {
  const stub = M.generateLua(M.defaultConfig())
  assert.ok(stub.includes('if type(hl) ~= "table" then return end'))
  assert.ok(!stub.includes("hl.config"))
  assert.ok(!stub.includes("hl.device"))
  assert.ok(!stub.includes("hl.gesture"))
})

test("generateLua emits global hl.config then a pcall-wrapped hl.device per override", () => {
  const lua = M.generateLua({
    version: 2,
    global: { touchpad: { tapToClick: true }, scrollSpeed: "slow" },
    devices: { "apple-inc.-magic-trackpad": { touchpad: { naturalScroll: false }, scrollSpeed: null } }
  })
  assert.ok(lua.includes("hl.config({ input = { touchpad = { tap_to_click = true, scroll_factor = 0.2 } } })"))
  assert.ok(lua.includes('pcall(function() hl.device({ name = "apple-inc.-magic-trackpad", natural_scroll = false }) end)'))
  assert.ok(!lua.includes("middle_button_emulation"))
})

// -------------------------------------------------------------- view model

test("effectiveToggle cascades device -> global -> live (2-arg form = global)", () => {
  const cfg = {
    version: 2,
    global: { touchpad: { naturalScroll: true }, scrollSpeed: null },
    devices: { "logitech-m720": { touchpad: { naturalScroll: false }, scrollSpeed: null } }
  }
  // device scope: its own value wins
  assert.equal(M.effectiveToggle(cfg, {}, "logitech-m720", "naturalScroll"), false)
  // device scope, option not overridden: falls through to global
  assert.equal(M.effectiveToggle(cfg, {}, "logitech-m720", "tapToClick"), false) // global unset -> live unset -> false
  assert.equal(M.effectiveToggle(cfg, { tapToClick: true }, "logitech-m720", "tapToClick"), true)
  // global scope explicit
  assert.equal(M.effectiveToggle(cfg, {}, "global", "naturalScroll"), true)
  // legacy 3-arg form still means global
  assert.equal(M.effectiveToggle({}, { naturalScroll: true }, "naturalScroll"), true)
  assert.equal(M.effectiveToggle({ version: 2, global: { touchpad: { naturalScroll: false } } }, { naturalScroll: true }, "naturalScroll"), false)
})

test("effectiveScroll cascades device -> global -> live -> normal", () => {
  const cfg = {
    version: 2,
    global: { touchpad: {}, scrollSpeed: "fast" },
    devices: { "logitech-m720": { touchpad: {}, scrollSpeed: "slow" } }
  }
  assert.equal(M.effectiveScroll(cfg, {}, "logitech-m720"), "slow")
  assert.equal(M.effectiveScroll(cfg, {}, "global"), "fast")
  // device with no scroll override inherits global
  assert.equal(M.effectiveScroll(cfg, {}, "apple-inc.-magic-trackpad"), "fast")
  // nothing anywhere -> live -> normal
  assert.equal(M.effectiveScroll({ version: 2, global: { touchpad: {}, scrollSpeed: null }, devices: {} }, { scrollSpeed: "slow" }, "logitech-m720"), "slow")
  assert.equal(M.effectiveScroll({}, { scrollSpeed: "fast" }), "fast")
  assert.equal(M.effectiveScroll({}, {}), "normal")
})

test("isInherited / deviceOverrideCount describe a device scope", () => {
  const cfg = {
    version: 2,
    global: { touchpad: { tapToClick: true }, scrollSpeed: null },
    devices: { "logitech-m720": { touchpad: { naturalScroll: false }, scrollSpeed: "slow" } }
  }
  assert.equal(M.isInherited(cfg, "logitech-m720", "naturalScroll"), false)
  assert.equal(M.isInherited(cfg, "logitech-m720", "tapToClick"), true)
  assert.equal(M.isInherited(cfg, "global", "tapToClick"), false)
  assert.equal(M.deviceOverrideCount(cfg, "logitech-m720"), 2) // naturalScroll + scrollSpeed
  assert.equal(M.deviceOverrideCount(cfg, "global"), 0)
  assert.equal(M.deviceOverrideCount(cfg, "never-seen"), 0)
})

test("summaryLine is scope-aware", () => {
  assert.equal(M.summaryLine(M.defaultConfig()), "defaults")
  assert.equal(
    M.summaryLine({ version: 2, global: { touchpad: { tapToClick: true, naturalScroll: true }, scrollSpeed: null }, devices: {} }),
    "tap · natural scroll"
  )
  const cfg = {
    version: 2,
    global: { touchpad: {}, scrollSpeed: null },
    devices: { "logitech-m720": { touchpad: { twoFingerRight: true }, scrollSpeed: null } }
  }
  assert.equal(M.summaryLine(cfg, "logitech-m720"), "2-finger right")
  assert.equal(M.summaryLine(cfg, "apple-inc.-magic-trackpad"), "inherits global")
})

// -------------------------------------------------------------- device list

const DEVICES_JSON = JSON.stringify({
  mice: [
    { name: "logitech-usb-receiver" },
    { name: "apple-inc.-magic-trackpad" },
    { name: "synps2-synaptics-touchpad" }
  ]
})

const PROC_INPUT = [
  'I: Bus=0003 Vendor=046d Product=c52b Version=0111',
  'N: Name="Logitech USB Receiver"',
  'P: Phys=usb-0000:00:14.0-1/input2',
  'B: PROP=0',
  'B: EV=17',
  'B: REL=1943',
  '',
  'I: Bus=0005 Vendor=05ac Product=030e Version=0100',
  'N: Name="Apple Inc. Magic Trackpad"',
  'P: Phys=00:1f:20:5e:8a:1c',
  'B: PROP=5',
  'B: EV=1b',
  'B: ABS=260800000000000',
  '',
  'I: Bus=0011 Vendor=0002 Product=0007 Version=01b1',
  'N: Name="SynPS/2 Synaptics TouchPad"',
  'P: Phys=isa0060/serio1/input0',
  'B: PROP=5',
  'B: EV=b',
  'B: ABS=660800011000003',
  ''
].join("\n")

test("touchpadDevices keeps the trackpads and drops the plain mouse", () => {
  const out = M.touchpadDevices(DEVICES_JSON, PROC_INPUT)
  const names = out.map((d) => d.name)
  assert.deepEqual(names.sort(), ["apple-inc.-magic-trackpad", "synps2-synaptics-touchpad"])
  assert.equal(out.find((d) => d.name === "apple-inc.-magic-trackpad").label, "Magic Trackpad")
})

test("touchpadDevices falls back to every pointer when /proc yields no touchpad", () => {
  const out = M.touchpadDevices(DEVICES_JSON, "garbage with no device blocks")
  assert.equal(out.length, 3)
})

test("touchpadDevices tolerates broken input", () => {
  assert.deepEqual(M.touchpadDevices("", ""), [])
  assert.deepEqual(M.touchpadDevices("not json", null), [])
  assert.deepEqual(M.touchpadDevices(JSON.stringify({ mice: [{ name: "bad name!" }] }), PROC_INPUT), [])
})
