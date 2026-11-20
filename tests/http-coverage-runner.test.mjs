import test from 'node:test';
import assert from 'node:assert/strict';
import {runHttpCoverage,corruptCoverageAfterPassingTests,coverageArguments} from '../scripts/run-http-coverage.mjs';

const corrupt={code:1,signal:null,output:'ℹ Warning: Could not report code coverage. Error [ERR_OPERATION_FAILED]: Operation failed: failed to parse coverage file /tmp/node-coverage-x/coverage-1-1793940085587-1.json: Unterminated string in JSON at position 262144\nℹ tests 3049\nℹ pass 3048\nℹ fail 0\nℹ cancelled 0\nℹ skipped 1\n'};
/** Node 24 的另一种损坏形态：覆盖率文件 0 字节，测试本身全绿。 */
const emptyReport={code:1,signal:null,output:'ℹ Warning: Could not report code coverage. Error [ERR_OPERATION_FAILED]: Operation failed: coverage file is empty: /tmp/node-coverage-7LD0rU/coverage-6336-1795141040836-1.json\nℹ tests 3541\nℹ suite 0\nℹ pass 3540\nℹ fail 0\nℹ cancelled 0\nℹ skipped 1\n'};
async function exercise(results){let calls=0;const logs=[];const code=await runHttpCoverage({run:async()=>results[calls++],log:message=>logs.push(message)});return {code,calls,logs};}

test('coverage corruption retries the same successful test suite once',async()=>{
 const result=await exercise([corrupt,{code:0,output:'coverage report',signal:null}]);
 assert.equal(result.code,0);assert.equal(result.calls,2);assert.equal(result.logs.length,1);
 assert.ok(coverageArguments.includes('tests/*.test.mjs'));
 for(const flag of ['--test-coverage-lines=90','--test-coverage-branches=80','--test-coverage-functions=90'])assert.ok(coverageArguments.includes(flag));
});
test('repeat corruption remains a failing check',async()=>{
 const result=await exercise([corrupt,corrupt]);assert.equal(result.code,1);assert.equal(result.calls,2);
});
test('an empty coverage file after a green suite also retries once',async()=>{
 const result=await exercise([emptyReport,{code:0,output:'coverage report',signal:null}]);
 assert.equal(result.code,0);assert.equal(result.calls,2);assert.equal(result.logs.length,1);
});
test('an empty coverage file is never retried when the report also shows a real failure',async()=>{
 for(const value of [
  {...emptyReport,output:emptyReport.output.replace('fail 0','fail 2')},
  {...emptyReport,output:emptyReport.output.replace('cancelled 0','cancelled 1')},
  {...emptyReport,output:emptyReport.output+'ERROR: Coverage for lines (88.1%) does not meet global threshold (90%)\n'},
  {...emptyReport,output:emptyReport.output.replace('pass 3540','pass 0')},
 ]){assert.equal(corruptCoverageAfterPassingTests(value),false);}
});
test('test failures, cancellations, threshold failures and unrelated errors are never retried',async()=>{
 for(const value of [
  {...corrupt,output:corrupt.output.replace('fail 0','fail 1')},
  {...corrupt,output:corrupt.output.replace('cancelled 0','cancelled 1')},
  {...corrupt,signal:'SIGTERM'},
  {...corrupt,output:corrupt.output+'Coverage threshold does not meet\n'},
  {...corrupt,output:'syntax error'},
  {...corrupt,output:corrupt.output.replace('pass 3048','pass 0')},
  {...corrupt,code:2},
 ]){assert.equal(corruptCoverageAfterPassingTests(value),false);const result=await exercise([value]);assert.equal(result.calls,1);assert.equal(result.code,value.code);}
});
test('a normal coverage pass runs exactly once',async()=>{
 const result=await exercise([{code:0,signal:null,output:'all passed'}]);assert.equal(result.calls,1);assert.equal(result.code,0);
});
test('launch errors propagate instead of being treated as coverage corruption',async()=>{
 await assert.rejects(runHttpCoverage({run:async()=>{throw Error('cannot start');}}),/cannot start/);
});
