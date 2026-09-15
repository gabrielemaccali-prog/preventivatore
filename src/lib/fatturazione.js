// ============================================================
// Fatturazione: la logica che serve a Consuntivazione, Prenotazioni e Voucher.
//
// Una prenotazione o un voucher possono avere N fatture, come i pagamenti. Qui si decide quanto
// c'è da fatturare, a che punto è la fatturazione, come si legge l'export di Fatture in Cloud e
// come si abbina una fattura alla prenotazione o al voucher a cui si riferisce.
// Niente React e niente Supabase: funzioni pure, così l'abbinamento si può provare da solo.
// ============================================================
import { siglaProvincia } from './utils';
import { STATO_ITALIA } from './costanti';

// Sotto il centesimo due importi sono uguali: i lordi arrivano da conti con l'IVA e 1610,40 può
// valere 1610,3999999.
export const TOLLERANZA = 0.01;

export const sommaImporti = (righe) => (righe || []).reduce((s, r) => s + (parseFloat(r.importo) || 0), 0);

// Quanto di una prenotazione va fatturato: il prezzo lordo meno il voucher usato. Il voucher è
// già stato fatturato quando è stato venduto, quindi la parte che copre non si fattura di nuovo:
// una partita pagata tutta col voucher non ha niente da fatturare, una pagata in parte fattura il
// saldo.
export const daFatturarePrenotazione = (p, valoreVoucher = 0) =>
  Math.max((parseFloat(p?.prezzoVendita) || 0) - (parseFloat(valoreVoucher) || 0), 0);

// Un voucher si fattura per il suo valore. Quelli pregressi sono stati venduti col vecchio
// sistema e lì sono stati fatturati: qui non c'è niente da fare.
export const daFatturareVoucher = (v) => (v?.pregresso ? 0 : (parseFloat(v?.importo) || 0));

// A che punto è la fatturazione. "fatturata" solo quando le fatture coprono tutto: è l'unico
// caso in cui si mostra la spunta blu.
export const statoFatturazione = (dovuto, fatturato) => {
  if (dovuto <= TOLLERANZA) return 'nonDovuta';
  if (fatturato <= TOLLERANZA) return 'daFatturare';
  if (fatturato + TOLLERANZA >= dovuto) return 'fatturata';
  return 'parziale';
};

// ------------------------------------------------------------
// Export clienti nel formato del gestionale di fatturazione.
// Stava nello Storico prenotazioni; qui raggruppa anche chi ha comprato un voucher.
// ------------------------------------------------------------
const COSTANTI_CLIENTE = { 'Termini di pagamento': '0 giorni', 'Sconto predefinito': 0, "Lettera d'intento abilitata": 'No' };
const mai = (v) => (v || '').trim().toUpperCase(); // il gestionale tiene l'anagrafica in maiuscolo

export const clienteDaPrenotazione = (p) => {
  const azienda = p.fattTipo === 'azienda';
  return {
    'Denominazione': azienda
      ? (mai(p.ragioneSociale) || mai(p.nominativo))
      : (mai([p.fattCognome, p.fattNome].filter(Boolean).join(' ')) || mai(p.nominativo)),
    'Indirizzo': mai(azienda ? p.aziIndirizzo : p.fattIndirizzo),
    'Comune': mai(azienda ? p.aziCitta : p.fattCitta),
    'CAP': (azienda ? p.aziCap : p.fattCap) || '',
    'Provincia': siglaProvincia(azienda ? p.aziProvincia : p.fattProvincia),
    'Paese': azienda ? STATO_ITALIA : (p.fattStato || STATO_ITALIA),
    'Indirizzo e-mail': (p.email || '').trim(),
    'Telefono': (p.telefono || '').trim(),
    'P.IVA/TAX ID': azienda ? (p.pIva || '') : '',
    'Codice Fiscale': mai(azienda ? p.cfAzienda : p.fattCF),
    // Sui privati la colonna resta vuota anche se sulla prenotazione l'SDI è salvato come
    // "0000000": importando i sette zeri il gestionale li riduce a uno solo, mentre col campo
    // vuoto assegna da sé il codice giusto.
    'Codice SDI': azienda ? (p.sdi || '') : '',
    ...COSTANTI_CLIENTE,
  };
};

// Chi compra un voucher è sempre un privato: l'anagrafica è quella di fatturazione, e se manca
// si ripiega sul nominativo del voucher.
export const clienteDaVoucher = (v) => ({
  'Denominazione': mai([v.fattCognome, v.fattNome].filter(Boolean).join(' ')) || mai(v.nominativo),
  'Indirizzo': mai(v.fattIndirizzo),
  'Comune': mai(v.fattCitta),
  'CAP': v.fattCap || '',
  'Provincia': siglaProvincia(v.fattProvincia),
  'Paese': STATO_ITALIA,
  'Indirizzo e-mail': (v.email || '').trim(),
  'Telefono': (v.telefono || '').trim(),
  'P.IVA/TAX ID': '',
  'Codice Fiscale': mai(v.fattCF),
  'Codice SDI': '',
  ...COSTANTI_CLIENTE,
});

// Chi compare più volte esce una riga sola: si tiene la versione più completa dell'anagrafica
// (a parità, la più recente), così l'export non perde dati.
export const righeClientiExport = (prenotazioni, voucher) => {
  const compilati = (riga) => Object.values(riga).filter(v => v !== '' && v != null).length;
  const perCliente = new Map();
  const tutte = [
    ...(prenotazioni || []).map(p => ({ data: String(p.data || ''), riga: clienteDaPrenotazione(p) })),
    ...(voucher || []).map(v => ({ data: String(v.dataEmissione || '').slice(0, 10), riga: clienteDaVoucher(v) })),
  ].sort((a, b) => b.data.localeCompare(a.data));
  tutte.forEach(({ riga }) => {
    const chiave = (riga['P.IVA/TAX ID'] || riga['Codice Fiscale'] || riga['Denominazione'] || '').toUpperCase();
    if (!chiave) return;
    const gia = perCliente.get(chiave);
    if (!gia || compilati(riga) > compilati(gia)) perCliente.set(chiave, riga);
  });
  return [...perCliente.values()].sort((a, b) => a['Denominazione'].localeCompare(b['Denominazione'], 'it'));
};

// ------------------------------------------------------------
// Export "documenti emessi" di Fatture in Cloud.
// ------------------------------------------------------------
// Excel salva le date come giorni dal 30/12/1899. La conversione si fa qui invece che con la
// libreria, che non la espone allo stesso modo in tutte le sue versioni: una data letta male
// abbinerebbe la fattura alla partita sbagliata senza dare errori.
const isoDaCella = (XLSX, v) => {
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return isNaN(d) ? '' : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const t = String(v || '').trim();
  const it = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (it) return `${it[3]}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
};

// Legge le fatture dal file. L'intestazione non è in prima riga (sopra c'è il titolo
// dell'export), quindi si cerca la riga che ha Data, Numero e Lordo. Le note di credito restano
// fuori: non sono ricavi da abbinare a una partita.
export const leggiExportFatture = (XLSX, buffer) => {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const righe = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const iIntest = righe.findIndex(r => r.includes('Data') && r.includes('Numero') && r.includes('Lordo'));
  if (iIntest === -1) throw new Error("non trovo le colonne Data, Numero e Lordo: è l'export documenti di Fatture in Cloud?");
  const intest = righe[iIntest];
  const cella = (r, nome) => { const i = intest.indexOf(nome); return i === -1 ? '' : r[i]; };
  return righe.slice(iIntest + 1)
    .filter(r => String(cella(r, 'Numero')).trim() !== '')
    .map(r => {
      const numero = String(cella(r, 'Numero')).trim();
      const serie = String(cella(r, 'Serie')).trim();
      return {
        data: isoDaCella(XLSX, cella(r, 'Data')),
        numero: serie ? `${numero}/${serie}` : numero,
        documento: String(cella(r, 'Documento')).trim(),
        cliente: String(cella(r, 'Cliente')).trim(),
        cf: String(cella(r, 'CF')).trim(),
        piva: String(cella(r, 'P.IVA')).trim(),
        centro: String(cella(r, 'Centro ricavo')).trim(),
        importo: Math.round((parseFloat(cella(r, 'Lordo')) || 0) * 100) / 100,
      };
    })
    .filter(f => f.data && f.importo > 0 && (!f.documento || /fattura/i.test(f.documento)));
};

// ------------------------------------------------------------
// Abbinamento fattura -> prenotazione o voucher.
// ------------------------------------------------------------
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const giorniFra = (a, b) => Math.abs((Date.parse(b) - Date.parse(a)) / 86400000) || 0;

// Per ogni fattura propone a cosa si riferisce. È "certa" quando il cliente si riconosce per codice
// fiscale o partita IVA, l'importo coincide e il candidato è uno solo: quella si può importare a
// occhi chiusi. Negli altri casi -- riconosciuta solo per nome, importo diverso, più candidati --
// la proposta c'è ma va confermata. Le fatture già registrate (stesso numero e data) si saltano,
// così l'export si può ricaricare senza doppioni.
//
// Le prenotazioni e i voucher già fatturati per intero l'import non li tocca proprio: una fattura
// che finirebbe su di loro si conta a parte e si ignora. Se una fattura era stata scritta a mano con
// un numero diverso da quello di Fatture in Cloud, sarebbe la stessa contata due volte.
export const abbinaFatture = (lette, { prenotazioni = [], voucher = [], fatture = [], valoreVoucher = () => 0 } = {}) => {
  const giaRegistrate = new Set(fatture.map(f => `${f.numero}|${f.data}`));
  const fatturatoPer = {};
  fatture.forEach(f => { const k = `${f.tipo}|${f.riferimento}`; fatturatoPer[k] = (fatturatoPer[k] || 0) + (parseFloat(f.importo) || 0); });

  // Quanto resta da fatturare conta anche le fatture proposte come certe in questo stesso file:
  // due righe dell'export sulla stessa prenotazione non devono coprirla due volte.
  const resto = (c) => c.dovuto - (fatturatoPer[`${c.tipo}|${c.riferimento}`] || 0);
  const atteso = (c) => resto(c);

  const chiaviPren = (p) => [p.fattCF, p.pIva, p.cfAzienda, p.pIvaCF].map(norm).filter(Boolean);
  const nomiPren = (p) => (p.fattTipo === 'azienda'
    ? [p.ragioneSociale]
    : [`${p.fattNome || ''} ${p.fattCognome || ''}`, `${p.fattCognome || ''} ${p.fattNome || ''}`, p.nominativo]
  ).map(norm).filter(Boolean);
  const chiaviVoucher = (v) => [v.fattCF].map(norm).filter(Boolean);
  const nomiVoucher = (v) => [`${v.fattNome || ''} ${v.fattCognome || ''}`, `${v.fattCognome || ''} ${v.fattNome || ''}`].map(norm).filter(Boolean);

  const candidati = [
    ...prenotazioni.map(p => ({
      tipo: 'prenotazione', riferimento: String(p.id), nome: p.nominativo || '', data: String(p.data || ''),
      chiavi: chiaviPren(p), nomi: nomiPren(p),
      dovuto: daFatturarePrenotazione(p, p.voucherCodice ? valoreVoucher(p.voucherCodice) : 0),
    })),
    ...voucher.map(v => ({
      tipo: 'voucher', riferimento: String(v.codice), nome: v.nominativo || '', data: String(v.dataEmissione || '').slice(0, 10),
      chiavi: chiaviVoucher(v), nomi: nomiVoucher(v), dovuto: daFatturareVoucher(v),
    })),
  ].filter(c => c.dovuto > TOLLERANZA);

  const proposte = [];
  let senzaAbbinamento = 0;
  let giaPresenti = 0;
  let suGiaFatturate = 0;
  for (const f of lette) {
    if (giaRegistrate.has(`${f.numero}|${f.data}`)) { giaPresenti++; continue; }
    const chiavi = [norm(f.cf), norm(f.piva)].filter(Boolean);
    const nome = norm(f.cliente);
    const trovati = candidati
      .map(c => ({ ...c, perChiave: c.chiavi.some(k => chiavi.includes(k)), perNome: !!nome && c.nomi.includes(nome) }))
      .filter(c => c.perChiave || c.perNome);
    if (trovati.length === 0) { senzaAbbinamento++; continue; }
    const daFatturare = trovati.filter(c => resto(c) > TOLLERANZA);
    if (daFatturare.length === 0) { suGiaFatturate++; continue; }

    let pool = daFatturare.some(c => c.perChiave) ? daFatturare.filter(c => c.perChiave) : daFatturare;
    // Il centro di ricavo VOUCHER dice già di che cosa si tratta.
    if (/VOUCHER/i.test(f.centro) && pool.some(c => c.tipo === 'voucher')) pool = pool.filter(c => c.tipo === 'voucher');
    // L'importo atteso e' quanto resta da fatturare.
    const stessoImporto = pool.filter(c => Math.abs(atteso(c) - f.importo) < 0.02);
    const piuVicino = (lista) => lista.slice().sort((a, b) => giorniFra(a.data, f.data) - giorniFra(b.data, f.data))[0];
    const scelto = piuVicino(stessoImporto.length ? stessoImporto : pool);

    const motivi = [scelto.perChiave ? 'CF/P.IVA' : 'solo nome'];
    const importoOk = Math.abs(atteso(scelto) - f.importo) < 0.02;
    if (!importoOk) motivi.push(`importo diverso: fattura €${f.importo.toFixed(2)}, da fatturare €${atteso(scelto).toFixed(2)}`);
    if (pool.length > 1) motivi.push(`${pool.length} candidati`);
    const certa = scelto.perChiave && importoOk && stessoImporto.length === 1;
    if (certa) {
      const k = `${scelto.tipo}|${scelto.riferimento}`;
      fatturatoPer[k] = (fatturatoPer[k] || 0) + f.importo;
    }
    proposte.push({
      fattura: f, tipo: scelto.tipo, riferimento: scelto.riferimento, nome: scelto.nome, dataRiferimento: scelto.data,
      daFatturare: atteso(scelto), certa, motivi,
    });
  }
  return { proposte, senzaAbbinamento, giaPresenti, suGiaFatturate };
};
