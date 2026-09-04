import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import Icona from '../../components/Icona'
import RicercaIndirizzo from '../../components/RicercaIndirizzo'
import { righeResidenza } from '../../lib/utils'

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const GIORNI_LABEL = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const meseISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const addGiorni = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const inizioSettimana = (d) => { const x = new Date(d); const g = x.getDay(); x.setDate(x.getDate() - (g === 0 ? 6 : g - 1)); x.setHours(0, 0, 0, 0); return x; };
// "06:00:00" (formato time di Postgres) -> "06:00"
const oraHHMM = (t) => (t || '').slice(0, 5);
const oraValida = (s) => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s);
// Forza la digitazione in formato 24h "HH:MM": tiene solo le cifre e inserisce i due punti da solo.
const formattaInputOra = (raw) => {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
};

const FASCE_ORDINE = ['mattina', 'pomeriggio', 'sera'];
const FASCIA_COLORE = { mattina: { bg: '#fef3c7', bd: '#f59e0b', tx: '#92400e' }, pomeriggio: { bg: '#dbeafe', bd: '#0ea5e9', tx: '#075985' }, sera: { bg: '#e0e7ff', bd: '#6366f1', tx: '#3730a3' } };
const FASCIA_LETTERA = { mattina: 'M', pomeriggio: 'P', sera: 'S' };

// Definiti fuori dal componente: se stessero dentro, ad ogni render Disponibilita ne ricreerebbe
// una nuova identità di funzione e React li rimonterebbe da capo, facendo perdere il focus mentre si scrive.
// "parziale" serve quando si modifica un'intera provincia: la fascia è attiva su alcuni campi ma non tutti.
const BadgeFascia = ({ attiva, parziale = false, fasciaId, onClick, title, size = 16, particolare = false }) => {
  const c = FASCIA_COLORE[fasciaId];
  const acceso = attiva || parziale;
  return (
    <span className="badge-fascia" onClick={onClick} title={title} style={{ cursor: onClick ? 'pointer' : 'default', display: 'inline-block', boxSizing: 'border-box', minWidth: `${size}px`, height: `${size}px`, lineHeight: `${size}px`, textAlign: 'center', padding: particolare ? `0 ${size * 0.12}px` : 0, borderRadius: '5px', fontSize: `${size * 0.62}px`, fontWeight: 'bold', background: attiva ? c.bg : '#f1f5f9', border: `1px ${parziale ? 'dashed' : 'solid'} ${acceso ? c.bd : '#e2e8f0'}`, color: acceso ? c.tx : '#94a3b8' }}>
      {FASCIA_LETTERA[fasciaId]}{particolare ? '*' : ''}
    </span>
  );
};

// Campo orario testuale HH:MM (24h): niente widget nativo, niente AM/PM possibile in nessun sistema/browser.
const InputOra24 = ({ value, onChange, style }) => (
  <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={value} onChange={(e) => onChange(formattaInputOra(e.target.value))} style={style} />
);

function Disponibilita({ user }) {
  // Visibilità della scheda: segue i permessi del ruolo, come nel resto dell'app.
  const schedaConsentita = (s) => puoVedere(user, 'disponibilita', s);
  // "miedisp" contiene i dati personali del bubbler: anche con il permesso di scheda serve a poco
  // senza il flag Bubbler sull'utente -> mostriamo un messaggio invece della pagina vuota.
  const richiedeBubbler = (s) => s === 'miedisp' && !user.bubbler;
  const primaSchedaDisp = ['config', 'miedisp', 'riepilogo'].find(schedaConsentita) || 'config';
  const [currentView, setCurrentView] = useState(primaSchedaDisp);

  const [fasce, setFasce] = useState([]);
  const [bubblers, setBubblers] = useState([]);
  const [campi, setCampi] = useState([]);
  // Unica sorgente della disponibilità: una riga = utente + campo + data + fascia.
  const [dispCalendario, setDispCalendario] = useState([]);
  // Conferme mensili: una riga = utente + campo + mese 'YYYY-MM'.
  const [dispConferme, setDispConferme] = useState([]);

  useEffect(() => { fetchTutto(); }, []);

  const fetchTutto = async () => {
    const [fasceRes, bubblersRes, campiRes, dCalRes, dConfRes] = await Promise.all([
      supabase.from('disp_fasce').select('*').order('ordine'),
      supabase.from('utenti').select('username, nome_breve, telefono, email, bubbler, indirizzo, cap, citta, provincia, codice_fiscale').eq('bubbler', true).order('username'),
      supabase.from('pren_campi').select('id, nome, citta, provincia').order('nome'),
      supabase.from('disp_calendario').select('*'),
      supabase.from('disp_conferme').select('*'),
    ]);
    // Un caricamento fallito (tabella mancante, permessi) lascerebbe la pagina apparentemente
    // vuota senza dire perché: almeno in console la causa deve esserci.
    [fasceRes, bubblersRes, campiRes, dCalRes, dConfRes].forEach(r => { if (r.error) console.error('Disponibilità — caricamento fallito:', r.error); });
    if (fasceRes.data) setFasce(fasceRes.data);
    if (bubblersRes.data) setBubblers(bubblersRes.data);
    if (campiRes.data) setCampi(campiRes.data);
    if (dCalRes.data) setDispCalendario(dCalRes.data);
    if (dConfRes.data) setDispConferme(dConfRes.data);
  };

  // Gli errori di Supabase arrivano all'utente con il messaggio del database, non con una frase
  // generica: senza, davanti a un alert non si capisce se manca una tabella, se è un duplicato
  // o se è un problema di permessi.
  const segnalaErrore = (contesto, error) => {
    console.error(contesto, error);
    const dettaglio = [error?.message, error?.details, error?.hint].filter(Boolean).join(' — ');
    alert(`${contesto}\n\n${dettaglio || 'Errore sconosciuto'}`);
  };

  const nomeBubbler = (username) => bubblers.find(b => b.username === username)?.nome_breve || username;
  const fasciaInfo = (id) => fasce.find(f => f.id === id);
  const campoInfo = (id) => campi.find(c => c.id === id);
  const nomeCampo = (id) => campoInfo(id)?.nome || id;
  const rigaDisp = (username, campoId, iso, fasciaId) => dispCalendario.find(d => d.utente_username === username && d.campo_id === campoId && d.data === iso && d.fascia === fasciaId);
  // Campi (id) su cui un bubbler ha almeno una disponibilità: sostituisce la vecchia tabella disp_campi.
  const campiIdDiBubbler = (username) => [...new Set(dispCalendario.filter(d => d.utente_username === username).map(d => d.campo_id))];
  const campiDiBubbler = (username) => campiIdDiBubbler(username).map(id => campoInfo(id)).filter(Boolean);
  const provinciaCampo = (campoId) => campoInfo(campoId)?.provincia || 'Senza provincia';
  const orarioRiga = (riga) => `${oraHHMM(riga.ora_inizio) || oraHHMM(fasciaInfo(riga.fascia)?.ora_inizio)}–${oraHHMM(riga.ora_fine) || oraHHMM(fasciaInfo(riga.fascia)?.ora_fine)}`;

  // Raggruppa i campi per provincia (ordine alfabetico, "Senza provincia" sempre in coda)
  const gruppiCampiPerProvincia = (() => {
    const gruppi = {};
    campi.forEach(c => {
      const key = c.provincia || 'Senza provincia';
      if (!gruppi[key]) gruppi[key] = [];
      gruppi[key].push(c);
    });
    return Object.entries(gruppi).sort(([a], [b]) => a === 'Senza provincia' ? 1 : b === 'Senza provincia' ? -1 : a.localeCompare(b));
  })();

  // ====================== CONFIGURATORE: FASCE ======================
  const [idFasciaInline, setIdFasciaInline] = useState(null);
  const [datiFasciaInline, setDatiFasciaInline] = useState({ ora_inizio: '', ora_fine: '' });
  const iniziaInlineFascia = (f) => { setIdFasciaInline(f.id); setDatiFasciaInline({ ora_inizio: oraHHMM(f.ora_inizio), ora_fine: oraHHMM(f.ora_fine) }); };
  const salvaInlineFascia = async () => {
    if (!oraValida(datiFasciaInline.ora_inizio) || !oraValida(datiFasciaInline.ora_fine)) return alert('Orario non valido: usa il formato 24h HH:MM (es. 06:00).');
    if (datiFasciaInline.ora_inizio >= datiFasciaInline.ora_fine) return alert("L'orario di inizio deve essere precedente all'orario di fine.");
    const { error } = await supabase.from('disp_fasce').update(datiFasciaInline).eq('id', idFasciaInline);
    if (error) { return segnalaErrore('Errore salvataggio fascia', error); }
    setIdFasciaInline(null); fetchTutto();
  };

  // ====================== CONFIGURATORE: BUBBLER ======================
  const [idBubblerInline, setIdBubblerInline] = useState(null);
  const BUBBLER_VUOTO = { nome_breve: '', telefono: '', email: '', indirizzo: '', cap: '', citta: '', provincia: '', codice_fiscale: '' };
  const [datiBubblerInline, setDatiBubblerInline] = useState(BUBBLER_VUOTO);
  const iniziaInlineBubbler = (b) => {
    setIdBubblerInline(b.username);
    setDatiBubblerInline(Object.fromEntries(Object.keys(BUBBLER_VUOTO).map(k => [k, b[k] || ''])));
  };
  const salvaInlineBubbler = async () => {
    const { error } = await supabase.from('utenti').update(datiBubblerInline).eq('username', idBubblerInline);
    if (error) { return segnalaErrore('Errore salvataggio bubbler', error); }
    setIdBubblerInline(null); fetchTutto();
  };

  // ====================== CALENDARIO CONDIVISO ======================
  const [calDate, setCalDate] = useState(new Date());
  const vaiPrec = () => setCalDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const vaiSucc = () => setCalDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const oggiIso = toISODate(new Date());
  // Griglia mensile (6 settimane x 7 giorni), usata da editor, Le mie disponibilità e Riepilogo
  const settimaneMese = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addGiorni(inizioSettimana(new Date(calDate.getFullYear(), calDate.getMonth(), 1)), w * 7 + d)));
  const giorniMese = Array.from({ length: new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0).getDate() }, (_, i) => new Date(calDate.getFullYear(), calDate.getMonth(), i + 1));
  const meseVisualizzato = meseISO(calDate);
  const etichettaMese = `${MESI[calDate.getMonth()]} ${calDate.getFullYear()}`;

  // Le mie righe di disponibilità: servono sia all'editor (per la copia da un altro campo)
  // sia al riepilogo personale, quindi stanno qui sopra a entrambi.
  const mieRighe = dispCalendario.filter(d => d.utente_username === user.username);
  const mieRigheMese = mieRighe.filter(d => (d.data || '').slice(0, 7) === meseVisualizzato);
  const mieRigheMeseDi = (campoId) => mieRigheMese.filter(d => d.campo_id === campoId);

  // ====================== EDITOR DISPONIBILITA' (overlay) ======================
  // Si apre da "Le mie disponibilità": su un singolo campo, oppure su un'intera provincia — nel
  // secondo caso ogni modifica vale contemporaneamente su tutti i campi di quella provincia.
  const [editor, setEditor] = useState(null); // { tipo: 'campo'|'provincia', titolo, sottotitolo, campiIds }
  const campiTarget = editor?.campiIds || [];
  const apriEditorCampo = (campo) => setEditor({
    tipo: 'campo',
    titolo: campo.nome,
    sottotitolo: [campo.citta, campo.provincia].filter(Boolean).join(' · '),
    campiIds: [campo.id],
  });
  const apriEditorProvincia = (provincia, campiGruppo) => setEditor({
    tipo: 'provincia',
    titolo: provincia,
    sottotitolo: `${campiGruppo.length} camp${campiGruppo.length === 1 ? 'o' : 'i'}: ${campiGruppo.map(c => c.nome).join(', ')}`,
    campiIds: campiGruppo.map(c => c.id),
  });
  // Campo da cui copiare un mese già compilato (vedi "Eredita disponibilità" più sotto)
  const [sorgenteEredita, setSorgenteEredita] = useState('');
  const chiudiEditor = () => { setEditor(null); setFasciaSelezionata(null); setSorgenteEredita(''); };
  // Come chiamare il bersaglio nei messaggi di conferma
  const nomeTarget = editor ? (editor.tipo === 'provincia' ? `tutti i campi di ${editor.titolo}` : editor.titolo) : '';

  // ---------------- Conferma del mese ----------------
  // Un mese confermato è un mese "rivisto e chiuso": nel riepilogo prende il bollino blu e i
  // giorni prendono i colori verde/arancio/rosso, che prima della conferma restano neutri.
  const campoConfermato = (campoId, mese = meseVisualizzato) => dispConferme.some(c => c.utente_username === user.username && c.campo_id === campoId && c.mese === mese);
  const targetConfermato = campiTarget.length > 0 && campiTarget.every(cid => campoConfermato(cid));

  const confermaMese = async () => {
    const daInserire = campiTarget.filter(cid => !campoConfermato(cid)).map(cid => ({ utente_username: user.username, campo_id: cid, mese: meseVisualizzato }));
    if (daInserire.length === 0) return;
    const { error } = await supabase.from('disp_conferme').insert(daInserire);
    if (error) { return segnalaErrore('Errore conferma del mese', error); }
    fetchTutto();
  };
  const annullaConfermaMese = async () => {
    if (!window.confirm(`Annullare la conferma di ${etichettaMese} su ${nomeTarget}? Le disponibilità restano, torna solo "da confermare".`)) return;
    const { error } = await supabase.from('disp_conferme').delete().eq('utente_username', user.username).in('campo_id', campiTarget).eq('mese', meseVisualizzato);
    if (error) { return segnalaErrore('Errore annullamento conferma', error); }
    fetchTutto();
  };

  // ---------------- Svuota il mese ----------------
  const svuotaMese = async () => {
    const isoList = giorniMese.map(g => toISODate(g));
    if (!window.confirm(`Rimuovere TUTTE le disponibilità di ${etichettaMese} su ${nomeTarget}? Il mese torna completamente vuoto.`)) return;
    const { error } = await supabase.from('disp_calendario').delete().eq('utente_username', user.username).in('campo_id', campiTarget).in('data', isoList);
    if (error) { return segnalaErrore('Errore svuotamento del mese', error); }
    fetchTutto();
  };

  // ---------------- Eredita da un altro campo ----------------
  // Si può copiare da qualsiasi campo che in questo mese abbia qualcosa da copiare. L'unico escluso
  // è il campo su se stesso quando si modifica un singolo campo; in modalità provincia la sorgente
  // può benissimo essere uno dei campi della provincia ("rendi tutta Milano come questo").
  const campiEreditabili = campi.filter(c =>
    !(campiTarget.length === 1 && campiTarget[0] === c.id) &&
    mieRigheMeseDi(c.id).length > 0
  );
  const ereditaDisponibilita = async () => {
    const righeSorgente = mieRigheMeseDi(sorgenteEredita);
    if (righeSorgente.length === 0) return;
    if (!window.confirm(`Copiare le ${righeSorgente.length} disponibilità di ${nomeCampo(sorgenteEredita)} di ${etichettaMese} su ${nomeTarget}? Quanto già presente in questo mese verrà sostituito.`)) return;
    const isoList = giorniMese.map(g => toISODate(g));
    const { error: errPulizia } = await supabase.from('disp_calendario').delete().eq('utente_username', user.username).in('campo_id', campiTarget).in('data', isoList);
    if (errPulizia) { return segnalaErrore('Errore durante la copia', errPulizia); }
    const nuove = [];
    campiTarget.forEach(cid => righeSorgente.forEach(r => nuove.push({
      utente_username: user.username, campo_id: cid, data: r.data, fascia: r.fascia,
      ora_inizio: r.ora_inizio, ora_fine: r.ora_fine, note: r.note,
    })));
    const { error } = await supabase.from('disp_calendario').insert(nuove);
    if (error) { return segnalaErrore('Errore durante la copia', error); }
    setSorgenteEredita('');
    fetchTutto();
  };

  // Stato di una fascia in un giorno sul bersaglio: attiva su tutti i campi, su alcuni, o su nessuno.
  const statoFascia = (iso, fasciaId) => {
    const attivi = campiTarget.filter(cid => rigaDisp(user.username, cid, iso, fasciaId)).length;
    if (attivi === 0) return 'vuota';
    return attivi === campiTarget.length ? 'piena' : 'parziale';
  };

  const [fasciaSelezionata, setFasciaSelezionata] = useState(null); // { data, fascia }
  const [formOverride, setFormOverride] = useState({ ora_inizio: '', ora_fine: '', note: '' });

  // Clic su una lettera: se non è attiva ovunque la si attiva sui campi che ancora non ce l'hanno,
  // se è già attiva ovunque si apre il dettaglio orario/note.
  const onClickBadgeEditor = async (iso, fasciaId) => {
    if (campiTarget.length === 0) return;
    if (statoFascia(iso, fasciaId) === 'piena') {
      const riga = rigaDisp(user.username, campiTarget[0], iso, fasciaId);
      setFasciaSelezionata({ data: iso, fascia: fasciaId });
      setFormOverride({ ora_inizio: oraHHMM(riga.ora_inizio), ora_fine: oraHHMM(riga.ora_fine), note: riga.note || '' });
      return;
    }
    const daInserire = campiTarget
      .filter(cid => !rigaDisp(user.username, cid, iso, fasciaId))
      .map(cid => ({ utente_username: user.username, campo_id: cid, data: iso, fascia: fasciaId }));
    const { error } = await supabase.from('disp_calendario').insert(daInserire);
    if (error) { return segnalaErrore('Errore salvataggio disponibilità', error); }
    fetchTutto();
  };

  const salvaOverride = async () => {
    const { data, fascia } = fasciaSelezionata;
    const f = fasciaInfo(fascia);
    const inizioFascia = oraHHMM(f?.ora_inizio);
    const fineFascia = oraHHMM(f?.ora_fine);
    if (formOverride.ora_inizio && !oraValida(formOverride.ora_inizio)) return alert('Orario di inizio non valido: usa il formato 24h HH:MM (es. 06:00).');
    if (formOverride.ora_fine && !oraValida(formOverride.ora_fine)) return alert('Orario di fine non valido: usa il formato 24h HH:MM (es. 12:00).');
    if (formOverride.ora_inizio && formOverride.ora_inizio < inizioFascia) return alert(`L'orario di inizio non può essere prima delle ${inizioFascia} (inizio fascia ${f?.label}).`);
    if (formOverride.ora_fine && formOverride.ora_fine > fineFascia) return alert(`L'orario di fine non può essere dopo le ${fineFascia} (fine fascia ${f?.label}).`);
    if (formOverride.ora_inizio && formOverride.ora_fine && formOverride.ora_inizio >= formOverride.ora_fine) return alert("L'orario di inizio deve essere precedente all'orario di fine.");
    const rec = { ora_inizio: formOverride.ora_inizio || null, ora_fine: formOverride.ora_fine || null, note: formOverride.note || null };
    const { error } = await supabase.from('disp_calendario').update(rec).eq('utente_username', user.username).in('campo_id', campiTarget).eq('data', data).eq('fascia', fascia);
    if (error) { return segnalaErrore('Errore salvataggio disponibilità', error); }
    setFasciaSelezionata(null); fetchTutto();
  };
  const rimuoviDisponibilita = async () => {
    const { data, fascia } = fasciaSelezionata;
    await supabase.from('disp_calendario').delete().eq('utente_username', user.username).in('campo_id', campiTarget).eq('data', data).eq('fascia', fascia);
    setFasciaSelezionata(null); fetchTutto();
  };

  // ---------------- Modifica massiva: una fascia su tutto il mese o su una settimana ----------------
  const [fasciaBulk, setFasciaBulk] = useState('mattina');
  const [ambitoBulk, setAmbitoBulk] = useState('mese'); // 'mese' | 'settimana'
  const [settimanaBulk, setSettimanaBulk] = useState(0);
  // Settimane che contengono almeno un giorno del mese corrente: sono le uniche selezionabili
  const settimaneSelezionabili = settimaneMese
    .map((settimana, wi) => ({ wi, giorni: settimana.filter(g => g.getMonth() === calDate.getMonth()) }))
    .filter(s => s.giorni.length > 0);
  // Cambiando mese la settimana scelta può non esistere più (i mesi hanno 5 o 6 settimane):
  // in quel caso si ricade sulla prima, senza passare da un effetto che farebbe un render in più.
  const settimanaCorrente = settimaneSelezionabili.some(s => s.wi === settimanaBulk) ? settimanaBulk : (settimaneSelezionabili[0]?.wi ?? 0);
  const etichettaSettimana = (wi) => {
    const giorni = settimaneMese[wi]?.filter(g => g.getMonth() === calDate.getMonth()) || [];
    if (giorni.length === 0) return '';
    return `${giorni[0].getDate()}–${giorni[giorni.length - 1].getDate()} ${MESI[calDate.getMonth()].slice(0, 3)}`;
  };
  const descrizioneAmbito = ambitoBulk === 'mese'
    ? `tutto ${MESI[calDate.getMonth()]} ${calDate.getFullYear()}`
    : `la settimana ${etichettaSettimana(settimanaCorrente)}`;

  const applicaBulk = async (disponibile) => {
    if (campiTarget.length === 0) return;
    const giorni = ambitoBulk === 'mese' ? giorniMese : (settimaneMese[settimanaCorrente] || []);
    const label = fasciaInfo(fasciaBulk)?.label;
    if (!disponibile && !window.confirm(`Rimuovere la disponibilità "${label}" su ${nomeTarget} per ${descrizioneAmbito}?`)) return;
    const isoList = giorni.filter(g => g.getMonth() === calDate.getMonth()).map(g => toISODate(g));
    if (isoList.length === 0) return;
    if (disponibile) {
      const daInserire = [];
      campiTarget.forEach(cid => isoList.forEach(iso => {
        if (!rigaDisp(user.username, cid, iso, fasciaBulk)) daInserire.push({ utente_username: user.username, campo_id: cid, data: iso, fascia: fasciaBulk });
      }));
      if (daInserire.length === 0) return;
      const { error } = await supabase.from('disp_calendario').insert(daInserire);
      if (error) { return segnalaErrore('Errore salvataggio disponibilità', error); }
    } else {
      const { error } = await supabase.from('disp_calendario').delete().eq('utente_username', user.username).in('campo_id', campiTarget).eq('fascia', fasciaBulk).in('data', isoList);
      if (error) { return segnalaErrore('Errore rimozione disponibilità', error); }
    }
    fetchTutto();
  };

  // ====================== LE MIE DISPONIBILITA' (riepilogo personale) ======================
  const mieiCampiId = campiIdDiBubbler(user.username);
  // Campi con almeno una disponibilità nel mese visualizzato
  const mieiCampiMeseId = [...new Set(mieRigheMese.map(d => d.campo_id))];
  // Tutti i campi registrati, sempre: prima quelli compilati nel mese, poi quelli ancora vuoti
  // (in fondo, così restano visibili senza scavalcare quelli su cui hai già lavorato).
  const campiDaMostrare = (() => {
    const perNome = (a, b) => a.nome.localeCompare(b.nome);
    const conDisp = mieiCampiMeseId.map(id => campoInfo(id) || { id, nome: id }).sort(perNome);
    return [...conDisp, ...campi.filter(c => !mieiCampiMeseId.includes(c.id)).sort(perNome)];
  })();
  // Calendari raggruppati per provincia, stessa convenzione dell'elenco campi: province in ordine
  // alfabetico e "Senza provincia" in coda. Dentro il gruppo resta l'ordine di campiDaMostrare
  // (prima i campi compilati, poi i vuoti).
  const gruppiMieiCampi = (() => {
    const gruppi = {};
    campiDaMostrare.forEach(c => {
      const key = provinciaCampo(c.id);
      if (!gruppi[key]) gruppi[key] = [];
      gruppi[key].push(c);
    });
    return Object.entries(gruppi).sort(([a], [b]) => a === 'Senza provincia' ? 1 : b === 'Senza provincia' ? -1 : a.localeCompare(b));
  })();
  // Solo i giorni "particolari": orario personalizzato o nota, quelli che vale la pena rileggere in elenco
  const mieRigheParticolari = mieRigheMese
    .filter(d => d.ora_inizio || d.ora_fine || d.note)
    .sort((a, b) => a.data.localeCompare(b.data) || FASCE_ORDINE.indexOf(a.fascia) - FASCE_ORDINE.indexOf(b.fascia));

  // ====================== RIEPILOGO (tutti i bubbler) ======================
  const [dettaglioRiepilogo, setDettaglioRiepilogo] = useState(null); // { username, iso }
  const [filtroProvincia, setFiltroProvincia] = useState("");
  const [filtroCampo, setFiltroCampo] = useState("");
  const bubblersOrdinati = [...bubblers].sort((a, b) => (a.nome_breve || a.username).localeCompare(b.nome_breve || b.username));

  const campiFiltroDisponibili = filtroProvincia ? campi.filter(c => (c.provincia || 'Senza provincia') === filtroProvincia) : campi;
  const bubblersFiltrati = (!filtroProvincia && !filtroCampo) ? bubblersOrdinati : bubblersOrdinati.filter(b => {
    const idCampiBubbler = campiIdDiBubbler(b.username);
    if (filtroCampo) return idCampiBubbler.includes(filtroCampo);
    return idCampiBubbler.some(id => provinciaCampo(id) === filtroProvincia);
  });
  // Righe di disponibilità di un bubbler in un giorno/fascia, già ristrette al filtro campo/provincia attivo.
  const righeDisp = (username, iso, fasciaId) => dispCalendario.filter(d =>
    d.utente_username === username && d.data === iso && d.fascia === fasciaId &&
    (!filtroCampo || d.campo_id === filtroCampo) &&
    (!filtroProvincia || provinciaCampo(d.campo_id) === filtroProvincia)
  );

  return (
    <>
      <nav className="modulo-subnav no-print subnav-segmented">
        {schedaConsentita('config') && <button className={`nav-btn ${currentView === 'config' ? 'active' : ''}`} onClick={() => setCurrentView('config')}><Icona nome="configuratore" />Configuratore</button>}
        {schedaConsentita('miedisp') && <button className={`nav-btn ${currentView === 'miedisp' ? 'active' : ''}`} onClick={() => setCurrentView('miedisp')}><Icona nome="miedisp" />Le mie disponibilità</button>}
        {schedaConsentita('riepilogo') && <button className={`nav-btn ${currentView === 'riepilogo' ? 'active' : ''}`} onClick={() => setCurrentView('riepilogo')}><Icona nome="riepilogo" />Riepilogo</button>}
      </nav>

      {/* ===================== CONFIGURATORE ===================== */}
      {currentView === 'config' && schedaConsentita('config') && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Fasce orario</h2>
          <p className="descrizione-pagina">Orari di default delle 3 fasce; ogni bubbler può poi sovrascriverli per singolo giorno.</p>
          <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '480px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px 12px' }}>Fascia</th>
                  <th style={{ padding: '10px 12px' }}>Inizio</th>
                  <th style={{ padding: '10px 12px' }}>Fine</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '130px' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {fasce.map(f => (
                  <tr key={f.id} style={{ borderBottom: '1px solid #eee' }}>
                    {idFasciaInline === f.id ? (
                      <>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><strong>{f.label}</strong></td>
                        <td style={{ padding: '10px 12px' }}><InputOra24 value={datiFasciaInline.ora_inizio} onChange={(v) => setDatiFasciaInline({ ...datiFasciaInline, ora_inizio: v })} style={{ height: '30px', width: '70px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.85rem' }} /></td>
                        <td style={{ padding: '10px 12px' }}><InputOra24 value={datiFasciaInline.ora_fine} onChange={(v) => setDatiFasciaInline({ ...datiFasciaInline, ora_fine: v })} style={{ height: '30px', width: '70px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.85rem' }} /></td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                            <button className="btn-accent-inline" style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px' }} onClick={salvaInlineFascia}><Icona nome="salva" size={14} style={{ marginRight: '4px' }} />Salva</button>
                            <button className="btn-outline-annulla" style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px', borderRadius: '4px' }} onClick={() => setIdFasciaInline(null)}><Icona nome="annulla" size={14} style={{ marginRight: '4px' }} />Annulla</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><strong>{f.label}</strong></td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{oraHHMM(f.ora_inizio)}</td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{oraHHMM(f.ora_fine)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => iniziaInlineFascia(f)}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {fasce.length === 0 && <tr><td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessuna fascia configurata.</td></tr>}
              </tbody>
            </table>
          </div>

          <h2 style={{ marginTop: '30px' }}>Bubbler</h2>
          <p className="descrizione-pagina">Recapiti e dati fiscali dei bubbler (l&apos;account e il ruolo si gestiscono in Impostazioni &gt; Utenti). Questo elenco è la fonte degli operatori selezionabili in Prenotazioni; residenza e codice fiscale finiscono in testa al documento di rimborso, in Compensi.</p>
          <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '980px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px 12px' }}>Username</th>
                  <th style={{ padding: '10px 12px' }}>Nome breve</th>
                  <th style={{ padding: '10px 12px' }}>Telefono</th>
                  <th style={{ padding: '10px 12px' }}>Email</th>
                  <th style={{ padding: '10px 12px' }}>Residenza</th>
                  <th style={{ padding: '10px 12px' }}>Codice fiscale</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '130px' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {bubblers.map(b => (
                  <tr key={b.username} style={{ borderBottom: '1px solid #eee' }}>
                    {idBubblerInline === b.username ? (
                      <>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><strong>{b.username}</strong></td>
                        <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiBubblerInline.nome_breve} onChange={(e) => setDatiBubblerInline({ ...datiBubblerInline, nome_breve: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiBubblerInline.telefono} onChange={(e) => setDatiBubblerInline({ ...datiBubblerInline, telefono: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px' }}><input type="email" className="table-input" value={datiBubblerInline.email} onChange={(e) => setDatiBubblerInline({ ...datiBubblerInline, email: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        {/* La ricerca compila i quattro campi in un colpo, come per le location; restano
                            comunque modificabili a mano, perché una residenza può non stare su Nominatim. */}
                        <td style={{ padding: '10px 12px', minWidth: '280px' }}>
                          <RicercaIndirizzo
                            placeholder="Cerca la residenza..."
                            onSelect={(a) => setDatiBubblerInline(d => ({ ...d, ...a }))}
                          />
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px', gap: '5px', marginTop: '5px' }}>
                            <input type="text" className="table-input" placeholder="Via e civico" value={datiBubblerInline.indirizzo} onChange={(e) => setDatiBubblerInline({ ...datiBubblerInline, indirizzo: e.target.value })} style={{ width: '100%', height: '30px' }} />
                            <input type="text" className="table-input" placeholder="CAP" value={datiBubblerInline.cap} onChange={(e) => setDatiBubblerInline({ ...datiBubblerInline, cap: e.target.value })} style={{ width: '100%', height: '30px' }} />
                            <input type="text" className="table-input" placeholder="Comune" value={datiBubblerInline.citta} onChange={(e) => setDatiBubblerInline({ ...datiBubblerInline, citta: e.target.value })} style={{ width: '100%', height: '30px' }} />
                            <input type="text" className="table-input" placeholder="Prov." value={datiBubblerInline.provincia} onChange={(e) => setDatiBubblerInline({ ...datiBubblerInline, provincia: e.target.value })} style={{ width: '100%', height: '30px' }} />
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiBubblerInline.codice_fiscale} onChange={(e) => setDatiBubblerInline({ ...datiBubblerInline, codice_fiscale: e.target.value.toUpperCase() })} style={{ width: '100%', height: '30px', textTransform: 'uppercase' }} /></td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                            <button className="btn-accent-inline" style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px' }} onClick={salvaInlineBubbler}><Icona nome="salva" size={14} style={{ marginRight: '4px' }} />Salva</button>
                            <button className="btn-outline-annulla" style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px', borderRadius: '4px' }} onClick={() => setIdBubblerInline(null)}><Icona nome="annulla" size={14} style={{ marginRight: '4px' }} />Annulla</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><strong>{b.username}</strong></td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{b.nome_breve || '—'}</td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{b.telefono || '—'}</td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{b.email || '—'}</td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{righeResidenza(b).join(' — ') || '—'}</td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{b.codice_fiscale || '—'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => iniziaInlineBubbler(b)}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {bubblers.length === 0 && <tr><td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessun utente bubbler. Attiva il flag "Bubbler" in Impostazioni &gt; Utenti.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== LE MIE DISPONIBILITA' ===================== */}
      {currentView === 'miedisp' && schedaConsentita('miedisp') && richiedeBubbler('miedisp') && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Le mie disponibilità</h2>
          <p style={{ color: '#666' }}>Questa sezione è riservata agli utenti bubbler. Chiedi a un amministratore di attivare il flag "Bubbler" sul tuo utente (Impostazioni &gt; Utenti, oppure Disponibilità &gt; Configuratore).</p>
        </div>
      )}
      {currentView === 'miedisp' && schedaConsentita('miedisp') && !richiedeBubbler('miedisp') && (
        <div className="schermata-storico no-print">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={vaiPrec}>‹</button>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={() => setCalDate(new Date())}>Oggi</button>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={vaiSucc}>›</button>
              <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{MESI[calDate.getMonth()]} {calDate.getFullYear()}</h2>
            </div>
          </div>
          <p className="descrizione-pagina">Le tue disponibilità mese per mese. Usa "Modifica" su un campo per aprirne il calendario, oppure quello sulla provincia per lavorare in un colpo solo su tutti i suoi campi. L'asterisco segnala un orario personalizzato o una nota.</p>

          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', margin: '0 0 12px 0', fontSize: '0.75rem' }}>
            {FASCE_ORDINE.map(fid => (
              <span key={fid} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <BadgeFascia attiva fasciaId={fid} size={14} />
                {fasciaInfo(fid)?.label}
                <span style={{ color: '#888' }}>{oraHHMM(fasciaInfo(fid)?.ora_inizio)}–{oraHHMM(fasciaInfo(fid)?.ora_fine)}</span>
              </span>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', fontSize: '0.62rem', fontWeight: 'bold', color: '#fff', background: '#2563eb', borderRadius: '4px', padding: '1px 5px' }}>✓ CONFERMATO</span>
              Mese chiuso su quel campo
            </span>
          </div>
          {/* I colori valgono solo sui mesi confermati: dirlo qui evita di cercarli sugli altri */}
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center', margin: '0 0 12px 0', fontSize: '0.75rem', color: '#64748b' }}>
            <span>Solo sui mesi confermati i giorni si colorano:</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '4px', background: '#dcfce7', border: '1px solid #22c55e' }} />
              tutte e 3 le fasce
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '4px', background: '#ffedd5', border: '1px solid #fdba74' }} />
              copertura parziale
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '4px', background: '#fee2e2', border: '1px solid #fca5a5' }} />
              nessuna disponibilità
            </span>
          </div>

          {campi.length === 0 && <p style={{ color: '#666' }}>Nessun campo configurato in Prenotazioni &gt; Configuratore &gt; Campi.</p>}

          {/* Un blocco per provincia; dentro, un calendario per campo affiancato agli altri:
              quanti ne stanno in larghezza, così si confrontano a colpo d'occhio */}
          {gruppiMieiCampi.map(([provincia, campiGruppo]) => (
            <div key={provincia} style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '0 0 8px 0' }}>
                <h3 style={{ fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', margin: 0 }}>
                  📌 {provincia}
                </h3>
                <button className="btn-icon-action" aria-label={`Modifica tutti i campi di ${provincia}`} title={`Modifica insieme tutti i ${campiGruppo.length} campi di ${provincia}`} onClick={() => apriEditorProvincia(provincia, campiGruppo)}><Icona nome="modifica" size={15} style={{ marginRight: 0 }} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
                {campiGruppo.map(campo => {
                  const righeCampo = mieRigheMese.filter(d => d.campo_id === campo.id);
                  const vuoto = righeCampo.length === 0;
                  const confermato = campoConfermato(campo.id);
                  // Campo vuoto in questo mese ma compilato altrove: senza avviso sembrerebbe mai usato
                  const altriMesi = vuoto && mieiCampiId.includes(campo.id);
                  return (
                    <div key={campo.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '9px 10px', opacity: vuoto ? 0.85 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px', marginBottom: '7px' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                            <strong style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: vuoto ? '#64748b' : 'inherit' }} title={campo.nome}>📍 {campo.nome}</strong>
                            {confermato && <span style={{ flexShrink: 0, fontSize: '0.62rem', fontWeight: 'bold', color: '#fff', background: '#2563eb', borderRadius: '4px', padding: '1px 5px', whiteSpace: 'nowrap' }} title={`${etichettaMese} confermato`}>✓ CONFERMATO</span>}
                          </div>
                          {campo.citta && <div style={{ color: '#888', fontSize: '0.72rem' }}>{campo.citta}{campo.provincia ? ` (${campo.provincia})` : ''}</div>}
                          {/* Il calendario rosso dice già che il mese è vuoto; qui serve solo distinguere
                              un campo mai usato da uno compilato in un altro mese. */}
                          {altriMesi && <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>Disponibilità in altri mesi</div>}
                        </div>
                        <button className="btn-icon-action" aria-label="Modifica" title={`Modifica le disponibilità su ${campo.nome}`} style={{ flexShrink: 0 }} onClick={() => apriEditorCampo(campo)}><Icona nome="modifica" size={15} style={{ marginRight: 0 }} /></button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '2px' }}>
                        {GIORNI_LABEL.map(g => <div key={g} style={{ fontWeight: 'bold', fontSize: '0.6rem', color: '#64748b', textAlign: 'center' }}>{g}</div>)}
                        {settimaneMese.flat().map((giorno, di) => {
                          const iso = toISODate(giorno);
                          const fuoriMese = giorno.getMonth() !== calDate.getMonth();
                          const righeGiorno = fuoriMese ? [] : righeCampo.filter(d => d.data === iso);
                          // I colori sono l'esito di un mese chiuso: finché non lo confermi il calendario
                          // resta neutro e si leggono solo le lettere. Confermato, ogni giorno prende il
                          // suo colore: verde = tutte e tre le fasce, arancio = coperto a metà, rosso = niente.
                          // I giorni fuori mese non si colorano mai: non appartengono al mese confermato.
                          const piena = FASCE_ORDINE.every(fid => righeGiorno.some(d => d.fascia === fid));
                          const vuota = !fuoriMese && righeGiorno.length === 0;
                          const colorato = confermato && !fuoriMese;
                          const sfondo = colorato
                            ? (piena ? '#dcfce7' : vuota ? '#fee2e2' : '#ffedd5')
                            : (iso === oggiIso ? '#eff6ff' : (fuoriMese ? '#f8fafc' : '#fff'));
                          const bordo = colorato ? (piena ? '#22c55e' : vuota ? '#fca5a5' : '#fdba74') : '#e2e8f0';
                          const coloreNumero = colorato ? (piena ? '#15803d' : vuota ? '#b91c1c' : '#c2410c') : '#475569';
                          return (
                            <div key={di} title={fuoriMese ? undefined : `${giorno.getDate()}: ${piena ? 'disponibilità piena' : vuota ? 'nessuna disponibilità' : 'disponibilità parziale'}`} style={{ minWidth: 0, border: iso === oggiIso ? '2px solid #2563eb' : `1px solid ${bordo}`, borderRadius: '4px', padding: '1px', background: sfondo, opacity: fuoriMese ? 0.4 : 1 }}>
                              <div style={{ textAlign: 'right', fontSize: '0.58rem', lineHeight: '1.1', color: coloreNumero, fontWeight: colorato ? 'bold' : 'normal' }}>{giorno.getDate()}</div>
                              {/* M/P/S impilate in verticale, come nel calendario di modifica */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', alignItems: 'center' }}>
                                {FASCE_ORDINE.map(fid => {
                                  const riga = righeGiorno.find(d => d.fascia === fid);
                                  const particolare = !!(riga && (riga.ora_inizio || riga.ora_fine || riga.note));
                                  return <BadgeFascia key={fid} attiva={!!riga} fasciaId={fid} size={13} particolare={particolare} title={riga ? `${fasciaInfo(fid)?.label} ${orarioRiga(riga)}${riga.note ? ` · ${riga.note}` : ''}` : `${fasciaInfo(fid)?.label} non disponibile`} />;
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {mieRigheParticolari.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
              <strong style={{ fontSize: '0.9rem' }}>Giorni con orario personalizzato o nota</strong>
              <div style={{ overflowX: 'auto', marginTop: '8px' }}>
                <table style={{ width: '100%', minWidth: '520px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                      <th style={{ padding: '7px 10px' }}>Data</th>
                      <th style={{ padding: '7px 10px' }}>Campo</th>
                      <th style={{ padding: '7px 10px' }}>Fascia</th>
                      <th style={{ padding: '7px 10px' }}>Orario</th>
                      <th style={{ padding: '7px 10px' }}>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mieRigheParticolari.map(d => (
                      <tr key={d.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{new Date(d.data).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                        <td style={{ padding: '7px 10px' }}>{nomeCampo(d.campo_id)}</td>
                        <td style={{ padding: '7px 10px' }}><BadgeFascia attiva fasciaId={d.fascia} size={16} /> {fasciaInfo(d.fascia)?.label}</td>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{orarioRiga(d)}</td>
                        <td style={{ padding: '7px 10px', color: '#475569' }}>{d.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================== EDITOR DISPONIBILITA' (overlay) ===================== */}
      {editor && (
        <div className="modal-preventivo-backdrop" onClick={chiudiEditor}>
          <div style={{ background: '#fff', maxWidth: '760px', margin: '0 auto', borderRadius: '10px', padding: '18px 20px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '4px' }}>
              <h3 style={{ margin: 0, minWidth: 0 }}>
                {editor.tipo === 'provincia' ? '📌' : '📍'} {editor.titolo}
                {editor.tipo === 'provincia' && <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#fff', background: '#0288d1', borderRadius: '4px', padding: '2px 7px', marginLeft: '8px', verticalAlign: 'middle' }}>tutta la provincia</span>}
              </h3>
              <button className="btn-chiudi" title="Chiudi" style={{ float: 'none', padding: '4px 9px', flexShrink: 0 }} onClick={chiudiEditor}>✕</button>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 14px 0' }}>{editor.sottotitolo}</p>

            {editor.tipo === 'provincia' && (
              <p style={{ fontSize: '0.78rem', color: '#075985', background: '#e0f2fe', border: '1px solid #7dd3fc', borderRadius: '6px', padding: '8px 10px', margin: '0 0 14px 0' }}>
                Ogni modifica vale su tutti i {campiTarget.length} campi della provincia. Una lettera con bordo tratteggiato indica che la fascia è attiva solo su alcuni campi: cliccandola la attivi anche sugli altri.
              </p>
            )}

            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
              {FASCE_ORDINE.map(fid => (
                <span key={fid} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
                  <BadgeFascia attiva fasciaId={fid} />
                  <strong>{fasciaInfo(fid)?.label}</strong>
                  <span style={{ color: '#888' }}>{oraHHMM(fasciaInfo(fid)?.ora_inizio)}–{oraHHMM(fasciaInfo(fid)?.ora_fine)}</span>
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={vaiPrec}>‹</button>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={() => setCalDate(new Date())}>Oggi</button>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={vaiSucc}>›</button>
              <strong style={{ textTransform: 'capitalize' }}>{MESI[calDate.getMonth()]} {calDate.getFullYear()}</strong>
            </div>

            {/* EREDITA: ricopia su questo bersaglio il mese già compilato di un altro campo */}
            {campiEreditabili.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem' }}>
                  <Icona nome="riporta" size={14} />Eredita disponibilità
                  <select value={sorgenteEredita} onChange={(e) => setSorgenteEredita(e.target.value)} style={{ height: '30px', padding: '2px 6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.78rem', maxWidth: '100%', minWidth: 0 }}>
                    <option value="">da…</option>
                    {campiEreditabili.map(c => <option key={c.id} value={c.id}>{c.nome}{c.citta ? ` — ${c.citta}` : ''} ({mieRigheMeseDi(c.id).length})</option>)}
                  </select>
                </label>
                <button className="btn-accent-inline" style={{ fontSize: '0.78rem', padding: '6px 10px' }} disabled={!sorgenteEredita} title={sorgenteEredita ? `Copia ${etichettaMese} da ${nomeCampo(sorgenteEredita)} su ${nomeTarget}` : 'Scegli prima il campo da cui copiare'} onClick={ereditaDisponibilita}>Copia</button>
              </div>
            )}

            {/* MODIFICA MASSIVA: si sceglie fascia e periodo, poi + aggiunge e − rimuove */}
            <div style={{ margin: '0 0 14px 0', padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>Modifica massiva</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
                  Fascia
                  <select value={fasciaBulk} onChange={(e) => setFasciaBulk(e.target.value)} style={{ height: '30px', padding: '2px 6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.8rem' }}>
                    {FASCE_ORDINE.map(fid => <option key={fid} value={fid}>{fasciaInfo(fid)?.label}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
                  Periodo
                  <select value={ambitoBulk} onChange={(e) => setAmbitoBulk(e.target.value)} style={{ height: '30px', padding: '2px 6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.8rem' }}>
                    <option value="mese">Tutto il mese</option>
                    <option value="settimana">Una settimana</option>
                  </select>
                </label>
                {/* La settimana va indicata solo se il periodo è la settimana */}
                {ambitoBulk === 'settimana' && (
                  <select value={settimanaCorrente} onChange={(e) => setSettimanaBulk(parseInt(e.target.value))} style={{ height: '30px', padding: '2px 6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.8rem' }}>
                    {settimaneSelezionabili.map(({ wi }) => <option key={wi} value={wi}>{etichettaSettimana(wi)}</option>)}
                  </select>
                )}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn-accent-inline" style={{ fontSize: '1rem', lineHeight: 1, padding: '6px 14px' }} title={`Segna disponibile "${fasciaInfo(fasciaBulk)?.label}" su ${nomeTarget} per ${descrizioneAmbito}`} aria-label="Aggiungi disponibilità" onClick={() => applicaBulk(true)}>+</button>
                  <button className="btn-annulla-inline" style={{ fontSize: '1rem', lineHeight: 1, padding: '6px 14px' }} title={`Rimuovi la disponibilità "${fasciaInfo(fasciaBulk)?.label}" su ${nomeTarget} per ${descrizioneAmbito}`} aria-label="Rimuovi disponibilità" onClick={() => applicaBulk(false)}>−</button>
                </div>
              </div>
            </div>

            <p style={{ fontSize: '0.78rem', color: '#666', margin: '0 0 8px 0' }}>Clic su una lettera spenta per attivarla; clic su una lettera già attiva per modificarne l'orario o aggiungere una nota.</p>

            <div className="cal-mese-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '3px' }}>
              {GIORNI_LABEL.map(g => <div key={g} style={{ fontWeight: 'bold', fontSize: '0.75rem', color: '#64748b', textAlign: 'center', padding: '4px 0' }}>{g}</div>)}
              {settimaneMese.flat().map((giorno, di) => {
                const iso = toISODate(giorno);
                const fuoriMese = giorno.getMonth() !== calDate.getMonth();
                return (
                  <div key={di} style={{ minWidth: 0, border: iso === oggiIso ? '2px solid #2563eb' : '1px solid #e2e8f0', borderRadius: '6px', padding: '3px', background: iso === oggiIso ? '#eff6ff' : (fuoriMese ? '#f8fafc' : '#fff'), opacity: fuoriMese ? 0.5 : 1 }}>
                    <div style={{ textAlign: 'right', fontSize: '0.68rem', color: '#475569', marginBottom: '3px' }}>{giorno.getDate()}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center' }}>
                      {FASCE_ORDINE.map(fid => {
                        const stato = statoFascia(iso, fid);
                        const riga = rigaDisp(user.username, campiTarget[0], iso, fid);
                        const particolare = stato === 'piena' && !!(riga && (riga.ora_inizio || riga.ora_fine || riga.note));
                        const etichetta = fasciaInfo(fid)?.label;
                        const titolo = stato === 'piena'
                          ? `${etichetta} ${riga ? orarioRiga(riga) : ''}${riga?.note ? ` · ${riga.note}` : ''} (clic per modificare)`
                          : stato === 'parziale'
                            ? `${etichetta} attiva solo su alcuni campi (clic per attivarla su tutti)`
                            : `${etichetta} non disponibile (clic per attivare)`;
                        return <BadgeFascia key={fid} attiva={stato === 'piena'} parziale={stato === 'parziale'} fasciaId={fid} size={28} particolare={particolare} onClick={() => onClickBadgeEditor(iso, fid)} title={titolo} />;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* CONFERMA DEL MESE: chiude il mese come "rivisto". Nel riepilogo il campo prende il
                bollino blu e i giorni si colorano di verde/arancio/rosso. */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.8rem', color: targetConfermato ? '#1d4ed8' : '#64748b' }}>
                {targetConfermato
                  ? `✓ ${etichettaMese} confermato su ${editor.tipo === 'provincia' ? `tutti i ${campiTarget.length} campi` : editor.titolo}.`
                  : `${etichettaMese} non è ancora confermato.`}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button className="btn-rimuovi" style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.82rem', padding: '8px 12px' }} title={`Svuota ${etichettaMese} su ${nomeTarget}`} onClick={svuotaMese}>
                  <Icona nome="elimina" size={14} style={{ marginRight: '5px' }} />Svuota disponibilità
                </button>
                {targetConfermato
                  ? <button className="btn-annulla-inline" style={{ fontSize: '0.82rem', padding: '8px 14px' }} onClick={annullaConfermaMese}>Annulla conferma</button>
                  : <button className="btn-accent-inline" style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.82rem', padding: '8px 18px' }} title={`Conferma ${etichettaMese} su ${nomeTarget}`} onClick={confermaMese}><Icona nome="salva" size={15} style={{ marginRight: '5px' }} />Conferma</button>}
              </div>
            </div>
          </div>

          {/* MODALE ORARIO/NOTE — sopra l'editor (backdrop a z-index 999) */}
          {fasciaSelezionata && (() => {
            const f = fasciaInfo(fasciaSelezionata.fascia);
            // stopPropagation: questo backdrop sta dentro quello dell'editor, senza fermare il clic
            // si chiuderebbe anche l'editor sottostante
            return (
              <div className="modal-preventivo-backdrop" style={{ zIndex: 1000 }} onClick={(e) => { e.stopPropagation(); setFasciaSelezionata(null); }}>
                <div style={{ background: '#fff', maxWidth: '380px', margin: '60px auto', borderRadius: '10px', padding: '22px' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <h3 style={{ margin: 0 }}>{f?.label} · {new Date(fasciaSelezionata.data).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                    <button className="btn-chiudi" title="Chiudi" style={{ float: 'none', padding: '4px 9px' }} onClick={() => setFasciaSelezionata(null)}>✕</button>
                  </div>
                  <p style={{ fontSize: '0.82rem', color: '#475569', margin: '0 0 12px 0' }}>
                    {editor.tipo === 'provincia' ? `📌 ${editor.titolo} — vale su tutti i ${campiTarget.length} campi` : `📍 ${editor.titolo}`}
                  </p>
                  <p style={{ fontSize: '0.8rem', color: '#666', margin: '0 0 14px 0' }}>Orario di default: {oraHHMM(f?.ora_inizio)}–{oraHHMM(f?.ora_fine)}. Lascia vuoto per usarlo, oppure specifica un orario personalizzato per questo giorno.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <label style={{ flex: 1, fontSize: '0.8rem' }}>Da<InputOra24 value={formOverride.ora_inizio} onChange={(v) => setFormOverride({ ...formOverride, ora_inizio: v })} style={{ width: '100%', boxSizing: 'border-box', height: '34px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', marginTop: '3px' }} /></label>
                      <label style={{ flex: 1, fontSize: '0.8rem' }}>A<InputOra24 value={formOverride.ora_fine} onChange={(v) => setFormOverride({ ...formOverride, ora_fine: v })} style={{ width: '100%', boxSizing: 'border-box', height: '34px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', marginTop: '3px' }} /></label>
                    </div>
                    <label style={{ fontSize: '0.8rem' }}>Note<textarea value={formOverride.note} onChange={(e) => setFormOverride({ ...formOverride, note: e.target.value })} rows={2} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #ccc', borderRadius: '4px', marginTop: '3px', fontFamily: 'inherit', fontSize: '0.85rem' }} /></label>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '18px' }}>
                    <button className="btn-rimuovi" style={{ fontSize: '0.8rem', padding: '8px 12px' }} onClick={rimuoviDisponibilita}>Rimuovi disponibilità</button>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn-annulla-inline" style={{ fontSize: '0.8rem', padding: '8px 12px' }} onClick={() => setFasciaSelezionata(null)}>Annulla</button>
                      <button className="btn-salva-inline" style={{ fontSize: '0.8rem', padding: '8px 12px' }} onClick={salvaOverride}>Salva</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ===================== RIEPILOGO ===================== */}
      {currentView === 'riepilogo' && schedaConsentita('riepilogo') && (
        <div className="schermata-storico no-print">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={vaiPrec}>‹</button>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={() => setCalDate(new Date())}>Oggi</button>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={vaiSucc}>›</button>
              <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{MESI[calDate.getMonth()]} {calDate.getFullYear()}</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <select value={filtroProvincia} onChange={(e) => { setFiltroProvincia(e.target.value); setFiltroCampo(""); }} style={{ height: '32px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.82rem' }}>
                <option value="">Tutte le province</option>
                {gruppiCampiPerProvincia.map(([provincia]) => <option key={provincia} value={provincia}>{provincia}</option>)}
              </select>
              <select value={filtroCampo} onChange={(e) => setFiltroCampo(e.target.value)} style={{ height: '32px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.82rem' }}>
                <option value="">Tutti i campi</option>
                {campiFiltroDisponibili.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              {(filtroProvincia || filtroCampo) && <button className="btn-annulla-inline" style={{ fontSize: '0.8rem', padding: '5px 10px' }} onClick={() => { setFiltroProvincia(""); setFiltroCampo(""); }}>Azzera filtri</button>}
            </div>
          </div>

          {bubblersOrdinati.length === 0 && <p style={{ color: '#666', marginTop: '10px' }}>Nessun bubbler configurato.</p>}
          {bubblersOrdinati.length > 0 && bubblersFiltrati.length === 0 && <p style={{ color: '#666', marginTop: '10px' }}>Nessun bubbler disponibile per il filtro selezionato.</p>}

          {bubblersFiltrati.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '4px' }}>
                {GIORNI_LABEL.map(g => <div key={g} style={{ fontWeight: 'bold', fontSize: '0.75rem', color: '#64748b', textAlign: 'center', padding: '4px 0' }}>{g}</div>)}
              </div>
              {settimaneMese.map((settimana, wi) => (
                <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingBottom: '10px', borderBottom: '1px solid #e2e8f0' }}>
                  {/* numeri dei giorni della settimana */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '4px' }}>
                    {settimana.map((giorno, di) => {
                      const iso = toISODate(giorno);
                      const fuoriMese = giorno.getMonth() !== calDate.getMonth();
                      return (
                        <div key={di} style={{ textAlign: 'right', fontSize: '0.72rem', padding: '0 4px', opacity: fuoriMese ? 0.4 : 1, color: iso === oggiIso ? '#2563eb' : '#475569', fontWeight: iso === oggiIso ? 'bold' : 'normal' }}>
                          {giorno.getDate()}
                        </div>
                      );
                    })}
                  </div>
                  {/* una riga a griglia per ciascuna fascia: allineata su tutti i 7 giorni della settimana */}
                  {FASCE_ORDINE.map(fid => {
                    const c = FASCIA_COLORE[fid];
                    return (
                      <div key={fid} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '4px' }}>
                        {settimana.map((giorno, di) => {
                          const iso = toISODate(giorno);
                          const fuoriMese = giorno.getMonth() !== calDate.getMonth();
                          const disponibili = bubblersFiltrati.map(b => ({ b, righe: righeDisp(b.username, iso, fid) })).filter(x => x.righe.length > 0);
                          return (
                            <div key={di} style={{ minWidth: 0, minHeight: '22px', opacity: fuoriMese ? 0.35 : 1, background: disponibili.length > 0 ? c.bg : '#f8fafc', border: `1px solid ${disponibili.length > 0 ? c.bd : '#e2e8f0'}`, boxShadow: iso === oggiIso ? 'inset 0 0 0 2px #2563eb' : 'none', borderRadius: '4px', padding: '2px 4px' }}>
                              {disponibili.length > 0 && (
                                <>
                                  <div style={{ fontSize: '0.58rem', fontWeight: 'bold', color: c.tx, marginBottom: '2px' }}>{FASCIA_LETTERA[fid]}</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                                    {disponibili.map(({ b, righe }) => {
                                      const particolare = righe.some(r => r.ora_inizio || r.ora_fine || r.note);
                                      const dettaglio = righe.map(r => `${nomeCampo(r.campo_id)} ${orarioRiga(r)}${r.note ? ` · ${r.note}` : ''}`).join(' | ');
                                      return (
                                        <span key={b.username} onClick={() => setDettaglioRiepilogo({ username: b.username, iso })} title={`${b.nome_breve || b.username} · ${dettaglio}`} style={{ cursor: 'pointer', fontSize: '0.7rem', padding: '1px 4px', borderRadius: '3px', background: '#fff', border: `1px solid ${c.bd}`, color: c.tx, whiteSpace: 'nowrap' }}>
                                          {b.nome_breve || b.username}{particolare ? ' *' : ''}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* MODALE DETTAGLIO GIORNO/BUBBLER */}
          {dettaglioRiepilogo && (() => {
            const { username, iso } = dettaglioRiepilogo;
            const campiBubbler = campiDiBubbler(username);
            return (
              <div className="modal-preventivo-backdrop" onClick={() => setDettaglioRiepilogo(null)}>
                <div style={{ background: '#fff', maxWidth: '460px', margin: '80px auto', borderRadius: '10px', padding: '22px' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h3 style={{ margin: 0 }}>{nomeBubbler(username)} · {new Date(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                    <button className="btn-chiudi" title="Chiudi" style={{ float: 'none', padding: '4px 9px' }} onClick={() => setDettaglioRiepilogo(null)}>✕</button>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#666', margin: '0 0 14px 0' }}>
                    📍 Campi con disponibilità: {campiBubbler.length > 0 ? campiBubbler.map(c => c.nome).join(', ') : 'nessuno'}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {FASCE_ORDINE.map(fid => {
                      const righe = righeDisp(username, iso, fid);
                      const f = fasciaInfo(fid);
                      const c = FASCIA_COLORE[fid];
                      return (
                        <div key={fid} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', background: righe.length > 0 ? c.bg : '#f8fafc', border: `1px solid ${righe.length > 0 ? c.bd : '#e2e8f0'}`, borderRadius: '6px', padding: '8px 10px' }}>
                          <strong style={{ color: righe.length > 0 ? c.tx : '#94a3b8', minWidth: '80px' }}>{f?.label}</strong>
                          {righe.length > 0 ? (
                            <div style={{ fontSize: '0.82rem', color: c.tx, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              {righe.map(r => (
                                <span key={r.id}>
                                  📍 {nomeCampo(r.campo_id)} · {orarioRiga(r)}
                                  {r.note && <><br /><em style={{ marginLeft: '18px' }}>📝 {r.note}</em></>}
                                </span>
                              ))}
                            </div>
                          ) : <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>non disponibile</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}

export default Disponibilita
