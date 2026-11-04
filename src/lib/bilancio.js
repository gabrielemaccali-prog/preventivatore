// ============================================================
// Bilancio di cassa: quello che è passato dal conto, classificato come spese e incassi.
//
// Si parte dai movimenti della banca, non dai documenti: ogni accredito e ogni addebito (non
// ignorato) finisce in una riga sola, quindi il risultato finale è la variazione del saldo. Se non lo
// è, qualcosa non è classificato, e lo dice la riga "Da classificare".
//
//   ricavi operativi   accrediti abbinati ai pagamenti di prenotazioni e voucher
//   costi operativi    spese operative: compensi dei bubbler, affitti dei campi, fornitori
//   = risultato operativo
//   altri ricavi       accrediti generali, per categoria degli incassi
//   costi di struttura spese generali della categoria Struttura
//   = risultato dopo la struttura
//   altri costi        tutte le altre spese generali, e quelle di Albatros pagate da BFM
//   = risultato finale
//
// Ogni voce è { nome, importo, figli }: gli importi sono sempre positivi, il segno lo dà la sezione.
// Una commissione bancaria va con la spesa a cui è agganciata, come nelle spese.
// Il capitale versato dai soci non è un ricavo: resta fuori, e si conta a parte come gli ignorati,
// così il controllo con la variazione del saldo torna lo stesso.
// Niente React e niente Supabase: funzioni pure, come banca.js.
// ============================================================

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// La categoria delle spese che fa da costi di struttura, per nome: è quella di primo livello che si
// chiama così. Le altre vanno fra gli altri costi.
export const CATEGORIA_STRUTTURA = /^struttura$/i;
// La categoria degli incassi che è capitale e non ricavo, per nome, con tutte le sue sottocategorie.
export const CATEGORIA_CAPITALE = /^capitale/i;

const NOMI_OPERATIVE = { bubbler: 'Compensi bubbler', campo: 'Affitto campi', fornitore: 'Fornitori' };

// Una voce con i suoi figli, sommati per nome lungo un percorso ("Struttura" › "Banca").
const nuovaVoce = (nome) => ({ nome, importo: 0, figli: [] });
const aggiungi = (voce, percorso, importo) => {
  voce.importo = r2(voce.importo + importo);
  if (percorso.length === 0) return;
  const [primo, ...resto] = percorso;
  let figlio = voce.figli.find(f => f.nome === primo);
  if (!figlio) { figlio = nuovaVoce(primo); voce.figli.push(figlio); }
  aggiungi(figlio, resto, importo);
};
// I figli in ordine di importo, dal più grande: è quello che si cerca aprendo una voce.
const ordina = (voce) => {
  voce.figli.sort((a, b) => b.importo - a.importo || a.nome.localeCompare(b.nome, 'it'));
  voce.figli.forEach(ordina);
  return voce;
};

// Il percorso di una categoria a due livelli: [categoria, sottocategoria] oppure [categoria].
const percorsoDi = (categorie, id) => {
  const c = (categorie || []).find(x => x.id === id);
  if (!c) return ['Senza categoria'];
  const padre = c.padre_id != null ? (categorie || []).find(x => x.id === c.padre_id) : null;
  return padre ? [padre.nome, c.nome] : [c.nome];
};

//   movimenti         banca_movimenti
//   spese             spese (con movimento_id, ente, natura, operativa, controparte_id, categoria_id)
//   pagamenti         i pagamenti abbinati agli accrediti (tipo, movimento_id)
//   categorieSpese, categorieIncassi, categorieAlbatros
//   nomeControparte(tipo, id)   il nome di un bubbler, campo o fornitore
//   dal, al           l'intervallo, sulle date contabili (vuoti: tutto)
export function costruisciBilancio({
  movimenti = [], spese = [], pagamenti = [], categorieSpese = [], categorieIncassi = [], categorieAlbatros = [],
  nomeControparte = () => null, dal = '', al = '',
}) {
  const nel = (m) => (!dal || m.data_contabile >= dal) && (!al || m.data_contabile <= al);
  const spesaDelMovimento = new Map(spese.filter(s => s.movimento_id != null).map(s => [s.movimento_id, s]));
  const spesaPerId = new Map(spese.map(s => [s.id, s]));
  const tipoDiIncasso = new Map();
  pagamenti.filter(p => p.movimento_id != null).forEach(p => { if (!tipoDiIncasso.has(p.movimento_id)) tipoDiIncasso.set(p.movimento_id, p.tipo); });

  const v = {
    ricaviOperativi: nuovaVoce('Ricavi operativi'),
    costiOperativi: nuovaVoce('Costi operativi'),
    altriRicavi: nuovaVoce('Altri ricavi'),
    costiStruttura: nuovaVoce('Costi di struttura'),
    altriCosti: nuovaVoce('Altri costi'),
    entrateDaClassificare: nuovaVoce('Entrate da classificare'),
    usciteDaClassificare: nuovaVoce('Uscite da classificare'),
  };
  let variazione = 0;
  let ignorati = 0;
  let capitale = 0;

  movimenti.filter(nel).forEach(m => {
    const importo = Number(m.importo) || 0;
    if (m.ignorato) { ignorati = r2(ignorati + importo); return; }
    variazione = r2(variazione + importo);
    if (importo > 0) {
      const tipo = tipoDiIncasso.get(m.id);
      if (tipo) return aggiungi(v.ricaviOperativi, [tipo === 'voucher' ? 'Voucher' : 'Prenotazioni'], importo);
      if (m.incasso_categoria_id != null) {
        const percorso = percorsoDi(categorieIncassi, m.incasso_categoria_id);
        if (CATEGORIA_CAPITALE.test(percorso[0])) { capitale = r2(capitale + importo); return; }
        return aggiungi(v.altriRicavi, percorso, importo);
      }
      return aggiungi(v.entrateDaClassificare, [], importo);
    }
    const uscita = -importo;
    const s = spesaDelMovimento.get(m.id) || (m.onere_spesa_id != null ? spesaPerId.get(m.onere_spesa_id) : null);
    if (!s) return aggiungi(v.usciteDaClassificare, [], uscita);
    if (s.ente === 'albatros') {
      return aggiungi(v.altriCosti, ['Spese di Albatros', ...(s.albatros_categoria_id != null ? percorsoDi(categorieAlbatros, s.albatros_categoria_id) : [])], uscita);
    }
    if (s.natura === 'operativa' && s.operativa) {
      const chi = s.controparte_id != null ? (nomeControparte(s.operativa, s.controparte_id) || 'Senza nome') : 'Senza controparte';
      return aggiungi(v.costiOperativi, [NOMI_OPERATIVE[s.operativa] || s.operativa, chi], uscita);
    }
    if (s.natura === 'generale' && s.categoria_id != null) {
      const percorso = percorsoDi(categorieSpese, s.categoria_id);
      return CATEGORIA_STRUTTURA.test(percorso[0])
        ? aggiungi(v.costiStruttura, percorso.slice(1), uscita)
        : aggiungi(v.altriCosti, percorso, uscita);
    }
    return aggiungi(v.usciteDaClassificare, [], uscita);
  });

  Object.values(v).forEach(ordina);
  const risultatoOperativo = r2(v.ricaviOperativi.importo - v.costiOperativi.importo);
  const risultatoStruttura = r2(risultatoOperativo + v.altriRicavi.importo - v.costiStruttura.importo);
  const risultatoFinale = r2(risultatoStruttura - v.altriCosti.importo + v.entrateDaClassificare.importo - v.usciteDaClassificare.importo);
  return { ...v, risultatoOperativo, risultatoStruttura, risultatoFinale, variazione, ignorati, capitale };
}
