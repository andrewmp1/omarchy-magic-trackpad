#!/usr/bin/env bash
# One-time setup for the PLANNED haptics phase (not needed for v0.1).
#
# Installs a udev rule that gives the Apple Magic Trackpad's hidraw nodes
# group `input` / mode 0660, so `bin/magic-haptic` can set the Taptic Engine
# strength without root. `omarchy plugin add` never runs this — do it yourself.
set -euo pipefail

RULE=/etc/udev/rules.d/60-magic-trackpad-haptics.rules
read -r -d '' BODY <<'EOF' || true
# Apple Magic Trackpad 2 (Lightning) and Magic Trackpad (USB-C) — let the
# local `input` group write the haptic hidraw interface. Installed by the
# omarchy-magic-trackpad plugin's setup.sh.
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="05ac", ATTRS{idProduct}=="0265", GROUP="input", MODE="0660"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="05ac", ATTRS{idProduct}=="0324", GROUP="input", MODE="0660"
EOF

echo "Writing $RULE (needs sudo)…"
printf '%s\n' "$BODY" | sudo tee "$RULE" >/dev/null
sudo udevadm control --reload
sudo udevadm trigger --subsystem-match=hidraw
echo "Done. Re-plug the trackpad (or reboot) for it to take effect."
echo "Undo with:  sudo rm $RULE && sudo udevadm control --reload"
