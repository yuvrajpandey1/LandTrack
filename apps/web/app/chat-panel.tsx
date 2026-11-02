'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Flag, MessageCircle, Paperclip, Send } from 'lucide-react';
import { ApiError, useSession } from './session-provider';

type Person = { id: string; name: string; role: string };
type Conversation = {
  id: string;
  property: { id: string; name: string };
  participants: Person[];
  lastMessage: { body: string | null; sentAt: string } | null;
  unreadCount: number;
};
type ChatMessage = {
  id: string;
  body: string | null;
  sentAt: string;
  reported: boolean;
  sender: Person | null;
  attachment: { id: string; mimeType: string; scanStatus: string } | null;
};

const roleLabel: Record<string, string> = { NRI: 'NRI', AGENT: 'Agent', ADMIN: 'Admin', AUDITOR: 'Auditor' };

function message(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  return cause instanceof Error ? cause.message : 'The request could not be completed. Please try again.';
}

const timeFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export function ChatPanel() {
  const { request, user } = useSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const threadEnd = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const result = await request<Conversation[]>('conversations');
    setConversations(result);
    setActiveId((current) => current || result[0]?.id || '');
  }, [request]);

  const loadMessages = useCallback(async (id: string) => {
    const result = await request<{ items: ChatMessage[] }>(`conversations/${id}/messages`);
    setMessages(result.items);
  }, [request]);

  useEffect(() => {
    let active = true;
    loadConversations()
      .catch((cause: unknown) => { if (active) setError(message(cause)); })
      .finally(() => { if (active) setLoading(false); });
    const timer = window.setInterval(() => { void loadConversations().catch(() => undefined); }, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [loadConversations]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return undefined; }
    let active = true;
    const refresh = () => loadMessages(activeId).catch((cause: unknown) => { if (active) setError(message(cause)); });
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activeId, loadMessages]);

  useEffect(() => { threadEnd.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  const active = conversations.find((item) => item.id === activeId);
  const others = active?.participants.filter((person) => person.id !== user?.id) ?? [];

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || !activeId) return;
    setBusy(true);
    setError('');
    try {
      await request(`conversations/${activeId}/messages`, { method: 'POST', body: JSON.stringify({ text: body }) });
      setText('');
      await loadMessages(activeId);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const attach = async (file: File | undefined) => {
    if (!file || !activeId) return;
    setBusy(true);
    setError('');
    try {
      const presign = await request<{ attachmentId: string; uploadUrl: string }>(`conversations/${activeId}/attachments/presign`, {
        method: 'POST', body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size })
      });
      const upload = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
      if (!upload.ok) throw new Error('The attachment could not be uploaded.');
      await request(`conversations/${activeId}/attachments/${presign.attachmentId}/complete`, { method: 'POST' });
      await request(`conversations/${activeId}/messages`, { method: 'POST', body: JSON.stringify({ attachmentId: presign.attachmentId }) });
      await loadMessages(activeId);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const openAttachment = async (attachmentId: string) => {
    try {
      const result = await request<{ url: string }>(`conversations/${activeId}/attachments/${attachmentId}/url`);
      window.open(result.url, '_blank', 'noopener');
    } catch (cause) {
      setError(message(cause));
    }
  };

  const report = async (messageId: string) => {
    try {
      await request(`conversations/${activeId}/messages/${messageId}/report`, { method: 'POST' });
      setNotice('Message reported. An administrator will review it.');
      await loadMessages(activeId);
    } catch (cause) {
      setError(message(cause));
    }
  };

  if (loading) return <p className="empty-cell">Loading conversations…</p>;

  return (
    <section className="card chat-shell">
      <aside className="chat-list" aria-label="Conversations">
        <h2>Conversations</h2>
        {conversations.length === 0 && <p className="empty-cell">No conversations yet. A chat opens once an appointment is booked and an agent is assigned.</p>}
        {conversations.map((item) => {
          const names = item.participants.filter((person) => person.id !== user?.id).map((person) => `${person.name} (${roleLabel[person.role] ?? person.role})`).join(', ');
          return (
            <button key={item.id} type="button" className={`chat-list-item ${item.id === activeId ? 'selected' : ''}`} onClick={() => { setActiveId(item.id); setNotice(''); }}>
              <strong>{item.property.name}</strong>
              <small>{names || 'Waiting for participants'}</small>
              <span>{item.lastMessage?.body ?? (item.lastMessage ? 'Attachment' : 'No messages yet')}</span>
              {item.unreadCount > 0 && <em className="chat-unread">{item.unreadCount}</em>}
            </button>
          );
        })}
      </aside>
      <div className="chat-thread">
        {!active ? <div className="empty-state"><MessageCircle size={28} /><h2>Select a conversation</h2><p>Your messages are linked to the property and appointment.</p></div> : (
          <>
            <header className="chat-thread-head"><div><h2>{active.property.name}</h2><p>{others.map((person) => `${person.name} (${roleLabel[person.role] ?? person.role})`).join(' · ') || 'No other participants yet'}</p></div></header>
            <div className="chat-messages" role="log" aria-live="polite">
              {messages.length === 0 && <p className="empty-cell">No messages yet. Say hello.</p>}
              {messages.map((item) => {
                const mine = item.sender?.id === user?.id;
                return (
                  <div key={item.id} className={`chat-bubble ${mine ? 'mine' : 'theirs'}`}>
                    {!mine && <strong>{item.sender?.name ?? 'System'} <small>{item.sender ? roleLabel[item.sender.role] : ''}</small></strong>}
                    {item.body && <p>{item.body}</p>}
                    {item.attachment && <button type="button" className="text-action" onClick={() => { void openAttachment(item.attachment!.id); }}><Paperclip size={14} />Open attachment</button>}
                    <small>{timeFormat.format(new Date(item.sentAt))}{!mine && !item.reported && <button type="button" className="chat-report" aria-label="Report message" onClick={() => { void report(item.id); }}><Flag size={12} /></button>}{item.reported && ' · Reported'}</small>
                  </div>
                );
              })}
              <div ref={threadEnd} />
            </div>
            {notice && <p className="form-success" role="status">{notice}</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <form className="chat-compose" onSubmit={(event) => { void send(event); }}>
              <label className="chat-attach" aria-label="Attach a file"><Paperclip size={18} /><input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={busy} onChange={(event) => { void attach(event.target.files?.[0]); event.target.value = ''; }} /></label>
              <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Type a message" maxLength={5000} aria-label="Message" />
              <button className="button button-primary" type="submit" disabled={busy || !text.trim()}><Send size={16} />Send</button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
