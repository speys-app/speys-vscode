# Contributing

No runtime dependencies, no build step: `extension.js` is what runs. Paths go through `node:path`, so the code runs on Mac and Windows; macOS-only commands are guarded by platform.

**Speed is a requirement.** The extension activates on every window, so nothing heavy runs on activation.

Code, comments and interface source text are in English.

Run `npm test` before opening a pull request and put the result in its description. A pull request without a test result waits until it has one. The tests load the extension against a stub of the `vscode` module, so try your change in VS Code as well: press F5 with this folder open.

Personal data never goes in the repo. Paths, names and accounts belong in settings.

## Adding a tool

Speys Tools is one extension holding several small tools. A new tool is a section in `extension.js`, its commands and settings in `package.json` under the `speysTools.` prefix, and a section in the README.

Command ids and setting names are public: renaming one breaks people's keybindings and settings.

## VS Code internals

Switching the Source Control view has no public API. The extension uses the Git extension's internal `model` and the hidden `workbench.scm.action.toggleRepositoryVisibility.*` commands, so a VS Code update can break it. Check this first if switching stops working.

## Translations

English is the source language and the text is the key:

```js
t("Move up")
t("Could not open {0}: {1}", browser, err.message)
```

- `l10n/bundle.l10n.<lang>.json` translates text in `extension.js`.
- `package.nls.json` holds the English text of `package.json`, and `package.nls.<lang>.json` translates it.

Text without a translation shows in English, so you never have to know another language to contribute. VS Code picks the language from its own display language.

## Packaging

```bash
npm run package
code --install-extension speys-tools.vsix --force
```

Then run **Developer: Reload Window**. The `.vsix` stays out of git.
