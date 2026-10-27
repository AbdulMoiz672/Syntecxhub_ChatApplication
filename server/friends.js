import mongoose from 'mongoose';

const friendshipSchema = new mongoose.Schema({
  pair: { type: String, required: true, unique: true },
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'DirectUser', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'DirectUser', required: true },
  status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
}, { timestamps: true });
friendshipSchema.index({ requester: 1, status: 1 });
friendshipSchema.index({ recipient: 1, status: 1 });
export const Friendship = mongoose.model('Friendship', friendshipSchema);

export function installFriends(io, User) {
  const channel = id => `friends-user:${id}`;
  io.on('connection', socket => {
    const self = String(socket.data.user._id);
    socket.join(channel(self));
    const handle = (event, fn) => socket.on(event, async (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try { ack(await fn(data || {})); }
      catch (error) { ack({ ok: false, error: error.code === 11000 ? 'A friendship or request already exists. Refresh and try again.' : 'Unable to update friends. Please try again.' }); }
    });
    const changed = relation => io.to(channel(relation.requester)).to(channel(relation.recipient)).emit('friends:changed');
    handle('friends:list', async () => {
      const relations = await Friendship.find({ $or: [{ requester: self }, { recipient: self }] })
        .populate('requester', 'username').populate('recipient', 'username').sort({ updatedAt: -1 }).lean();
      return { ok: true, relationships: relations.filter(r => r.requester && r.recipient).map(r => {
        const outgoing = String(r.requester._id) === self;
        const peer = outgoing ? r.recipient : r.requester;
        return { _id: r._id, userId: peer._id, username: peer.username, status: r.status, direction: outgoing ? 'outgoing' : 'incoming' };
      }) };
    });
    handle('friends:request', async ({ userId }) => {
      if (!mongoose.isValidObjectId(userId)) return { ok: false, error: 'Choose another user.' };
      userId = new mongoose.Types.ObjectId(userId).toString();
      if (self === userId) return { ok: false, error: 'Choose another user.' };
      if (!await User.exists({ _id: userId, email: { $exists: true } })) return { ok: false, error: 'User not found.' };
      const pair = [self, String(userId)].sort().join(':');
      const relation = await Friendship.create({ pair, requester: self, recipient: userId });
      changed(relation);
      return { ok: true };
    });
    handle('friends:accept', async ({ relationshipId }) => {
      if (!mongoose.isValidObjectId(relationshipId)) return { ok: false, error: 'Invalid request.' };
      const relation = await Friendship.findOneAndUpdate({ _id: relationshipId, recipient: self, status: 'pending' }, { $set: { status: 'accepted' } }, { new: true });
      if (!relation) return { ok: false, error: 'This request is no longer available.' };
      changed(relation); return { ok: true };
    });
    // Either participant may cancel, decline, or remove their own relationship.
    handle('friends:remove', async ({ relationshipId }) => {
      if (!mongoose.isValidObjectId(relationshipId)) return { ok: false, error: 'Invalid friendship.' };
      const relation = await Friendship.findOneAndDelete({ _id: relationshipId, $or: [{ requester: self }, { recipient: self }] });
      if (!relation) return { ok: false, error: 'This friendship or request is no longer available.' };
      changed(relation); return { ok: true };
    });
  });
}
