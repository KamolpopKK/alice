# Qualifying alice-demo on macOS

Use the approved alice-demo technical design and its Definition of Done. This procedure verifies the
shipped skill plus real media, not just wording. Record who ran each check. A controlled fixture is not
an independent agent evaluation, and simulated choices/sample approval are not real user approval.

## Environment

Work in a scratch server/workspace with synthetic data. Do not use the person's production board,
browser session or credentials. Install the standalone skill for both Codex/Claude Code into scratch
homes first (the agent-setup system test covers file equality). Set up job-local dependencies from
the bundled PRODUCTION.md. Preflight must prove H.264/AAC, libass subtitles, browser, selected voice
provider and font availability. Do not alter the user's system tools just to make a test pass.

The controlled harness is `tests/manual/alice-demo.ts`; it defaults to the v2 visual workflow. Set
`DEMO_MANIFEST_VERSION=1` for the retained legacy workflow. It uses `testDir()` and a temporary Alice
server, makes synthetic Document edits through the real HTTP API and performs live fresh reads at
production guards. It captures an actual interactive local fixture page, explicitly labelled synthetic;
this is not footage of a deployed production application. The voice scripts contain no private data.

```sh
ALICE_KEEP_TEST_DIRS=1 \
DEMO_EVIDENCE_DIR=/absolute/scratch/evidence \
DEMO_PYTHON=/absolute/job-venv/bin/python \
DEMO_FFMPEG=/absolute/capable/ffmpeg \
DEMO_FONT_FILE=/absolute/redistributable/ThaiFont.ttf \
DEMO_FONT_LICENSE=/absolute/OFL.txt \
node --import tsx tests/manual/alice-demo.ts
```

`DEMO_FFPROBE` may select a particular binary. `DEMO_REUSE_AUDIO_DIR` optionally names a prior harness
root: audio is reused only when content/settings/file hashes match; speech bounds are remeasured.
`DEMO_REUSE_FRAMES_DIR` may copy prior HTML cache candidates: fresh authorization, complete input/runtime
fingerprints and frame hashes still determine reuse. `DEMO_REUSE_MEDIA_DIR` additionally offers saved
capture footage; v2 recaptures when URL/actions/input fingerprints differ. Report actual reuse as
re-rendering rather than a new capture. Evidence paths are recorded in `latest.txt`, each run's `transcript.json` and reports.

Use a standalone Thai TTF/OTF and inspect the rendered result. A macOS TTC collection loaded as a custom
web font produced poor Thai marks in the first local trial; qualification used Noto Sans Thai with its
OFL license instead. File presence alone does not establish glyph quality.

## Story and approval walkthrough

1. Present a request with incomplete audience/story/style details. Check that the skill asks only for
   missing decisions, offers capture/HTML/mixed, and asks narration/subtitles independently.
2. Choose each voice provider in separate examples; inspect the actual edge voice list. The agent
   explains external script transfer, service fragility and user-selected alternatives without choosing
   a paid fallback. Generate a short sample from the intended narration.
3. Save one storyboard containing context, all scene sources/pages, initial states/actions, on-screen
   text, narration, subtitles and timing. Let the user/fixture edit it before approving production.
4. Read the actual Document again after approval. Snapshot must contain the edited revision/body;
   reviewed metadata alone must not start production. Observe the read calls/transcript.
5. Change its revision during production/resume/preview. Verify no new stage/preview claims the old
   source is latest, and no lock is claimed. Never silently overwrite the storyboard with output links.

The harness covers runtime revision behavior using controlled inputs. Evaluate the conversation against
SKILL.md/TEMPLATE.md separately; do not claim an unseen agent made these decisions independently.

## Visual direction and scoped feedback

The v2 harness generates six/seven illustrated choices, records an explicit selected direction and
images/video5 review mode, freshly reads the actual edited scratch Document, and produces only the
selected sample. Capture samples use actual retained fixture footage; HTML uses the same native pages,
font/assets and time-driven motion as production. Visual samples are silent and scoped separately from
full narration/subtitle settings. Production has a distinct simulated fixture grant and actual sample
artifact hash; these are controlled test inputs, never real user consent.

Each v2 production returns a final-MP4-bound contact sheet/map, automated QA and helper/source package.
In the HTML example, approve one of two feedback proposals, edit the original scratch Document, and
verify source revision 4, unchanged third-scene content and frame/clip cache hits `[true,false,true]`.
All earlier output remains intact. A later proposal against an old output must stop for reconciliation.
Source-change negative tests deliberately leave historical artifacts whose approved source revision is
recorded; showing them for qualification does not assert that they are a current production preview.

## Media and review

- Produce capture, HTML and mixed examples, each at least three scenes, 30–60 seconds, 1920x1080/30fps.
- Use gTTS for one, edge-tts for another and no narration for the third. Include Thai mixed with API
  and numbers, explicit concept labels and real observed state changes in capture footage.
- Verify ffprobe metadata, then inspect representative frames and scene boundaries at full size.
  Thai marks/text must be intact, text must fit, subtitles must be readable and not cover essential UI.
- Listen to actual provider samples and review speech ends. If the runtime cannot consume audio, ask
  the user to listen and record their exact feedback and which files were heard; do not claim the agent
  heard them. Keep all cue durations within agreed slots so assembly cannot truncate speech.
- Measure leading/trailing silence. Subtitle cues must use measured speech bounds rather than padded
  file lengths, and visually present/absent frames at cue boundaries must differ by at most 0.2 seconds.
  Silence threshold is a technical check, not proof of pronunciation or an independent listening review.

For these synthetic layouts, compare final captioned crops with the exact corresponding saved
normalized clip. The paired difference avoids mistaking a light background for white caption text. Run
`ALICE_KEEP_TEST_DIRS=1 node --import tsx tests/manual/alice-demo-subtitles.ts EVIDENCE_ROOT`.
It decodes actual final and baseline frames 0.08 seconds before/after cue edges. More than 50 pixels
with maximum-channel difference over 50 indicates caption compositing in the reserved bottom crop;
recompression noise stays below that bound in this fixture. It saves both crops and
subtitle-boundaries.json. This is a bounded fixture comparison, not general OCR or a proof of speech
pronunciation. Investigate false positives rather than relaxing thresholds to certify arbitrary layouts.

Run `ALICE_KEEP_TEST_DIRS=1 node --import tsx tests/manual/alice-demo-playback.ts EVIDENCE_ROOT` to
observe the final movies at normal 1x playback without seeking. It records twelve actual browser
screenshots per film, timing/dimensions and ended state in playback-observations.json. Playback is
muted: inspect its frames and retain separate actual human listening feedback. If a later visual-only
fix leaves the AAC stream identical, retain the exact old/new stream hashes and identify precisely which
files the human heard; never claim they watched revised visual files they did not see.

## Failure, integrity and delivery

- Run the focused suite for invalid manifest/path/symlink, literal shell inputs, timeout/provider
  errors, missing assets/fonts/codecs, stale frames/audio and overrun. Keep prior successful media.
- Inspect source packages for secrets/auth storage. Confirm only storyboard Documents were created,
  no delivery Document exists, and production did not change storyboard revisions.
- Run `node reproduce.mjs NEW_OUTPUT.mp4` from every source package with the capable FFmpeg selected.
  It must work from saved clips without contacting TTS or the original app, and the output must pass
  metadata checks. This is semantic reproduction, not a byte-identical promise across tool versions.
- Report local paths honestly in the preview/delivery chat. No publishing or paid-service activation.
- Record tool versions, platform/CPU, elapsed times and any limitations; no performance ceiling is
  imposed by the approved design. Linux/Windows remain unverified.

## Automated checks

```sh
npx vitest run tests/unit/alice-demo.test.ts tests/unit/alice-demo-core.test.ts tests/unit/alice-demo-audio.test.ts tests/unit/alice-demo-capture.test.ts tests/unit/alice-demo-html.test.ts tests/unit/alice-demo-render.test.ts tests/unit/alice-demo-visual.test.ts tests/unit/alice-demo-review.test.ts tests/system/agent-setup.test.ts tests/unit/agent-guide.test.ts tests/unit/readme-get-started.test.ts tests/unit/skill-workspace-choice.test.ts
npm run typecheck
npm run build
git diff --check
```

Run localhost/browser tests with the host permissions they require. Online provider calls belong to
the manual harness, not the offline automated suite. If any required check is unavailable or fails,
record it and do not mark qualification complete. See alice-demo-results.md for actual evidence.

The automated media suites require FFmpeg/ffprobe and installed Playwright Chromium before `npm test`.
CI installs both ahead of the unit/system run. Vitest resolves the browser cache before isolating HOME;
`PLAYWRIGHT_BROWSERS_PATH` can select an explicit installed cache without exposing the real home to writes.
