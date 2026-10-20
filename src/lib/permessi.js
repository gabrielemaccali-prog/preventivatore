// --- FAMIGLIE DEL MENU MODULI ---
// Il menu laterale raggruppa i moduli per famiglia, in quest'ordine. Una famiglia senza moduli
// visibili per l'utente non compare: Operatività, per esempio, accoglierà anche le spese.
export const GRUPPI_MODULI = [
  { id: 'vendita', label: 'Vendita' },
  { id: 'operativita', label: 'Operatività' },
  { id: 'amministrazione', label: 'Amministrazione' },
  { id: 'altro', label: 'Altro' },
];

// --- REGISTRO MODULI (metadati per sidebar e tab "Moduli" di Impostazioni) ---
// L'ordine segue le famiglie del menu, e decide anche su quale modulo si atterra dopo l'accesso:
// il primo che l'utente può vedere.
export const MODULI_REGISTRY = [
  { id: 'preventivatore', label: 'Preventivatore', icon: 'preventivatore', gruppo: 'vendita' },
  { id: 'voucher', label: 'Voucher', icon: 'voucher', gruppo: 'vendita' },
  { id: 'prenotazioni', label: 'Prenotazioni', icon: 'prenotazioni', gruppo: 'vendita' },
  { id: 'disponibilita', label: 'Disponibilità', icon: 'disponibilita', gruppo: 'operativita' },
  // Quello che e' davvero successo dopo il preventivo: fatture, fornitori, campi e compensi dei
  // bubbler. Qui arriveranno anche i servizi.
  { id: 'consuntivazione', label: 'Consuntivazione', icon: 'consuntivazione', gruppo: 'amministrazione' },
  // Si chiama Cruscotto, ma l'id resta 'costiricavi': e' la chiave con cui i permessi dei ruoli
  // sono gia' salvati a database, e cambiarla toglierebbe l'accesso a chi ce l'ha senza dire niente.
  { id: 'costiricavi', label: 'Cruscotto', icon: 'cruscotto', gruppo: 'amministrazione' },
  // La cassa del centro sportivo Albatros: chiusure serali, spese, listino del bar e dei campi.
  // È un'altra attività, non una funzione di BFM: vive nel suo mondo (vedi MONDI).
  { id: 'albatros', label: 'Albatros', icon: 'albatros', gruppo: 'altro', mondo: 'albatros' },
  // Le anagrafiche sono la base da cui leggono listino e prenotazioni, ma non sono lavoro
  // quotidiano: stanno in fondo, così chi entra si trova al lavoro e non in una pagina di
  // configurazione.
  // Si chiama Anagrafiche, ma l'id resta 'catalogo': è la chiave già salvata nei permessi dei ruoli.
  { id: 'catalogo', label: 'Anagrafiche', icon: 'anagrafiche', gruppo: 'altro' },
];

// --- MONDI ---
// BFM e Albatros sono due attività distinte: ognuna ha il suo menu e il suo aspetto, e chi le vede
// entrambe passa dall'una all'altra col selettore in cima al menu. Un modulo senza "mondo" è di BFM.
export const MONDI = [
  { id: 'bfm', label: 'BFM' },
  { id: 'albatros', label: 'Albatros' },
];
export const mondoDi = (moduloId) => MODULI_REGISTRY.find(m => m.id === moduloId)?.mondo || 'bfm';

// --- REGISTRO SCHEDE/SOTTOSCHEDE PER MODULO (usato per costruire la matrice permessi in Impostazioni > Ruoli) ---
export const SCHEDE_REGISTRY = {
  albatros: {
    schede: [
      // Si chiama Giornata, ma l'id resta 'chiusure': è la chiave già salvata nei permessi dei ruoli.
      { id: 'chiusure', label: 'Giornata' },
      { id: 'storico', label: 'Chiusure' },
      { id: 'spese', label: 'Spese' },
      { id: 'incassi', label: 'Incassi' },
      { id: 'listino', label: 'Listino' },
      { id: 'configuratore', label: 'Configuratore' },
      {
        id: 'cashflow',
        label: 'Cashflow',
        sottoschede: [
          { id: 'cashflow_bfm', label: 'BFM' },
          { id: 'cashflow_albatros', label: 'Albatros' },
          { id: 'cashflow_lama', label: 'Lama' },
        ],
      },
    ],
  },
  consuntivazione: {
    schede: [
      { id: 'fatture', label: 'Fatture' },
      { id: 'fornitori', label: 'Fornitori' },
      { id: 'campi', label: 'Campi' },
      {
        // Era il modulo Compensi: sql/compensi_in_consuntivazione.sql ha spostato qui i permessi.
        id: 'bubbler',
        label: 'Bubbler',
        sottoschede: [
          { id: 'config', label: 'Configuratore' },
          { id: 'daconsuntivare', label: 'Da consuntivare' },
          { id: 'rimborsi', label: 'Elabora rimborsi' },
          { id: 'evasi', label: 'Rimborsi evasi' },
          { id: 'indicatori', label: 'Indicatori' },
        ],
      },
    ],
  },
  catalogo: {
    schede: [
      { id: 'giochi', label: 'Giochi' },
      { id: 'clienti', label: 'Clienti' },
      // Stava nel Configuratore di Disponibilità: sql/bubbler_in_anagrafiche.sql dà questa scheda
      // a chi aveva quella.
      { id: 'bubbler', label: 'Bubbler' },
      // Stava nel Configuratore di Prenotazioni: sql/campi_in_anagrafiche.sql dà questa scheda a
      // chi aveva quella sottoscheda.
      { id: 'campi', label: 'Campi' },
    ],
  },
  preventivatore: {
    schede: [
      { id: 'calculator', label: 'Preventivatore' },
      {
        id: 'admin',
        label: 'Configurazione',
        sottoschede: [
          { id: 'sedi', label: 'Sedi' },
          // L'id resta 'gonfiabili': è la chiave con cui i permessi dei ruoli sono già salvati a
          // database, e cambiarlo toglierebbe l'accesso a chi ce l'ha senza dire niente.
          { id: 'gonfiabili', label: 'Listino' },
          { id: 'extra', label: 'Extra' },
        ],
      },
      { id: 'sales', label: 'Vendita' },
      { id: 'gestione', label: 'Gestione' },
      { id: 'storico', label: 'Storico Preventivi' },
    ],
  },
  voucher: {
    schede: [
      { id: 'config', label: 'Configuratore Pacchetti' },
      { id: 'gestione', label: 'Gestione' },
      { id: 'storico', label: 'Storico Voucher' },
    ],
  },
  prenotazioni: {
    schede: [
      {
        id: 'config',
        label: 'Configuratore',
        sottoschede: [
          { id: 'pacchetti', label: 'Pacchetti' },
        ],
      },
      { id: 'gestione', label: 'Gestione' },
      { id: 'calendario', label: 'Calendario' },
      { id: 'riepiloghi', label: 'Riepiloghi' },
      { id: 'storico', label: 'Storico' },
    ],
  },
  costiricavi: {
    schede: [
      { id: 'cruscotto', label: 'Dettaglio' },
      { id: 'andamento', label: 'Andamento' },
      { id: 'pergioco', label: 'Per gioco' },
      { id: 'preventivi', label: 'Preventivi' },
      {
        id: 'annullati',
        label: 'Annullati',
        sottoschede: [
          { id: 'pren_annullate', label: 'Prenotazioni' },
          { id: 'prev_annullati', label: 'Preventivi' },
        ],
      },
    ],
  },
  disponibilita: {
    schede: [
      { id: 'config', label: 'Configuratore' },
      { id: 'miedisp', label: 'Le mie disponibilità' },
      {
        id: 'riepilogo',
        label: 'Riepilogo',
        // Non è una scheda ma un permesso: dal Riepilogo si modificano le disponibilità di un
        // bubbler, anche sui mesi che lui ha confermato e non può più ridurre.
        sottoschede: [
          { id: 'modifica_altrui', label: 'Modifica disponibilità altrui' },
        ],
      },
    ],
  },
};

// --- CONTROLLO VISIBILITA' ---
// L'admin vede sempre tutto (evita lockout da configurazioni permessi errate).
// Per gli altri ruoli si legge user.permessi (jsonb caricato al login dalla tabella "ruoli").
export function puoVedere(user, moduloId, schedaId, sottoschedaId) {
  if (!user) return false;
  // Chi sia l'amministratore lo dice il flag ruoli.is_admin, non il nome del ruolo: confrontare
  // la stringa 'admin' faceva del nome una chiave, e bastava rinominarlo per chiudere fuori tutti.
  if (user.isAdmin) return true;

  const permessiModulo = user.permessi?.[moduloId];
  if (!permessiModulo) return false;
  if (!permessiModulo.schede?.includes(schedaId)) return false;
  if (sottoschedaId && !permessiModulo.sottoschede?.includes(sottoschedaId)) return false;
  return true;
}

// Un modulo compare in sidebar se almeno una delle sue schede è visibile per l'utente.
export function moduloVisibile(user, moduloId) {
  const schede = SCHEDE_REGISTRY[moduloId]?.schede || [];
  return schede.some(s => puoVedere(user, moduloId, s.id));
}
