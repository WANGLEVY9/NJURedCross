import { patchQuery } from '../core/router.js';

export function tableStateOptions({
  prefix,
  sortKeys,
  defaultSort = null,
  clearTargets = [],
}) {
  const query = new URLSearchParams(location.search);
  const savedKey = query.get(`${prefix}Sort`);
  const savedDirection = query.get(`${prefix}Direction`);

  const isValidSort = (sort) =>
    sort &&
    sortKeys.includes(sort.key) &&
    ['asc', 'desc'].includes(sort.direction);

  const savedSort = {
    key: savedKey,
    direction: savedDirection,
  };

  return {
    initialQuery: query.get(`${prefix}Query`) || '',
    initialSort: isValidSort(savedSort) ? savedSort : defaultSort,
    onStateChange(state) {
      const sort = isValidSort(state.sort) ? state.sort : null;
      const changes = {
        [`${prefix}Query`]: state.query,
        [`${prefix}Sort`]: sort?.key || null,
        [`${prefix}Direction`]: sort?.direction || null,
      };

      for (const key of clearTargets) changes[key] = null;
      patchQuery(changes);
    },
  };
}