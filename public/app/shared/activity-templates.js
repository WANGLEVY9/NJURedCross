/** Extend this registry for new common activity patterns. All share the same lifecycle. */
export const ACTIVITY_TEMPLATES=[
 {id:'general',label:'普通活动',category:'公益活动',description:'自主配置日期、岗位、名额及志愿时长。',preset:{}},
 {id:'first_aid',label:'急救培训',category:'急救培训',description:'填写培训内容，服务、培训和交通时长分别核定。',preset:{position:'培训参与者',work:'急救知识与实操培训'}},
 {id:'volunteer',label:'志愿服务',category:'志愿服务',description:'配置服务岗位和工作内容，核验签到后再核定时长。',preset:{position:'志愿服务岗'}},
 {id:'blood_vehicle',label:'献血车志愿服务',category:'献血车志愿服务',description:'按原模板生成整周点位班次，或配置单个班次。',preset:{position:'献血车志愿服务岗',work:'按点位与班次开展志愿服务；现场照片须体现日期时间。'}},
];
