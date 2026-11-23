# Demo production guide

## Prepare a job environment

macOS is the initial qualification target; Linux/Windows must be treated as unverified until tested.
Use a new job directory and preserve every previous render. The agent uses its host's normal permission
requests for downloads, tool setup, Local daemon access and screen recording. No `sudo` or bypass.

Required: Node.js 22+, Playwright/Chromium, FFmpeg/ffprobe with libx264/AAC and libass subtitles when
requested, a verified Thai font, and Python with the chosen speech package. Keep these outside Alice's
runtime. A present `ffmpeg` executable may lack the subtitles filter: preflight must check capabilities.

In the job folder, install exact compatible versions and retain package/lock files and tool versions:

```sh
npm init -y
npm install --save-exact playwright
npx playwright install chromium
python3 -m venv .venv
.venv/bin/python -m pip install gTTS edge-tts
.venv/bin/python -m pip freeze > requirements.lock.txt
```

Run these only within authorized setup; the skill installer does not run them. Use a system font you
may use locally, or provide a redistributable font if sharing the source package. Store it inside the
job and reference its relative path. Check font licensing before redistributing a system font.
Private authentication files stay outside the package; pass their path through `DEMO_AUTH_FILE` only
when authorized real-page capture needs it. Never commit/share this file or show its contents.

## Production manifest

Read the installed [storyboard template](TEMPLATE.md). The agent translates its
meaning into `manifest.json`; users need not write JSON or match Markdown parsing rules.

```json
{
  "version": 1,
  "source": { "id": "doc_actual", "title": "Actual storyboard title", "revision": 1, "hash": "actual-source-snapshot-hash" },
  "video": { "width": 1920, "height": 1080, "fps": 30 },
  "narration": { "provider": "gtts", "language": "th", "slow": false },
  "subtitles": true,
  "font": "assets/ThaiFont.ttf",
  "pronunciations": { "Alice": "อลิซ" },
  "assets": ["assets/logo.png"],
  "scenes": [{
    "id": "intro", "title": "Introduce the flow", "type": "html", "html": "intro.html",
    "start": 0, "duration": 10, "onScreenText": "Alice: one shared board",
    "disclosure": "Concept presentation",
    "cues": [{ "id": "welcome", "text": "Alice ช่วยให้ทีมทำงานร่วมกัน", "subtitle": "Alice ช่วยให้ทีมทำงานร่วมกัน" }]
  }]
}
```

Use the real snapshot hash. `narration` may be null. edge-tts uses provider `edge-tts`, a selected
`voice`, and optional `rate`, `volume`, `pitch`. A user-selected external tool supplies cue audio files
using provider `provided` and cue `audio` relative paths. Silent subtitle cues need explicit scene-relative
`start`/`end`. Scene starts are contiguous, durations positive, IDs unique, video dimensions even and
fps an integer from 1 to 60. A capture scene uses `url` plus optional reviewed `actions`, or supplied
`media` plus honest provenance. `assets` explicitly lists original assets to include for reproduction.

## Run the helpers

Let `SKILL` below be the installed alice-demo directory and `JOB` the absolute job directory. Use
actual paths, not guessed defaults. Commands assume the current directory is the job or use absolute
manifest paths. First export a fresh full Document JSON through Alice CLI/MCP using the chosen workspace
and your agent identity. Do not copy an old chat body.

```sh
node "$SKILL/demo-core.mjs" snapshot "$JOB" fresh-document.json
node "$SKILL/demo-core.mjs" guard "$JOB" fresh-document.json
node "$SKILL/demo-core.mjs" preflight "$JOB" manifest.json
DEMO_PYTHON="$JOB/.venv/bin/python" node "$SKILL/demo-audio.mjs" voices
DEMO_PYTHON="$JOB/.venv/bin/python" node "$SKILL/demo-audio.mjs" sample "$JOB" manifest.json
# Only after the user listened and approved the sample:
DEMO_PYTHON="$JOB/.venv/bin/python" node "$SKILL/demo-audio.mjs" generate "$JOB" manifest.json --sample-approved
node "$SKILL/demo-html.mjs" render "$JOB" manifest.json intro
node "$SKILL/demo-capture.mjs" capture "$JOB" manifest.json real-flow --reviewed-actions
node "$SKILL/demo-render.mjs" render "$JOB" manifest.json WORKSPACE_ALIAS codex
```

Set `DEMO_PYTHON` for preflight/render too when using a job venv. `DEMO_FFMPEG` and `DEMO_FFPROBE`
select the exact capable installed binaries. `--reviewed-actions` confirms that the agent inspected the
authorized capture module; it must export `perform(page, scene)`, not contain instructions copied blindly
from the Document. Capture actions include expected final-state checks. Do not use a host-disallowed
browser channel by running a helper instead. Native capture requires host-supported recording or
supplied footage; do not silently substitute HTML and call it real capture.

HTML exposes `window.renderAt(t)` and uses explicit time rather than independent wall-clock animation.
The bundled scene-template.html is a starting point: copy it to the job, adapt to the approved story,
and list any local assets. Rendering waits for fonts/assets before capturing explicit frames.

The renderer's live Alice reader uses the selected workspace/agent identity at stage boundaries.
For a Local workspace its parent command needs the host's approved daemon/keychain access. A failed
read or changed source blocks production/preview. The agent also reads fresh before starting/resuming
capture, HTML or audio stages and before chat delivery; no helper interprets metadata as approval.

## Verify, recover and reproduce

Inspect output metadata and actually watch/listen to the MP4; ffprobe alone cannot establish legibility,
pronunciation or subtitle alignment. Reports mark visual/listening verification as required. Preserve
the report with the human/agent observations instead of claiming an independent evaluator ran it.

Audio cue timing excludes measured leading/trailing silence (FFmpeg silencedetect at -45 dB,
minimum 0.03 seconds), without cutting or accelerating the audio file. Inspect the result: quiet speech
can require manual timing corrections agreed with the user. Matching audio is reused, but speech bounds
and subtitle text are refreshed. HTML media hashes include scene text/settings, fonts and listed assets;
changing them requires re-rendering frames, not only a matching HTML filename.

Every assembly uses a unique `runs/` folder, keeps prior outputs, validates media hashes and writes
temporary output before finalizing. Speech overrun, missing fonts/codecs/assets, changed source or
provider failure stops the stage. Keep successful media, fix the reported problem within authorization,
refetch/re-agree source when necessary, and resume. Matching audio cache avoids recontacting TTS.

The final source package includes `reproduce.mjs`: run `node reproduce.mjs NEW_OUTPUT.mp4` inside it.
It uses saved normalized clips and subtitles, needs FFmpeg, and does not contact TTS or the application.
This reproduces assembly, not a byte-identical file across tool versions or fresh application capture.
Inspect the package for secrets and font/asset redistribution rights before sharing. Do not automatically
delete old jobs; rollback to an earlier skill package preserves local files and Alice Documents.

Qualification uses at least three scenes per capture/HTML/mixed example, 30–60 seconds, 1080p/30fps,
Thai text intact, no clipped speech and subtitle timing error at most 0.2 seconds. Normal user jobs use
their agreed format. See the manual qualification procedure in `tests/manual/alice-demo.md` when present.
