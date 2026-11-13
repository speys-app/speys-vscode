// Speys Tools: small tools for working across many repos.
// Repo switcher: picking a project from the status bar button
//   - moves Source Control's Changes view to that repo (the Graph follows it on "Auto"),
//   - makes VS Code's status bar repo/branch follow the focused repo,
//   - closes the active terminal if empty and opens one in that folder, otherwise opens one beside it,
//   - moves the folder to the bottom of the workspace (except the first folder),
//   - collapses the others in the Explorer and opens that folder.
// Cmd+E opens one list with three tabs: Repo Switcher, Claude Sessions (incl. archived ones) and
//   Shortcuts (pinned commands). Cmd+E again acts like Tab (on the sessions tab); the three icons at the top right and Cmd+1/2/3 jump.
//   Cmd+E inside a Claude panel skips the list and opens the next session. On the sessions tab, Tab opens the session below the highlighted one (Shift+Tab: above).
// Each row has ↑ ↓ (reorder) and ✕ (remove from workspace) buttons, with "Add folder…" at the bottom.
// A folder's git submodules and nested repos get their own rows under it: picking one switches to that repo.
// Add to Claude: Explorer right click adds the selected files to Claude Code's message box as @ references.
// Open in Browser: right click or the 🌐 in the editor title, for .html / .pdf.
// Claude Code CSS: rules from the `claudeCodeCss` setting go into Claude Code's panel, again after its updates.
const { execFile } = require('child_process');
const fs = require('fs');
const vscode = require('vscode');
const path = require('path');
const sessionsLib = require('./sessions');

const t = vscode.l10n.t;
const config = () => vscode.workspace.getConfiguration('speysTools');

// Hidden command VS Code registers per repo for the Repositories menu (ends in "scm<N>").
const TOGGLE = 'workbench.scm.action.toggleRepositoryVisibility.';
const STATE_KEY = 'speysTools.current';
const TAB_KEY = 'speysTools.tab';
const ARCHIVE_KEY = 'speysTools.archived'; // sessions archived from this list

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
    vscode.commands.registerCommand('speysTools.pick', () => pick()),
    vscode.commands.registerCommand('speysTools.sessions', () => pick('sessions')),
    vscode.commands.registerCommand('speysTools.nextClaudeSession', nextSession),
    vscode.commands.registerCommand('speysTools.nextSession', (delta = 1) => openPick?.openNeighbor(delta)),
    vscode.commands.registerCommand('speysTools.tab', (n) => TABS[n - 1] && (openPick ? openPick.show(TABS[n - 1]) : pick(TABS[n - 1]))),
    vscode.commands.registerCommand('speysTools.addToClaude', addToClaude),
    vscode.commands.registerCommand('speysTools.openInBrowser', openInBrowser),
    vscode.window.onDidStartTerminalShellExecution((e) => ranCommand.add(e.terminal)),
    vscode.workspace.onDidChangeWorkspaceFolders(render),
  );

  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('speysTools.claudeCodeCss')) applyClaudeCss();
    }),
  );

  currentUri = ctx.workspaceState.get(STATE_KEY);
  render();
  watchScmSelection();
  setTimeout(applyClaudeCss, 0); // off the activation path: reads a ~0.5 MB file
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

// Repos inside a folder: its cloned git submodules (`.gitmodules` → path), then repos of their
// own one level down (a nested repo the folder's git ignores, like a private data folder).
function submodules(folder) {
  const root = folder.uri.fsPath;
  let text = '';
  try {
    text = fs.readFileSync(path.join(root, '.gitmodules'), 'utf8');
  } catch {}
  const declared = [...text.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((m) => path.join(root, m[1]));
  return [...new Set([...declared, ...subdirs(root)])]
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

let openPick; // the list that is open now: Cmd+E again switches its tab

const TABS = ['repos', 'sessions', 'shortcuts'];
const TAB_NAMES = { repos: () => t('Repo Switcher'), sessions: () => t('Claude Sessions'), shortcuts: () => t('Shortcuts') };

// The three tab buttons at the top right. A button can only hold an icon, so the active tab's
// icon is filled and blue; its own SVGs because a ThemeIcon's color isn't used on a button.
function tabButtons(active) {
  return TABS.map((name) => {
    const icon = (theme) => vscode.Uri.file(path.join(__dirname, 'images', `tab-${name}-${name === active ? 'on' : 'off'}-${theme}.svg`));
    return { id: name, iconPath: { dark: icon('dark'), light: icon('light') }, tooltip: `${TAB_NAMES[name]()} (⌘${TABS.indexOf(name) + 1})` };
  });
}

// ---- shortcuts: commands pinned in the `shortcuts` setting ----

function shortcutList() {
  const list = config().get('shortcuts');
  return Array.isArray(list) ? list.filter((s) => s && typeof s.label === 'string' && typeof s.command === 'string') : [];
}

const saveShortcuts = (list) => config().update('shortcuts', list, vscode.ConfigurationTarget.Global);

// Titles of the commands extensions contribute. Built-in commands have none: they show their id.
function commandTitles() {
  const titles = new Map();
  for (const ext of vscode.extensions.all ?? []) {
    for (const c of ext.packageJSON?.contributes?.commands ?? []) {
      if (typeof c.title !== 'string' || c.title.startsWith('%')) continue;
      titles.set(c.command, typeof c.category === 'string' && !c.category.startsWith('%') ? `${c.category}: ${c.title}` : c.title);
    }
  }
  return titles;
}

// workbench.action.reloadWindow → Reload Window
const prettyCommand = (id) =>
  (id.split('.').pop() ?? id).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

async function addShortcut() {
  const titles = commandTitles();
  const ids = (await vscode.commands.getCommands(true)).filter((id) => !id.startsWith('_')).sort();
  const picked = await vscode.window.showQuickPick(
    ids.map((id) => ({ label: titles.get(id) ?? id, description: titles.has(id) ? id : undefined, id })),
    { placeHolder: t('Command to pin'), matchOnDescription: true },
  );
  if (!picked) return;
  const label = await vscode.window.showInputBox({ prompt: t('Name'), value: titles.get(picked.id) ?? prettyCommand(picked.id) });
  if (!label) return;
  await saveShortcuts([...shortcutList(), { label, command: picked.id }]);
}

const ago = (ms) => {
  const rtf = new Intl.RelativeTimeFormat(vscode.env?.language, { numeric: 'auto', style: 'short' });
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return rtf.format(0, 'second');
  if (min < 60) return rtf.format(-min, 'minute');
  if (min < 60 * 24) return rtf.format(-Math.round(min / 60), 'hour');
  return rtf.format(-Math.round(min / 1440), 'day');
};

// Sessions of the workspace's folders, with Claude Code's archive list. Read on opening the tab only.
async function loadSessions(ctx) {
  const stateDb = path.join(path.dirname(ctx.globalStorageUri.fsPath), 'state.vscdb');
  const hidden = await sessionsLib.archivedIds(stateDb);
  const cwds = folders().map((f) => f.uri.fsPath);
  const list = await sessionsLib.listSessions({ projectsDir: sessionsLib.claudeProjectsDir(), cwds, hidden });
  // Claude Code has no command to archive from outside, so ours is a second list beside its own:
  // a session counts as archived in either. Only ours can be undone from here.
  const ours = new Set(ctx.workspaceState.get(ARCHIVE_KEY) ?? []);
  return list.map((s) => ({ ...s, folder: path.basename(s.cwd), byClaude: s.archived, archived: s.archived || ours.has(s.id) }));
}

// Opens a session in the side panel Claude, replacing the one there (setting `sessionLocation`).
// Claude Code decides the place from its own `claudeCode.preferredLocation`, which is "panel" by
// default, so that is switched to "sidebar" for this one call and put back right after.
let lastOpened; // the session this extension opened last: where "next session" goes on from

async function openSession(id) {
  lastOpened = id;
  const claude = vscode.workspace.getConfiguration('claudeCode');
  const before = claude.get('preferredLocation');
  const swap = config().get('sessionLocation') !== 'editor' && before !== 'sidebar';
  try {
    if (swap) await claude.update('preferredLocation', 'sidebar', vscode.ConfigurationTarget.Global);
    // The last argument makes Claude Code follow its preferred location instead of always using an editor tab.
    await vscode.commands.executeCommand('claude-vscode.editor.open', id, undefined, undefined, undefined, undefined, {
      programmatic: 'honor-preferred-location',
    });
  } catch (err) {
    vscode.window.showWarningMessage(t('Could not open {0}: {1}', id, err?.message ?? err));
  } finally {
    if (swap) await claude.update('preferredLocation', before, vscode.ConfigurationTarget.Global);
  }
}

// Cmd+E inside a Claude panel: straight to the session below the current one, no list. The current one
// is the last session opened from here, or the newest when none was.
async function nextSession() {
  const live = (await loadSessions(context)).filter((s) => !s.archived);
  if (live.length < 2) return vscode.window.setStatusBarMessage(t('No next Claude session'), 2500);
  const i = Math.max(0, live.findIndex((s) => s.id === lastOpened)); // none opened yet: the newest is the current one
  return openSession(live[(i + 1) % live.length].id); // past the last one, back to the top
}

// One list, three tabs. It stays open, so you can still pick after reordering or removing.
async function pick(wanted) {
  // Without a tab asked for, it opens on the one you left it on.
  const saved = context.workspaceState.get(TAB_KEY);
  const tab = wanted ?? (TABS.includes(saved) ? saved : 'repos');
  if (openPick) {
    if (wanted) return openPick.show(wanted);
    return openPick.openNeighbor(1); // Cmd+E again: on the sessions tab the same as Tab, elsewhere nothing
  }
  const BUTTONS = {
    up: { id: 'up', iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: t('Move up') },
    down: { id: 'down', iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: t('Move down') },
    remove: { id: 'remove', iconPath: new vscode.ThemeIcon('close'), tooltip: t("Remove from workspace (files aren't deleted)") },
  };
  const qp = vscode.window.createQuickPick();
  let focusUri;
  let sessions; // loaded the first time the tab opens
  let loading = false;
  let archivedOpen = false; // the archived group starts collapsed

  const refreshRepos = () => {
    const current = currentTarget().uri.toString();
    const all = folders();
    const items = [];
    // QuickPick has no right-aligned text on a row; a separator's label is drawn on the right
    // of the row below it. Left of the row there is little room (`speys › confinaid`).
    const mark = (uri) => {
      if (uri.toString() === current) items.push({ label: t('current'), kind: vscode.QuickPickItemKind.Separator });
    };
    all.forEach((f, i) => {
      mark(f.uri);
      items.push({
        label: `$(repo) ${f.name}`,
        folder: f,
        target: { name: f.name, uri: f.uri, folder: f },
        buttons: [i > 0 && BUTTONS.up, i < all.length - 1 && BUTTONS.down, BUTTONS.remove].filter(Boolean),
      });
      // Submodules sit under their folder; order and removal follow the folder.
      for (const s of submodules(f)) {
        mark(s.uri);
        items.push({
          label: `$(repo) ${f.name} › ${s.name}`,
          target: s,
        });
      }
    });
    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: `$(add) ${t('Add folder…')}`, action: addFolders, alwaysShow: true },
    );
    qp.items = items;
    // After a button: the row it was on. Otherwise the current project.
    const focus =
      items.find((it) => it.folder && it.folder.uri.toString() === focusUri) ??
      items.find((it) => it.target?.uri.toString() === current);
    if (focus) qp.activeItems = [focus];
  };

  const refreshSessions = () => {
    const items = [];
    const several = folders().length > 1;
    const ARCHIVE = { id: 'archive', iconPath: new vscode.ThemeIcon('archive'), tooltip: t('Archive') };
    const UNARCHIVE = { id: 'unarchive', iconPath: new vscode.ThemeIcon('discard'), tooltip: t('Unarchive') };
    const row = (s) => ({
      buttons: s.archived ? (s.byClaude ? [] : [UNARCHIVE]) : [ARCHIVE],
      label: `$(${s.archived ? 'archive' : 'comment-discussion'}) ${s.title ?? t('Untitled')}`,
      description: [ago(s.modified), several ? s.folder : undefined].filter(Boolean).join(' · '),
      sessionId: s.id,
    });
    const live = (sessions ?? []).filter((s) => !s.archived);
    const archived = (sessions ?? []).filter((s) => s.archived);
    items.push(...live.map(row));
    if (archived.length) {
      // A list can't fold: the heading is a row that opens and closes the group. Searching opens it.
      const open = archivedOpen || qp.value.trim() !== '';
      items.push({
        label: `$(${open ? 'chevron-down' : 'chevron-right'}) ${t('Archived sessions ({0})', archived.length)}`,
        toggleArchived: true,
        alwaysShow: !open,
      });
      if (open) items.push(...archived.map(row));
    }
    if (!items.length && !loading) items.push({ label: t('No Claude sessions for these folders'), alwaysShow: true });
    qp.items = items;
  };

  const refreshShortcuts = () => {
    const list = shortcutList();
    const REMOVE = { id: 'remove', iconPath: new vscode.ThemeIcon('close'), tooltip: t('Remove shortcut') };
    const items = list.map((s, i) => ({
      label: `$(zap) ${s.label}`,
      description: s.command,
      shortcutIndex: i,
      shortcut: s,
      buttons: [i > 0 && BUTTONS.up, i < list.length - 1 && BUTTONS.down, REMOVE].filter(Boolean),
    }));
    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: `$(add) ${t('Add shortcut…')}`, action: () => addShortcut().then(() => pick('shortcuts')), alwaysShow: true },
    );
    qp.items = items;
  };

  const show = async (next) => {
    api.tab = next;
    vscode.commands.executeCommand('setContext', 'speysTools.sessionsTab', next === 'sessions');
    context.workspaceState.update(TAB_KEY, next);
    qp.title = `Speys VSCode · ${TAB_NAMES[next]()}`;
    qp.placeholder = { repos: t('Which project?  ↑ ↓ reorder · ✕ remove'), sessions: t('Search sessions…'), shortcuts: t('Run a shortcut') }[next];
    qp.buttons = tabButtons(next);
    qp.value = '';
    if (next === 'repos') return refreshRepos();
    if (next === 'shortcuts') return refreshShortcuts();
    qp.items = [];
    if (!sessions) {
      loading = true;
      qp.busy = true;
      try {
        sessions = await loadSessions(context);
      } finally {
        loading = false;
        qp.busy = false;
      }
    }
    if (api.tab === 'sessions') refreshSessions();
  };
  // Tab / Shift+Tab on the sessions tab: opens the session below / above the highlighted one, no Enter.
  const openNeighbor = (delta) => {
    if (api.tab !== 'sessions') return;
    const rows = qp.items.filter((it) => it.sessionId);
    const at = rows.indexOf(qp.activeItems[0]);
    if (rows.length < 2) return;
    const next = rows[(Math.max(0, at) + delta + rows.length) % rows.length]; // wraps around
    qp.hide();
    return openSession(next.sessionId);
  };
  const api = { tab, show, openNeighbor };
  openPick = api;

  const sub = vscode.workspace.onDidChangeWorkspaceFolders(() => api.tab === 'repos' && refreshRepos());
  qp.onDidTriggerButton((button) => show(button.id));
  const changes = vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('speysTools.shortcuts') && api.tab === 'shortcuts' && refreshShortcuts());
  qp.onDidChangeValue(() => api.tab === 'sessions' && sessions && refreshSessions());
  qp.onDidTriggerItemButton(async ({ item, button }) => {
    if (item.sessionId) {
      const s = sessions.find((x) => x.id === item.sessionId);
      const ours = new Set(context.workspaceState.get(ARCHIVE_KEY) ?? []);
      if (button.id === 'archive') ours.add(s.id);
      else ours.delete(s.id);
      s.archived = button.id === 'archive';
      await context.workspaceState.update(ARCHIVE_KEY, [...ours]);
      return refreshSessions();
    }
    if (item.shortcut) {
      const list = shortcutList();
      const i = item.shortcutIndex;
      if (button.id === 'remove') list.splice(i, 1);
      else {
        const j = button.id === 'up' ? i - 1 : i + 1;
        [list[i], list[j]] = [list[j], list[i]];
      }
      return saveShortcuts(list);
    }
    if (!item.folder) return;
    focusUri = item.folder.uri.toString();
    if (button.id === 'up') await move(item.folder, -1);
    if (button.id === 'down') await move(item.folder, 1);
    if (button.id === 'remove') await remove(item.folder);
  });
  qp.onDidAccept(() => {
    const [choice] = qp.selectedItems;
    if (choice?.toggleArchived) {
      archivedOpen = !archivedOpen;
      refreshSessions();
      return;
    }
    qp.hide();
    if (choice?.target) switchTo(choice.target);
    else if (choice?.sessionId) openSession(choice.sessionId);
    else if (choice?.shortcut) vscode.commands.executeCommand(choice.shortcut.command, ...(choice.shortcut.args ?? []));
    else if (choice?.action) choice.action();
  });
  qp.onDidHide(() => {
    openPick = undefined;
    vscode.commands.executeCommand('setContext', 'speysTools.sessionsTab', false);
    sub.dispose();
    changes.dispose();
    qp.dispose();
  });
  qp.show();
  show(tab);
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

// Root searched for folders to add: the setting, or the folder the workspace lives in
// (`Work/clients/clients.code-workspace` → `Work/clients`; without a workspace file, the
// folder above the first folder). Looking one level higher listed every other project too.
function addRoot() {
  const configured = config().get('addRoot');
  if (configured) return configured.replace(/^~(?=$|\/)/, require('os').homedir());
  const ws = vscode.workspace.workspaceFile;
  if (ws?.scheme === 'file') return path.dirname(ws.fsPath);
  const first = folders()[0];
  return first ? path.dirname(first.uri.fsPath) : undefined;
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

// Everything directly inside `dir` except folders already in the workspace: plain folders first
// (you open those to look inside), then git repos.
function listDir(dir) {
  const open = folders().map((f) => norm(f.uri.fsPath));
  return subdirs(dir)
    .filter((d) => !open.includes(norm(d)))
    .map((d) => ({ dir: d, git: isGit(d), inside: subdirs(d).length > 0 }))
    .sort((a, b) => a.git - b.git || a.dir.localeCompare(b.dir));
}

// Multi-select list of folders. It starts at the root and shows its folders only: the › button on a
// row opens it, ← at the top goes back, and ticks are kept while you move around.
// "Choose another folder…" is a button at the top right, not a row.
async function addFolders() {
  const root = addRoot();
  const qp = vscode.window.createQuickPick();
  qp.canSelectMany = true;
  qp.placeholder = root ? t('Folders to add to the workspace (under {0})', path.basename(root)) : t('Folders to add to the workspace');
  const ENTER = { id: 'enter', iconPath: new vscode.ThemeIcon('chevron-right'), tooltip: t('Open folder') };
  const BACK = { id: 'back', iconPath: new vscode.ThemeIcon('arrow-left'), tooltip: t('Back') };
  const BROWSE = { id: 'browse', iconPath: new vscode.ThemeIcon('folder-opened'), tooltip: t('Choose another folder…') };

  const ticked = new Set(); // folders ticked anywhere
  const trail = []; // folders we came from
  let dir = root;
  let shown = [];
  let swapping = false;

  const show = () => {
    swapping = true; // replacing the rows clears their ticks: not the user's doing
    shown = (dir ? listDir(dir) : []).map(({ dir: d, git, inside }) => ({
      label: `${git ? '$(repo)' : '$(folder)'} ${path.basename(d)}`,
      dir: d,
      buttons: inside ? [ENTER] : [],
    }));
    qp.items = shown;
    qp.selectedItems = shown.filter((it) => ticked.has(it.dir));
    qp.title = dir && dir !== root ? path.relative(root, dir) : undefined;
    qp.buttons = trail.length ? [BACK, BROWSE] : [BROWSE];
    swapping = false;
  };

  // Ticked rows, plus folders chosen in the dialog.
  const uris = await new Promise((resolve) => {
    let done = false;
    let browsing = false; // the dialog opens while the list hides
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
      qp.dispose();
    };
    qp.onDidChangeSelection((picked) => {
      if (swapping) return;
      for (const it of shown) ticked.delete(it.dir);
      for (const it of picked) ticked.add(it.dir);
    });
    qp.onDidTriggerItemButton(({ item }) => {
      trail.push(dir);
      dir = item.dir;
      show();
    });
    qp.onDidAccept(() => finish([...ticked].map((d) => vscode.Uri.file(d))));
    qp.onDidHide(() => browsing || finish([]));
    qp.onDidTriggerButton(async (button) => {
      if (button.id === 'back') {
        dir = trail.pop();
        return show();
      }
      browsing = true;
      const chosen = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: true,
        defaultUri: root ? vscode.Uri.file(root) : undefined,
        openLabel: t('Add to workspace'),
      });
      finish([...ticked].map((d) => vscode.Uri.file(d)).concat(chosen ?? []));
    });
    show();
    qp.show();
  });
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
  const model = await gitModel();
  const find = () => {
    const repos = (model?.repositories ?? []).filter((r) => !r.sourceControl?.isHidden);
    return { repos, target: repos.find((r) => norm(repoRoot(r)) === norm(folder.uri.fsPath)) };
  };
  let { repos, target } = find();
  // Git doesn't find a repo inside a folder its parent ignores: open it, so it shows in
  // Source Control and its files aren't greyed out as the parent's ignored files.
  if (!target && folder.sub) {
    await vscode.commands.executeCommand('git.openRepository', folder.uri.fsPath);
    ({ repos, target } = find());
  }

  const mode = vscode.workspace.getConfiguration('scm').get('repositories.selectionMode');
  if (mode !== 'single' || !target) return;

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

// ---- Claude Code CSS ----

// Claude Code's panel is a webview with no settings for its look. Rules from `claudeCodeCss` are
// appended to its `webview/index.css` between two markers. An update of Claude Code installs a fresh
// copy without them, so this runs on every activation; a file already up to date isn't written.
const CSS_START = '/* speys-tools:claude-code-css start */';
const CSS_END = '/* speys-tools:claude-code-css end */';

// Claude Code's class names end in a hash that changes between versions (`pill_jamplw`). A rule
// can name a class as `{{pill+pillOn}}`: the `pill` class of every CSS module in its `index.js`
// that also has `pillOn`. A module is an object of class names: `{pill:"pill_jamplw",pillOn:"pillOn_jamplw"}`.
const PLACEHOLDER = /\{\{([\w$-]+(?:\+[\w$-]+)*)\}\}/g;
const CSS_MODULE = /\{(?:(?:"[\w$-]+"|[A-Za-z_$][\w$]*):"[\w-]+",?)+\}/g;

function cssModules(js) {
  return [...js.matchAll(CSS_MODULE)].map((m) =>
    Object.fromEntries([...m[0].matchAll(/"?([\w$-]+)"?:"([\w-]+)"/g)].map((p) => [p[1], p[2]])),
  );
}

// Each rule with its placeholders replaced. A placeholder matching several modules repeats the
// rule once per class; one matching none leaves the rule out and is listed in `missing`.
function resolveRules(rules, modules) {
  const out = [];
  const missing = [];
  for (const rule of rules) {
    let copies = [rule];
    for (const [token, spec] of new Set([...rule.matchAll(PLACEHOLDER)].map((m) => [m[0], m[1]]))) {
      const [key, ...with_] = spec.split('+');
      const found = [...new Set(modules.filter((m) => key in m && with_.every((k) => k in m)).map((m) => m[key]))];
      if (!found.length) {
        missing.push(token);
        copies = [];
        break;
      }
      copies = copies.flatMap((c) => found.map((cls) => c.split(token).join(`.${cls}`)));
    }
    out.push(...copies);
  }
  return { rules: out, missing };
}

// The stylesheet with `rules` in our block: an old block is replaced, no rules removes it.
function withClaudeCss(css, rules) {
  const start = css.indexOf(CSS_START);
  const end = css.indexOf(CSS_END);
  const base = start >= 0 && end > start ? (css.slice(0, start) + css.slice(end + CSS_END.length)).trimEnd() + '\n' : css;
  if (!rules.length) return base;
  return `${base.trimEnd()}\n${CSS_START}\n${rules.join('\n')}\n${CSS_END}\n`;
}

async function applyClaudeCss() {
  const ext = vscode.extensions.getExtension('anthropic.claude-code');
  if (!ext) return;
  const dir = path.join(ext.extensionPath, 'webview');
  const file = path.join(dir, 'index.css');
  const setting = config().get('claudeCodeCss');
  let rules = (Array.isArray(setting) ? setting : [setting]).map((r) => String(r ?? '').trim()).filter(Boolean);
  try {
    if (rules.some((r) => r.match(PLACEHOLDER))) {
      const resolved = resolveRules(rules, cssModules(await fs.promises.readFile(path.join(dir, 'index.js'), 'utf8')));
      rules = resolved.rules;
      if (resolved.missing.length) {
        vscode.window.showWarningMessage(t('Not found in Claude Code, so those rules were left out: {0}', resolved.missing.join(', ')));
      }
    }
    const css = await fs.promises.readFile(file, 'utf8');
    const next = withClaudeCss(css, rules);
    if (next === css) return;
    await fs.promises.writeFile(file, next);
  } catch (err) {
    vscode.window.showWarningMessage(t("Could not change Claude Code's stylesheet: {0}", err.message));
    return;
  }
  const reload = t('Reload Window');
  const choice = await vscode.window.showInformationMessage(t("Claude Code's look changed. Reload the window to see it."), reload);
  if (choice === reload) vscode.commands.executeCommand('workbench.action.reloadWindow');
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

module.exports = { activate, deactivate, withClaudeCss, cssModules, resolveRules };
