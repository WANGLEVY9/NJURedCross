import test from 'node:test';
import assert from 'node:assert/strict';
import {inAcademicYear} from '../lib/events/hours-academic-year.js';

test('actual work dates determine the year even when approval belongs to another year',()=>{
 assert.equal(inAcademicYear('2025-10-31 上午','2026-11-01T00:00:00Z'),false);
 assert.equal(inAcademicYear('2026-10-31 2026-10-31 08:30—11:30','2027-11-01T00:00:00Z'),true);
 assert.equal(inAcademicYear('2026-08-31','2026-11-01T00:00:00Z'),false);
 assert.equal(inAcademicYear('2026-09-01'),true);assert.equal(inAcademicYear('2027-09-01'),false);
 assert.equal(inAcademicYear('日期未提供','2026-11-01T00:00:00Z'),true);
});
