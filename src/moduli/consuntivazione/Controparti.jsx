import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA, etichettaPartita } from '../../lib/utils'
import { STATO_PREN } from '../../lib/costanti'
import { risolutoreSedi, daConsuntivareFornitori, daConsuntivareCampi, periodoDaControparte, arrotonda2 } from '../../lib/fornitori'

// ============================================================
// Consuntivazione di chi paghiamo: i fornitori che ci noleggiano i giochi e i campi dove si gioca.
//
// Come i compensi, senza il documento: il costo nasce preventivato sulla prenotazione, si corregge
// con le rettifiche e si consuntiva per periodo. Consuntivare vuol dire che è stato pagato. Le
// fatture di chi paghiamo non si registrano.
//
// Una controparte può anche essere cliente: le partite che ci commissiona non si incassano e non
// si fatturano, si compensano qui. Costo e ricavo restano interi, ognuno dalla sua parte, e quello
// che si paga è la differenza.
//
// Fornitori e campi seguono le stesse regole e vivono nelle stesse tabelle: cambiano il nome delle
// cose e le parti in cui si divide il costo, e quelle stanno in CONFIG.
// ============================================================

const oggiIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const euro = (v) => `€${(+v || 0).toFixed(2)}`;
const periodoTesto = (dal, al) => (dal === al ? formattaDataGGMMAAAA(dal) : `${formattaDataGGMMAAAA(dal)} → ${formattaDataGGMMAAAA(al)}`);

const CONFIG = {
  fornitore: {
    titolo: 'Fornitori',
    intestazione: 'Fornitore',
    descrizione: 'Quello che dobbiamo a chi ci noleggia i giochi. Il costo preventivato è quello scritto sulla prenotazione; con le rettifiche diventa il consuntivato, che si chiude per periodo quando è stato pagato. Le partite commissionate da un fornitore ("cliente fornitore" sulla prenotazione) non si incassano: si compensano qui, e si paga la differenza.',
    vuoto: 'Niente da consuntivare: i costi dei fornitori delle partite giocate sono già tutti chiusi.',
    titoloCosto: 'Il costo preventivato scritto sulla prenotazione: quello che dobbiamo al fornitore',
    titoloCredito: 'Il prezzo netto delle partite che il fornitore ci ha commissionato',
    // Le parti del costo come le ha calcolate il preventivo collegato.
    parti: [
      { campo: 'tariffa', label: 'Tariffa', titolo: 'La tariffa di noleggio del preventivo' },
      { campo: 'km', label: 'Km', titolo: 'La logistica a km del preventivo', dettaglio: (d) => (d.kmPercorsi ? `${String(d.kmPercorsi).replace('.', ',')} km di andata` : undefined) },
      { campo: 'extra', label: 'Extra', titolo: 'Gli extra del preventivo' },
    ],
    // La prenotazione tiene il totale arrotondato alla decina, quindi le parti possono restare
    // qualche euro sotto: lo si dice passando sul costo, invece di inventare una colonna.
    spiegaCosto: (d) => `Tariffa ${euro(d.tariffa)}${d.concordato ? ' (concordata)' : ''} + km ${euro(d.km)} + extra ${euro(d.extra)}`,
    senzaDettaglio: 'Nessun preventivo collegato: il dettaglio del costo non si conosce',
    avvisoSenza: (n) => `${n === 1 ? 'Una partita ha' : `${n} partite hanno`} un costo di noleggio senza un fornitore riconoscibile, e qui non compaiono`,
    rimedioSenza: 'Collega il preventivo o indica la sede nelle righe della prenotazione.',
  },
  campo: {
    titolo: 'Campi',
    intestazione: 'Campo',
    descrizione: "Quello che dobbiamo ai centri sportivi: l'affitto del campo e il rinfresco, al netto dell'IVA, come li ha calcolati la prenotazione. Con le rettifiche diventa il consuntivato, che si chiude per periodo quando è stato pagato. Le partite commissionate da un campo (\"cliente fornitore\" sulla prenotazione) non si incassano: si compensano qui, e si paga la differenza.",
    vuoto: 'Niente da consuntivare: affitti e rinfreschi delle partite giocate sono già tutti chiusi.',
    titoloCosto: 'Affitto più rinfresco: quello che dobbiamo al campo',
    titoloCredito: 'Il prezzo netto delle partite che il campo ci ha commissionato',
    parti: [
      { campo: 'affitto', label: 'Affitto', titolo: "L'affitto del campo, al netto dell'IVA" },
      { campo: 'rinfresco', label: 'Rinfresco', titolo: "Merenda o aperitivo, al netto dell'IVA" },
    ],
    spiegaCosto: (d) => `Affitto ${euro(d.affitto)} + rinfresco ${euro(d.rinfresco)}`,
    senzaDettaglio: undefined,
    avvisoSenza: (n) => `${n === 1 ? 'Una partita è giocata' : `${n} partite sono giocate`} su un campo che non è più in anagrafica, e qui non compaiono`,
    rimedioSenza: 'Ricrea il campo o sposta la prenotazione su uno esistente.',
  },
};

// Il saldo detto a parole: chi paga chi. Senza, un numero negativo va interpretato.
const saldoTesto = (saldo) => {
  if (Math.abs(saldo) < 0.005) return { testo: 'Pari', colore: '#64748b' };
  return saldo > 0
    ? { testo: `${euro(saldo)} da pagare`, colore: '#b91c1c' }
    : { testo: `${euro(-saldo)} da incassare`, colore: '#15803d' };
};

const stileInput = { width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' };
const btnSalva = { display: 'inline-flex', alignItems: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' };
const btnRiga = { display: 'inline-flex', alignItems: 'center', padding: '6px 12px', borderRadius: '4px', fontSize: '0.78rem' };
const cella = { padding: '7px 10px' };
const destra = { ...cella, textAlign: 'right', whiteSpace: 'nowrap' };
const nessuno = <span style={{ color: '#cbd5e1' }}>—</span>;

// Cella cliccabile della rettifica, come nei compensi: un "+" quando è vuota, altrimenti il
// totale. Deve sembrare cliccabile anche da vuota, o nessuno scopre che si può correggere.
const cellaRettifica = (valorizzata) => ({
  border: `1px solid ${valorizzata ? '#3949ab' : '#ddd'}`,
  background: valorizzata ? '#fff' : 'transparent',
  color: valorizzata ? '#3949ab' : '#aaa',
  borderRadius: '4px', padding: '3px 8px', cursor: 'pointer',
  fontSize: '0.8rem', fontWeight: valorizzata ? 600 : 400, minWidth: '52px', textAlign: 'right',
});

function Controparti({ tipo }) {
  const cfg = CONFIG[tipo];
  const [vista, setVista] = useState('daconsuntivare');
  const [prenotazioni, setPrenotazioni] = useState([]);
  const [sedi, setSedi] = useState([]);
  const [campi, setCampi] = useState([]);
  const [listino, setListino] = useState([]);
  const [preventivi, setPreventivi] = useState([]);
  const [giochi, setGiochi] = useState([]);
  const [voci, setVoci] = useState([]);
  const [periodi, setPeriodi] = useState([]);
  // Finché gli script SQL non sono stati eseguiti le tabelle non esistono: senza avviso la pagina
  // sembrerebbe solo vuota, e il primo salvataggio fallirebbe senza spiegazioni.
  const [schemaMancante, setSchemaMancante] = useState(null);
  const [caricamento, setCaricamento] = useState(true);

  const [dal, setDal] = useState('');
  const [al, setAl] = useState('');
  const [espanso, setEspanso] = useState(null);
  const [inCorso, setInCorso] = useState(null);
  const [formVoce, setFormVoce] = useState(null); // { controparte, riga, descrizione, importo }
  const [formConsuntivo, setFormConsuntivo] = useState(null); // { gruppo, data }

  const fetchTutto = async () => {
    setCaricamento(true);
    const [pr, se, ca, li, pv, gi, vc, pe] = await Promise.all([
      // Solo il passato: il futuro non si consuntiva, come nei compensi.
      supabase.from('prenotazioni').select('*').eq('stato', STATO_PREN.CONFERMATO).lte('data', oggiIso()).order('data'),
      supabase.from('sedi').select('*'),
      supabase.from('pren_campi').select('id, nome').order('nome'),
      supabase.from('gonfiabili').select('id, giocoId, locationId'),
      // Le righe e gli extra del preventivo dicono di cosa è fatto il costo di un fornitore.
      supabase.from('preventivi').select('codice, gonfiabili, extras'),
      supabase.from('giochi').select('id, nome'),
      supabase.from('cons_voci').select('*').eq('controparte', tipo),
      supabase.from('cons_periodi').select('*').eq('controparte', tipo).order('dal', { ascending: false }),
    ]);
    setCaricamento(false);
    setSchemaMancante(vc.error?.message || pe.error?.message || null);
    if (pr.data) setPrenotazioni(pr.data);
    if (se.data) setSedi(se.data);
    if (ca.data) setCampi(ca.data);
    if (li.data) setListino(li.data);
    if (pv.data) setPreventivi(pv.data);
    if (gi.data) setGiochi(gi.data);
    setVoci(vc.data || []);
    setPeriodi(pe.data || []);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchTutto(); }, [tipo]);

  const nomeGiocoPerId = useMemo(() => Object.fromEntries(giochi.map(g => [g.id, g.nome])), [giochi]);
  const anagrafica = tipo === 'campo' ? campi : sedi;
  const contropartePerId = useMemo(() => Object.fromEntries(anagrafica.map(c => [String(c.id), c])), [anagrafica]);
  const risolutore = useMemo(() => risolutoreSedi({ sedi, listino, preventivi }), [sedi, listino, preventivi]);

  const alEffettivo = al && al < oggiIso() ? al : oggiIso();
  const nelFiltro = useCallback((data) => (!dal || data >= dal) && data <= alEffettivo, [dal, alEffettivo]);

  const { controparti: gruppi, senzaControparte } = useMemo(
    () => (tipo === 'campo'
      ? daConsuntivareCampi({ prenotazioni, campi, voci, periodi, nelFiltro })
      : daConsuntivareFornitori({ prenotazioni, sedi, risolutore, voci, periodi, nelFiltro })),
    [tipo, prenotazioni, campi, sedi, risolutore, voci, periodi, nelFiltro]
  );

  // Di che partita si tratta: i giochi del fornitore quando la riga li dice, altrimenti il gioco
  // della prenotazione. Il pacchetto davanti, come in tutte le altre tabelle.
  const etichettaRiga = (r) => {
    const p = r.prenotazione;
    const nomi = r.giochi?.length ? r.giochi : (p?.giocoId != null && nomeGiocoPerId[p.giocoId] ? [nomeGiocoPerId[p.giocoId]] : []);
    return etichettaPartita(p?.pacchettoNome, nomi) || '—';
  };

  // ---- rettifiche ----
  const salvaVoce = async (e) => {
    e.preventDefault();
    const f = formVoce;
    const importo = parseFloat(String(f.importo).replace(',', '.'));
    if (!f.descrizione.trim()) return alert('Scrivi una descrizione: serve a ricordare perché il costo è cambiato.');
    if (isNaN(importo) || importo === 0) return alert("Inserisci un importo diverso da zero. Negativo se riduce.");
    setInCorso('voce');
    const { error } = await supabase.from('cons_voci').insert([{
      controparte: tipo, controparte_id: f.controparte.id,
      data: f.riga.data, lato: f.riga.lato, riferimento: f.riga.riferimento,
      descrizione: f.descrizione.trim(), importo,
    }]);
    setInCorso(null);
    if (error) { console.error(error); return alert(`Errore nel salvataggio della rettifica: ${error.message}`); }
    setFormVoce(null);
    fetchTutto();
  };

  const rimuoviVoce = async (v) => {
    if (!window.confirm(`Eliminare la rettifica "${v.descrizione || ''}" da ${euro(v.importo)}?`)) return;
    setInCorso(`del-${v.id}`);
    const { error } = await supabase.from('cons_voci').delete().eq('id', v.id);
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nell'eliminazione della rettifica."); }
    setFormVoce(null);
    fetchTutto();
  };

  // ---- consuntivazione ----
  // Chiudere un periodo congela righe e totali e vuol dire che il saldo è stato regolato: pagato,
  // o compensato con quello che ci deve.
  const consuntiva = async () => {
    const { gruppo: g, data } = formConsuntivo;
    if (!data) return alert('Scegli la data del pagamento.');
    setInCorso('consuntiva');
    const { error } = await supabase.from('cons_periodi').insert([periodoDaControparte(g, tipo, data)]);
    setInCorso(null);
    if (error) {
      console.error(error);
      // Il vincolo di esclusione è la rete contro il doppio pagamento: se scatta, va detto a parole.
      return alert(error.message.includes('no_sovrapposizioni')
        ? `Una parte di questo intervallo è già stata consuntivata per ${g.controparte.nome}.`
        : `Errore nella consuntivazione: ${error.message}`);
    }
    setFormConsuntivo(null);
    setEspanso(null);
    fetchTutto();
  };

  const ripristina = async (pe) => {
    const nome = contropartePerId[String(pe.controparte_id)]?.nome || pe.controparte_id;
    if (!window.confirm(`Riaprire il periodo di ${nome} ${periodoTesto(pe.dal, pe.al)}?\n\nLe partite tornano fra quelle da consuntivare e i valori congelati vengono persi. Le rettifiche restano.`)) return;
    setInCorso(`riapri-${pe.id}`);
    const { error } = await supabase.from('cons_periodi').delete().eq('id', pe.id);
    setInCorso(null);
    if (error) { console.error(error); return alert('Errore nella riapertura del periodo.'); }
    fetchTutto();
  };

  // La tabella di una controparte, uguale da aperta e da chiusa: una riga per prenotazione, con le
  // parti del costo, il costo e il credito affiancati, ognuno con la sua rettifica. Una partita
  // che fosse insieme costo e commissionata sta su una riga sola. Da chiusa le righe sono quelle
  // congelate e le rettifiche non si toccano più.
  const tabellaRighe = (controparte, righe, soloLettura) => {
    const perPrenotazione = new Map();
    righe.forEach(r => {
      if (!perPrenotazione.has(r.riferimento)) perPrenotazione.set(r.riferimento, { riferimento: r.riferimento, data: r.data, nominativo: r.nominativo, esempio: r });
      perPrenotazione.get(r.riferimento)[r.lato] = r;
    });
    const elenco = [...perPrenotazione.values()]
      .sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.riferimento.localeCompare(b.riferimento));

    const somma = (lato, campo) => righe.filter(r => r.lato === lato).reduce((t, r) => t + (parseFloat(r[campo]) || 0), 0);
    const tot = {
      costo: somma('costo', 'preventivato'), rettCosto: somma('costo', 'rettifiche'),
      credito: somma('ricavo', 'preventivato'), rettCredito: somma('ricavo', 'rettifiche'),
    };
    const saldoTotale = saldoTesto(arrotonda2(somma('costo', 'consuntivato') - somma('ricavo', 'consuntivato')));
    const conCrediti = righe.some(r => r.lato === 'ricavo');
    const conCosti = righe.some(r => r.lato === 'costo');
    const conDettaglio = righe.some(r => r.lato === 'costo' && r.dettaglio);
    const sommaParte = (campo) => righe.filter(r => r.lato === 'costo' && r.dettaglio).reduce((t, r) => t + (parseFloat(r.dettaglio[campo]) || 0), 0);

    const importo = (r) => (r ? euro(r.preventivato) : nessuno);
    const parte = (r, campo) => (r?.dettaglio ? <span style={{ color: '#64748b' }}>{euro(r.dettaglio[campo])}</span> : nessuno);
    const titoloCosto = (r) => {
      const d = r?.dettaglio;
      if (!d) return r ? cfg.senzaDettaglio : undefined;
      const parti = arrotonda2(cfg.parti.reduce((t, p) => t + (parseFloat(d[p.campo]) || 0), 0));
      const testo = [`${cfg.spiegaCosto(d)} = ${euro(parti)}`];
      if (Math.abs(parti - r.preventivato) >= 0.005) testo.push(`Sulla prenotazione ${euro(r.preventivato)} (arrotondato o ritoccato)`);
      return testo.join('\n');
    };
    const rettifica = (r) => {
      if (!r) return null;
      if (soloLettura) {
        return r.rettifiche
          ? <span style={{ color: '#3949ab' }}>{r.rettifiche > 0 ? '+' : ''}{euro(r.rettifiche)}</span>
          : nessuno;
      }
      return (
        <button type="button" style={cellaRettifica(r.voci.length > 0)} onClick={() => setFormVoce({ controparte, riga: r, descrizione: '', importo: '' })}>
          {r.voci.length > 0 ? `${r.rettifiche > 0 ? '+' : ''}${euro(r.rettifiche)}` : '+'}
        </button>
      );
    };
    const rettTotale = (v) => (Math.abs(v) < 0.005 ? '' : `${v > 0 ? '+' : ''}${euro(v)}`);

    return (
      <div style={{ borderTop: '1px solid #eee', overflowX: 'auto' }}>
        <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #ddd' }}>
              <th style={{ ...cella, width: '90px' }}>Data</th>
              <th style={{ ...cella, width: '120px' }}>Partita</th>
              <th style={cella}>Nominativo</th>
              <th style={cella}>Pacchetto · Gioco</th>
              {cfg.parti.map(p => <th key={p.campo} style={{ ...destra, width: '80px' }} title={p.titolo}>{p.label}</th>)}
              <th style={{ ...destra, width: '90px' }} title={cfg.titoloCosto}>Costo</th>
              <th style={{ ...destra, width: '80px' }}>Rettifica</th>
              <th style={{ ...destra, width: '90px', borderLeft: '1px solid #e2e8f0' }} title={cfg.titoloCredito}>Credito</th>
              <th style={{ ...destra, width: '80px' }}>Rettifica</th>
              <th style={{ ...destra, width: '110px', borderLeft: '1px solid #e2e8f0' }}>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {elenco.map(x => {
              const saldoRiga = (x.costo?.consuntivato || 0) - (x.ricavo?.consuntivato || 0);
              return (
                <tr key={x.riferimento} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ ...cella, whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(x.data)}</td>
                  <td style={{ ...cella, whiteSpace: 'nowrap' }}><strong>{x.riferimento}</strong></td>
                  <td style={cella}>{x.nominativo || '—'}</td>
                  <td style={{ ...cella, color: '#475569' }}>{soloLettura ? (x.esempio.giochi?.join(' + ') || '—') : etichettaRiga(x.esempio)}</td>
                  {cfg.parti.map(p => (
                    <td key={p.campo} style={destra} title={x.costo?.dettaglio && p.dettaglio ? p.dettaglio(x.costo.dettaglio) : undefined}>{parte(x.costo, p.campo)}</td>
                  ))}
                  <td style={{ ...destra, cursor: x.costo ? 'help' : undefined }} title={titoloCosto(x.costo)}>{importo(x.costo)}</td>
                  <td style={destra}>{rettifica(x.costo)}</td>
                  <td style={{ ...destra, borderLeft: '1px solid #f1f5f9' }}>{importo(x.ricavo)}</td>
                  <td style={destra}>{rettifica(x.ricavo)}</td>
                  <td style={{ ...destra, borderLeft: '1px solid #f1f5f9', fontWeight: 600, color: saldoRiga < 0 ? '#15803d' : undefined }}>
                    {saldoRiga < 0 ? `− ${euro(-saldoRiga)}` : euro(saldoRiga)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #ddd', background: '#f8fafc', fontWeight: 'bold' }}>
              <td colSpan={4} style={cella}>Totale ({elenco.length})</td>
              {cfg.parti.map(p => <td key={p.campo} style={{ ...destra, color: '#64748b' }}>{conDettaglio ? euro(sommaParte(p.campo)) : ''}</td>)}
              <td style={destra}>{conCosti ? euro(tot.costo) : ''}</td>
              <td style={{ ...destra, color: '#3949ab' }}>{rettTotale(tot.rettCosto)}</td>
              <td style={{ ...destra, borderLeft: '1px solid #e2e8f0' }}>{conCrediti ? euro(tot.credito) : ''}</td>
              <td style={{ ...destra, color: '#3949ab' }}>{rettTotale(tot.rettCredito)}</td>
              <td style={{ ...destra, borderLeft: '1px solid #e2e8f0', color: saldoTotale.colore }}>{saldoTotale.testo}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  const totaliDaConsuntivare = gruppi.reduce((a, g) => ({ costo: a.costo + g.costo, ricavo: a.ricavo + g.ricavo, saldo: a.saldo + g.saldo }), { costo: 0, ricavo: 0, saldo: 0 });

  return (
    <div className="schermata-storico no-print">
      <h2 style={{ margin: 0 }}>{cfg.titolo}</h2>
      <p className="descrizione-pagina">{cfg.descrizione}</p>

      {schemaMancante && (
        <p style={{ padding: '10px 14px', borderRadius: '6px', border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e' }}>
          Le tabelle della consuntivazione non sono aggiornate: esegui <strong>sql/consuntivazione_campi.sql</strong> nell&apos;SQL Editor di Supabase
          (dopo <strong>sql/consuntivazione_fornitori.sql</strong>, se non l&apos;hai ancora fatto). ({schemaMancante})
        </p>
      )}

      <nav className="modulo-subnav subnav-segmented" style={{ margin: '10px 0' }}>
        <button className={`nav-btn ${vista === 'daconsuntivare' ? 'active' : ''}`} onClick={() => setVista('daconsuntivare')}><Icona nome="daconsuntivare" />Da consuntivare</button>
        <button className={`nav-btn ${vista === 'consuntivati' ? 'active' : ''}`} onClick={() => setVista('consuntivati')}><Icona nome="consuntivati" />Consuntivati</button>
      </nav>

      {vista === 'daconsuntivare' && (
        <>
          <div className="filtri-storico" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="filtro-group" style={{ flex: '1 1 160px' }}>
              <label>Dal:</label>
              <input type="date" value={dal} max={al || oggiIso()} onChange={(e) => setDal(e.target.value)} />
            </div>
            <div className="filtro-group" style={{ flex: '1 1 160px' }}>
              <label>Al:</label>
              <input type="date" value={al} min={dal} max={oggiIso()} onChange={(e) => setAl(e.target.value)} />
            </div>
            <div className="filtro-group" style={{ flex: '0 0 auto' }}>
              {(dal || al) ? (
                <button type="button" onClick={() => { setDal(''); setAl(''); }} className="btn-outline-annulla" style={{ ...btnRiga, padding: '7px 14px', fontSize: '0.8rem' }}>
                  <Icona nome="annulla" size={14} style={{ marginRight: '5px' }} />Tutto il periodo
                </button>
              ) : (
                <span style={{ fontSize: '0.78rem', color: '#888' }}>Date vuote: tutto quello che resta da consuntivare, fino a oggi.</span>
              )}
            </div>
          </div>

          {senzaControparte.length > 0 && (
            <p style={{ marginTop: '14px', padding: '10px 14px', borderRadius: '6px', border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e', fontSize: '0.85rem' }}>
              {cfg.avvisoSenza(senzaControparte.length)}:{' '}
              {senzaControparte.map(s => `${s.prenotazione.id} (${euro(s.costo)}${s.nome ? `, "${s.nome}"` : ''})`).join(', ')}.
              {' '}{cfg.rimedioSenza}
            </p>
          )}

          {caricamento ? (
            <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '30px', textAlign: 'center', color: '#666' }}>Caricamento...</div>
          ) : gruppi.length === 0 ? (
            <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '30px', textAlign: 'center', color: '#666' }}>{cfg.vuoto}</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
                {gruppi.map(g => {
                  const aperto = espanso === g.controparte.id;
                  const saldo = saldoTesto(g.saldo);
                  return (
                    <div key={g.controparte.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
                      <div onClick={() => setEspanso(aperto ? null : g.controparte.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '14px 16px', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.7rem', color: '#888' }}>{aperto ? '▼' : '▶'}</span>
                          <strong style={{ fontSize: '1rem' }}>{g.controparte.nome}</strong>
                          <span style={{ color: '#888', fontSize: '0.8rem' }}>
                            {g.righe.length} partit{g.righe.length === 1 ? 'a' : 'e'} · {periodoTesto(g.dal, g.al)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                          <span style={{ color: '#475569' }}>Costi {euro(g.costo)}</span>
                          {g.ricavo > 0 && <span style={{ color: '#475569' }}>Crediti {euro(g.ricavo)}</span>}
                          <strong style={{ color: saldo.colore }}>{saldo.testo}</strong>
                          <button
                            type="button" disabled={!!schemaMancante}
                            title="Il saldo è stato regolato: congela il periodo"
                            onClick={(e) => { e.stopPropagation(); setFormConsuntivo({ gruppo: g, data: oggiIso() }); }}
                            style={{ ...btnSalva, padding: '6px 12px', fontSize: '0.78rem' }}
                          >
                            <Icona nome="consuntivati" size={14} style={{ marginRight: '5px' }} />Consuntiva
                          </button>
                        </div>
                      </div>
                      {aperto && tabellaRighe(g.controparte, g.righe, false)}
                    </div>
                  );
                })}
              </div>
              {gruppi.length > 1 && (
                <p style={{ marginTop: '12px', fontSize: '0.85rem', color: '#475569', textAlign: 'right' }}>
                  In tutto: costi <strong>{euro(totaliDaConsuntivare.costo)}</strong>
                  {totaliDaConsuntivare.ricavo > 0 && <>, crediti <strong>{euro(totaliDaConsuntivare.ricavo)}</strong></>}
                  , saldo <strong style={{ color: saldoTesto(arrotonda2(totaliDaConsuntivare.saldo)).colore }}>{saldoTesto(arrotonda2(totaliDaConsuntivare.saldo)).testo}</strong>
                </p>
              )}
            </>
          )}
        </>
      )}

      {vista === 'consuntivati' && (
        periodi.length === 0 ? (
          <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '30px', textAlign: 'center', color: '#666' }}>Nessun periodo consuntivato.</div>
        ) : (
          <div className="admin-table-box-full" style={{ marginTop: '20px', overflowX: 'auto' }}>
            <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px' }}>{cfg.intestazione}</th>
                  <th style={{ padding: '10px' }}>Periodo</th>
                  <th style={{ padding: '10px' }}>Pagato il</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Preventivato</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Consuntivato</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Crediti</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Saldo</th>
                  <th style={{ padding: '10px', width: '120px' }}></th>
                </tr>
              </thead>
              <tbody>
                {periodi.map(pe => {
                  const aperto = espanso === `per-${pe.id}`;
                  const controparte = contropartePerId[String(pe.controparte_id)] || { id: pe.controparte_id, nome: pe.controparte_id };
                  const saldo = saldoTesto(parseFloat(pe.saldo) || 0);
                  return (
                    <Fragment key={pe.id}>
                      <tr onClick={() => setEspanso(aperto ? null : `per-${pe.id}`)} style={{ cursor: 'pointer', background: aperto ? '#f8fafc' : undefined, borderBottom: aperto ? 'none' : '1px solid #eee' }}>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          <span className="riga-espandibile-chevron" style={{ transform: aperto ? 'rotate(90deg)' : 'none' }}>›</span>
                          <strong>{controparte.nome}</strong>
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{periodoTesto(pe.dal, pe.al)}</td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#64748b' }}>{formattaDataGGMMAAAA(pe.data_consuntivo)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b' }}>{euro(pe.costo_preventivato)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{euro(pe.costo)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{(parseFloat(pe.ricavo) || 0) > 0 ? euro(pe.ricavo) : nessuno}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 'bold', color: saldo.colore, whiteSpace: 'nowrap' }}>{saldo.testo}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          <button type="button" className="btn-outline-annulla" style={btnRiga} disabled={inCorso === `riapri-${pe.id}`} title="Il periodo torna fra quelli da consuntivare" onClick={(e) => { e.stopPropagation(); ripristina(pe); }}>
                            <Icona nome="riporta" size={14} style={{ marginRight: '5px' }} />Ripristina
                          </button>
                        </td>
                      </tr>
                      {aperto && (
                        <tr className="riga-espandibile-dettaglio">
                          <td colSpan={8} onClick={(e) => e.stopPropagation()} style={{ padding: 0 }}>
                            {tabellaRighe(controparte, pe.righe || [], true)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ---------- Rettifica di una riga ---------- */}
      {formVoce && (
        <div className="modal-form-backdrop" onClick={() => setFormVoce(null)}>
          <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setFormVoce(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0288d1' }}>
              {formVoce.riga.lato === 'costo' ? 'Rettifica del costo' : 'Rettifica del credito'} · {formVoce.controparte.nome}
            </h3>
            <p style={{ margin: '0 0 4px 0', fontSize: '0.82rem', color: '#333' }}>
              {formVoce.riga.riferimento}{formVoce.riga.nominativo ? ` · ${formVoce.riga.nominativo}` : ''} · preventivato {euro(formVoce.riga.preventivato)}
            </p>
            <p style={{ margin: '0 0 15px 0', fontSize: '0.8rem', color: '#777' }}>
              Si aggiunge al preventivato senza sovrascriverlo, al netto dell&apos;IVA: uno sconto concordato è un importo negativo, un extra un importo positivo.
            </p>

            {/* Le rettifiche già scritte si tolgono, non si modificano: correggerne una è eliminarla e
                riscriverla, così resta chiaro che ogni riga è una decisione a sé. */}
            {formVoce.riga.voci.length > 0 && (
              <div style={{ marginBottom: '14px', border: '1px solid #eee', borderRadius: '6px', overflow: 'hidden' }}>
                {formVoce.riga.voci.map((v, i) => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', fontSize: '0.83rem', borderTop: i > 0 ? '1px solid #f0f0f0' : undefined }}>
                    <span style={{ flex: 1 }}>{v.descrizione}</span>
                    <strong>{euro(v.importo)}</strong>
                    <button type="button" className="btn-icon-action" aria-label="Elimina" title="Elimina" disabled={inCorso === `del-${v.id}`} onClick={() => rimuoviVoce(v)}>
                      <Icona nome="elimina" size={14} style={{ marginRight: 0 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={salvaVoce} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Descrizione</label>
                <input type="text" autoFocus value={formVoce.descrizione} placeholder={tipo === 'campo' ? 'es. rinfresco per 3 persone in meno' : 'es. sconto concordato per il ritardo'} onChange={(e) => setFormVoce(f => ({ ...f, descrizione: e.target.value }))} style={stileInput} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Importo netto (€)</label>
                <input type="number" step="any" value={formVoce.importo} onChange={(e) => setFormVoce(f => ({ ...f, importo: e.target.value }))} style={stileInput} />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" style={btnSalva} disabled={inCorso === 'voce'}>
                  <Icona nome="nuovo" size={16} style={{ marginRight: '6px' }} />{inCorso === 'voce' ? 'Salvataggio...' : 'Aggiungi'}
                </button>
                <button type="button" className="btn-outline-annulla" style={{ ...btnRiga, padding: '9px 18px', fontSize: '0.85rem' }} onClick={() => setFormVoce(null)}>
                  <Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />Chiudi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- Consuntivazione di una controparte ---------- */}
      {formConsuntivo && (() => {
        const g = formConsuntivo.gruppo;
        const saldo = saldoTesto(g.saldo);
        return (
          <div className="modal-form-backdrop" onClick={() => setFormConsuntivo(null)}>
            <div className="modal-form-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
              <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setFormConsuntivo(null)}>✕</button>
              <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0288d1' }}>Consuntiva {g.controparte.nome}</h3>
              <p style={{ margin: '0 0 14px 0', fontSize: '0.8rem', color: '#777' }}>
                {g.righe.length} partit{g.righe.length === 1 ? 'a' : 'e'}, {periodoTesto(g.dal, g.al)}. Il periodo passa fra i consuntivati e le sue partite
                non accettano più rettifiche, salvo riaprirlo.
              </p>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden', fontSize: '0.88rem', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px' }}>
                  <span>Costi <span style={{ color: '#94a3b8' }}>(preventivati {euro(g.costoPreventivato)})</span></span><span>{euro(g.costo)}</span>
                </div>
                {g.ricavo > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderTop: '1px solid #f0f0f0' }}>
                    <span>Crediti compensati</span><span>− {euro(g.ricavo)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', fontWeight: 'bold' }}>
                  <span>Saldo</span><span style={{ color: saldo.colore }}>{saldo.testo}</span>
                </div>
              </div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>
                {g.saldo > 0.005 ? 'Pagato il' : g.saldo < -0.005 ? 'Incassato il' : 'Compensato il'}
              </label>
              <input type="date" value={formConsuntivo.data} max={oggiIso()} onChange={(e) => setFormConsuntivo(c => ({ ...c, data: e.target.value }))} style={stileInput} />
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button type="button" style={btnSalva} disabled={inCorso === 'consuntiva'} onClick={consuntiva}>
                  <Icona nome="salva" size={16} style={{ marginRight: '6px' }} />{inCorso === 'consuntiva' ? 'Salvataggio...' : 'Consuntiva'}
                </button>
                <button type="button" className="btn-outline-annulla" style={{ ...btnRiga, padding: '9px 18px', fontSize: '0.85rem' }} onClick={() => setFormConsuntivo(null)}>
                  <Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />Annulla
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default Controparti
