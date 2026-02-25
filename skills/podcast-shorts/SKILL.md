---
name: podcast-shorts
description: Create vertical shorts from long-form podcast/interview videos for YouTube Shorts, LinkedIn, etc. Use when asked to create clips, shorts, highlights, or social media cuts from podcast episodes, interviews, or long videos. Handles downloading, cropping, transcription, captioning, and trimming.
---

# Podcast Shorts

Turn long podcast episodes into vertical shorts with word-level synced captions.

## Philosophy

Keep it genuine. Minimal editing — no filler removal, no splicing, no jump cuts. Just clean trim points (start on a sentence, end on a complete thought) with accurate captions.

## Pipeline

1. **Download** source video with `yt-dlp`
2. **Extract raw clip** from source using ffmpeg
3. **Crop to 9:16 vertical** (1080×1920) — center crop from landscape (or speaker-switch crop for multi-person panels)
4. **Transcribe** with faster-whisper → word-level timestamps
5. **Identify clean boundaries** — find exact word timestamps for sentence start/end
6. **Trim** clip to clean boundaries
7. **Build SRT** — short phrases (fit 1 line on portrait screen), timestamps shifted to match trimmed clip
8. **Render** with burned-in outline captions
9. **Run mandatory visual/audio QA loop** (watch output, verify hook/start, crop correctness, subtitle placement/readability, and audio continuity)
10. **If any issue is found, re-cut/re-render and repeat QA until clean**
11. **Only then deliver to user and iterate on feedback**

## Tools

- `yt-dlp` — download source video
- `ffmpeg` — clip extraction, cropping, trimming, caption burn-in (at `~/.local/bin/ffmpeg`)
- `faster-whisper` — word-level transcription (tiny model, CPU, int8)

## Step-by-Step

### 1. Download source

```bash
yt-dlp -f "bestvideo[height<=1080]+bestaudio/best" --merge-output-format mp4 -o source.mp4 "URL"
```

### 2. Extract + crop to vertical

For 16:9 (1280×720) → 9:16 center crop:

- Crop width = 720 × 9/16 = 405px
- X offset = (1280 - 405) / 2 = 437px

```bash
ffmpeg -y -i source.mp4 -ss MM:SS -to MM:SS \
  -vf "crop=405:720:437:0,scale=1080:1920" \
  -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k raw_clip.mp4
```

**For multi-panel sources** (e.g., 3-panel podcast with dividers):

1. Extract a frame: `ffmpeg -y -i source.mp4 -ss MM:SS -frames:v 1 frame.png`
2. Inspect to find exact panel content boundaries (exclude dividers/borders — typically 10-20px)
3. Crop the content area, scale up, and pad to 9:16 with white background:

```bash
ffmpeg -y -ss MM:SS -to MM:SS -i source.mp4 \
  -vf "crop=W:H:X:Y,scale=1080:SCALED_H,pad=1080:1920:0:(1920-SCALED_H)/2:color=white,setsar=1" \
  -af "afade=t=out:st=FADE_START:d=0.5" \
  -c:v libx264 -profile:v high -preset medium -crf 23 -movflags +faststart \
  -c:a aac -b:a 128k output.mp4
```

**Critical**: Extract directly from the original source to the final clip in ONE ffmpeg command. Do not extract a long clip and then re-trim — this corrupts the audio stream.

Use generous boundaries — include a few seconds before/after the target content.

### 3. Transcribe for word timestamps

```bash
python3 -c "
from faster_whisper import WhisperModel
model = WhisperModel('tiny', device='cpu', compute_type='int8')
segs, _ = model.transcribe('raw_clip.mp4', word_timestamps=True)
for seg in segs:
    for w in seg.words:
        print(f'{w.start:.3f} {w.end:.3f} {w.word}')
"
```

### 4. Find clean trim points

From the word timestamps, identify:

- **Start**: First word of the target sentence
- **End**: Last word's end time (e.g., "event" ends at 36.24s)

Trim ~0.15s before first word start, end right after last word + 0.3s padding. Apply audio fade-out on the last 0.5s.

### 5. Trim the clip

```bash
ffmpeg -y -i raw_clip.mp4 -ss START -t DURATION \
  -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k trimmed.mp4
```

### 6. Build SRT

Rules:

- Shift all word timestamps by `-START` to align with trimmed clip
- **Max ~5 words per caption** — must fit on 1 line of a 1080-wide portrait screen
- Group words into natural phrases
- No caption should visually wrap to more than 2 lines on screen
- Test: any line longer than ~25 characters will wrap at FontSize=18

### 7. Render with captions

```bash
ffmpeg -y -i trimmed.mp4 -t END_TIME \
  -af "afade=t=out:st=FADE_START:d=0.5" \
  -vf "subtitles=captions.srt:force_style='FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=20'" \
  -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k final.mp4
```

**Caption style:**

- `BorderStyle=1` — outline only (no boxes/rectangles behind text)
- `FontSize=18` — readable but not overwhelming on 1080-wide portrait
- `MarginV=20` — bottom of frame, below the speaker's face
- `Outline=2` — black outline for readability on any background
- White text, no shadow

## Common Issues

- **Captions cover face**: Reduce FontSize or increase MarginV. On tight portrait crops the face fills the frame.
- **Word cut off at end**: Check word-level timestamps and add padding after the last word's end time. Use audio fade-out to smooth the ending.
- **Noise at start**: Trim start to just before first spoken word (~0.15s margin).
- **Captions wrapping to 3+ lines**: Break into shorter phrases. At FontSize=18 on 1080px width, keep lines under ~25 characters.
- **OOM during transcription**: Use faster-whisper tiny model with int8. Regular whisper OOM-kills on low-RAM machines.
- **Timestamps drift**: Always transcribe the actual clip audio, not the full source. Re-transcribe after any trim.
- **Dark border artifacts from multi-panel source**: Podcast videos often have dark blue/navy dividers between panels and around the frame (10-20px). Crop well inside the panel boundaries (add 8-10px inset from visible panel edges). Verify with frame extraction + visual inspection before sending.
- **Non-square SAR (e.g., 28:27)**: Caused by cropping a width that doesn't divide cleanly into 1080. Always add `setsar=1` to the filter chain and use `pad` with white background for 9:16 fit.
- **Audio disappears after double-trim**: Do NOT extract a long clip then trim again — the second `-ss` on an already-trimmed clip corrupts the audio stream. Always extract directly from the original source at the final timestamps in a single ffmpeg command.
- **Always use `-movflags +faststart`**: Required for Telegram and web playback to start before full download.
- **Always verify audio levels**: After rendering, check `volumedetect` at multiple points (5s intervals) through the clip to confirm audio doesn't drop to -91dB (silence).

## QA Loop (Mandatory)

Before sharing any draft, **play the rendered video end-to-end in an actual player** (browser/mpv/etc), not only via transcript/timestamp checks.

Minimum checks:

1. Hook starts correctly (e.g., interviewer question is actually audible if requested)
2. Active speaker crop is correct at each speaker turn
3. Framing has proper headroom (no top-of-head clipping) and no panel-divider artifacts
4. Captions are short, readable, and not covering faces (keep near bottom safe zone)
5. Audio is continuous and intelligible from start to end (no dropouts/silence)
6. End cut feels complete (no clipped last word)

If any check fails, re-cut and re-render, then re-watch in player. Repeat until all checks pass.

## Duration Target

30–60 seconds (YouTube Shorts max 60s). Pick segments with a strong hook in the first 3 seconds and end on a complete thought.
