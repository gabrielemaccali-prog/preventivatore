// --- REGISTRO MODULI (metadati per sidebar e tab "Moduli" di Impostazioni) ---
export const MODULI_REGISTRY = [
  { id: 'preventivatore', label: 'Preventivatore', icon: 'preventivatore' },
  { id: 'voucher', label: 'Voucher', icon: 'voucher' },
  { id: 'prenotazioni', label: 'Prenotazioni', icon: 'prenotazioni' },
  { id: 'disponibilita', label: 'Disponibilità', icon: 'disponibilita' },
  { id: 'costiricavi', label: 'Costi/Ricavi', icon: 'costiricavi' },
  { id: 'compensi', label: 'Compensi', icon: 'compensi' },
];

// --- REGISTRO SCHEDE/SOTTOSCHEDE PER MODULO (usato per costruire la matrice permessi in Impostazioni > Ruoli) ---
export const SCHEDE_REGISTRY = {
  preventivatore: {
    schede: [
      { id: 'calculator', label: 'Preventivatore' },
      {
        id: 'admin',
        label: 'Configurazione',
        sottoschede: [
          { id: 'sedi', label: 'Sedi' },
          { id: 'gonfiabili', label: 'Gonfiabili' },
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
          { id: 'campi', label: 'Campi' },
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
      { id: 'tabella', label: 'Tabella' },
      { id: 'andamento', label: 'Andamento' },
      { id: 'completate', label: 'Completate' },
    ],
  },
  compensi: {
    schede: [
      { id: 'config', label: 'Configuratore' },
      { id: 'daconsuntivare', label: 'Da consuntivare' },
      { id: 'consuntivati', label: 'Consuntivati' },
      { id: 'rimborso', label: 'Elabora rimborso' },
      { id: 'indicatori', label: 'Indicatori' },
    ],
  },
  disponibilita: {
    schede: [
      { id: 'config', label: 'Configuratore' },
      { id: 'miedisp', label: 'Le mie disponibilità' },
      { id: 'riepilogo', label: 'Riepilogo' },
    ],
  },
};

// --- CONTROLLO VISIBILITA' ---
// L'admin vede sempre tutto (evita lockout da configurazioni permessi errate).
// Per gli altri ruoli si legge user.permessi (jsonb caricato al login dalla tabella "ruoli").
export function puoVedere(user, moduloId, schedaId, sottoschedaId) {
  if (!user) return false;
  if (user.ruolo === 'admin') return true;

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
