import {
  IconBallFootball, IconConfetti, IconBalloon, IconCake, IconCoffee, IconBeer, IconGlassFull,
  IconIceCream, IconToolsKitchen2, IconBottle, IconTicket,
} from '@tabler/icons-react'

// Le icone fra cui scegliere quella di una categoria del listino, ognuna col suo colore: servono a
// riconoscere a colpo d'occhio campi, feste e bar nella griglia, nel battuto e nel listino.
// La chiave è quella salvata in albatros_categorie.icona.
export const ICONE_CATEGORIA = {
  pallone: { componente: IconBallFootball, colore: '#15803d', sfondo: '#dcfce7', nome: 'Pallone' },
  festa: { componente: IconConfetti, colore: '#c026d3', sfondo: '#fae8ff', nome: 'Festa' },
  palloncino: { componente: IconBalloon, colore: '#db2777', sfondo: '#fce7f3', nome: 'Palloncino' },
  torta: { componente: IconCake, colore: '#e11d48', sfondo: '#ffe4e6', nome: 'Torta' },
  bar: { componente: IconCoffee, colore: '#b45309', sfondo: '#fef3c7', nome: 'Caffè' },
  birra: { componente: IconBeer, colore: '#ca8a04', sfondo: '#fef9c3', nome: 'Birra' },
  bicchiere: { componente: IconGlassFull, colore: '#0284c7', sfondo: '#e0f2fe', nome: 'Bicchiere' },
  bibita: { componente: IconBottle, colore: '#0891b2', sfondo: '#cffafe', nome: 'Bibita' },
  gelato: { componente: IconIceCream, colore: '#7c3aed', sfondo: '#ede9fe', nome: 'Gelato' },
  cibo: { componente: IconToolsKitchen2, colore: '#ea580c', sfondo: '#ffedd5', nome: 'Cibo' },
  biglietto: { componente: IconTicket, colore: '#4f46e5', sfondo: '#e0e7ff', nome: 'Biglietto' },
};
