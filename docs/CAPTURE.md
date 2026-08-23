# Capturing the demo images

`README.md` and `MARKETPLACE.md` both have three image slots, commented out so
nothing renders broken until the file exists. Each is marked `<!-- DEMO:name`.
Drop the image into this folder, delete the two comment markers around that
block in **both** files, and it appears.

| Slot | File | What it shows |
| :--- | :--- | :--- |
| `DEMO:panel` | `docs/demo-panel.png` | The whole panel — the one that sells it |
| `DEMO:graph` | `docs/demo-squash.png` | Selecting commits and squashing them |
| `DEMO:blame` | `docs/demo-blame.png` | The annotation column with a hover card |

Note that `docs/**` is excluded from the `.vsix`; the images are only ever
fetched over HTTP, never shipped.

## The two files need different paths

`README.md` is read on GitHub by people who can see this repository, so it uses
relative paths — `docs/demo-panel.png` — and they resolve.

`MARKETPLACE.md` cannot. **This repository is private**, and the Marketplace
fetches images as an anonymous visitor, which a private repo answers with a 404.
Worse, `vsce` rewrites any relative path into a repository URL at package time,
so a relative path there is guaranteed to break. Its slots therefore carry
`https://PUBLIC-HOST/...` placeholders: replace the host with somewhere public
before uncommenting.

Somewhere public can be a separate assets-only repository, a gist, an image
host, or your own domain — the screenshots become public either way, but the
source does not.

The extension's own header icon needs none of this: it ships inside the `.vsix`
through the manifest's `icon` field.

## Setting up the shot

This project's own history is a straight line, which makes for a dull graph.
Generate a repository built for photographing instead:

```bash
npm run demo-repo
```

It writes `~/Desktop/gitstorm-demo` (pass a path to put it elsewhere, `--force`
to replace an existing one) with a bare origin beside it, and prints a summary.
What it sets up, and why each part matters:

| In the demo repo | Shows up as |
| :--- | :--- |
| 29 commits, 4 merges, 3 lanes | A graph with actual shape |
| `main`, `feat/audit-log`, `feat/pricing` | Branches, one of them never merged |
| `main` 1 ahead / 2 behind `origin/main` | The `↑1 ↓2` badge in the tree |
| `v0.1.0`, `v1.0.0`, two remote branches | Ref chips and the Tags/Remotes nodes |
| Two stashes | A Stashes node that is not empty |
| Added, modified, deleted and renamed files | All four status colours in the file list |
| `chore: eslint, editorconfig and a CI workflow` | A commit touching 7 files — select this one for the details pane |
| `src/auth/session.js`, 26 lines by 3 authors | A blame column with real variety |

Open that folder in the Extension Development Host (<kbd>F5</kbd>), then:

1. **Disable the other Git extensions.** GitLens and its kind add their own
   status bar blame and gutter decorations, which land in the screenshot looking
   like GitStorm's — or visibly competing with it. Run *Extensions: Disable All
   Installed Extensions for this Workspace* in the Development Host. A blame
   readout in the **bottom right** of the status bar is the usual giveaway;
   GitStorm's only status bar item is the branch icon on the left.
2. Set the window to a **light-neutral dark theme** (Dark Modern) — it is what
   most people see, and the screenshots stay legible when GitHub renders them
   on a white page.
3. Zoom the window one or two steps up (<kbd>Ctrl</kbd>+<kbd>=</kbd>). Text at
   default size is unreadable once the image is scaled to 960px wide.
4. Drag the panel taller than usual, roughly a third of the window.
5. Hide anything private: the window title shows the folder path, and the status
   bar can show your branch names and account.

## The three shots

### `demo-panel.png` — the whole panel

The single most important image. Capture the **whole VS Code window**, not just
the panel, so people can see where it lives relative to their editor.

Have on screen: `src/auth/session.js` open above, the panel below with the
Repository tree expanded on the left, the graph showing its coloured lanes and
ref chips, and **`chore: eslint, editorconfig and a CI workflow` selected** —
it is the commit with seven changed files, so the details pane on the right
fills up instead of showing two rows.

### `demo-squash.png` — history rewriting

Capture the panel only, maximised so the whole graph is visible down to
`chore: scaffold the project`.

Set it up so one frame carries the whole story: click a commit,
<kbd>Shift</kbd>+click a row or two down so several rows highlight, then
right-click to open the menu on **Squash N Commits into One…**. The details pane
on the right lists exactly which commits are selected, so the reader can see the
selection, the action and its consequence at once.

### `demo-blame.png` — annotations

Open `src/auth/session.js` — its 26 lines were written by three different people
across the demo history, so the column is not one name repeated. Run **Annotate
with Git Blame** from the gutter context menu, then hover a line so its commit
card is showing. Crop to the editor: the annotation column, the code, and the
hover card.

## Before committing them

- Resize to **1920px wide maximum**. Anything larger just makes the repo heavy;
  the README renders them at 960.
- Run them through an optimiser (`oxipng`, TinyPNG, ImageOptim). A panel
  screenshot should land under 300 KB.
- These files ship inside the `.vsix` too, so keep the total under a megabyte or
  two.
