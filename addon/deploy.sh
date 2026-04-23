#!/bin/bash
# Deploy spectatedtarget addon to CSDK.
# Usage: bash deploy.sh

set -e

CSDK="/c/Users/User/Documents/Reduced_CSDK_12"
ADDON="spectatedtarget"
SRC="$(cd "$(dirname "$0")" && pwd)"

echo "=== Spectated Target Deploy ==="
echo "Source: $SRC"
echo "CSDK:   $CSDK"
echo "Addon:  $ADDON"

echo "--- Step 1: Copy source to CSDK content ---"
rm -rf "$CSDK/content/citadel_addons/$ADDON/panorama/"
mkdir -p "$CSDK/content/citadel_addons/$ADDON/panorama/scripts"
mkdir -p "$CSDK/content/citadel_addons/$ADDON/panorama/layout"

cp "$SRC/scripts/0_wait_for_match.js" "$CSDK/content/citadel_addons/$ADDON/panorama/scripts/0_wait_for_match.js"
cp "$SRC/scripts/1_watch_spectated.js" "$CSDK/content/citadel_addons/$ADDON/panorama/scripts/1_watch_spectated.js"
cp "$SRC/layout/citadel_hud_top_bar.xml" "$CSDK/content/citadel_addons/$ADDON/panorama/layout/citadel_hud_top_bar.xml"
cp "$SRC/layout/citadel_hud_top_bar_player.xml" "$CSDK/content/citadel_addons/$ADDON/panorama/layout/citadel_hud_top_bar_player.xml"

echo "--- Step 2: Clear game output folder ---"
rm -rf "$CSDK/game/citadel_addons/$ADDON/panorama/"

echo "--- Step 3: Compile manually in CSDK 12 ---"
echo ">>> Open CSDK 12, select $ADDON addon, compile."
echo ">>> Then copy the generated VPK into Deadlock game/citadel/addons/."
