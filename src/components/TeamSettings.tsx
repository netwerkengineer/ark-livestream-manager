"use client";
import React, { useEffect, useState } from 'react';

export interface Contact {
  id: string;
  name: string;
  role: 'band' | 'operator' | 'other';
  email?: string;
  phone?: string;
  active?: boolean;
}

const ROLE_LABELS: Record<Contact['role'], string> = {
  band: 'Band',
  operator: 'Beamer-operator',
  other: 'Overig'
};

// Self-contained, like BackupRestoreSettings/ActivityLogPanel - contacts
// are operational data (data/contacts.json), not app config, so this
// fetches/saves via its own /api/contacts route rather than going through
// the shared settings-save button.
export default function TeamSettings() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    fetch('/api/contacts')
      .then(res => res.json())
      .then(data => {
        if (data.success) setContacts(data.contacts || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async (next: Contact[]) => {
    setContacts(next);
    setSaving(true);
    setStatus('');
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: next })
      });
      const data = await res.json();
      setStatus(data.success ? '✅ Opgeslagen' : `❌ ${data.error}`);
    } catch (e: any) {
      setStatus(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const addContact = () => {
    const contact: Contact = { id: `contact_${Date.now()}`, name: 'Nieuw contact', role: 'band', active: true };
    save([...contacts, contact]);
  };

  const updateContact = (idx: number, patch: Partial<Contact>) => {
    const next = [...contacts];
    next[idx] = { ...next[idx], ...patch };
    save(next);
  };

  const removeContact = (idx: number) => {
    save(contacts.filter((_, i) => i !== idx));
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem', opacity: 0.5 }}>Laden...</div>;
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
        <h3 style={{ fontSize: '1.25rem' }}>👥 Team (worship band & operator)</h3>
        <button type="button" className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.85rem', borderRadius: '8px' }} onClick={addContact} disabled={saving}>
          + Contact toevoegen
        </button>
      </div>

      <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>
        Deze lijst wordt gebruikt bij &quot;Verstuur naar team&quot; in de Setlist-bouwer. Wijzigingen hier worden direct opgeslagen, los van de rest van de instellingen.
        {status && <span style={{ marginLeft: '0.6rem' }}>{status}</span>}
      </p>

      {contacts.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: '20px 10px', background: 'rgba(255,255,255,0.01)', borderRadius: '12px' }}>
          Nog geen contactpersonen. Voeg er een toe om te beginnen.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {contacts.map((contact, idx) => (
          <div
            key={contact.id}
            className="glass-card"
            style={{ padding: '16px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <input
                className="input-field"
                style={{ fontWeight: 'bold', fontSize: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'transparent', padding: '4px 8px', flex: 1, minWidth: '160px' }}
                placeholder="Naam"
                value={contact.name}
                onChange={e => updateContact(idx, { name: e.target.value })}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
                <input type="checkbox" checked={contact.active !== false} onChange={e => updateContact(idx, { active: e.target.checked })} />
                Actief
              </label>
              <button
                type="button"
                className="btn-danger"
                style={{ padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#ef4444', cursor: 'pointer' }}
                onClick={() => removeContact(idx)}
              >
                Verwijderen
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Rol</label>
                <select
                  className="input-field"
                  value={contact.role}
                  onChange={e => updateContact(idx, { role: e.target.value as Contact['role'] })}
                >
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>E-mail</label>
                <input
                  className="input-field"
                  placeholder="naam@voorbeeld.nl"
                  value={contact.email || ''}
                  onChange={e => updateContact(idx, { email: e.target.value.trim() })}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Telefoon (voor WhatsApp)</label>
                <input
                  className="input-field"
                  placeholder="06-12345678"
                  value={contact.phone || ''}
                  onChange={e => updateContact(idx, { phone: e.target.value.trim() })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
