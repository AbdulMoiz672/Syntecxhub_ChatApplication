import 'dotenv/config';
import mongoose from 'mongoose';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatServer } from './app.js';
import { Room } from './models.js';
import { DirectUser } from './direct.js';
import { Session } from './auth.js';

try {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/relay-chat', { serverSelectionTimeoutMS: 10000 });
  await Promise.all([Room.init(), DirectUser.init(), Session.init()]);
  for (const [name, description] of [['general', 'A little bit of everything. Say hello.'], ['design', 'Ideas, inspiration, and things in progress.'], ['development', 'Build together. Share what you’re working on.'], ['random', 'The good stuff that doesn’t fit anywhere else.']]) {
    await Room.updateOne({ name }, { $setOnInsert: { name, description } }, { upsert: true });
  }
  const { app, server, io } = createChatServer({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' });
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  server.listen(process.env.PORT || 3001, () => console.log(`Relay server ready on port ${process.env.PORT || 3001}`));
  const shutdown = () => { io.close(); server.close(); mongoose.disconnect().then(() => process.exit(0)); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
} catch (error) {
  console.error('Startup failed. Check that MongoDB is running and MONGODB_URI is correct.', error.message);
  process.exit(1);
}
