// ============================================================
// Refusi nel dominio delle email: "mario@gmial.com" -> "Intendevi mario@gmail.com?".
//
// È un suggerimento, non un blocco: un dominio che non conosciamo può essere giustissimo
// (l'azienda del cliente), e chi inserisce decide. Si propone una correzione solo quando il
// dominio è a un passo da uno dei provider più usati, o quando sbaglia il finale (".con").
// Niente React e niente Supabase: funzioni pure, provate da email.prova.mjs.
// ============================================================

// Provider comuni in Italia. Quelli corti (tin.it, tim.it, me.com...) si accettano ma non si
// usano come correzione: "fin.it" è un dominio vero, non un refuso di "tin.it".
const DOMINI_NOTI = [
  'gmail.com', 'googlemail.com', 'hotmail.it', 'hotmail.com', 'outlook.it', 'outlook.com',
  'live.it', 'live.com', 'msn.com', 'yahoo.it', 'yahoo.com', 'icloud.com', 'me.com',
  'libero.it', 'virgilio.it', 'alice.it', 'tim.it', 'tin.it', 'tiscali.it', 'fastwebnet.it',
  'email.it', 'inwind.it', 'iol.it', 'katamail.com', 'pec.it', 'legalmail.it',
  // Provider veri che somigliano a quelli sopra: senza, "mail.com" passerebbe per un refuso di gmail.
  'email.com', 'mail.com', 'gmx.com', 'gmx.it', 'gmx.de', 'gmx.net', 'aol.com', 'protonmail.com', 'proton.me',
  'hotmail.fr', 'hotmail.de', 'hotmail.es', 'hotmail.co.uk', 'outlook.fr', 'outlook.de', 'outlook.es',
  'live.fr', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.co.uk', 'web.de', 'orange.fr', 'free.fr',
];
const DOMINI_CORREGGIBILI = DOMINI_NOTI.filter(d => d.length >= 8);

// Refusi che la distanza da sola non risolve bene: gmail.it esiste come nome ma non come casella.
const DOMINI_SBAGLIATI = { 'gmail.it': 'gmail.com', 'hotmail.ti': 'hotmail.it', 'gmail.co': 'gmail.com' };

// Finali sbagliati su domini qualsiasi: "azienda.con" -> "azienda.com".
const FINALI_SBAGLIATI = {
  con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', comm: 'com', cm: 'com', om: 'com',
  ti: 'it', iy: 'it', ot: 'it', itt: 'it', ut: 'it',
  ner: 'net', nte: 'net', met: 'net',
};

// Quante modifiche (lettera tolta, aggiunta, cambiata o due lettere scambiate) separano a da b.
const distanza = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
};

// L'email corretta da proporre, oppure null se non c'è nulla da dire.
export const suggerimentoEmail = (valore) => {
  const email = String(valore ?? '').trim().toLowerCase();
  const m = email.match(/^([^\s@]+)@([^\s@]+\.[^\s@.]+)$/);
  if (!m) return null;
  const [, utente, dominio] = m;
  if (DOMINI_NOTI.includes(dominio)) return null;
  if (DOMINI_SBAGLIATI[dominio]) return `${utente}@${DOMINI_SBAGLIATI[dominio]}`;

  let migliore = null, minima = Infinity;
  for (const noto of DOMINI_CORREGGIBILI) {
    const dist = distanza(dominio, noto);
    if (dist < minima) { minima = dist; migliore = noto; }
  }
  if (minima <= 2) return `${utente}@${migliore}`;

  const punto = dominio.lastIndexOf('.');
  const finale = dominio.slice(punto + 1);
  if (FINALI_SBAGLIATI[finale]) return `${utente}@${dominio.slice(0, punto)}.${FINALI_SBAGLIATI[finale]}`;
  return null;
};
