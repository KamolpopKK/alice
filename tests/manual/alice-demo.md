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

The controlled harness is `tests/manual/alice-demo.ts`. It uses `testDir()` and a temporary Alice
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
`DEMO_REUSE_MEDIA_DIR` additionally reuses saved capture footage and must be reported as re-rendering,
not a new capture. Evidence paths are recorded in `latest.txt`, each run's `transcript.json` and reports.

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

For these synthetic layouts (with no other white text in the bottom 180 pixels), run
`ALICE_KEEP_TEST_DIRS=1 node --import tsx tests/manual/alice-demo-subtitles.ts EVIDENCE_ROOT`.
It decodes actual output frames 0.08 seconds before/after cue edges and saves caption-presence images
plus subtitle-boundaries.json. This fixture-specific check is not for arbitrary layouts.

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
npx vitest run tests/unit/alice-demo.test.ts tests/unit/alice-demo-core.test.ts tests/unit/alice-demo-audio.test.ts tests/unit/alice-demo-capture.test.ts tests/unit/alice-demo-html.test.ts tests/unit/alice-demo-render.test.ts tests/system/agent-setup.test.ts tests/unit/agent-guide.test.ts tests/unit/readme-get-started.test.ts tests/unit/skill-workspace-choice.test.ts
npm run typecheck
npm run build
git diff --check
```

Run localhost/browser tests with the host permissions they require. Online provider calls belong to
the manual harness, not the offline automated suite. If any required check is unavailable or fails,
record it and do not mark qualification complete. See alice-demo-results.md for actual evidence.
