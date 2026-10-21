import {isAccountActive} from '../permissions.js';
import {TEMPLATE_TYPES,MAIL_VARIABLES,defaultMailSettings,publicParticipationGuide} from './templates.js';
export async function mailSettingsRoutes(req,res,url,ctx){
 if(req.method==='GET'&&url.pathname==='/api/public/participation-guide'){ctx.json(res,200,{ok:true,guide:publicParticipationGuide()});return true;}
 if(url.pathname!=='/api/console/mail-settings')return false;
 const session=ctx.requireConsoleAccess(req,res);if(!session)return true;
 const accounts=await ctx.getAccounts(),matches=accounts.filter(a=>(a.username===session.username||a.accountId===session.accountId));
 if(matches.length!==1||matches[0].role!=='super_admin'||!isAccountActive(matches[0])||matches[0].emailVerified!==true){ctx.json(res,403,{ok:false,message:'仅超级管理员可以修改邮件模板和参与说明。'});return true;}
 if(req.method==='GET'){ctx.json(res,200,{ok:true,settings:ctx.store.read(),types:TEMPLATE_TYPES,variables:MAIL_VARIABLES,defaults:defaultMailSettings()});return true;}
 if(req.method!=='PUT'){ctx.json(res,405,{ok:false,message:'不支持的操作'});return true;}
 if(!ctx.requireCsrf(req,res,session))return true;
 const result=await ctx.store.save(await ctx.readJson(req));
 await ctx.audit('mail.settings.update',{version:result.version});
 ctx.json(res,200,{ok:true,settings:result});return true;
}
