const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { listSessions, projectDirName, titleFrom } = require('./sessions');

const line = (o) => `${JSON.stringify(o)}\n`;

test('a project folder is named after its path', () => {
  assert.equal(projectDirName('/Users/a/Speys Ltd./speys-local'), '-Users-a-Speys-Ltd--speys-local');
});

test('your own name wins over the generated title, which wins over the last message', () => {
  const generated = line({ type: 'ai-title', aiTitle: 'Generated' });
  const prompt = line({ type: 'last-prompt', lastPrompt: 'last message' });
  assert.equal(titleFrom(prompt), 'last message');
  assert.equal(titleFrom(prompt + generated), 'Generated');
  assert.equal(titleFrom(prompt + generated + line({ type: 'custom-title', customTitle: 'Mine' }) + generated), 'Mine');
  assert.equal(titleFrom('{"type":"user","message":{}}\n'), undefined);
});

test('sessions come newest first, with archived ones marked, from the end of big files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'speys-sessions-'));
  try {
    const cwd = '/work/app';
    const dir = join(root, projectDirName(cwd));
    mkdirSync(dir);
    writeFileSync(join(dir, 'old.jsonl'), line({ type: 'ai-title', aiTitle: 'Old one' }));
    writeFileSync(join(dir, 'new.jsonl'), 'x'.repeat(200 * 1024) + '\n' + line({ type: 'ai-title', aiTitle: 'New one' }));
    writeFileSync(join(dir, 'notes.txt'), 'not a session');
    utimesSync(join(dir, 'old.jsonl'), 1000, 1000);
    const list = await listSessions({ projectsDir: root, cwds: [cwd, '/work/missing'], hidden: new Set(['old']) });
    assert.deepEqual(
      list.map((s) => [s.id, s.title, s.archived]),
      [['new', 'New one', false], ['old', 'Old one', true]],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
