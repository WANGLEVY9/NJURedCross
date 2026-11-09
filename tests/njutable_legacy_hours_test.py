import copy
import unittest

from ops.njutable.volunteer_hours_sync import SOURCE, SUMMARY, sync


class SyntheticBase:
    def __init__(self, rows):
        self.rows = {SOURCE: rows, SUMMARY: []}
        self.lost_response = None
        self.writes = 0

    def list_columns(self, table):
        return [{"name": "活动ID", "type": "text"}]

    def list_rows(self, table, *, start, limit):
        return copy.deepcopy(self.rows[table][start:start + limit])

    def query(self, sql):
        assert f"FROM `{SUMMARY}`" in sql and "学号 = '000001'" in sql
        return copy.deepcopy(self.rows[SUMMARY][:2])

    def get_row(self, table, row_id):
        return copy.deepcopy(next(row for row in self.rows[table] if row["_id"] == row_id))

    def append_row(self, table, row):
        self.rows[table].append({**row, "_id": "summary"})
        self.write_result(table)

    def update_row(self, table, row_id, patch):
        next(row for row in self.rows[table] if row["_id"] == row_id).update(patch)
        self.write_result(table)

    def write_result(self, table):
        self.writes += 1
        if self.lost_response == table:
            self.lost_response = None
            raise TimeoutError("synthetic lost response")


def signup(row_id, hours, status="待录入"):
    return {"_id": row_id, "姓名": "合成同学", "学号": "000001", "活动名称": "同名活动",
            "志愿时长": hours, "录入状态": status}


class LegacyHoursTest(unittest.TestCase):
    def test_explicit_manual_rows_with_same_name_each_post_once(self):
        base = SyntheticBase([signup("morning", 3), signup("afternoon", 2), signup("draft", 4, "")])
        self.assertEqual(sync(base), {"可录入": 2, "有时长但未设置录入状态": 1})
        self.assertEqual(base.writes, 0)
        self.assertEqual(sync(base, apply=True)["已录入"], 2)
        sync(base, apply=True)
        self.assertEqual(base.rows[SUMMARY][0]["志愿时长"], 5)
        self.assertEqual(base.rows[SUMMARY][0]["活动名称"], "同名活动")
        self.assertEqual(base.rows[SOURCE][2]["录入状态"], "")

    def test_lost_summary_response_recovers_without_adding_again(self):
        base = SyntheticBase([signup("morning", 3), signup("afternoon", 2)])
        base.lost_response = SUMMARY
        sync(base, apply=True)
        self.assertEqual(base.rows[SOURCE][0]["录入状态"], "待录入")
        self.assertEqual(sync(base, apply=True)["已补回状态"], 1)
        self.assertEqual(base.rows[SUMMARY][0]["志愿时长"], 5)

    def test_changed_manual_row_after_partial_success_is_left_pending(self):
        base = SyntheticBase([signup("manual", 3)])
        base.lost_response = SUMMARY
        sync(base, apply=True)
        base.rows[SOURCE][0]["志愿时长"] = 4
        self.assertEqual(sync(base, apply=True)["待核对写入或身份"], 1)
        self.assertEqual(base.rows[SUMMARY][0]["志愿时长"], 3)
        self.assertEqual(base.rows[SOURCE][0]["录入状态"], "待录入")

    def test_keeps_website_ids_and_rejects_ambiguous_target(self):
        base = SyntheticBase([signup("manual", 2)])
        row = {"_id": "existing", "姓名": "合成同学", "学号": "000001",
               "活动名称": "旧记录", "志愿时长": 3.125, "活动ID": "PS-website"}
        base.rows[SUMMARY].extend([row, {**row, "_id": "duplicate"}])
        self.assertEqual(sync(base, apply=True)["待核对写入或身份"], 1)
        self.assertEqual(base.writes, 0)
        base.rows[SUMMARY].pop()
        sync(base, apply=True)
        self.assertEqual(row["志愿时长"], 5.125)
        self.assertTrue(row["活动ID"].startswith("PS-website,LEGACY:manual:"))
