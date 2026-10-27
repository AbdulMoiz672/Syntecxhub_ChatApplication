import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { Room, Message } from './models.js';
import { installDirectMessaging } from './direct.js';
import { installAuth } from './auth.js';

export function createChatServer({ origin = 'http://localhost:5173' } = {}) {
  const app = express();
  app.use(cors({ origin }));
  app.use(express.json({ limit: '16kb' }));
  const server = createServer(app);
  const io = new Server(server, { cors: { origin }, maxHttpBufferSize: 16384 });
  installAuth(app, io, origin);
  installDirectMessaging(io);
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  app.get('/api/health', (req, res) => res.json({ ok: mongoose.connection.readyState === 1 }));
  app.get('/api/rooms', wrap(async (req, res) => res.json(await Room.find().sort({ createdAt: 1 }).lean())));
  app.post('/api/rooms', wrap(async (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim().toLowerCase() : '';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name) || description.length > 160) return res.status(400).json({ error: 'Use a room name of 1–40 lowercase letters, numbers or hyphens, and a description up to 160 characters.' });
    const room = await Room.create({ name, description });
    io.emit('room:new', room);
    res.status(201).json(room);
  }));
  app.get('/api/rooms/:id/messages', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid room.' });
    if (!await Room.exists({ _id: req.params.id })) return res.status(404).json({ error: 'Room not found.' });
    const filter = { room: req.params.id };
    if (req.query.before) {
      const date = new Date(req.query.before);
      if (Number.isNaN(date.valueOf())) return res.status(400).json({ error: 'Invalid history cursor.' });
      filter.createdAt = { $lt: date };
    }
    res.json((await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(50).lean()).reverse());
  }));
  const presence = room => {
    const members = [...(io.sockets.adapter.rooms.get(room) || [])].map(id => io.sockets.sockets.get(id)?.data).filter(Boolean);
    io.to(room).emit('room:users', [...new Map(members.map(d => [d.clientId, { clientId: d.clientId, username: d.username }])).values()]);
  };
  const typingTimers = new Map();
  const typing = room => io.to(room).emit('typing:update', [...new Set([...io.sockets.sockets.values()].filter(s => s.data.roomId === room && s.data.typing).map(s => s.data.username))]);
  function clearTyping(socket) {
    clearTimeout(typingTimers.get(socket.id)); typingTimers.delete(socket.id);
    socket.data.typing = false;
    if (socket.data.roomId) typing(socket.data.roomId);
  }
  io.on('connection', socket => {
    socket.on('join-room', async (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const joinVersion = socket.data.joinVersion = (socket.data.joinVersion || 0) + 1;
      try {
        const { roomId } = payload || {};
        const username = socket.data.user.username, clientId = String(socket.data.user._id);
        if (!mongoose.isValidObjectId(roomId) || typeof username !== 'string' || !username.trim() || username.trim().length > 32 || typeof clientId !== 'string' || !clientId || clientId.length > 100) return ack({ ok: false, error: 'Invalid room or display name.' });
        if (!await Room.exists({ _id: roomId })) return ack({ ok: false, error: 'Room not found.' });
        if (!socket.connected || socket.data.joinVersion !== joinVersion) return ack({ ok: false, error: 'Room selection changed.' });
        const previous = socket.data.roomId;
        clearTyping(socket);
        if (previous) await socket.leave(previous);
        socket.data = { ...socket.data, roomId, username: username.trim(), clientId, typing: false, joinVersion };
        await socket.join(roomId);
        if (previous) presence(previous);
        ack({ ok: true }); presence(roomId);
      } catch { ack({ ok: false, error: 'Unable to join room.' }); }
    });
    socket.on('message:send', async (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomId, text } = payload || {};
        if (!roomId || socket.data.roomId !== roomId) return ack({ ok: false, error: 'Join this room first.' });
        if (typeof text !== 'string' || !text.trim() || text.trim().length > 2000) return ack({ ok: false, error: 'Messages must contain 1–2000 characters.' });
        const now = Date.now();
        if (now - (socket.data.lastSent || 0) < 300) return ack({ ok: false, error: 'Please wait a moment before sending again.' });
        socket.data.lastSent = now;
        const message = await Message.create({ room: roomId, sender: socket.data.username, clientId: socket.data.clientId, text: text.trim() });
        clearTyping(socket);
        io.to(roomId).emit('message:new', message);
        ack({ ok: true, message });
      } catch { ack({ ok: false, error: 'Message could not be saved. Please try again.' }); }
    });
    socket.on('typing', payload => {
      if (!payload || socket.data.roomId !== payload.roomId) return;
      clearTyping(socket);
      socket.data.typing = Boolean(payload.isTyping); typing(payload.roomId);
      if (socket.data.typing) typingTimers.set(socket.id, setTimeout(() => clearTyping(socket), 3000));
    });
    socket.on('disconnect', () => { const room = socket.data.roomId; clearTyping(socket); if (room) presence(room); });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((err, req, res, next) => {
    if (err.code === 11000) return res.status(409).json({ error: req.path.startsWith('/api/auth/') ? 'An account with that email already exists.' : 'That room already exists.' });
    res.status(err.status || 500).json({ error: err.status === 400 ? 'Invalid request.' : 'Unable to complete request.' });
  });
  return { app, server, io };
}
