# Speys Tools

Small tools for working across many repos in VS Code, with Claude Code alongside.

- **Repo switcher:** one key moves Source Control, the terminal and the Explorer to another project.
- **Add to Claude:** send files from the Explorer to the Claude Code message box.
- **Open in Browser:** open `.html` and `.pdf` files in your browser.
- **Claude Code CSS:** your own CSS rules in the Claude Code panel, kept across its updates.

No account, no network, no dependencies. From the makers of [Speys Local](https://github.com/speys-app/speys-local).

## Install

It isn't on the Marketplace yet, so install it from this repo. You need Node and VS Code's `code` command.

```bash
git clone https://github.com/speys-app/speys-vscode.git
cd speys-vscode
npm run package
code --install-extension speys-tools.vsix
```

Then run **Developer: Reload Window**.

## Repo switcher

In a multi-root workspace, press **Cmd+E** (**Ctrl+Alt+E** on Windows and Linux) or the project name at the left of the status bar, and pick a project:

- Source Control's Changes view moves to that repo, and the Graph follows it if it's set to Auto.
- The status bar shows that repo and branch.
- The active terminal closes if it's empty and a new one opens in the project. A terminal you've used is left alone, and one that's already empty in that project is reused.
- The folder moves to the bottom of the workspace, so the one you're on is always last. The first folder stays put, because changing it makes VS Code restart every extension.
- The Explorer collapses everything else and opens that folder.

Picking a repo in the Repositories section updates the status bar too.

Set this in your user settings, or Source Control won't switch:

```json
"scm.repositories.selectionMode": "single"
```

**Submodules** appear right under their folder as their own rows (`app › games`). Picking one moves Source Control, the terminal and the Explorer to it. It needs VS Code's `git.detectSubmodules`, which is on by default.

**Nested repos** get a row the same way: a folder directly inside a workspace folder with its own `.git`, such as a private `data` repo the parent's `.gitignore` leaves out (`app › data`). VS Code doesn't find a repo inside an ignored folder by itself, so picking it opens it in Source Control first.

**Editing the workspace:** each row has ↑ ↓ to reorder and ✕ to remove the folder from the workspace; files aren't deleted. **Add folder…** at the bottom starts with the folders next to your workspace; the **›** button on a row opens it to show everything inside, **←** goes back, and your ticks are kept while you move around; **Choose another folder…** is the button at the top right of that list. Changing the first folder restarts every extension, Claude Code's session included, so it asks first.

## Claude sessions

The same **Cmd+E** list has three tabs, shown as three icons at the top right (the active one is filled and blue): **Repo Switcher**, **Claude Sessions** and **Shortcuts**. Press **Cmd+1/2/3** to jump (they open the list on that tab even when it's closed, so they replace VS Code's "focus editor group 1/2/3"; rebind `speysTools.tab` in Keyboard Shortcuts if you need those). **Cmd+E** opens on the tab you left it on.

**Claude Sessions** lists the Claude Code sessions of your workspace folders, newest first, and picking one opens it. A picked session replaces the one in Claude Code's side panel (setting `speysTools.sessionLocation`: `sidebar` or `editor`; it flips Claude Code's `preferredLocation` for that one call and puts it back). On this tab **Tab** opens the session below the highlighted one straight away, without Enter (**Shift+Tab**: the one above), so **Cmd+E, Tab** flips to the previous session. **Cmd+E** pressed again with this tab open does the same as Tab, and does nothing on the other tabs. Inside a Claude Code panel (side panel or editor tab) **Cmd+E** skips the list and goes straight to the session below the current one, continuing down the list each press and back to the top after the last one (Tab on the list wraps the same way). It only counts as being in a Claude panel when the focus is really in it; anywhere else **Cmd+E** opens the list. Archived sessions sit under a collapsed **Archived sessions** row; press Enter on it to open the group (searching opens it too). Each session has an **Archive** button. Claude Code can't be told to archive from outside, so this keeps a second archive list in the extension: those sessions move under the archived group here but stay as they are in Claude Code's own panel. Sessions archived in Claude Code show here too, and only the ones archived from this list can be unarchived here. The archive list is read from Claude Code's state in VS Code with the `sqlite3` command (macOS and Linux have it); without it, nothing shows as archived.

## Shortcuts

The third tab pins commands you use all the time (Reload Window, Toggle Terminal, Open Settings to start with); Enter runs one. **Add shortcut…** searches every command, and ↑ ↓ ✕ reorder and remove. The list is the `speysTools.shortcuts` setting, so you can edit it in `settings.json` too (`label`, `command`, optional `args`), and Settings Sync carries it to other machines.

## Add to Claude

Right-click files in the Explorer and choose **Add to Claude**. They go into the Claude Code message box as `@` references, without the Shift that dragging needs. Needs the Claude Code extension. Folders and files that aren't text, like images, are skipped.

## Open in Browser

Right-click an `.html` or `.pdf` file in the Explorer and choose **Open in Browser**, or use the globe button at the top right of an open file.

## Claude Code CSS

Claude Code's panel has no settings for its look. Put CSS rules in `speysTools.claudeCodeCss`, one rule per item, and Speys Tools adds them to the panel's stylesheet (`webview/index.css` in the Claude Code extension) between two marker comments.

Claude Code's class names end in a hash that changes between versions (`pill_jamplw`), so a rule can name a class by the CSS module it's in: `{{pill+pillOn}}` is the `pill` class of the module that also has a `pillOn` class. The names come from the extension's `webview/index.js` each time. A placeholder that matches several modules repeats the rule for each; one that matches none leaves the rule out and says so.

```json
"speysTools.claudeCodeCss": [
  "{{inputContainer}}:focus-within{border-color:var(--app-input-border)!important}",
  "{{pill+pillOn}} span{display:none!important}",
  "button[title^=\"Claude will approve actions that pass a safety check\"]{display:none!important}"
]
```

A Claude Code update installs a fresh stylesheet, so the rules are added again each time VS Code starts; then it asks you to reload the window. Emptying the setting removes them.

## Settings

| Setting | What it does | Default |
|---|---|---|
| `speysTools.addRoot` | Folder that **Add folder…** looks in | The folder the workspace file is in |
| `speysTools.browser` | macOS app name for **Open in Browser**; empty uses the file's default app. Other systems always use the default app. | `Google Chrome` |
| `speysTools.claudeCodeCss` | CSS rules added to Claude Code's panel, one per item | empty |

## Platforms

Built and tested on macOS with VS Code 1.100 or newer. It hasn't been tried on Windows or Linux yet, so expect rough edges there. The interface comes in English and Turkish, following VS Code's display language.

Switching Source Control relies on VS Code internals with no public API, so a VS Code update can break it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run the tests with `npm test`.

## License

[MIT](LICENSE)

## Credits

The tab icons are [Codicons](https://github.com/microsoft/vscode-codicons) by Microsoft, licensed CC BY 4.0.
