import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import Icona from '../../components/Icona'
import { preventiviPerOperatore, consuntivoDiPeriodo, oreDiPartita } from './calcolo'
import { toMinutes } from '../../lib/utils'

// Parametri del calcolo compensi. I default replicano quelli in sql/compensi.sql: valgono solo
// finché la riga non è stata letta dal DB, così i campi non partono vuoti al primo render.
const PARAMETRI_DEFAULT = {
  prima_ora: 30,
  ora_successiva: 10,
  tetto_giornaliero: 120,
  bonus_recensione: 5,
  aliquota_ritenuta: 20,
  gap_consecutivita_min: 60,
};

// Etichetta e spiegazione di ogni manopola: l'elenco guida il render, così aggiungere un
// parametro domani significa aggiungere una riga qui e una colonna nella tabella.
const CAMPI_PARAMETRI = [
  { chiave: 'prima_ora', label: 'Prima ora', unita: '€', aiuto: 'Compenso della prima ora di ogni blocco consecutivo.' },
  { chiave: 'ora_successiva', label: 'Ore successive', unita: '€', aiuto: 'Compenso di ogni ora oltre la prima; la mezz\'ora vale metà.' },
  { chiave: 'tetto_giornaliero', label: 'Tetto giornaliero', unita: '€', aiuto: 'Massimo sul solo compenso orario. Recensioni e rimborsi si sommano sopra il tetto.' },
  { chiave: 'bonus_recensione', label: 'Bonus recensione', unita: '€', aiuto: 'Una sola recensione per operatore per partita.' },
  { chiave: 'aliquota_ritenuta', label: 'Ritenuta d\'acconto', unita: '%', aiuto: 'Il compenso calcolato è netto in mano: la ritenuta è un costo che si aggiunge sopra.' },
  { chiave: 'gap_consecutivita_min', label: 'Stacco massimo', unita: 'min', aiuto: 'Entro questo stacco due partite restano nello stesso blocco; oltre, riparte la prima ora.' },
];

const stileInput = { width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' };
const btnSalva = { display: 'inline-flex', alignItems: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' };

const euro = (v) => `€${(+v || 0).toFixed(2)}`;
// Le ore si scrivono senza decimali inutili: 3 invece di 3,00 ma 1,5 resta 1,5.
const ore = (v) => `${(+v || 0).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} h`;
const oggiIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const primoDelMese = () => `${oggiIso().slice(0, 8)}01`;
const oraDiMinuti = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
// "2026-08-14" -> "14/08/26", come le tabelle del modulo prenotazioni. Il campo date del filtro
// resta ISO, perché è il browser a disegnarlo.
const dataBreve = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : (iso || "");
};

// Orario della singola partita, non del blocco che la contiene: due partite dello stesso blocco
// hanno lo stesso intervallo di blocco, e mostrarlo su entrambe le farebbe sembrare lunghe uguali.
const intervalloPartita = (p) => {
  const inizio = toMinutes(p.oraInizio);
  if (inizio == null) return '';
  return `${oraDiMinuti(inizio)}–${oraDiMinuti(inizio + oreDiPartita(p) * 60)}`;
};

function Compensi({ user }) {
  const primaScheda = ['config', 'daconsuntivare', 'consuntivati', 'indicatori'].find(s => puoVedere(user, 'compensi', s)) || 'config';
  const [currentView, setCurrentView] = useState(primaScheda);

  const [parametri, setParametri] = useState(PARAMETRI_DEFAULT);
  const [salvataggio, setSalvataggio] = useState(false);
  // Messaggio del DB quando la tabella non esiste ancora: null = schema a posto.
  const [schemaMancante, setSchemaMancante] = useState(null);

  const fetchTutto = async () => {
    const par = await supabase.from('compensi_parametri').select('*').eq('id', 1).maybeSingle();
    // Finché sql/compensi.sql non è stato eseguito la tabella non esiste: senza questo controllo la
    // scheda mostrerebbe i default come se fossero i valori salvati, e il salvataggio fallirebbe
    // senza che sia chiaro il perché.
    setSchemaMancante(par.error ? par.error.message : null);
    if (par.data) setParametri(par.data);
  };

  useEffect(() => { fetchTutto(); }, []);

  // ---------------- DA CONSUNTIVARE ----------------
  // Il periodo non può arrivare oltre oggi: il futuro non si consuntiva.
  const [dal, setDal] = useState(primoDelMese);
  const [al, setAl] = useState(oggiIso);
  const [partite, setPartite] = useState([]);
  const [voci, setVoci] = useState([]);
  const [periodi, setPeriodi] = useState([]);
  const [caricamentoPartite, setCaricamentoPartite] = useState(false);
  const [operatoreEspanso, setOperatoreEspanso] = useState(null);
  const [inCorso, setInCorso] = useState(null); // chiave dell'azione in corso, per disabilitare il pulsante giusto
  const [formVoce, setFormVoce] = useState(null); // { operatore, data, tipo, descrizione, importo }
  const [formConsuntivo, setFormConsuntivo] = useState(null); // { operatore, dal, al, concordato, forfettario }

  const alEffettivo = al > oggiIso() ? oggiIso() : al;

  const fetchPartite = async () => {
    setCaricamentoPartite(true);
    // Solo partite confermate: una FORSE non giocata non genera compenso.
    const [pr, vc, pe] = await Promise.all([
      supabase.from('prenotazioni')
        .select('id, data, oraInizio, oraFine, durataOre, nominativo, campoNome, pacchettoNome, operatori')
        .eq('stato', 'CONF').gte('data', dal).lte('data', alEffettivo).order('data', { ascending: false }),
      supabase.from('op_voci').select('*').gte('data', dal).lte('data', alEffettivo),
      // I periodi servono anche fuori dall'intervallo scelto: uno che lo attraversa copre comunque
      // giornate qui dentro, e quelle non vanno riproposte.
      supabase.from('op_periodi').select('*').order('dal', { ascending: false }),
    ]);
    setCaricamentoPartite(false);
    if (pr.error || vc.error || pe.error) { console.error(pr.error || vc.error || pe.error); return; }
    setPartite((pr.data || []).filter(p => (p.operatori || []).length > 0));
    setVoci(vc.data || []);
    setPeriodi(pe.data || []);
  };

  useEffect(() => {
    if (currentView === 'daconsuntivare' || currentView === 'consuntivati') fetchPartite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, dal, al]);

  const giaConsuntivato = useCallback(
    (operatore, data) => periodi.some(p => p.operatore === operatore && data >= p.dal && data <= p.al),
    [periodi]
  );

  const preventivi = useMemo(
    () => preventiviPerOperatore(partite, voci, parametri, giaConsuntivato),
    [partite, voci, parametri, giaConsuntivato]
  );

  // ---- scritture su op_voci ----
  const recensioneDi = (operatore, prenotazioneId) =>
    voci.find(v => v.tipo === 'recensione' && v.operatore === operatore && v.riferimento === prenotazioneId);

  const alternaRecensione = async (operatore, data, prenotazioneId) => {
    const chiave = `rec-${operatore}-${prenotazioneId}`;
    setInCorso(chiave);
    const esistente = recensioneDi(operatore, prenotazioneId);
    const { error } = esistente
      ? await supabase.from('op_voci').delete().eq('id', esistente.id)
      : await supabase.from('op_voci').insert([{
          operatore, data, tipo: 'recensione', riferimento: prenotazioneId,
          descrizione: 'Recensione positiva',
          importo: parseFloat(parametri.bonus_recensione) || 0, esente_ritenuta: false,
        }]);
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nel salvataggio della recensione."); }
    fetchPartite();
  };

  const salvaVoce = async (e) => {
    e.preventDefault();
    const f = formVoce;
    if (!f.descrizione.trim()) return alert("Scrivi una descrizione: serve a ricordare a cosa si riferisce.");
    if (f.importo === '' || isNaN(parseFloat(f.importo))) return alert("Inserisci un importo.");
    setInCorso('voce');
    // Le spese sono rimborsi (esenti da ritenuta), le rettifiche correggono il compenso (imponibili).
    const { error } = await supabase.from('op_voci').insert([{
      operatore: f.operatore, data: f.data, tipo: f.tipo,
      riferimento: f.riferimento || null, descrizione: f.descrizione.trim(),
      importo: parseFloat(f.importo), esente_ritenuta: f.tipo === 'spesa',
    }]);
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nel salvataggio della voce."); }
    setFormVoce(null);
    fetchPartite();
  };

  const rimuoviVoce = async (v) => {
    if (!window.confirm(`Eliminare "${v.descrizione || v.tipo}" da ${v.data}?`)) return;
    setInCorso(`del-${v.id}`);
    const { error } = await supabase.from('op_voci').delete().eq('id', v.id);
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nell'eliminazione della voce."); }
    fetchPartite();
  };

  // ---- consuntivazione ----
  const anteprimaConsuntivo = useMemo(() => {
    if (!formConsuntivo) return null;
    const op = preventivi.find(o => o.id === formConsuntivo.operatore);
    if (!op) return null;
    // L'anteprima considera solo le giornate dentro l'intervallo scelto, che può essere piu' stretto
    // di quello filtrato: quello che si congela deve essere esattamente quello che si vede.
    const dentro = op.giornate.filter(g => g.data >= formConsuntivo.dal && g.data <= formConsuntivo.al);
    const somma = (f) => dentro.reduce((s, g) => s + f(g), 0);
    const parziale = {
      compensoOrario: somma(g => g.compenso),
      aggiunte: somma(g => g.aggiunte),
      spese: somma(g => g.spese),
      ore: somma(g => g.ore),
    };
    return {
      giornate: dentro,
      parziale,
      ...consuntivoDiPeriodo(parziale, { concordato: formConsuntivo.concordato, forfettario: formConsuntivo.forfettario }, parametri),
    };
  }, [formConsuntivo, preventivi, parametri]);

  const confermaConsuntivo = async () => {
    const f = formConsuntivo;
    const a = anteprimaConsuntivo;
    if (!a || a.giornate.length === 0) return alert("Nessuna giornata da consuntivare nell'intervallo scelto.");
    if (f.al < f.dal) return alert("La data finale non può precedere quella iniziale.");
    if (f.al > oggiIso()) return alert("Non si consuntiva il futuro: la data finale non può superare oggi.");
    setInCorso('consuntivo');
    const { error } = await supabase.from('op_periodi').insert([{
      operatore: f.operatore, dal: f.dal, al: f.al,
      concordato: f.concordato === '' ? null : parseFloat(f.concordato),
      rimborso_forfettario: a.rimborsoForfettario,
      compenso_netto: a.compensoNetto, ritenuta: a.ritenuta, spese: a.spese,
      costo_azienda: a.costoAzienda,
      // Snapshot dei parametri: ritoccarli domani non deve riscrivere questo consuntivo.
      parametri, note: f.note || null,
    }]);
    setInCorso(null);
    if (error) {
      console.error(error);
      // Il vincolo di esclusione è la rete di sicurezza contro il doppio pagamento: se scatta,
      // vale la pena dirlo con parole comprensibili invece del messaggio di Postgres.
      return alert(error.message.includes('op_periodi_no_sovrapposizioni')
        ? "Una parte di questo intervallo è già stata consuntivata per questo operatore. Restringi le date."
        : "Errore nella consuntivazione.");
    }
    setFormConsuntivo(null);
    fetchPartite();
  };

  const annullaConsuntivo = async (p) => {
    if (!window.confirm(`Riaprire il periodo di ${p.operatore} dal ${p.dal} al ${p.al}?\n\nLe giornate tornano fra quelle da consuntivare e i valori congelati vengono persi.`)) return;
    setInCorso(`riapri-${p.id}`);
    const { error } = await supabase.from('op_periodi').delete().eq('id', p.id);
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nella riapertura del periodo."); }
    fetchPartite();
  };
  const totali = useMemo(() => preventivi.reduce((a, o) => ({
    ore: a.ore + o.ore, oreAttesa: a.oreAttesa + o.oreAttesa,
    compenso: a.compenso + o.compenso, spese: a.spese + o.spese, lordo: a.lordo + o.lordo,
  }), { ore: 0, oreAttesa: 0, compenso: 0, spese: 0, lordo: 0 }), [preventivi]);

  const salvaParametri = async (e) => {
    e.preventDefault();
    const mancante = CAMPI_PARAMETRI.find(c => parametri[c.chiave] === "" || parametri[c.chiave] == null);
    if (mancante) return alert(`Inserisci un valore per "${mancante.label}".`);
    setSalvataggio(true);
    const rec = Object.fromEntries(CAMPI_PARAMETRI.map(c => [c.chiave, parseFloat(parametri[c.chiave]) || 0]));
    const { error } = await supabase.from('compensi_parametri')
      .update({ ...rec, aggiornato_il: new Date().toISOString() }).eq('id', 1);
    setSalvataggio(false);
    if (error) { console.error(error); return alert("Errore nel salvataggio dei parametri."); }
    fetchTutto();
    alert("Parametri salvati.");
  };

  const schedaVuota = (titolo, testo) => (
    <div className="schermata-storico no-print">
      <h2 style={{ margin: 0 }}>{titolo}</h2>
      <p className="descrizione-pagina">{testo}</p>
      <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '40px 20px', textAlign: 'center', color: '#666' }}>
        Scheda non ancora attiva: arriva con i prossimi passi del modulo.
      </div>
    </div>
  );

  return (
    <>
      <nav className="modulo-subnav no-print subnav-segmented">
        {puoVedere(user, 'compensi', 'config') && (
          <button className={`nav-btn ${currentView === 'config' ? 'active' : ''}`} onClick={() => setCurrentView("config")}><Icona nome="configuratore" />Configuratore</button>
        )}
        {puoVedere(user, 'compensi', 'daconsuntivare') && (
          <button className={`nav-btn ${currentView === 'daconsuntivare' ? 'active' : ''}`} onClick={() => setCurrentView("daconsuntivare")}><Icona nome="daconsuntivare" />Da consuntivare</button>
        )}
        {puoVedere(user, 'compensi', 'consuntivati') && (
          <button className={`nav-btn ${currentView === 'consuntivati' ? 'active' : ''}`} onClick={() => setCurrentView("consuntivati")}><Icona nome="consuntivati" />Consuntivati</button>
        )}
        {puoVedere(user, 'compensi', 'indicatori') && (
          <button className={`nav-btn ${currentView === 'indicatori' ? 'active' : ''}`} onClick={() => setCurrentView("indicatori")}><Icona nome="indicatori" />Indicatori</button>
        )}
      </nav>

      {/* ===================== CONFIGURATORE ===================== */}
      {currentView === "config" && puoVedere(user, 'compensi', 'config') && (
        <div className="schermata-storico no-print">
          <h2 style={{ margin: 0 }}>Configuratore compensi</h2>
          <p className="descrizione-pagina">
            Parametri del calcolo del preventivo, uguali per tutti i bubbler. Valgono da adesso in avanti:
            i periodi già consuntivati conservano i parametri con cui erano stati chiusi.
          </p>

          {schemaMancante && (
            <div style={{ marginTop: '16px', padding: '14px 18px', background: '#fff8e1', border: '1px solid #f0d999', borderLeft: '4px solid #f0a000', borderRadius: '4px' }}>
              <strong style={{ display: 'block', marginBottom: '4px' }}>Schema del database non ancora aggiornato</strong>
              <span style={{ fontSize: '0.85rem', color: '#555' }}>
                Esegui <code>sql/compensi.sql</code> nell'SQL Editor di Supabase: finché manca, i valori qui sotto sono
                solo i default e il salvataggio non va a buon fine. Il database risponde: <em>{schemaMancante}</em>
              </span>
            </div>
          )}

          <form onSubmit={salvaParametri} className="admin-table-box-full" style={{ marginTop: '20px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1rem' }}>Calcolo a ore</h3>
            <p style={{ margin: '0 0 18px 0', fontSize: '0.82rem', color: '#777', maxWidth: '72ch' }}>
              Le ore di più partite dello stesso giorno si sommano in un unico blocco se lo stacco fra una e l'altra
              rientra nel limite qui sotto. Il preventivo si calcola così per tutti: un eventuale compenso concordato
              si applica in fase di consuntivazione, non qui.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              {CAMPI_PARAMETRI.map(c => (
                <div key={c.chiave}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '5px' }}>
                    {c.label} <span style={{ color: '#888', fontWeight: 'normal' }}>({c.unita})</span>
                  </label>
                  <input
                    type="number" step="any" min="0"
                    value={parametri[c.chiave] ?? ""}
                    onChange={(e) => setParametri(p => ({ ...p, [c.chiave]: e.target.value }))}
                    style={stileInput}
                  />
                  <p style={{ margin: '5px 0 0 0', fontSize: '0.75rem', color: '#888', lineHeight: 1.4 }}>{c.aiuto}</p>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '20px' }}>
              <button type="submit" style={btnSalva} disabled={salvataggio}>
                <Icona nome="salva" size={16} style={{ marginRight: '6px' }} />
                {salvataggio ? "Salvataggio..." : "Salva parametri"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================== SCHEDE IN ARRIVO ===================== */}
      {currentView === "daconsuntivare" && puoVedere(user, 'compensi', 'daconsuntivare') && (
        <div className="schermata-storico no-print">
          <h2 style={{ margin: 0 }}>Da consuntivare</h2>
          <p className="descrizione-pagina">
            Preventivo calcolato dalle partite confermate del periodo, operatore per operatore. Spunta le recensioni,
            aggiungi spese e correzioni, poi consuntiva: da quel momento i valori si congelano e la giornata non
            accetta più modifiche. Le giornate già consuntivate spariscono da qui.
          </p>

          <div className="filtri-storico" style={{ flexWrap: 'wrap' }}>
            <div className="filtro-group" style={{ flex: '1 1 160px' }}>
              <label>Dal:</label>
              <input type="date" value={dal} max={al} onChange={(e) => setDal(e.target.value)} />
            </div>
            <div className="filtro-group" style={{ flex: '1 1 160px' }}>
              <label>Al:</label>
              <input type="date" value={al} min={dal} max={oggiIso()} onChange={(e) => setAl(e.target.value)} />
            </div>
          </div>

          {caricamentoPartite ? (
            <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '30px', textAlign: 'center', color: '#666' }}>Calcolo in corso...</div>
          ) : preventivi.length === 0 ? (
            <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '30px', textAlign: 'center', color: '#666' }}>
              Nessuna partita confermata con operatori assegnati in questo periodo.
            </div>
          ) : (
            <>
              {/* I due numeri che contano sono quanto esce di tasca: hanno peso pieno.
                  Operatori e ore restano come contesto, in corpo minore. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '20px', alignItems: 'stretch' }}>
                <div style={{ flex: '2 1 220px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px 18px' }}>
                  <span style={{ display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '4px' }}>Incassano gli operatori</span>
                  <strong style={{ fontSize: '1.7rem', lineHeight: 1.1 }}>{euro(totali.compenso + totali.spese)}</strong>
                  <span style={{ display: 'block', fontSize: '0.74rem', color: '#888', marginTop: '3px' }}>
                    {euro(totali.compenso)} di compenso{totali.spese > 0 ? ` · ${euro(totali.spese)} di rimborsi` : ''}
                  </span>
                </div>
                <div style={{ flex: '2 1 220px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px 18px' }}>
                  <span style={{ display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '4px' }}>Costo azienda</span>
                  <strong style={{ fontSize: '1.7rem', lineHeight: 1.1 }}>{euro(totali.lordo + totali.spese)}</strong>
                  <span style={{ display: 'block', fontSize: '0.74rem', color: '#888', marginTop: '3px' }}>
                    include {euro(totali.lordo - totali.compenso)} di ritenuta al {parametri.aliquota_ritenuta}%
                  </span>
                </div>
                <div style={{ flex: '1 1 150px', background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: '8px', padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>
                    <strong style={{ color: '#333' }}>{preventivi.length}</strong> operator{preventivi.length === 1 ? 'e' : 'i'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>
                    <strong style={{ color: '#333' }}>{ore(totali.ore)}</strong> pagate
                    {totali.oreAttesa > 0 && <span style={{ color: '#b26a00' }}>, {ore(totali.oreAttesa)} di attesa</span>}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
                {preventivi.map(op => {
                  const espanso = operatoreEspanso === op.id;
                  return (
                    <div key={op.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
                      <div
                        onClick={() => setOperatoreEspanso(espanso ? null : op.id)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '14px 16px', cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.7rem', color: '#888' }}>{espanso ? '▼' : '▶'}</span>
                          <strong style={{ fontSize: '1rem' }}>{op.nome}</strong>
                          <span style={{ color: '#888', fontSize: '0.8rem' }}>{op.giornate.length} giornat{op.giornate.length === 1 ? 'a' : 'e'}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                          <span>{ore(op.ore)}</span>
                          <span><strong>{euro(op.compenso)}</strong> netto</span>
                          {op.spese > 0 && <span style={{ color: '#b26a00' }}>+{euro(op.spese)} spese</span>}
                          <span style={{ color: '#666' }}>{euro(op.costoAzienda)} costo</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const date = op.giornate.map(g => g.data).sort();
                              setFormConsuntivo({
                                operatore: op.id, nome: op.nome,
                                dal: date[0], al: date[date.length - 1],
                                concordato: '', forfettario: '', note: '',
                              });
                            }}
                            style={{ ...btnSalva, padding: '6px 12px', fontSize: '0.78rem' }}
                          >
                            <Icona nome="consuntivati" size={14} style={{ marginRight: '5px' }} />Consuntiva
                          </button>
                        </div>
                      </div>

                      {espanso && (
                        <div style={{ borderTop: '1px solid #eee', overflowX: 'auto' }}>
                          <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                            <thead>
                              <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #ddd' }}>
                                <th style={{ padding: '8px 16px', width: '96px' }}>Data</th>
                                <th style={{ padding: '8px 16px' }}>Voce</th>
                                <th style={{ padding: '8px 16px', textAlign: 'right', width: '70px' }}>Ore</th>
                                <th style={{ padding: '8px 16px', textAlign: 'right', width: '90px' }}>Compenso</th>
                                <th style={{ padding: '8px 16px', textAlign: 'center', width: '110px' }}>Recensione</th>
                                <th style={{ padding: '8px 16px', textAlign: 'right', width: '90px' }}>Totale</th>
                                <th style={{ padding: '8px 8px', width: '34px' }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {op.giornate.map(g => {
                                const righePartite = g.blocchi.flatMap((b, iBlocco) =>
                                  b.partite.map(x => ({ ...x, iBlocco, blocco: b }))
                                );
                                const vociExtra = g.voci.filter(v => v.tipo !== 'recensione');
                                const totaleGiornata = g.compenso + g.aggiunte + g.spese;
                                const piuRighe = righePartite.length + vociExtra.length > 1;

                                return (
                                  <Fragment key={g.data}>
                                    {righePartite.map((x, i) => {
                                      const rec = recensioneDi(op.id, x.partita.id);
                                      const chiave = `rec-${op.id}-${x.partita.id}`;
                                      const nuovoBlocco = i > 0 && x.iBlocco !== righePartite[i - 1].iBlocco;
                                      return (
                                        <tr key={x.partita.id} style={{ borderTop: nuovoBlocco ? '1px dashed #ddd' : undefined }}>
                                          <td style={{ padding: '7px 16px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                                            {i === 0 && <strong>{dataBreve(g.data)}</strong>}
                                          </td>
                                          <td style={{ padding: '7px 16px' }}>
                                            {x.partita.id} <span style={{ color: '#666' }}>{x.partita.nominativo || ''}</span>
                                            <br />
                                            <span style={{ color: '#999', fontSize: '0.75rem' }}>
                                              {intervalloPartita(x.partita)}
                                              {g.blocchi.length > 1 && ` · blocco ${x.iBlocco + 1}`}
                                              {x.attesaMin > 0 && (
                                                <span style={{ color: '#b26a00' }} title="Attesa pagata, attribuita a questa partita">
                                                  {' '}· più {ore(x.attesaMin / 60)} di attesa prima
                                                </span>
                                              )}
                                            </span>
                                          </td>
                                          <td style={{ padding: '7px 16px', textAlign: 'right' }}>{ore(x.oreAttribuite)}</td>
                                          <td style={{ padding: '7px 16px', textAlign: 'right' }}>{euro(x.compenso)}</td>
                                          <td style={{ padding: '7px 16px', textAlign: 'center' }}>
                                            <label
                                              title="Una sola recensione per operatore per partita"
                                              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer', color: rec ? '#1c7a4e' : '#aaa' }}
                                            >
                                              <input
                                                type="checkbox" checked={!!rec} disabled={inCorso === chiave}
                                                onChange={() => alternaRecensione(op.id, g.data, x.partita.id)}
                                              />
                                              {rec ? `+${euro(rec.importo)}` : '—'}
                                            </label>
                                          </td>
                                          <td style={{ padding: '7px 16px', textAlign: 'right', fontWeight: 500 }}>
                                            {euro(x.compenso + (rec ? parseFloat(rec.importo) || 0 : 0))}
                                          </td>
                                          <td></td>
                                        </tr>
                                      );
                                    })}

                                    {vociExtra.map(v => (
                                      <tr key={v.id}>
                                        <td style={{ padding: '7px 16px' }}>
                                          {righePartite.length === 0 && <strong>{dataBreve(g.data)}</strong>}
                                        </td>
                                        <td style={{ padding: '7px 16px' }}>
                                          <span style={{
                                            fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em',
                                            padding: '1px 6px', borderRadius: '3px', marginRight: '6px',
                                            background: v.tipo === 'spesa' ? '#fff3e0' : '#e8eaf6',
                                            color: v.tipo === 'spesa' ? '#b26a00' : '#3949ab',
                                          }}>{v.tipo}</span>
                                          {v.descrizione}
                                          {v.esente_ritenuta && <span style={{ color: '#999', fontSize: '0.72rem' }}> · esente da ritenuta</span>}
                                        </td>
                                        <td style={{ padding: '7px 16px', textAlign: 'right', color: '#ccc' }}>—</td>
                                        <td style={{ padding: '7px 16px', textAlign: 'right', color: '#ccc' }}>—</td>
                                        <td style={{ padding: '7px 16px', textAlign: 'center', color: '#ccc' }}>—</td>
                                        <td style={{ padding: '7px 16px', textAlign: 'right', fontWeight: 500 }}>{euro(v.importo)}</td>
                                        <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                                          <button
                                            type="button" className="btn-icon-action" aria-label="Elimina voce" title="Elimina voce"
                                            disabled={inCorso === `del-${v.id}`} onClick={() => rimuoviVoce(v)}
                                          >
                                            <Icona nome="elimina" size={13} style={{ marginRight: 0 }} />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}

                                    {righePartite.length === 0 && vociExtra.length === 0 && (
                                      <tr>
                                        <td style={{ padding: '7px 16px' }}><strong>{dataBreve(g.data)}</strong></td>
                                        <td colSpan="6" style={{ padding: '7px 16px', color: '#999' }}>Giornata senza partite né voci</td>
                                      </tr>
                                    )}

                                    {/* Totale della giornata: si mostra solo quando c'è più di una riga da sommare,
                                        altrimenti ripeterebbe la riga sopra. */}
                                    {piuRighe && (
                                      <tr style={{ background: '#fafafa' }}>
                                        <td></td>
                                        <td style={{ padding: '5px 16px', color: '#888', fontSize: '0.76rem' }}>
                                          totale {dataBreve(g.data)}
                                          {g.tettoApplicato && (
                                            <span style={{ color: '#c62828' }}> · ridotto dal tetto ({euro(g.primaDelTetto)} → {euro(g.compenso)})</span>
                                          )}
                                        </td>
                                        <td style={{ padding: '5px 16px', textAlign: 'right', color: '#888' }}>{ore(g.ore)}</td>
                                        <td style={{ padding: '5px 16px', textAlign: 'right', color: '#888' }}>{euro(g.compenso)}</td>
                                        <td></td>
                                        <td style={{ padding: '5px 16px', textAlign: 'right', fontWeight: 'bold' }}>{euro(totaleGiornata)}</td>
                                        <td></td>
                                      </tr>
                                    )}

                                    <tr style={{ borderBottom: '1px solid #e8e8e8' }}>
                                      <td></td>
                                      <td colSpan="6" style={{ padding: '2px 16px 8px' }}>
                                        <button
                                          type="button"
                                          onClick={() => setFormVoce({ operatore: op.id, data: g.data, tipo: 'spesa', descrizione: '', importo: '', riferimento: '' })}
                                          style={{ background: 'none', border: 'none', color: '#0288d1', cursor: 'pointer', fontSize: '0.75rem', padding: 0, marginRight: '12px' }}
                                        >+ spesa</button>
                                        <button
                                          type="button"
                                          onClick={() => setFormVoce({ operatore: op.id, data: g.data, tipo: 'rettifica', descrizione: '', importo: '', riferimento: '' })}
                                          style={{ background: 'none', border: 'none', color: '#0288d1', cursor: 'pointer', fontSize: '0.75rem', padding: 0 }}
                                        >+ correzione</button>
                                      </td>
                                    </tr>
                                  </Fragment>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr style={{ borderTop: '2px solid #333', background: '#f5f8fa' }}>
                                <td style={{ padding: '10px 16px', fontWeight: 'bold' }} colSpan="2">Totale {op.nome}</td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 'bold' }}>{ore(op.ore)}</td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 'bold' }}>{euro(op.compensoOrario)}</td>
                                <td style={{ padding: '10px 16px', textAlign: 'center', color: '#888', fontSize: '0.76rem' }}>
                                  {op.aggiunte !== 0 ? euro(op.aggiunte) : '—'}
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 'bold' }}>{euro(op.compenso + op.spese)}</td>
                                <td></td>
                              </tr>
                              <tr style={{ background: '#f5f8fa' }}>
                                <td colSpan="5" style={{ padding: '0 16px 10px', color: '#888', fontSize: '0.76rem' }}>
                                  di cui {euro(op.compenso)} di compenso{op.spese > 0 ? ` e ${euro(op.spese)} di rimborsi esenti` : ''} · costo azienda con ritenuta {euro(op.costoAzienda)}
                                </td>
                                <td colSpan="2"></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------- Aggiunta di una voce manuale ---------- */}
      {formVoce && (
        <div className="modal-form-backdrop" onClick={() => setFormVoce(null)}>
          <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setFormVoce(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0288d1' }}>
              {formVoce.tipo === 'spesa' ? 'Rimborso spese' : 'Correzione del compenso'}
            </h3>
            <p style={{ margin: '0 0 15px 0', fontSize: '0.8rem', color: '#777' }}>
              {formVoce.tipo === 'spesa'
                ? 'Pranzo, hotel, pedaggi. Esente da ritenuta: si rimborsa e basta, non è compenso.'
                : "Si aggiunge al compenso senza sovrascrivere il calcolo — l'ora persa nel traffico diventa una riga in più. Un importo negativo lo riduce."}
            </p>
            <form onSubmit={salvaVoce} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Giornata</label>
                <input type="date" value={formVoce.data} onChange={(e) => setFormVoce(f => ({ ...f, data: e.target.value }))} style={stileInput} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Descrizione</label>
                <input
                  type="text" autoFocus value={formVoce.descrizione}
                  placeholder={formVoce.tipo === 'spesa' ? 'es. pranzo' : "es. un'ora in più per il traffico"}
                  onChange={(e) => setFormVoce(f => ({ ...f, descrizione: e.target.value }))} style={stileInput}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Importo (€)</label>
                <input
                  type="number" step="any" value={formVoce.importo}
                  onChange={(e) => setFormVoce(f => ({ ...f, importo: e.target.value }))} style={stileInput}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" style={btnSalva} disabled={inCorso === 'voce'}>
                  <Icona nome="salva" size={16} style={{ marginRight: '6px' }} />
                  {inCorso === 'voce' ? 'Salvataggio...' : 'Aggiungi'}
                </button>
                <button type="button" className="btn-outline-annulla" style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', borderRadius: '4px', fontSize: '0.85rem' }} onClick={() => setFormVoce(null)}>
                  <Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />Annulla
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- Consuntivazione di un periodo ---------- */}
      {formConsuntivo && anteprimaConsuntivo && (
        <div className="modal-form-backdrop" onClick={() => setFormConsuntivo(null)}>
          <div className="modal-form-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setFormConsuntivo(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0288d1' }}>Consuntiva {formConsuntivo.nome}</h3>
            <p style={{ margin: '0 0 15px 0', fontSize: '0.8rem', color: '#777' }}>
              I valori vengono congelati come sono adesso. Dopo, le giornate del periodo non accettano più voci.
            </p>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 140px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Dal</label>
                <input type="date" value={formConsuntivo.dal} max={formConsuntivo.al} onChange={(e) => setFormConsuntivo(f => ({ ...f, dal: e.target.value }))} style={stileInput} />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Al</label>
                <input type="date" value={formConsuntivo.al} min={formConsuntivo.dal} max={oggiIso()} onChange={(e) => setFormConsuntivo(f => ({ ...f, al: e.target.value }))} style={stileInput} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
              <div style={{ flex: '1 1 180px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Compenso concordato (€)</label>
                <input
                  type="number" step="any" min="0" placeholder="lascia vuoto per il calcolo a ore"
                  value={formConsuntivo.concordato}
                  onChange={(e) => setFormConsuntivo(f => ({ ...f, concordato: e.target.value }))} style={stileInput}
                />
                <p style={{ margin: '4px 0 0 0', fontSize: '0.72rem', color: '#888' }}>Sostituisce le ore; recensioni e correzioni restano sopra.</p>
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Rimborso forfettario (€)</label>
                <input
                  type="number" step="any" min="0" placeholder="0"
                  value={formConsuntivo.forfettario}
                  onChange={(e) => setFormConsuntivo(f => ({ ...f, forfettario: e.target.value }))} style={stileInput}
                />
                <p style={{ margin: '4px 0 0 0', fontSize: '0.72rem', color: '#888' }}>Non cambia quanto incassa: esce dalla base imponibile.</p>
              </div>
            </div>

            {/* Anteprima: gli stessi numeri che finiranno congelati */}
            <div style={{ marginTop: '16px', background: '#f8fafc', border: '1px solid #e0e0e0', borderRadius: '6px', padding: '14px 16px' }}>
              {anteprimaConsuntivo.giornate.length === 0 ? (
                <p style={{ margin: 0, color: '#c62828', fontSize: '0.85rem' }}>Nessuna giornata in questo intervallo.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <tbody>
                    <tr><td style={{ padding: '3px 0', color: '#666' }}>{anteprimaConsuntivo.giornate.length} giornat{anteprimaConsuntivo.giornate.length === 1 ? 'a' : 'e'} · {ore(anteprimaConsuntivo.parziale.ore)}</td><td></td></tr>
                    <tr>
                      <td style={{ padding: '3px 0' }}>{anteprimaConsuntivo.concordatoApplicato ? 'Compenso concordato' : 'Compenso a ore'}</td>
                      <td style={{ textAlign: 'right' }}>{euro(anteprimaConsuntivo.base)}</td>
                    </tr>
                    {anteprimaConsuntivo.parziale.aggiunte !== 0 && (
                      <tr><td style={{ padding: '3px 0' }}>Recensioni e correzioni</td><td style={{ textAlign: 'right' }}>{euro(anteprimaConsuntivo.parziale.aggiunte)}</td></tr>
                    )}
                    <tr style={{ borderTop: '1px solid #ddd' }}>
                      <td style={{ padding: '5px 0', fontWeight: 'bold' }}>Compenso</td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{euro(anteprimaConsuntivo.compensoNetto)}</td>
                    </tr>
                    {anteprimaConsuntivo.rimborsoForfettario > 0 && (
                      <>
                        <tr><td style={{ padding: '3px 0', color: '#666' }}>di cui forfettario, esente</td><td style={{ textAlign: 'right', color: '#666' }}>{euro(anteprimaConsuntivo.rimborsoForfettario)}</td></tr>
                        <tr><td style={{ padding: '3px 0', color: '#666' }}>imponibile</td><td style={{ textAlign: 'right', color: '#666' }}>{euro(anteprimaConsuntivo.imponibile)}</td></tr>
                      </>
                    )}
                    <tr><td style={{ padding: '3px 0' }}>Ritenuta {parametri.aliquota_ritenuta}%</td><td style={{ textAlign: 'right', color: '#c62828' }}>{euro(anteprimaConsuntivo.ritenuta)}</td></tr>
                    {anteprimaConsuntivo.spese > 0 && (
                      <tr><td style={{ padding: '3px 0' }}>Rimborso spese</td><td style={{ textAlign: 'right' }}>{euro(anteprimaConsuntivo.spese)}</td></tr>
                    )}
                    <tr style={{ borderTop: '2px solid #333' }}>
                      <td style={{ padding: '6px 0', fontWeight: 'bold' }}>Costo azienda</td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{euro(anteprimaConsuntivo.costoAzienda)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '3px 0', color: '#666' }}>Incassa {formConsuntivo.nome}</td>
                      <td style={{ textAlign: 'right', color: '#666' }}>{euro(anteprimaConsuntivo.incassaOperatore)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button type="button" onClick={confermaConsuntivo} style={btnSalva} disabled={inCorso === 'consuntivo' || anteprimaConsuntivo.giornate.length === 0}>
                <Icona nome="salva" size={16} style={{ marginRight: '6px' }} />
                {inCorso === 'consuntivo' ? 'Salvataggio...' : 'Consuntiva e congela'}
              </button>
              <button type="button" className="btn-outline-annulla" style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', borderRadius: '4px', fontSize: '0.85rem' }} onClick={() => setFormConsuntivo(null)}>
                <Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== CONSUNTIVATI ===================== */}
      {currentView === "consuntivati" && puoVedere(user, 'compensi', 'consuntivati') && (
        <div className="schermata-storico no-print">
          <h2 style={{ margin: 0 }}>Consuntivati</h2>
          <p className="descrizione-pagina">
            Periodi chiusi, con i valori congelati al momento della consuntivazione. Riaprirne uno rimette le sue
            giornate fra quelle da consuntivare e cancella i valori salvati.
          </p>

          {periodi.length === 0 ? (
            <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '30px', textAlign: 'center', color: '#666' }}>
              Nessun periodo consuntivato.
            </div>
          ) : (
            <div className="admin-table-box-full" style={{ marginTop: '20px', overflowX: 'auto' }}>
              <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: '10px' }}>Operatore</th>
                    <th style={{ padding: '10px' }}>Periodo</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>Compenso</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>Ritenuta</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>Spese</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>Costo azienda</th>
                    <th style={{ padding: '10px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {periodi.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '10px' }}><strong>{p.operatore}</strong></td>
                      <td style={{ padding: '10px' }}>
                        {p.dal === p.al ? dataBreve(p.dal) : `${dataBreve(p.dal)} → ${dataBreve(p.al)}`}
                        {p.concordato != null && <><br /><span style={{ color: '#0288d1', fontSize: '0.75rem' }}>concordato {euro(p.concordato)}</span></>}
                        {p.rimborso_forfettario > 0 && <><br /><span style={{ color: '#b26a00', fontSize: '0.75rem' }}>forfettario {euro(p.rimborso_forfettario)}</span></>}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>{euro(p.compenso_netto)}</td>
                      <td style={{ padding: '10px', textAlign: 'right', color: '#c62828' }}>{euro(p.ritenuta)}</td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>{euro(p.spese)}</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold' }}>{euro(p.costo_azienda)}</td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>
                        <button
                          type="button" className="btn-icon-action" aria-label="Riapri periodo" title="Riapri periodo"
                          disabled={inCorso === `riapri-${p.id}`} onClick={() => annullaConsuntivo(p)}
                        >
                          <Icona nome="riporta" size={16} style={{ marginRight: 0 }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {currentView === "indicatori" && puoVedere(user, 'compensi', 'indicatori') && schedaVuota(
        "Indicatori",
        "Ore per operatore, costo medio orario e incidenza del personale sul margine."
      )}
    </>
  );
}

export default Compensi
