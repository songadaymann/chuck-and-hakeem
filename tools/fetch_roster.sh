#!/bin/bash
# Download the chosen Rocketbox avatars (FBX + colour textures only) and convert them all.
set -u
cd "$(dirname "$0")/.."
SRC=assets-src/rocketbox
API=https://api.github.com/repos/microsoft/Microsoft-Rocketbox/contents
RAW=https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master
ROSTER="Adults/Male_Adult_01 Adults/Male_Adult_02 Adults/Male_Adult_03 Adults/Male_Adult_05 Adults/Male_Adult_08 Adults/Male_Adult_10 Adults/Male_Adult_12 Adults/Male_Adult_15
Adults/Female_Adult_01 Adults/Female_Adult_02 Adults/Female_Adult_04 Adults/Female_Adult_06 Adults/Female_Adult_09 Adults/Female_Adult_12 Adults/Female_Adult_15
Children/Female_Child_01 Children/Male_Child_01
Professions/Construction_Male_01 Professions/Construction_Female_01 Professions/Chef_Female_01 Professions/Medical_Female_01 Professions/Medical_Male_02 Professions/Delivery_Male_01 Professions/Gardener_Male_01
Professions/Business_Male_01 Professions/Business_Male_02 Professions/Business_Male_03 Professions/Business_Male_05 Professions/Business_Female_01 Professions/Business_Female_02 Professions/Business_Female_03"
for a in $ROSTER; do
  n=$(basename $a)
  [ -f "$SRC/$n/$n.fbx" ] && continue
  mkdir -p "$SRC/$n"
  curl -sfL "$RAW/Assets/Avatars/$a/Export/$n.fbx" -o "$SRC/$n/$n.fbx" || { echo "FAILED $n fbx"; continue; }
  curl -s "$API/Assets/Avatars/$a/Textures" | python3 -I -c "import json,sys;[print(x['name']) for x in json.load(sys.stdin) if 'color' in x['name'] and not x['name'].endswith('.meta')]" | while read t; do
    curl -sfL "$RAW/Assets/Avatars/$a/Textures/$t" -o "$SRC/$n/$t" || echo "FAILED $n $t"
  done
  echo "got $n"
done
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P tools/convert_rocketbox.py -- $SRC public/models 1200 128 2>&1 | grep -E "CONVERTED|Error|Traceback|rror" | cut -c1-160
echo ROSTER_DONE
