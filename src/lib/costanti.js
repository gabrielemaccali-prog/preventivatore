// --- CONFIGURAZIONI INTERNE DEL MODULO PREVENTIVATORE ---
export const COSTO_AL_KM = 1.20; // Valore di fallback se una sede non ha un €/km configurato
export const MOLTIPLICATORE_TARGET = 1.35;
// Validità dichiarata sul documento di offerta: oltre questa soglia un preventivo non ancora
// confermato viene considerato scaduto (stato derivato, non salvato a database).
export const GIORNI_VALIDITA_PREVENTIVO = 10;
