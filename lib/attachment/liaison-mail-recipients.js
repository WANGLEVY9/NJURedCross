import {mailRecipient} from '../identity/mail-recipient.js';
import {isAccountActive} from '../permissions.js';

const key=value=>String(value||'').trim().toLowerCase();
/** Mail-only copies. Original liaison emails remain the identity used by review authorization. */
export function liaisonMailRecipients(rows,accounts){
 const byEmail=new Map();
 for(const account of accounts){
  const email=key(account.email);
  if(!email)continue;
  const matches=byEmail.get(email)||[];
  matches.push(account);byEmail.set(email,matches);
 }
 return rows.map(row=>{
  const original=String(row['邮箱']??row.email??'').trim();
  const matches=byEmail.get(key(original))||[];
  // Never infer a recipient from a display name or from another person's delivery preference.
  let email=original;
  if(matches.length>1)email='';
  if(matches.length===1){
   const account=matches[0];
   email=isAccountActive(account)&&account.emailVerified===true?mailRecipient(account):'';
  }
  return {...row,email,邮箱:email};
 });
}
