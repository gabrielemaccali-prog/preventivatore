import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import Icona from '../../components/Icona'
import { useOrdinamentoTabella } from '../../lib/ordinamentoTabella'

// Il catalogo è l'elenco dei giochi come cose a sé: "Calcio Balilla Umano" è uno, anche se
// fisicamente ne esistono quattro esemplari presso quattro fornitori diversi, con prezzi e
// schede tecniche diverse. Quelli stanno a listino (Preventivatore > Gonfiabili) e puntano qui.
//
// Serve a rispondere alle domande che hanno per soggetto il gioco e non la singola struttura:
// quante partite di Archery abbiamo fatto, quanto ha reso il Calcio Balilla, quanto pesa la
// famiglia Biliardino. Famiglia e centro di ricavo sono i due livelli di raggruppamento.

const GIOCO_VUOTO = { nome: '', nome_breve: '', famiglia: '', centro_ricavo: '', per_pacchetti: false, attivo: true };

// I valori già usati diventano suggerimenti: famiglia e centro di ricavo restano testo libero
// — come "centroRicavo" e "centroCosto" che esistono già — ma dopo averne scritto uno la volta
// dopo si sceglie invece di ridigitarlo, e "Biliardino" non diventa anche "biliardino".
const valoriUsati = (righe, campo) => [...new Set(righe.map(r => r[campo]).filter(Boolean))].sort();

const stileInput = { width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' };
const testoVuoto = <span style={{ color: '#cbd5e1' }}>—</span>;

function Catalogo({ user }) {
  const [giochi, setGiochi] = useState([]);
  // Quante righe di listino e quante prenotazioni puntano a ciascun gioco: dice quali voci sono
  // davvero in uso, e quindi quali si possono disattivare senza far danni.
  const [usoListino, setUsoListino] = useState({});
  const [usoPrenotazioni, setUsoPrenotazioni] = useState({});

  const [showForm, setShowForm] = useState(false);
  const [nuovo, setNuovo] = useState(GIOCO_VUOTO);
  const [idInline, setIdInline] = useState(null);
  const [datiInline, setDatiInline] = useState(GIOCO_VUOTO);
  const [salvataggio, setSalvataggio] = useState(false);
  const [filtro, setFiltro] = useState('');
  // Finché sql/catalogo_giochi.sql non è stato eseguito la tabella non esiste: senza avviso la
  // pagina sembrerebbe soltanto vuota.
  const [schemaMancante, setSchemaMancante] = useState(null);

  const fetchTutto = async () => {
    const [g, l, p] = await Promise.all([
      supabase.from('giochi').select('*').order('nome'),
      supabase.from('gonfiabili').select('id, giocoId'),
      supabase.from('prenotazioni').select('id, giocoId'),
    ]);
    setSchemaMancante(g.error ? g.error.message : null);
    if (g.data) setGiochi(g.data);
    const conta = (righe) => (righe || []).reduce((acc, r) => {
      if (r.giocoId != null) acc[r.giocoId] = (acc[r.giocoId] || 0) + 1;
      return acc;
    }, {});
    setUsoListino(conta(l.data));
    setUsoPrenotazioni(conta(p.data));
  };

  useEffect(() => { fetchTutto(); }, []);

  const segnalaErrore = (contesto, error) => {
    console.error(contesto, error);
    const dettaglio = [error?.message, error?.details, error?.hint].filter(Boolean).join(' — ');
    alert(`${contesto}\n\n${dettaglio || 'Errore sconosciuto'}`);
  };

  // Il nome è unico a database: senza questo controllo l'errore arriverebbe col messaggio di
  // Postgres, che parla di vincoli e non di giochi.
  const nomeGiaUsato = (nome, escludiId = null) => giochi.some(
    g => g.id !== escludiId && g.nome.trim().toLowerCase() === nome.trim().toLowerCase()
  );

  const salvaNuovo = async (e) => {
    e.preventDefault();
    const nome = nuovo.nome.trim();
    if (!nome) return alert('Il gioco ha bisogno di un nome.');
    if (nomeGiaUsato(nome)) return alert(`"${nome}" è già a catalogo.`);
    setSalvataggio(true);
    const { error } = await supabase.from('giochi').insert([{
      nome,
      nome_breve: nuovo.nome_breve.trim() || null,
      famiglia: nuovo.famiglia.trim() || null,
      centro_ricavo: nuovo.centro_ricavo.trim() || null,
      per_pacchetti: nuovo.per_pacchetti,
      attivo: nuovo.attivo,
    }]);
    setSalvataggio(false);
    if (error) return segnalaErrore('Errore nel salvataggio del gioco', error);
    setNuovo(GIOCO_VUOTO); setShowForm(false); fetchTutto();
  };

  const iniziaInline = (g) => {
    setIdInline(g.id);
    setDatiInline({
      nome: g.nome || '', nome_breve: g.nome_breve || '', famiglia: g.famiglia || '', centro_ricavo: g.centro_ricavo || '',
      per_pacchetti: !!g.per_pacchetti, attivo: !!g.attivo,
    });
  };

  const salvaInline = async () => {
    const nome = datiInline.nome.trim();
    if (!nome) return alert('Il gioco ha bisogno di un nome.');
    if (nomeGiaUsato(nome, idInline)) return alert(`"${nome}" è già a catalogo.`);
    setSalvataggio(true);
    const { error } = await supabase.from('giochi').update({
      nome,
      nome_breve: datiInline.nome_breve.trim() || null,
      famiglia: datiInline.famiglia.trim() || null,
      centro_ricavo: datiInline.centro_ricavo.trim() || null,
    }).eq('id', idInline);
    setSalvataggio(false);
    if (error) return segnalaErrore('Errore nel salvataggio del gioco', error);
    setIdInline(null); fetchTutto();
  };

  // I due interruttori si toccano dall'elenco, come il flag Bubbler in Impostazioni: sono la
  // cosa che si cambia più spesso e non vale la pena entrare in modifica per una spunta.
  const alterna = async (g, campo) => {
    const { error } = await supabase.from('giochi').update({ [campo]: !g[campo] }).eq('id', g.id);
    if (error) return segnalaErrore('Errore nel salvataggio del gioco', error);
    fetchTutto();
  };

  const rimuovi = async (g) => {
    const usato = (usoListino[g.id] || 0) + (usoPrenotazioni[g.id] || 0);
    if (usato > 0) {
      return alert(
        `"${g.nome}" non si può eliminare: è agganciato a ${usoListino[g.id] || 0} voci di listino e `
        + `${usoPrenotazioni[g.id] || 0} prenotazioni.\n\n`
        + `Per toglierlo dalle tendine senza perdere lo storico, togli la spunta ad "Attivo".`
      );
    }
    if (!window.confirm(`Eliminare "${g.nome}" dal catalogo?`)) return;
    const { error } = await supabase.from('giochi').delete().eq('id', g.id);
    // Il database rifiuta comunque di cancellare un gioco ancora riferito: il controllo qui sopra
    // serve a dirlo con parole comprensibili, non a sostituirlo.
    if (error) return segnalaErrore(`Impossibile eliminare "${g.nome}"`, error);
    fetchTutto();
  };

  const COLONNE = [
    { chiave: 'nome', label: 'Gioco', valore: (g) => g.nome || '' },
    { chiave: 'breve', label: 'Nome breve', valore: (g) => g.nome_breve || '' },
    { chiave: 'famiglia', label: 'Famiglia', valore: (g) => g.famiglia || '' },
    { chiave: 'centro', label: 'Centro di ricavo', valore: (g) => g.centro_ricavo || '' },
    { chiave: 'campi', label: 'Su campo', stile: { textAlign: 'center', width: '90px' }, valore: (g) => (g.per_pacchetti ? 1 : 0) },
    { chiave: 'attivo', label: 'Attivo', stile: { textAlign: 'center', width: '70px' }, valore: (g) => (g.attivo ? 1 : 0) },
    { chiave: 'listino', label: 'A listino', stile: { textAlign: 'right', width: '90px' }, valore: (g) => usoListino[g.id] || 0 },
    { chiave: 'uso', label: 'Prenotazioni', stile: { textAlign: 'right', width: '110px' }, valore: (g) => usoPrenotazioni[g.id] || 0 },
  ];
  const { ordina, propsTestata, frecciaOrdinamento } = useOrdinamentoTabella(
    Object.fromEntries(COLONNE.map(c => [c.chiave, c.valore]))
  );

  const righe = giochi.filter(g => {
    const t = filtro.trim().toLowerCase();
    if (!t) return true;
    return [g.nome, g.nome_breve, g.famiglia, g.centro_ricavo].some(v => (v || '').toLowerCase().includes(t));
  });

  const famiglie = valoriUsati(giochi, 'famiglia');
  const centri = valoriUsati(giochi, 'centro_ricavo');
  const daCompilare = giochi.filter(g => !g.famiglia || !g.centro_ricavo).length;

  if (!puoVedere(user, 'catalogo', 'giochi')) return null;

  return (
    <div className="schermata-admin no-print" style={{ padding: '20px' }}>
      <h2>Catalogo giochi</h2>
      <p className="descrizione-pagina">
        L&apos;elenco dei giochi come cose a sé. Lo stesso gioco può esistere in più esemplari presso sedi
        diverse, con prezzi e schede tecniche proprie: quelli stanno in Preventivatore &gt; Configuratore &gt; Listino
        e puntano qui. <strong>Famiglia</strong> e <strong>centro di ricavo</strong> sono i due livelli con cui
        Costi/Ricavi raggrupperà; <strong>su campo</strong> dice se il gioco è proponibile sui pacchetti a
        location dai campi, che partono sempre dalla sede BFM.
      </p>

      {schemaMancante && (
        <div style={{ margin: '14px 0', padding: '14px 18px', background: '#fff8e1', border: '1px solid #f0d999', borderLeft: '4px solid #f0a000', borderRadius: '4px' }}>
          <strong style={{ display: 'block', marginBottom: '4px' }}>Schema del database non ancora aggiornato</strong>
          <span style={{ fontSize: '0.85rem', color: '#555' }}>
            Esegui <code>sql/catalogo_giochi.sql</code> nell&apos;SQL Editor di Supabase. Il database risponde: <em>{schemaMancante}</em>
          </span>
        </div>
      )}

      {!schemaMancante && daCompilare > 0 && (
        <div style={{ margin: '14px 0', padding: '12px 16px', background: '#e1f5fe', border: '1px solid #7dd3fc', borderLeft: '4px solid #0288d1', borderRadius: '4px', fontSize: '0.85rem', color: '#01579b' }}>
          <strong>{daCompilare}</strong> {daCompilare === 1 ? 'gioco non ha ancora' : 'giochi non hanno ancora'} famiglia o centro di ricavo.
          Finché mancano, quei giochi in Costi/Ricavi finiranno sotto &quot;non assegnato&quot;.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0', gap: '10px', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Giochi ({righe.length}{righe.length !== giochi.length ? ` di ${giochi.length}` : ''})</h3>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text" placeholder="Cerca gioco, famiglia, centro…" value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            style={{ ...stileInput, width: '240px' }}
          />
          <button className="btn-preventivo btn-accent" style={{ width: 'auto', marginTop: 0, padding: '8px 16px' }} onClick={() => setShowForm(true)}>
            <Icona nome="nuovo" size={16} style={{ marginRight: '6px' }} />Nuovo
          </button>
        </div>
      </div>

      {showForm && (
        <div className="modal-form-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setShowForm(false)}>✕</button>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>Nuovo gioco</h3>
            <form onSubmit={salvaNuovo} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input type="text" placeholder="Nome del gioco" value={nuovo.nome} onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })} style={stileInput} />
              <input type="text" placeholder="Nome breve (per calendari e tabelle strette)" value={nuovo.nome_breve} onChange={(e) => setNuovo({ ...nuovo, nome_breve: e.target.value })} style={stileInput} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <input type="text" list="catalogo-famiglie" placeholder="Famiglia" value={nuovo.famiglia} onChange={(e) => setNuovo({ ...nuovo, famiglia: e.target.value })} style={stileInput} />
                <input type="text" list="catalogo-centri" placeholder="Centro di ricavo" value={nuovo.centro_ricavo} onChange={(e) => setNuovo({ ...nuovo, centro_ricavo: e.target.value })} style={stileInput} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={nuovo.per_pacchetti} onChange={(e) => setNuovo({ ...nuovo, per_pacchetti: e.target.checked })} />
                Proponibile sui pacchetti a location dai campi
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={nuovo.attivo} onChange={(e) => setNuovo({ ...nuovo, attivo: e.target.checked })} />
                Attivo
              </label>
              <button type="submit" disabled={salvataggio} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>
                <Icona nome="salva" size={16} style={{ marginRight: '6px' }} />{salvataggio ? 'Salvataggio…' : 'Salva gioco'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Suggerimenti condivisi dal form nuovo e dalla modifica in linea */}
      <datalist id="catalogo-famiglie">{famiglie.map(f => <option key={f} value={f} />)}</datalist>
      <datalist id="catalogo-centri">{centri.map(c => <option key={c} value={c} />)}</datalist>

      <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              {COLONNE.map(c => {
                const { style: stileOrdinabile, ...propsOrdinabile } = propsTestata(c.chiave);
                return (
                  <th key={c.chiave} {...propsOrdinabile} style={{ padding: '10px 12px', color: '#444', ...c.stile, ...stileOrdinabile }}>
                    {c.label}{frecciaOrdinamento(c.chiave)}
                  </th>
                );
              })}
              <th style={{ padding: '10px 12px', textAlign: 'center', width: '130px', color: '#444' }}>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {ordina(righe).map(g => (
              <tr key={g.id} style={{ borderBottom: '1px solid #eee', opacity: g.attivo ? 1 : 0.55 }}>
                {idInline === g.id ? (
                  <>
                    <td style={{ padding: '8px 12px' }}><input type="text" className="table-input" value={datiInline.nome} onChange={(e) => setDatiInline({ ...datiInline, nome: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                    <td style={{ padding: '8px 12px' }}><input type="text" className="table-input" placeholder="Nome breve" value={datiInline.nome_breve} onChange={(e) => setDatiInline({ ...datiInline, nome_breve: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                    <td style={{ padding: '8px 12px' }}><input type="text" className="table-input" list="catalogo-famiglie" placeholder="Famiglia" value={datiInline.famiglia} onChange={(e) => setDatiInline({ ...datiInline, famiglia: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                    <td style={{ padding: '8px 12px' }}><input type="text" className="table-input" list="catalogo-centri" placeholder="Centro di ricavo" value={datiInline.centro_ricavo} onChange={(e) => setDatiInline({ ...datiInline, centro_ricavo: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                    <td colSpan={3} style={{ padding: '8px 12px', color: '#94a3b8', fontSize: '0.78rem' }}>
                      Le spunte si cambiano dall&apos;elenco
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#94a3b8' }}>{usoPrenotazioni[g.id] || 0}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                        <button className="btn-accent-inline" disabled={salvataggio} onClick={salvaInline} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px' }}><Icona nome="salva" size={14} style={{ marginRight: '4px' }} />Salva</button>
                        <button className="btn-outline-annulla" onClick={() => setIdInline(null)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px', borderRadius: '4px' }}><Icona nome="annulla" size={14} style={{ marginRight: '4px' }} />Annulla</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><strong>{g.nome}</strong></td>
                    <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#555' }}>{g.nome_breve || testoVuoto}</td>
                    <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#555' }}>{g.famiglia || testoVuoto}</td>
                    <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#555' }}>{g.centro_ricavo || testoVuoto}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <input type="checkbox" checked={!!g.per_pacchetti} onChange={() => alterna(g, 'per_pacchetti')} title="Proponibile sui pacchetti a location dai campi" />
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <input type="checkbox" checked={!!g.attivo} onChange={() => alterna(g, 'attivo')} title={g.attivo ? 'Attivo: compare nelle tendine' : 'Non attivo: resta nello storico ma sparisce dalle tendine'} />
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', verticalAlign: 'middle', color: (usoListino[g.id] || 0) ? '#334155' : '#cbd5e1' }} title="Voci di listino (gonfiabili) che puntano a questo gioco">
                      {usoListino[g.id] || 0}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', verticalAlign: 'middle', color: (usoPrenotazioni[g.id] || 0) ? '#334155' : '#cbd5e1' }} title="Prenotazioni agganciate a questo gioco">
                      {usoPrenotazioni[g.id] || 0}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                        <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => iniziaInline(g)}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                        {user.isAdmin && (
                          <button className="btn-icon-action danger" aria-label="Elimina" title="Elimina" onClick={() => rimuovi(g)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
                        )}
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {righe.length === 0 && (
              <tr><td colSpan={9} style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                {giochi.length === 0 ? 'Nessun gioco a catalogo.' : 'Nessun gioco corrisponde alla ricerca.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Catalogo
