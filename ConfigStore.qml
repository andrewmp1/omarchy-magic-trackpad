import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// The plugin's settings document, on disk and in memory.
//
// ~/.config/omarchy/magic-trackpad.json — plain JSON the user can read, diff,
// and keep in their dotfiles. Every read is normalized, so a bad hand-edit is
// repaired rather than refused. Deleting the file resets to "inherit
// everything from Hyprland".
Item {
  id: root

  readonly property string home: Quickshell.env("HOME")
  readonly property string configDir: Quickshell.env("XDG_CONFIG_HOME") || (home + "/.config")
  readonly property string path: configDir + "/omarchy/magic-trackpad.json"

  property var config: Model.defaultConfig()
  property bool ready: false
  property bool existed: false
  property int revision: 0

  signal loaded(bool existed)

  function apply(document) {
    config = Model.normalizeConfig(document)
    revision++
  }

  function save(document) {
    apply(document)
    file.setText(JSON.stringify(config, null, 2) + "\n")
  }

  // Edit through a callback that mutates a private copy.
  function mutate(change) {
    var draft = JSON.parse(JSON.stringify(config))
    change(draft)
    save(draft)
  }

  FileView {
    id: file
    path: root.path
    watchChanges: true
    atomicWrites: true
    printErrors: false

    onLoaded: {
      try {
        root.apply(JSON.parse(text()))
      } catch (e) {
        console.warn("magic-trackpad: config is not valid JSON, keeping last good document:", e)
      }
      root.existed = true
      root.ready = true
      root.loaded(true)
    }

    onLoadFailed: {
      root.apply(Model.defaultConfig())
      root.existed = false
      root.ready = true
      root.loaded(false)
    }

    onFileChanged: reload()
  }

  // A FileView watching a not-yet-existing path can stay silent; fall back so
  // downstream still runs on a first install.
  Timer {
    interval: 500
    running: !root.ready
    repeat: false
    onTriggered: {
      if (root.ready) return
      root.apply(Model.defaultConfig())
      root.existed = false
      root.ready = true
      root.loaded(false)
    }
  }

  Component.onCompleted: file.reload()
}
