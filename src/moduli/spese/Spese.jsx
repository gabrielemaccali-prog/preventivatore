import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import { preparaControparti } from '../../lib/banca'
import Icona from '../../components/Icona'
import { caricaTutto } from './operazioni'
import ElencoSpese from './ElencoSpese'
import Banca from './Banca'
import Regole from './Regole'
import Configuratore from './Configuratore'

// ============================================================
// Spese. Si scrivono a mano o nascono dall'estratto conto, che si carica in cima alla scheda Spese quante
// volte si vuole (le righe già viste si saltano). Ogni spesa si classifica in tre passi:
//   1. di chi è: BFM o Albatros (quelle di Albatros compaiono anche fra le sue spese, pagate da BFM);
//   2. per BFM, se è operativa -- un costo che un altro modulo già conosce: compensi dei bubbler,
//      affitti dei campi, fornitori; andrà riconciliato -- o generale;
//   3. per le generali, la categoria: un albero a due livelli deciso dal Configuratore.
// Finché manca un passo la spesa è "da completare". Le regole classificano da sole i movimenti
// ricorrenti; i costi dei bonifici si sommano alla spesa del bonifico come oneri bancari.
// ============================================================

const SCHEDE = [
  { id: 'spese', label: 'Spese', icona: 'spese' },
  { id: 'banca', label: 'Banca', icona: 'banca' },
  { id: 'regole', label: 'Regole', icona: 'regole' },
  { id: 'configuratore', label: 'Configuratore', icona: 'configuratore' },
];

// padre_id si chiede per nome: se sql/spese_classificazione.sql non è stato eseguito la lettura
// fallisce, e la pagina lo dice invece di lavorare col modello vecchio.
const leggiConfigurazione = () => Promise.all([
  supabase.from('spese_categorie').select('id, nome, ordine, attiva, padre_id').order('ordine').order('nome'),
  // controparte_id si chiede per nome per lo stesso motivo: arriva con sql/spese_regole_controparte.sql.
  supabase.from('spese_regole').select('*, controparte_id').order('ordine').order('id'),
  supabase.from('albatros_categorie').select('id, nome, ordine, attiva').eq('tipo', 'spesa').order('ordine').order('nome'),
]);
const leggiAnagrafiche = () => Promise.all([
  // Tutti i bubbler, anche i disattivi: servono a dare un nome alle spese che hanno già. Nelle
  // tendine si propongono solo gli attivi (vedi Classificazione).
  supabase.from('utenti').select('*').eq('bubbler', true),
  supabase.from('pren_campi').select('id, nome, nomeCompleto').order('nome'),
  supabase.from('sedi').select('id, nome, bfm').order('nome'),
]);

function Spese({ user }) {
  const [scheda, setScheda] = useState('spese');
  const [categorie, setCategorie] = useState([]);
  const [regole, setRegole] = useState([]);
  const [categorieAlbatros, setCategorieAlbatros] = useState([]);
  const [anagrafiche, setAnagrafiche] = useState({});
  const [spese, setSpese] = useState([]);
  const [movimenti, setMovimenti] = useState([]);
  const [caricamenti, setCaricamenti] = useState([]);
  // Finché gli script SQL non sono stati eseguiti le tabelle (o le colonne) non esistono: senza
  // avviso la pagina sembrerebbe solo vuota.
  const [schemaMancante, setSchemaMancante] = useState(null);

  // Le letture restituiscono i dati e chi le chiama li mette nello stato: così si usano uguali al
  // primo caricamento e dopo ogni scrittura.
  const applicaConfigurazione = ([cat, reg, alb]) => {
    setSchemaMancante(cat.error?.message || reg.error?.message || null);
    setCategorie(cat.data || []);
    setRegole(reg.data || []);
    setCategorieAlbatros(alb.data || []);
  };
  const applicaDati = ({ spese: s, movimenti: m, caricamenti: c }) => {
    setSpese(s.data || []);
    setMovimenti(m.data || []);
    setCaricamenti(c.data || []);
  };
  const ricaricaConfigurazione = () => leggiConfigurazione().then(applicaConfigurazione);
  const ricaricaDati = () => caricaTutto().then(applicaDati);

  useEffect(() => {
    leggiConfigurazione().then(applicaConfigurazione);
    caricaTutto().then(applicaDati);
    leggiAnagrafiche().then(([b, c, s]) => setAnagrafiche({ bubbler: b.data || [], campi: c.data || [], sedi: s.data || [] }));
  }, []);

  // Bubbler, campi e fornitori: a chi può andare una spesa operativa.
  const controparti = useMemo(() => preparaControparti(anagrafiche), [anagrafiche]);

  const schedeVisibili = SCHEDE.filter(s => puoVedere(user, 'spese', s.id));
  if (schedeVisibili.length === 0) return null;
  const attiva = (schedeVisibili.find(s => s.id === scheda) || schedeVisibili[0]).id;
  const comuni = {
    user, categorie, regole, categorieAlbatros, controparti, spese, movimenti, caricamenti,
    ricaricaConfigurazione, ricaricaDati, vaiA: setScheda,
  };

  return (
    <>
      <nav className="modulo-subnav no-print subnav-segmented">
        {schedeVisibili.map(s => (
          <button key={s.id} className={`nav-btn ${attiva === s.id ? 'active' : ''}`} onClick={() => setScheda(s.id)}><Icona nome={s.icona} />{s.label}</button>
        ))}
      </nav>

      {schemaMancante && (
        <p className="albatros-avviso" style={{ margin: '0 20px' }}>
          Le tabelle delle spese non sono aggiornate: esegui <strong>sql/spese_banca.sql</strong>, <strong>sql/spese_classificazione.sql</strong> e <strong>sql/spese_regole_controparte.sql</strong> nell'SQL Editor di Supabase. ({schemaMancante})
        </p>
      )}

      {!schemaMancante && (
        <>
          {attiva === 'spese' && <ElencoSpese {...comuni} />}
          {attiva === 'banca' && <Banca {...comuni} />}
          {attiva === 'regole' && <Regole {...comuni} />}
          {attiva === 'configuratore' && <Configuratore {...comuni} />}
        </>
      )}
    </>
  );
}

export default Spese
