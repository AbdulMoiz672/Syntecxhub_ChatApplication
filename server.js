import 'dotenv/config';
import mongoose from 'mongoose';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createChatServer } from './server/app.js';
import { Room } from './server/models.js';
import { DirectUser } from './server/direct.js';
import { Session } from './server/auth.js';
import { Friendship } from './server/friends.js';

const port = Number(process.env.PORT || 3001);
let chat;
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 10000);
  timer.unref();
  try {
    if (chat) await new Promise(resolve => chat.io.close(resolve));
    await mongoose.disconnect();
    process.exitCode = code;
  } catch { process.exitCode = 1; }
  finally { clearTimeout(timer); }
}

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/relay-chat', { serverSelectionTimeoutMS: 10000 });
  await Promise.all([Room.init(), DirectUser.init(), Session.init(), Friendship.init()]);
  for (const [name, description] of [['general', 'A little bit of everything. Say hello.'], ['design', 'Ideas, inspiration, and things in progress.'], ['development', 'Build together. Share what you’re working on.'], ['random', 'The good stuff that doesn’t fit anywhere else.']]) {
    await Room.updateOne({ name }, { $setOnInsert: { name, description } }, { upsert: true });
  }
  // Installs authentication, room messaging, direct messages, and Socket.io.
  chat = createChatServer({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' });
  const { app, server } = chat;
  app.disable('x-powered-by');
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'client/dist');
  const indexFile = path.join(dist, 'index.html');
  if (existsSync(indexFile)) {
    app.use(express.static(dist));
    app.get('*', (req, res, next) => {
      if (!req.accepts('html') || path.extname(req.path)) return next();
      res.sendFile(indexFile);
    });
  } else {
    app.get('/', (req, res) => res.json({ message: 'Relay API is running. Use the Vite dev server or run npm run build to serve the frontend here.' }));
  }
  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => { server.off('error', reject); resolve(); });
  });
  console.log('Relay is running at http://localhost:' + port);
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  server.on('error', error => {
    console.error('HTTP server error:', error.code || 'Unknown error');
    void shutdown(1);
  });
} catch (error) {
  // Do not print connection strings, which can contain credentials.
  console.error('Startup failed. Check PORT, MONGODB_URI, MongoDB availability, and whether the port is already in use.');
  if (error.code) console.error('Error code:', error.code);
  await shutdown(1);
}
