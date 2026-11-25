/** Shared roster/export values. Never infer identity from name alone. */
export const REGISTRATION_EXPORT_COLUMNS=Object.freeze(['姓名','学号','邮箱','报名状态','岗位','日期','时段','报名ID']);
export function registrationExportRow(row,event={}){
 return {'姓名':row['姓名']||'','学号':String(row['学号']||''),'邮箱':row['邮箱']||'',
  '报名状态':row['报名状态']||'','岗位':row['岗位']||event['岗位']||'',
  '日期':row['报名日期']||event['报名日期']||'','时段':row['报名时段']||event['报名时段']||'','报名ID':row['报名ID']||''};
}
