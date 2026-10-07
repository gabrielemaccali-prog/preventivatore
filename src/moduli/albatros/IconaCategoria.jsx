import { IconTag } from '@tabler/icons-react'
import { ICONE_CATEGORIA } from './iconeCategoria'

// Il bollino di una categoria. Senza icona scelta (o senza categoria) un'etichetta grigia neutra.
function IconaCategoria({ categoria, size = 16, titolo = true }) {
  const scelta = ICONE_CATEGORIA[categoria?.icona];
  const Componente = scelta?.componente || IconTag;
  const lato = size + 10;
  return (
    <span className="albatros-icona-categoria" title={titolo ? (categoria?.nome || 'Senza categoria') : undefined}
      style={{ width: lato, height: lato, color: scelta?.colore || '#64748b', background: scelta?.sfondo || '#f1f5f9' }}>
      <Componente size={size} stroke={1.9} />
    </span>
  );
}

export default IconaCategoria
