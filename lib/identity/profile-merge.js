/** Three-way merge; never replace a concurrent edit with an older value. */
export function mergeProfileFields({local,remote,baseline={},pending={}}){
 const pull={},push={},conflicts={};
 for(const key of Object.keys(remote)){
  const here=String(local[key]??''),there=String(remote[key]??'');
  if(Object.hasOwn(pending,key)){
   const edit=String(pending[key]??'');
   if(Object.hasOwn(baseline,key)&&there!==String(baseline[key]??'')&&there!==edit)conflicts[key]={local:edit,remote:there};
   else push[key]=edit;
  }else if(here===there)continue;
  else if(!here||(Object.hasOwn(baseline,key)&&here===String(baseline[key]??'')))pull[key]=there;
  else conflicts[key]={local:here,remote:there};
 }
 return {pull,push,conflicts};
}
