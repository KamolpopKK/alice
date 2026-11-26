# alice-demo visual workflow qualification — 2026-11-26

Runner: Codex executing the approved visual-direction plan. All media used synthetic data and a
scratch Alice HTTP server. Direction choices and source/sample/production grants in the harness were
controlled fixtures, not autonomous evaluation or actual user production consent. Human observation
below is actual feedback in this conversation. The historical qualification follows this entry.

## Candidate and environment

The candidate extends base `376ce20` on `codex/alice-demo-visual-review`; the qualification commit
contains the final harness, source-package closure and footer fix. Exact helper bytes, executed
sources, output hashes, hardware/tools and dirty-source baselines are retained in the evidence root.
The final commit links this report to those bytes; generated media stays outside git.

- macOS Darwin 25.6.0, arm64 Apple M5, 24 GiB RAM; Node 24.18.0.
- Job Python: gTTS 2.5.4 and edge-tts 7.3.1; the full package lock is retained locally.
- Installed Homebrew ffmpeg-full with libass, ffprobe and Playwright Chromium; exact versions in
  transcript/report. No production dependencies or font binaries were added to Alice's runtime.
- Noto Sans Thai TTF and OFL licence copied into each job/source package.
- Final full suite: **88 files, 598 tests passed, 1 existing skipped**. Typecheck, full build and diff
  checks pass. The pre-existing web chunk-size warning remains; no new size limit is inferred.
- Generic skill-creator quick validation still rejects Alice's required root `version` field;
  repository metadata/resources and installer tests validate that release contract instead.

## Evidence and actual media

Final evidence root (ignored): `.alice-test/demo-visual/qualification/qualification-dtk5Q1/`.
`transcript.json`, `final-audit.json`, `human-review.json`, `subtitle-boundaries.json` and
`playback-observations.json` contain observed results. Earlier candidate roots remain retained and
are not silently treated as final results. No person's production board/session was used.

| Mode | Voice | Final run beneath mode directory | Actual result |
|---|---|---|---|
| Capture | gTTS Thai | `runs/29413244-6e6c-4cef-bc59-27a6f3b186e1/` | Three real interactive synthetic-page captures |
| HTML | edge-tts Thai | `runs/52595375-a910-443f-9c90-94b8cd7d17d1/` | Native Diagram Explainer; approved-subset feedback applied |
| Mixed | None | `runs/2c5a9563-98f2-42b0-ba3c-a860e66ce9f9/` | Capture / native Product Spotlight / capture |

All final MP4s are H.264/AAC, 1920x1080 at 30fps, 900 frames / three scenes and 30.033333 seconds.
All source packages reproduced offline and reproduced outputs passed metadata checks. Final review
maps/sheets are tied to the actual encoded output hash and sampled exact frames including both sides
of cuts. Each package contains the complete 16-file public helper closure; observed file inventories
are 39 / 41 / 36. A bounded filename/content scan found no auth/env/credential files or actual Alice
bearer markers; it is not a universal secret detector.

## Requirements and agreed DoD

| Coverage | Observed evidence |
|---|---|
| Style choices | Six capture/mixed choices and seven HTML choices generated as native illustrated galleries; preset/custom/hybrid/explicit-choice contracts also pass. No gallery TTS/capture call or default production consent. |
| Selected review | Actual capture keyframes and 150-frame five-second HTML video; mode retained, selected style only, fresh revision-2 source, same visual tokens/fonts/assets as full production. Sample authorization is separate. |
| Motion | All five vocabularies pass repeated/backward/out-of-order pixel comparisons in the same browser. Independent CSS time and history-dependent rendering fail. Native disclosure moved above actual captions after detailed frame inspection. |
| Full preview | Actual final MP4-bound sheets cover start/middle/end and cuts; fractional-duration mapping, multiple sheets, stale/tampered images/video and failed extraction are exercised through real media tests. Failed packages preserve MP4 and prior latest output. |
| Scoped feedback/cache | HTML applies only the copy proposal, retains the optional third-scene edit unapplied and saves source revision 4. Frame and normalized-clip reuse is `[true,false,true]`; unchanged original provenance remains, validatedFor identifies the new source. Supplied-audio bytes, shared style/imports, timing/locality and corrupted frames have invalidation regressions. |
| Quality/integrity | Nine cue-edge comparisons pass at ±0.08 seconds (within 0.2s). Exact decoded frames and normal 1x muted browser playback were observed; all three videos reached ended state with twelve retained observations each. Thai/API text fits. All three live source-change tests stop production; no Delivery Document was created. |
| Operation/security/docs | All four Codex/Claude user/project installations execute installed samples and review helpers outside repository source. v1 compatibility, v2 authorization/path/subprocess guards, source-package privacy/closure, recovery and matching owning guides pass. Source-package reproduction does not contact TTS or the original app. |

These results cover the seven DoD areas: test levels, security, deployment/operation, performance,
accessibility/compatibility, reliability/integrity and documentation. All ten Testing design groups
have observed tests or actual controlled media evidence; no scenario is delegated to future work.
Canvas/automated-quality unknowns remain explicit in the helper and have regression coverage.

Final post-preflight production stages took 5.369s capture, 4.937s final HTML and 5.715s mixed. These
include assembly/review/QA/package but exclude prior capture, HTML frame generation, audio and initial
preflight. Gallery/sample/feedback timings and all stage timestamps are retained; some startup
measurements overlapped the full test suite. No render-time ceiling or performance guarantee applies.

## Actual human listening and visual observations

The actual user reviewed the three linked `qualification-8RXaO9` videos and answered **“ผ่านทั้ง 3 คลิป”**
(all three pass) about Thai/caption readability and clear uncut gTTS/edge-tts speech. Afterwards the
native disclosure/footer was moved above the caption area. The revised files were inspected separately
at full size and during actual normal muted playback; no claim is made that the user watched those
revised visual files or that Codex listened.

The final encoded AAC streams are byte-identical to the reviewed streams, including the silent case:

| Mode | SHA-256 of encoded AAC stream, equal in reviewed and final files |
|---|---|
| Capture | `ed76aab8bca79800805fe16685472073c89a95908fe8a8441459b6a365607cbc` |
| HTML | `b3ff17de9d430730688034d05537752a3b39647f400ef5149bead7ac24372f2e` |
| Mixed | `6b9b689deda2a0e491b498ca0440cc51b14bf198b949f0834607f615239421e4` |

Thus the actual listening feedback applies to unchanged final audio. Every full cue fits its scene;
assembly preserves complete audio and pads silence. Source/input/media hashes were checked before
reuse. Temporal freeze warnings correspond to agreed readable holds. Conservative caption-safe-area
warnings mark footer text line-box edges; final full-size frames show a clear gap from real caption
pixels, with no text overflow or actual caption overlap. The warnings were reviewed, not erased or
turned into an automatic universal pass.

## Fixes and limits

Qualification corrected fixture page names, included public shared guides in source packages and
excluded unrelated neighboring helper-folder files (privacy regression included). Native disclosure
layout now leaves the actual caption area clear. Native flow labels no longer silently stop after four;
a six-label browser regression passes. The existing three-label HTML pages are byte-identical after
that builder fix (native-html-equivalence.json), so rendering/playback evidence is reused only for those
unchanged emitted pages. Frozen source packages retain their actual producing helper hashes; the normal
cache still invalidates changed helper code. Subtitle QA now compares against normalized clips so pale
backgrounds are not misclassified as white subtitles. A type-only playback callback annotation was
added after execution; emitted JavaScript equivalence is retained in the evidence.

Qualification covers this Mac/tool configuration and synthetic workflows. Linux/Windows, arbitrary
native apps/sites/fonts and future service availability remain unverified. No video was published,
paid service activated, personal skill installation changed, or release performed by this plan.

---

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
