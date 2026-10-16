// ============================================================
// Albatros: conti della cassa del centro sportivo. Sole funzioni pure, senza Supabase né React,
// così si provano in Node (npm run prova:albatros).
// ============================================================

// Le categorie (del listino e delle spese) stanno in albatros_categorie e si cambiano dal
// Configuratore: qui solo come leggerle.
export const categorieDi = (categorie, tipo, { ancheArchiviate = false } = {}) => (categorie || [])
  .filter(c => c.tipo === tipo && (ancheArchiviate || c.attiva))
  .sort((x, y) => x.ordine - y.ordine || x.nome.localeCompare(y.nome));
export const nomeCategoria = (categorie, id) => (categorie || []).find(c => c.id === id)?.nome || 'Senza categoria';
// Valore di una tendina di categoria: null = nessuna scelta ancora, vale la prima categoria;
// '' = senza categoria; altrimenti l'id come testo.
export const idCategoriaScelta = (valore, categorie, tipo) =>
  (valore == null ? (categorieDi(categorie, tipo)[0]?.id ?? null) : (Number(valore) || null));

// Chi può pagare una spesa: solo questi tre enti.
export const ENTI = [
  { id: 'albatros', label: 'Albatros' },
  { id: 'bfm', label: 'BFM' },
  { id: 'lama', label: 'Lama' },
];
export const etichettaEnte = (id) => ENTI.find(e => e.id === id)?.label || id;

// I pagamenti a Lama (e a BFM), fatti da Albatros o da BFM (tabella albatros_pagamenti).
export const CAUSALI_PAGAMENTO = [
  { id: 'rimborso', label: 'Rimborso spese' },
  { id: 'stipendio', label: 'Stipendio' },
  { id: 'altro', label: 'Altro' },
];
export const METODI_PAGAMENTO = [
  { id: 'contanti', label: 'Contanti' },
  { id: 'bonifico', label: 'Bonifico' },
  { id: 'altro', label: 'Altro' },
];
export const etichettaCausale = (id) => CAUSALI_PAGAMENTO.find(c => c.id === id)?.label || id;
export const etichettaMetodo = (id) => METODI_PAGAMENTO.find(m => m.id === id)?.label || id;

// La posizione di Lama o BFM verso Albatros: le spese che ha pagato per il centro, i rimborsi che
// ha ricevuto, quanto resta da rimborsargli, e gli altri pagamenti (stipendi e simili) a parte.
export function posizioneEnte(ente, spese, pagamenti) {
  const tot = (elenco) => r2(elenco.reduce((t, x) => t + num(x.importo), 0));
  const speseEnte = tot((spese || []).filter(s => s.ente === ente));
  const suoi = (pagamenti || []).filter(p => p.beneficiario === ente);
  const rimborsi = tot(suoi.filter(p => p.causale === 'rimborso'));
  const altri = tot(suoi.filter(p => p.causale !== 'rimborso'));
  return { spese: speseEnte, rimborsi, daRimborsare: r2(speseEnte - rimborsi), altri };
}

// I contanti di Albatros in mano: ritirati alle chiusure, meno le spese pagate da Albatros, meno i
// pagamenti che Albatros ha fatto in contanti.
export function contantiAlbatros(chiusure, spese, pagamenti) {
  const ritirati = r2((chiusure || []).filter(c => c.chiusa_il).reduce((t, c) => t + Math.max(quadratura(c, []).ritirato, 0), 0));
  const speseAlbatros = r2((spese || []).filter(s => s.ente === 'albatros').reduce((t, s) => t + num(s.importo), 0));
  const pagatiInContanti = r2((pagamenti || []).filter(p => p.pagante === 'albatros' && p.metodo === 'contanti').reduce((t, p) => t + num(p.importo), 0));
  return { ritirati, speseAlbatros, pagatiInContanti, inMano: r2(ritirati - speseAlbatros - pagatiInContanti) };
}

export const num = (n) => Number(n) || 0;
export const r2 = (n) => Math.round(num(n) * 100) / 100;
export const euro = (n) => `€${r2(n).toFixed(2)}`;

// Data locale "YYYY-MM-DD". Dopo mezzanotte e fino alle 5 la serata è ancora quella di ieri:
// chi chiude all'una non deve ricordarsi di cambiare la data.
export const isoDi = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const giornataDiLavoro = (adesso = new Date()) => {
  const d = new Date(adesso);
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  return isoDi(d);
};

// Date "YYYY-MM-DD" a mezzogiorno locale, così il cambio dell'ora legale non sposta il giorno.
const dataDi = (iso) => { const [a, m, g] = iso.split('-').map(Number); return new Date(a, m - 1, g, 12); };
export const aggiungiGiorni = (iso, n) => { const d = dataDi(iso); d.setDate(d.getDate() + n); return isoDi(d); };
// Il lunedì della settimana di una data: le settimane vanno da lunedì a domenica.
export const lunediDi = (iso) => aggiungiGiorni(iso, -((dataDi(iso).getDay() + 6) % 7));

// Il dettaglio di una spesa: le voci scritte dentro lo scontrino, che non ne superano il totale.
export function dettaglioSpesa(spesa, righe) {
  const totale = r2(spesa?.importo);
  const dettagliato = r2((righe || []).reduce((t, x) => t + num(x.importo), 0));
  return { totale, dettagliato, nonDettagliato: r2(totale - dettagliato), quota: totale > 0 ? Math.min(dettagliato / totale, 1) : 0 };
}
// Quanto di una spesa va a una categoria (null = senza categoria): le voci di quella categoria (una
// voce senza categoria prende quella della spesa) più, se la spesa è di quella categoria, la parte non
// dettagliata. Una spesa senza voci va tutta alla sua categoria.
export function importoInCategoria(spesa, voci, categoriaId) {
  const cat = categoriaId ?? null;
  const nelleVoci = r2((voci || []).filter(v => (v.categoria_id ?? spesa.categoria_id ?? null) === cat).reduce((t, v) => t + num(v.importo), 0));
  const resto = (spesa.categoria_id ?? null) === cat ? dettaglioSpesa(spesa, voci).nonDettagliato : 0;
  return r2(nelleVoci + Math.max(resto, 0));
}
// Si può aprire il dettaglio di una spesa solo se la sua categoria è dettagliabile (Configuratore).
// Prima di sql/albatros_categorie_dettagliabili.sql la colonna non c'è: allora lo sono tutte.
export const spesaDettagliabile = (spesa, categorie) => {
  const cat = (categorie || []).find(c => c.id === spesa?.categoria_id);
  return !!cat && (cat.dettagliabile ?? true);
};
export const rigaSpesaConsentita = (spesa, righe, importo) => r2(dettaglioSpesa(spesa, righe).dettagliato + num(importo)) <= r2(spesa?.importo);

// Il periodo dei filtri di Chiusure e Spese: si parte dal mese corrente.
export const periodoIniziale = () => { const oggi = giornataDiLavoro(); return { tipo: 'mese', mese: oggi.slice(0, 7), lunedi: lunediDi(oggi) }; };
// Primo e ultimo giorno del periodo, compresi.
export function intervalloPeriodo({ tipo, mese, lunedi }) {
  if (tipo === 'settimana') return [lunedi, aggiungiGiorni(lunedi, 6)];
  const [a, m] = mese.split('-').map(Number);
  return [`${mese}-01`, isoDi(new Date(a, m, 0))];
}

export const totaleRiga = (r) => r2(num(r.quantita) * num(r.prezzo));
export const sommaRighe = (righe) => r2((righe || []).reduce((s, r) => s + totaleRiga(r), 0));

// La quadratura di una giornata. chiusura.contanti sono i contanti INCASSATI, senza il fondo cassa:
// è così che i ragazzi contano, tenendo da parte il fondo. L'incassato è POS + contanti e si
// confronta col battuto. Il fondo resta in cassa da una sera all'altra e serve solo a sapere quanto
// c'è in cassa e quanto si ritira: in cassa ci sono contanti + fondo di partenza, si lascia
// fondo_lasciato, il resto lo ritirano i ragazzi: sono contanti di Albatros.
// Le spese non c'entrano: si registrano a parte, nella scheda Spese.
//   nonSpecificato > 0  parte dell'incassato non ancora spiegata dalle righe (normale)
//   nonSpecificato < 0  le righe superano l'incassato: qualcosa è contato due volte, o manca un incasso
export function quadratura(chiusura, righe) {
  const pos = r2(chiusura?.pos);
  const contanti = r2(chiusura?.contanti);
  const fondoPartenza = r2(chiusura?.fondo_partenza);
  const fondoLasciato = r2(chiusura?.fondo_lasciato);
  const contantiInCassa = r2(contanti + fondoPartenza);
  const ritirato = r2(contantiInCassa - fondoLasciato);
  const incassato = r2(pos + contanti);
  const specificato = sommaRighe(righe);
  const nonSpecificato = r2(incassato - specificato);
  const quota = incassato > 0 ? Math.min(specificato / incassato, 1) : (specificato > 0 ? 1 : 0);
  return { pos, contanti, fondoPartenza, contantiInCassa, fondoLasciato, ritirato, incassato, specificato, nonSpecificato, quota };
}

// Il fondo di partenza proposto: quello lasciato all'ultima chiusura prima di questa giornata.
// precedente = la chiusura più recente con data anteriore e un fondo lasciato; null se non c'è.
export const fondoProposto = (precedente) => (precedente?.fondo_lasciato == null ? null : r2(precedente.fondo_lasciato));

// Il fondo confermato non è quello lasciato la sera prima: tra una chiusura e l'altra dalla
// cassa sono usciti, o entrati, dei soldi. Senza una chiusura precedente non c'è niente da confrontare.
export const fondoDiverso = (chiusura, precedente) =>
  !!chiusura?.chiusa_il && precedente?.fondo_lasciato != null && chiusura.fondo_partenza != null
  && r2(chiusura.fondo_partenza) !== r2(precedente.fondo_lasciato);

// Una giornata chiusa a cui manca parte del dettaglio: c'è un residuo che le voci non spiegano.
// Le giornate aperte non contano: POS e contanti si scrivono solo alla chiusura.
export const daSpecificare = (chiusura, q) => !!chiusura?.chiusa_il && q.nonSpecificato > 0;

// Una giornata chiusa senza fondo cassa (di solito chiusa prima che il fondo esistesse): il fondo
// si può ancora scrivere, perché è riempire un campo vuoto. Uno già scritto si cambia riaprendo.
export const fondoDaSpecificare = (chiusura) =>
  !!chiusura?.chiusa_il && chiusura.fondo_partenza == null && chiusura.fondo_lasciato == null;

// Una giornata chiusa non si modifica, nemmeno dall'amministratore: prima la riapre.
export const chiusuraModificabile = (chiusura) => !chiusura?.chiusa_il;

// I ragazzi possono solo aggiungere: POS e contanti li scrivono finché sono vuoti, poi li cambia
// solo l'amministratore. A giornata chiusa non li tocca nessuno.
export const cassaScrivibile = (chiusura, valoreSalvato, puoCorreggere) =>
  chiusuraModificabile(chiusura) && (puoCorreggere || valoreSalvato == null);

// Finché la giornata è aperta la composizione si modifica liberamente. Chiusa, i ragazzi possono
// solo aggiungere; togliere righe resta all'amministratore.
export const composizioneCorreggibile = (chiusura, puoCorreggere) => puoCorreggere || chiusuraModificabile(chiusura);

// Su una giornata chiusa il totale è fissato da POS e contanti: le voci aggiunte spiegano il
// residuo, ma il battuto non può superare l'incassato.
export const aggiuntaConsentita = (chiusura, battuto, aggiunta) =>
  chiusuraModificabile(chiusura) || r2(num(battuto) + num(aggiunta)) <= quadratura(chiusura, []).incassato;

// Toccare una voce frequente aggiunge 1 alla riga uguale già presente (stessa voce, stesso
// prezzo) invece di accumulare righe da una unità.
export const rigaDaIncrementare = (righe, voce) =>
  (righe || []).find(r => r.voce_id === voce.id && r2(r.prezzo) === r2(voce.prezzo)) || null;

// Voci più usate, per i pulsanti rapidi: conta in quante righe compaiono, non le quantità, se no
// 300 caffè di un mese oscurano tutto il resto.
export function vociFrequenti(righe, listino, quante = 10) {
  const usi = new Map();
  (righe || []).forEach(r => usi.set(r.voce_id, (usi.get(r.voce_id) || 0) + 1));
  return (listino || [])
    .filter(v => v.attiva && usi.has(v.id))
    .sort((a, b) => usi.get(b.id) - usi.get(a.id) || a.nome.localeCompare(b.nome))
    .slice(0, quante);
}

const normalizza = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const voceDiNome = (listino, nome) => (listino || []).find(v => normalizza(v.nome) === normalizza(nome)) || null;
