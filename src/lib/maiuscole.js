// ============================================================
// Maiuscole e minuscole dei campi anagrafici: "MARIO ROSSI" e "mario rossi" diventano
// "Mario Rossi", "VIA DELLA REPUBBLICA 12/a" diventa "Via della Repubblica 12/A".
//
// Si tocca solo il testo scritto tutto in maiuscolo o tutto in minuscolo. Se maiuscole e
// minuscole sono già mescolate ("McDonald", "eBay", "Rossi S.r.l.") chi l'ha scritto ci ha
// pensato, e il testo resta com'è: un algoritmo non può indovinare quei nomi.
// Il maiuscolo che vuole il gestionale si applica all'export (fatturazione.js), non qui.
// Niente React e niente Supabase: funzioni pure, provate da maiuscole.prova.mjs.
// ============================================================

// Forme societarie e sigle di enti: sempre in maiuscolo e senza punti ("s.r.l." -> "SRL").
const FORME_SOCIETARIE = new Set(['srl', 'srls', 'spa', 'snc', 'sas', 'sapa', 'scarl', 'scrl', 'ss', 'asd', 'aps', 'ssd', 'onlus', 'odv', 'ets', 'apd']);

// Preposizioni e congiunzioni che negli indirizzi e nei nomi di luogo restano minuscole,
// salvo quando aprono il testo ("Della Valle" no, "Via della Valle" sì).
const PAROLE_MINUSCOLE = new Set([
  'di', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'd', 'dell',
  'da', 'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle', 'dall',
  'a', 'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'all',
  'in', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'nell',
  'su', 'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle', 'sull',
  'e', 'ed', 'per', 'con', 'tra', 'fra',
]);

// Sigle che negli indirizzi restano maiuscole: senza numero civico, strade statali/provinciali/regionali.
const SIGLE_INDIRIZZO = new Set(['snc', 'ss', 'sp', 'sr']);

// Numeri romani delle vie ("Via XX Settembre", "Piazza IV Novembre"), solo con I, V, X, L.
const ROMANO = /^(?=[ivxl])l?x{0,3}(ix|iv|v?i{0,3})$/;

const pulito = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

// Vero se il testo ha lettere ed è tutto maiuscolo o tutto minuscolo: solo allora si interviene.
// I civici non contano: "VIA ROMA 12/a" è comunque tutto maiuscolo.
export const daSistemare = (testo) => {
  const t = String(testo ?? '').split(/\s+/).filter(p => !/\d/.test(p)).join(' ');
  if (t.toUpperCase() === t.toLowerCase()) return false; // niente lettere
  return t === t.toUpperCase() || t === t.toLowerCase();
};

const capitale = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Una parola già in minuscolo, divisa su trattini e apostrofi: "d'angelo-rossi" ha tre pezzi.
// `inizio` dice se la parola apre il testo; `luogo` attiva le regole di indirizzi e località;
// `precedente` è la parola prima, per riconoscere la lettera di un civico staccata ("22 a").
const parola = (p, inizio, luogo, precedente = '') => {
  const nuda = p.replace(/\./g, '');
  if (FORME_SOCIETARIE.has(nuda) && (p === nuda || /^([a-z]\.)+[a-z]?\.?$/.test(p))) return nuda.toUpperCase();
  if (/\d/.test(p)) return p.toUpperCase(); // civici e simili: "12/a" -> "12/A"
  if (luogo && /^[a-z]$/.test(p) && /^\d+$/.test(precedente)) return p.toUpperCase();
  if (luogo && SIGLE_INDIRIZZO.has(p)) return p.toUpperCase();
  // Fra due nomi la congiunzione resta minuscola: "Rossi Mario e Bianchi Anna".
  if (!inizio && (p === 'e' || p === 'ed')) return p;
  if (luogo && !inizio && ROMANO.test(p) && !PAROLE_MINUSCOLE.has(p)) return p.toUpperCase();
  return p.split(/([-'’])/).map((pezzo, i, pezzi) => {
    if (pezzo === '-' || pezzo === "'" || pezzo === '’' || !pezzo) return pezzo;
    // "dell'orto" negli indirizzi: l'articolo davanti all'apostrofo resta minuscolo.
    const primo = inizio && i === 0;
    const davantiAdApostrofo = pezzi[i + 1] === "'" || pezzi[i + 1] === '’';
    if (luogo && !primo && i === 0 && PAROLE_MINUSCOLE.has(pezzo) && (davantiAdApostrofo || pezzi.length === 1)) return pezzo;
    return capitale(pezzo);
  }).join('');
};

// Un campo mai compilato (null) resta null: si sistema il testo, non si inventano valori.
const sistema = (valore, luogo) => {
  if (valore == null) return valore;
  const testo = pulito(valore);
  if (!daSistemare(testo)) return testo;
  return testo.toLowerCase().split(' ').map((p, i, parole) => parola(p, i === 0, luogo, parole[i - 1])).join(' ');
};

// Persone: nominativo, nome, cognome, referente, chi ha pagato. "luigi di maio" -> "Luigi Di Maio".
export const formaNome = (valore) => sistema(valore, false);

// Indirizzi e città: preposizioni minuscole, civici e numeri romani maiuscoli.
export const formaLuogo = (valore) => sistema(valore, true);

// Ragioni sociali e nomi di strutture: come i luoghi ("Oratorio San Luigi", "Rossi e Figli SRL").
export const formaRagioneSociale = (valore) => sistema(valore, true);

// Email in minuscolo e senza spazi, né i residui di un copia-incolla: "<mario@email.it>", "mailto:".
export const formaEmail = (valore) => valore == null ? valore
  : pulito(valore).replace(/\s/g, '').toLowerCase().replace(/^mailto:/, '').replace(/^[<"'(]+|[>"'),;.]+$/g, '');

// Codice fiscale, partita IVA, codice SDI: maiuscolo e senza spazi ("rss mra 80a01 f205x").
export const formaCodice = (valore) => valore == null ? valore : String(valore).replace(/\s/g, '').toUpperCase();

// Telefono senza spazi, punti, trattini, barre e parentesi: "+39 333.123-4567" -> "+393331234567".
// Il resto (una nota come "ufficio") resta: meglio un numero strano che un'informazione persa.
export const formaTelefono = (valore) => valore == null ? valore : String(valore).replace(/[\s.\-/()]/g, '');
