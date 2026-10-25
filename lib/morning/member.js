import { readCommunityRows } from '../community/scoped-rows.js';
import {
  MORNING_CARD_TABLE,
  isActiveMorningCardStatus,
} from './shared.js';
import { toMorningCardView } from './api.js';

export async function readMorningMemberCard({ client, accountId, listRows, assertCompleteRows }) {
  const rows = await readCommunityRows(client, MORNING_CARD_TABLE, { 账号ID: accountId }, listRows);
  assertCompleteRows(rows);
  const row = rows.find((item) => String(item['账号ID'] || '') === accountId
    && isActiveMorningCardStatus(item['审核状态']));
  return row ? toMorningCardView(row) : null;
}

export function projectMorningMemberCard(rows, accountId, assertCompleteRows = () => {}) {
  assertCompleteRows(rows);
  const row = rows.find((item) => String(item['账号ID'] || '') === accountId
    && isActiveMorningCardStatus(item['审核状态']));
  return row ? toMorningCardView(row) : null;
}
