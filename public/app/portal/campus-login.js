export function campusLoginIdentifier(value,domain){
 if(!['smail.nju.edu.cn','nju.edu.cn'].includes(domain))throw new Error('请选择校园邮箱后缀。');
 const text=String(value||'').trim();
 // Browser autofill may supply the previously saved full campus address.
 const match=text.match(/^(\d{6,20})(?:@(smail\.nju\.edu\.cn|nju\.edu\.cn))?$/i);
 if(!match)throw new Error('请填写6～20位数字学号。');
 return `${match[1]}@${match[2]?.toLowerCase()||domain}`;
}
