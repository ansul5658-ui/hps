# Hero video

Drop a cinematic campus film here named **`hero.mp4`** (and optionally
`hero.webm`). The hero section references `/videos/hero.mp4` and falls back
to a poster image until the video is added.

Recommended encode for best Lighthouse performance:

```bash
ffmpeg -i source.mov -vf "scale=1920:-2" -an \
  -c:v libx264 -crf 24 -preset slow -movflags +faststart hero.mp4
```

- Keep it muted, looping and under ~6 MB.
- 10–20 seconds is plenty; it loops seamlessly.
- Strip the audio track (`-an`) — autoplay requires muted video anyway.
