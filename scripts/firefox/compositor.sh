#!/bin/sh
# Compositor GNOME sem tela, em wayland-9 (não aparece na tela do usuário).
exec dbus-run-session -- gnome-shell --headless --virtual-monitor 1920x1080 --wayland-display=wayland-9 --no-x11
