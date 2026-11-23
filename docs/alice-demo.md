# Demo video presentations

Use `$alice-demo` in Codex or `/alice-demo` in Claude Code to present any project's feature,
workflow or concept as a video. Choose real capture, a new HTML presentation, or a mixture. The agent
discusses audience, takeaway, story order, language, tone, pacing, duration, aspect ratio and destination
before saving one editable Storyboard Document. Narration and subtitles are separate choices.

## Review before production

Review and edit the storyboard in Alice, then explicitly approve production. The agent fetches the
actual Document again and records its revision/hash. Reviewed/current metadata is not a production
command. A later revision change stops new stages until you agree which version to use. The skill
does not lock the Document, create a delivery Document, or append results to the storyboard.

The agent sends preview and final MP4/source files in chat, with real local paths and any limitations.
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

Read the [bundled production guide](../skill/alice-demo/PRODUCTION.md) for the job environment,
manifest, helper commands, source guards, recovery and offline reproduction. The same guide is
installed beside SKILL.md so it is available without a repository checkout.
