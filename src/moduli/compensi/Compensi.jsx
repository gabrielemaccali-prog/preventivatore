import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import Icona from '../../components/Icona'
import { preventiviPerOperatore, oreDiPartita } from './calcolo'

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
  const [caricamentoPartite, setCaricamentoPartite] = useState(false);
  const [operatoreEspanso, setOperatoreEspanso] = useState(null);

  const fetchPartite = async () => {
    setCaricamentoPartite(true);
    // Solo partite confermate: una FORSE non giocata non genera compenso.
    const { data, error } = await supabase.from('prenotazioni')
      .select('id, data, oraInizio, oraFine, durataOre, nominativo, campoNome, pacchettoNome, operatori')
      .eq('stato', 'CONF')
      .gte('data', dal)
      .lte('data', al > oggiIso() ? oggiIso() : al)
      .order('data', { ascending: false });
    setCaricamentoPartite(false);
    if (error) { console.error(error); return; }
    setPartite((data || []).filter(p => (p.operatori || []).length > 0));
  };

  useEffect(() => {
    if (currentView === 'daconsuntivare') fetchPartite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, dal, al]);

  const preventivi = useMemo(() => preventiviPerOperatore(partite, parametri), [partite, parametri]);
  const totali = useMemo(() => preventivi.reduce((a, o) => ({
    ore: a.ore + o.ore, oreAttesa: a.oreAttesa + o.oreAttesa, compenso: a.compenso + o.compenso, lordo: a.lordo + o.lordo,
  }), { ore: 0, oreAttesa: 0, compenso: 0, lordo: 0 }), [preventivi]);

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
            Preventivo calcolato dalle partite confermate del periodo, operatore per operatore. È solo una lettura:
            niente è ancora salvato e nulla entra nei costi. Recensioni, spese e consuntivazione arrivano al passo successivo.
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
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '20px' }}>
                <div style={{ flex: '1 1 160px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '14px 16px' }}>
                  <span style={{ display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '4px' }}>Operatori</span>
                  <strong style={{ fontSize: '1.2rem' }}>{preventivi.length}</strong>
                </div>
                <div style={{ flex: '1 1 160px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '14px 16px' }}>
                  <span style={{ display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '4px' }}>Ore pagate</span>
                  <strong style={{ fontSize: '1.2rem' }}>{ore(totali.ore)}</strong>
                  {totali.oreAttesa > 0 && <span style={{ display: 'block', fontSize: '0.72rem', color: '#b26a00', marginTop: '2px' }}>di cui {ore(totali.oreAttesa)} di attesa</span>}
                </div>
                <div style={{ flex: '1 1 160px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '14px 16px' }}>
                  <span style={{ display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '4px' }}>Netto in mano</span>
                  <strong style={{ fontSize: '1.2rem' }}>{euro(totali.compenso)}</strong>
                </div>
                <div style={{ flex: '1 1 160px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '14px 16px' }}>
                  <span style={{ display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '4px' }}>Costo azienda</span>
                  <strong style={{ fontSize: '1.2rem' }}>{euro(totali.lordo)}</strong>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: '#888', marginTop: '2px' }}>ritenuta {parametri.aliquota_ritenuta}% inclusa</span>
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
                        <div style={{ display: 'flex', gap: '18px', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                          <span>{ore(op.ore)}</span>
                          <span><strong>{euro(op.compenso)}</strong> netto</span>
                          <span style={{ color: '#666' }}>{euro(op.lordo)} costo</span>
                        </div>
                      </div>

                      {espanso && (
                        <div style={{ borderTop: '1px solid #eee', overflowX: 'auto' }}>
                          <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                            <thead>
                              <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #ddd' }}>
                                <th style={{ padding: '8px 16px' }}>Giornata</th>
                                <th style={{ padding: '8px 16px' }}>Blocchi e partite</th>
                                <th style={{ padding: '8px 16px', textAlign: 'right' }}>Ore</th>
                                <th style={{ padding: '8px 16px', textAlign: 'right' }}>Compenso</th>
                              </tr>
                            </thead>
                            <tbody>
                              {op.giornate.map(g => (
                                <Fragment key={g.data}>
                                  {g.blocchi.map((b, i) => (
                                    <tr key={`${g.data}-${i}`} style={{ borderBottom: i === g.blocchi.length - 1 ? '1px solid #e8e8e8' : '1px dashed #f0f0f0' }}>
                                      <td style={{ padding: '8px 16px', whiteSpace: 'nowrap' }}>
                                        {i === 0 ? <strong>{g.data}</strong> : ''}
                                      </td>
                                      <td style={{ padding: '8px 16px' }}>
                                        <span style={{ color: '#0288d1', fontWeight: 'bold', fontSize: '0.78rem' }}>
                                          {oraDiMinuti(b.inizio)}–{oraDiMinuti(b.fine)}
                                        </span>
                                        {g.blocchi.length > 1 && <span style={{ color: '#888', fontSize: '0.75rem' }}> · blocco {i + 1} di {g.blocchi.length}</span>}
                                        <br />
                                        <span style={{ color: '#666', fontSize: '0.78rem' }}>
                                          {b.partite.map((x, j) => (
                                            <Fragment key={x.partita.id}>
                                              {j > 0 && <span style={{ color: '#bbb' }}> · </span>}
                                              {x.attesaMin > 0 && (
                                                <span style={{ color: '#b26a00' }} title="Attesa pagata, attribuita alla partita che segue">
                                                  attesa {ore(x.attesaMin / 60)} →{' '}
                                                </span>
                                              )}
                                              {x.partita.id} {x.partita.nominativo || ''} ({ore(oreDiPartita(x.partita))})
                                            </Fragment>
                                          ))}
                                        </span>
                                      </td>
                                      <td style={{ padding: '8px 16px', textAlign: 'right' }}>
                                        {ore(b.ore)}
                                        {b.oreAttesa > 0 && (
                                          <><br /><span style={{ color: '#b26a00', fontSize: '0.72rem' }}>di cui {ore(b.oreAttesa)} attesa</span></>
                                        )}
                                      </td>
                                      <td style={{ padding: '8px 16px', textAlign: 'right' }}>{euro(b.compenso)}</td>
                                    </tr>
                                  ))}
                                  {(g.blocchi.length > 1 || g.tettoApplicato) && (
                                    <tr style={{ borderBottom: '1px solid #e8e8e8', background: '#fafafa' }}>
                                      <td style={{ padding: '6px 16px' }}></td>
                                      <td style={{ padding: '6px 16px', color: '#888', fontSize: '0.78rem' }}>
                                        {g.tettoApplicato
                                          ? `Totale giornata ${euro(g.primaDelTetto)}, ridotto al tetto di ${euro(parametri.tetto_giornaliero)}`
                                          : 'Totale giornata'}
                                      </td>
                                      <td style={{ padding: '6px 16px', textAlign: 'right', color: '#888' }}>{ore(g.ore)}</td>
                                      <td style={{ padding: '6px 16px', textAlign: 'right', fontWeight: 'bold', color: g.tettoApplicato ? '#c62828' : '#333' }}>{euro(g.compenso)}</td>
                                    </tr>
                                  )}
                                </Fragment>
                              ))}
                            </tbody>
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

      {currentView === "consuntivati" && puoVedere(user, 'compensi', 'consuntivati') && schedaVuota(
        "Consuntivati",
        "Lo storico congelato, e l'accumulo di più periodi per operatore fino al documento."
      )}

      {currentView === "indicatori" && puoVedere(user, 'compensi', 'indicatori') && schedaVuota(
        "Indicatori",
        "Ore per operatore, costo medio orario e incidenza del personale sul margine."
      )}
    </>
  );
}

export default Compensi
