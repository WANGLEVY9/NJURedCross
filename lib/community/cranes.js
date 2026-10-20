import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** Independent homepage guestbook. No rows or publication states are shared with the message wall. */
export async function openCraneStore(file) {
  if (file !== ':memory:') await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS crane_messages (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, author TEXT NOT NULL,
      actor TEXT NOT NULL, created_at TEXT NOT NULL
    );`);
  const list = db.prepare('SELECT id, content, author FROM crane_messages ORDER BY created_at DESC, rowid DESC LIMIT 12');
  const insert = db.prepare('INSERT INTO crane_messages (id, content, author, actor, created_at) VALUES (?, ?, ?, ?, ?)');
  return {
    list: () => list.all().map(row => ({ ...row })),
    create({ content, author, actor }) {
      const item = { id: randomUUID(), content, author };
      insert.run(item.id, content, author, actor, new Date().toISOString());
      return item;
    },
    close: () => db.close(),
  };
}

/** Authentication, CSRF and rate limiting are enforced by the public API boundary. */
export async function craneRoutes(req, res, url, { store, session, json, readJson, audit }) {
  if (url.pathname !== '/api/public/cranes') return false;
  if (req.method === 'GET') return json(res, 200, { ok: true, items: store.list() });
  if (req.method !== 'POST') throw fail(405, '不支持此寄语操作');
  if (!session) throw fail(401, '请先登录，再写下寄语。');
  const body = await readJson(req);
  if (body.consent !== true) throw fail(400, '请确认寄语与署名将公开展示。');
  const content = String(body.content ?? '').trim();
  const author = String(body.author ?? '').trim() || '一位南大志愿者';
  if (!content || content.length > 200 || author.length > 20) throw fail(400, '请填写 1–200 字寄语，署名不超过 20 字。');
  const item = store.create({ content, author, actor: session.username });
  await audit(req, session, 'cranes.submit', item.id, 'success', {});
  return json(res, 201, { ok: true, item, items: store.list(), message: '寄语已送出，已经化作纸鹤出现在首页。' });
}
