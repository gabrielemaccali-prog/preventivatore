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
// Chi ritira i contanti a fine serata: il fondo cassa invece resta ad Albatros.
export const ENTI_RITIRO = ENTI.filter(e => e.id !== 'albatros');

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

// La quadratura di una giornata. In cassa resta un fondo da una sera all'altra: chiusura.contanti
// sono TUTTI i contanti contati, e l'incasso in contanti è quello che c'è in più rispetto al fondo
// con cui si è partiti. Il fondo non è incasso, quindi non entra nell'incassato né nella quota.
// Quello che non si lascia in cassa per domani lo ritira Lama o BFM (chiusura.ritirato_da).
// Le spese non c'entrano: si registrano a parte, nella scheda Spese.
//   nonSpecificato > 0  parte dell'incassato non ancora spiegata dalle righe (normale)
//   nonSpecificato < 0  le righe superano l'incassato: qualcosa è contato due volte, o manca un incasso
export function quadratura(chiusura, righe) {
  const pos = r2(chiusura?.pos);
  const contantiContati = r2(chiusura?.contanti);
  const fondoPartenza = r2(chiusura?.fondo_partenza);
  const fondoLasciato = r2(chiusura?.fondo_lasciato);
  const contanti = r2(contantiContati - fondoPartenza);
  const ritirato = r2(contantiContati - fondoLasciato);
  const incassato = r2(pos + contanti);
  const specificato = sommaRighe(righe);
  const nonSpecificato = r2(incassato - specificato);
  const quota = incassato > 0 ? Math.min(specificato / incassato, 1) : (specificato > 0 ? 1 : 0);
  return { pos, contantiContati, fondoPartenza, contanti, fondoLasciato, ritirato, incassato, specificato, nonSpecificato, quota };
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

// Su una giornata chiusa il totale è fissato da POS e contanti (meno il fondo di partenza): le
// voci aggiunte spiegano il residuo, ma il battuto non può superare l'incassato.
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
