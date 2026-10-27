import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { DirectUser } from './direct.js';

const scrypt = promisify(scryptCallback);
const sessionSchema = new mongoose.Schema({ tokenHash: { type: String, unique: true, required: true }, user: { type: mongoose.Schema.Types.ObjectId, ref: 'DirectUser', required: true }, expiresAt: { type: Date, required: true, expires: 0 } });
export const Session = mongoose.model('Session', sessionSchema);
const hash = value => createHash('sha256').update(value).digest('hex');
const publicUser = user => ({ _id: String(user._id), username: user.username });
function cookieToken(header = '') {
  return header.split(';').map(x => x.trim()).find(x => x.startsWith('relay_session='))?.slice('relay_session='.length) || '';
}
export async function findSession(header) {
  const token = cookieToken(header);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return Session.findOne({ tokenHash: hash(token), expiresAt: { $gt: new Date() } }).populate('user');
}
export function installAuth(app, io, origin) {
  const allowedOrigins = new Set([origin]);
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.add(`http://localhost:${process.env.PORT || 3001}`);
    allowedOrigins.add(`http://127.0.0.1:${process.env.PORT || 3001}`);
  }
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' };
  const attempts = new Map();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && !allowedOrigins.has(req.headers.origin)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    next();
  });
  async function startSession(req, res, user) {
    const previous = await findSession(req.headers.cookie);
    if (previous) { await Session.deleteOne({ _id: previous._id }); io.in(`session:${previous._id}`).disconnectSockets(true); }
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await Session.create({ tokenHash: hash(token), user: user._id, expiresAt });
    res.cookie('relay_session', token, { ...cookieOptions, expires: expiresAt });
    res.json({ user: publicUser(user) });
  }
  app.post(['/api/auth/register', '/api/auth/login'], wrap(async (req, res) => {
    const ip = req.ip;
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const rate = attempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
    attempts.set(ip, rate);
    if (++rate.count > 30) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const { password, username, legacyToken } = req.body;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Enter a valid email and a password of up to 128 characters.' });
    if (req.path.endsWith('register')) {
      if (password.length < 8 || typeof username !== 'string' || !username.trim() || username.trim().length > 32) return res.status(400).json({ error: 'Enter a display name (1–32 characters) and a password of 8–128 characters.' });
      if (await DirectUser.exists({ email })) return res.status(409).json({ error: 'An account with that email already exists.' });
      const salt = randomBytes(16).toString('hex');
      const passwordHash = `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
      // Possession of the old secret is required to claim pre-account history.
      let user;
      if (typeof legacyToken === 'string' && /^[a-f0-9]{64}$/.test(legacyToken)) user = await DirectUser.findOneAndUpdate({ tokenHash: hash(legacyToken), email: { $exists: false } }, { $set: { username: username.trim(), email, passwordHash } }, { new: true });
      if (!user) user = await DirectUser.create({ username: username.trim(), email, passwordHash });
      return startSession(req, res, user);
    }
    const user = await DirectUser.findOne({ email }).select('+passwordHash');
    const [salt, stored] = (user?.passwordHash || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const actual = await scrypt(password, salt, 64);
    if (!user || !timingSafeEqual(actual, Buffer.from(stored, 'hex'))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    return startSession(req, res, user);
  }));
  app.get('/api/auth/me', wrap(async (req, res) => {
    const session = await findSession(req.headers.cookie);
    if (!session?.user) return res.status(401).json({ error: 'Please log in.' });
    res.json({ user: publicUser(session.user) });
  }));
  app.post('/api/auth/logout', wrap(async (req, res) => {
    const session = await findSession(req.headers.cookie);
    if (session) { await Session.deleteOne({ _id: session._id }); io.in(`session:${session._id}`).disconnectSockets(true); }
    res.clearCookie('relay_session', cookieOptions).json({ ok: true });
  }));
  app.use('/api', wrap(async (req, res, next) => {
    if (req.path === '/health') return next();
    const session = await findSession(req.headers.cookie);
    if (!session?.user) return res.status(401).json({ error: 'Please log in.' });
    req.user = session.user; next();
  }));
  io.use(async (socket, next) => {
    try {
      if (socket.handshake.headers.origin && !allowedOrigins.has(socket.handshake.headers.origin)) return next(new Error('Unauthorized'));
      const session = await findSession(socket.handshake.headers.cookie);
      if (!session?.user) return next(new Error('Unauthorized'));
      socket.data.user = session.user;
      socket.data.sessionId = String(session._id);
      socket.data.sessionExpiresAt = session.expiresAt.valueOf();
      next();
    } catch { next(new Error('Unauthorized')); }
  });
  io.on('connection', socket => {
    socket.join(`session:${socket.data.sessionId}`);
    const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.sessionExpiresAt - Date.now()));
    expiryTimer.unref();
    socket.on('disconnect', () => clearTimeout(expiryTimer));
    socket.use(async (packet, next) => {
      try {
        if (!await Session.exists({ _id: socket.data.sessionId, expiresAt: { $gt: new Date() } })) return socket.disconnect(true);
        next();
      } catch { socket.disconnect(true); }
    });
  });
}
