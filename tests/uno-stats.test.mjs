/* 战绩名次维度：用临时 JSON 文件隔离，不污染 data/uno-stats.json。 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'uno-stats-'));
const file = join(dir, 'stats.json');
// 先写一份「旧版」战绩文件，验证读入时补齐名次字段（向后兼容）。
writeFileSync(file, JSON.stringify({ legacy: { games: 3, wins: 1, best: 88 } }));
process.env.UNO_STATS_FILE = file;
const { recordResult, statsFor } = await import('../lib/games/uno-stats-sink.js');

after(() => rmSync(dir, { recursive: true, force: true }));

const seats = [{ userId: 'u0' }, { userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }];

test('读入旧版战绩文件时补齐名次字段，不产生 undefined', () => {
  const rec = statsFor('legacy');
  assert.equal(rec.games, 3);
  assert.equal(rec.wins, 1);
  assert.equal(rec.best, 88);
  assert.equal(rec.lastRank, null);
  assert.equal(rec.lastPlaces, 0);
  assert.deepEqual(rec.ranks, {});
});

test('淘汰制一局：按名次记录冠军 / 垫底 / 各名次次数 / 规则', () => {
  recordResult(seats, 2, [10, 20, 30, 40], {
    ranking: [2, 0, 3, 1], winCondition: 'elimination', loser: 1,
  });
  const champ = statsFor('u2');
  assert.equal(champ.games, 1);
  assert.equal(champ.wins, 1);
  assert.equal(champ.lastRank, 1);
  assert.equal(champ.bestRank, 1);
  assert.equal(champ.ranks['1'], 1);
  assert.equal(champ.lastPlaces, 0);
  assert.equal(champ.lastRule, 'elimination');
  assert.equal(champ.best, 30, '峰值沿用累计分');

  const last = statsFor('u1');
  assert.equal(last.wins, 0);
  assert.equal(last.lastRank, 4);
  assert.equal(last.bestRank, 4);
  assert.equal(last.ranks['4'], 1);
  assert.equal(last.lastPlaces, 1);
});

test('再打一局：games 累加、bestRank 取历史最好、lastRank 更新为最新一局', () => {
  recordResult(seats, 0, [55, 5, 5, 5], {
    ranking: [0, 3, 1, 2], winCondition: 'first',
  });
  const u2 = statsFor('u2'); // 第一局冠军，第二局垫底
  assert.equal(u2.games, 2);
  assert.equal(u2.wins, 1, '胜场不因本局垫底回退');
  assert.equal(u2.lastRank, 4);
  assert.equal(u2.bestRank, 1, '最佳名次保留历史最好成绩');
  assert.equal(u2.ranks['1'], 1);
  assert.equal(u2.ranks['4'], 1);
  assert.equal(u2.lastPlaces, 1);
  assert.equal(u2.lastRule, 'first');

  const u0 = statsFor('u0');
  assert.equal(u0.wins, 1);
  assert.equal(u0.lastRank, 1);
  assert.equal(u0.bestRank, 1);
});

test('匿名席位不入库；statsFor(null) 为空；本地 JSON 确实落盘', () => {
  assert.equal(statsFor(null), null);
  assert.equal(statsFor('anonymous'), null);
  assert.equal(existsSync(file), true);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(raw.u2.games, 2);
  assert.equal(raw.legacy.games, 3, '旧记录读入后仍保留');
  assert.equal(raw.u2.lastRank, 4);
});
