// Il codice di un voucher, e come nasce un voucher da una partita che salta.
//
// Sta qui perché lo usano due moduli: il modulo Voucher, quando se ne emette uno a mano, e le
// Prenotazioni, quando una partita con un acconto viene annullata. Due generatori di codice
// separati sarebbero due serie che prima o poi si scontrano sullo stesso numero.
import { STATO_VOUCHER } from './costanti';
import { campiFatturazioneMancanti } from './utils';

// Il prossimo codice della serie dell'anno: VCH-2026-1001, VCH-2026-1002...
// Si legge l'ultimo dal database invece di contare le righe in memoria, perché il voucher può
// nascere da due posti diversi e la memoria di uno non sa cosa ha appena fatto l'altro.
export const prossimoCodiceVoucher = async (supabase, anno = new Date().getFullYear()) => {
  const prefisso = `VCH-${anno}-`;
  const { data } = await supabase
    .from('voucher')
    .select('codice')
    .like('codice', `${prefisso}%`)
    .order('codice', { ascending: false })
    .limit(1);
  let prossimo = 1001;
  if (data && data.length > 0) {
    const ultimo = parseInt(data[0].codice.replace(prefisso, ''), 10);
    if (!isNaN(ultimo)) prossimo = ultimo + 1;
  }
  return `${prefisso}${prossimo}`;
};

// Il voucher che nasce da una partita annullata con dei soldi già incassati.
//
// Vale quanto è stato incassato, non quanto costava la partita: il voucher è il denaro del
// cliente, non la promessa di rifargli la stessa festa. I dati di fatturazione sono quelli della
// prenotazione, con gli stessi nomi di colonna, e quindi passano di peso: la fattura è la stessa,
// e un'azienda resta un'azienda. Lo stato segue la regola di sempre -- emesso se c'è tutto per
// fatturare, incompleto altrimenti -- perché un voucher da posticipo si fattura come gli altri.
//
// `daPosticipo` e `prenotazioneOrigine` li scrive solo questa funzione: a mano non si impostano,
// ed è quello che fa comparire il segno POST accanto allo stato.
export const voucherDaPrenotazione = (p, importo) => ({
  nominativo: p.nominativo || '',
  telefono: p.telefono || null,
  email: p.email || null,
  // Non è un regalo: non ha una dedica da stampare, e il valore si deve vedere.
  dedica: '',
  pacchettoNome: p.pacchettoNome || '',
  importo,
  nascondi_importo: false,
  testoOfferta: '',
  fattTipo: p.fattTipo || 'privato',
  fattNome: p.fattNome || '', fattCognome: p.fattCognome || '', fattIndirizzo: p.fattIndirizzo || '',
  fattCap: p.fattCap || '', fattCitta: p.fattCitta || '', fattProvincia: p.fattProvincia || '',
  fattCF: p.fattCF || '', fattStraniero: !!p.fattStraniero, fattStato: p.fattStato || null,
  ragioneSociale: p.ragioneSociale || null, aziIndirizzo: p.aziIndirizzo || null, aziCap: p.aziCap || null,
  aziCitta: p.aziCitta || null, aziProvincia: p.aziProvincia || null,
  pIva: p.pIva || null, cfAzienda: p.cfAzienda || null, sdi: p.sdi || null,
  // I soldi ci sono già: è il motivo per cui il voucher esiste.
  statoPagamento: 'saldato',
  stato: campiFatturazioneMancanti(p).length === 0 ? STATO_VOUCHER.EMESSO : STATO_VOUCHER.INCOMPLETO,
  daPosticipo: true,
  prenotazioneOrigine: String(p.id),
});
