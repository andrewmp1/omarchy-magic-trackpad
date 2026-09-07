// Contract tests against a *live* Hyprland — the layer that catches API
// drift. Every one reads the current value, applies the plugin's own command,
// asserts the change, and restores the original in a finally block.
//
// Skipped unless run inside a Hyprland session (HYPRLAND_INSTANCE_SIGNATURE).
// Run with:  node --test tests/hypr-contract.test.js
// or via:    bash scripts/check.sh   (runs it automatically when in a session)

const test = require("node:test")
const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const M = require("../Model.js")

const inSession = !!process.env.HYPRLAND_INSTANCE_SIGNATURE
const opts = { skip: inSession ? false : "not in a Hyprland session" }

function hyprctl(args) {
  try {
    return { code: 0, out: execFileSync("hyprctl", args, { encoding: "utf8" }).trim() }
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || "").trim(), err: String(e.stderr || e.message) }
  }
}
const getOpt = (name) => M.parseGetOption(hyprctl(["getoption", "-j", name]).out)
const evalLua = (lua) => hyprctl(["eval", lua])

test("hyprctl keyword is rejected by Omarchy's Lua parser (the reason we use eval)", opts, () => {
  const r = hyprctl(["keyword", "input:touchpad:natural_scroll", "true"])
  const text = (r.out + " " + (r.err || "")).toLowerCase()
  assert.ok(
    /non-legacy parser|use eval/.test(text),
    `hyprctl keyword was NOT rejected (got: ${text.trim()}). Hyprland's parser behaviour changed — ` +
    `the plugin's approach may need revisiting.`
  )
})

test("getoption -j returns a shape parseGetOption understands", opts, () => {
  const raw = hyprctl(["getoption", "-j", "input:touchpad:natural_scroll"]).out
  const v = M.parseGetOption(raw)
  assert.ok(v === true || v === false, `unexpected getoption JSON: ${raw}`)
})

for (const t of M.TOUCHPAD_TOGGLES) {
  test(`live: ${t.field} flips via the plugin's exact command`, opts, () => {
    const before = getOpt(t.option) === true
    const target = !before
    try {
      const lua = M.toggleEvalArgs(t.field, target)[2]
      const r = evalLua(lua)
      assert.equal(r.out, "ok", `hyprctl eval failed: ${r.err || r.out}`)
      assert.equal(getOpt(t.option), target, `${t.option} did not change after ${lua}`)
    } finally {
      evalLua(M.toggleEvalArgs(t.field, before)[2])
    }
  })
}

test("live: scroll_factor takes a float via the plugin's command", opts, () => {
  const before = Number(getOpt(M.SCROLL_OPTION))
  const restore = Number.isFinite(before) ? before : 0.4
  try {
    evalLua(M.toggleEvalArgs(M.SCROLL_FIELD, 0.8)[2])
    assert.ok(Math.abs(Number(getOpt(M.SCROLL_OPTION)) - 0.8) < 1e-6, "scroll_factor did not become 0.8")
  } finally {
    evalLua(M.toggleEvalArgs(M.SCROLL_FIELD, restore)[2])
  }
})

