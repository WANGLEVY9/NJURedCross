/**
 * Fixed-framework rendering for event registration notices.
 *
 * PLACEHOLDER — the implementation belongs to the events workstream.
 * Contract: .workbuddy/parallel-contract.md §3
 */
export const NOTICE_TABLE = '活动通知表';
export const NOTICE_COLUMNS = [];

/** Pure function: never touches I/O. */
export function renderRegistrationNotice() {
  return { title: '', body: '', sections: [], missing: [] };
}
