import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const coverageArguments = [
 '--experimental-test-coverage', '--test', '--test-concurrency=2', '--test-timeout=120000',
 '--test-coverage-include=lib/http/*.js', '--test-coverage-lines=90',
 '--test-coverage-branches=80', '--test-coverage-functions=90', 'tests/*.test.mjs',
];

/** Only a corrupt report after a completed, successful test suite may be retried. */
export function corruptCoverageAfterPassingTests({code,signal,output}) {
 return code===1&&!signal&&
  /Warning: Could not report code coverage[\s\S]*failed to parse coverage file[^\r\n]*\.json:/.test(output)&&
  /^\s*(?:ℹ |# )?tests [1-9]\d*\s*$/m.test(output)&&
  /^\s*(?:ℹ |# )?pass [1-9]\d*\s*$/m.test(output)&&
  /^\s*(?:ℹ |# )?fail 0\s*$/m.test(output)&&
  /^\s*(?:ℹ |# )?cancelled 0\s*$/m.test(output)&&
  !/does not meet|coverage threshold|not ok \d|ERR_TEST_FAILURE/i.test(output);
}

function execute() {
 return new Promise((accept,reject)=>{
  const child=spawn(process.execPath,coverageArguments,{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='';
  for(const [stream,target] of [[child.stdout,process.stdout],[child.stderr,process.stderr]]) {
   stream.setEncoding('utf8');
   stream.on('data',chunk=>{output+=chunk;target.write(chunk);});
  }
  child.once('error',reject);
  child.once('close',(code,signal)=>accept({code,signal,output}));
 });
}

export async function runHttpCoverage({run=execute,log=message=>console.error(message)}={}) {
 const first=await run();
 if(!corruptCoverageAfterPassingTests(first))return first.code??1;
 log('Coverage JSON was incomplete after all tests passed. Re-running the same full suite once with unchanged coverage thresholds.');
 const second=await run();
 return second.code??1;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {process.exitCode=await runHttpCoverage();}
 catch(error){console.error(error);process.exitCode=1;}
}
