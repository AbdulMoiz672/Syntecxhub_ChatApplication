import mongoose from 'mongoose';
const roomSchema = new mongoose.Schema({ name: { type: String, required: true, unique: true, maxlength: 40 }, description: { type: String, default: '', maxlength: 160 } }, { timestamps: true });
const messageSchema = new mongoose.Schema({ room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true }, sender: { type: String, required: true }, clientId: { type: String, required: true }, text: { type: String, required: true, maxlength: 2000 } }, { timestamps: true });
messageSchema.index({ room: 1, createdAt: -1 });
export const Room = mongoose.model('Room', roomSchema);
export const Message = mongoose.model('Message', messageSchema);
