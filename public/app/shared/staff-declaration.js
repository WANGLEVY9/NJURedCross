/** Self-declaration is profile data and never grants an account role. */
export function staffEmailDomains(values){
 return [...new Set((Array.isArray(values)?values:[]).map(v=>String(v).trim().toLowerCase()).filter(v=>/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(v)))];
}
export const requiresStaffDeclaration=(email,domains)=>staffEmailDomains(domains).includes(String(email).split('@').at(-1).toLowerCase());
export function staffDeclaration(value){return ['是','否','未确认'].includes(value)?value:'未确认';}
