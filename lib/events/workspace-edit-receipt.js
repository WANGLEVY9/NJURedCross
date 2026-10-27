import {workspaceEditDigest} from './workspace-live-edit.js';
const unavailable=()=>Object.assign(new Error('活动修改恢复记录缺失或不一致，请管理员核对私有状态备份；禁止重新保存覆盖'),{statusCode:409,code:'workspace_edit_receipt_unavailable'});

export function workspaceEditReference(receipt,status=receipt.status){
 const {actor,token,digest,expectedVersion}=receipt;
 return {status,actor,token,digest,expectedVersion,storage:'activity-lifecycle-v1',payloadDigest:workspaceEditDigest(receipt)};
}
export function resolveWorkspaceEdit(eventId,reference,store){
 if(!reference||reference.status==='complete'||!reference.storage)return reference;
 if(reference.storage!=='activity-lifecycle-v1')throw unavailable();
 const receipt=store.workspaceEdit(eventId,reference.token);
 if(!receipt||workspaceEditDigest(receipt)!==reference.payloadDigest
  ||['actor','token','digest','expectedVersion'].some(key=>receipt[key]!==reference[key]))throw unavailable();
 return receipt;
}
