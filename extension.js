// Speys Tools: small tools for working across many repos.
// Repo switcher: picking a project from the status bar button
//   - moves Source Control's Changes view to that repo (the Graph follows it on "Auto"),
//   - makes VS Code's status bar repo/branch follow the focused repo,
//   - closes the active terminal if empty and opens one in that folder, otherwise opens one beside it,
//   - moves the folder to the bottom of the workspace (except the first folder),
//   - collapses the others in the Explorer and opens that folder.
// Each row has ↑ ↓ (reorder) and ✕ (remove from workspace) buttons, with "Add folder…" at the bottom.
// A folder's git submodules get their own rows under it: picking one switches to that repo.
// Add to Claude: Explorer right click adds the selected files to Claude Code's message box as @ references.
// Open in Browser: right click or the 🌐 in the editor title, for .html / .pdf.
const { execFile } = require('child_process');
const fs = require('fs');
const vscode = require('vscode');
const path = require('path');

const t = vscode.l10n.t;
const config = () => vscode.workspace.getConfiguration('speysTools');

// Hidden command VS Code registers per repo for the Repositories menu (ends in "scm<N>").
const TOGGLE = 'workbench.scm.action.toggleRepositoryVisibility.';
const STATE_KEY = 'speysTools.current';

let item;
let context;
let currentUri; // uri of the selected workspace folder (string)
const ranCommand = new WeakSet(); // terminals that have run a command

function activate(ctx) {
  context = ctx;
  item = vscode.window.createStatusBarItem('speysTools', vscode.StatusBarAlignment.Left, 10001);
  item.name = 'Speys Tools';
  item.command = 'speysTools.pick';

  ctx.subscriptions.push(
    item,
    vscode.commands.registerCommand('speysTools.pick', pick),
    vscode.commands.registerCommand('speysTools.addToClaude', addToClaude),
    vscode.commands.registerCommand('speysTools.openInBrowser', openInBrowser),
    vscode.window.onDidStartTerminalShellExecution((e) => ranCommand.add(e.terminal)),
    vscode.workspace.onDidChangeWorkspaceFolders(render),
  );

  currentUri = ctx.workspaceState.get(STATE_KEY);
  render();
  watchScmSelection();
}

// ---- status bar ----

function folders() {
  return vscode.workspace.workspaceFolders ?? [];
}

function currentFolder() {
  const all = folders();
  return (
    all.find((f) => f.uri.toString() === currentUri) ??
    (vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) ??
    all[0]
  );
}

// A folder's git submodules (`.gitmodules` → path) that have been cloned.
function submodules(folder) {
  let text;
  try {
    text = fs.readFileSync(path.join(folder.uri.fsPath, '.gitmodules'), 'utf8');
  } catch {
    return [];
  }
  return [...text.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)]
    .map((m) => path.join(folder.uri.fsPath, m[1]))
    .filter(isGit)
    .map((dir) => ({ name: path.basename(dir), uri: vscode.Uri.file(dir), folder, sub: true }));
}

// Everywhere you can switch to: workspace folders, each followed by its submodules.
function targets() {
  return folders().flatMap((f) => [{ name: f.name, uri: f.uri, folder: f }, ...submodules(f)]);
}

function currentTarget() {
  const found = targets().find((t) => t.uri.toString() === currentUri);
  if (found) return found;
  const f = currentFolder();
  return { name: f.name, uri: f.uri, folder: f };
}

function render() {
  const all = folders();
  // Shown with a single folder too: "Add folder…" lives here.
  if (all.length < 1) return item.hide();
  const target = currentTarget();
  item.text = target.sub ? `$(repo) ${target.folder.name} › ${target.name}` : `$(repo) ${target.name}`;
  item.tooltip = t('Switch project · reorder · add / remove');
  item.show();
}

function setCurrent(target) {
  currentUri = target.uri.toString();
  context.workspaceState.update(STATE_KEY, currentUri);
  render();
}

// The list stays open, so you can still pick after reordering or removing.
async function pick() {
  const BUTTONS = {
    up: { id: 'up', iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: t('Move up') },
    down: { id: 'down', iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: t('Move down') },
    remove: { id: 'remove', iconPath: new vscode.ThemeIcon('close'), tooltip: t("Remove from workspace (files aren't deleted)") },
  };
  const qp = vscode.window.createQuickPick();
  qp.placeholder = t('Which project?  ↑ ↓ reorder · ✕ remove');
  let focusUri;

  const refresh = () => {
    const current = currentTarget().uri.toString();
    const all = folders();
    const items = [];
    all.forEach((f, i) => {
      items.push({
        label: `$(repo) ${f.name}`,
        description: f.uri.toString() === current ? t('current') : undefined,
        folder: f,
        target: { name: f.name, uri: f.uri, folder: f },
        buttons: [i > 0 && BUTTONS.up, i < all.length - 1 && BUTTONS.down, BUTTONS.remove].filter(Boolean),
      });
      // Submodules sit under their folder; order and removal follow the folder.
      for (const s of submodules(f)) {
        items.push({
          label: `$(repo) ${s.name}`,
          description: s.uri.toString() === current ? t('in {0} · current', f.name) : t('in {0}', f.name),
          target: s,
        });
      }
    });
    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: `$(add) ${t('Add folder…')}`, action: addFolders, alwaysShow: true },
    );
    qp.items = items;
    const focus = items.find((it) => it.folder && it.folder.uri.toString() === focusUri);
    if (focus) qp.activeItems = [focus];
  };

  const sub = vscode.workspace.onDidChangeWorkspaceFolders(refresh);
  qp.onDidTriggerItemButton(async ({ item, button }) => {
    focusUri = item.folder.uri.toString();
    if (button.id === 'up') await move(item.folder, -1);
    if (button.id === 'down') await move(item.folder, 1);
    if (button.id === 'remove') await remove(item.folder);
  });
  qp.onDidAccept(() => {
    const [choice] = qp.selectedItems;
    qp.hide();
    if (choice?.target) switchTo(choice.target);
    else if (choice?.action) choice.action();
  });
  qp.onDidHide(() => {
    sub.dispose();
    qp.dispose();
  });
  refresh();
  qp.show();
}

// ---- workspace: reorder, remove, add ----

// VS Code restarts extensions when the first folder changes (Claude Code's session included).
async function confirmFirstChange() {
  const ok = t('Continue');
  const answer = await vscode.window.showWarningMessage(
    t("Changing the first folder makes VS Code restart every extension, Claude Code's session included. Continue?"),
    { modal: true },
    ok,
  );
  return answer === ok;
}

// Keep a folder's custom name; otherwise don't write "name" to the workspace file.
function spec(f) {
  return f.name === path.basename(f.uri.fsPath) ? { uri: f.uri } : { uri: f.uri, name: f.name };
}

// Swaps with a neighbor. `updateWorkspaceFolders` can't be called again until its change event
// arrives, so both folders are rewritten in one call.
async function move(folder, delta) {
  const all = folders();
  const i = folder.index;
  const j = i + delta;
  if (j < 0 || j >= all.length) return;
  const start = Math.min(i, j);
  if (start === 0 && !(await confirmFirstChange())) return;
  vscode.workspace.updateWorkspaceFolders(start, 2, spec(all[start + 1]), spec(all[start]));
}

async function remove(folder) {
  if (folder.index === 0 && !(await confirmFirstChange())) return;
  vscode.workspace.updateWorkspaceFolders(folder.index, 1);
}

// Root searched for folders to add: the setting, or the folder above the workspace file
// (`Work/clients/clients.code-workspace` → `Work`).
function addRoot() {
  const configured = config().get('addRoot');
  if (configured) return configured.replace(/^~(?=$|\/)/, require('os').homedir());
  const ws = vscode.workspace.workspaceFile;
  if (ws?.scheme === 'file') return path.dirname(path.dirname(ws.fsPath));
  const first = folders()[0];
  return first ? path.dirname(path.dirname(first.uri.fsPath)) : undefined;
}

function subdirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

const isGit = (dir) => fs.existsSync(path.join(dir, '.git'));

// Folders under the root and git repos one level down, except those already in the workspace
// and parents that contain a workspace folder.
function candidates(root) {
  const open = folders().map((f) => norm(f.uri.fsPath));
  const skip = (dir) => open.some((o) => isInside(o, dir));
  const found = [];
  for (const dir of subdirs(root)) {
    if (!skip(dir)) found.push(dir);
    for (const sub of subdirs(dir)) if (isGit(sub) && !skip(sub)) found.push(sub);
  }
  return found
    .map((dir) => ({ dir, git: isGit(dir) }))
    .sort((a, b) => b.git - a.git || a.dir.localeCompare(b.dir));
}

async function addFolders() {
  const root = addRoot();
  const items = (root ? candidates(root) : []).map(({ dir, git }) => ({
    label: `${git ? '$(repo)' : '$(folder)'} ${path.basename(dir)}`,
    description: path.relative(root, path.dirname(dir)) || undefined,
    dir,
  }));
  items.push({ label: `$(folder-opened) ${t('Choose another folder…')}`, browse: true, alwaysShow: true });

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: root ? t('Folders to add to the workspace (under {0})', path.basename(root)) : t('Folders to add to the workspace'),
  });
  if (!picked?.length) return;

  let uris = picked.filter((p) => p.dir).map((p) => vscode.Uri.file(p.dir));
  if (picked.some((p) => p.browse)) {
    const chosen = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: true,
      defaultUri: root ? vscode.Uri.file(root) : undefined,
      openLabel: t('Add to workspace'),
    });
    uris = uris.concat(chosen ?? []);
  }
  if (!uris.length) return;
  // Added at the end: the first folder doesn't change, so extensions don't restart.
  vscode.workspace.updateWorkspaceFolders(folders().length, 0, ...uris.map((uri) => ({ uri })));
}

// The picked folder moves to the bottom of the workspace: always last in the Explorer, expanded.
// The first folder doesn't move (extensions would restart). Folders after it are rewritten in one
// call; the Git extension doesn't close repos that stay in the workspace.
async function moveToBottom(folder) {
  const all = folders();
  const i = folder.index;
  if (i === 0 || i === all.length - 1) return;
  const changed = new Promise((resolve) => {
    const sub = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      sub.dispose();
      resolve();
    });
    setTimeout(() => {
      sub.dispose();
      resolve();
    }, 2000);
  });
  const rest = all.slice(i + 1).concat(folder);
  if (vscode.workspace.updateWorkspaceFolders(i, all.length - i, ...rest.map(spec))) await changed;
}

// The target is a workspace folder or a submodule in one: the workspace folder is what moves,
// while Source Control / terminal / Explorer go to the target itself.
async function switchTo(target) {
  setCurrent(target);
  await moveToBottom(target.folder).catch((err) => console.error('[speys-tools] move', err));
  await showInScm(target).catch((err) => console.error('[speys-tools] scm', err));
  await openTerminal(target);
  await showInExplorer(target).catch((err) => console.error('[speys-tools] explorer', err));
}

// ---- Explorer ----

// Collapses everything else in the Explorer, then selects and opens the root folder. Collapsing
// first matters: on an open folder `list.expand` moves the selection to its first child instead.
// `revealInExplorer` switches the sidebar to the Explorer and focuses the tree (for `list.expand`).
async function showInExplorer(folder) {
  await vscode.commands.executeCommand('workbench.view.explorer');
  await vscode.commands.executeCommand('workbench.files.action.collapseExplorerFolders');
  await vscode.commands.executeCommand('revealInExplorer', folder.uri);
  await vscode.commands.executeCommand('list.expand');
}

// ---- Source Control ----

// macOS can keep file names in NFD ("ü" as two characters), so normalize before comparing.
function norm(p) {
  return path.resolve(p).normalize('NFC');
}

function isInside(child, parent) {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + path.sep);
}

async function gitModel() {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext) return undefined;
  const exports = ext.isActive ? ext.exports : await ext.activate();
  // The Git extension's internal model: this is where repo -> sourceControl.handle comes from.
  return exports?.model;
}

function repoRoot(repo) {
  return repo.sourceControl?.rootUri?.fsPath ?? repo.root;
}

function scmId(repo) {
  return `scm${repo.sourceControl.handle}`;
}

async function showInScm(folder) {
  const mode = vscode.workspace.getConfiguration('scm').get('repositories.selectionMode');
  if (mode !== 'single') return;

  const model = await gitModel();
  const repos = (model?.repositories ?? []).filter((r) => !r.sourceControl?.isHidden);
  const target = repos.find((r) => norm(repoRoot(r)) === norm(folder.uri.fsPath));
  if (!target) return;

  // The commands are registered once the Source Control view has been opened.
  let commands = new Set(await vscode.commands.getCommands(true));
  if (!commands.has(TOGGLE + scmId(target))) {
    await vscode.commands.executeCommand('workbench.view.scm');
    commands = new Set(await vscode.commands.getCommands(true));
    if (!commands.has(TOGGLE + scmId(target))) return;
  }

  // The command is a toggle: it hides the target if already visible. The visible repo can't be
  // read, so we toggle another repo first and then the target; in "single" mode only the target
  // ends up visible, whatever the starting state.
  const other = repos.find((r) => r !== target && commands.has(TOGGLE + scmId(r)));
  if (other) await vscode.commands.executeCommand(TOGGLE + scmId(other));
  await vscode.commands.executeCommand(TOGGLE + scmId(target));
}

// When the user picks a repo in the Repositories section, update the button text too.
async function watchScmSelection() {
  const model = await gitModel().catch(() => undefined);
  if (!model) return;

  const watch = (repo) => {
    const sc = repo.sourceControl;
    if (!sc?.onDidChangeSelection) return;
    context.subscriptions.push(
      sc.onDidChangeSelection((selected) => {
        if (!selected) return;
        const target = targets().find((t) => norm(t.uri.fsPath) === norm(repoRoot(repo)));
        if (target && target.uri.toString() !== currentUri) setCurrent(target);
      }),
    );
  };

  model.repositories.forEach(watch);
  if (model.onDidOpenRepository) context.subscriptions.push(model.onDidOpenRepository(watch));
}

// ---- Add to Claude ----

// Claude Code's own command (`claude-vscode.insertAtMention`) only adds the active editor's file,
// and dragging from the Explorer needs Shift in VS Code. So each file opens in a preview tab and
// the command runs on it. The selection is empty: the whole file, no line range.
async function addToClaude(uri, uris) {
  const list = uris?.length ? uris : [uri ?? vscode.window.activeTextEditor?.document.uri].filter(Boolean);
  const skipped = [];
  for (const u of list) {
    const name = path.basename(u.fsPath);
    try {
      const stat = await vscode.workspace.fs.stat(u);
      if (stat.type & vscode.FileType.Directory) {
        skipped.push(name);
        continue;
      }
      await vscode.window.showTextDocument(u, { preview: true, selection: new vscode.Range(0, 0, 0, 0) });
    } catch {
      skipped.push(name); // image or binary file: doesn't open in a text editor
      continue;
    }
    await vscode.commands.executeCommand('claude-vscode.insertAtMention');
  }
  if (skipped.length) {
    vscode.window.showInformationMessage(t('Not added to Claude (a folder or not a text file): {0}', skipped.join(', ')));
  }
}

// ---- Open in Browser ----

// VS Code doesn't let extensions put a button on an Explorer row (only decorations: a letter and
// a color), hence the right click and editor title. `openExternal` uses the system's default app
// (PDF → Preview); we want the browser, so macOS uses `open -a`.
// From the editor title the uri can be missing (PDF in a custom editor): take it from the active tab.
async function openInBrowser(uri, uris) {
  const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;
  const list = uris?.length ? uris : [uri ?? active].filter(Boolean);
  const browser = config().get('browser');
  for (const u of list) {
    if (process.platform === 'darwin' && browser) {
      execFile('open', ['-a', browser, u.fsPath], (err) => {
        if (err) vscode.window.showErrorMessage(t('Could not open {0}: {1}', browser, err.message));
      });
    } else {
      await vscode.env.openExternal(u);
    }
  }
}

// ---- terminal ----

function terminalCwd(t) {
  const cwd = t.shellIntegration?.cwd ?? t.creationOptions?.cwd;
  if (!cwd) return undefined;
  return typeof cwd === 'string' ? cwd : cwd.fsPath;
}

// Empty: the user hasn't typed, no command has run, and it's not a task or extension terminal.
function isEmpty(t) {
  if (t.exitStatus) return false;
  if ('pty' in (t.creationOptions ?? {})) return false;
  if (/^Task\b/.test(t.name)) return false;
  return !t.state.isInteractedWith && !ranCommand.has(t);
}

async function openTerminal(folder) {
  const target = folder.uri.fsPath;

  // Reuse an empty terminal already in the target folder.
  const idle = vscode.window.terminals.find((t) => {
    const cwd = terminalCwd(t);
    return cwd && isInside(cwd, target) && isEmpty(t);
  });
  if (idle) return idle.show();

  const active = vscode.window.activeTerminal;
  if (active && isEmpty(active)) active.dispose();

  const terminal = vscode.window.createTerminal({
    name: folder.name,
    cwd: folder.uri,
    iconPath: new vscode.ThemeIcon('repo'),
  });
  terminal.show();
}

function deactivate() {}

module.exports = { activate, deactivate };
