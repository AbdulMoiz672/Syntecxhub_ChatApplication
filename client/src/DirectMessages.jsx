import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, X, Send, ArrowLeft } from 'lucide-react';
import './direct.css';

const merge = (a, b) => [...new Map([...a, ...b].map(m => [m._id, m])).values()].sort((a, b) => a._id.localeCompare(b._id));
export default function DirectMessages({ socket, identity, Dialog }) {
  const [open, setOpen] = useState(false), [ready, setReady] = useState(false), [self, setSelf] = useState(null);
  const [users, setUsers] = useState([]), [selected, setSelected] = useState(null), [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState({}), [text, setText] = useState(''), [error, setError] = useState('');
  const [loading, setLoading] = useState(false), [sending, setSending] = useState(false), [more, setMore] = useState(false);
  const active = useRef(null), selfRef = useRef(null), visible = useRef(false), generation = useRef(0), bottom = useRef(null);
  visible.current = open;
  useEffect(() => {
    if (!identity) return;
    let disposed = false;
    function identify() {
      setReady(false);
      socket.timeout(10000).emit('direct:identify', {}, (err, result) => {
        if (disposed) return;
        if (err || !result?.ok) { setError(result?.error || 'Could not connect direct messages.'); return; }
        selfRef.current = result.user._id; setSelf(result.user); setUsers(result.users); setReady(true); setError('');
      });
    }
    const disconnect = () => { setReady(false); generation.current++; };
    const directory = list => setUsers(list);
    const message = m => {
      const peer = m.senderId === selfRef.current ? m.recipientId : m.senderId;
      if (active.current === peer) setMessages(prev => merge(prev, [m]));
      if (m.senderId !== selfRef.current && !(visible.current && active.current === peer)) setUnread(prev => ({ ...prev, [peer]: (prev[peer] || 0) + 1 }));
    };
    socket.on('connect', identify); socket.on('disconnect', disconnect); socket.on('direct:directory', directory); socket.on('direct:message', message);
    if (socket.connected) identify();
    return () => { disposed = true; socket.off('connect', identify); socket.off('disconnect', disconnect); socket.off('direct:directory', directory); socket.off('direct:message', message); };
  }, [identity, socket]);
  useEffect(() => {
    if (!ready || !selected || !open) return;
    const version = ++generation.current;
    active.current = selected; setMessages([]); setLoading(true); setError(''); setUnread(prev => ({ ...prev, [selected]: 0 }));
    socket.timeout(10000).emit('direct:history', { userId: selected }, (err, result) => {
      if (version !== generation.current) return;
      setLoading(false);
      if (err || !result?.ok) { setError(result?.error || 'Could not load conversation. Close and reopen to retry.'); return; }
      setMessages(prev => merge(result.messages, prev)); setMore(result.messages.length === 50);
    });
    return () => { generation.current++; active.current = null; };
  }, [ready, selected, open, socket]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, open]);
  function send(e) {
    e.preventDefault(); if (!ready || !selected || !text.trim() || sending) return;
    const peer = selected, body = text.trim(); setSending(true); setError('');
    socket.timeout(10000).emit('direct:send', { userId: peer, text: body }, (err, result) => {
      setSending(false);
      if (err || !result?.ok) { setError(result?.error || 'Delivery could not be confirmed. Check history before retrying.'); return; }
      if (active.current === peer) { setMessages(prev => merge(prev, [result.message])); setText(''); }
    });
  }
  function older() {
    if (loading || !messages.length) return;
    const peer = selected, version = generation.current; setLoading(true);
    socket.timeout(10000).emit('direct:history', { userId: peer, before: messages[0]._id }, (err, result) => {
      if (version !== generation.current) return;
      setLoading(false);
      if (err || !result?.ok) { setError(result?.error || 'Could not load older messages.'); return; }
      setMessages(prev => merge(result.messages, prev)); setMore(result.messages.length === 50);
    });
  }
  const total = Object.values(unread).reduce((a, b) => a + b, 0), peer = users.find(u => u._id === selected);
  return <>
    <button className="create-room direct-launch" onClick={() => setOpen(true)} disabled={!identity}><MessageSquare size={17}/> Direct messages {total > 0 && <b className="dm-badge">{total}</b>}</button>
    {open && createPortal(<div className="modal-backdrop"><Dialog labelledBy="direct-title" onDismiss={() => setOpen(false)}><div className="dm-shell">
      <header className="dm-top"><div><h2 id="direct-title">Direct messages</h2><p>One-to-one conversations</p></div><button className="icon-button" aria-label="Close direct messages" onClick={() => setOpen(false)}><X/></button></header>
      {!ready && <p role="status">Connecting direct messages…</p>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className={'dm-layout ' + (selected ? 'dm-selected' : '')}><aside className="dm-users" aria-label="People">
        <p className="dm-label">PEOPLE</p>{users.filter(u => u._id !== self?._id).map(u => <button className={'dm-person ' + (u._id === selected ? 'selected' : '')} key={u._id} onClick={() => { setSelected(u._id); setText(''); }}><span className={u.online ? 'online-dot' : 'offline-dot'}/><span>{u.username}<small>{u.online ? 'Online' : 'Offline'}</small></span>{unread[u._id] > 0 && <b className="dm-badge">{unread[u._id]}</b>}</button>)}
        {ready && users.filter(u => u._id !== self?._id).length === 0 && <p>No other users yet. Open the app in another browser profile to start chatting.</p>}
      </aside><section className="dm-thread" aria-label="Direct conversation">
        {peer ? <><header className="dm-peer"><button className="icon-button" aria-label="Back to people" onClick={() => setSelected(null)}><ArrowLeft size={18}/></button><strong>{peer.username}</strong><small>{peer.online ? 'Online' : 'Offline · messages will be saved'}</small></header>
        <div className="dm-messages" aria-live="polite">{more && <button className="older" onClick={older} disabled={loading}>Load earlier messages</button>}{loading && <p>Loading history…</p>}{!loading && !messages.length && <p>Say hello to {peer.username}.</p>}{messages.map(m => <article key={m._id} className={'dm-message ' + (m.senderId === self?._id ? 'dm-mine' : '')}><strong>{m.senderId === self?._id ? 'You' : m.sender}</strong><p>{m.text}</p><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time></article>)}<div ref={bottom}/></div>
        <form className="dm-compose" onSubmit={send}><textarea aria-label={`Message ${peer.username}`} placeholder={`Message ${peer.username}`} value={text} maxLength={2000} disabled={!ready || sending} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(e); } }}/><button className="send-button" disabled={!ready || sending || !text.trim()} aria-label="Send direct message"><Send size={17}/>{sending ? 'Sending…' : 'Send'}</button></form></> : <div className="dm-empty"><MessageSquare size={32}/><h3>A conversation, just for two.</h3><p>Choose someone to send a direct message.</p></div>}
    </section></div></div></Dialog></div>, document.body)}
  </>;
}
