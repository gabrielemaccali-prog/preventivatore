import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'

// ============================================================
// Le categorie delle spese di Albatros, a due livelli come nel modulo Spese di BFM. Le categorie
// che c'erano sono tutte secondarie (quelle a cui vanno le spese): sopra si creano le principali,
// che le raggruppano (gruppo = true). Una secondaria si sposta da una principale all'altra, o resta
// "da raggruppare", senza che cambi niente nelle spese che la usano. Le secondarie nuove nascono
// dentro una principale, come in BFM. Nome e principale si cambiano sulla riga, aperta col
// pulsante matita, e si scrivono con Salva.
// Una voce usata non si cancella: si archivia e sparisce dalle scelte. Chi non è amministratore
// può solo aggiungere.
// ============================================================

const ordina = (a, b) => a.ordine - b.ordine || a.nome.localeCompare(b.nome);

function CategorieSpese({ categorie, usi, ricarica, puoCorreggere }) {
  const [nuove, setNuove] = useState({});
  // La riga in modifica (nome e, per una secondaria, la principale): una per volta.
  const [inModifica, setInModifica] = useState(null);
  const [inCorso, setInCorso] = useState(false);

  const principali = categorie.filter(c => c.gruppo).sort(ordina);
  const figlieDi = (p) => categorie.filter(c => !c.gruppo && c.padre_id === p.id).sort(ordina);
  const daRaggruppare = categorie.filter(c => !c.gruppo && c.padre_id == null).sort(ordina);

  const scrivi = async (fn) => {
    setInCorso(true);
    try {
      const { error } = await fn();
      if (error) {
        alert(error.code === '23505' ? 'Esiste già una categoria con questo nome a questo livello.' : `Errore: ${error.message}`);
        return false;
      }
      await ricarica();
      return true;
    } finally {
      setInCorso(false);
    }
  };

  const prossimoOrdine = (sorelle) => Math.max(0, ...sorelle.map(c => c.ordine || 0)) + 1;

  // padre = null: una principale nuova; altrimenti una secondaria dentro quella principale.
  const aggiungi = async (padre) => {
    const chiave = padre?.id ?? 'principale';
    const nome = (nuove[chiave] || '').trim().replace(/\s+/g, ' ');
    if (!nome) return;
    const record = padre
      ? { tipo: 'spesa', nome, gruppo: false, padre_id: padre.id, ordine: prossimoOrdine(figlieDi(padre)) }
      : { tipo: 'spesa', nome, gruppo: true, padre_id: null, ordine: prossimoOrdine(principali) };
    if (await scrivi(() => supabase.from('albatros_categorie').insert([record]))) setNuove({ ...nuove, [chiave]: '' });
  };

  // Salva la riga: il nome e, per una secondaria, la principale. Cambiando principale va in fondo
  // alle sorelle nuove.
  const salvaRiga = async () => {
    const c = categorie.find(x => x.id === inModifica.id);
    const nome = inModifica.nome.trim().replace(/\s+/g, ' ');
    if (!nome) return alert('Scrivi il nome.');
    const record = { nome };
    if (!c.gruppo && (inModifica.padre_id ?? null) !== (c.padre_id ?? null)) {
      record.padre_id = inModifica.padre_id;
      record.ordine = prossimoOrdine(inModifica.padre_id == null ? daRaggruppare : figlieDi({ id: inModifica.padre_id }));
    }
    if (await scrivi(() => supabase.from('albatros_categorie').update(record).eq('id', c.id))) setInModifica(null);
  };

  const sposta = async (sorelle, i, verso) => {
    const nuovo = [...sorelle];
    const j = i + verso;
    if (j < 0 || j >= nuovo.length) return;
    [nuovo[i], nuovo[j]] = [nuovo[j], nuovo[i]];
    await scrivi(async () => {
      for (const [k, c] of nuovo.entries()) {
        if (c.ordine === k + 1) continue;
        const { error } = await supabase.from('albatros_categorie').update({ ordine: k + 1 }).eq('id', c.id);
        if (error) return { error };
      }
      return { error: null };
    });
  };

  const elimina = async (c) => {
    if (!window.confirm(`Eliminare "${c.nome}"?`)) return;
    await scrivi(() => supabase.from('albatros_categorie').delete().eq('id', c.id));
  };

  const riga = (c, sorelle, i, { principale = false } = {}) => {
    const n = principale ? 0 : usi(c);
    const eliminabile = principale ? figlieDi(c).length === 0 : n === 0;
    const modifica = inModifica?.id === c.id;
    return (
      <div className="albatros-riga" style={{ gap: '8px', opacity: c.attiva ? 1 : 0.55, flexWrap: 'wrap', paddingLeft: principale ? 0 : '28px' }}>
        {puoCorreggere && (
          <span style={{ whiteSpace: 'nowrap' }}>
            <button type="button" className="btn-icon-action" title="Su" disabled={inCorso || i === 0} onClick={() => sposta(sorelle, i, -1)}>▲</button>
            <button type="button" className="btn-icon-action" title="Giù" disabled={inCorso || i === sorelle.length - 1} onClick={() => sposta(sorelle, i, 1)}>▼</button>
          </span>
        )}
        {!principale && <span className="albatros-tenue">›</span>}
        {modifica
          ? <input type="text" value={inModifica.nome} autoFocus onChange={(e) => setInModifica({ ...inModifica, nome: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') salvaRiga(); if (e.key === 'Escape') setInModifica(null); }} className="albatros-campo"
              style={{ flex: '1 1 180px', height: '34px', fontWeight: principale ? 700 : 400 }} />
          : <span style={{ flex: '1 1 180px', fontWeight: principale ? 700 : 400 }}>{c.nome}</span>}
        {!principale && modifica && (
          <select value={inModifica.padre_id == null ? '' : String(inModifica.padre_id)} title="La categoria principale che la raggruppa"
            onChange={(e) => setInModifica({ ...inModifica, padre_id: e.target.value === '' ? null : Number(e.target.value) })} className="albatros-campo" style={{ flex: '0 1 210px', height: '34px' }}>
            <option value="">Da raggruppare</option>
            {principali.map(p => <option key={p.id} value={String(p.id)}>Sotto {p.nome}</option>)}
          </select>
        )}
        {!principale && <span className="albatros-tenue" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{n === 1 ? '1 uso' : `${n} usi`}</span>}
        {puoCorreggere && (modifica
          ? <span style={{ whiteSpace: 'nowrap' }}>
                            <button type="button" className="btn-accent-inline" disabled={inCorso} onClick={salvaRiga} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem', padding: '3px 8px' }}><Icona nome="salva" size={13} style={{ marginRight: '4px' }} />Salva</button>
                            <button type="button" className="btn-outline-annulla" disabled={inCorso} onClick={() => setInModifica(null)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem', padding: '3px 8px', borderRadius: '4px' }}><Icona nome="annulla" size={13} style={{ marginRight: '4px' }} />Annulla</button>
                          </span>
          : <button type="button" className="btn-icon-action" title={inModifica ? 'Finisci prima la categoria che stai modificando' : 'Modifica'} disabled={!!inModifica}
              onClick={() => setInModifica({ id: c.id, nome: c.nome, padre_id: c.padre_id ?? null })}><Icona nome="modifica" size={14} style={{ marginRight: 0 }} /></button>)}
        {puoCorreggere && !modifica && (
          <button type="button" className="albatros-chip" disabled={inCorso} onClick={() => scrivi(() => supabase.from('albatros_categorie').update({ attiva: !c.attiva }).eq('id', c.id))}>
            {c.attiva ? 'Archivia' : 'Riattiva'}
          </button>
        )}
        {puoCorreggere && eliminabile && !modifica && <button type="button" className="btn-icon-action danger" title="Elimina" disabled={inCorso} onClick={() => elimina(c)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>}
      </div>
    );
  };

  const campoNuova = (padre) => {
    const chiave = padre?.id ?? 'principale';
    return (
      <div style={{ display: 'flex', gap: '8px', marginTop: '6px', paddingLeft: padre ? '28px' : 0 }}>
        <input type="text" value={nuove[chiave] || ''} placeholder={padre ? `Nuova categoria sotto ${padre.nome}` : 'Nuova categoria principale'}
          onChange={(e) => setNuove({ ...nuove, [chiave]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && aggiungi(padre)}
          className="albatros-campo" style={{ height: '34px' }} />
        <button type="button" className={padre ? 'albatros-chip' : 'btn-accent-inline albatros-bottone'} disabled={inCorso} onClick={() => aggiungi(padre)}>+ Aggiungi</button>
      </div>
    );
  };

  return (
    <div className="albatros-card">
      <div className="albatros-titolo" style={{ fontWeight: 700, color: '#0f172a' }}>Categorie delle spese</div>
      <p className="albatros-nota" style={{ marginTop: '2px' }}>
        A due livelli come nel modulo Spese di BFM: le principali raggruppano le categorie a cui vanno le spese. Le categorie che c'erano sono tutte di secondo livello: raggruppale scegliendo la loro principale. Spostarle non cambia niente nelle spese.
      </p>

      {principali.length === 0 && <p className="albatros-vuoto">Ancora nessuna categoria principale: creane una qui sotto.</p>}
      {principali.map((p, i) => (
        <div key={p.id} style={{ marginTop: '10px', paddingTop: '8px', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
          {riga(p, principali, i, { principale: true })}
          {figlieDi(p).map((c, k, sorelle) => <div key={c.id}>{riga(c, sorelle, k)}</div>)}
          {figlieDi(p).length === 0 && <p className="albatros-vuoto" style={{ margin: '4px 0 0 28px' }}>Nessuna categoria: aggiungine una, o raggruppa qui quelle da raggruppare.</p>}
          {p.attiva && campoNuova(p)}
        </div>
      ))}
      <div style={{ marginTop: '14px' }}>{campoNuova(null)}</div>

      {daRaggruppare.length > 0 && (
        <div style={{ marginTop: '18px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}>
          <div className="albatros-titolo" style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem' }}>Da raggruppare ({daRaggruppare.length})</div>
          <p className="albatros-nota" style={{ marginTop: '2px' }}>Si usano già nelle spese; scegli la loro categoria principale.</p>
          {daRaggruppare.map((c, k) => <div key={c.id}>{riga(c, daRaggruppare, k)}</div>)}
        </div>
      )}
    </div>
  );
}

export default CategorieSpese
