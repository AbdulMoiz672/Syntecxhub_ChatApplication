import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({ tokenHash: { type: String, unique: true, default: () => randomBytes(32).toString('hex'), select: false }, email: { type: String, unique: true, sparse: true, select: false }, passwordHash: { type: String, select: false }, username: { type: String, required: true } }, { timestamps: true });
const directSchema = new mongoose.Schema({ senderId: { type: mongoose.Schema.Types.ObjectId, required: true }, recipientId: { type: mongoose.Schema.Types.ObjectId, required: true }, sender: String, text: { type: String, required: true, maxlength: 2000 } }, { timestamps: true });
directSchema.index({ senderId: 1, recipientId: 1, createdAt: -1 });
export const DirectUser = mongoose.model('DirectUser', userSchema);
export const DirectMessage = mongoose.model('DirectMessage', directSchema);

export function installDirectMessaging(io) {
  const channel = id => `direct-user:${id}`;
  const online = id => Boolean(io.sockets.adapter.rooms.get(channel(id))?.size);
  async function directory() {
    return (await DirectUser.find({ email: { $exists: true } }).select('username').sort({ username: 1 }).lean()).map(u => ({ ...u, online: online(String(u._id)) }));
  }
  io.on('connection', socket => {
    const handle = (event, fn) => socket.on(event, async (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try { ack(await fn(data || {})); }
      catch { ack({ ok: false, error: 'Unable to complete direct message request. Please try again.' }); }
    });
    handle('direct:identify', async () => {
      const user = socket.data.user;
      if (!socket.connected) return { ok: false, error: 'Disconnected.' };
      if (socket.data.directUserId) await socket.leave(channel(socket.data.directUserId));
      socket.data.directUserId = String(user._id);
      await socket.join(channel(user._id));
      io.emit('direct:directory', await directory());
      return { ok: true, user: { _id: String(user._id), username: user.username }, users: await directory() };
    });
    handle('direct:history', async ({ userId, before }) => {
      const self = socket.data.directUserId;
      if (!self || !mongoose.isValidObjectId(userId) || userId === self) return { ok: false, error: 'Choose another user.' };
      const filter = { $or: [{ senderId: self, recipientId: userId }, { senderId: userId, recipientId: self }] };
      if (before) {
        if (!mongoose.isValidObjectId(before)) return { ok: false, error: 'Invalid history cursor.' };
        filter._id = { $lt: new mongoose.Types.ObjectId(before) };
      }
      const messages = await DirectMessage.find(filter).sort({ _id: -1 }).limit(50).lean();
      return { ok: true, messages: messages.reverse() };
    });
    handle('direct:send', async ({ userId, text }) => {
      const self = socket.data.directUserId;
      if (!self || !mongoose.isValidObjectId(userId) || self === userId) return { ok: false, error: 'Choose another user.' };
      if (typeof text !== 'string' || !text.trim() || text.trim().length > 2000) return { ok: false, error: 'Messages must contain 1–2000 characters.' };
      if (Date.now() - (socket.data.directLastSent || 0) < 300) return { ok: false, error: 'Please wait a moment before sending again.' };
      socket.data.directLastSent = Date.now();
      const [sender, recipient] = await Promise.all([DirectUser.findById(self), DirectUser.exists({ _id: userId })]);
      if (!sender || !recipient) return { ok: false, error: 'User not found.' };
      const message = await DirectMessage.create({ senderId: self, recipientId: userId, sender: sender.username, text: text.trim() });
      io.to(channel(self)).to(channel(userId)).emit('direct:message', message);
      return { ok: true, message };
    });
    socket.on('disconnect', () => { if (socket.data.directUserId) directory().then(users => io.emit('direct:directory', users)).catch(() => {}); });
  });
}
