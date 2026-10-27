import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Users, X, Search } from 'lucide-react';
import './friends.css';

export default function Friends({ socket, identity, users, Dialog, onMessage }) {
  const [open, setOpen] = useState(false), [tab, setTab] = useState('friends'), [search, setSearch] = useState('');
  const [relationships, setRelationships] = useState([]), [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  function refresh() {
    if (!socket.connected) return;
    const version = ++generation.current; setLoading(true);
    socket.timeout(10000).emit('friends:list', {}, (err, result) => {
      if (version !== generation.current) return;
      setLoading(false);
      if (err || !result?.ok) { setError(result?.error || 'Could not load friends.'); return; }
      setRelationships(result.relationships); setError('');
    });
  }
  useEffect(() => {
    const connect = () => { setConnected(true); refresh(); };
    const disconnect = () => { generation.current++; setConnected(false); setLoading(false); };
    socket.on('connect', connect); socket.on('disconnect', disconnect); socket.on('friends:changed', refresh);
    if (socket.connected) connect();
    return () => { generation.current++; socket.off('connect', connect); socket.off('disconnect', disconnect); socket.off('friends:changed', refresh); };
  }, [socket, identity._id]);
  function action(event, payload) {
    if (busy || !connected) return;
    setBusy(true); setError('');
    socket.timeout(10000).emit(event, payload, (err, result) => {
      setBusy(false);
      if (err || !result?.ok) { setError(result?.error || 'The update could not be confirmed. Refresh before retrying.'); return; }
      refresh();
    });
  }
  const incoming = relationships.filter(r => r.status === 'pending' && r.direction === 'incoming');
  const friends = relationships.filter(r => r.status === 'accepted');
  const visible = relationships.filter(r => tab === 'friends' ? r.status === 'accepted' : r.status === 'pending');
  const matches = name => name.toLowerCase().includes(search.toLowerCase());
  const candidates = users.filter(u => u._id !== identity._id && matches(u.username));
  return <>
    <button className="create-room friend-launch" onClick={() => { setOpen(true); refresh(); }}><Users size={17}/> Friends {incoming.length > 0 && <b className="dm-badge" aria-label={`${incoming.length} incoming requests`}>{incoming.length}</b>}</button>
    {open && createPortal(<div className="modal-backdrop"><Dialog labelledBy="friends-title" onDismiss={() => setOpen(false)}><div className="friends-panel">
      <header className="friends-header"><div><h2 id="friends-title">Your people.</h2><p>{friends.length} friends · {incoming.length} incoming requests</p></div><button className="icon-button" aria-label="Close friends" onClick={() => setOpen(false)}><X/></button></header>
      <div className="friend-tabs" aria-label="Friend filters">{[['friends','Friends'],['requests','Requests'],['discover','Add friends']].map(([key,label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
      <label className="friend-search"><Search size={17}/><input aria-label="Search people by display name" placeholder="Search by display name" value={search} onChange={e => setSearch(e.target.value)}/></label>
      {!connected && <p role="status">Reconnecting…</p>}{loading && <p role="status">Loading friends…</p>}{error && <p role="alert" className="dialog-error">{error} <button onClick={refresh} disabled={!connected}>Refresh</button></p>}
      <div className="friend-list">
        {tab === 'discover' ? candidates.map(u => {
          const relation = relationships.find(r => r.userId === u._id);
          return <div className="friend-row" key={u._id}><div><strong>{u.username}</strong><small>{u.online ? 'Online' : 'Offline'}</small></div>{relation ? <span className="friend-status">{relation.status === 'accepted' ? 'Friends' : relation.direction === 'incoming' ? 'Incoming request' : 'Request sent'}</span> : <button disabled={!connected || busy || loading} onClick={() => action('friends:request', { userId: u._id })}>Add friend</button>}</div>;
        }) : visible.filter(r => matches(r.username)).map(r => <div className="friend-row" key={r._id}><div><strong>{r.username}</strong><small>{r.status === 'accepted' ? users.find(u => u._id === r.userId)?.online ? 'Online' : 'Offline' : r.direction === 'incoming' ? 'Wants to be your friend' : 'Request sent'}</small></div><div className="friend-actions">
          {r.status === 'accepted' ? <button disabled={!connected} onClick={() => { setOpen(false); onMessage(r.userId); }}>Message</button> : r.direction === 'incoming' && <button disabled={!connected || busy} onClick={() => action('friends:accept', { relationshipId: r._id })}>Accept</button>}
          <button className="friend-secondary" disabled={!connected || busy} onClick={() => action('friends:remove', { relationshipId: r._id })}>{r.status === 'accepted' ? 'Remove' : r.direction === 'incoming' ? 'Decline' : 'Cancel'}</button>
        </div></div>)}
        {!loading && (tab === 'discover' ? !candidates.length : !visible.some(r => matches(r.username))) && <p className="friend-empty">{tab === 'friends' ? 'No friends found. Visit Add friends to send your first request.' : tab === 'requests' ? 'No friend requests.' : 'No matching users. Invite someone to register.'}</p>}
      </div>
    </div></Dialog></div>, document.body)}
  </>;
}
