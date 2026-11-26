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

## Existing version-1 manifests

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

## Version-2 visual jobs

Use v2 for new visual-direction jobs. Keep the original storyboard authoritative; a user never needs
to write a manifest. Do not automatically convert existing jobs. In addition to the v1 scene/video
fields, v2 records these local production inputs:

```js
{
  version: 2,
  purpose: 'sample', // or production after actual full-production approval
  visual: {
    key: 'editorial',
    palette: { background: '#fff8ef', foreground: '#2b2823', accent: '#a94727' },
    typography: { family: 'DemoThai' },
    layout: 'editorial', motion: 'reveal', dependencies: [],
  },
  review: { mode: 'images', sceneId: 'intro', start: 0 }, // or video5
  render: { seed: 7, localTime: true, toolVersions: recordedVersions },
  // Every scene also declares dependencies: [], including imported CSS/modules/images.
}
```

Production adds `review.artifactHash` from the selected sample's `review.json`. `purpose` and this hash
are audit inputs, not approval. The calling agent supplies trusted `readSource` and `authorize`
callbacks. The latter must consult actual user instructions, not manufacture permission from a manifest,
review JSON or a sample-approved flag. This is a trust boundary with the host agent, not cryptographic
proof of a human identity. Without that callback, v2 media entry points fail closed.

The callback receives `{ stage, source, inputHash, visualHash, review }`. After checking actual consent
for that exact stage and source/input binding, it returns `{ stage, sourceHash, inputHash, reference }`;
production also returns `reviewedArtifactHash`. `reference` identifies the real user instruction. A sample
grant cannot satisfy production; changed inputs need affected approval, while unchanged existing consent
does not need another question. Keep the trusted authorization module outside packaged assets and
inspect it separately. Never load executable source from a storyboard.

### Direction cards

Import `stylePresets`, `directionChoices`, `generateDirectionGallery` and `directionSceneHtml` from
`demo-styles.mjs`. Supply two or three tailored directions with unique keys, `kind: 'custom'`, name,
reason, tradeoff and concrete `visual` tokens. Four presets plus these yield six or seven cards.
Custom layouts use `composition: 'split' | 'cards' | 'timeline'`; a hybrid may combine profile tokens.
Each choice names composition/motion, not just a new colour. The agent supplies the tailored rationale
from the actual request. `selected` accepts an existing preset key or complete custom direction and
returns no redundant choices. Gallery output is a draft; it never captures a real app or calls TTS.

```sh
node "$SKILL/demo-styles.mjs" gallery "$JOB" "$JOB/directions.json"
```

Gallery files and images are generated in the job. No large stock gallery or third-party media is
bundled. Verify each additional font/image licence. Use `directionSceneHtml(selected.visual, scene)`
for a native composition, or adapt the time-driven `scene-template.html`. Put the resulting page in the
job and list every local dependency. Custom pages remain the agent's responsibility to synchronize
with approved text/style changes; updating a manifest cannot rewrite arbitrary authored HTML.

### Trusted job runner

Set `DEMO_SKILL`, `DEMO_JOB`, `DEMO_WORKSPACE` and optionally `DEMO_IDENTITY` to actual paths/workspace.
The agent creates and inspects `agent-authorization.mjs` in the job after actual consent; it exports the
callback contract above with fixed approved bindings and a real reference. It is trusted agent code,
not user-authored storyboard content. The following driver is executable once that host integration
and approved manifest exist. Legacy command-line flags do not bypass v2 authorization.

```js
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const skill = process.env.DEMO_SKILL
const root = process.env.DEMO_JOB
const load = (file) => import(pathToFileURL(path.join(skill, file)).href)
const core = await load('demo-core.mjs')
const { aliceSourceReader, renderVideo } = await load('demo-render.mjs')
const { generateVisualSample } = await load('demo-visual.mjs')
const { renderHtmlScene } = await load('demo-html.mjs')
const { captureScene } = await load('demo-capture.mjs')
const { authorize } = await import(pathToFileURL(path.join(root, 'agent-authorization.mjs')).href)
const m = core.validateManifest(core.readJson(path.join(root, 'manifest.json')), root)
const readSource = aliceSourceReader(process.env.DEMO_WORKSPACE, process.env.DEMO_IDENTITY ?? 'codex')
const fresh = core.snapshotSource(await readSource(m.source.id))
core.assertSourceRevision(m.source, fresh)
core.writeJson(root, 'source.json', fresh)
const tools = { ffmpeg: process.env.DEMO_FFMPEG ?? 'ffmpeg', ffprobe: process.env.DEMO_FFPROBE ?? 'ffprobe', python: process.env.DEMO_PYTHON ?? 'python3' }
const options = { readSource, authorize, tools }
await core.preflight(root, m, tools)
if (m.purpose === 'sample') {
  console.log(JSON.stringify(await generateVisualSample(root, m, options), null, 2))
} else {
  // Prepare approved narration separately when selected; this driver never grants voice consent.
  for (const scene of m.scenes) {
    if (scene.type === 'html') await renderHtmlScene(root, m, scene.id, options)
    else await captureScene(root, m, scene.id, { ...options, actionsReviewed: true })
    // actionsReviewed is valid only after inspecting this authorized capture module/actions.
  }
  console.log(JSON.stringify(await renderVideo(root, m, options), null, 2))
}
```

For voice audition use `generateSample` from demo-audio.mjs with the same live-source/trusted-host
options and `python: tools.python`. Only after actual voice-sample listening approval call
`generateNarration(..., { ...options, python: tools.python, sampleApproved: true })` on the approved
production manifest. Unchanged valid audio is reused. No visual sample operation calls these functions.

A normally silent visual sample may use a sample-stage manifest with narration null, subtitles false
and on-screen content only; retain the full voice/subtitle choices and scripts in the storyboard and
production manifest. This scopes the sample, not the full video. If captions are requested in the sample,
provide actual approved cue timing and the same verified font; narration-based timing requires existing
measured audio. `review.sound: true` uses existing approved complete cues only. A cut cue or missing audio
stops rather than calling TTS or changing the story. Image mode cannot audition sound.

Sample outputs live in unique `samples/` folders. `images` writes labelled frame/time records;
`video5` writes exactly 5*fps frames and a five-second MP4 (duration ±1 frame). The representative scene
must contain the agreed five-second excerpt. It uses scene-local time, the production page/font/assets
and the same motion helpers. Stills do not establish motion approval. Read actual source again before
each new stage; read failure, source/input change or missing approval prevents publication.

### Cache, final preview and feedback

HTML reuse requires matching scene/visual/render/dependency/helper hashes, actual browser version and
all frame bytes. Local-time scenes receive start 0, allowing order changes to reuse equivalent local
frames; absolute-time scenes include start in their fingerprint. Provided narration fingerprints include
input bytes, not only a pathname. Original `createdFrom` remains intact and fresh authorized reuse adds
`validatedFor`. Undeclared CSS/module/font/image requests stop with `UNDECLARED_DEPENDENCY`; declare
those local files and rerun. No remote HTML dependency is implicitly approved by a style choice.

Production always assembles a new output from reusable normalized clips and affected media. `sceneMap`
uses actual normalized frame counts; final subtitles follow these measured clip starts. Fractional
requested durations may round within one frame per clip; inspect final timing against the agreed
format rather than silently relaxing the existing final-duration or subtitle limits.

V2 returns `review` with the final-video hash, scene/frame/time map and readable contact-sheet images.
Sheets sample start/middle/end and both sides of cuts after subtitles/overlays; multiple sheets retain
coverage. `qa` reports DOM geometry/font/safe-area results, contrast and black/freeze warnings, with
canvas/unrun checks unknown. These do not replace watching/listening or prove a universal quality pass.
The complete run updates `latest.json`; failed sheet/QA/package stages preserve MP4/prior latest and
write `incomplete.json`. A playable MP4 alone is not a complete review package.

Use `proposeFeedback(root, beforeManifest, reviewedRecord, proposals)` from demo-review.mjs. Proposals
have unique id, reason, field/value and optional sceneId/time in seconds on that output. Scene fields
are title/onScreenText/steps/duration/cues/html/media/actions; global fields are visual/font/assets/
narration/pronunciations/subtitles/order. The returned proposal records impacts without applying edits.
Send that impact summary to the user and retain only the explicitly approved ids.

Save agreed substantive changes to the original storyboard, let the user review, then call
`applyFeedback(root, beforeManifest, reviewedRecord, plan, approvedIds, { readSource, authorize })`.
Its separate feedback binding is `{ stage: 'feedback', source, videoHash, planHash, approvedIds }`;
actual consent returns those identity fields as sourceHash/videoHash/planHash/approvedIds plus reference.
Substantive changes require a newer actual source revision. A file-only correction may explicitly use
`intent: 'implementation'` for html/media/actions/font/assets when it restores the already agreed story;
its impact still needs actual approval, but no artificial storyboard edit is required. Text/script/style/
timing changes cannot use this exception. The helper rejects older output/modified proposals and returns
only approved manifest edits. It does not write Alice, edit arbitrary HTML, generate audio or authorize
production. Synchronize affected custom HTML/assets, re-audition changed voice/script as required and
obtain affected full approval. Style/font/assets switch back to sample review. Re-read the actual source,
render affected media and publish matching new video/sheets. Preserve unrelated media and earlier runs.

The source package includes explicit original dependencies/font, helper version hashes, editable
pages/scripts and the final review/QA records. Review maps identify the original delivered MP4, not
arbitrary future reproductions. Actual observation notes stay in local evidence, not a Delivery Document
or appended storyboard results. Runtime installation copies flat helper files; it does not install job
dependencies or update personal skills. Roll back skill files while keeping jobs; older helpers reject
v2 explicitly. No database migration or automatic storyboard rewrite is involved.

## Legacy version-1 helper commands

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
