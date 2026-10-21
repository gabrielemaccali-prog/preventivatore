import { supabase, leggiTutte } from '../../lib/supabaseClient'
import { elabora, oneriDi, r2, daCompletare, esitoRegola, nomeControparte } from '../../lib/banca'

// ============================================================
// Le scritture del modulo Spese che servono da più schede: importare l'estratto conto, trasformare
// i movimenti in spese, tenere allineate le spese di Albatros.
// ============================================================

// Supabase limita la lunghezza di una richiesta: gli inserimenti e i filtri "in" vanno a blocchi.
const BLOCCO = 200;
const aBlocchi = (elenco) => Array.from({ length: Math.ceil(elenco.length / BLOCCO) }, (_, i) => elenco.slice(i * BLOCCO, (i + 1) * BLOCCO));

export const caricaTutto = async () => {
  const [spese, movimenti, caricamenti] = await Promise.all([
    leggiTutte(() => supabase.from('spese').select('*').order('id')),
    leggiTutte(() => supabase.from('banca_movimenti').select('*').order('id')),
    leggiTutte(() => supabase.from('banca_import').select('*').order('id')),
  ]);
  return { spese, movimenti, caricamenti };
};

// Le impronte già presenti fra quelle del file: servono all'anteprima, per dire quante righe sono nuove.
export async function impronteGiaPresenti(impronte) {
  const presenti = new Set();
  for (const blocco of aBlocchi(impronte)) {
    const { data, error } = await supabase.from('banca_movimenti').select('impronta').in('impronta', blocco);
    if (error) throw error;
    (data || []).forEach(r => presenti.add(r.impronta));
  }
  return presenti;
}

// Importa un estratto conto letto da leggiEstrattoConto. Le righe già presenti si saltano: l'indice
// unico sull'impronta e "ignoreDuplicates" fanno sì che ricaricare le stesse date non dia errori e
// non crei doppioni, anche se due persone caricano lo stesso file nello stesso momento.
export async function importaEstratto(estratto, nomeFile, user) {
  const { data: car, error } = await supabase.from('banca_import').insert([{
    file_nome: nomeFile || null, conto: estratto.conto || null, dal: estratto.dal, al: estratto.al,
    saldo_iniziale: estratto.saldoIniziale, saldo_finale: estratto.saldoFinale,
    righe_lette: estratto.movimenti.length, creato_da: user?.id ?? null,
  }]).select().single();
  if (error) throw error;
  let nuove = 0;
  for (const blocco of aBlocchi(estratto.movimenti)) {
    const righe = blocco.map(m => ({
      impronta: m.impronta, codice: m.codice, data_contabile: m.dataContabile, data_valuta: m.dataValuta,
      tipo: m.tipo, descrizione: m.descrizione, importo: m.importo, import_id: car.id,
    }));
    const { data, error: e } = await supabase.from('banca_movimenti')
      .upsert(righe, { onConflict: 'impronta', ignoreDuplicates: true }).select('id');
    if (e) throw e;
    nuove += (data || []).length;
  }
  await supabase.from('banca_import').update({ righe_nuove: nuove }).eq('id', car.id);
  return { caricamento: car, nuove };
}

// Dai movimenti ancora senza destinazione alle spese: collega quelle scritte a mano, crea le
// nuove, aggancia gli oneri e segna gli ignorati. Si può lanciare quante volte si vuole: un
// movimento che ha già la sua spesa non si tocca (e l'indice unico su spese.movimento_id impedisce
// comunque che ne nascano due).
export async function elaboraMovimenti({ regole, controparti, categorie, user }) {
  const { spese, movimenti } = await caricaTutto();
  if (spese.error || movimenti.error) throw (spese.error || movimenti.error);
  const esito = elabora({ movimenti: movimenti.data, spese: spese.data, regole, controparti });

  for (const c of esito.collegamenti) {
    const { error } = await supabase.from('spese').update({ movimento_id: c.movimento.id }).eq('id', c.spesa.id).is('movimento_id', null);
    if (error) throw error;
  }
  for (const blocco of aBlocchi(esito.nuove.map(n => ({ ...n.spesa, creato_da: user?.id ?? null })))) {
    const { error } = await supabase.from('spese').upsert(blocco, { onConflict: 'movimento_id', ignoreDuplicates: true });
    if (error) throw error;
  }
  const ignorati = esito.ignorati.map(i => i.movimento.id);
  for (const blocco of aBlocchi(ignorati)) {
    const { error } = await supabase.from('banca_movimenti').update({ ignorato: true }).in('id', blocco);
    if (error) throw error;
  }
  // Gli oneri si appoggiano alla spesa del movimento principale, che può essere appena nata.
  if (esito.oneri.length) {
    const principali = [...new Set(esito.oneri.map(o => o.principale.id))];
    const spesaDi = new Map();
    for (const blocco of aBlocchi(principali)) {
      const { data, error } = await supabase.from('spese').select('id, movimento_id').in('movimento_id', blocco);
      if (error) throw error;
      (data || []).forEach(s => spesaDi.set(s.movimento_id, s.id));
    }
    for (const o of esito.oneri) {
      const spesaId = spesaDi.get(o.principale.id);
      if (!spesaId) continue;
      const { error } = await supabase.from('banca_movimenti').update({ onere_spesa_id: spesaId }).eq('id', o.movimento.id);
      if (error) throw error;
    }
  }
  await allineaAlbatros(user);
  return {
    nuove: esito.nuove.length,
    daCompletare: esito.nuove.filter(n => daCompletare(n.spesa, categorie)).length,
    collegate: esito.collegamenti.length,
    oneri: esito.oneri.length,
    ignorati: ignorati.length,
  };
}

// Una regola sola, applicata a mano, sui movimenti già caricati che prende. Tocca solo le spese
// ancora da completare, e di quelle solo i campi vuoti: una spesa già classificata, o classificata
// diversamente, resta com'è. Vale anche se una regola più in alto prenderebbe il movimento: chi la
// applica l'ha scelta. Restituisce l'esito movimento per movimento (vedi esitoRegola).
export async function applicaRegola({ regola, regole, spese, movimenti, controparti, categorie, user }) {
  const esiti = esitoRegola({ regola, regole, spese, movimenti, controparti, categorie });
  for (const x of esiti.filter(e => e.esito === 'completa')) {
    const patch = { ...x.patch, regola_id: regola.id };
    if (patch.controparte_id && !x.spesa.beneficiario) patch.beneficiario = nomeControparte(controparti, patch.operativa || x.spesa.operativa, patch.controparte_id);
    const { error } = await supabase.from('spese').update(patch).eq('id', x.spesa.id);
    if (error) throw error;
  }
  if (esiti.some(e => e.esito === 'completa')) await allineaAlbatros(user);
  return esiti;
}

// L'esito di applicaRegola in una frase.
export function descriviEsito(esiti) {
  const conta = (k) => esiti.filter(e => e.esito === k).length;
  if (esiti.length === 0) return 'Nessun movimento già caricato corrisponde a questa regola: controlla le condizioni.';
  const parti = [`Corrisponde a ${esiti.length} ${esiti.length === 1 ? 'movimento' : 'movimenti'}`];
  if (conta('completa')) parti.push(`${conta('completa')} spese completate`);
  if (conta('gia_classificata')) parti.push(`${conta('gia_classificata')} già classificate, lasciate com'erano`);
  if (conta('contraddice')) parti.push(`${conta('contraddice')} classificate diversamente (altro ente, natura o tipo), lasciate com'erano`);
  if (conta('senza_spesa')) parti.push(`${conta('senza_spesa')} senza spesa (ignorati, oneri o entrate)`);
  const precedenti = [...new Set(esiti.filter(e => e.precedente).map(e => e.precedente.nome))];
  const testo = parti.join(' · ') + '.';
  return precedenti.length
    ? `${testo} Attenzione: sui movimenti nuovi vince ${precedenti.length === 1 ? 'la regola' : 'le regole'} "${precedenti.join('", "')}", più in alto: sposta questa sopra.`
    : testo;
}

// Le spese di Albatros compaiono anche fra le spese di Albatros, pagate da BFM, con gli oneri
// bancari compresi: è il loro costo di gestione. Si ricalcola tutto e si scrive solo la
// differenza: righe nuove, cambiate, e quelle la cui spesa non è più di Albatros.
// Se una spesa si cancella, la sua riga in Albatros se ne va da sola (on delete cascade).
export async function allineaAlbatros(user) {
  const [{ data: spese }, { data: movimenti }, { data: esistenti, error }] = await Promise.all([
    leggiTutte(() => supabase.from('spese').select('*').order('id')),
    leggiTutte(() => supabase.from('banca_movimenti').select('id, importo, onere_spesa_id').not('onere_spesa_id', 'is', null).order('id')),
    leggiTutte(() => supabase.from('albatros_spese').select('id, spesa_bfm_id, data, importo, descrizione, categoria_id, ente').not('spesa_bfm_id', 'is', null).order('id')),
  ]);
  if (error) throw error;
  const voluti = new Map((spese || []).filter(s => s.ente === 'albatros').map(s => [s.id, {
    spesa_bfm_id: s.id, data: s.data, importo: r2(Number(s.importo) + oneriDi(s, movimenti)),
    descrizione: [s.descrizione, s.beneficiario].filter(Boolean).join(' · ').slice(0, 300),
    categoria_id: s.albatros_categoria_id ?? null, ente: 'bfm',
  }]));
  const esistente = new Map((esistenti || []).map(a => [a.spesa_bfm_id, a]));
  const daTogliere = (esistenti || []).filter(a => !voluti.has(a.spesa_bfm_id)).map(a => a.id);
  const daCreare = [...voluti.values()].filter(v => !esistente.has(v.spesa_bfm_id)).map(v => ({ ...v, creato_da: user?.id ?? null }));
  const daCambiare = [...voluti.values()].filter(v => {
    const a = esistente.get(v.spesa_bfm_id);
    return a && (a.data !== v.data || r2(a.importo) !== v.importo || a.descrizione !== v.descrizione || (a.categoria_id ?? null) !== v.categoria_id || a.ente !== 'bfm');
  });
  for (const blocco of aBlocchi(daTogliere)) {
    const { error: e } = await supabase.from('albatros_spese').delete().in('id', blocco);
    if (e) throw e;
  }
  for (const blocco of aBlocchi(daCreare)) {
    const { error: e } = await supabase.from('albatros_spese').insert(blocco);
    if (e) throw e;
  }
  for (const v of daCambiare) {
    const { error: e } = await supabase.from('albatros_spese').update(v).eq('spesa_bfm_id', v.spesa_bfm_id);
    if (e) throw e;
  }
}
