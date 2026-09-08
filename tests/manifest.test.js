const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.join(__dirname, "..")
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))

test("manifest.json is well-formed for the Omarchy plugin schema", () => {
  assert.equal(manifest.schemaVersion, 1)
  assert.match(manifest.id, /^[a-z0-9][a-z0-9.-]*\.[a-z0-9][a-z0-9-]*$/, "id must be namespaced (dot-separated)")
  assert.ok(typeof manifest.name === "string" && manifest.name.length > 0)
  assert.ok(typeof manifest.version === "string" && /^\d+\.\d+\.\d+$/.test(manifest.version))
  assert.ok(Array.isArray(manifest.kinds) && manifest.kinds.includes("bar-widget"))
  assert.ok(manifest.entryPoints && typeof manifest.entryPoints.barWidget === "string")
  assert.ok(manifest.barWidget && typeof manifest.barWidget.displayName === "string")
  for (const f of ["author", "license", "description"]) {
    assert.ok(typeof manifest[f] === "string" && manifest[f].length > 0, `missing field: ${f}`)
  }
})

test("manifest.json obeys the marketplace publishing rules", () => {
  // https://plugins.omarchy.org/publish.html
  assert.ok(!manifest.id.startsWith("omarchy."), "'omarchy.*' ids are reserved for official plugins")
  assert.ok(!("clonedFrom" in manifest) && !("omarchy.clonedFrom" in manifest),
    "remove the clonedFrom field before publishing")
  assert.ok(manifest.version.length <= 64, "version must be <= 64 chars for the marketplace card")
  assert.ok(manifest.description.length <= 240,
    "keep description a one-liner for the marketplace card (detail goes in the README)")
})

test("every declared entry-point file exists", () => {
  for (const rel of Object.values(manifest.entryPoints)) {
    assert.ok(fs.existsSync(path.join(root, rel)), `entry point file is missing: ${rel}`)
  }
})

test("BarWidget.qml moduleName stays in step with the manifest id", () => {
  const qml = fs.readFileSync(path.join(root, "BarWidget.qml"), "utf8")
  assert.ok(qml.includes(`moduleName: "${manifest.id}"`),
    `BarWidget.qml must declare moduleName: "${manifest.id}" (change the handle in ALL places together)`)
})

test("README + AGENTS reference the same plugin id", () => {
  for (const f of ["README.md", "docs/AGENTS.md"]) {
    const txt = fs.readFileSync(path.join(root, f), "utf8")
    assert.ok(txt.includes(manifest.id), `${f} does not mention ${manifest.id}`)
  }
})
