# Speys Tools

Small tools for working across many repos in VS Code, with Claude Code alongside.

- **Repo switcher:** one key moves Source Control, the terminal and the Explorer to another project.
- **Add to Claude:** send files from the Explorer to the Claude Code message box.
- **Open in Browser:** open `.html` and `.pdf` files in your browser.

No account, no network, no dependencies. From the makers of [Speys Local](https://github.com/speys-app/speys-local).

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

**Submodules** appear right under their folder as their own rows (`games · in app`). Picking one moves Source Control, the terminal and the Explorer to it. It needs VS Code's `git.detectSubmodules`, which is on by default.

**Editing the workspace:** each row has ↑ ↓ to reorder and ✕ to remove the folder from the workspace; files aren't deleted. **Add folder…** at the bottom lists the folders and git repos near your workspace, and you can select several. Changing the first folder restarts every extension, Claude Code's session included, so it asks first.

## Add to Claude

Right-click files in the Explorer and choose **Add to Claude**. They go into the Claude Code message box as `@` references, without the Shift that dragging needs. Needs the Claude Code extension. Folders and files that aren't text, like images, are skipped.

## Open in Browser

Right-click an `.html` or `.pdf` file in the Explorer and choose **Open in Browser**, or use the globe button at the top right of an open file.

## Settings

| Setting | What it does | Default |
|---|---|---|
| `speysTools.addRoot` | Folder that **Add folder…** looks in | The folder above the workspace file |
| `speysTools.browser` | macOS app name for **Open in Browser**; empty uses the file's default app. Other systems always use the default app. | `Google Chrome` |

## Platforms

Built and tested on macOS with VS Code 1.100 or newer. It hasn't been tried on Windows or Linux yet, so expect rough edges there. The interface comes in English and Turkish, following VS Code's display language.

Switching Source Control relies on VS Code internals with no public API, so a VS Code update can break it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run the tests with `npm test`.

## License

[MIT](LICENSE)
