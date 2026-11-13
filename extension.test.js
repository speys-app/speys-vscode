const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } = require('node:fs');
const Module = require('node:module');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

const read = (file) => readFileSync(join(__dirname, file), 'utf8');
const json = (file) => JSON.parse(read(file));
const pkg = json('package.json');

// Just enough of the `vscode` module to activate the extension without VS Code.
function loadWithStub(root = join(__dirname, 'app')) {
  const registered = [];
  const commands = {};
  const event = () => ({ dispose() {} });
  const statusBar = { show() {}, hide() {}, dispose() {} };
  const meter = { show() {}, hide() {}, dispose() {} };
  const warnings = [];
  const views = {};
  const executed = [];
  const settings = Object.fromEntries(
    Object.entries(pkg.contributes.configuration.properties).map(([k, v]) => [k.replace('speysTools.', ''), v.default]),
  );
  const claudeSettings = { preferredLocation: 'panel' };
  const updates = [];
  const folder = { name: 'app', index: 0, uri: { fsPath: root, toString: () => 'file:///app' } };
  const quickPick = {
    show() {},
    hide() {},
    dispose() {},
    onDidTriggerItemButton: event,
    onDidTriggerButton: event,
    onDidChangeSelection: event,
    onDidChangeValue: event,
    value: '',
    onDidAccept: event,
    onDidHide: event,
  };
  const vscode = {
    ConfigurationTarget: { Global: 1 },
    StatusBarAlignment: { Left: 1 },
    QuickPickItemKind: { Separator: -1 },
    ThemeIcon: class {
      constructor(id, color) {
        this.id = id;
        this.color = color;
      }
    },
    EventEmitter: class {
      event = () => ({ dispose() {} });
      fire() {}
    },
    TreeItem: class {
      constructor(label) {
        this.label = label;
      }
    },
    ThemeColor: class {
      constructor(id) {
        this.id = id;
      }
    },
    Uri: { file: (fsPath) => ({ fsPath, toString: () => `file://${fsPath}` }) },
    l10n: { t: (text, ...args) => text.replace(/\{(\d+)\}/g, (m, i) => (i < args.length ? String(args[i]) : m)) },
    commands: {
      registerCommand: (id, run) => (registered.push(id), (commands[id] = run), { dispose() {} }),
      executeCommand: async (id) => executed.push(id),
    },
    extensions: { getExtension: () => undefined },
    window: {
      activeTextEditor: undefined,
      createStatusBarItem: (id) => (id === 'speysTools' ? statusBar : meter),
      showWarningMessage: async (message) => (warnings.push(message), undefined),
      createTreeView: (id, { treeDataProvider }) => ((views[id] = treeDataProvider), { dispose() {} }),
      createQuickPick: () => quickPick,
      setStatusBarMessage() {},
      onDidStartTerminalShellExecution: event,
    },
    workspace: {
      workspaceFolders: [folder],
      onDidChangeWorkspaceFolders: event,
      onDidChangeConfiguration: event,
      getConfiguration: (section) => ({
        get: (key) => (section === 'claudeCode' ? claudeSettings[key] : settings[key]),
        update: async (key, value) => (claudeSettings[key] = value, updates.push([key, value])),
      }),
    },
  };
  const load = Module._load;
  Module._load = (request, ...rest) => (request === 'vscode' ? vscode : load(request, ...rest));
  delete require.cache[require.resolve('./extension.js')];
  try {
    return { extension: require('./extension.js'), registered, commands, statusBar, meter, quickPick, warnings, executed, views, updates, claudeSettings };
  } finally {
    Module._load = load;
  }
}

test('activates and registers every command in package.json', () => {
  const { extension, registered, statusBar } = loadWithStub();
  extension.activate({ subscriptions: [], workspaceState: { get() {}, update() {} } });
  assert.deepEqual(registered.sort(), pkg.contributes.commands.map((c) => c.command).sort());
  assert.equal(statusBar.text, '$(repo) app');
  assert.ok(statusBar.tooltip);
});

test('a submodule row shows its parent folder and the current row is active', async () => {
  const root = mkdtempSync(join(tmpdir(), 'speys-tools-'));
  try {
    writeFileSync(join(root, '.gitmodules'), '[submodule "games"]\n\tpath = games\n');
    mkdirSync(join(root, 'games', '.git'), { recursive: true });
    const { extension, commands, quickPick } = loadWithStub(root);
    const selected = `file://${join(root, 'games')}`;
    extension.activate({ subscriptions: [], workspaceState: { get: () => selected, update() {} } });
    await commands['speysTools.pick']();
    const i = quickPick.items.findIndex((it) => it.target?.sub);
    const row = quickPick.items[i];
    assert.equal(row.label, '$(repo) app › games');
    // "current" sits on the right: the label of the separator right above the row.
    assert.equal(quickPick.items[i - 1].label, 'current');
    assert.equal(quickPick.items[i - 1].kind, -1);
    assert.deepEqual(quickPick.activeItems, [row]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a nested repo one level down gets a row, plain folders and node_modules do not', async () => {
  const root = mkdtempSync(join(tmpdir(), 'speys-tools-'));
  try {
    mkdirSync(join(root, 'data', '.git'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg', '.git'), { recursive: true });
    mkdirSync(join(root, 'node_modules', '.git'), { recursive: true });
    const { extension, commands, quickPick } = loadWithStub(root);
    extension.activate({ subscriptions: [], workspaceState: { get() {}, update() {} } });
    await commands['speysTools.pick']();
    const rows = quickPick.items.filter((it) => it.target?.sub).map((it) => it.label);
    assert.deepEqual(rows, ['$(repo) app › data']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('settings the code reads exist in package.json', () => {
  const declared = Object.keys(pkg.contributes.configuration.properties);
  for (const [, key] of read('extension.js').matchAll(/config\(\)\.get\('(\w+)'\)/g)) {
    assert.ok(declared.includes(`speysTools.${key}`), key);
  }
});

test('every interface text has a Turkish translation', () => {
  const tr = json('l10n/bundle.l10n.tr.json');
  const used = [...read('extension.js').matchAll(/\bt\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2].replace(/\\(.)/g, '$1'));
  assert.ok(used.length > 0);
  for (const text of used) assert.ok(text in tr, text);
  for (const text of Object.keys(tr)) assert.ok(used.includes(text), `unused translation: ${text}`);
});

test('package.json placeholders are defined in both languages', () => {
  const keys = [...read('package.json').matchAll(/"%([\w.]+)%"/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(json('package.nls.json')).sort(), keys);
  assert.deepEqual(Object.keys(json('package.nls.tr.json')).sort(), keys);
});

test('Claude Code CSS goes in one block that is replaced, not repeated, and removed with no rules', () => {
  const { extension } = loadWithStub();
  const css = '.a{color:red}\n';
  const once = extension.withClaudeCss(css, ['.b{display:none}']);
  assert.match(once, /^\.a\{color:red\}\n\/\* speys-tools:claude-code-css start \*\/\n\.b\{display:none\}\n/);
  assert.equal(extension.withClaudeCss(once, ['.b{display:none}']), once);
  const changed = extension.withClaudeCss(once, ['.c{display:none}', ' ']);
  assert.ok(!changed.includes('.b{') && changed.includes('.c{display:none}'));
  assert.equal(changed.match(/claude-code-css start/g).length, 1);
  assert.equal(extension.withClaudeCss(changed, []), css);
});

test('Claude Code CSS placeholders become the class names of its current version', () => {
  const { extension } = loadWithStub();
  const js = 'var a={pill:"pill_jamplw",pillOn:"pillOn_jamplw"},b={pill:"pill_lcdCYQ",icon:"icon_lcdCYQ"},' +
    'c={"vscode-reduce-motion":"vscode-reduce-motion_cK",inputContainer:"inputContainer_cK"},d={inputContainer:"inputContainer_UC"};';
  const { rules, missing } = extension.resolveRules(
    ['{{pill+pillOn}} span{display:none}', '{{inputContainer}}:focus-within{border:0}', '{{gone}}{color:red}', 'p{margin:0}'],
    extension.cssModules(js),
  );
  assert.deepEqual(rules, [
    '.pill_jamplw span{display:none}',
    '.inputContainer_cK:focus-within{border:0}',
    '.inputContainer_UC:focus-within{border:0}',
    'p{margin:0}',
  ]);
  assert.deepEqual(missing, ['{{gone}}']);
});

test('Cmd+E opens the Repo Switcher tab first, with three tab buttons', async () => {
  const { extension, commands, quickPick } = loadWithStub();
  extension.activate({ subscriptions: [], workspaceState: { get() {}, update() {} } });
  await commands['speysTools.pick']();
  assert.equal(quickPick.title, 'Speys VSCode · Repo Switcher');
  // Three tab buttons; the active tab's icon is the "on" one.
  assert.deepEqual(quickPick.buttons.map((b) => b.id), ['repos', 'sessions', 'shortcuts']);
  assert.match(quickPick.buttons[0].iconPath.dark.fsPath, /tab-repos-on-dark\.svg$/);
  assert.match(quickPick.buttons[1].iconPath.dark.fsPath, /tab-sessions-off-dark\.svg$/);
  assert.ok(pkg.contributes.commands.some((c) => c.command === 'speysTools.sessions'));
});

test('"Choose another folder…" is a button, not a row', async () => {
  const { extension, commands, quickPick } = loadWithStub();
  extension.activate({ subscriptions: [], workspaceState: { get() {}, update() {} } });
  await commands['speysTools.pick']();
  const add = quickPick.items.find((it) => it.action);
  add.action();
  assert.equal(quickPick.buttons.at(-1).tooltip, 'Choose another folder…');
  assert.ok(!quickPick.items.some((it) => /Choose another/.test(it.label)));
});

test('Add folder starts with the root\'s folders, each with a button to open it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'speys-tools-'));
  try {
    const app = join(root, 'app');
    mkdirSync(join(app, '.git'), { recursive: true });
    mkdirSync(join(root, 'customers', 'shop', '.git'), { recursive: true });
    mkdirSync(join(root, 'empty'));
    const { extension, commands, quickPick } = loadWithStub(app);
    extension.activate({ subscriptions: [], workspaceState: { get() {}, update() {} } });
    await commands['speysTools.pick']();
    quickPick.items.find((it) => it.action).action();
    // The workspace folder itself is left out; plain folders come first.
    assert.deepEqual(quickPick.items.map((it) => it.label), ['$(folder) customers', '$(folder) empty']);
    assert.equal(quickPick.items[0].buttons[0].tooltip, 'Open folder');
    assert.equal(quickPick.items[1].buttons.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Cmd+E opens on the tab you left it on, and archived sessions start collapsed', async () => {
  const state = { 'speysTools.tab': 'sessions' };
  const { extension, commands, quickPick } = loadWithStub();
  extension.activate({
    subscriptions: [],
    workspaceState: { get: (k) => state[k], update: (k, v) => (state[k] = v) },
    globalStorageUri: { fsPath: join(tmpdir(), 'speys-none', 'speys.tools') },
  });
  await commands['speysTools.pick']();
  assert.match(quickPick.buttons[1].iconPath.dark.fsPath, /tab-sessions-on-dark\.svg$/);
  assert.equal(state['speysTools.tab'], 'sessions');
});

test('the Shortcuts tab lists the pinned commands and runs one', async () => {
  const { extension, commands, quickPick, executed } = loadWithStub();
  extension.activate({ subscriptions: [], workspaceState: { get() {}, update() {} } });
  await commands['speysTools.tab'](3); // nothing open yet: opens the list on that tab
  assert.match(quickPick.buttons[2].iconPath.dark.fsPath, /tab-shortcuts-on-dark\.svg$/);
  await commands['speysTools.tab'](1); // open: switches
  assert.match(quickPick.buttons[0].iconPath.dark.fsPath, /tab-repos-on-dark\.svg$/);
  await commands['speysTools.tab'](3);
  const rows = quickPick.items.filter((it) => it.shortcut);
  assert.deepEqual(rows.map((r) => r.shortcut.command), pkg.contributes.configuration.properties['speysTools.shortcuts'].default.map((s) => s.command));
  assert.deepEqual(rows[0].buttons.map((b) => b.id), ['down', 'remove']);
  assert.ok(quickPick.items.some((it) => it.action));
  assert.match(quickPick.buttons[2].iconPath.dark.fsPath, /tab-shortcuts-on-dark\.svg$/);
  void executed;
});

test('every tab icon exists in both states and themes', () => {
  for (const name of ['repos', 'sessions', 'shortcuts'])
    for (const state of ['on', 'off'])
      for (const theme of ['dark', 'light']) assert.ok(read(`images/tab-${name}-${state}-${theme}.svg`).startsWith('<svg'));
});

test('Tab on the sessions tab opens the session below the highlighted one', async () => {
  const { extension, commands, quickPick, executed, updates, claudeSettings } = loadWithStub();
  extension.activate({ subscriptions: [], workspaceState: { get: (k) => (k === 'speysTools.tab' ? 'sessions' : undefined), update() {} } , globalStorageUri: { fsPath: join(tmpdir(), 'speys-none', 'x') } });
  await commands['speysTools.pick']();
  const a = { sessionId: 'a' };
  const b = { sessionId: 'b' };
  quickPick.items = [a, { toggleArchived: true }, b];
  quickPick.activeItems = [a];
  await commands['speysTools.nextSession'](1);
  assert.ok(executed.includes('claude-vscode.editor.open'));
  // Claude Code's location is "sidebar" only while the session opens, then put back.
  assert.deepEqual(updates, [['preferredLocation', 'sidebar'], ['preferredLocation', 'panel']]);
  assert.equal(claudeSettings.preferredLocation, 'panel');
  assert.ok(pkg.contributes.keybindings.some((k) => k.key === 'tab' && /speysTools\.sessionsTab/.test(k.when)));
});

test('Cmd+E: in a Claude panel it goes to the next session, with the list open it does not switch tabs', async () => {
  const kb = pkg.contributes.keybindings;
  const claude = kb.find((k) => k.command === 'speysTools.nextClaudeSession');
  assert.equal(claude.mac, 'cmd+e');
  assert.match(claude.when, /claudeVSCodePanel/);
  assert.match(kb.find((k) => k.command === 'speysTools.pick').when, /claudeVSCodePanel/);

  const { extension, commands, quickPick } = loadWithStub();
  extension.activate({ subscriptions: [], workspaceState: { get() {}, update() {} } });
  await commands['speysTools.pick']();
  const before = quickPick.buttons[0].iconPath.dark.fsPath;
  await commands['speysTools.pick'](); // Cmd+E again on the repos tab
  assert.equal(quickPick.buttons[0].iconPath.dark.fsPath, before);
});

test('Tab past the last session goes back to the top, Shift+Tab past the first goes to the bottom', async () => {
  const { extension, commands, quickPick, executed } = loadWithStub();
  extension.activate({ subscriptions: [], workspaceState: { get: (k) => (k === 'speysTools.tab' ? 'sessions' : undefined), update() {} }, globalStorageUri: { fsPath: join(tmpdir(), 'speys-none', 'x') } });
  await commands['speysTools.pick']();
  const rows = [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'c' }];
  quickPick.items = rows;
  const opened = [];
  const run = commands['speysTools.nextSession'];
  quickPick.activeItems = [rows[2]];
  await run(1);
  quickPick.activeItems = [rows[0]];
  await run(-1);
  assert.equal(executed.filter((id) => id === 'claude-vscode.editor.open').length, 2);
  void opened;
});
