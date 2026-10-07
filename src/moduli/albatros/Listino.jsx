import { useState, useEffect, useMemo } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { categorieDi, nomeCategoria, idCategoriaScelta, r2, euro, voceDiNome } from './calcolo'
import SceltaCategoria from './SceltaCategoria'
import IconaCategoria from './IconaCategoria'

// ============================================================
// Il listino del centro. Si riempie da solo con le voci scritte nelle chiusure; qui si ripulisce:
// prezzi standard, categorie, doppioni da unire, voci da archiviare.
// Una voce usata in qualche chiusura non si cancella (il passato la cita): si archivia, e sparisce
// dai suggerimenti, oppure si unisce a un'altra, che si prende le sue righe.
// Chi non è amministratore può solo aggiungere voci: modificare, unire, archiviare e cancellare no.
// Nuova voce e modifica si fanno nello stesso overlay.
// ============================================================

const leggiImporto = (v) => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? r2(n) : NaN; };
const VOCE_VUOTA = { nome: '', categoria: null, prezzo: '' };

function Listino({ user, listino, ricaricaListino, categorie, puoCorreggere }) {
  const [usi, setUsi] = useState({});
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [mostraArchiviate, setMostraArchiviate] = useState(false);
  const [cerca, setCerca] = useState('');
  // La voce nell'overlay: null = chiuso; senza id è una voce nuova.
  const [voceInForm, setVoceInForm] = useState(null);
  const [unione, setUnione] = useState(null);
  const [inCorso, setInCorso] = useState(false);

  const caricaUsi = async () => {
    const { data } = await leggiTutte(() => supabase.from('albatros_righe').select('id, voce_id').order('id'));
    const conta = {};
    (data || []).forEach(r => { conta[r.voce_id] = (conta[r.voce_id] || 0) + 1; });
    setUsi(conta);
  };
   
  useEffect(() => { caricaUsi(); }, []);

  const catListino = categorieDi(categorie, 'listino');
  const visibili = useMemo(() => {
    const testo = cerca.trim().toLowerCase();
    // Si ordina per categoria come le ordina il Configuratore; le voci senza categoria in fondo.
    const posizione = new Map(categorieDi(categorie, 'listino', { ancheArchiviate: true }).map((c, i) => [c.id, i]));
    const pos = (v) => posizione.get(v.categoria_id) ?? Infinity;
    return listino
      .filter(v => mostraArchiviate || v.attiva)
      .filter(v => !filtroCategoria || String(v.categoria_id ?? 'nessuna') === filtroCategoria)
      .filter(v => !testo || v.nome.toLowerCase().includes(testo))
      .sort((a, b) => (pos(a) === pos(b) ? 0 : pos(a) < pos(b) ? -1 : 1) || a.nome.localeCompare(b.nome));
  }, [listino, categorie, filtroCategoria, mostraArchiviate, cerca]);

  const ricarica = async () => { await Promise.all([ricaricaListino(), caricaUsi()]); };

  const validaVoce = (v, idEscluso) => {
    const nome = v.nome.trim().replace(/\s+/g, ' ');
    const prezzo = leggiImporto(v.prezzo);
    if (!nome) return { errore: 'Scrivi il nome della voce.' };
    if (Number.isNaN(prezzo) || prezzo < 0 || String(v.prezzo).trim() === '') return { errore: 'Prezzo non valido.' };
    const doppione = voceDiNome(listino, nome);
    if (doppione && doppione.id !== idEscluso) return { errore: `"${doppione.nome}" c'è già nel listino${doppione.attiva ? '' : ' (archiviata)'}.` };
    return { record: { nome, categoria_id: idCategoriaScelta(v.categoria, categorie, 'listino'), prezzo } };
  };

  const salvaVoce = async () => {
    const { errore, record } = validaVoce(voceInForm, voceInForm.id);
    if (errore) return alert(errore);
    setInCorso(true);
    const { error } = voceInForm.id
      ? await supabase.from('albatros_listino').update(record).eq('id', voceInForm.id)
      : await supabase.from('albatros_listino').insert([{ ...record, creato_da: user.id }]);
    setInCorso(false);
    if (error) return alert(`Errore nel salvataggio: ${error.message}`);
    setVoceInForm(null);
    ricarica();
  };

  const cambiaAttiva = async (v) => {
    const { error } = await supabase.from('albatros_listino').update({ attiva: !v.attiva }).eq('id', v.id);
    if (error) return alert(`Errore: ${error.message}`);
    ricarica();
  };

  const elimina = async (v) => {
    if (usi[v.id]) return alert(`"${v.nome}" compare in ${usi[v.id]} righe di chiusure: non si può cancellare. Archiviala, o uniscila a un'altra voce.`);
    if (!window.confirm(`Cancellare "${v.nome}" dal listino?`)) return;
    const { error } = await supabase.from('albatros_listino').delete().eq('id', v.id);
    if (error) return alert(`Errore: ${error.message}`);
    ricarica();
  };

  // Unire sposta tutte le righe della voce doppione sulla voce giusta, poi cancella il doppione.
  // I prezzi delle righe restano quelli praticati: si cambia solo a quale voce appartengono.
  const confermaUnione = async () => {
    const destinazione = listino.find(v => String(v.id) === String(unione.destinazioneId));
    if (!destinazione) return alert('Scegli la voce in cui unire.');
    if (!window.confirm(`Unire "${unione.voce.nome}" in "${destinazione.nome}"? Le sue ${usi[unione.voce.id] || 0} righe passano a "${destinazione.nome}" e "${unione.voce.nome}" sparisce dal listino.`)) return;
    setInCorso(true);
    try {
      const { error: e1 } = await supabase.from('albatros_righe').update({ voce_id: destinazione.id }).eq('voce_id', unione.voce.id);
      if (e1) return alert(`Errore nello spostare le righe: ${e1.message}`);
      const { error: e2 } = await supabase.from('albatros_listino').delete().eq('id', unione.voce.id);
      if (e2) return alert(`Righe spostate, ma la voce non si è cancellata: ${e2.message}`);
      setUnione(null);
      await ricarica();
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="albatros-pagina no-print">
      <div className="albatros-card">
        <div className="albatros-testata">
          <label className="albatros-etichetta" style={{ flex: '1 1 160px' }}>Cerca
            <input type="text" value={cerca} onChange={(e) => setCerca(e.target.value)} className="albatros-campo" placeholder="Nome" />
          </label>
          <label className="albatros-etichetta" style={{ flex: '1 1 160px' }}>Categoria
            <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} className="albatros-campo">
              <option value="">Tutte</option>
              {catListino.map(c => <option key={c.id} value={String(c.id)}>{c.nome}</option>)}
              <option value="nessuna">Senza categoria</option>
            </select>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.88rem', alignSelf: 'flex-end', paddingBottom: '10px' }}>
            <input type="checkbox" checked={mostraArchiviate} onChange={(e) => setMostraArchiviate(e.target.checked)} /> Anche archiviate
          </label>
          <button type="button" className="btn-accent-inline albatros-bottone" style={{ marginLeft: 'auto', alignSelf: 'flex-end' }} onClick={() => setVoceInForm(VOCE_VUOTA)}>+ Nuova voce</button>
        </div>
        <p className="albatros-nota">Di solito non serve aggiungerle qui: le voci scritte nella Giornata entrano nel listino da sole.</p>

        {visibili.length === 0 && <p className="albatros-vuoto">Nessuna voce.</p>}
        {visibili.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella">
              <thead>
                <tr><th>Voce</th><th>Categoria</th><th className="num">Prezzo</th><th className="num">Usata</th>{puoCorreggere && <th></th>}</tr>
              </thead>
              <tbody>
                {visibili.map(v => (
                  <tr key={v.id} style={{ cursor: 'default', opacity: v.attiva ? 1 : 0.55 }}>
                    <td><strong>{v.nome}</strong>{!v.attiva && <span className="albatros-tenue"> · archiviata</span>}</td>
                    <td><span className="albatros-con-icona"><IconaCategoria categoria={categorie.find(c => c.id === v.categoria_id)} size={12} titolo={false} />{nomeCategoria(categorie, v.categoria_id)}</span></td>
                    <td className="num">{euro(v.prezzo)}</td>
                    <td className="num">{usi[v.id] || 0}</td>
                    {puoCorreggere && <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button type="button" className="btn-icon-action" title="Modifica" onClick={() => setVoceInForm({ id: v.id, nome: v.nome, categoria: String(v.categoria_id ?? ''), prezzo: String(r2(v.prezzo)).replace('.', ',') })} style={{ marginRight: '4px' }}><Icona nome="modifica" size={14} style={{ marginRight: 0 }} /></button>
                      <button type="button" className="btn-icon-action" title="Unisci in un'altra voce" onClick={() => setUnione({ voce: v, destinazioneId: '' })} style={{ marginRight: '4px' }}><Icona nome="unisci" size={14} style={{ marginRight: 0 }} /></button>
                      <button type="button" className="btn-icon-action" title={v.attiva ? 'Archivia' : 'Rimetti in listino'} onClick={() => cambiaAttiva(v)} style={{ marginRight: '4px' }}><Icona nome={v.attiva ? 'archivia' : 'riporta'} size={14} style={{ marginRight: 0 }} /></button>
                      <button type="button" className="btn-icon-action danger" title="Cancella" onClick={() => elimina(v)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {voceInForm && (
        <div className="modal-form-backdrop" onClick={() => setVoceInForm(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setVoceInForm(null)}>✕</button>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: '#0f172a' }}>{voceInForm.id ? `Modifica "${voceInForm.nome}"` : 'Nuova voce'}</h3>
            <div className="albatros-griglia-2">
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Nome
                <input type="text" value={voceInForm.nome} autoFocus placeholder="Es. Caffè, Campo 1h" onChange={(e) => setVoceInForm({ ...voceInForm, nome: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Categoria
                <SceltaCategoria categorie={categorie} tipo="listino" valore={voceInForm.categoria} onChange={(x) => setVoceInForm({ ...voceInForm, categoria: x })} />
              </label>
              <label className="albatros-etichetta">Prezzo €
                <input type="text" inputMode="decimal" value={voceInForm.prezzo} placeholder="0,00" onChange={(e) => setVoceInForm({ ...voceInForm, prezzo: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && salvaVoce()} className="albatros-campo albatros-importo" />
              </label>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setVoceInForm(null)}>Annulla</button>
              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={salvaVoce}><Icona nome="salva" />{voceInForm.id ? 'Salva' : 'Aggiungi'}</button>
            </div>
          </div>
        </div>
      )}

      {unione && (
        <div className="modal-form-backdrop" onClick={() => setUnione(null)}>
          <div className="modal-form-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setUnione(null)}>✕</button>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.05rem', color: '#0288d1' }}>Unisci "{unione.voce.nome}"</h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: '#475569' }}>
              Le sue {usi[unione.voce.id] || 0} righe passano alla voce che scegli, con i prezzi a cui sono state vendute. Poi "{unione.voce.nome}" sparisce dal listino.
            </p>
            <select value={unione.destinazioneId} onChange={(e) => setUnione({ ...unione, destinazioneId: e.target.value })} className="albatros-campo" style={{ width: '100%' }}>
              <option value="">Scegli la voce giusta…</option>
              {listino.filter(v => v.id !== unione.voce.id).sort((a, b) => a.nome.localeCompare(b.nome)).map(v => (
                <option key={v.id} value={v.id}>{v.nome} · {euro(v.prezzo)}{v.attiva ? '' : ' (archiviata)'}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: '10px', marginTop: '14px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-outline-annulla" onClick={() => setUnione(null)} style={{ padding: '8px 16px' }}>Annulla</button>
              <button type="button" className="btn-accent-inline" disabled={inCorso || !unione.destinazioneId} onClick={confermaUnione} style={{ padding: '8px 16px' }}>Unisci</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Listino
