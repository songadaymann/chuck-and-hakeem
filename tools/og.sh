#!/bin/sh
# Remakes public/og.jpg (the 1200x630 link-preview picture) from the running dev game (npm run dev on 8791):
# the title card on the left, both men and the Capitol on the right, no clocks in frame so it never goes stale.
#   sh tools/og.sh
cd "$(dirname "$0")/.." || exit 1
E='__game.giants.forEach(g => g.sign.visible = false); document.getElementById("hud").hidden = true; const st = document.getElementById("start"); st.hidden = false; st.style.display = ""; let seen = 0; for (const el of st.querySelectorAll(".box > *")) { if (el.tagName === "H1" || (el.tagName === "P" && !el.id && !el.className && seen++ === 0)) continue; el.style.display = "none"; } __game.player.avatar.setVisible(false); __game.view = [-0.21, 0.05]; __game.resize();'
node tools/snap.mjs /tmp/og-snap.png --url '/?solo&autostart&plugins=none' --w 1200 --h 630 --eval "$E" --cam '0,38,125,0,31,10' --steps 3 || exit 1
node -e "import('sharp').then((m) => m.default('/tmp/og-snap.png').jpeg({ quality: 88 }).toFile('public/og.jpg')).then((i) => console.log('public/og.jpg', i.width + 'x' + i.height, i.size, 'bytes'))"
