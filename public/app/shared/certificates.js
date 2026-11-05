export const CERTIFICATE_OPTIONS=Object.freeze(['是，AHA证书','是，红十字CPR+AED/初级救护员/救护员','否','否，但参加过“一加·急救培训”']);

/** Historical source labels describe the same qualification without sharing spelling. */
export function canonicalCertificate(value){
 const text=String(value||'').trim();
 if(CERTIFICATE_OPTIONS.includes(text))return text;
 if(/^是[，,、\s]*.*AHA/i.test(text))return CERTIFICATE_OPTIONS[0];
 if(/^是[，,、\s]*.*(CPR|AED|红十字|救护)/i.test(text))return CERTIFICATE_OPTIONS[1];
 if(/^否.*参加过/.test(text))return CERTIFICATE_OPTIONS[3];
 return '';
}


/** Display labels and order are independent of the existing source values. */
export function certificateSelectOptions(values=CERTIFICATE_OPTIONS,current=''){
 const order=[CERTIFICATE_OPTIONS[0],CERTIFICATE_OPTIONS[1],CERTIFICATE_OPTIONS[3],CERTIFICATE_OPTIONS[2]];
 return [...new Set([current,...values].filter(canonicalCertificate))]
  .sort((a,b)=>order.indexOf(canonicalCertificate(a))-order.indexOf(canonicalCertificate(b)))
  .map(value=>({value,label:canonicalCertificate(value)===CERTIFICATE_OPTIONS[3]?'一加急救':value}));
}
