export const FINAL_HOURS_COLUMNS=Object.freeze([
 ['index','分工时长表'],['name','姓名'],['department','院系'],['studentId','学号'],['location','具体工作地点'],['dates','正式工作日期'],['trainingHours','实际培训时长/小时'],['travelHours','实际交通时长/小时'],['serviceHours','正式工作时长/小时'],['work','志愿者具体工作内容'],['remark','备注'],
]);
export const FINAL_HOURS_INSTRUCTIONS=Object.freeze(['填写说明','','全称','','校内注明校区\n校外注明xx区xx街道','X月X日X点-X点\n包括实际交通时长+正式工作时长','【仅填写数字】\n1.没有培训或培训少于0.5小时，统一填写0。\n2.四舍五入，填整数。','【仅填写数字】','【仅填写数字】','采访/拍摄/记录/录像/录音/朗诵/带队/整理/培训','']);
export const finalTrainingHours=value=>Number(value)<0.5?0:Math.round(Number(value));
