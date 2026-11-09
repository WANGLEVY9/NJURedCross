"""Review candidate for the NJUTable scheduled legacy hours script.

Preview by default. Reconcile existing pending rows before enabling writes.
Run one scheduled instance at a time. This script uses the current Base context.
"""
import hashlib
import json
import math
import re
from collections import Counter
from datetime import datetime

SOURCE = "活动报名总表"
SUMMARY = "活动及时长汇总表"
LOG = "志愿服务平台 脚本运行日志"
PENDING = "待录入"
DONE = "已录入"
APPLY = False


def cell(value):
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value if value is not None else "").strip()


def hours(value):
    if isinstance(value, bool) or not cell(value):
        raise ValueError("时长为空或无效")
    number = float(value)
    if not math.isfinite(number) or not 0 <= number <= 100000:
        raise ValueError("时长无效")
    return number


def source_values(row):
    name, student, activity = (cell(row.get(key)) for key in ("姓名", "学号", "活动名称"))
    if not all((name, student, activity)):
        raise ValueError("缺少姓名、学号或活动名称")
    return name, student, activity, hours(row.get("志愿时长"))


def snapshot_rows(base, table, size=500, max_rows=100000):
    seen = set()
    for offset in range(0, max_rows + 1, size):
        batch = base.list_rows(table, start=offset, limit=size)
        if not isinstance(batch, list) or len(batch) > size or offset + len(batch) > max_rows:
            raise RuntimeError("源表分页结果不完整")
        for row in batch:
            row_id = cell(row.get("_id"))
            if not row_id or row_id in seen:
                raise RuntimeError("源表分页结果包含缺失或重复行 ID")
            seen.add(row_id)
            yield row
        if len(batch) < size:
            return


def find_summary(base, name, student):
    quoted = student.replace("'", "''")
    rows = base.query(
        f"SELECT _id,姓名,学号,活动名称,志愿时长,活动ID FROM `{SUMMARY}` "
        f"WHERE 学号 = '{quoted}' LIMIT 2"
    )
    if not isinstance(rows, list) or len(rows) > 1:
        raise RuntimeError("学号对应多个汇总行或读取失败")
    if not rows:
        return None
    row = rows[0]
    if not row.get("_id") or cell(row.get("姓名")) != name or cell(row.get("学号")) != student:
        raise RuntimeError("汇总身份不一致")
    return row


def summary_snapshot(row):
    if row is None:
        return None
    return tuple(row.get(key) for key in ("_id", "活动名称", "志愿时长", "活动ID"))


def receipt_ids(row):
    return [part.strip() for part in cell((row or {}).get("活动ID")).split(",") if part.strip()]


def post_row(base, row_id, values, *, apply):
    name, student, activity, contribution = values
    if not re.fullmatch(r"[A-Za-z0-9_-]+", row_id):
        raise ValueError("源行 ID 无效")
    prefix = f"LEGACY:{row_id}:"
    digest = hashlib.sha256(json.dumps(values, ensure_ascii=False).encode()).hexdigest()[:16]
    receipt = prefix + digest
    target = find_summary(base, name, student)
    ids = receipt_ids(target)
    recorded = [item for item in ids if item.startswith(prefix)]
    if recorded and recorded != [receipt]:
        raise RuntimeError("源行内容与已入账回执不一致")

    current = base.get_row(SOURCE, row_id)
    if cell(current.get("录入状态")) != PENDING or source_values(current) != values:
        raise RuntimeError("源行已变化")

    if not apply:
        return "待补回状态" if recorded else "可录入"
    if not recorded:
        prior = hours(target.get("志愿时长")) if target and cell(target.get("志愿时长")) else 0
        names = [part.strip() for part in re.split(r"[、；;\n]", cell((target or {}).get("活动名称"))) if part.strip()]
        merged = "、".join(dict.fromkeys([*names, activity]))
        patch = {"志愿时长": round(prior + contribution, 6), "活动名称": merged, "活动ID": ",".join([*ids, receipt])}
        if any(len(patch[key].encode()) > 10000 for key in ("活动名称", "活动ID")):
            raise RuntimeError("汇总活动记录已达到容量上限")
        fresh = find_summary(base, name, student)
        if summary_snapshot(fresh) != summary_snapshot(target):
            raise RuntimeError("汇总行已变化")
        # Credit and source receipt share the same target-row write.
        if target is None:
            base.append_row(SUMMARY, {"姓名": name, "学号": student, **patch})
        else:
            base.update_row(SUMMARY, target["_id"], patch)
        saved = find_summary(base, name, student)
        if saved is None or any(saved.get(key) != value for key, value in patch.items()):
            raise RuntimeError("汇总回读与目标值不一致")

    current = base.get_row(SOURCE, row_id)
    if cell(current.get("录入状态")) != PENDING or source_values(current) != values:
        raise RuntimeError("源行变化，保留已入账回执")
    base.update_row(SOURCE, row_id, {"录入状态": DONE})
    if cell(base.get_row(SOURCE, row_id).get("录入状态")) != DONE:
        raise RuntimeError("录入状态未确认")
    return "已补回状态" if recorded else "已录入"


def sync(base, *, apply=False):
    if not any(col.get("name") == "活动ID" and col.get("type") == "text" for col in base.list_columns(SUMMARY)):
        raise RuntimeError("汇总表缺少活动ID文本列")
    rows = list(snapshot_rows(base, SOURCE))
    counts = Counter()
    blocked = set()
    for row in rows:
        status = cell(row.get("录入状态"))
        if not status and cell(row.get("志愿时长")):
            counts["有时长但未设置录入状态"] += 1
        if status != PENDING:
            continue
        student = cell(row.get("学号"))
        if student in blocked:
            counts["同一学号待核对"] += 1
            continue
        try:
            values = source_values(row)
        except (ValueError, TypeError):
            counts["待补齐字段"] += 1
            continue
        try:
            counts[post_row(base, row["_id"], values, apply=apply)] += 1
        except Exception:
            # The next run checks for a receipt before attempting any increment.
            counts["待核对写入或身份"] += 1
            blocked.add(student)
    return dict(counts)


if __name__ == "__main__":
    from seatable_api import Base, context

    client = Base(context.api_token, context.server_url)
    client.auth()
    result = sync(client, apply=APPLY)
    message = json.dumps({"模式": "写入" if APPLY else "预览", "结果": result}, ensure_ascii=False)
    print(message)
    if APPLY:
        client.append_row(LOG, {"运行时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "表格名称": SUMMARY, "日志内容": message})
