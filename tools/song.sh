#!/bin/sh
# Remakes public/audio/chuck-and-hakeem-wont-leave.mp3, the song the game plays quietly (src/plugins/audio.js), from
# Jonathan's master WAV ("12 Chuck And Hakeem Won't Leave.wav", his Song A Day for 12 November 2026; it lives in his
# Dropbox under TEMP-GAD-trailers/chuck-and-hakeem/, not in this project).
#   sh tools/song.sh "/path/to/12 Chuck And Hakeem Won't Leave.wav"
# Two passes of ffmpeg's loudnorm: the first measures, the second turns the whole song down by one fixed amount
# (linear: its dynamics are left alone) to -16 LUFS with true peaks under -2 dB, then 96 kbps stereo MP3 at 44.1 kHz,
# which every browser plays. The master ends with 12 seconds of digital silence after the fade (from 2:15.3); only the
# first 136.5 s are kept, or the quiet between two plays in the game would be that much longer than MUSIC_GAP says.
# The one command it comes to, with the numbers measured from that master:
#   ffmpeg -i IN.wav -t 136.5 -af loudnorm=I=-16:TP=-2:LRA=11:measured_I=-12.33:measured_TP=0.11:measured_LRA=6.00:measured_thresh=-22.41:offset=-0.67:linear=true \
#     -ar 44100 -ac 2 -c:a libmp3lame -b:a 96k -map_metadata -1 -map_chapters -1 -id3v2_version 3 \
#     -metadata title="Chuck And Hakeem Won't Leave" -metadata artist="Jonathan Mann" public/audio/chuck-and-hakeem-wont-leave.mp3
# Result on 12 November 2026: 1,638,927 bytes, 2 min 16.5 s, -16.3 LUFS integrated, true peak -2.9 dB.
cd "$(dirname "$0")/.." || exit 1
IN="$1"; OUT=public/audio/chuck-and-hakeem-wont-leave.mp3; FF="${FFMPEG:-ffmpeg}"; LEN=136.5
[ -f "$IN" ] || { echo "usage: sh tools/song.sh /path/to/the-master.wav"; exit 1; }
M=$("$FF" -hide_banner -nostats -i "$IN" -t $LEN -af loudnorm=I=-16:TP=-2:LRA=11:print_format=json -f null - 2>&1) || exit 1
get() { printf '%s\n' "$M" | sed -n "s/.*\"$1\" *: *\"\\([^\"]*\\)\".*/\\1/p" | tail -1; }
I=$(get input_i); TP=$(get input_tp); LRA=$(get input_lra); TH=$(get input_thresh); OFF=$(get target_offset)
[ -n "$I" ] || { echo "could not measure $IN"; exit 1; }
echo "measured: $I LUFS, $TP dBTP, LRA $LRA, threshold $TH, offset $OFF"
mkdir -p public/audio
"$FF" -hide_banner -loglevel error -y -i "$IN" -t $LEN \
  -af "loudnorm=I=-16:TP=-2:LRA=11:measured_I=$I:measured_TP=$TP:measured_LRA=$LRA:measured_thresh=$TH:offset=$OFF:linear=true" \
  -ar 44100 -ac 2 -c:a libmp3lame -b:a 96k -map_metadata -1 -map_chapters -1 -id3v2_version 3 \
  -metadata title="Chuck And Hakeem Won't Leave" -metadata artist="Jonathan Mann" "$OUT" || exit 1
ls -l "$OUT"
# what came out, measured the same way
"$FF" -hide_banner -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | sed -n '/Summary/,$p'
