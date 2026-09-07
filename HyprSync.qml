import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// Config document -> live Hyprland + a managed file that survives a restart.
//
//   refresh()         re-reads the current touchpad option values into
//                     `liveValues` (used to show state the user hasn't set).
//   applyLive(cfg)     runs the `hyprctl keyword` plan now.
//   runOne(argv)       queues one `hyprctl` invocation.
//   writeManaged(cfg)  regenerates ~/.config/hypr/omarchy-magic-trackpad.lua
//                      and appends one guarded loader line to hyprland.lua.
//
// All of it is safe when Hyprland is not running — hyprctl just fails.
Item {
  id: root

  readonly property string home: Quickshell.env("HOME")
  readonly property string configDir: Quickshell.env("XDG_CONFIG_HOME") || (home + "/.config")
  readonly property string luaPath: configDir + "/hypr/omarchy-magic-trackpad.lua"
  readonly property string hyprlandLuaPath: configDir + "/hypr/hyprland.lua"

  property string lastError: ""
  property bool loaderInstalled: false

  // key -> current bool, or "normal"/"slow"/"fast" for scrollSpeed. Read from
  // Hyprland; the config document overrides any key the user has set.
  property var liveValues: ({})

  // -------------------------------------------------------------- read-back

  // One shell call emits `key<TAB>value` lines for every option we care
  // about. `hyprctl getoption -j` prints one JSON object; jq-free parsing
  // happens in Model.parseGetOption.
  readonly property string _refreshScript: {
    var lines = ["set -e"]
    for (var i = 0; i < Model.TOUCHPAD_TOGGLES.length; i++) {
      var t = Model.TOUCHPAD_TOGGLES[i]
      lines.push('printf "%s\\t" ' + t.key + '; hyprctl getoption -j "' + t.option + '" | tr -d "\\n"; printf "\\n"')
    }
    lines.push('printf "%s\\t" scrollSpeed; hyprctl getoption -j "input:touchpad:scroll_factor" | tr -d "\\n"; printf "\\n"')
    return lines.join("\n")
  }

  function refresh() {
    if (refreshProc.running) return
    refreshProc.command = ["bash", "-c", _refreshScript]
    refreshProc.running = true
  }

  function _applyRefresh(raw) {
    var next = {}
    var rows = String(raw || "").split("\n")
    for (var i = 0; i < rows.length; i++) {
      var tab = rows[i].indexOf("\t")
      if (tab <= 0) continue
      var key = rows[i].substring(0, tab)
      var json = rows[i].substring(tab + 1)
      var v = Model.parseGetOption(json)
      if (key === "scrollSpeed") {
        var best = "normal", bestD = 1e9
        for (var s = 0; s < Model.SCROLL_STOPS.length; s++) {
          var d = Math.abs(Model.SCROLL_STOPS[s].value - Number(v))
          if (isFinite(d) && d < bestD) { bestD = d; best = Model.SCROLL_STOPS[s].key }
        }
        next[key] = best
      } else {
        next[key] = (v === true || v === false) ? v : false
      }
    }
    liveValues = next
  }

  Process {
    id: refreshProc
    stdout: StdioCollector { id: refreshOut; waitForEnd: true; onStreamFinished: root._applyRefresh(text) }
  }

  // -------------------------------------------------------------- live apply

  property var _queue: []

  function applyLive(cfg) {
    _queue = _queue.concat(Model.applyPlan(cfg))
    if (!liveProc.running) _flush()
  }

  function runOne(argv) {
    _queue = _queue.concat([argv])
    if (!liveProc.running) _flush()
  }

  function _flush() {
    if (_queue.length === 0) return
    var next = _queue[0]
    _queue = _queue.slice(1)
    liveProc.command = next
    liveProc.running = true
  }

  Process {
    id: liveProc
    stderr: StdioCollector {
      id: liveErr
      onStreamFinished: {
        var m = String(text || "").trim()
        root.lastError = (m.length > 0 && m !== "ok") ? m : ""
      }
    }
    onExited: {
      root._flush()
      if (root._queue.length === 0) root.refresh()
    }
  }

  // -------------------------------------------------------------- managed file

  function writeManaged(cfg) {
    luaFile.setText(Model.generateLua(cfg))
    hyprlandLuaFile.reload()
  }

  FileView {
    id: luaFile
    path: root.luaPath
    atomicWrites: true
    watchChanges: false
    printErrors: false
  }

  FileView {
    id: hyprlandLuaFile
    path: root.hyprlandLuaPath
    atomicWrites: true
    watchChanges: false
    printErrors: false

    onLoaded: {
      var current = text()
      if (Model.needsLoader(current)) setText(Model.withLoader(current))
      root.loaderInstalled = true
    }
    onLoadFailed: root.loaderInstalled = false
  }

  Component.onCompleted: refresh()
}
