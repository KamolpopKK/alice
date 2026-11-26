# Demo video presentations

Use `$alice-demo` in Codex or `/alice-demo` in Claude Code to present any project's feature,
workflow or concept as a video. Choose real capture, a new HTML presentation, or a mixture. The agent
discusses audience, takeaway, story order, language, tone, pacing, duration, aspect ratio and destination
before saving one editable Storyboard Document. Narration and subtitles are separate choices.

## Choose the look and the review format

The agent offers 6–7 illustrated directions: four base styles plus 2–3 suggestions tailored to your
story. Each includes palette, typography, motion, a reason and a trade-off. Choose one, combine ideas,
or describe your own. An explicit choice is retained without asking again.

Choose keyframe images or a five-second video to review the selected direction. Exploratory cards are
labelled drafts. The selected sample uses the same fonts/assets/style as the full video; a five-second
excerpt preserves pacing instead of accelerating the whole story. Images establish composition and
readability; reviewing motion requires watching video. Visual samples normally create no new narration.

## Review before production

Review and edit the storyboard in Alice, review the selected-style sample, then explicitly approve
the latest storyboard and direction for full production. Approving a sample alone does not start the
full render or authorize a service charge. The agent fetches the
actual Document again and records its revision/hash. Reviewed/current metadata is not a production
command. A later revision change stops new stages until you agree which version to use. The skill
does not lock the Document, create a delivery Document, or append results to the storyboard.

The agent sends a full-preview MP4 plus contact-sheet images labelled by scene/frame/time, extracted
from the final video after subtitles and overlays. Give feedback by the output viewed and scene/time.
The agent summarizes impacts, applies your approved subset, updates substantive source changes for
review and re-reads the actual document. Unrelated scenes and earlier renders are retained; unchanged
media is reused only when its inputs and bytes match the newly approved source. New final video means
new matching sheets. Sheet failure leaves the review package incomplete.

Automatic checks flag fonts/assets, text bounds/safe areas, contrast and unexpected black/frozen
ranges. They cannot replace actually watching/listening; canvas text and unrun checks are disclosed.
Final MP4, sheets and editable sources arrive in chat with real local paths and limitations.
Uploading/publishing or incurring a new charge requires your instruction. A source package contains
the approved snapshot, manifest, original media and HTML/capture sources, scripts/settings, measured
subtitles, tool versions and reproduction commands. Never share browser auth state with the package.

## Choose a voice service

| Choice | Capabilities |
|---|---|
| No narration | No speech request; subtitles may still be used with explicit cue times. |
| gTTS | Google Translate online speech, language and slow mode; no selectable speaker. |
| edge-tts | Microsoft Edge online speech; actual available voice, rate, volume and pitch. |
| Your preferred tool | Tell the agent; check its setup, costs and limitations before use. |

Both bundled online options send the script externally and need internet. Their unofficial service
access may fail or change. Listen to a sample from the real script before approving full narration.
The agent never switches provider automatically. Pronunciation substitutions are separate from visible
text. If measured speech exceeds the scene slot, agree timing/script/settings changes instead of
silently trimming or accelerating speech.

## Install the skill

```sh
alice install-skill --client codex --skill alice-demo
# or --client claude-code; add --scope project for a project-scoped installation
```

The normal installer also includes this skill by default. All helper/template files and the shared
guides are copied with it. This does not install production tools, change your Local workspace or
enable new integrations. Skill metadata follows the Alice release version.

## Production and recovery

New visual jobs use local manifest version 2. Existing version-1 jobs remain supported and are not
automatically converted. Native HTML motion uses explicit scene time; this adds no Remotion, mandatory
GSAP, music service, model download or heavy App dependency. Tools stay in the production job.

Read the [bundled production guide](../skill/alice-demo/PRODUCTION.md) for the job environment,
manifest, helper commands, source guards, recovery and offline reproduction. The same guide is
installed beside SKILL.md so it is available without a repository checkout.
