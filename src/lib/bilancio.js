// ============================================================
// Bilancio di cassa: quello che è passato dal conto, classificato come spese e incassi.
//
// Si parte dai movimenti della banca, non dai documenti: ogni accredito e ogni addebito (non
// ignorato) finisce in una riga sola, quindi il risultato finale è la variazione del saldo. Se non lo
// è, qualcosa non è classificato, e lo dice la riga "Da classificare".
//
//   ricavi operativi   accrediti abbinati ai pagamenti di prenotazioni e voucher; le prenotazioni
//                      per chi fa il gioco (BFM o un'altra sede), pacchetto o noleggio, e gioco
//   costi operativi    spese operative: compensi dei bubbler, affitti dei campi, fornitori
//   = risultato operativo
//   altri ricavi       accrediti generali, per categoria degli incassi
//   costi di struttura spese generali delle categorie Struttura, Gestione e Attrezzatura
//   = risultato dopo la struttura
//   altri costi        tutte le altre spese generali, e quelle di Albatros pagate da BFM
//   = risultato finale
//
// Ogni voce è { nome, importo, figli }: gli importi sono sempre positivi, il segno lo dà la sezione.
// Una commissione bancaria va con la spesa a cui è agganciata, come nelle spese.
// Il capitale versato dai soci non è un ricavo: resta fuori, e si conta a parte come gli ignorati,
// così il controllo con la variazione del saldo torna lo stesso.
// Niente React e niente Supabase: funzioni pure, come banca.js.
// ============================================================

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Le categorie delle spese che fanno da costi di struttura, per nome: quelle di primo livello che si
// chiamano così (deciso dall'utente il 04/11/2026). Le altre vanno fra gli altri costi.
export const CATEGORIE_STRUTTURA = /^(struttura|gestione|attrezzatura)$/i;

// Dove il bilancio mostra una categoria diversamente da come è classificata la spesa: la
// classificazione non cambia, cambia solo la voce del bilancio. Per nome, categoria e sottocategoria.
// Le deleghe F24 della segreteria sono in Tasse e imposte, ma il bilancio le legge come costo della
// gestione, in una voce loro accanto alla Segreteria (deciso dall'utente il 05/11/2026).
export const VOCI_DEL_BILANCIO = [
  { da: ['Tasse e imposte', 'Segreteria'], a: ['Gestione', 'Segreteria (tasse e imposte)'] },
];
const uguale = (a, b) => a.length === b.length && a.every((x, i) => x.toLowerCase() === String(b[i]).toLowerCase());
const vocePer = (percorso) => VOCI_DEL_BILANCIO.find(r => uguale(percorso, r.da))?.a || percorso;
// La categoria degli incassi che è capitale e non ricavo, per nome, con tutte le sue sottocategorie.
export const CATEGORIA_CAPITALE = /^capitale/i;

const NOMI_OPERATIVE = { bubbler: 'Compensi bubbler', campo: 'Affitto campi', fornitore: 'Fornitori' };

// Una voce con i suoi figli, sommati per nome lungo un percorso ("Struttura" › "Banca").
const nuovaVoce = (nome) => ({ nome, importo: 0, figli: [] });
const aggiungi = (voce, percorso, importo) => {
  voce.importo = r2(voce.importo + importo);
  if (percorso.length === 0) return;
  const [primo, ...resto] = percorso;
  let figlio = voce.figli.find(f => f.nome === primo);
  if (!figlio) { figlio = nuovaVoce(primo); voce.figli.push(figlio); }
  aggiungi(figlio, resto, importo);
};
// I figli in ordine di importo, dal più grande: è quello che si cerca aprendo una voce.
const ordina = (voce) => {
  voce.figli.sort((a, b) => b.importo - a.importo || a.nome.localeCompare(b.nome, 'it'));
  voce.figli.forEach(ordina);
  return voce;
};

// Come si legge l'incasso di una prenotazione: da chi fa il gioco, poi pacchetto o noleggio, poi il
// gioco (deciso dall'utente il 17/11/2026):
//   BFM › Pacchetti › gioco          i pacchetti da campo, coi giochi nostri
//   BFM › Noleggi › gioco            le righe dei noleggi coi giochi nostri, e i servizi extra
//   Altre sedi › sede › gioco        le righe dei noleggi coi giochi di un fornitore
// Una prenotazione con le righe (un noleggio da preventivo, o due giochi) si divide fra le righe in
// proporzione al loro ricavo; senza righe è tutta del suo gioco. Restituisce [{ percorso, peso }].
export const ripartizionePrenotazione = (p, { pacchetti = [], giochi = [], sedi = [] } = {}) => {
  const pacchetto = pacchetti.find(k => k.id === p?.pacchettoId);
  const righe = (p?.voci || []).filter(v => (Number(v.ricavo) || 0) > 0);
  // Un noleggio è un pacchetto a location libera; senza pacchetto, lo dice l'avere le righe.
  const tipo = (pacchetto ? pacchetto.locationTipo !== 'campi' : righe.length > 0) ? 'Noleggi' : 'Pacchetti';
  const nomeGioco = (id) => giochi.find(g => String(g.id) === String(id))?.nome;
  if (righe.length === 0) return [{ percorso: ['BFM', tipo, nomeGioco(p?.giocoId) || p?.pacchettoNome || 'Gioco non indicato'], peso: 1 }];
  return righe.map(v => {
    const sede = sedi.find(x => (v.sedeId && x.id === v.sedeId) || (!v.sedeId && v.sede && x.nome === v.sede));
    const nome = nomeGioco(v.giocoId) || v.nome || 'Gioco non indicato';
    // Una riga senza sede (un servizio extra) la facciamo noi.
    return { percorso: !sede || sede.bfm ? ['BFM', tipo, nome] : ['Altre sedi', sede.nome, nome], peso: Number(v.ricavo) || 0 };
  });
};
// Un importo diviso in parti proporzionali ai pesi, al centesimo: l'ultima prende il resto, così la
// somma torna sempre (il bilancio si controlla con la variazione del saldo).
const dividi = (totale, parti) => {
  const somma = parti.reduce((t, x) => t + x.peso, 0);
  let resto = r2(totale);
  return parti.map((x, i) => {
    const q = i === parti.length - 1 ? resto : r2(somma > 0 ? totale * x.peso / somma : totale / parti.length);
    resto = r2(resto - q);
    return { ...x, importo: q };
  });
};

// Il percorso di una categoria a due livelli: [categoria, sottocategoria] oppure [categoria].
const percorsoDi = (categorie, id) => {
  const c = (categorie || []).find(x => x.id === id);
  if (!c) return ['Senza categoria'];
  const padre = c.padre_id != null ? (categorie || []).find(x => x.id === c.padre_id) : null;
  return padre ? [padre.nome, c.nome] : [c.nome];
};

//   movimenti         banca_movimenti
//   spese             spese (con movimento_id, ente, natura, operativa, controparte_id, categoria_id)
//   pagamenti         i pagamenti abbinati agli accrediti (tipo, riferimento, importo, movimento_id)
//   prenotazioni, pacchetti, giochi, sedi   per dividere gli incassi delle prenotazioni
//   categorieSpese, categorieIncassi, categorieAlbatros
//   nomeControparte(tipo, id)   il nome di un bubbler, campo o fornitore
//   dal, al           l'intervallo, sulle date contabili (vuoti: tutto)
export function costruisciBilancio({
  movimenti = [], spese = [], pagamenti = [], categorieSpese = [], categorieIncassi = [], categorieAlbatros = [],
  prenotazioni = [], pacchetti = [], giochi = [], sedi = [],
  nomeControparte = () => null, dal = '', al = '',
}) {
  const nel = (m) => (!dal || m.data_contabile >= dal) && (!al || m.data_contabile <= al);
  const spesaDelMovimento = new Map(spese.filter(s => s.movimento_id != null).map(s => [s.movimento_id, s]));
  const spesaPerId = new Map(spese.map(s => [s.id, s]));
  // I pagamenti di ogni accredito: un bonifico può saldarne più d'uno, anche di prenotazioni diverse.
  const pagamentiDi = new Map();
  pagamenti.filter(p => p.movimento_id != null).forEach(p => {
    if (!pagamentiDi.has(p.movimento_id)) pagamentiDi.set(p.movimento_id, []);
    pagamentiDi.get(p.movimento_id).push(p);
  });
  const prenPerId = new Map(prenotazioni.map(p => [String(p.id), p]));
  const anagrafiche = { pacchetti, giochi, sedi };
  // Le voci in cui va un accredito: ogni pagamento per il suo importo (tutti uguali se non ce
  // l'hanno), e il pagamento di una prenotazione diviso come la prenotazione.
  const partiDi = (lista) => lista.flatMap(pg => {
    const peso = Math.abs(Number(pg.importo) || 0) || 1;
    if (pg.tipo === 'voucher') return [{ percorso: ['Voucher'], peso }];
    const p = prenPerId.get(String(pg.riferimento));
    if (!p) return [{ percorso: ['Prenotazioni', 'Prenotazione non trovata'], peso }];
    const righe = ripartizionePrenotazione(p, anagrafiche);
    const somma = righe.reduce((t, x) => t + x.peso, 0);
    return righe.map(x => ({ percorso: ['Prenotazioni', ...x.percorso], peso: somma > 0 ? peso * x.peso / somma : peso / righe.length }));
  });

  const v = {
    ricaviOperativi: nuovaVoce('Ricavi operativi'),
    costiOperativi: nuovaVoce('Costi operativi'),
    altriRicavi: nuovaVoce('Altri ricavi'),
    costiStruttura: nuovaVoce('Costi di struttura'),
    altriCosti: nuovaVoce('Altri costi'),
    entrateDaClassificare: nuovaVoce('Entrate da classificare'),
    usciteDaClassificare: nuovaVoce('Uscite da classificare'),
  };
  let variazione = 0;
  let ignorati = 0;
  let capitale = 0;

  movimenti.filter(nel).forEach(m => {
    const importo = Number(m.importo) || 0;
    if (m.ignorato) { ignorati = r2(ignorati + importo); return; }
    variazione = r2(variazione + importo);
    if (importo > 0) {
      const suoi = pagamentiDi.get(m.id);
      if (suoi) return dividi(importo, partiDi(suoi)).forEach(x => aggiungi(v.ricaviOperativi, x.percorso, x.importo));
      if (m.incasso_categoria_id != null) {
        const percorso = percorsoDi(categorieIncassi, m.incasso_categoria_id);
        if (CATEGORIA_CAPITALE.test(percorso[0])) { capitale = r2(capitale + importo); return; }
        return aggiungi(v.altriRicavi, percorso, importo);
      }
      return aggiungi(v.entrateDaClassificare, [], importo);
    }
    const uscita = -importo;
    const s = spesaDelMovimento.get(m.id) || (m.onere_spesa_id != null ? spesaPerId.get(m.onere_spesa_id) : null);
    if (!s) return aggiungi(v.usciteDaClassificare, [], uscita);
    if (s.ente === 'albatros') {
      return aggiungi(v.altriCosti, ['Spese di Albatros', ...(s.albatros_categoria_id != null ? percorsoDi(categorieAlbatros, s.albatros_categoria_id) : [])], uscita);
    }
    if (s.natura === 'operativa' && s.operativa) {
      const chi = s.controparte_id != null ? (nomeControparte(s.operativa, s.controparte_id) || 'Senza nome') : 'Senza controparte';
      return aggiungi(v.costiOperativi, [NOMI_OPERATIVE[s.operativa] || s.operativa, chi], uscita);
    }
    if (s.natura === 'generale' && s.categoria_id != null) {
      const percorso = vocePer(percorsoDi(categorieSpese, s.categoria_id));
      return aggiungi(CATEGORIE_STRUTTURA.test(percorso[0]) ? v.costiStruttura : v.altriCosti, percorso, uscita);
    }
    return aggiungi(v.usciteDaClassificare, [], uscita);
  });

  Object.values(v).forEach(ordina);
  const risultatoOperativo = r2(v.ricaviOperativi.importo - v.costiOperativi.importo);
  const risultatoStruttura = r2(risultatoOperativo + v.altriRicavi.importo - v.costiStruttura.importo);
  const risultatoFinale = r2(risultatoStruttura - v.altriCosti.importo + v.entrateDaClassificare.importo - v.usciteDaClassificare.importo);
  return { ...v, risultatoOperativo, risultatoStruttura, risultatoFinale, variazione, ignorati, capitale };
}
