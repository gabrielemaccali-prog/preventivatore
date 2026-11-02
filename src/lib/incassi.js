// ============================================================
// Incassi: gli accrediti dell'estratto conto e i pagamenti registrati nell'app (di prenotazioni e
// voucher) che quei soldi hanno portato.
//
// Un accredito si abbina a una o più "unità di pagamento": un pagamento qualsiasi, oppure tutte le
// quote di un bonifico su più prenotazioni, che in banca arriva come un movimento solo e quindi si
// abbina tutto insieme. Quello che non viene da una prenotazione (un capitale versato, una vendita)
// non si abbina: prende una categoria degli incassi.
//
// La proposta guarda importo, data e nome. Il nome è obbligatorio: due bonifici da 220 euro nella
// stessa settimana sono la norma, e abbinare per solo importo vorrebbe dire sbagliare in silenzio.
// Una parola conta di più quanto è rara ("Ciardullo" sì, "Marco" poco). Le proposte si assegnano
// tutte insieme, dalla più sicura: un pagamento non finisce proposto a due accrediti.
// Niente React e niente Supabase: funzioni pure, come banca.js.
// ============================================================

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Quanto può distare la data registrata nell'app da quella dell'accredito: chi registra a mano
// scrive il giorno in cui il cliente dice di aver pagato, la banca quello in cui sono arrivati.
export const GIORNI_INCASSO = 15;
// Molti pagamenti sono registrati con la data della partita invece che con quella del bonifico, che
// arriva settimane prima. Quando il nome torna bene -- almeno due parole in comune -- la data conta
// poco, e la distanza ammessa si allunga.
export const GIORNI_INCASSO_CON_NOME = 90;
export const PAROLE_NOME_SICURO = 2;
const giorni = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

// Le parole di un nome, senza accenti e senza quelle che non distinguono nessuno.
const NON_DISTINTIVE = new Set([
  'SRL', 'SRLS', 'SPA', 'SAS', 'SNC', 'SSD', 'ASD', 'APS', 'ETS', 'ARL', 'SOCIETA', 'SPORTIVA', 'DILETTANTISTICA',
  'IL', 'LA', 'LO', 'LE', 'GLI', 'DI', 'DA', 'DEL', 'DELLA', 'DEI', 'E', 'ED', 'CENTRO', 'SPORTIVO', 'CAMPO',
  'BONIFICO', 'PRENOTAZIONE', 'PARTITA', 'SALDO', 'ACCONTO', 'FATTURA', 'FATTURE', 'EVENTO', 'ORE', 'ORA',
]);
export const parole = (s) => [...new Set(String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^A-Z]+/).filter(p => p.length > 2 && !NON_DISTINTIVE.has(p)))];

// Chi ha mandato i soldi e perché, dal testo della banca: "MITT.: <ordinante> BENEF.:" e la
// causale, che sta fra i codici iniziali e "Bonifico a Vostro favore".
export const ordinanteDi = (m) => (/MITT\.?:\s*(.+?)\s+BENEF\.?:/i.exec(String(m?.descrizione || ''))?.[1] || '').trim();
export const causaleDi = (m) => String(m?.descrizione || '')
  .replace(/^COD\.?\s*DISP\.?:?\s*\d+\s*(CASH|SUPP)?\s*\S*\s*/i, '')
  .split(/\s+Bonifico a Vostro favore/i)[0].trim();

// Gli accrediti da considerare: le entrate non ignorate.
export const eIncasso = (m) => Number(m?.importo) > 0 && !m?.ignorato;

// Le unità di pagamento: i pagamenti elettronici (i contanti non passano dalla banca), con le quote
// dello stesso bonifico raccolte in una. `nomiDi(pagamento)` dice i nomi della prenotazione o del
// voucher a cui il pagamento appartiene: chi paga non è sempre chi ha prenotato.
export function unitaDiPagamento(pagamenti, nomiDi = () => []) {
  const per = new Map();
  (pagamenti || []).filter(pg => !pg.contanti).forEach(pg => {
    const chiave = pg.gruppo ? `g:${pg.gruppo}` : `p:${pg.id}`;
    const u = per.get(chiave) || { chiave, gruppo: pg.gruppo || null, righe: [], importo: 0, data: pg.data, nomi: [] };
    u.righe.push(pg);
    u.importo = r2(u.importo + (Number(pg.importo) || 0));
    if (String(pg.data) < String(u.data)) u.data = pg.data;
    u.nomi.push(pg.nominativo, ...nomiDi(pg));
    per.set(chiave, u);
  });
  return [...per.values()].map(u => ({
    ...u,
    // Un'unità è abbinata quando tutte le sue righe portano lo stesso movimento.
    movimentoId: u.righe.every(r => r.movimento_id != null && r.movimento_id === u.righe[0].movimento_id) ? u.righe[0].movimento_id : null,
    inParte: u.righe.some(r => r.movimento_id != null) && !u.righe.every(r => r.movimento_id === u.righe[0].movimento_id),
  }));
}

// Quanto pesa ogni parola: 1 / numero di testi in cui compare. Un cognome raro vale più di un nome.
const pesiParole = (testi) => {
  const conta = new Map();
  testi.forEach(t => parole(t).forEach(p => conta.set(p, (conta.get(p) || 0) + 1)));
  return (p) => 1 / (conta.get(p) || 1);
};

// Le proposte: { [movimentoId]: chiave dell'unità }. Solo per accrediti senza abbinamento e senza
// categoria, verso unità non ancora abbinate, con lo stesso importo, la data vicina e almeno una
// parola del nome in comune.
export function proposteIncassi({ movimenti, unita }) {
  const accrediti = (movimenti || []).filter(m => eIncasso(m) && m.incasso_categoria_id == null);
  const abbinati = new Set((unita || []).filter(u => u.movimentoId != null).map(u => u.movimentoId));
  const libere = (unita || []).filter(u => u.movimentoId == null && !u.inParte);
  const testoDi = (m) => `${ordinanteDi(m)} ${causaleDi(m)}`;
  const peso = pesiParole([...accrediti.map(testoDi), ...libere.map(u => u.nomi.join(' '))]);
  const coppie = [];
  accrediti.filter(m => !abbinati.has(m.id)).forEach(m => {
    const suo = new Set(parole(testoDi(m)));
    libere.forEach(u => {
      if (Math.abs(u.importo - Number(m.importo)) > 0.005) return;
      const distanza = giorni(m.data_contabile, u.data);
      const comuni = parole(u.nomi.join(' ')).filter(p => suo.has(p));
      if (comuni.length === 0) return;
      if (distanza > (comuni.length >= PAROLE_NOME_SICURO ? GIORNI_INCASSO_CON_NOME : GIORNI_INCASSO)) return;
      const punti = comuni.reduce((s, p) => s + peso(p), 0) + (1 - distanza / (GIORNI_INCASSO_CON_NOME + 1)) * 0.1;
      coppie.push({ movimentoId: m.id, chiave: u.chiave, punti });
    });
  });
  coppie.sort((a, b) => b.punti - a.punti);
  const presi = new Set();
  const proposte = {};
  coppie.forEach(c => {
    if (proposte[c.movimentoId] || presi.has(c.chiave)) return;
    proposte[c.movimentoId] = c.chiave;
    presi.add(c.chiave);
  });
  return proposte;
}

// Lo stato di un accredito, per la scheda: abbinato, con categoria, proposto o da abbinare.
export const STATI_INCASSO = Object.freeze({
  ABBINATO: 'abbinato', CATEGORIA: 'categoria', PROPOSTO: 'proposto', DA_ABBINARE: 'da abbinare', IGNORATO: 'ignorato',
});
export function statoIncasso(m, { unitaAbbinate = [], proposta = null } = {}) {
  if (m.ignorato) return STATI_INCASSO.IGNORATO;
  if (unitaAbbinate.length > 0) return STATI_INCASSO.ABBINATO;
  if (m.incasso_categoria_id != null) return STATI_INCASSO.CATEGORIA;
  if (proposta) return STATI_INCASSO.PROPOSTO;
  return STATI_INCASSO.DA_ABBINARE;
}

// Un abbinamento a mano si può salvare quando le unità scelte fanno l'importo dell'accredito.
// Le date che non coincidono si segnalano: si allineano a quella della banca, che è quella vera.
export function controllaAbbinamento(m, unitaScelte) {
  const somma = r2((unitaScelte || []).reduce((s, u) => s + u.importo, 0));
  const differenza = r2(Number(m.importo) - somma);
  const dateDiverse = (unitaScelte || []).flatMap(u => u.righe).filter(r => r.data !== m.data_contabile);
  return { somma, differenza, torna: Math.abs(differenza) <= 0.005 && (unitaScelte || []).length > 0, dateDiverse };
}
