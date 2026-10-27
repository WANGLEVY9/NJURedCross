/** Add only the two display columns; explicit preview digest and private backup. */
import {assertCoordinatedMaintenance} from '../lib/maintenance/script-runner.js';
import {Base} from 'seatable-api';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {createSeaTableAccess} from '../lib/seatable-auth.js';
import {workflowMode} from '../lib/events/workflow-mode.js';
import {readPagedRows} from '../lib/http/paged-rows.js';
import {PLACE_TABLE} from '../lib/events/ordinary-places.js';
import {PLACE_PROFILE_COLUMNS,syncPlaceProfiles} from '../lib/events/place-profiles.js';

const args=process.argv.slice(2),apply=args.includes('--apply');
const option=name=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
assertCoordinatedMaintenance({write:apply});
try{
 const config=workflowMode(process.env);
 const base=new Base({server:process.env.SEATABLE_SERVER_URL,APIToken:process.env.SEATABLE_VOLUNTEER_API_TOKEN});
 const identity=new Base({server:process.env.SEATABLE_SERVER_URL,APIToken:process.env.SEATABLE_IDENTITY_API_TOKEN});
 await createSeaTableAccess(base)();await createSeaTableAccess(identity)();
 if(base.dtableUuid!==config.expected||!process.env.SEATABLE_IDENTITY_BASE_UUID||identity.dtableUuid!==process.env.SEATABLE_IDENTITY_BASE_UUID||identity.dtableUuid===base.dtableUuid)throw Error('Base mismatch');
 const table=(await base.getMetadata()).tables.find(t=>t.name===PLACE_TABLE);
 if(!table||PLACE_PROFILE_COLUMNS.some(name=>table.columns.some(c=>c.name===name&&c.type!=='text')))throw Error('Schema mismatch');
 const missing=PLACE_PROFILE_COLUMNS.filter(name=>!table.columns.some(c=>c.name===name));
 const digest=createHash('sha256').update(JSON.stringify({base:base.dtableUuid,identity:identity.dtableUuid,table})).digest('hex');
 console.log(JSON.stringify({mode:apply?'apply':'preview',digest,addColumns:missing,accountWrites:0,registrationWrites:0}));
 if(apply){
  const backup=option('backup');
  if(option('digest')!==digest||option('confirm')!=='PLACE-PROFILES'||!isAbsolute(backup||''))throw Error('Current digest and private backup required');
  await mkdir(backup,{mode:0o700});await writeFile(join(backup,'metadata.json'),JSON.stringify(table),{mode:0o600});
  await writeFile(join(backup,'places-before.json'),JSON.stringify(await readPagedRows(base,PLACE_TABLE,{maxRows:100000,requireComplete:true})),{mode:0o600});
  for(const name of missing)await base.insertColumn(PLACE_TABLE,name,'text','');
  const result=await syncPlaceProfiles(base,identity);
  if(result.skipped)throw Error('Schema readback failed');
  console.log(JSON.stringify({verified:true,...result,accountWrites:0,registrationWrites:0}));
 }
}catch{console.error('名额人员列维护停止；凭据与个人资料已省略。');process.exitCode=1;}
