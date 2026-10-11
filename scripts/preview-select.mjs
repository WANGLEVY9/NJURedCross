/** Isolated shared-select interaction fixture; no accounts, external APIs or writes. */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createStaticHandler} from '../lib/http/static.js';
const staticFile=createStaticHandler(fileURLToPath(new URL('../public/',import.meta.url)));
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/select-qa'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  return res.end(await readFile(new URL('../tests/fixtures/select-controls.html',import.meta.url)));
 }
 return staticFile(req,res,url);
}).listen(3125,'127.0.0.1',()=>console.log('Select QA: http://127.0.0.1:3125/select-qa'));
