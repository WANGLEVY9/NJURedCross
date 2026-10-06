export function materialApplicationPlan({
  application,
  operation,
  quantity,
  lossQuantity,
  note,
  photoPath,
  date,
}) {
  let after;

  if (operation === '出库') {
    after = {
      状态: '借出（物资）',
      实际借用日期: date,
    };
  } else if (operation === '归还') {
    const borrowed = Number(application['借用件数']);
    const previouslyReturned = Number(application['归还件数'] || 0);

    if (
      !Number.isSafeInteger(borrowed) || borrowed <= 0
      || !Number.isSafeInteger(previouslyReturned)
      || previouslyReturned < 0
    ) {
      throw Object.assign(new Error('申请数量不合法，请先核对。'), {
        statusCode: 409,
        code: 'invalid_application_quantity',
      });
    }

    const physicalReturned = previouslyReturned + quantity;
    const full = physicalReturned + lossQuantity >= borrowed;
    const hasDamage = lossQuantity > 0 || Boolean(note.trim());

    after = {
      归还件数: physicalReturned,
      归还状态: full && !hasDamage ? '已全部归还' : '物品缺失/数量减少',
      ...(full ? { 实际归还日期: date, 状态: '已归还' } : {}),
    };
  } else {
    throw new Error('Unsupported application operation');
  }

  if (photoPath) {
    const column = operation === '出库' ? '物资出库照片' : '物资归还照片';
    const photos = Array.isArray(application[column])
      ? application[column]
      : [];
    after[column] = [...photos, photoPath];
  }

  const watched = new Set([
    ...Object.keys(after),
    '状态',
    '借出审批',
    '借用件数',
    '归还件数',
  ]);
  const before = Object.fromEntries(
    [...watched].map(key => [key, application[key] ?? null]),
  );

  return { before, after };
}