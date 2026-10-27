import React, { useEffect, useState } from 'react';
import { Radio, ArrowRight, LogOut } from 'lucide-react';

export default function Auth({ children }) {
  const [user, setUser] = useState(null), [checking, setChecking] = useState(true), [mode, setMode] = useState('login');
  const [username, setUsername] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    fetch('/api/auth/me').then(async r => { if (r.ok) { const data = await r.json(); if (!disposed) setUser(data.user); } }).catch(() => { if (!disposed) setError('Unable to reach the server. Please try again.'); }).finally(() => { if (!disposed) setChecking(false); });
    const expired = () => { setUser(null); setError('Your session has ended. Please log in again.'); };
    window.addEventListener('relay-auth-expired', expired);
    return () => { disposed = true; window.removeEventListener('relay-auth-expired', expired); };
  }, []);
  async function submit(e) {
    e.preventDefault(); setError('');
    if (mode === 'register' && password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password, legacyToken: mode === 'register' ? localStorage.getItem('relay-direct-token') : undefined }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to sign in.');
      setPassword(''); setConfirm(''); localStorage.removeItem('relay-identity'); localStorage.removeItem('relay-direct-token'); setUser(data.user);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try { const r = await fetch('/api/auth/logout', { method: 'POST' }); if (!r.ok) throw new Error('Unable to log out. Please try again.'); setUser(null); setError(''); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  if (checking) return <div className="auth-page"><p role="status">Opening Relay…</p></div>;
  if (user) return <>{error && <div className="auth-notice" role="alert">{error}</div>}{children(user, <button className="icon-button" aria-label="Log out" title="Log out" disabled={busy} onClick={logout}><LogOut size={18}/></button>)}</>;
  return <main className="auth-page"><section className="dialog auth-card" aria-labelledby="auth-title"><div className="dialog-mark"><Radio size={27}/></div><span className="eyebrow">YOUR PEOPLE. YOUR CONVERSATIONS.</span><h2 id="auth-title">{mode === 'login' ? 'Welcome back.' : 'Make yourself at home.'}</h2><p>{mode === 'login' ? 'Log in to pick up where you left off.' : 'Create an account and start a conversation.'}</p><div className="auth-tabs"><button type="button" aria-pressed={mode === 'login'} disabled={busy} onClick={() => { setMode('login'); setError(''); }}>Log in</button><button type="button" aria-pressed={mode === 'register'} disabled={busy} onClick={() => { setMode('register'); setError(''); }}>Register</button></div><form onSubmit={submit}>
    {mode === 'register' && <><label htmlFor="auth-name">Display name</label><input id="auth-name" autoComplete="nickname" value={username} onChange={e => setUsername(e.target.value)} maxLength={32} required disabled={busy}/></>}
    <label htmlFor="auth-email">Email</label><input id="auth-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} required disabled={busy}/>
    <label htmlFor="auth-password">Password</label><input id="auth-password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 8 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required disabled={busy}/>
    {mode === 'register' && <><small className="password-hint">Use at least 8 characters.</small><label htmlFor="auth-confirm">Confirm password</label><input id="auth-confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} maxLength={128} required disabled={busy}/></>}
    {error && <p className="dialog-error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}<ArrowRight size={17}/></button>
  </form></section></main>;
}
