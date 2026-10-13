import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import net from 'node:net';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { sendSmtpMail } from '../lib/http/smtp-request.js';

const key = await readFile(new URL('./fixtures/smtp-tls/server-key.pem', import.meta.url));
const cert = await readFile(new URL('./fixtures/smtp-tls/server-cert.pem', import.meta.url));
const message = {from:'sender@example.test',to:'recipient@example.test',subject:'synthetic',text:'synthetic-content'};
function respond(socket) {
  socket.write('220 synthetic SMTP ready\r\n');
  let buffer='', data=false;
  socket.on('data',chunk=>{
    buffer+=chunk.toString();
    let end;
    while((end=buffer.indexOf('\r\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
      if(data){if(line==='.'){data=false;socket.write('250 accepted\r\n');}continue;}
      if(line==='DATA'){data=true;socket.write('354 send message\r\n');}
      else if(line==='QUIT')socket.end('221 bye\r\n');
      else socket.write('250 synthetic\r\n');
    }
  });
}
async function fixture(t, handler=respond) {
  const sockets=new Set(), servernames=[];
  const server=tls.createServer({key,cert},socket=>{servernames.push(socket.servername);handler(socket);});
  server.on('tlsClientError',()=>{});
  server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{const closed=new Promise(resolve=>server.close(resolve));for(const socket of sockets)socket.destroy();await closed;});
  return {options:{host:'127.0.0.1',port:server.address().port,secure:true,tls:{ca:cert}},servernames,sockets};
}

test('IP TLS connection verifies its certificate without sending IP SNI',async t=>{
  const {options,servernames}=await fixture(t);
  const result=await sendSmtpMail(options,message,{timeoutMs:3000});
  assert.deepEqual(result.accepted,['recipient@example.test']);
  assert.ok(servernames.every(name=>!name));
});
test('DNS hosts automatically send DNS SNI and retain certificate verification',async t=>{
  const {options,servernames}=await fixture(t);
  const lookup=(_host,settings,callback)=>settings.all
    ? callback(null,[{address:'127.0.0.1',family:4}])
    : callback(null,'127.0.0.1',4);
  await sendSmtpMail({...options,host:'mail.fixture.test',tls:{...options.tls,lookup}},message,{timeoutMs:3000});
  assert.deepEqual(servernames,['mail.fixture.test']);
});
test('explicit DNS SNI is preserved when connecting to an IP',async t=>{
  const {options,servernames}=await fixture(t);
  await sendSmtpMail({...options,tls:{...options.tls,servername:'mail.fixture.test'}},message,{timeoutMs:3000});
  assert.deepEqual(servernames,['mail.fixture.test']);
});
test('explicit empty SNI stays disabled and IP certificate verification succeeds',async t=>{
  const {options,servernames}=await fixture(t);
  await sendSmtpMail({...options,tls:{...options.tls,servername:''}},message,{timeoutMs:3000});
  assert.ok(servernames.every(name=>!name));
});
test('untrusted certificates are rejected instead of weakening TLS verification',async t=>{
  const {options}=await fixture(t);
  await assert.rejects(sendSmtpMail({...options,tls:{}},message,{timeoutMs:3000}),e=>e.code==='external_request_failed');
});
test('trusted certificate with the wrong DNS identity is rejected',async t=>{
  const {options}=await fixture(t);
  await assert.rejects(sendSmtpMail({...options,tls:{...options.tls,servername:'wrong.fixture.test'}},message,{timeoutMs:3000}),e=>e.code==='external_request_failed');
});
test('TLS cancellation closes one socket while another delivery succeeds',async t=>{
  const connected=Promise.withResolvers(),disconnected=Promise.withResolvers();let connections=0;
  const {options}=await fixture(t,socket=>{
    if(++connections===1){socket.on('close',()=>disconnected.resolve());connected.resolve();}
    else respond(socket);
  });
  const controller=new AbortController();
  const pending=sendSmtpMail(options,message,{signal:controller.signal,timeoutMs:3000});
  const rejected=assert.rejects(pending,e=>e.code==='external_request_cancelled');
  await connected.promise;
  const completed=sendSmtpMail(options,message,{timeoutMs:3000});controller.abort();
  await rejected;await disconnected.promise;
  assert.deepEqual((await completed).accepted,['recipient@example.test']);
});
test('already cancelled SMTP request creates no connection',async t=>{
  let connections=0;const server=net.createServer(socket=>{connections++;socket.destroy();});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const controller=new AbortController();controller.abort();
  await assert.rejects(sendSmtpMail({host:'127.0.0.1',port:server.address().port},message,{signal:controller.signal}),e=>e.code==='external_request_cancelled');
  assert.equal(connections,0);
});
