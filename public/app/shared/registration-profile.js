/** Booking values override current directory supplements; never mutate account profiles. */
const text=value=>String(value??'').trim();
export function certificateStatus(value){
 const s=text(value);if(/^否/.test(s)||['no','false','0'].includes(s.toLowerCase()))return 'no';
 if(/^是.*(CPR|AED|AHA|红十字|救护)/i.test(s)||['是','yes','true','1','有'].includes(s.toLowerCase()))return 'yes';
 return 'unknown';
}
export function registrationParticipant(row,profile={}){
 const result={...profile};
 for(const [field,column]of Object.entries({campus:'校区',department:'院系',grade:'年级',phone:'电话',gender:'性别',qq:'QQ号'}))if(text(row[column]))result[field]=text(row[column]);
 if(text(row['急救证'])){result.certificate=text(row['急救证']);result.certificateStatus=certificateStatus(row['急救证']);}
 return result;
}
