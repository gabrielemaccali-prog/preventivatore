// --- CONFIGURAZIONI INTERNE DEL MODULO PREVENTIVATORE ---
export const COSTO_AL_KM = 1.20; // Valore di fallback se una sede non ha un €/km configurato
export const MOLTIPLICATORE_TARGET = 1.35;
// Validità dichiarata sul documento di offerta: oltre questa soglia un preventivo non ancora
// confermato viene considerato scaduto (stato derivato, non salvato a database).
export const GIORNI_VALIDITA_PREVENTIVO = 10;

// --- CONSUNTIVAZIONE DELLA VECCHIA GESTIONE ---
// Voci finite nella consuntivazione ma pagate con la vecchia gestione: il pulsante OLD le chiude
// subito fra i consuntivati, senza data di pagamento, documento o ritenuta. Restano costi a tutti
// gli effetti. Il periodo lo dice con la nota, che c'è già nelle tabelle dei periodi.
// È un pulsante di passaggio: quando la vecchia gestione è smaltita basta mettere false.
export const CONSUNTIVA_OLD_ATTIVO = true;
// A video si chiama "Pregresso", come le prenotazioni della vecchia gestione. Nelle tabelle la nota
// resta 'OLD': è quella con cui sono già stati chiusi i periodi, e cambiarla li renderebbe normali.
export const NOTA_OLD = 'OLD';
export const ETICHETTA_OLD = 'PREGRESSO';
export const eOld = (periodo) => periodo?.note === NOTA_OLD;

// --- STATI DI PRENOTAZIONI, VOUCHER E PREVENTIVI ---
// Ogni stato ha tre facce distinte: il nome usato nel codice (la chiave), il valore salvato nella
// colonna "stato" e l'etichetta mostrata a schermo. Il codice usa sempre e solo la chiave: così
// cambiare il valore salvato vuol dire cambiare una riga qui (più la migrazione dei dati), invece di
// cercare la parola in tutto il progetto -- dove un'occorrenza dimenticata non dà errore, fa
// semplicemente sparire le righe da un elenco.

// Etichetta di uno stato, con ripiego sul valore stesso: uno stato sconosciuto si vede per quello che è.
const etichettaDa = (etichette) => (stato) => etichette[stato] || stato || '—';

// Classe CSS del badge (.badge-stato.<classe>): minuscolo e senza spazi, che farebbero due classi.
export const classeBadgeStato = (stato) => (stato || '').toLowerCase().replace(/\s+/g, '-');

// Prenotazioni -- colonna prenotazioni.stato
export const STATO_PREN = Object.freeze({
  FORSE: 'FORSE',
  CONFERMATO: 'CONFERMATO',
  ANNULLATA: 'ANNULLATA',
  POSTICIPATA: 'POSTICIPATA',
  // Una partita giocata prima che ci fosse l'app (dal vecchio foglio): è già fatturata, incassata e
  // pagata a campi e bubbler. Conta nei ricavi e nei costi, ma non entra nel lavoro di tutti i
  // giorni (Gestione, Calendario, Compensi, Consuntivazione): sta nella scheda Pregresso.
  PREGRESSA: 'PREGRESSA',
});
export const ETICHETTA_STATO_PREN = Object.freeze({
  [STATO_PREN.FORSE]: 'FORSE',
  [STATO_PREN.CONFERMATO]: 'CONFERMATO',
  [STATO_PREN.ANNULLATA]: 'ANNULLATA',
  [STATO_PREN.POSTICIPATA]: 'POSTICIPATA',
  [STATO_PREN.PREGRESSA]: ETICHETTA_OLD,
});

// Le partite che si sono giocate davvero: le confermate e le pregresse.
export const giocata = (p) => p?.stato === STATO_PREN.CONFERMATO || p?.stato === STATO_PREN.PREGRESSA;
export const etichettaStatoPren = etichettaDa(ETICHETTA_STATO_PREN);

// Costi di una partita annullata -- colonna prenotazioni.costiAnnullamento (text[]).
// Un'annullata senza incasso non ha ricavo e di norma nemmeno costi. Quando qualcosa si paga lo
// stesso, all'annullamento si segna cosa: gli importi non si scrivono, sono quelli della prenotazione
// (affitto, rinfresco) e dei compensi, e la differenza con quanto pagato davvero si rettifica in
// consuntivazione. Vale solo per le ANNULLATA: tornando in gioco la partita porta i suoi costi pieni.
export const COSTO_ANNULLAMENTO = Object.freeze({
  CAMPO: 'campo',
  RINFRESCO: 'rinfresco',
  OPERATORI: 'operatori',
});
export const ETICHETTA_COSTO_ANNULLAMENTO = Object.freeze({
  [COSTO_ANNULLAMENTO.CAMPO]: 'Affitto campo',
  [COSTO_ANNULLAMENTO.RINFRESCO]: 'Rinfresco',
  [COSTO_ANNULLAMENTO.OPERATORI]: 'Operatori',
});
export const costiAnnullamentoDi = (p) => new Set(
  p?.stato === STATO_PREN.ANNULLATA && Array.isArray(p.costiAnnullamento) ? p.costiAnnullamento : []
);
// Chi genera un compenso: chi ha giocato, e l'annullata per cui gli operatori si pagano lo stesso.
export const generaCompenso = (p) => p?.stato === STATO_PREN.CONFERMATO || costiAnnullamentoDi(p).has(COSTO_ANNULLAMENTO.OPERATORI);

// Voucher -- colonna voucher.stato
export const STATO_VOUCHER = Object.freeze({
  INCOMPLETO: 'incompleto',
  EMESSO: 'emesso',
  USATO: 'usato',
});
export const ETICHETTA_STATO_VOUCHER = Object.freeze({
  [STATO_VOUCHER.INCOMPLETO]: 'Incompleto',
  [STATO_VOUCHER.EMESSO]: 'Emesso',
  [STATO_VOUCHER.USATO]: 'Usato',
});
export const etichettaStatoVoucher = etichettaDa(ETICHETTA_STATO_VOUCHER);

// Perche' una prenotazione o un preventivo si annulla -- colonna "categoriaAnnullamento" di entrambe
// le tabelle. Il motivo scritto a mano resta come nota (colonna "motivoAnnullamento"): la categoria
// serve a contare, la nota a ricordare il caso. L'elenco viene dalla lettura dei primi 184
// annullamenti, ed e' in ordine di frequenza, perche' chi annulla trovi prima le voci piu' comuni.
//   fuoriStatistiche  non era una richiesta vera: non si conta da nessuna parte
//   nonPerso          il cliente ha comprato altro da noi: annullato si', perso no
//   notaObbligatoria  la categoria da sola non dice niente
export const CATEGORIA_ANNULLAMENTO = Object.freeze({
  NESSUNA_RISPOSTA: 'nessuna_risposta',
  PREZZO: 'prezzo',
  EVENTO_ANNULLATO: 'evento_annullato',
  RIPENSAMENTO: 'ripensamento',
  ALTERNATIVA: 'alternativa',
  PARTECIPANTI: 'partecipanti',
  NON_DISPONIBILE: 'non_disponibile',
  ALTRA_FORMULA: 'altra_formula',
  NON_VALIDA: 'non_valida',
  ALTRO: 'altro',
});
export const CATEGORIE_ANNULLAMENTO = Object.freeze([
  { id: CATEGORIA_ANNULLAMENTO.NESSUNA_RISPOSTA, etichetta: 'Nessuna risposta', descrizione: 'Il cliente non risponde più a mail e telefonate, oppure è sparito dopo la richiesta.' },
  { id: CATEGORIA_ANNULLAMENTO.PREZZO, etichetta: 'Prezzo / budget', descrizione: 'Troppo caro o fuori budget, anche quando ha trovato qualcuno che costa meno.' },
  { id: CATEGORIA_ANNULLAMENTO.EVENTO_ANNULLATO, etichetta: 'Evento annullato dal cliente', descrizione: 'La festa o l\'evento non si fa più, o slitta a data da destinarsi: manca l\'occasione, non la nostra offerta.' },
  { id: CATEGORIA_ANNULLAMENTO.RIPENSAMENTO, etichetta: 'Ripensamento del cliente', descrizione: 'Non è più interessato o ha cambiato idea, senza dire perché.' },
  { id: CATEGORIA_ANNULLAMENTO.ALTERNATIVA, etichetta: 'Scelta un\'alternativa', descrizione: 'L\'evento si fa, ma con un\'altra attività o organizzandosi da soli.' },
  { id: CATEGORIA_ANNULLAMENTO.PARTECIPANTI, etichetta: 'Partecipanti insufficienti', descrizione: 'Non si è raggiunto il numero di giocatori necessario.' },
  { id: CATEGORIA_ANNULLAMENTO.NON_DISPONIBILE, etichetta: 'Data, orario o centro non disponibili', descrizione: 'Non avevamo la data, l\'orario, il gioco o il centro che il cliente voleva.' },
  { id: CATEGORIA_ANNULLAMENTO.ALTRA_FORMULA, etichetta: 'Passato a un\'altra nostra formula', descrizione: 'Non ha preso questa offerta ma ha comprato altro da noi, come una partita nei centri o un gioco solo. Non conta come perso.', nonPerso: true },
  { id: CATEGORIA_ANNULLAMENTO.NON_VALIDA, etichetta: 'Richiesta non valida', descrizione: 'Test, doppione, sola richiesta di informazioni o form compilato per errore. Resta fuori dalle statistiche.', fuoriStatistiche: true },
  { id: CATEGORIA_ANNULLAMENTO.ALTRO, etichetta: 'Altro', descrizione: 'Nessuna delle precedenti: scrivi il motivo nella nota.', notaObbligatoria: true },
]);
const CATEGORIA_PER_ID = Object.fromEntries(CATEGORIE_ANNULLAMENTO.map(c => [c.id, c]));
// La categoria di una riga annullata, o null per gli annullamenti che non ne hanno ancora una.
export const categoriaAnnullamentoDi = (p) => CATEGORIA_PER_ID[p?.categoriaAnnullamento] || null;
export const ETICHETTA_NON_CLASSIFICATO = 'Non classificato';
export const etichettaCategoriaAnnullamento = (p) => categoriaAnnullamentoDi(p)?.etichetta || ETICHETTA_NON_CLASSIFICATO;

// Preventivi -- colonna preventivi.stato. AZIONE_RICHIESTA non si salva mai: si ricava dalla data
// di emissione (vedi statoPreventivo nel preventivatore), ma a schermo si comporta come gli altri.
export const STATO_PREVENTIVO = Object.freeze({
  REGISTRATO: 'Registrato',
  CONFERMATO: 'Confermato',
  PRENOTATO: 'Prenotato',
  ANNULLATO: 'Annullato',
  AZIONE_RICHIESTA: 'Azione richiesta',
});
export const ETICHETTA_STATO_PREVENTIVO = Object.freeze({
  [STATO_PREVENTIVO.REGISTRATO]: 'Registrato',
  [STATO_PREVENTIVO.CONFERMATO]: 'Confermato',
  [STATO_PREVENTIVO.PRENOTATO]: 'Prenotato',
  [STATO_PREVENTIVO.ANNULLATO]: 'Annullato',
  [STATO_PREVENTIVO.AZIONE_RICHIESTA]: 'Azione richiesta',
});
export const etichettaStatoPreventivo = etichettaDa(ETICHETTA_STATO_PREVENTIVO);

// Lo stato vero di un preventivo, che non è sempre quello salvato: passata la validità dell'offerta,
// un preventivo ancora registrato diventa "Azione richiesta" -- il cliente va sentito, o il preventivo
// annullato. Confermato, Prenotato e Annullato non scadono: sono decisioni prese.
// Sta qui perché la leggono il preventivatore e le statistiche del cruscotto, e devono dire la stessa cosa.
export const statoPreventivoDi = (p) => {
  if (p?.stato === STATO_PREVENTIVO.PRENOTATO) return STATO_PREVENTIVO.PRENOTATO;
  if (p?.stato === STATO_PREVENTIVO.CONFERMATO) return STATO_PREVENTIVO.CONFERMATO;
  if (p?.stato === STATO_PREVENTIVO.ANNULLATO) return STATO_PREVENTIVO.ANNULLATO;
  if (!p?.dataEmissione) return p?.stato || STATO_PREVENTIVO.REGISTRATO;
  const scadenza = new Date(p.dataEmissione).getTime() + GIORNI_VALIDITA_PREVENTIVO * 24 * 60 * 60 * 1000;
  return Date.now() > scadenza ? STATO_PREVENTIVO.AZIONE_RICHIESTA : STATO_PREVENTIVO.REGISTRATO;
};

// --- PROVINCE ITALIANE ---
// Le province si scrivono sempre con la sigla (è il formato che vuole la fattura elettronica e che
// si aspetta il gestionale). Qui la tabella nome -> sigla serve a convertire quello che arriva dalla
// ricerca indirizzo, che restituisce il nome per esteso.
export const SIGLE_PROVINCE = {
  'Agrigento': 'AG', 'Alessandria': 'AL', 'Ancona': 'AN', 'Aosta': 'AO', 'Arezzo': 'AR',
  'Ascoli Piceno': 'AP', 'Asti': 'AT', 'Avellino': 'AV', 'Bari': 'BA', 'Barletta-Andria-Trani': 'BT',
  'Belluno': 'BL', 'Benevento': 'BN', 'Bergamo': 'BG', 'Biella': 'BI', 'Bologna': 'BO',
  'Bolzano': 'BZ', 'Brescia': 'BS', 'Brindisi': 'BR', 'Cagliari': 'CA', 'Caltanissetta': 'CL',
  'Campobasso': 'CB', 'Caserta': 'CE', 'Catania': 'CT', 'Catanzaro': 'CZ', 'Chieti': 'CH',
  'Como': 'CO', 'Cosenza': 'CS', 'Cremona': 'CR', 'Crotone': 'KR', 'Cuneo': 'CN',
  'Enna': 'EN', 'Fermo': 'FM', 'Ferrara': 'FE', 'Firenze': 'FI', 'Foggia': 'FG',
  'Forlì-Cesena': 'FC', 'Frosinone': 'FR', 'Genova': 'GE', 'Gorizia': 'GO', 'Grosseto': 'GR',
  'Imperia': 'IM', 'Isernia': 'IS', 'La Spezia': 'SP', "L'Aquila": 'AQ', 'Latina': 'LT',
  'Lecce': 'LE', 'Lecco': 'LC', 'Livorno': 'LI', 'Lodi': 'LO', 'Lucca': 'LU',
  'Macerata': 'MC', 'Mantova': 'MN', 'Massa-Carrara': 'MS', 'Matera': 'MT', 'Messina': 'ME',
  'Milano': 'MI', 'Modena': 'MO', 'Monza e della Brianza': 'MB', 'Napoli': 'NA', 'Novara': 'NO',
  'Nuoro': 'NU', 'Oristano': 'OR', 'Padova': 'PD', 'Palermo': 'PA', 'Parma': 'PR',
  'Pavia': 'PV', 'Perugia': 'PG', 'Pesaro e Urbino': 'PU', 'Pescara': 'PE', 'Piacenza': 'PC',
  'Pisa': 'PI', 'Pistoia': 'PT', 'Pordenone': 'PN', 'Potenza': 'PZ', 'Prato': 'PO',
  'Ragusa': 'RG', 'Ravenna': 'RA', 'Reggio Calabria': 'RC', 'Reggio Emilia': 'RE', 'Rieti': 'RI',
  'Rimini': 'RN', 'Roma': 'RM', 'Rovigo': 'RO', 'Salerno': 'SA', 'Sassari': 'SS',
  'Savona': 'SV', 'Siena': 'SI', 'Siracusa': 'SR', 'Sondrio': 'SO', 'Sud Sardegna': 'SU',
  'Taranto': 'TA', 'Teramo': 'TE', 'Terni': 'TR', 'Torino': 'TO', 'Trapani': 'TP',
  'Trento': 'TN', 'Treviso': 'TV', 'Trieste': 'TS', 'Udine': 'UD', 'Varese': 'VA',
  'Venezia': 'VE', 'Verbano-Cusio-Ossola': 'VB', 'Vercelli': 'VC', 'Verona': 'VR', 'Vibo Valentia': 'VV',
  'Vicenza': 'VI', 'Viterbo': 'VT',
  // Varianti in cui la stessa provincia si presenta a seconda della fonte
  "Reggio nell'Emilia": 'RE', 'Reggio di Calabria': 'RC', 'Monza e Brianza': 'MB',
  "Valle d'Aosta": 'AO', 'Bolzano/Bozen': 'BZ', 'Alto Adige': 'BZ', 'Roma Capitale': 'RM',
};

// --- STATO DI APPARTENENZA DEL CLIENTE (fatturazione) ---
// Un cliente privato non straniero è sempre italiano: questo valore finisce in "fattStato".
export const STATO_ITALIA = 'Italia';

// Codici ISO 3166-1 alpha-2 di tutti gli stati esteri (l'Italia sta a parte, sopra). I nomi non
// sono scritti a mano ma ricavati dai codici, così l'elenco resta in italiano e non va mantenuto.
const CODICI_STATI_ESTERI = 'AD,AE,AF,AG,AI,AL,AM,AO,AR,AS,AT,AU,AW,AX,AZ,BA,BB,BD,BE,BF,BG,BH,BI,BJ,BL,BM,BN,BO,BQ,BR,BS,BT,BW,BY,BZ,CA,CC,CD,CF,CG,CH,CI,CK,CL,CM,CN,CO,CR,CU,CV,CW,CX,CY,CZ,DE,DJ,DK,DM,DO,DZ,EC,EE,EG,EH,ER,ES,ET,FI,FJ,FK,FM,FO,FR,GA,GB,GD,GE,GF,GG,GH,GI,GL,GM,GN,GP,GQ,GR,GT,GU,GW,GY,HK,HN,HR,HT,HU,ID,IE,IL,IM,IN,IO,IQ,IR,IS,JE,JM,JO,JP,KE,KG,KH,KI,KM,KN,KP,KR,KW,KY,KZ,LA,LB,LC,LI,LK,LR,LS,LT,LU,LV,LY,MA,MC,MD,ME,MF,MG,MH,MK,ML,MM,MN,MO,MP,MQ,MR,MS,MT,MU,MV,MW,MX,MY,MZ,NA,NC,NE,NF,NG,NI,NL,NO,NP,NR,NU,NZ,OM,PA,PE,PF,PG,PH,PK,PL,PM,PN,PR,PS,PT,PW,PY,QA,RE,RO,RS,RU,RW,SA,SB,SC,SD,SE,SG,SH,SI,SJ,SK,SL,SM,SN,SO,SR,SS,ST,SV,SX,SY,SZ,TC,TD,TG,TH,TJ,TK,TL,TM,TN,TO,TR,TT,TV,TW,TZ,UA,UG,US,UY,UZ,VA,VC,VE,VG,VI,VN,VU,WF,WS,YE,YT,ZA,ZM,ZW'.split(',');

export const STATI_ESTERI = (() => {
  let nomeDi = (codice) => codice;
  try {
    const nomi = new Intl.DisplayNames(['it'], { type: 'region' });
    nomeDi = (codice) => nomi.of(codice) || codice;
  } catch {
    // Browser senza Intl.DisplayNames: nell'elenco restano i codici, meglio di un elenco vuoto.
  }
  return CODICI_STATI_ESTERI.map(nomeDi).sort((a, b) => a.localeCompare(b, 'it'));
})();
