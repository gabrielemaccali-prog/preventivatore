import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formattaDataGGMMAAAA, siglaProvincia, provinciaValida, formattaOraInput, normalizzaOra24 } from '../../lib/utils'
import { ricalcoloCampo, giornataChiusa } from '../../lib/campi'
import { etichettaStatoPren, classeBadgeStato } from '../../lib/costanti'
import RicercaIndirizzo from '../../components/RicercaIndirizzo'
import Icona from '../../components/Icona'

// Anagrafica dei campi sportivi: indirizzo, costo base, rinfreschi e tariffe variabili. Stava nel
// Configuratore di Prenotazioni; le prenotazioni continuano a leggere da qui campi e tariffe per
// calcolare affitto e rinfresco al salvataggio.

const GIORNI = [
  { n: 1, l: 'Lun' }, { n: 2, l: 'Mar' }, { n: 3, l: 'Mer' }, { n: 4, l: 'Gio' },
  { n: 5, l: 'Ven' }, { n: 6, l: 'Sab' }, { n: 7, l: 'Dom' }
];

const CAMPO_VUOTO = { nome: "", nomeCompleto: "", indirizzo: "", cap: "", citta: "", provincia: "", centroCosto: "", costoFlat: "", ivaInclusaCampo: false, ivaInclusaRinfresco: false, costoMerenda: "", costoAperitivo: "", ivaCampo: "22", ivaRinfresco: "22", noRinfresco: false };

const ivaLabel = (incl) => incl ? 'IVA inclusa' : 'IVA esclusa';

const numOrNull = (v) => v === "" || v == null ? null : parseFloat(v);

const lblStyle = { display: 'block', fontSize: '0.78rem', fontWeight: 'bold', color: '#555', marginBottom: '3px' };
const inputStyle = { width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' };
// Componente a livello di modulo (non ricreato ad ogni render): un input dentro,
// altrimenti React lo tratta come un tipo nuovo ad ogni render e l'input perde il focus a ogni carattere digitato.
const Campo = ({ label, children }) => (
  <div><label style={lblStyle}>{label}</label>{children}</div>
);

// Campi del form Sede/Campo (condiviso tra la scheda "Nuovo Campo" e la modifica inline nella card).
const CampoFormFields = ({ formCampo, setFormCampo }) => (
  <>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
      <Campo label="Nome campo"><input type="text" value={formCampo.nome} onChange={(e) => setFormCampo({ ...formCampo, nome: e.target.value })} style={inputStyle} /></Campo>
      <Campo label="Nome completo campo"><input type="text" value={formCampo.nomeCompleto} onChange={(e) => setFormCampo({ ...formCampo, nomeCompleto: e.target.value })} style={inputStyle} placeholder="Es. Padel Arena Quintosole" /></Campo>
    </div>
    <Campo label="Cerca indirizzo"><RicercaIndirizzo onSelect={(a) => setFormCampo(prev => ({ ...prev, indirizzo: a.indirizzo, cap: a.cap, citta: a.citta, provincia: siglaProvincia(a.provincia) }))} /></Campo>
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 0.8fr', gap: '8px' }}>
      <Campo label="Indirizzo"><input type="text" value={formCampo.indirizzo} onChange={(e) => setFormCampo({ ...formCampo, indirizzo: e.target.value })} style={inputStyle} /></Campo>
      <Campo label="CAP"><input type="text" value={formCampo.cap} onChange={(e) => setFormCampo({ ...formCampo, cap: e.target.value })} style={inputStyle} /></Campo>
      <Campo label="Città"><input type="text" value={formCampo.citta} onChange={(e) => setFormCampo({ ...formCampo, citta: e.target.value })} style={inputStyle} /></Campo>
      <Campo label="Prov"><input type="text" value={formCampo.provincia} onChange={(e) => setFormCampo({ ...formCampo, provincia: e.target.value })} onBlur={() => setFormCampo(prev => ({ ...prev, provincia: siglaProvincia(prev.provincia) }))} style={inputStyle} /></Campo>
    </div>
    <Campo label="Centro di costo"><input type="text" value={formCampo.centroCosto} onChange={(e) => setFormCampo({ ...formCampo, centroCosto: e.target.value })} style={inputStyle} /></Campo>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
      <Campo label="Costo base flat €"><input type="number" step="any" value={formCampo.costoFlat} onChange={(e) => setFormCampo({ ...formCampo, costoFlat: e.target.value })} style={inputStyle} /></Campo>
      <Campo label="% IVA affitto campo"><input type="number" step="any" value={formCampo.ivaCampo} onChange={(e) => setFormCampo({ ...formCampo, ivaCampo: e.target.value })} style={inputStyle} /></Campo>
      <Campo label=" "><label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', height: '36px' }}><input type="checkbox" checked={formCampo.ivaInclusaCampo} onChange={(e) => setFormCampo({ ...formCampo, ivaInclusaCampo: e.target.checked })} /> Costo campo IVA inclusa</label></Campo>
    </div>
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
      <input type="checkbox" checked={formCampo.noRinfresco} onChange={(e) => setFormCampo({ ...formCampo, noRinfresco: e.target.checked })} /> 🚫 Non è possibile fare rinfresco in questo campo
    </label>
    {!formCampo.noRinfresco && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px' }}>
        <Campo label="Costo merenda €/pers"><input type="number" step="any" value={formCampo.costoMerenda} onChange={(e) => setFormCampo({ ...formCampo, costoMerenda: e.target.value })} style={inputStyle} /></Campo>
        <Campo label="Costo aperitivo €/pers"><input type="number" step="any" value={formCampo.costoAperitivo} onChange={(e) => setFormCampo({ ...formCampo, costoAperitivo: e.target.value })} style={inputStyle} /></Campo>
        <Campo label="% IVA rinfreschi"><input type="number" step="any" value={formCampo.ivaRinfresco} onChange={(e) => setFormCampo({ ...formCampo, ivaRinfresco: e.target.value })} style={inputStyle} /></Campo>
        <Campo label=" "><label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', height: '36px' }}><input type="checkbox" checked={formCampo.ivaInclusaRinfresco} onChange={(e) => setFormCampo({ ...formCampo, ivaInclusaRinfresco: e.target.checked })} /> Costo rinfresco IVA inclusa</label></Campo>
      </div>
    )}
  </>
);

function Campi({ user }) {
  const [campi, setCampi] = useState([]);
  const [tariffe, setTariffe] = useState([]);
  const [showFormCampo, setShowFormCampo] = useState(false);

  // singole schede campo (collassate di default: mostrano solo nome/indirizzo, il dettaglio si apre al click)
  const [campiEspansi, setCampiEspansi] = useState({});
  const toggleCampoEspanso = (id) => setCampiEspansi(prev => ({ ...prev, [id]: !prev[id] }));

  // Raggruppa i campi per provincia (ordine alfabetico, "Senza provincia" sempre in coda)
  const gruppiCampiPerProvincia = (() => {
    const gruppi = {};
    campi.forEach(c => {
      const prov = siglaProvincia(c.provincia) || 'Senza provincia';
      if (!gruppi[prov]) gruppi[prov] = [];
      gruppi[prov].push(c);
    });
    return Object.entries(gruppi).sort(([a], [b]) => {
      if (a === 'Senza provincia') return 1;
      if (b === 'Senza provincia') return -1;
      return a.localeCompare(b);
    });
  })();

  // form (usati sia per creare sia per modificare)

  const [formCampo, setFormCampo] = useState(CAMPO_VUOTO);
  const [editCampo, setEditCampo] = useState(null);
  const [nuovaTariffa, setNuovaTariffa] = useState({ campoId: "", giorni: [], oraInizio: "", oraFine: "", costo: "" });
  // Ricalcolo delle prenotazioni di un campo con le tariffe di adesso (solo admin):
  // { campo, righe, rettifiche: { [idPren]: importo }, scelte: [idPren], inCorso }
  const [ricalcolo, setRicalcolo] = useState(null);

  const fetchTutto = async () => {
    const [c, t] = await Promise.all([
      supabase.from('pren_campi').select('*').order('nome'),
      supabase.from('pren_campi_tariffe').select('*'),
    ]);
    if (c.error) console.error('Campi — caricamento fallito:', c.error);
    if (c.data) setCampi(c.data);
    if (t.data) setTariffe(t.data);
  };
  useEffect(() => { fetchTutto(); }, []);

  const btnSalva = { display: 'inline-flex', alignItems: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' };
  const btnNuovo = { width: 'auto', marginTop: 0, padding: '8px 16px' };
  const headerElenco = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0' };

  // ---------------- CAMPI ----------------
  const salvaCampo = async (e) => {
    e.preventDefault();
    if (!formCampo.nome) return alert("Inserisci il nome del campo");
    if (!provinciaValida(formCampo.provincia)) return alert("Provincia non valida: usa la sigla di due lettere (es. MI) oppure il nome della provincia.");
    const rec = {
      nome: formCampo.nome, nomeCompleto: formCampo.nomeCompleto, indirizzo: formCampo.indirizzo, cap: formCampo.cap, citta: formCampo.citta, provincia: formCampo.provincia,
      centroCosto: formCampo.centroCosto, costoFlat: numOrNull(formCampo.costoFlat),
      ivaInclusaCampo: formCampo.ivaInclusaCampo, ivaInclusaRinfresco: formCampo.ivaInclusaRinfresco,
      costoMerenda: numOrNull(formCampo.costoMerenda), costoAperitivo: numOrNull(formCampo.costoAperitivo),
      ivaCampo: numOrNull(formCampo.ivaCampo), ivaRinfresco: numOrNull(formCampo.ivaRinfresco),
      noRinfresco: formCampo.noRinfresco
    };
    let error;
    if (editCampo) ({ error } = await supabase.from('pren_campi').update(rec).eq('id', editCampo));
    else ({ error } = await supabase.from('pren_campi').insert([{ id: "cmp_" + Date.now(), ...rec }]));
    if (error) { console.error(error); return alert("Errore salvataggio campo"); }
    setFormCampo(CAMPO_VUOTO); setEditCampo(null); setShowFormCampo(false); fetchTutto();
  };
  const nuovoCampo = () => { setEditCampo(null); setFormCampo(CAMPO_VUOTO); setShowFormCampo(true); };
  const modificaCampo = (c) => {
    setEditCampo(c.id);
    setFormCampo({
      nome: c.nome || "", nomeCompleto: c.nomeCompleto || "", indirizzo: c.indirizzo || "", cap: c.cap || "", citta: c.citta || "", provincia: c.provincia || "",
      centroCosto: c.centroCosto || "", costoFlat: c.costoFlat ?? "",
      ivaInclusaCampo: !!c.ivaInclusaCampo, ivaInclusaRinfresco: !!c.ivaInclusaRinfresco,
      costoMerenda: c.costoMerenda ?? "", costoAperitivo: c.costoAperitivo ?? "",
      ivaCampo: c.ivaCampo ?? "22", ivaRinfresco: c.ivaRinfresco ?? "22",
      noRinfresco: !!c.noRinfresco
    });
  };
  const rimuoviCampo = async (id) => {
    if (!window.confirm("Eliminare il campo e le sue tariffe?")) return;
    await supabase.from('pren_campi_tariffe').delete().eq('campoId', id);
    await supabase.from('pren_campi').delete().eq('id', id);
    if (editCampo === id) { setEditCampo(null); setFormCampo(CAMPO_VUOTO); }
    fetchTutto();
  };

  const addTariffa = async (campoId) => {
    if (nuovaTariffa.giorni.length === 0 || nuovaTariffa.costo === "") return alert("Seleziona i giorni e inserisci il costo");
    const oraInizio = normalizzaOra24(nuovaTariffa.oraInizio);
    const oraFine = normalizzaOra24(nuovaTariffa.oraFine);
    if (oraInizio === null || oraFine === null) return alert("Orario non valido: usa il formato 24h, es. 19:00 (i minuti si possono omettere: 19 diventa 19:00).");
    const rec = { id: "trf_" + Date.now(), campoId, giorni: nuovaTariffa.giorni.join(','), oraInizio, oraFine, costo: parseFloat(nuovaTariffa.costo) || 0 };
    const { error } = await supabase.from('pren_campi_tariffe').insert([rec]);
    if (error) { console.error(error); return alert("Errore salvataggio tariffa"); }
    setNuovaTariffa({ campoId: "", giorni: [], oraInizio: "", oraFine: "", costo: "" });
    fetchTutto();
  };
  const rimuoviTariffa = async (id) => { await supabase.from('pren_campi_tariffe').delete().eq('id', id); fetchTutto(); };
  // Gli importi del campo sono fotografati sulla prenotazione al salvataggio: cambiare le tariffe
  // non li tocca. Qui un admin li riallinea, ma solo fuori dai periodi già consuntivati -- quelli
  // sono stati pagati e non devono cambiare da sotto. Prima si vede cosa cambia, poi si sceglie.
  const apriRicalcolo = async (campo) => {
    const [pr, pe, vo] = await Promise.all([
      supabase.from('prenotazioni').select('*').eq('campoId', campo.id),
      supabase.from('cons_periodi').select('*').eq('controparte', 'campo').eq('controparte_id', campo.id),
      supabase.from('cons_voci').select('riferimento, importo').eq('controparte', 'campo').eq('controparte_id', campo.id).eq('lato', 'costo'),
    ]);
    if (pr.error) { console.error(pr.error); return alert("Errore nel leggere le prenotazioni del campo"); }
    // Senza le tabelle della consuntivazione non si sa cosa è già chiuso: meglio non toccare niente.
    if (pe.error) { console.error(pe.error); return alert("Impossibile leggere i periodi consuntivati: ricalcolo annullato."); }
    const righe = ricalcoloCampo({ campo, tariffe, prenotazioni: pr.data || [], periodi: pe.data || [] });
    const rettifiche = {};
    (vo.data || []).forEach(v => { rettifiche[v.riferimento] = (rettifiche[v.riferimento] || 0) + (parseFloat(v.importo) || 0); });
    setRicalcolo({ campo, righe, rettifiche, scelte: righe.map(r => r.prenotazione.id), inCorso: false });
  };
  const applicaRicalcolo = async () => {
    const { campo, righe, scelte } = ricalcolo;
    if (scelte.length === 0) return;
    setRicalcolo(r => ({ ...r, inCorso: true }));
    // Un periodo può essere stato chiuso mentre l'anteprima era aperta: si ricontrolla ora.
    const { data: periodi, error: errPe } = await supabase.from('cons_periodi').select('*').eq('controparte', 'campo').eq('controparte_id', campo.id);
    if (errPe) { console.error(errPe); setRicalcolo(r => ({ ...r, inCorso: false })); return alert("Impossibile leggere i periodi consuntivati: ricalcolo annullato."); }
    const daScrivere = righe.filter(r => scelte.includes(r.prenotazione.id) && !giornataChiusa(periodi || [], campo.id, r.prenotazione));
    const esiti = await Promise.all(daScrivere.map(r => supabase.from('prenotazioni').update(r.rec).eq('id', r.prenotazione.id)));
    const falliti = esiti.filter(e => e.error);
    falliti.forEach(e => console.error(e.error));
    const saltate = scelte.length - daScrivere.length;
    setRicalcolo(null);
    fetchTutto();
    alert([
      `Aggiornate ${daScrivere.length - falliti.length} prenotazioni.`,
      saltate > 0 && `${saltate} saltate perché nel frattempo il periodo è stato consuntivato.`,
      falliti.length > 0 && `${falliti.length} non salvate per un errore: riprova.`,
    ].filter(Boolean).join('\n'));
  };

  const toggleGiornoTariffa = (n) => setNuovaTariffa(prev => ({ ...prev, giorni: prev.giorni.includes(n) ? prev.giorni.filter(x => x !== n) : [...prev.giorni, n] }));
  const etichettaGiorni = (str) => (str || "").split(',').filter(Boolean).map(n => GIORNI.find(g => g.n === parseInt(n))?.l || n).join(' ');

  return (
    <div className="schermata-admin no-print" style={{ padding: '20px' }}>
      <h2>Campi</h2>
      <p className="descrizione-pagina">I campi sportivi su cui si giocano i pacchetti a location dai campi. Il costo base vale sempre; le tariffe variabili lo sovrascrivono in certi giorni e orari. Gli importi si fotografano sulla prenotazione quando si salva: cambiare qui un costo non tocca le prenotazioni già fatte, che un amministratore può riallineare con Ricalcola.</p>
      <div>
        <div style={headerElenco}>
          <h3 style={{ margin: 0 }}>Campi ({campi.length})</h3>
          <button className="btn-preventivo btn-accent" style={btnNuovo} onClick={nuovoCampo}><Icona nome="nuovo" size={16} style={{ marginRight: '6px' }} />Nuovo</button>
        </div>

        {showFormCampo && !editCampo && (
          <div className="modal-form-backdrop" onClick={() => { setFormCampo(CAMPO_VUOTO); setShowFormCampo(false); }}>
            <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => { setFormCampo(CAMPO_VUOTO); setShowFormCampo(false); }}>✕</button>
              <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>Nuovo Campo</h3>
              <form onSubmit={salvaCampo} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <CampoFormFields formCampo={formCampo} setFormCampo={setFormCampo} />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" style={btnSalva}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />Salva Campo</button>
                  <button type="button" className="btn-outline-annulla" style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', borderRadius: '4px', fontSize: '0.85rem' }} onClick={() => { setFormCampo(CAMPO_VUOTO); setShowFormCampo(false); }}><Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />Annulla</button>
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>Il costo base (flat) vale sempre; le tariffe variabili (nella scheda del campo) lo sovrascrivono in certi giorni/orari.</p>
              </form>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {gruppiCampiPerProvincia.map(([provincia, campiGruppo]) => (
          <div key={provincia}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', fontWeight: 'bold', color: '#0288d1', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid #e0f2fe', paddingBottom: '6px' }}>
              {provincia} <span style={{ fontWeight: 'normal', color: '#888', textTransform: 'none' }}>({campiGruppo.length})</span>
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {campiGruppo.map(c => {
            const tarCampo = tariffe.filter(t => t.campoId === c.id);
            const inModifica = editCampo === c.id;
            const espanso = !!campiEspansi[c.id] || inModifica;
            return (
              <div key={c.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '15px', ...(inModifica ? { boxShadow: '0 0 0 2px #0288d1' } : {}) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }} onClick={() => toggleCampoEspanso(c.id)}>
                    <span style={{ fontSize: '0.7rem', color: '#888', marginTop: '4px' }}>{espanso ? '▼' : '▶'}</span>
                    <div>
                      <strong style={{ fontSize: '1rem' }}>{c.nome}</strong>
                      {c.nomeCompleto && <span style={{ marginLeft: '8px', fontSize: '0.82rem', color: '#0288d1', fontStyle: 'italic' }}>{c.nomeCompleto}</span>}
                      {c.noRinfresco && <span title="Non è possibile fare rinfresco in questo campo" style={{ marginLeft: '6px', fontSize: '0.7rem', fontWeight: 'bold', padding: '2px 7px', borderRadius: '10px', background: '#fee2e2', color: '#991b1b' }}>🚫 No rinfresco</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    {user.isAdmin && <button className="btn-icon-action" aria-label="Ricalcola prenotazioni" title="Ricalcola affitto e rinfresco delle prenotazioni non consuntivate con le tariffe attuali" onClick={() => apriRicalcolo(c)} style={{ width: 'auto', padding: '0 10px', fontSize: '0.8rem', gap: '4px' }}><Icona nome="riporta" size={16} style={{ marginRight: 0 }} />Ricalcola</button>}
                    <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => modificaCampo(c)}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                    <button className="btn-icon-action danger" aria-label="Elimina" title="Elimina" onClick={() => rimuoviCampo(c.id)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
                  </div>
                </div>

                {espanso && (
                <>
                {inModifica ? (
                  <form onSubmit={salvaCampo} style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px', background: '#f8fafc', padding: '10px', borderRadius: '6px' }}>
                    <CampoFormFields formCampo={formCampo} setFormCampo={setFormCampo} />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="submit" style={btnSalva}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />Salva modifiche</button>
                      <button type="button" className="btn-outline-annulla" style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', borderRadius: '4px', fontSize: '0.85rem' }} onClick={() => { setEditCampo(null); setFormCampo(CAMPO_VUOTO); }}><Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />Annulla</button>
                    </div>
                  </form>
                ) : (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '0.85rem', color: '#555' }}>{[c.indirizzo, c.cap, c.citta, c.provincia].filter(Boolean).join(', ')}</div>
                  <div style={{ fontSize: '0.8rem', color: '#777' }}>
                    Centro di costo: {c.centroCosto || '—'} · Base €{parseFloat(c.costoFlat || 0).toFixed(2)}
                    {c.costoMerenda != null && ` · Merenda €${parseFloat(c.costoMerenda).toFixed(2)}/p`}
                    {c.costoAperitivo != null && ` · Aperitivo €${parseFloat(c.costoAperitivo).toFixed(2)}/p`}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-block', fontSize: '0.72rem', fontWeight: 'bold', padding: '2px 8px', borderRadius: '10px', background: c.ivaInclusaCampo ? '#dcfce7' : '#fee2e2', color: c.ivaInclusaCampo ? '#166534' : '#991b1b' }}>Campo: {ivaLabel(c.ivaInclusaCampo)} ({c.ivaCampo ?? '22'}%)</span>
                    <span style={{ display: 'inline-block', fontSize: '0.72rem', fontWeight: 'bold', padding: '2px 8px', borderRadius: '10px', background: c.ivaInclusaRinfresco ? '#dcfce7' : '#fee2e2', color: c.ivaInclusaRinfresco ? '#166534' : '#991b1b' }}>Rinfresco: {ivaLabel(c.ivaInclusaRinfresco)} ({c.ivaRinfresco ?? '22'}%)</span>
                  </div>
                </div>
                )}

                {tarCampo.length > 0 && (
                  <div style={{ marginTop: '12px', borderTop: '1px dashed #ddd', paddingTop: '12px' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 'bold', color: '#555', marginBottom: '6px' }}>Tariffe variabili (sovrascrivono la flat)</div>
                    <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', minWidth: '360px', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead><tr style={{ color: '#666' }}><th style={{ textAlign: 'left', padding: '4px' }}>Giorni</th><th style={{ textAlign: 'left', padding: '4px' }}>Fascia</th><th style={{ textAlign: 'left', padding: '4px' }}>Costo</th><th style={{ textAlign: 'right', padding: '4px' }}>Azioni</th></tr></thead>
                      <tbody>
                        {tarCampo.map(t => (
                          <tr key={t.id}>
                            <td style={{ padding: '4px' }}>{etichettaGiorni(t.giorni)}</td>
                            <td style={{ padding: '4px' }}>{t.oraInizio || '—'} - {t.oraFine || '—'}</td>
                            <td style={{ padding: '4px' }}>€{parseFloat(t.costo).toFixed(2)}</td>
                            <td style={{ padding: '4px', textAlign: 'right' }}>{inModifica && <button className="btn-rimuovi" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => rimuoviTariffa(t.id)}>🗑 Elimina</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}

                {inModifica && (
                  <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', background: '#f8fafc', padding: '10px', borderRadius: '6px' }}>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {GIORNI.map(g => (
                        <label key={g.n} style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={nuovaTariffa.campoId === c.id && nuovaTariffa.giorni.includes(g.n)} onChange={() => { if (nuovaTariffa.campoId !== c.id) setNuovaTariffa({ campoId: c.id, giorni: [g.n], oraInizio: "", oraFine: "", costo: "" }); else toggleGiornoTariffa(g.n); }} />
                          {g.l}
                        </label>
                      ))}
                    </div>
                    <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} title="Formato 24h, es. 19:00" value={nuovaTariffa.campoId === c.id ? nuovaTariffa.oraInizio : ""} onChange={(e) => setNuovaTariffa(prev => ({ ...prev, campoId: c.id, oraInizio: formattaOraInput(e.target.value) }))} onBlur={() => setNuovaTariffa(prev => ({ ...prev, oraInizio: normalizzaOra24(prev.oraInizio) ?? prev.oraInizio }))} style={{ ...inputStyle, width: '80px', height: '32px' }} />
                    <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} title="Formato 24h, es. 00:00" value={nuovaTariffa.campoId === c.id ? nuovaTariffa.oraFine : ""} onChange={(e) => setNuovaTariffa(prev => ({ ...prev, campoId: c.id, oraFine: formattaOraInput(e.target.value) }))} onBlur={() => setNuovaTariffa(prev => ({ ...prev, oraFine: normalizzaOra24(prev.oraFine) ?? prev.oraFine }))} style={{ ...inputStyle, width: '80px', height: '32px' }} />
                    <input type="number" step="any" placeholder="€" value={nuovaTariffa.campoId === c.id ? nuovaTariffa.costo : ""} onChange={(e) => setNuovaTariffa(prev => ({ ...prev, campoId: c.id, costo: e.target.value }))} style={{ ...inputStyle, width: '80px', height: '32px' }} />
                    <button type="button" className="btn-conferma" style={{ padding: '6px 12px' }} onClick={() => addTariffa(c.id)}>+ Tariffa</button>
                  </div>
                )}
                </>
                )}
              </div>
            );
          })}
            </div>
          </div>
          ))}
          {campi.length === 0 && <p style={{ color: '#666' }}>Nessun campo configurato.</p>}
        </div>

      </div>

      {ricalcolo && user.isAdmin && (() => {
        const { campo, righe, rettifiche, scelte, inCorso } = ricalcolo;
        const cambia = (id) => setRicalcolo(r => ({ ...r, scelte: r.scelte.includes(id) ? r.scelte.filter(x => x !== id) : [...r.scelte, id] }));
        const tutte = righe.length > 0 && scelte.length === righe.length;
        const eur = (n) => `€${(+n || 0).toFixed(2)}`;
        const importo = (prima, dopo) => Math.abs(prima - dopo) > 0.005
          ? <><span style={{ color: '#94a3b8', textDecoration: 'line-through' }}>{eur(prima)}</span> → <strong>{eur(dopo)}</strong></>
          : eur(dopo);
        const cella = { padding: '6px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' };
        const chiudi = () => { if (!inCorso) setRicalcolo(null); };
        return (
          <div className="modal-form-backdrop" onClick={chiudi}>
            <div className="modal-form-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '760px' }}>
              <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={chiudi}>✕</button>
              <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0288d1' }}>Ricalcola prenotazioni · {campo.nome}</h3>
              <p style={{ margin: '0 0 14px 0', fontSize: '0.8rem', color: '#777' }}>
                Affitto e rinfresco (netti) ricalcolati con le tariffe attuali del campo. Sono escluse le partite che cadono in un periodo già consuntivato:
                quelle sono state pagate e non cambiano. Le rettifiche già scritte in consuntivazione restano: controlla che non correggano proprio la differenza che il ricalcolo sistema.
              </p>
              {righe.length === 0 ? (
                <p style={{ fontSize: '0.9rem' }}>Nessuna prenotazione da aggiornare: gli importi salvati corrispondono già alle tariffe attuali.</p>
              ) : (
                <div style={{ overflowX: 'auto', maxHeight: '55vh', marginBottom: '16px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead><tr style={{ color: '#666', textAlign: 'left' }}>
                      <th style={cella}><input type="checkbox" checked={tutte} onChange={() => setRicalcolo(r => ({ ...r, scelte: tutte ? [] : righe.map(x => x.prenotazione.id) }))} aria-label="Seleziona tutte" /></th>
                      <th style={cella}>Prenotazione</th><th style={cella}>Data</th><th style={cella}>Stato</th>
                      <th style={cella}>Affitto</th><th style={cella}>Rinfresco</th><th style={cella}>Rettifiche</th>
                    </tr></thead>
                    <tbody>
                      {righe.map(({ prenotazione: p, prima, dopo }) => (
                        <tr key={p.id}>
                          <td style={cella}><input type="checkbox" checked={scelte.includes(p.id)} onChange={() => cambia(p.id)} /></td>
                          <td style={cella}>{p.id}{p.nominativo ? <span style={{ color: '#64748b' }}> · {p.nominativo}</span> : ''}</td>
                          <td style={cella}>{formattaDataGGMMAAAA(p.data)}{p.oraInizio ? ` ${p.oraInizio}` : ''}</td>
                          <td style={cella}><span className={`badge-stato ${classeBadgeStato(p.stato)}`}>{etichettaStatoPren(p.stato)}</span></td>
                          <td style={cella}>{importo(prima.affitto, dopo.affitto)}</td>
                          <td style={cella}>{importo(prima.rinfresco, dopo.rinfresco)}</td>
                          <td style={{ ...cella, color: rettifiche[p.id] ? '#b45309' : '#94a3b8' }}>{rettifiche[p.id] ? eur(rettifiche[p.id]) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                {righe.length > 0 && (
                  <button type="button" disabled={inCorso || scelte.length === 0} onClick={applicaRicalcolo} style={{ ...btnSalva, opacity: inCorso || scelte.length === 0 ? 0.6 : 1 }}>
                    <Icona nome="salva" size={16} style={{ marginRight: '6px' }} />{inCorso ? 'Aggiornamento…' : `Aggiorna ${scelte.length} prenotazion${scelte.length === 1 ? 'e' : 'i'}`}
                  </button>
                )}
                <button type="button" className="btn-outline-annulla" disabled={inCorso} style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', borderRadius: '4px', fontSize: '0.85rem' }} onClick={chiudi}><Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />{righe.length > 0 ? 'Annulla' : 'Chiudi'}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default Campi
