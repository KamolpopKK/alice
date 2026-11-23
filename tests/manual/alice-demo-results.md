# alice-demo macOS qualification — 2026-11-23

Runner: Codex in the authorized `plan:alice-demo` implementation. The media walkthrough used a
controlled scenario and a scratch Alice HTTP server with synthetic data. Choices and production
approval in the harness were simulated. This was not an independent agent evaluation. The human
listening feedback below came from the actual user in this conversation.

## Environment and checks

- macOS Darwin 25.6.0, arm64 Apple M5; Node 24.18.0; Chromium 158.0.8127.18.
- Job-local Python 3.9 environment: gTTS 2.5.4, edge-tts 7.3.1.
- FFmpeg 9.1-tessus (Evermeet x86 binary running on this Mac), ffprobe 9.0.2.
  The installed Homebrew FFmpeg lacked libass; preflight correctly rejected it for subtitles.
  Tools were prepared under `/private/tmp/alice-demo-tools`, without changing system installations.
- Noto Sans Thai TTF from google/fonts, with OFL.txt included in the source packages.
  An initial custom web-font trial with a system TTC produced poor Thai marks and was replaced.
- Final focused verification: **10 test files, 75 tests passed**; `npm run typecheck`,
  `npm run build` and `git diff --check` passed. The build emitted its existing large-chunk warning.
  Exact suite command is in [the procedure](alice-demo.md).
- The generic skill-creator quick validator rejects Alice's existing `version` frontmatter key.
  This is a validator-schema mismatch; the required key is retained. Repository metadata, shared
  workflow, local-reference and installer checks passed instead.

## Evidence

Evidence root: `/private/tmp/alice-demo-evidence/qualification-OPld9d`.
`transcript.json` records actual tools, source reads, scene production, reproduction and revision tests.
Its pending-review fields describe the state at harness completion; the subsequent review is recorded
here. Media is local and deliberately not committed to git.

| Example | Voice | MP4 and source package, relative to evidence root | Result |
|---|---|---|---|
| Capture | gTTS, Thai | `capture/runs/c9f66fc5-5252-461f-8eda-c667aaf5d2dd/` | 3 real captures of the synthetic interactive fixture |
| HTML | edge-tts, th-TH-PremwadeeNeural | `html/runs/ac90b0be-af9d-4c7d-8f1d-6be791f26f66/` | 3 explicitly timed HTML scenes |
| Mixed | None | `mixed/runs/ff202053-d050-4b9a-8f15-e30a338da43f/` | Capture / HTML / capture, explicit silent subtitle timing |

Every run directory contains `video.mp4`, reports and `source-package/`. All three outputs and their
offline reproductions passed metadata verification: 30.033333 seconds, 1920x1080, 30fps, H.264/AAC.
Assembly took 8.064s / 9.159s / 7.899s respectively, excluding browser capture, HTML screenshots and
online voice generation. No performance limit was inferred from these measurements.

## Acceptance results

| Criterion | Observed evidence |
|---|---|
| Discussion and storyboard contract | SKILL.md and TEMPLATE.md cover audience, story, modes, narration/subtitles separately, both providers and alternatives. This conversation supplied the reviewed product scope. The runtime fixture explicitly records simulated decisions; no unseen autonomous conversation is claimed. |
| Fresh content after review | Each scratch Document was created, edited through HTTP to revision 2, then freshly read after simulated approval. Snapshots include the edited body and actual hash. All three changed-to-revision-3 checks stopped further production. |
| Three production modes | Nine scenes total, three per example; the files above meet 30–60s and 1080p30. Capture clicks change visible state on an actual local page, labelled synthetic. HTML content is labelled a concept. |
| Thai visual quality | Codex inspected contact-sheet frames for all nine scenes and full-size HTML/mixed frames, plus subtitle crops. Noto Thai text and marks were intact, fitted the layouts, and captions occupied the reserved lower area. `contact.png`, `html-final.png`, `mixed-final.png` and `subtitle-qa-6Y1Mif/` hold evidence. |
| Real voices and human listening | Both providers generated real Thai audio. The actual user listened to the two original samples listed below and answered **“ทั้งสองผ่าน”** (both pass) to the question about clarity and cut-off speech. The runtime cannot consume audio, so Codex does not claim to have listened. |
| Speech tails and subtitles | Every generated speech file fits its 10s scene; assembly retains complete speech and pads silence. FFmpeg silencedetect measures boundary silence at -45dB/0.03s; captions use measured speech bounds. `subtitle-boundaries.json` verifies actual decoded frames before/after all 9 cue edges at ±0.08s, within the 0.2s requirement. This is timing evidence, not a pronunciation test. |
| Failure and recovery | Focused tests exercise changed source/body/identity, invalid paths and symlinks, shell literals, timeout/provider failures, missing codecs/assets/fonts, stale audio/frames, overrun and preservation of earlier successful output. Provider failure stops without fallback. |
| Reproduction and delivery | Each source package ran its `reproduce.mjs` using saved normalized clips, without TTS or the original app; reproduced outputs passed metadata verification. Editable HTML/actions, scripts, audio, captions, font/license, manifest and source snapshot are included. |
| Document and credential boundaries | The scratch server contained exactly the three storyboard Documents; no Delivery Document was created and production left every storyboard at revision 2. Subsequent revision-3 edits were intentional failure tests. Package inventories (19/19/16 files) contain no auth/env/cookie/token/credential filenames and no checked bearer/header/password markers. Automated tests also verify auth-state exclusion; this bounded scan is not a universal secret detector. |
| Distribution | Both existing client installers copy the complete standalone bundle byte-for-byte into scratch homes; no demo production dependencies were added to Alice's runtime package. |

Human-listened samples (original qualification run):

- gTTS: `/private/tmp/alice-demo-evidence/qualification-OlQvaQ/capture/media/audio/scene1-speech-e058dad0ee80b702.mp3`
- edge-tts: `/private/tmp/alice-demo-evidence/qualification-OlQvaQ/html/media/audio/scene1-speech-7be36fb37205706d.mp3`

Both say “อลิซช่วยให้ทีมทำงานร่วมกันผ่านบอร์ดเดียว”. The final run uses the same text, provider,
voice settings and durations, but its audio bytes differ; approval applies to the original samples,
not a claim that the user listened to the final full videos. Final-video speech preservation and
caption alignment were checked technically as described above. No full-film listening by Codex or
the user is claimed.

## Fixes from qualification and limits

Measured leading/trailing silence replaced padded-file subtitle timing. Cached cues refresh subtitle
text and speech bounds. HTML frame provenance now includes scene content, video settings, font and
declared asset hashes. Hanging authored capture actions and HTML renderAt calls have deadlines.
Selected narration/subtitles require script cues. Focused checks passed after these fixes.

Qualification covers this macOS environment. Linux/Windows, every native application, every font,
third-party page and future provider behavior remain unverified. External TTS availability can change;
the workflow must report failures and agree alternatives. No video was published, no paid service was
activated, and no production board data was used by the media harness.

## PR readiness after main integration

Integrated main at `2abdeb6` and aligned the new skill metadata with Alice 0.2.5. Main's temporary-HOME
isolation initially hid the installed Playwright cache. Vitest now resolves that cache before HOME is
isolated; CI installs FFmpeg and Chromium before the unit/system media suites. The full rerun passed
71 test files: 498 tests passed, 1 skipped. Typecheck, build and diff checks passed. These integration
changes did not regenerate the qualified videos or expand the platform qualification claim above.
