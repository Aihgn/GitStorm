# GitStorm

> **JetBrains/PhpStorm-style Git tool window & commit graph for Visual Studio Code.**  
> Free, open source (MIT), zero telemetry, no accounts required.

---

## ⚡ Quick Start: How to Open GitStorm

You can open and toggle the **GitStorm** tool window in 3 easy ways:

1. **Status Bar Icon**: Click the **GitStorm icon** in the bottom-left status bar.
2. **Bottom Panel Tab**: Click the **GitStorm** tab in the bottom panel (next to *Terminal*, *Output*, *Problems*).
3. **Command Palette / Shortcut**: Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> (or <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> on macOS) and type **`Git Storm: Show Commit Graph`** or press <kbd>Ctrl</kbd> + <kbd>J</kbd>.

---

## ✨ Key Features & User Guide

### 1. 📊 Interactive Commit Graph (Log)
A visual, colored commit graph showing history across all branches, tags, and remotes.

- **Explore & Filter**: Filter commits instantly by message, author, or commit hash. Use the branch dropdown to isolate specific branches.
- **Commit Details & Changed Files**: Click any commit to view full message details, author, date, and a clickable list of changed files with diff views.
- **Multi-Commit Selection**: Hold <kbd>Ctrl</kbd> (or <kbd>Cmd</kbd>) to select multiple commits, or <kbd>Shift</kbd> for a range.
- **Right-Click Commit Actions**:
  - **Show Changes / Diff**: View modified files in VS Code's diff viewer.
  - **Edit Commit Message (Reword)**: Amend the latest commit or safely reword an older commit.
  - **Squash Commits**: Combine multiple selected commits into one.
  - **Branch / Tag from Here**: Create a new branch or tag directly from any point in history.
  - **Cherry-Pick / Revert**: Apply or reverse commits with one click.
  - **Reset**: Soft, Mixed, or Hard reset with safety confirmations.
  - **Checkout**: Jump to any branch, tag, or historical commit.
- **Editor Tab Mode**: Click the external link icon or run `Git Storm: Open Commit Graph in an Editor Tab` to view the graph in a wide editor tab.

---

### 2. 🌿 Repository Tree (Branches, Remotes, Tags, Stashes)
Manage all Git references directly from the sidebar/panel tree:

| Reference | Supported Actions |
| :--- | :--- |
| **Local Branches** | Checkout, Create New Branch, Merge into Current, Rebase onto, Rename, Safe/Force Delete |
| **Remote Branches** | Checkout (auto-creates local tracking branch), New Branch from Remote, Merge, Rebase |
| **Tags** | Checkout, Create New Tag, Merge, Delete |
| **Stashes** | Stash Changes (with custom message), Pop Stash, Apply Stash, Drop, View Diff |

*Branches show live sync indicators (e.g. `↑1 ↓2` for commits ahead/behind).*

---

### 3. 🔍 Git Blame & Annotations

#### A. Gutter Blame Annotations (PhpStorm-style Annotate)
- **How to enable**: Right-click on the **line numbers (gutter)** in any file and choose **`Annotate with Git Blame`** (or click the commit icon in the top-right editor title bar).
- **Clean Display**: Shows a compact, unobtrusive column of `Author + Date` before each line.
- **Rich Hover Tooltip**: Hover over any line to inspect full commit details (commit summary, author, exact timestamp, commit hash) with a direct link to jump to that commit in the Commit Graph.
- **Auto-Sync**: Automatically updates and moves with your edits as you type and save.

#### B. Inline Blame (Current Line)
- Displays author, relative time, and commit message directly at the end of your active cursor line in the editor.

---

### 4. 📜 File History
- Track the complete history and evolution of the active file across renames.
- Click any revision in the **File History** panel to view an instant side-by-side diff against your current working copy.
- Accessible via right-click in editor > **`Git Storm: Show File History`**.

---

## ⚙️ Configuration & Settings

Customize GitStorm via VS Code Settings (<kbd>Ctrl</kbd> + <kbd>,</kbd>):

| Setting | Default | Description |
| :--- | :--- | :--- |
| `gitstorm.inlineBlame` | `true` | Show inline blame annotations on the active line. |
| `gitstorm.graphMaxCommits` | `1000` | Maximum number of commits loaded in the commit graph. |

---

## 🛡️ Safety & Reliability

- **Confirmation Prompts**: Destructive operations (such as `Hard Reset`, force deleting unmerged branches, dropping stashes, or rewriting history) always prompt with a clear explanation of what will change.
- **Non-Destructive Rebase**: When editing messages or squashing, GitStorm verifies the working tree is clean before proceeding and aborts cleanly if conflicts arise.
- **Native Integration**: Uses local `git` CLI directly through native child processes for high performance, reusing VS Code's credential store for seamless Push/Pull/Fetch.

---

## 📄 License

Distributed under the **MIT License**. Free for personal and commercial use.
