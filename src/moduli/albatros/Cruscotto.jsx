import { useState } from 'react'
import { puoVedere } from '../../lib/permessi'
import Icona from '../../components/Icona'
import Incassi from './Incassi'
import CruscottoSpese from './CruscottoSpese'
import Configuratore from './Configuratore'
import Spese from './Spese'

// ============================================================
// Il Cruscotto di Albatros (era la scheda Incassi): gli incassi per categoria del listino, le
// spese per categoria (tutte: contanti, banca di Albatros, conto di BFM), l'elenco di tutte le
// spese per sistemarle da un posto solo, e il Configuratore delle categorie delle spese, che
// valgono anche per Cassa e Conti. Il selettore è quello dei moduli di BFM; chi vede quale vista
// lo dicono le sottoschede dei ruoli (scheda 'incassi', l'id di sempre).
// ============================================================

const VISTE = [
  { id: 'incassi', label: 'Incassi', icona: 'indicatori', permesso: 'cruscotto_incassi' },
  { id: 'spese', label: 'Spese', icona: 'spese', permesso: 'cruscotto_spese' },
  { id: 'elenco', label: 'Tutte le spese', icona: 'tabella', permesso: 'cruscotto_elenco' },
  { id: 'configuratore', label: 'Configuratore', icona: 'configuratore', permesso: 'cruscotto_configuratore' },
];

function Cruscotto(props) {
  const { user } = props;
  const viste = VISTE.filter(v => puoVedere(user, 'albatros', 'incassi', v.permesso));
  const [scelta, setScelta] = useState(null);
  const vista = (viste.find(v => v.id === scelta) || viste[0])?.id;
  if (!vista) return <p className="albatros-avviso">Nessuna vista del Cruscotto è abilitata per il tuo ruolo.</p>;
  return (
    <>
      {viste.length > 1 && (
        <nav className="modulo-subnav no-print subnav-segmented" style={{ marginBottom: '16px' }}>
          {viste.map(v => (
            <button key={v.id} type="button" className={`nav-btn ${vista === v.id ? 'active' : ''}`} onClick={() => setScelta(v.id)}><Icona nome={v.icona} />{v.label}</button>
          ))}
        </nav>
      )}
      {vista === 'incassi' && <Incassi {...props} />}
      {vista === 'spese' && <CruscottoSpese {...props} />}
      {vista === 'elenco' && <Spese key="tutte" {...props} modulo="tutte" />}
      {vista === 'configuratore' && <Configuratore {...props} solo="spesa" />}
    </>
  );
}

export default Cruscotto
