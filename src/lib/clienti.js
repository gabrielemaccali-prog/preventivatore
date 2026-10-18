// ============================================================
// Anagrafica clienti, ricostruita da quello che c'è già: preventivi, prenotazioni e voucher.
//
// Un cliente non ha una tabella sua: i suoi dati stanno scritti su ogni documento, ripetuti e a
// volte diversi. Qui si raccolgono e si riconosce chi è la stessa persona (o la stessa azienda):
// due documenti sono dello stesso cliente se condividono la partita IVA, il codice fiscale, l'email
// o il telefono. Il nome da solo non basta a unire due documenti che hanno contatti diversi, perché
// due "Mario Rossi" possono essere due persone; vale solo per chi non ha lasciato nient'altro.
// Niente React e niente Supabase: funzioni pure, come in fatturazione.js.
// ============================================================
import { siglaProvincia } from './utils.js';
import { STATO_PREN, STATO_VOUCHER, statoPreventivoDi } from './costanti.js';
import { daFatturarePrenotazione } from './fatturazione.js';

const pulito = (v) => String(v ?? '').trim();
const alfanumerico = (v) => pulito(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
const nomeNormalizzato = (v) => pulito(v).toLowerCase().replace(/\s+/g, ' ');
// Il prefisso internazionale non distingue: "+39 333…" e "333…" sono lo stesso numero.
const cifreTelefono = (v) => {
  const cifre = pulito(v).replace(/\D/g, '').replace(/^00/, '');
  const senzaPrefisso = cifre.length > 10 && cifre.startsWith('39') ? cifre.slice(2) : cifre;
  return senzaPrefisso.length >= 6 ? senzaPrefisso : '';
};

// Un documento ridotto a quello che dice del cliente. `importo` è quello che il cliente ha
// davvero speso: zero sui preventivi, che sono proposte, e sulle partite non confermate.
const daPrenotazione = (p, valoreVoucher) => {
  const azienda = p.fattTipo === 'azienda';
  return {
    fonte: 'prenotazione', rif: String(p.id), data: pulito(p.data).slice(0, 10), stato: p.stato || '',
    descrizione: p.pacchettoNome || '', preventivo: pulito(p.preventivoCollegato),
    azienda,
    denominazione: azienda
      ? (pulito(p.ragioneSociale) || pulito(p.nominativo))
      : ([pulito(p.fattCognome), pulito(p.fattNome)].filter(Boolean).join(' ') || pulito(p.nominativo)),
    referente: pulito(p.nominativo),
    email: pulito(p.email).toLowerCase(), telefono: pulito(p.telefono),
    piva: azienda ? pulito(p.pIva) : '',
    cf: pulito(azienda ? p.cfAzienda : p.fattCF).toUpperCase(),
    sdi: azienda ? pulito(p.sdi) : '',
    indirizzo: pulito(azienda ? p.aziIndirizzo : p.fattIndirizzo),
    cap: pulito(azienda ? p.aziCap : p.fattCap),
    citta: pulito(azienda ? p.aziCitta : p.fattCitta),
    provincia: siglaProvincia(azienda ? p.aziProvincia : p.fattProvincia),
    // Il voucher usato è già contato quando è stato venduto: qui va solo il saldo.
    importo: p.stato === STATO_PREN.CONFERMATO ? daFatturarePrenotazione(p, valoreVoucher) : 0,
  };
};

const daVoucher = (v) => ({
  fonte: 'voucher', rif: String(v.codice), data: pulito(v.dataEmissione).slice(0, 10), stato: v.stato || '',
  descrizione: v.pacchettoNome || 'Voucher',
  azienda: false,
  denominazione: [pulito(v.fattCognome), pulito(v.fattNome)].filter(Boolean).join(' ') || pulito(v.nominativo),
  referente: pulito(v.nominativo),
  email: pulito(v.email).toLowerCase(), telefono: pulito(v.telefono),
  piva: '', cf: pulito(v.fattCF).toUpperCase(), sdi: '',
  indirizzo: pulito(v.fattIndirizzo), cap: pulito(v.fattCap), citta: pulito(v.fattCitta), provincia: siglaProvincia(v.fattProvincia),
  importo: v.stato === STATO_VOUCHER.INCOMPLETO ? 0 : (parseFloat(v.importo) || 0),
});

const daPreventivo = (pv) => ({
  // Lo stato vero, non quello salvato: un preventivo scaduto senza risposta è "Azione richiesta".
  fonte: 'preventivo', rif: String(pv.codice), data: pulito(pv.dataEmissione).slice(0, 10), stato: statoPreventivoDi(pv),
  descrizione: [pv.destinazione, pv.periodo].filter(v => v && v !== 'N/D').join(' · '),
  azienda: false,
  denominazione: pulito(pv.nomeReferente), referente: pulito(pv.nomeReferente),
  email: pulito(pv.emailReferente).toLowerCase(), telefono: pulito(pv.telefonoReferente),
  piva: '', cf: '', sdi: '', indirizzo: '', cap: '', citta: '', provincia: '',
  importo: 0,
});

const chiaviForti = (d) => [
  d.piva && `piva:${alfanumerico(d.piva)}`,
  d.cf && `cf:${alfanumerico(d.cf)}`,
  d.email && `email:${d.email}`,
  cifreTelefono(d.telefono) && `tel:${cifreTelefono(d.telefono)}`,
].filter(Boolean);

// Prenotazioni e voucher hanno i dati di fatturazione, i preventivi solo il referente: per ogni
// campo vince il documento più affidabile e, a parità, il più recente.
const PESO_FONTE = { prenotazione: 0, voucher: 0, preventivo: 1 };
const piuAffidabilePrima = (a, b) => (PESO_FONTE[a.fonte] - PESO_FONTE[b.fonte]) || b.data.localeCompare(a.data);

const distinti = (valori) => [...new Set(valori.filter(Boolean))];

const componiCliente = (documenti) => {
  const ordinati = [...documenti].sort(piuAffidabilePrima);
  const primo = (campo, lista = ordinati) => lista.find(d => d[campo])?.[campo] || '';
  const azienda = ordinati.some(d => d.azienda);
  // Di un'azienda conta la ragione sociale, non il nome di chi ha chiamato.
  const denominazione = azienda ? primo('denominazione', ordinati.filter(d => d.azienda)) : primo('denominazione');
  // L'indirizzo si prende tutto dallo stesso documento: mescolare la via di uno e il CAP di un
  // altro darebbe un indirizzo che non esiste.
  const conIndirizzo = ordinati.find(d => d.indirizzo || d.citta) || {};
  const perData = [...documenti].sort((a, b) => a.data.localeCompare(b.data));
  const conta = (fonte) => documenti.filter(d => d.fonte === fonte).length;
  const piva = primo('piva');
  const cf = primo('cf');
  return {
    id: alfanumerico(piva) || alfanumerico(cf) || primo('email') || cifreTelefono(primo('telefono')) || nomeNormalizzato(denominazione),
    tipo: azienda ? 'azienda' : 'privato',
    denominazione,
    referenti: distinti(ordinati.map(d => d.referente)).filter(r => nomeNormalizzato(r) !== nomeNormalizzato(denominazione)),
    emails: distinti(ordinati.map(d => d.email)),
    telefoni: distinti(ordinati.map(d => d.telefono)),
    piva, cf, sdi: primo('sdi'),
    indirizzo: conIndirizzo.indirizzo || '', cap: conIndirizzo.cap || '', citta: conIndirizzo.citta || '', provincia: conIndirizzo.provincia || '',
    preventivi: conta('preventivo'), prenotazioni: conta('prenotazione'), voucher: conta('voucher'),
    speso: Math.round(documenti.reduce((s, d) => s + d.importo, 0) * 100) / 100,
    primoContatto: perData.find(d => d.data)?.data || '',
    ultimaAttivita: perData.filter(d => d.data).pop()?.data || '',
    // Basta per emettere una fattura: l'identificativo fiscale e dove mandarla.
    datiFatturazione: !!((azienda ? piva : cf) && conIndirizzo.indirizzo),
    documenti: [...documenti].sort((a, b) => b.data.localeCompare(a.data)),
  };
};

// Le partite commissionate da un fornitore o da un campo non hanno un cliente: si compensano
// nelle loro schede di consuntivazione.
export const costruisciClienti = ({ prenotazioni = [], voucher = [], preventivi = [] }) => {
  const valoreVoucher = Object.fromEntries(voucher.map(v => [String(v.codice), parseFloat(v.importo) || 0]));
  const documenti = [
    ...prenotazioni.filter(p => !p.clienteSedeId && !p.clienteCampoId)
      .map(p => daPrenotazione(p, p.voucherCodice ? valoreVoucher[String(p.voucherCodice)] || 0 : 0)),
    ...voucher.map(daVoucher),
    ...preventivi.map(daPreventivo),
  ].filter(d => d.denominazione || d.email || d.telefono);

  // Union-find sugli indici dei documenti.
  const padre = documenti.map((_, i) => i);
  const radice = (i) => (padre[i] === i ? i : (padre[i] = radice(padre[i])));
  const unisci = (a, b) => { padre[radice(a)] = radice(b); };

  const primoConChiave = new Map();
  const primoConNome = new Map();
  documenti.forEach((d, i) => {
    chiaviForti(d).forEach(k => (primoConChiave.has(k) ? unisci(i, primoConChiave.get(k)) : primoConChiave.set(k, i)));
    const nome = nomeNormalizzato(d.denominazione);
    if (nome && !primoConNome.has(nome)) primoConNome.set(nome, i);
  });
  // La prenotazione nata da un preventivo è dello stesso cliente anche se nel frattempo il
  // referente ha lasciato un'email diversa.
  const indicePreventivo = new Map();
  documenti.forEach((d, i) => { if (d.fonte === 'preventivo') indicePreventivo.set(d.rif, i); });
  documenti.forEach((d, i) => {
    if (d.preventivo && indicePreventivo.has(d.preventivo)) unisci(i, indicePreventivo.get(d.preventivo));
  });
  documenti.forEach((d, i) => {
    if (chiaviForti(d).length > 0) return;
    const nome = nomeNormalizzato(d.denominazione);
    if (nome && primoConNome.get(nome) !== i) unisci(i, primoConNome.get(nome));
  });

  const gruppi = new Map();
  documenti.forEach((d, i) => {
    const r = radice(i);
    if (!gruppi.has(r)) gruppi.set(r, []);
    gruppi.get(r).push(d);
  });
  return [...gruppi.values()].map(componiCliente)
    .sort((a, b) => a.denominazione.localeCompare(b.denominazione, 'it', { sensitivity: 'base' }));
};
