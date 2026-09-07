import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Bar button + popup for touchpad behaviour and finger-swipe gestures.
// Level 1: everything here is a plain libinput / Hyprland setting, applied
// live with `hyprctl eval "hl.config{...}"` and persisted to a managed Lua file.
// No daemon, no elevated permissions.
Panel {
  id: root
  moduleName: "andrewmp1.magic-trackpad"
  ipcTarget: "magic-trackpad"

  readonly property color fg: bar ? bar.foreground : Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property var cfg: store.config
  property bool cursorActive: false
  property int cursorIndex: 0
  property bool appliedOnce: false
  property string notice: ""

  // Flat list of things the panel cursor can land on.
  //   { kind: "toggle", key, option, label }
  //   { kind: "scroll" }
  //   { kind: "gesture", key }
  //   { kind: "fingers", key }
  readonly property var navItems: {
    var items = []
    for (var i = 0; i < Model.TOUCHPAD_TOGGLES.length; i++) {
      var t = Model.TOUCHPAD_TOGGLES[i]
      items.push({ kind: "toggle", key: t.key, field: t.field, label: t.label })
    }
    items.push({ kind: "scroll" })
    for (var g = 0; g < Model.GESTURES.length; g++) {
      items.push({ kind: "gesture", key: Model.GESTURES[g].key })
      items.push({ kind: "fingers", key: Model.GESTURES[g].key })
    }
    return items
  }

  function gestureDef(key) {
    for (var i = 0; i < Model.GESTURES.length; i++) if (Model.GESTURES[i].key === key) return Model.GESTURES[i]
    return null
  }

  function moveCursor(delta) {
    if (!cursorActive) { cursorActive = true; return }
    var n = navItems.length
    cursorIndex = ((cursorIndex + delta) % n + n) % n
  }

  function activateCursor() {
    if (!cursorActive) { cursorActive = true; return }
    var item = navItems[cursorIndex]
    if (!item) return
    if (item.kind === "toggle") setToggle(item.key, item.field, !Model.effectiveToggle(cfg, sync.liveValues, item.key))
    else if (item.kind === "scroll") cycleScroll()
    else if (item.kind === "gesture") setGesture(item.key, !(cfg.gestures[item.key] && cfg.gestures[item.key].enabled))
    else if (item.kind === "fingers") cycleFingers(item.key)
  }

  // ------------------------------------------------------------- mutations

  function setToggle(key, field, value) {
    store.mutate(function (d) { d.touchpad[key] = value })
    sync.runOne(Model.toggleEvalArgs(field, value))
    sync.writeManaged(store.config)
    flash(value ? "On" : "Off")
  }

  function cycleScroll() {
    var order = Model.SCROLL_STOPS.map(function (s) { return s.key })
    var idx = Math.max(0, order.indexOf(Model.effectiveScroll(cfg, sync.liveValues)))
    var next = order[(idx + 1) % order.length]
    store.mutate(function (d) { d.scrollSpeed = next })
    sync.runOne(Model.toggleEvalArgs(Model.SCROLL_FIELD, Model.scrollStopValue(next)))
    sync.writeManaged(store.config)
    flash("Scroll: " + next)
  }

  function setGesture(key, enabled) {
    var def = gestureDef(key)
    if (!def) return
    var fingers = (cfg.gestures[key] && cfg.gestures[key].fingers) || def.defaultFingers
    store.mutate(function (d) {
      if (!d.gestures[key]) d.gestures[key] = {}
      d.gestures[key].enabled = enabled
      d.gestures[key].fingers = fingers
    })
    sync.writeManaged(store.config)
    if (enabled) {
      sync.runOne(Model.gestureEvalArgs(fingers, def.direction, def.action))
      flash("Swipe on")
    } else {
      // A registered gesture can't be un-registered at runtime; reload the
      // config (the managed file no longer emits it) to drop it.
      sync.runOne(["hyprctl", "reload"])
      flash("Swipe off (reloaded)")
    }
  }

  function cycleFingers(key) {
    var def = gestureDef(key)
    if (!def) return
    var cur = (cfg.gestures[key] && cfg.gestures[key].fingers) || def.defaultFingers
    var choices = def.fingerChoices
    var next = choices[(choices.indexOf(cur) + 1) % choices.length]
    var wasEnabled = cfg.gestures[key] && cfg.gestures[key].enabled
    store.mutate(function (d) {
      if (!d.gestures[key]) d.gestures[key] = { enabled: false }
      d.gestures[key].fingers = next
    })
    sync.writeManaged(store.config)
    if (wasEnabled) sync.runOne(["hyprctl", "reload"])
    flash(next + "-finger")
  }

  function flash(text) {
    notice = text
    noticeTimer.restart()
  }

  Timer { id: noticeTimer; interval: 1800; repeat: false; onTriggered: root.notice = "" }

  // ------------------------------------------------------------- wiring

  ConfigStore {
    id: store
    onLoaded: function (existed) {
      if (root.appliedOnce) return
      root.appliedOnce = true
      // Install the loader line + managed file (empty on a first run — the
      // plugin only writes an option once the user changes it), then push
      // whatever the document already holds to the running session.
      sync.writeManaged(store.config)
      if (existed) sync.applyLive(store.config)
      sync.refresh()
    }
  }

  HyprSync { id: sync }

  // ------------------------------------------------------------- bar button

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    tooltipText: "Trackpad · " + Model.summaryLine(root.cfg)
    iconComponent: Component {
      Item {
        Rectangle {
          anchors.centerIn: parent
          width: Math.round(parent.width)
          height: Math.round(parent.width * 0.7)
          radius: Math.max(2, width * 0.14)
          color: "transparent"
          border.width: Math.max(1, Math.round(width * 0.09))
          border.color: button.foreground
          opacity: Model.anyGestureEnabled(root.cfg) ? 1.0 : 0.75

          Rectangle {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: parent.top
            anchors.topMargin: Math.round(parent.height * 0.18)
            width: Math.round(parent.width * 0.34)
            height: Math.max(1, Math.round(parent.height * 0.09))
            radius: height
            color: button.foreground
          }
        }
      }
    }
    onPressed: function (mouseButton) {
      if (mouseButton === Qt.LeftButton) root.toggle()
    }
  }

  // ------------------------------------------------------------- popup

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(320))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function (dx, dy) { root.moveCursor(dx !== 0 ? dx : dy) }
      onActivateRequested: root.activateCursor()
      onCloseRequested: root.close()
      onTabRequested: function (direction) { root.switchPanel(direction) }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(12)

        // ---- hero ----
        Column {
          width: parent.width
          spacing: Style.space(2)
          Text {
            text: "Trackpad"
            color: root.fg
            font.family: root.fontFamily
            font.pixelSize: Style.font.title
            font.bold: true
          }
          Text {
            text: root.notice !== "" ? root.notice : Model.summaryLine(root.cfg).toUpperCase()
            color: Qt.darker(root.fg, 1.4)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            font.letterSpacing: 1.1
            elide: Text.ElideRight
            width: parent.width
          }
        }

        PanelSeparator { foreground: root.fg }

        // ---- touchpad toggles ----
        PanelSectionHeader { text: "TOUCHPAD"; foreground: root.fg; fontFamily: root.fontFamily }

        Column {
          width: parent.width
          spacing: Style.space(6)
          Repeater {
            model: Model.TOUCHPAD_TOGGLES
            Row {
              required property var modelData
              required property int index
              width: column.width
              spacing: Style.space(8)
              Text {
                width: parent.width - stateBtn.width - parent.spacing
                anchors.verticalCenter: parent.verticalCenter
                text: modelData.label
                color: root.fg
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideRight
              }
              Button {
                id: stateBtn
                text: Model.effectiveToggle(root.cfg, sync.liveValues, modelData.key) ? "On" : "Off"
                fontSize: Style.font.bodySmall
                bordered: true
                foreground: root.fg
                fontFamily: root.fontFamily
                active: Model.effectiveToggle(root.cfg, sync.liveValues, modelData.key)
                hasCursor: root.cursorActive && root.navItems[root.cursorIndex]
                  && root.navItems[root.cursorIndex].kind === "toggle"
                  && root.navItems[root.cursorIndex].key === modelData.key
                onClicked: root.setToggle(modelData.key, modelData.field, !Model.effectiveToggle(root.cfg, sync.liveValues, modelData.key))
                onHovered: function (h) {
                  if (h) {
                    root.cursorActive = true
                    for (var i = 0; i < root.navItems.length; i++)
                      if (root.navItems[i].kind === "toggle" && root.navItems[i].key === modelData.key) root.cursorIndex = i
                  }
                }
              }
            }
          }

          // scroll speed
          Row {
            width: column.width
            spacing: Style.space(8)
            Text {
              width: parent.width - scrollBtn.width - parent.spacing
              anchors.verticalCenter: parent.verticalCenter
              text: "Scroll speed"
              color: root.fg
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
            Button {
              id: scrollBtn
              text: {
                var cur = Model.effectiveScroll(root.cfg, sync.liveValues)
                for (var i = 0; i < Model.SCROLL_STOPS.length; i++)
                  if (Model.SCROLL_STOPS[i].key === cur) return Model.SCROLL_STOPS[i].label
                return "Normal"
              }
              fontSize: Style.font.bodySmall
              bordered: true
              foreground: root.fg
              fontFamily: root.fontFamily
              hasCursor: root.cursorActive && root.navItems[root.cursorIndex]
                && root.navItems[root.cursorIndex].kind === "scroll"
              onClicked: root.cycleScroll()
              onHovered: function (h) {
                if (h) {
                  root.cursorActive = true
                  for (var i = 0; i < root.navItems.length; i++)
                    if (root.navItems[i].kind === "scroll") root.cursorIndex = i
                }
              }
            }
          }
        }

        PanelSeparator { foreground: root.fg }

        // ---- gestures ----
        PanelSectionHeader { text: "FINGER SWIPES"; foreground: root.fg; fontFamily: root.fontFamily }

        Repeater {
          model: Model.GESTURES
          Column {
            required property var modelData
            width: column.width
            spacing: Style.space(4)
            Row {
              width: parent.width
              spacing: Style.space(8)
              Text {
                width: parent.width - gBtn.width - parent.spacing
                anchors.verticalCenter: parent.verticalCenter
                text: modelData.label
                color: root.fg
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideRight
              }
              Button {
                id: gBtn
                text: (root.cfg.gestures[modelData.key] && root.cfg.gestures[modelData.key].enabled) ? "On" : "Off"
                fontSize: Style.font.bodySmall
                bordered: true
                foreground: root.fg
                fontFamily: root.fontFamily
                active: root.cfg.gestures[modelData.key] && root.cfg.gestures[modelData.key].enabled === true
                hasCursor: root.cursorActive && root.navItems[root.cursorIndex]
                  && root.navItems[root.cursorIndex].kind === "gesture"
                  && root.navItems[root.cursorIndex].key === modelData.key
                onClicked: root.setGesture(modelData.key, !(root.cfg.gestures[modelData.key] && root.cfg.gestures[modelData.key].enabled))
                onHovered: function (h) {
                  if (h) {
                    root.cursorActive = true
                    for (var i = 0; i < root.navItems.length; i++)
                      if (root.navItems[i].kind === "gesture" && root.navItems[i].key === modelData.key) root.cursorIndex = i
                  }
                }
              }
            }
            Row {
              width: parent.width
              spacing: Style.space(8)
              Text {
                width: parent.width - fBtn.width - parent.spacing
                anchors.verticalCenter: parent.verticalCenter
                text: "Fingers"
                color: Qt.darker(root.fg, 1.3)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }
              Button {
                id: fBtn
                text: String((root.cfg.gestures[modelData.key] && root.cfg.gestures[modelData.key].fingers) || modelData.defaultFingers)
                fontSize: Style.font.caption
                bordered: true
                foreground: root.fg
                fontFamily: root.fontFamily
                hasCursor: root.cursorActive && root.navItems[root.cursorIndex]
                  && root.navItems[root.cursorIndex].kind === "fingers"
                  && root.navItems[root.cursorIndex].key === modelData.key
                onClicked: root.cycleFingers(modelData.key)
                onHovered: function (h) {
                  if (h) {
                    root.cursorActive = true
                    for (var i = 0; i < root.navItems.length; i++)
                      if (root.navItems[i].kind === "fingers" && root.navItems[i].key === modelData.key) root.cursorIndex = i
                  }
                }
              }
            }
          }
        }

        PanelSeparator { foreground: root.fg }

        Text {
          width: parent.width
          wrapMode: Text.WordWrap
          text: sync.lastError !== ""
            ? ("hyprctl: " + sync.lastError)
            : "Taptic Engine strength and custom gestures come in a later version."
          color: sync.lastError !== "" ? Color.urgent : Qt.darker(root.fg, 1.5)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }

  onOpenedChanged: {
    if (opened) {
      cursorActive = false
      cursorIndex = 0
      sync.refresh()
    }
  }
}
