import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import Icona from '../../components/Icona'
import Giornata from './Giornata'
import StoricoChiusure from './StoricoChiusure'
import Spese from './Spese'
import Listino from './Listino'
import Configuratore from './Configuratore'
import { giornataDiLavoro } from './calcolo'

// ============================================================
// Albatros: la cassa del centro sportivo (due campi da calcetto e un bar).
// Nella Giornata si toccano le voci del listino e a fine serata si chiude la cassa; Chiusure è
// l'elenco delle giornate. Il listino nasce dalle voci scritte; le spese stanno a parte.
// L'amministratore corregge e riapre; i ragazzi aggiungono.
// ============================================================

const SCHEDE = [
  // La Giornata tiene l'id 'chiusure': è la chiave con cui i permessi dei ruoli sono già salvati.
  { id: 'chiusure', label: 'Giornata', icona: 'chiusure' },
  { id: 'storico', label: 'Chiusure', icona: 'storico' },
  { id: 'spese', label: 'Spese', icona: 'spese' },
  { id: 'listino', label: 'Listino', icona: 'listino' },
  { id: 'configuratore', label: 'Configuratore', icona: 'configuratore' },
];

function Albatros({ user }) {
  const [scheda, setScheda] = useState('chiusure');
  // La giornata aperta nella scheda Giornata: la sceglie anche l'elenco delle chiusure.
  const [giorno, setGiorno] = useState(giornataDiLavoro);
  const [listino, setListino] = useState([]);
  const [categorie, setCategorie] = useState([]);
  const [utenti, setUtenti] = useState({});
  // Finché sql/albatros.sql non è stato eseguito le tabelle non esistono: senza avviso la pagina
  // sembrerebbe solo vuota.
  const [schemaMancante, setSchemaMancante] = useState(null);
  const [categorieMancanti, setCategorieMancanti] = useState(null);

  const ricaricaListino = async () => {
    const { data, error } = await supabase.from('albatros_listino').select('*').order('nome');
    setSchemaMancante(error ? error.message : null);
    setListino(data || []);
    return data || [];
  };

  // Le categorie di listino e spese, decise dal Configuratore.
  const ricaricaCategorie = async () => {
    const { data, error } = await supabase.from('albatros_categorie').select('*').order('ordine').order('nome');
    setCategorieMancanti(error ? error.message : null);
    setCategorie(data || []);
  };

  useEffect(() => {
    ricaricaListino();
    ricaricaCategorie();
    supabase.from('utenti').select('id, nome, cognome, username').then(({ data }) => {
      const mappa = {};
      (data || []).forEach(u => { mappa[u.id] = [u.nome, u.cognome].filter(Boolean).join(' ') || u.username; });
      setUtenti(mappa);
    });
  }, []);

  const schedeVisibili = SCHEDE.filter(s => puoVedere(user, 'albatros', s.id));
  if (schedeVisibili.length === 0) return null;
  const attiva = (schedeVisibili.find(s => s.id === scheda) || schedeVisibili[0]).id;
  const puoCorreggere = !!user.isAdmin;
  const comuni = { user, listino, ricaricaListino, categorie, ricaricaCategorie, utenti, puoCorreggere };

  return (
    <>
      <nav className="modulo-subnav no-print subnav-segmented">
        {schedeVisibili.map(s => (
          <button key={s.id} className={`nav-btn ${attiva === s.id ? 'active' : ''}`} onClick={() => setScheda(s.id)}><Icona nome={s.icona} />{s.label}</button>
        ))}
      </nav>

      {schemaMancante && (
        <p className="albatros-avviso">
          Le tabelle di Albatros non esistono ancora: esegui <strong>sql/albatros.sql</strong> nell'SQL Editor di Supabase. ({schemaMancante})
        </p>
      )}

      {!schemaMancante && categorieMancanti && (
        <p className="albatros-avviso">
          Manca la tabella delle categorie: esegui <strong>sql/albatros_categorie.sql</strong> nell'SQL Editor di Supabase. ({categorieMancanti})
        </p>
      )}

      {!schemaMancante && !categorieMancanti && (
        <>
          {attiva === 'chiusure' && <Giornata {...comuni} data={giorno} setData={setGiorno} />}
          {attiva === 'storico' && <StoricoChiusure {...comuni} onApri={(d) => { setGiorno(d); setScheda('chiusure'); }} />}
          {attiva === 'spese' && <Spese {...comuni} />}
          {attiva === 'listino' && <Listino {...comuni} />}
          {attiva === 'configuratore' && <Configuratore {...comuni} />}
        </>
      )}
    </>
  );
}

export default Albatros
