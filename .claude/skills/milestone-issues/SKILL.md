---
name: milestone-issues
description: The exact GitHub milestone and issue format this repo plans work in. Load before writing, creating, or editing any NPCanvas milestone or issue — including "plan a milestone", "add an issue", "split this into issues", inserting a .5 milestone, or updating an existing issue's body. Holds the title conventions, the fixed body schema, the label rules, and the gh commands that actually work on Windows.
---

# Milestone and issue format

Work is planned as GitHub issues in numbered milestones. The format is uniform on purpose: a future
session reads one issue and knows what to build, what not to build, and when it is done — without
reading the other 50. Deviating costs that property, so match the shape exactly.

Repo: `Tobias-Bonsack/NPCanvas`. Everything is **English**, including when the user writes German.

## The rules that decide the shape

- **One issue = one Claude context window = one commit.** Do not batch. If an issue cannot be
  finished in one session, split it.
- **`main` stays deployable after every issue.** When that is not obvious, the Goal says why it
  holds — e.g. "the pin flag keeps its current single-gold rendering until #27".
- **An export-only module with no consumers is fine** and passes `noUnusedLocals`. Say so in the
  Goal when an issue lands a module nothing calls yet; otherwise the next session will invent a
  caller.

## Milestones

Title format is `M<n> <Title>` — no dash, no colon, sentence case:

```
M1 Foundation          M5 Zones & derived locations   M8 Pointer, connection, files
M2 Persistence         M6 Quests                      M9 Render cost
M3 Map canvas          M7 Insights                    M10 Flow
M4 Dialogue & media    M3.5 Shared canvas             M6.5 Quest colours
                                                      M7.5 Capture from the screen
```

A **`.5` milestone is an insert** between two milestones, added after the base one shipped, so the
base stays the record of what actually shipped rather than being retconned. Its description says
where it sits and why it is an insert.

Descriptions: M1–M7 are telegraphic one-liners (that generation is closed). **Everything new is
multi-sentence prose that justifies why the milestone exists**, in the voice of M8–M10:

> Correctness pass over the gesture layer and the data layer. Four near-identical pointer state
> machines become one, so a cancel cancels instead of committing; […] Nothing here changes how the
> app looks.

Milestones are **never closed**. Done is `open_issues == 0`. There are no due dates.

## Issue titles

Two generations exist. Match the newer one (M8 onward): **assertive full sentences that state the
target behaviour**, not a description of the work.

- `Typing a character must not render every pin`
- `What is off screen is not in the DOM`
- `One project, one folder: a generation token for load and write`
- `When a save fails, you can see it — and fix it`
- `Schema V4: a dialogue is a line and its pictures`

Recurring shapes: `One X, not Y` / `One X for Y` / `X must not Y`. Sentence case, no trailing full
stop, 2–11 words. Em-dash for asides. British spelling (`behaviour`, `colour`) — but existing
identifiers keep their spelling (`relevance color`).

The old M1–M7 shape (`Insights: timeline`, `Area: comma, list, of, work`) is legacy. Do not write
new titles that way.

## Body schema

Fixed order. `Prerequisites` and `Non-goals` are the only optional sections.

````markdown
## Goal

Prose, 1–4 paragraphs. State the *problem*, not the task. Cite concrete evidence with
`path/file.ts:12-34` — a body without file:line references is under-researched. Justify the design
decision so it is not re-litigated later. Close with why `main` stays deployable, when that is not
obvious. Quote the offending type or function verbatim in a fenced block when the shape is the
point.

## Prerequisites

#19

## Acceptance criteria

- [ ] Each criterion names concrete files, symbols, or signatures — never "works correctly"
- [ ] Continuation lines are indented **six spaces**, so they align under the text and not the
      checkbox
- [ ] **Bold** the load-bearing word: verbatim, one, every, separate handler, no
- [ ] A criterion that can be checked by running something is better than one that needs judgement
- [ ] Tests belong here, named by file: `src/x/y.test.ts` covers the boundary, the guard, and the
      case that used to be wrong

## Non-goals

Fence off what a reader would otherwise think was forgotten, and hand it to the issue that owns it:
"that is #29". One short paragraph.

## Files

- Create `src/capture/glyph-matcher.ts`, `src/capture/glyph-matcher.test.ts`
- Touch `src/dialogue/DialoguePanel.tsx`, `src/project/types.ts`

## Definition of done

- [ ] `npm run lint` reports no errors
- [ ] `npm test` passes
- [ ] `npm run build` (tsc -b + vite build) is green
- [ ] Verified in Chrome against `C:\dev\NPCanvas_folder`: <a concrete scenario with the expected
      observation, and cleanup of whatever the check created>
- [ ] Changes committed and pushed to `main`
- [ ] This issue closed

Read `CLAUDE.md` § "Domain and architecture decisions" before starting — it holds the decisions this
issue assumes. Do not re-derive them, and do not deviate without saying so in the closing comment.
````

Details that are easy to get wrong:

- **The footer is verbatim in every issue**, with no heading and the line break after "this".
- `## Prerequisites` is either issue references or the literal `None.` — never omitted silently when
  the answer is "none".
- The Chrome verification line is only for issues with visible behaviour; a pure-function issue ends
  at the build line. `C:\dev\NPCanvas_folder` is the test project folder.
- `- Create nothing` is valid when an issue only touches existing files.
- When an issue changes something `CLAUDE.md` documents (schema version, media contract, a named
  invariant), updating `CLAUDE.md` is an **acceptance criterion**, not an afterthought.

## Labels

Exactly one type + one `area:` + one `size:`.

| | |
|---|---|
| Type | `bug` (correctness), `enhancement` (feature or performance), `accessibility` |
| Area | `area:foundation` `area:map` `area:storage` `area:dialogue` `area:media` `area:insights` `area:quest` |
| Size | `size:S` `size:M` `size:L` — S ≈ one module + tests, M is the default, L is a cross-cutting change |

M1–M7 and the earlier `.5` milestones have gaps in this convention. Do not copy those gaps.

## Formatting

Hard-wrap at ~100 characters. Backticks around every path, symbol, and command. Em-dash `—` for
asides rather than parentheses. `*italic*` for emphasis in prose, `**bold**` for obligation in
criteria.

## Commands

`gh` has no `milestone create`, so the milestone goes through the API:

```bash
gh api repos/Tobias-Bonsack/NPCanvas/milestones \
  -f title='M7.5 Capture from the screen' \
  -f description='…' -q '"#\(.number) \(.title)"'
```

Write each body to a file and pass `--body-file`. Do **not** pass a long body through `--body`:
this is Windows, and multi-line strings with `ß`, `×` and `—` get mangled by the shell.

```bash
gh issue create --title "…" --milestone "M7.5 Capture from the screen" \
  --label "enhancement,area:media,size:L" --body-file /path/to/issue.md
```

When bodies cross-reference each other, decide the numbers first (`gh issue list --limit 1` gives
the current maximum), then create them in that order and verify. If the shell mangled a Unicode
character in a `--title`, fix it afterwards with `gh issue edit <n> --title "…"`.

Finally: `gh issue list --milestone "…" --json number,title,labels` to confirm what landed.

## Inserting a milestone into planned work

Later milestones are already planned and open. A new insert lands **before** them, so it can
invalidate their bodies — a renamed action, a deleted helper, a changed file name.

1. Grep the open issues for the symbols the insert changes:
   `gh issue list --state open --json number,title,body`.
2. For each collision, edit that issue's body: add a paragraph under `## Prerequisites` naming what
   moves and which issue moves it, and adjust the affected criteria. Do not silently leave stale
   `file:line` references in criteria — a stale citation reads as a fact.
3. Say in the report which issues were touched and which were deliberately left alone, and why.

Line numbers throughout the repo's issues drift as code changes. That is accepted; only fix them
when the referenced thing has actually moved or been renamed.
