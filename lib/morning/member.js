import {
  MORNING_CARD_TABLE,
  isActiveMorningCardStatus,
} from './shared.js';
import { toMorningCardView } from './api.js';

export async function readMorningMemberCard({ client, accountId, listRows, assertCompleteRows }) {
  const rows = await listRows(client, MORNING_CARD_TABLE);
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
