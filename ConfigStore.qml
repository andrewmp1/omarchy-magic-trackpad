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
//
// Reads never go through FileView: it reads the whole file before any check,
// follows a planted symlink, and would block on a planted FIFO. BoundedRead
// does one capped nofollow/nonblock dd read instead. The FileView below is a
// watcher and writer only — blockAllReads: true, so calling .text() on it is
// a bug by construction.
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
    // atomicWrites: temp file in the destination directory, then rename —
    // a rename replaces a planted symlink instead of writing through it.
    file.setText(JSON.stringify(config, null, 2) + "\n")
  }

  // Edit through a callback that mutates a private copy.
  function mutate(change) {
    var draft = JSON.parse(JSON.stringify(config))
    change(draft)
    save(draft)
  }

  BoundedRead {
    id: reader
    cap: 65536
    onFinished: function (ok, overflow, absent, content) {
      root._readFinished(ok, overflow, absent, content)
    }
  }

  function _readFinished(ok, overflow, absent, content) {
    if (ok) {
      try {
        root.apply(JSON.parse(content))
        root.existed = true
      } catch (e) {
        // Valid read, invalid document: keep the last good one.
        console.warn("magic-trackpad: config is not valid JSON, keeping last good document:", e)
        root.existed = true
      }
    } else if (absent) {
      // Genuinely not there yet: a first install.
      root.apply(Model.defaultConfig())
      root.existed = false
    } else {
      // Symlink, FIFO, oversized, unreadable: fail closed — do not treat a
      // refusal as a missing file. Keep the last good document.
      if (!root.ready) {
        root.apply(Model.defaultConfig())
        root.existed = false
      }
    }
    if (!root.ready) {
      root.ready = true
      root.loaded(root.existed)
    }
  }

  FileView {
    id: file
    path: root.path
    preload: false
    watchChanges: true
    blockAllReads: true
    atomicWrites: true
    printErrors: false

    // External edits (hand-editing, dotfile sync). Debounced: an atomic
    // rename can produce a burst of change events.
    onFileChanged: reloadDebounce.restart()
  }

  Timer {
    id: reloadDebounce
    interval: 150
    repeat: false
    onTriggered: reader.read(root.path)
  }

  // The bounded read completes in milliseconds; this only exists so the
  // plugin still becomes ready if a read somehow never reports back.
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

  Component.onCompleted: reader.read(root.path)
}
