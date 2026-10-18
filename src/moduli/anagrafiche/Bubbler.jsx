import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import RicercaIndirizzo from '../../components/RicercaIndirizzo'
import { righeResidenza, validaCF, validaIBAN, normalizzaIBAN } from '../../lib/utils'

// Anagrafica dei bubbler: chi sono, come si chiamano, dove abitano e come si pagano. Stava nel
// Configuratore di Disponibilità, ma è un'anagrafica come i giochi: la leggono Prenotazioni
// (operatori), Disponibilità (calendari) e Consuntivazione (compensi e rimborsi).

function Bubbler() {
  const [bubblers, setBubblers] = useState([]);
  // Colonne che il database non ha ancora; vuoto = schema a posto.
  const [colonneMancanti, setColonneMancanti] = useState([]);

  // Le colonne dell'anagrafica bubbler. senza_ritenuta sta a parte perché è l'ultima arrivata:
  // vedi leggiBubblers.
  const COLONNE_BUBBLER = 'id, username, nome, cognome, nome_breve, telefono, email, bubbler, indirizzo, cap, citta, provincia, codice_fiscale';

  // In ordine di cognome, che è quello che l'elenco mostra: ordinare per username voleva dire
  // ordinare per una colonna che a schermo non compare più.
  //
  // Il deploy dell'applicazione e l'aggiornamento dello schema sono due gesti separati, e il primo
  // arriva prima: fra i due, chiedere una colonna che ancora non esiste faceva fallire tutta la
  // query e restare senza bubbler — e senza bubbler il modulo è vuoto dappertutto, non solo dove
  // serve la colonna nuova. Quindi si riprova senza, e il configuratore lo dice (schemaMancante).
  // Si prova dal set completo e si scende di un gradino per volta: ogni gradino è uno script
  // SQL non ancora eseguito. Quello che manca si annota, così il configuratore sa cosa non
  // può mostrare e il salvataggio sa cosa non deve scrivere.
  const GRADINI_BUBBLER = [
    { colonne: `${COLONNE_BUBBLER}, senza_ritenuta, rimborso_intestato_a, iban`, mancanti: [] },
    { colonne: `${COLONNE_BUBBLER}, senza_ritenuta, rimborso_intestato_a`, mancanti: ['iban'] },
    { colonne: `${COLONNE_BUBBLER}, senza_ritenuta`, mancanti: ['iban', 'rimborso_intestato_a'] },
    { colonne: COLONNE_BUBBLER, mancanti: ['iban', 'rimborso_intestato_a', 'senza_ritenuta'] },
  ];
  const leggiBubblers = async () => {
    let ultimo;
    for (const { colonne, mancanti } of GRADINI_BUBBLER) {
      ultimo = await supabase.from('utenti').select(colonne).eq('bubbler', true).order('cognome');
      // Il codice arriva ora come stringa ora come numero a seconda di come il driver lo
      // serializza: confrontarlo stretto con '42703' lasciava passare il caso numerico.
      if (String(ultimo.error?.code ?? '') !== '42703') { setColonneMancanti(mancanti); return ultimo; }
    }
    return ultimo;
  };

  const fetchTutto = async () => {
    const res = await leggiBubblers();
    if (res.error) console.error('Bubbler — caricamento fallito:', res.error);
    if (res.data) setBubblers(res.data);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchTutto(); }, []);

  // Gli errori di Supabase arrivano all'utente con il messaggio del database, non con una frase
  // generica: senza, davanti a un alert non si capisce se manca una tabella, se è un duplicato
  // o se è un problema di permessi.
  const segnalaErrore = (contesto, error) => {
    console.error(contesto, error);
    const dettaglio = [error?.message, error?.details, error?.hint].filter(Boolean).join(' — ');
    alert(`${contesto}\n\n${dettaglio || 'Errore sconosciuto'}`);
  };

  // Il bubbler si cerca per id: il nome può cambiare, l'id no.
  const nomeBubbler = (utenteId) => {
    const b = bubblers.find(x => x.id === utenteId);
    return b ? (b.nome_breve || [b.nome, b.cognome].filter(Boolean).join(' ') || b.username) : utenteId;
  };

  // ====================== ANAGRAFICA ======================
  const [idBubblerInline, setIdBubblerInline] = useState(null);
  // Il bubbler nasce qui, con la sua anagrafica e senza accesso all'applicazione: password e ruolo
  // glieli dà un amministratore in Impostazioni > Utenti. Così chi gestisce i bubbler non ha
  // bisogno di vedere ruoli e accessi.
  //
  // L'email si scrive solo alla creazione: è la credenziale con cui la persona entrerà, e dopo non
  // si cambia più da nessuna parte dell'applicazione (se va corretta si interviene sul database).
  // `salvaInlineBubbler` manda a database solo le chiavi di BUBBLER_VUOTO, quindi non può toccarla.
  const BUBBLER_VUOTO = { nome: '', cognome: '', nome_breve: '', telefono: '', indirizzo: '', cap: '', citta: '', provincia: '', codice_fiscale: '', iban: '', senza_ritenuta: false, rimborso_intestato_a: null };
  const OBBLIGATORI_BUBBLER = { nome: 'nome', cognome: 'cognome', telefono: 'telefono', indirizzo: 'indirizzo', cap: 'CAP', citta: 'comune', provincia: 'provincia', codice_fiscale: 'codice fiscale' };
  // Residenza e codice fiscale esistono per una ragione sola: finire in testa al documento di
  // rimborso. Chi non ne riceve uno — perché è senza ritenuta, o perché il suo compenso finisce
  // sulla ricevuta di un altro — per quei campi resta facoltativo, e pretenderli vorrebbe dire
  // inventarseli pur di salvare l'anagrafica.
  const SOLO_PER_DOCUMENTO = ['indirizzo', 'cap', 'citta', 'provincia', 'codice_fiscale'];
  const servePerDocumento = (d) => !d.senza_ritenuta && !d.rimborso_intestato_a;
  // L'IBAN resta facoltativo: non è un dato che si ha sempre sottomano quando si registra un
  // bubbler, e pretenderlo vorrebbe dire non poterlo registrare affatto. Si aggiunge quando serve.
  const serveCampo = (d, k) => servePerDocumento(d) || !SOLO_PER_DOCUMENTO.includes(k);
  const campiMancantiBubbler = (d) => Object.entries(OBBLIGATORI_BUBBLER)
    .filter(([k]) => serveCampo(d, k))
    .filter(([k]) => !(d[k] || '').trim())
    .map(([, etichetta]) => etichetta);
  // L'asterisco nei campi segnala l'obbligo: non lo prende chi obbligatorio non è (nome breve,
  // IBAN) e sparisce da chi lo è solo a volte, insieme all'obbligo.
  const etichettaBubbler = (d, k, testo) => (OBBLIGATORI_BUBBLER[k] && serveCampo(d, k)) ? `${testo} *` : testo;
  // Il codice fiscale si valida solo se c'è: quando è obbligatorio ci pensa campiMancantiBubbler,
  // e per chi è senza ritenuta può legittimamente restare vuoto.
  const cfValido = (d) => !(d.codice_fiscale || '').trim() || validaCF(d.codice_fiscale);
  // Lo stesso vale per l'IBAN: se c'è deve essere un IBAN vero, perché un bonifico sbagliato di una
  // cifra parte lo stesso e non arriva.
  const ibanValido = (d) => !(d.iban || '').trim() || validaIBAN(d.iban);
  // senza_ritenuta è l'unico campo non testuale dell'anagrafica: resta booleano, mentre gli altri
  // si normalizzano a null quando sono vuoti.
  // I campi non testuali dell'anagrafica stanno fuori dalla normalizzazione a null, e si scrivono
  // solo se il database ha la colonna: altrimenti fallirebbe tutto il salvataggio, anagrafica
  // compresa, per un campo che intanto non si può nemmeno impostare.
  const NON_TESTUALI = ['senza_ritenuta', 'rimborso_intestato_a'];
  // Una colonna che il database non ha non si mostra né si scrive: resterebbe sempre vuota e non
  // si potrebbe nemmeno impostare.
  const haColonna = (c) => !colonneMancanti.includes(c);
  const pulisciBubbler = (d) => ({
    ...Object.fromEntries(Object.keys(BUBBLER_VUOTO).filter(k => !NON_TESTUALI.includes(k) && k !== 'iban').map(k => [k, (d[k] || '').trim() || null])),
    // L'IBAN si scrive senza spazi e in maiuscolo, e solo se il database ha la colonna.
    ...(haColonna('iban') ? { iban: normalizzaIBAN(d.iban) || null } : {}),
    ...(haColonna('senza_ritenuta') ? { senza_ritenuta: !!d.senza_ritenuta } : {}),
    ...(haColonna('rimborso_intestato_a') ? { rimborso_intestato_a: d.rimborso_intestato_a || null } : {}),
  });

  const mostraRimborso = haColonna('senza_ritenuta');

  // --- modalità di rimborso: una sola fra tre, scelta da un'unica tendina ---
  // Tenerle in un valore solo è ciò che le rende esclusive per costruzione: non esiste lo stato
  // "senza ritenuta e insieme intestato a un altro", che a database sarebbe scrivibile.
  const modalitaDi = (d) => d.rimborso_intestato_a ? `a:${d.rimborso_intestato_a}` : (d.senza_ritenuta ? 'senza' : '');
  const applicaModalita = (d, valore) => ({
    ...d,
    senza_ritenuta: valore === 'senza',
    rimborso_intestato_a: valore.startsWith('a:') ? Number(valore.slice(2)) : null,
  });
  // Si può intestare il rimborso solo a chi una ricevuta la emette davvero: chi è senza ritenuta
  // non ne produce nessuna, e chi a sua volta è intestato a un terzo creerebbe una catena che
  // nessuno saprebbe più leggere. Né, ovviamente, a sé stessi.
  const intestatariPossibili = (idEscluso) => bubblers.filter(b =>
    b.id !== idEscluso && !b.senza_ritenuta && !b.rimborso_intestato_a);
  // Come si legge la modalità in tabella.
  const descriviModalita = (b) => b.rimborso_intestato_a
    ? `→ ${nomeBubbler(b.rimborso_intestato_a)}`
    : (b.senza_ritenuta ? 'Senza ritenuta' : 'Ricevuta propria');

  const [datiBubblerInline, setDatiBubblerInline] = useState(BUBBLER_VUOTO);
  const iniziaInlineBubbler = (b) => {
    setIdBubblerInline(b.id);
    setDatiBubblerInline({
      ...Object.fromEntries(Object.keys(BUBBLER_VUOTO).map(k => [k, b[k] || ''])),
      senza_ritenuta: !!b.senza_ritenuta,
      rimborso_intestato_a: b.rimborso_intestato_a || null,
    });
  };
  const salvaInlineBubbler = async () => {
    const mancanti = campiMancantiBubbler(datiBubblerInline);
    if (mancanti.length) return alert(`Compila: ${mancanti.join(', ')}.`);
    if (!cfValido(datiBubblerInline)) return alert('Il codice fiscale non è valido.');
    if (!ibanValido(datiBubblerInline)) return alert("L'IBAN non è valido: ricontrolla di averlo copiato per intero.");
    const { error } = await supabase.from('utenti').update(pulisciBubbler(datiBubblerInline)).eq('id', idBubblerInline);
    if (error) { return segnalaErrore('Errore salvataggio bubbler', error); }
    setIdBubblerInline(null); fetchTutto();
  };

  // Le colonne dell'elenco: le due facoltative dipendono da cosa il database ha davvero, e la
  // riga che si apre in modifica deve coprirle tutte.
  const colonneElencoBubbler = 5 + (mostraRimborso ? 1 : 0);

  // La scheda che si apre sotto la riga in modifica. È una funzione, non un componente: definirne
  // uno qui dentro lo farebbe rimontare a ogni battuta, perdendo il focus mentre si scrive.
  const schedaAnagraficaBubbler = () => {
    const b = bubblers.find(x => x.id === idBubblerInline) || {};
    const stileEtichetta = { fontSize: '0.7rem', fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' };
    const stileGruppo = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' };
    const campo = (chiave, etichetta, { maiuscolo = false, larghezza } = {}) => (
      <label style={{ display: 'grid', gap: '4px', gridColumn: larghezza ? `span ${larghezza}` : undefined }}>
        <span style={stileEtichetta}>{etichettaBubbler(datiBubblerInline, chiave, etichetta)}</span>
        <input
          type="text" className="table-input" value={datiBubblerInline[chiave]}
          onChange={(e) => setDatiBubblerInline(d => ({ ...d, [chiave]: maiuscolo ? e.target.value.toUpperCase() : e.target.value }))}
          style={{ width: '100%', height: '32px', ...(maiuscolo ? { textTransform: 'uppercase' } : {}) }}
        />
      </label>
    );
    const titolo = (testo) => <div style={{ ...stileEtichetta, color: '#0288d1', margin: '14px 0 6px 0' }}>{testo}</div>;
    return (
      <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', background: '#fff', padding: '12px 14px' }}>
        {titolo('Anagrafica')}
        <div style={stileGruppo}>
          {campo('nome', 'Nome')}
          {campo('cognome', 'Cognome')}
          {campo('nome_breve', 'Nome breve')}
          {campo('telefono', 'Telefono')}
          <label style={{ display: 'grid', gap: '4px' }}>
            <span style={stileEtichetta}>Email</span>
            <span
              title="L'email non si modifica: se va corretta si interviene sul database"
              style={{ height: '32px', display: 'flex', alignItems: 'center', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >{b.email || '—'}</span>
          </label>
        </div>

        {titolo('Residenza')}
        {/* La ricerca compila i quattro campi in un colpo, come per le location; restano
            comunque modificabili a mano, perché una residenza può non stare su Nominatim. */}
        <RicercaIndirizzo
          placeholder="Cerca la residenza..."
          onSelect={(a) => setDatiBubblerInline(d => ({ ...d, ...a }))}
        />
        <div style={{ ...stileGruppo, marginTop: '8px' }}>
          {campo('indirizzo', 'Via e civico', { larghezza: 2 })}
          {campo('cap', 'CAP')}
          {campo('citta', 'Comune')}
          {campo('provincia', 'Prov.')}
        </div>

        {titolo('Pagamento')}
        <div style={stileGruppo}>
          {campo('codice_fiscale', 'Codice fiscale', { maiuscolo: true })}
          {haColonna('iban') && campo('iban', 'IBAN', { maiuscolo: true, larghezza: 2 })}
          {mostraRimborso && (
            <label style={{ display: 'grid', gap: '4px' }}>
              <span style={stileEtichetta}>Rimborso</span>
              <select
                value={modalitaDi(datiBubblerInline)}
                onChange={(e) => setDatiBubblerInline(applicaModalita(datiBubblerInline, e.target.value))}
                style={{ width: '100%', height: '32px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.82rem' }}
              >
                <option value="">Ricevuta propria</option>
                <option value="senza">Senza ritenuta</option>
                {haColonna('rimborso_intestato_a') && intestatariPossibili(idBubblerInline).map(x => (
                  <option key={x.id} value={`a:${x.id}`}>Intestato a {nomeBubbler(x.id)}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' }}>
          <button className="btn-outline-annulla" style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '5px 10px', borderRadius: '4px' }} onClick={() => setIdBubblerInline(null)}><Icona nome="annulla" size={14} style={{ marginRight: '4px' }} />Annulla</button>
          <button className="btn-accent-inline" style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '5px 10px' }} onClick={salvaInlineBubbler}><Icona nome="salva" size={14} style={{ marginRight: '4px' }} />Salva</button>
        </div>
      </div>
    );
  };

  const [nuovoBubbler, setNuovoBubbler] = useState(null);
  const creaBubbler = async (e) => {
    e.preventDefault();
    const email = (nuovoBubbler.email || '').trim().toLowerCase();
    const mancanti = [...(email ? [] : ['email']), ...campiMancantiBubbler(nuovoBubbler)];
    if (mancanti.length) return alert(`Compila: ${mancanti.join(', ')}.`);
    if (!cfValido(nuovoBubbler)) return alert('Il codice fiscale non è valido.');
    if (!ibanValido(nuovoBubbler)) return alert("L'IBAN non è valido: ricontrolla di averlo copiato per intero.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alert("L'email non è valida.");
    if (!window.confirm(`Creare il bubbler con email ${email}?\n\nL'email non si potrà più modificare.`)) return;
    const { error } = await supabase.from('utenti').insert([{
      ...pulisciBubbler(nuovoBubbler),
      // L'username è la vecchia credenziale di ripiego: per chi nasce oggi coincide con l'email.
      username: email, email, bubbler: true,
      password: null, ruolo_id: null, ruolo: null,
    }]);
    if (error) {
      if (error.code === '23505') return alert(`Esiste già un utente con l'email ${email}.`);
      if (error.code === '23502') return segnalaErrore('Schema del database non ancora aggiornato: esegui sql/bubbler_senza_accesso.sql', error);
      return segnalaErrore('Errore creazione bubbler', error);
    }
    setNuovoBubbler(null); fetchTutto();
  };

  return (
    <div className="schermata-admin no-print" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Bubbler</h2>
        <button className="btn-preventivo btn-accent" style={{ width: 'auto', marginTop: 0, padding: '8px 16px' }} onClick={() => setNuovoBubbler({ ...BUBBLER_VUOTO, email: '' })}><Icona nome="nuovo" size={16} style={{ marginRight: '6px' }} />Nuovo</button>
      </div>
      <p className="descrizione-pagina">Anagrafica dei bubbler. Questo elenco è la fonte degli operatori selezionabili in Prenotazioni; residenza e codice fiscale finiscono in testa al documento di rimborso, in Consuntivazione &gt; Bubbler, e non si chiedono a chi è senza ritenuta, che quel documento non lo riceve. L'IBAN è il conto su cui arriva il bonifico: è facoltativo, ma se c'è deve essere corretto. Un bubbler creato qui non può ancora entrare nell'applicazione: l'accesso lo abilita un amministratore in Impostazioni &gt; Utenti. L'email, una volta salvata, non si modifica più.</p>

      {/* Senza la colonna la spunta non si può né leggere né salvare, ma il resto
          dell'anagrafica funziona: meglio dirlo qui che lasciarla sparita senza spiegazioni. */}
      {colonneMancanti.includes('iban') && (
        <div style={{ margin: '10px 0 14px 0', padding: '12px 16px', background: '#fff8e1', border: '1px solid #f0d999', borderLeft: '4px solid #f0a000', borderRadius: '4px' }}>
          <strong style={{ display: 'block', marginBottom: '3px' }}>Schema del database non ancora aggiornato</strong>
          <span style={{ fontSize: '0.85rem', color: '#555' }}>
            Esegui <code>sql/bubbler_iban.sql</code> nell&apos;SQL Editor di Supabase: finché manca la
            colonna, l&apos;IBAN non si può né vedere né salvare. Il resto dell&apos;anagrafica funziona.
          </span>
        </div>
      )}

      {colonneMancanti.some(c => c !== 'iban') && (
        <div style={{ margin: '10px 0 14px 0', padding: '12px 16px', background: '#fff8e1', border: '1px solid #f0d999', borderLeft: '4px solid #f0a000', borderRadius: '4px' }}>
          <strong style={{ display: 'block', marginBottom: '3px' }}>Schema del database non ancora aggiornato</strong>
          <span style={{ fontSize: '0.85rem', color: '#555' }}>
            Esegui nell&apos;SQL Editor di Supabase{' '}
            {colonneMancanti.includes('senza_ritenuta') && <><code>sql/bubbler_senza_ritenuta.sql</code> e </>}
            <code>sql/rimborso_intestato.sql</code>: finché mancano, la colonna &quot;Rimborso&quot;
            {colonneMancanti.includes('senza_ritenuta')
              ? ' non compare e tutti i compensi continuano a passare da Elabora rimborsi.'
              : ' non offre la voce "Intestato a", e i compensi si chiudono solo con ricevuta propria o senza ritenuta.'}
          </span>
        </div>
      )}

      {nuovoBubbler && (() => {
        const stileInput = { width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' };
        const campo = (chiave, placeholder, extra = {}) => (
          <input type="text" placeholder={placeholder} value={nuovoBubbler[chiave]} onChange={(e) => setNuovoBubbler({ ...nuovoBubbler, [chiave]: e.target.value })} style={stileInput} {...extra} />
        );
        return (
          <div className="modal-form-backdrop" onClick={() => setNuovoBubbler(null)}>
            <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="modal-form-close" onClick={() => setNuovoBubbler(null)} aria-label="Chiudi">✕</button>
              <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>Nuovo bubbler</h3>
              <form onSubmit={creaBubbler} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {campo('nome', 'Nome *', { autoFocus: true })}
                  {campo('cognome', 'Cognome *')}
                </div>
                {campo('email', 'Email * (non modificabile dopo)', { type: 'email' })}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {campo('telefono', 'Telefono *', { type: 'tel' })}
                  {campo('nome_breve', 'Nome breve')}
                </div>
                <RicercaIndirizzo placeholder="Cerca la residenza..." onSelect={(a) => setNuovoBubbler(d => ({ ...d, ...a }))} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '10px' }}>
                  {campo('indirizzo', etichettaBubbler(nuovoBubbler, 'indirizzo', 'Via e civico'))}
                  {campo('cap', etichettaBubbler(nuovoBubbler, 'cap', 'CAP'))}
                  {campo('citta', etichettaBubbler(nuovoBubbler, 'citta', 'Comune'))}
                  {campo('provincia', etichettaBubbler(nuovoBubbler, 'provincia', 'Prov.'))}
                </div>
                <input type="text" placeholder={etichettaBubbler(nuovoBubbler, 'codice_fiscale', 'Codice fiscale')} value={nuovoBubbler.codice_fiscale} onChange={(e) => setNuovoBubbler({ ...nuovoBubbler, codice_fiscale: e.target.value.toUpperCase() })} style={{ ...stileInput, textTransform: 'uppercase' }} />
                {haColonna('iban') && (
                  <input type="text" placeholder="IBAN" value={nuovoBubbler.iban} onChange={(e) => setNuovoBubbler({ ...nuovoBubbler, iban: e.target.value.toUpperCase() })} style={{ ...stileInput, textTransform: 'uppercase' }} />
                )}
                {mostraRimborso && (
                  <label style={{ display: 'block', fontSize: '0.85rem' }}>
                    Rimborso
                    <select
                      value={modalitaDi(nuovoBubbler)}
                      onChange={(e) => setNuovoBubbler(applicaModalita(nuovoBubbler, e.target.value))}
                      style={{ ...stileInput, marginTop: '4px' }}
                    >
                      <option value="">Ricevuta propria</option>
                      <option value="senza">Senza ritenuta — si chiude in un passaggio solo</option>
                      {haColonna('rimborso_intestato_a') && intestatariPossibili(null).map(x => (
                        <option key={x.id} value={`a:${x.id}`}>Intestato a {nomeBubbler(x.id)}</option>
                      ))}
                    </select>
                  </label>
                )}
                <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />Crea bubbler</button>
              </form>
            </div>
          </div>
        );
      })()}
      {/* L'elenco mostra il poco che serve a riconoscere una persona e a chiamarla; l'anagrafica
          per intero — residenza, dati fiscali, IBAN — starebbe in nove colonne illeggibili, e si
          apre invece sotto la riga quando si entra in modifica. */}
      <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: '720px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: '10px 12px' }}>Bubbler</th>
              <th style={{ padding: '10px 12px' }}>Contatti</th>
              <th style={{ padding: '10px 12px' }}>Residenza</th>
              <th style={{ padding: '10px 12px' }} title="Codice fiscale e IBAN, i dati con cui il compenso viene pagato">Dati di pagamento</th>
              {mostraRimborso && <th style={{ padding: '10px 12px', width: '150px' }} title="Come si chiude il compenso: con una ricevuta propria, senza ritenuta, oppure sulla ricevuta di un altro bubbler">Rimborso</th>}
              <th style={{ padding: '10px 12px', textAlign: 'center', width: '110px' }}>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {bubblers.map(b => {
              const inModifica = idBubblerInline === b.id;
              return (
                <Fragment key={b.id}>
                  <tr style={{ borderBottom: inModifica ? 'none' : '1px solid #eee', background: inModifica ? '#f8fafc' : 'transparent' }}>
                    <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                      <strong>{[b.nome, b.cognome].filter(Boolean).join(' ') || b.username}</strong>
                      {b.nome_breve && <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{b.nome_breve}</div>}
                    </td>
                    <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                      <div>{b.telefono || <span style={{ color: '#cbd5e1' }}>telefono mancante</span>}</div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{b.email || '—'}</div>
                    </td>
                    <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{righeResidenza(b).join(' — ') || '—'}</td>
                    {/* L'IBAN si legge a gruppi di quattro, come su ogni documento bancario: tutto
                        attaccato è una fila di caratteri che nessuno riesce a confrontare a occhio. */}
                    <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{b.codice_fiscale || '—'}</div>
                      {haColonna('iban') && <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#64748b' }}>{b.iban ? b.iban.replace(/(.{4})/g, '$1 ').trim() : '—'}</div>}
                    </td>
                    {mostraRimborso && (
                      <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                        {b.senza_ritenuta || b.rimborso_intestato_a
                          ? <span
                              title={b.rimborso_intestato_a
                                ? `Il compenso finisce sulla ricevuta di ${nomeBubbler(b.rimborso_intestato_a)}, che ne paga la ritenuta`
                                : 'Il compenso si chiude in un passaggio solo, senza ritenuta e senza documento di rimborso'}
                              style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#fff', background: b.rimborso_intestato_a ? '#0e7490' : '#7c3aed', borderRadius: '4px', padding: '2px 7px', whiteSpace: 'nowrap' }}
                            >{descriviModalita(b)}</span>
                          : <span style={{ color: '#bbb' }}>Ricevuta propria</span>}
                      </td>
                    )}
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <button
                        className="btn-icon-action" aria-label={inModifica ? 'Chiudi' : 'Modifica'}
                        aria-expanded={inModifica} title={inModifica ? 'Chiudi senza salvare' : 'Modifica'}
                        onClick={() => inModifica ? setIdBubblerInline(null) : iniziaInlineBubbler(b)}
                      ><Icona nome={inModifica ? 'annulla' : 'modifica'} size={16} style={{ marginRight: 0 }} /></button>
                    </td>
                  </tr>
                  {inModifica && (
                    <tr style={{ borderBottom: '1px solid #eee', background: '#f8fafc' }}>
                      <td colSpan={colonneElencoBubbler} style={{ padding: '0 12px 14px 12px' }}>
                        {schedaAnagraficaBubbler()}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {bubblers.length === 0 && <tr><td colSpan={colonneElencoBubbler} style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessun bubbler. Crealo con Nuovo, oppure attiva il flag "Bubbler" modificando un utente esistente in Impostazioni &gt; Utenti.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Bubbler
