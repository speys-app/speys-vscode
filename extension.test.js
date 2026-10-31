const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const { join } = require('node:path');
const { test } = require('node:test');

const read = (file) => readFileSync(join(__dirname, file), 'utf8');
const json = (file) => JSON.parse(read(file));
const pkg = json('package.json');

// Just enough of the `vscode` module to activate the extension without VS Code.
function loadWithStub() {
  const registered = [];
  const event = () => ({ dispose() {} });
  const statusBar = { show() {}, hide() {}, dispose() {} };
  const folder = { name: 'app', index: 0, uri: { fsPath: join(__dirname, 'app'), toString: () => 'file:///app' } };
  const vscode = {
    StatusBarAlignment: { Left: 1 },
    l10n: { t: (text) => text },
    commands: { registerCommand: (id) => (registered.push(id), { dispose() {} }) },
    extensions: { getExtension: () => undefined },
    window: {
      activeTextEditor: undefined,
      createStatusBarItem: () => statusBar,
      onDidStartTerminalShellExecution: event,
    },
    workspace: { workspaceFolders: [folder], onDidChangeWorkspaceFolders: event },
  };
  const load = Module._load;
  Module._load = (request, ...rest) => (request === 'vscode' ? vscode : load(request, ...rest));
  try {
    return { extension: require('./extension.js'), registered, statusBar };
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
