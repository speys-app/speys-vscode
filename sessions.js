// Claude Code sessions for the "Claude Sessions" tab.
// Sessions are `~/.claude/projects/<project>/<id>.jsonl`; the archive list lives in Claude Code's
// own VS Code state (`hiddenSessionIds` in state.vscdb), read through the `sqlite3` command.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TAIL = 64 * 1024; // titles are appended all through a transcript (some are 100 MB+): read the end only
const STATE_KEY = 'Anthropic.claude-code';

// Claude Code names a project folder after its path: every other character becomes "-".
const projectDirName = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

async function readTail(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size: length } = await handle.stat();
    const start = Math.max(0, length - TAIL);
    const buffer = Buffer.alloc(length - start);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

const clip = (text, max = 90) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

// Your own name for a session wins, then Claude's generated title, then your last message.
function titleFrom(text) {
  let custom;
  let generated;
  let prompt;
  for (const line of text.split('\n')) {
    if (!line.startsWith('{"type":"')) continue;
    try {
      if (line.startsWith('{"type":"custom-title"')) custom = JSON.parse(line).customTitle || custom;
      else if (line.startsWith('{"type":"ai-title"')) generated = JSON.parse(line).aiTitle || generated;
      else if (line.startsWith('{"type":"last-prompt"')) prompt = JSON.parse(line).lastPrompt || prompt;
    } catch {
      // a line cut in half at the start of the chunk
    }
  }
  const title = custom ?? generated ?? prompt;
  return title ? clip(title) : undefined;
}

// Sessions of the given project folders, newest first. `hidden` is the set of archived ids.
async function listSessions({ projectsDir, cwds, hidden = new Set() }) {
  const out = [];
  await Promise.all(
    cwds.map(async (cwd) => {
      const dir = path.join(projectsDir, projectDirName(cwd));
      let names;
      try {
        names = await fs.promises.readdir(dir);
      } catch {
        return;
      }
      await Promise.all(
        names
          .filter((n) => n.endsWith('.jsonl'))
          .map(async (n) => {
            const file = path.join(dir, n);
            try {
              const { mtimeMs } = await fs.promises.stat(file);
              const id = n.slice(0, -'.jsonl'.length);
              out.push({ id, cwd, title: titleFrom(await readTail(file)), modified: mtimeMs, archived: hidden.has(id) });
            } catch {
              // deleted while listing
            }
          }),
      );
    }),
  );
  return out.sort((a, b) => b.modified - a.modified);
}

// Ids Claude Code has archived. Empty when the state file or the sqlite3 command isn't there
// (Windows has no sqlite3): then nothing is shown as archived.
function archivedIds(stateDb) {
  return new Promise((resolve) => {
    execFile(
      'sqlite3',
      ['-readonly', stateDb, `select value from ItemTable where key='${STATE_KEY}'`],
      { maxBuffer: 16 * 1024 * 1024, timeout: 3000 },
      (err, stdout) => {
        if (err) return resolve(new Set());
        try {
          resolve(new Set(JSON.parse(stdout).hiddenSessionIds ?? []));
        } catch {
          resolve(new Set());
        }
      },
    );
  });
}

const claudeProjectsDir = () => path.join(os.homedir(), '.claude', 'projects');

module.exports = { projectDirName, titleFrom, listSessions, archivedIds, claudeProjectsDir };
