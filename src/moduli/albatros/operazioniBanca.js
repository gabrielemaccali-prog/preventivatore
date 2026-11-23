import { supabase, leggiTutte } from '../../lib/supabaseClient'
import { DATA_INIZIO_BANCA, movimentiNonContabilizzati, contabilizzatoDi, dataCompetenza, saldoAllInizio, elaboraAlbatros, chiaveControparte, eIncassoPos, eVersamentoContanti, versamentoManualeDa } from './banca'

// ============================================================
// Le scritture dell'estratto conto di Albatros, come operazioni.js del modulo Spese di BFM:
// importare il file, trasformare i movimenti in spese (o trasferimenti, o commissioni sommate),
// classificare le entrate, ignorare e ripristinare un movimento.
// ============================================================

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Supabase limita la lunghezza di una richiesta: inserimenti e filtri "in" vanno a blocchi.
const BLOCCO = 200;
const aBlocchi = (elenco) => Array.from({ length: Math.ceil(elenco.length / BLOCCO) }, (_, i) => elenco.slice(i * BLOCCO, (i + 1) * BLOCCO));

// Tutto quello che serve a Banca e Movimenti. Senza sql/albatros_banca.sql le tabelle non ci sono:
// gli errori tornano a chi chiama.
export const caricaBanca = async () => {
  const [movimenti, caricamenti, spese, trasferimenti] = await Promise.all([
    leggiTutte(() => supabase.from('albatros_banca_movimenti').select('*').order('id')),
    leggiTutte(() => supabase.from('albatros_banca_import').select('*').order('id')),
    leggiTutte(() => supabase.from('albatros_spese').select('id, data, importo, descrizione, ente, metodo, categoria_id, multicategoria, movimento_id, spesa_bfm_id').order('id')),
    leggiTutte(() => supabase.from('albatros_trasferimenti').select('id, movimento_id, da, importo, data').order('id')),
  ]);
  return { movimenti, caricamenti, spese, trasferimenti };
};

// Le impronte già presenti fra quelle del file: per dire nell'anteprima quante righe sono nuove.
export async function impronteGiaPresenti(impronte) {
  const presenti = new Set();
  for (const blocco of aBlocchi(impronte)) {
    const { data, error } = await supabase.from('albatros_banca_movimenti').select('impronta').in('impronta', blocco);
    if (error) throw error;
    (data || []).forEach(r => presenti.add(r.impronta));
  }
  return presenti;
}

// I movimenti del file che entrano: dal 1 ottobre 2026 (vedi dataCompetenza), entrate comprese, e
// le operazioni non ancora contabilizzate (NC), che entrano come le altre.
export const movimentiDelFile = (estratto) => [...(estratto?.movimenti || []), ...movimentiNonContabilizzati(estratto)]
  .filter(m => dataCompetenza(m) >= DATA_INIZIO_BANCA);

// Importa il file: le righe già presenti si saltano (indice unico sull'impronta).
export async function importaEstratto(estratto, nomeFile, user) {
  const movimenti = movimentiDelFile(estratto);
  const { data: car, error } = await supabase.from('albatros_banca_import').insert([{
    nome_file: nomeFile || null, conto: estratto.conto || null, dal: estratto.dal, al: estratto.al,
    saldo_iniziale: estratto.saldoIniziale, saldo_finale: estratto.saldoFinale, saldo_inizio: saldoAllInizio(estratto),
    movimenti: movimenti.length, creato_da: user?.id ?? null,
  }]).select().single();
  if (error) throw error;
  let nuove = 0;
  for (const blocco of aBlocchi(movimenti)) {
    const { data, error: e } = await supabase.from('albatros_banca_movimenti').upsert(blocco.map(m => ({
      impronta: m.impronta, data_contabile: m.dataContabile, data_valuta: m.dataValuta, tipo: m.tipo, descrizione: m.descrizione, importo: m.importo, import_id: car.id,
      non_contabilizzato: !!m.nonContabilizzato,
    })), { onConflict: 'impronta', ignoreDuplicates: true }).select('id');
    if (e) throw e;
    nuove += (data || []).length;
  }
  const contabilizzate = await promuoviNonContabilizzati();
  return { nuove, contabilizzate };
}

// Le operazioni NC che un file ha poi contabilizzato: la loro spesa (o il trasferimento, o la
// classificazione dell'entrata) passa al movimento contabilizzato, e l'NC se ne va. Va fatto prima
// di elaboraMovimenti, se no il movimento contabilizzato diventerebbe una seconda spesa.
async function promuoviNonContabilizzati() {
  const { movimenti, spese, trasferimenti } = await caricaBanca();
  if (movimenti.error) throw movimenti.error;
  const occupati = new Set([
    ...spese.data.filter(s => s.movimento_id != null).map(s => s.movimento_id),
    ...trasferimenti.data.filter(t => t.movimento_id != null).map(t => t.movimento_id),
    ...movimenti.data.filter(m => m.onere_spesa_id != null || m.entrata || m.ignorato).map(m => m.id),
  ]);
  const liberi = movimenti.data.filter(m => !m.non_contabilizzato && !occupati.has(m.id));
  const presi = new Set();
  let n = 0;
  for (const nc of movimenti.data.filter(m => m.non_contabilizzato)) {
    const vero = contabilizzatoDi(nc, liberi, presi);
    if (!vero) continue;
    presi.add(vero.id);
    for (const tabella of ['albatros_spese', 'albatros_trasferimenti']) {
      const { error } = await supabase.from(tabella).update({ movimento_id: vero.id }).eq('movimento_id', nc.id);
      if (error) throw error;
    }
    const { error: e1 } = await supabase.from('albatros_banca_movimenti')
      .update({ entrata: nc.entrata, entrata_nota: nc.entrata_nota, ignorato: nc.ignorato }).eq('id', vero.id);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from('albatros_banca_movimenti').delete().eq('id', nc.id);
    if (e2) throw e2;
    n += 1;
  }
  return n;
}

// Dai movimenti ancora senza destinazione alle spese (vedi elaboraAlbatros). Si può lanciare quante
// volte si vuole: un movimento che ha già la sua destinazione non si tocca.
export async function elaboraMovimenti({ categorie, user }) {
  const { movimenti, spese, trasferimenti } = await caricaBanca();
  const errore = movimenti.error || spese.error || trasferimenti.error;
  if (errore) throw errore;
  const movimentoPer = new Map(movimenti.data.map(m => [m.id, m]));
  const storico = spese.data.filter(s => s.movimento_id != null)
    .map(s => ({ data: s.data, categoria_id: s.categoria_id, chiave: chiaveControparte(movimentoPer.get(s.movimento_id) || {}) }));
  const esito = elaboraAlbatros({ movimenti: movimenti.data, spese: spese.data, trasferimenti: trasferimenti.data, storico, categorie });

  for (const c of esito.collegamenti) {
    const { error } = await supabase.from('albatros_spese').update({ movimento_id: c.movimento.id }).eq('id', c.spesa.id).is('movimento_id', null);
    if (error) throw error;
  }
  for (const p of esito.prelievi.filter(x => x.manuale)) {
    const { error } = await supabase.from('albatros_trasferimenti').update({ movimento_id: p.movimento.id }).eq('id', p.manuale.id).is('movimento_id', null);
    if (error) throw error;
  }
  if (esito.prelievi.some(x => !x.manuale)) {
    const { error } = await supabase.from('albatros_trasferimenti').insert(esito.prelievi.filter(x => !x.manuale).map(p => ({
      data: p.spesa.data, da: 'conto', importo: p.spesa.importo, note: p.spesa.descrizione, movimento_id: p.movimento.id, creato_da: user?.id ?? null,
    })));
    if (error) throw error;
  }
  for (const blocco of aBlocchi(esito.nuove.map(n => ({
    ...n.spesa, ente: 'albatros', multicategoria: false, movimento_id: n.movimento.id, creato_da: user?.id ?? null,
  })))) {
    const { error } = await supabase.from('albatros_spese').upsert(blocco, { onConflict: 'movimento_id', ignoreDuplicates: true });
    if (error) throw error;
  }
  // Le commissioni si appoggiano alla spesa del loro movimento, che può essere appena nata: il
  // movimento lo ricorda, e il suo importo si somma alla spesa (il Cashflow conta la spesa intera).
  if (esito.oneri.length) {
    const principali = [...new Set(esito.oneri.map(o => o.principale.id))];
    const spesaDi = new Map();
    for (const blocco of aBlocchi(principali)) {
      const { data, error } = await supabase.from('albatros_spese').select('id, importo, movimento_id').in('movimento_id', blocco);
      if (error) throw error;
      (data || []).forEach(s => spesaDi.set(s.movimento_id, { id: s.id, importo: r2(s.importo) }));
    }
    for (const o of esito.oneri) {
      const spesa = spesaDi.get(o.principale.id);
      if (!spesa) continue;
      const { error } = await supabase.from('albatros_banca_movimenti').update({ onere_spesa_id: spesa.id }).eq('id', o.movimento.id);
      if (error) throw error;
      spesa.importo = r2(spesa.importo + o.importo);
      const { error: e2 } = await supabase.from('albatros_spese').update({ importo: spesa.importo }).eq('id', spesa.id);
      if (e2) throw e2;
    }
  }
  const entrate = await elaboraEntrate({ movimenti: movimenti.data, trasferimenti: trasferimenti.data, user });
  return {
    ...entrate,
    nuove: esito.nuove.length,
    daCompletare: esito.nuove.filter(n => n.spesa.categoria_id == null).length,
    collegate: esito.collegamenti.length,
    prelievi: esito.prelievi.length,
    oneri: esito.oneri.length,
  };
}

// Le entrate ancora da completare che si riconoscono da sole: gli accrediti di SumUp sono incassi
// POS delle chiusure; un versamento di contanti diventa un trasferimento dai contanti al conto (o si
// lega a quello già scritto nel Cashflow). Le altre si classificano a mano nella vista Incassi.
async function elaboraEntrate({ movimenti, trasferimenti, user }) {
  const conTrasferimento = new Set(trasferimenti.filter(t => t.movimento_id != null).map(t => t.movimento_id));
  const libere = movimenti.filter(m => Number(m.importo) > 0 && !m.ignorato && !m.entrata && !conTrasferimento.has(m.id));
  const pos = libere.filter(eIncassoPos).map(m => m.id);
  for (const blocco of aBlocchi(pos)) {
    const { error } = await supabase.from('albatros_banca_movimenti').update({ entrata: 'pos' }).in('id', blocco);
    if (error) throw error;
  }
  const presi = new Set();
  let versamenti = 0;
  for (const m of libere.filter(eVersamentoContanti)) {
    const manuale = versamentoManualeDa(m, trasferimenti, presi);
    const { error } = manuale
      ? await supabase.from('albatros_trasferimenti').update({ movimento_id: m.id }).eq('id', manuale.id)
      : await supabase.from('albatros_trasferimenti').insert([{ data: m.data_contabile, da: 'contanti', importo: r2(m.importo), note: 'Versamento di contanti in banca', movimento_id: m.id, creato_da: user?.id ?? null }]);
    if (error) throw error;
    if (manuale) presi.add(manuale.id);
    versamenti += 1;
  }
  return { incassiPos: pos.length, versamenti };
}

// La natura di un'entrata scelta a mano nella vista Incassi: 'pos', 'altro' (con la nota),
// 'versamento' (diventa un trasferimento dai contanti al conto), 'ignorato', o null (da completare).
// Cambiando, quello che c'era prima si toglie: il trasferimento del versamento, l'ignorato.
export async function classificaEntrata(m, natura, nota, user) {
  const { error: e1 } = await supabase.from('albatros_trasferimenti').delete().eq('movimento_id', m.id).neq('da', 'conto');
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('albatros_banca_movimenti').update({
    entrata: natura === 'pos' || natura === 'altro' ? natura : null,
    entrata_nota: natura === 'altro' ? (nota || '').trim() || null : null,
    ignorato: natura === 'ignorato',
  }).eq('id', m.id);
  if (e2) throw e2;
  if (natura === 'versamento') {
    const { error } = await supabase.from('albatros_trasferimenti').insert([{ data: m.data_contabile, da: 'contanti', importo: r2(m.importo), note: (nota || '').trim() || 'Versamento di contanti in banca', movimento_id: m.id, creato_da: user?.id ?? null }]);
    if (error) throw error;
  }
}

// Riunisce i trasferimenti contati due volte (vedi trasferimentiDoppi): quello nato dalla banca se
// ne va, e il suo movimento passa a quello scritto a mano.
export async function unisciTrasferimenti(doppi) {
  for (const { banca, manuale } of doppi) {
    const { error: e1 } = await supabase.from('albatros_trasferimenti').delete().eq('id', banca.id);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from('albatros_trasferimenti').update({ movimento_id: banca.movimento_id }).eq('id', manuale.id);
    if (e2) throw e2;
  }
}

// Il movimento non era una spesa: si segna ignorato e la spesa nata da lui se ne va. Le sue
// commissioni tornano libere (si ignorano a loro volta dalla scheda Movimenti).
export async function ignoraSpesa(spesa) {
  const { error: e1 } = await supabase.from('albatros_banca_movimenti').update({ onere_spesa_id: null }).eq('onere_spesa_id', spesa.id);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('albatros_banca_movimenti').update({ ignorato: true }).eq('id', spesa.movimento_id);
  if (e2) throw e2;
  const { error: e3 } = await supabase.from('albatros_spese').delete().eq('id', spesa.id);
  if (e3) throw e3;
}

// Ignorare un movimento senza spesa, o ripristinarlo: ripristinato, torna subito a essere una spesa.
export async function segnaIgnorato(movimento, ignorato, { categorie, user }) {
  const { error } = await supabase.from('albatros_banca_movimenti').update({ ignorato }).eq('id', movimento.id);
  if (error) throw error;
  if (!ignorato) await elaboraMovimenti({ categorie, user });
}

// Il controllo del saldo, come nella scheda Banca di BFM: dal saldo del 30 settembre (il primo file
// che lo conosce) più i movimenti caricati si arriva a un saldo, che deve essere quello della banca
// alla fine dell'ultimo file. Se no manca un pezzo di estratto conto, o c'è un movimento in più.
export function controlloSaldoAlbatros(caricamenti, movimenti) {
  const partenza = (caricamenti || []).find(c => c.saldo_inizio != null);
  if (!partenza) return null;
  const ultimo = [...(caricamenti || [])].sort((a, b) => String(a.al).localeCompare(String(b.al)) || a.id - b.id).pop();
  const ricostruito = r2((movimenti || []).filter(m => !m.non_contabilizzato && m.data_contabile <= ultimo.al).reduce((t, m) => t + Number(m.importo), Number(partenza.saldo_inizio)));
  return { partenza: r2(partenza.saldo_inizio), alGiorno: ultimo.al, ricostruito, banca: r2(ultimo.saldo_finale), differenza: r2(ricostruito - Number(ultimo.saldo_finale)) };
}
