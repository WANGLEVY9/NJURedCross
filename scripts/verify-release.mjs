/** Verify the actual release archive in an isolated directory, without .env or business services. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const archive=resolve(process.argv[2] || '/tmp/njuredcross-release.tar.gz');
const directory=await mkdtemp(join(tmpdir(),'njuredcross-release-test-'));
let server;
try {
  // Validate whitelist, duplicates and hashes before extracting any member.
  execFileSync('python3',['-c',`
import hashlib,json,sys,tarfile
from pathlib import Path,PurePosixPath
with tarfile.open(sys.argv[1],'r:gz') as archive:
 members=archive.getmembers()
 names=[entry.name for entry in members]
 assert len(set(names))==len(names), 'Duplicate archive paths'
 manifest=json.load(archive.extractfile('manifest.json'))
 assert set(names)==set(manifest['files'])|{'manifest.json'}, 'Manifest/member mismatch'
 for entry in members:
  path=PurePosixPath(entry.name)
  assert entry.isfile() and not path.is_absolute() and '..' not in path.parts, 'Unsafe archive entry'
  assert not any(part.startswith('.') for part in path.parts), 'Hidden archive entry'
  if entry.name=='manifest.json': continue
  allowed=entry.name in ('server.js','package.json','package-lock.json') or (entry.name.startswith('lib/') and entry.name.endswith('.js')) or (entry.name.startswith('public/') and not entry.name.endswith('README.md'))
  assert allowed, 'Non-runtime file in release'
  assert hashlib.sha256(archive.extractfile(entry).read()).hexdigest()==manifest['files'][entry.name], 'Hash mismatch'
 for entry in members:
  target=Path(sys.argv[2])/entry.name
  target.parent.mkdir(parents=True,exist_ok=True)
  target.write_bytes(archive.extractfile(entry).read())
`,archive,directory],{stdio:'inherit'});
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  const expected=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  assert.equal(manifest.commit,expected,'Release does not match verified checkout');
  execFileSync('npm',['ci','--omit=dev','--ignore-scripts','--no-audit'],{cwd:directory,stdio:'inherit'});
  execFileSync(process.execPath,['--check',join(directory,'server.js')],{stdio:'inherit'});
  const require=createRequire(join(directory,'package.json'));
  for(const name of Object.keys(JSON.parse(await readFile(join(directory,'package.json'),'utf8')).dependencies))require(name);
  const png=await require('sharp')({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer();
  assert.equal((await require('sharp')(png).metadata()).format,'png');
  assert.match(await require('qrcode').toDataURL('SYNTHETIC-RELEASE'),/^data:image\/png;base64,/);
  const workbook=new (require('exceljs').Workbook)();workbook.addWorksheet('Synthetic').addRow(['synthetic',1]);
  assert.ok((await workbook.xlsx.writeBuffer()).length>0);
  const {createStaticHandler}=await import(pathToFileURL(join(directory,'lib/http/static.js')));
  const {createWebAssets,STYLE_BUNDLE_PATH,CONSOLE_STYLE_BUNDLE_PATH,EXTRA_STYLE_BUNDLE_PATH}=await import(pathToFileURL(join(directory,'lib/http/web-assets.js')));
  const releaseAssets=createWebAssets(join(directory,'public'));
  const expectedBundle=await releaseAssets.bundle('portal');
  const expectedConsoleBundle=await releaseAssets.bundle('console');
  // 首屏只等关键包；增强包同样随发布生成，只是不参与启动就绪判定。
  const expectedExtraBundle=await releaseAssets.bundle('portal','extra');
  const staticFile=createStaticHandler(join(directory,'public'));
  server=http.createServer((req,res)=>staticFile(req,res,new URL(req.url,'http://localhost')).catch(()=>{res.statusCode=500;res.end();}));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const shell=await fetch(base+'/events');assert.equal(shell.status,200);
  assert.match(shell.headers.get('content-security-policy'),/script-src 'self'/);
  assert.equal(shell.headers.get('cache-control'),'no-store');
  const html=await shell.text();
  const entryAssets=[...html.matchAll(/(?:src|href)="(\/(?:app|styles|assets)\/[^"#]+)"/g)].map(match=>match[1]);
  assert.ok(entryAssets.length>0,'No startup assets');
  assert.ok(entryAssets.includes(`${STYLE_BUNDLE_PATH}?v=${expectedBundle.version}`),'Release shell must serve the generated stylesheet bundle');
  assert.ok(entryAssets.includes(`${EXTRA_STYLE_BUNDLE_PATH}?v=${expectedExtraBundle.version}`),'Release shell must serve the generated enhancement bundle');
  for(const asset of new Set(entryAssets)){
    const response=await fetch(base+asset);assert.equal(response.status,200,asset);
    const content=Buffer.from(await response.arrayBuffer());
    const path=new URL(asset,base).pathname;
    const expectedHash=path===STYLE_BUNDLE_PATH?createHash('sha256').update(expectedBundle.body).digest('hex'):path===EXTRA_STYLE_BUNDLE_PATH?createHash('sha256').update(expectedExtraBundle.body).digest('hex'):manifest.files['public'+path];
    assert.equal(createHash('sha256').update(content).digest('hex'),expectedHash,asset);
    if(path===STYLE_BUNDLE_PATH||path===EXTRA_STYLE_BUNDLE_PATH)assert.equal(response.headers.get('cache-control'),'public, max-age=31536000, immutable');
    if(response.headers.has('etag')){
      const cached=await fetch(base+asset,{headers:{'If-None-Match':response.headers.get('etag')}});
      assert.equal(cached.status,304,asset);assert.equal((await cached.arrayBuffer()).byteLength,0);
    }
  }
  // 管理端不是同一份样式：控制台 shell 必须拿到自己的 bundle，而不是门户那份。
  const consoleShell=await fetch(base+'/console/materials');assert.equal(consoleShell.status,200);
  const consoleHtml=await consoleShell.text();
  assert.ok(consoleHtml.includes(`${CONSOLE_STYLE_BUNDLE_PATH}?v=${expectedConsoleBundle.version}`),'Console shell must serve the console stylesheet bundle');
  assert.ok(!consoleHtml.includes(`${STYLE_BUNDLE_PATH}?v=`),'Console shell must not ship the portal bundle');
  const consoleAsset=await fetch(base+`${CONSOLE_STYLE_BUNDLE_PATH}?v=${expectedConsoleBundle.version}`);
  assert.equal(consoleAsset.status,200);
  assert.equal(createHash('sha256').update(Buffer.from(await consoleAsset.arrayBuffer())).digest('hex'),createHash('sha256').update(expectedConsoleBundle.body).digest('hex'));
  assert.equal(consoleAsset.headers.get('cache-control'),'public, max-age=31536000, immutable');
  assert.equal((await fetch(base+'/assets/missing-release.png')).status,404);
  console.log(JSON.stringify({commit:manifest.commit,verifiedFiles:Object.keys(manifest.files).length,startupAssets:new Set(entryAssets).size,dependencies:'loaded',image:'encoded',qr:'encoded',spreadsheet:'encoded'}));
} finally {
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await rm(directory,{recursive:true,force:true});
}
