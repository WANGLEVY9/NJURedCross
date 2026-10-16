import test from 'node:test';
import assert from 'node:assert/strict';
import {migrationCellEqual} from '../lib/events/registration-migration.js';
test('migration accepts only equivalent system creation time precision',()=>{
 assert.equal(migrationCellEqual('2030-01-01T08:00:00+08:00','2030-01-01T08:00:00.563+08:00','ctime'),true);
 assert.equal(migrationCellEqual('2030-01-01T08:00:00+08:00','2030-01-01T08:00:01.563+08:00','ctime'),false);
 assert.equal(migrationCellEqual('2030-01-01T08:00:00.500+08:00','2030-01-01T08:00:00.563+08:00','ctime'),false);
 assert.equal(migrationCellEqual('invalid','other','ctime'),false);
 assert.equal(migrationCellEqual('2030-01-01T08:00:00+08:00','2030-01-01T08:00:00.563+08:00','text'),false);
 assert.equal(migrationCellEqual(0,'0','number'),false);
});
