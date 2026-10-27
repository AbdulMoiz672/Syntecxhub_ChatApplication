import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as connect } from 'socket.io-client';
import { createChatServer } from './app.js';
import { Room } from './models.js';
import { DirectUser, DirectMessage } from './direct.js';
import { Session } from './auth.js';

test('accounts protect rooms and direct histories, persist across login, and revoke on logout', { timeout: 60000 }, async () => {
 const mongo=await MongoMemoryServer.create();let service;const clients=[];
 try {
  await mongoose.connect(mongo.getUri());
  await Promise.all([Room.init(),DirectUser.init(),Session.init()]);
  service=createChatServer();await new Promise(r=>service.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+service.server.address().port;
  async function request(path,body,cookie){const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  async function account(username,extra={}) { const result=await request('/auth/register',{username,email:username.toLowerCase()+'@example.com',password:'test-password-123',...extra}); assert.equal(result.status,200);return result; }
  async function client(cookie){const s=connect(base,{transports:['websocket'],forceNew:true,extraHeaders:{Cookie:cookie}});clients.push(s);await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;}
  const emit=(s,event,data={})=>s.timeout(3000).emitWithAck(event,data);
  assert.equal((await request('/rooms')).status,401);
  assert.equal((await request('/auth/register',{username:'No',email:'bad',password:'123'})).status,400);
  const alice=await account('Alice'),bob=await account('Bob'),eve=await account('Eve');
  assert.equal((await accountDuplicate()).status,409);
  async function accountDuplicate(){return request('/auth/register',{username:'Alice',email:'ALICE@example.com',password:'test-password-123'});}
  assert.equal((await request('/auth/login',{email:'alice@example.com',password:'wrong'})).status,401);
  assert.equal((await request('/auth/me',null,alice.cookie)).data.user._id,alice.data.user._id);
  assert.equal(JSON.stringify(alice.data).includes('passwordHash'),false);
  const stored=await DirectUser.findById(alice.data.user._id).select('+passwordHash');
  assert.notEqual(stored.passwordHash,'test-password-123');
  const a=await client(alice.cookie),b=await client(bob.cookie),e=await client(eve.cookie);
  const invalid=connect(base,{transports:['websocket'],forceNew:true,reconnection:false});clients.push(invalid);
  assert.equal((await new Promise(resolve=>invalid.once('connect_error',resolve))).message,'Unauthorized');
  const room=await Room.create({name:'general'}),other=await Room.create({name:'other'});
  assert.equal((await emit(a,'join-room',{roomId:String(room._id),username:'Eve',clientId:'spoof'})).ok,true);
  await emit(b,'join-room',{roomId:String(room._id)});await emit(e,'join-room',{roomId:String(other._id)});
  let leaked=false;e.on('message:new',()=>{leaked=true;});e.on('direct:message',()=>{leaked=true;});
  const roomDelivery=new Promise(r=>b.once('message:new',r));
  assert.equal((await emit(a,'message:send',{roomId:String(room._id),text:'Hello room'})).ok,true);
  assert.equal((await roomDelivery).sender,'Alice');
  assert.equal((await request('/rooms/'+room._id+'/messages',null,bob.cookie)).data[0].text,'Hello room');
  assert.equal((await emit(e,'message:send',{roomId:String(room._id),text:'No'})).ok,false);
  const ai=await emit(a,'direct:identify',{token:'c'.repeat(64),username:'Eve'});
  assert.equal(ai.user._id,alice.data.user._id);
  await emit(b,'direct:identify');await emit(e,'direct:identify');
  assert.equal(JSON.stringify(ai.users).includes('@example.com'),false);
  const delivery=new Promise(r=>b.once('direct:message',r));
  const dm=await emit(a,'direct:send',{userId:bob.data.user._id,text:'Just for Bob',senderId:eve.data.user._id});
  assert.equal(dm.ok,true);assert.equal((await delivery).senderId,alice.data.user._id);
  assert.equal((await emit(b,'direct:history',{userId:alice.data.user._id})).messages[0].text,'Just for Bob');
  assert.deepEqual((await emit(e,'direct:history',{userId:alice.data.user._id,senderId:bob.data.user._id})).messages,[]);
  assert.deepEqual((await emit(b,'direct:history',{userId:alice.data.user._id,before:dm.message._id})).messages,[]);
  assert.equal(leaked,false);
  assert.equal((await emit(b,'direct:send',{userId:alice.data.user._id,text:' '})).ok,false);
  const disconnected=new Promise(r=>a.once('disconnect',r));
  assert.equal((await request('/auth/logout',{},alice.cookie)).status,200);await disconnected;
  assert.equal((await request('/auth/me',null,alice.cookie)).status,401);
  assert.equal((await emit(b,'direct:send',{userId:alice.data.user._id,text:'Offline hello'})).ok,true);
  const login=await request('/auth/login',{email:'ALICE@example.com',password:'test-password-123'});
  assert.equal(login.status,200);assert.equal(login.data.user._id,alice.data.user._id);
  const returning=await client(login.cookie);await emit(returning,'direct:identify');
  assert.equal((await emit(returning,'direct:history',{userId:bob.data.user._id})).messages.at(-1).text,'Offline hello');
  await emit(returning,'join-room',{roomId:String(other._id)});
  assert.equal((await emit(returning,'direct:history',{userId:bob.data.user._id})).messages.length,2);
  const legacyToken='d'.repeat(64);
  const legacy=await DirectUser.create({username:'Legacy',tokenHash:createHash('sha256').update(legacyToken).digest('hex')});
  await DirectMessage.create({senderId:legacy._id,recipientId:bob.data.user._id,sender:'Legacy',text:'Old history'});
  const claimed=await account('Legacy',{legacyToken});assert.equal(claimed.data.user._id,String(legacy._id));
  const ls=await client(claimed.cookie);await emit(ls,'direct:identify');
  assert.equal((await emit(ls,'direct:history',{userId:bob.data.user._id})).messages[0].text,'Old history');
  const blocked=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Origin:'https://other.example',Cookie:bob.cookie}});assert.equal(blocked.status,403);
  await Session.updateOne({user:bob.data.user._id},{expiresAt:new Date(0)});
  assert.equal((await request('/rooms',null,bob.cookie)).status,401);
 } finally {clients.forEach(s=>s.disconnect());if(service)await new Promise(r=>service.io.close(r));await mongoose.disconnect();await mongo.stop();}
});
