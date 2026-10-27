/** Read-only synthetic UI data. Imported only by the isolated preview server. */
export function adminModulePreview(path){
 const inventory=['志愿者马甲','急救训练模型','宣传展架'].map((name,i)=>({id:'preview-asset-'+i,code:'PREVIEW-'+i,name:'预览样例·'+name,center:'仙林',cabinet:'A',level:'1',initial:20,quantity:20,difference:0,threshold:2,thresholdStatus:'normal',unit:'件'}));
 const application={id:'preview-application',code:'PREVIEW-A1',purpose:'预览样例·校园急救活动',applicant:'模拟申请人',items:inventory[0].name,assetCode:inventory[0].code,quantity:3,status:'待审批',approval:'待审核',returnStatus:'',plannedReturnDate:'2030-11-03'};
 const campaigns=['校园急救知识宣传','志愿服务活动总结','校园公益海报'].map((name,i)=>({id:'submission:preview-'+i,title:'预览样例·'+name,type:'活动总结',source:'隔离模拟数据',author:'模拟投稿人',summary:'仅用于管理端界面预览，不是真实投稿。',submittedAt:'2030-10-14',status:'已收集',authorization:'已授权',chain:{passed:0,done:false,status:'待审核'}}));
 const interests=[{id:'preview-interest',nickname:'预览样例参与者',program:'birthday',frequency:'weekly',campus:'仙林',contactEmail:'preview@example.invalid',status:'待确认',submittedAt:'2030-10-14'}];
 const routes={
  '/api/materials/overview':['materials',{inventory,applications:[application],pending:[application],overdue:[],abnormalReturns:[],lowStock:[],recentFlows:[],stats:{categoryCount:3,totalCurrentQuantity:60,totalInitialQuantity:60,totalDifference:0,pendingCount:1,borrowedCount:0,overdueCount:0,lowStockCount:0,flowCount:0},policy:{thresholdRule:'隔离模拟库存阈值',source:'隔离模拟数据'}}],
  '/api/materials/flows':['materials',{flows:[],total:0}],
  '/api/outreach/overview':['outreach',{campaigns,sources:['隔离模拟数据'],stats:{contentCount:3,reviewPending:3,reviewApproved:0,publicationPending:0}}],
  '/api/outreach/public-submissions':['outreach',{submissions:[],stats:{total:0,pending:0,approved:0}}],
  '/api/console/skills':['outreach',{skills:[]}],
  '/api/console/tasks/claims':['outreach',{claims:[]}],
  '/api/console/media/picks':['outreach',{queue:[]}],
  '/api/console/media/deletes':['outreach',{queue:[]}],
  '/api/community/overview':['community',{stats:{active:1,currentUserActive:0},current:[]}],
  '/api/community/interests':['community',{interests,stats:{total:1,pending:1,accepted:0,withdrawn:0}}],
  '/api/community/submissions':['community',{submissions:[],stats:{total:0,pending:0,approved:0}}],
  '/api/community/matching-preview':['community',{message:'隔离模拟预览，不创建关系、不发送消息。',candidateCount:1,byProgram:[{program:'birthday',count:1}],pairs:[],generatedAt:'2030-10-14',mode:'preview',requiresManualApproval:true}],
 };
 const match=routes[path];return match?{scope:match[0],data:{ok:true,synthetic:true,previewNotice:'只读隔离样例，非真实业务数据',...match[1]}}:null;
}
