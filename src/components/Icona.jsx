import {
  IconCalculator, IconTicket, IconCalendarEvent, IconReportMoney, IconUserCheck, IconSettings,
  IconShoppingCart, IconHistory, IconMapPin, IconBalloon, IconAdjustments, IconPackage,
  IconCalendarPlus, IconBell, IconCalendar, IconClipboardList, IconClock, IconCurrencyEuro,
  IconDeviceGamepad2, IconPuzzle, IconUser, IconUsers, IconTable, IconChartLine, IconCircleCheck,
  IconChartBar, IconShield, IconApps, IconCircle, IconPower,
  IconEdit, IconTrash, IconPlus, IconCheck, IconX, IconFolderOpen, IconArrowBackUp,
  IconPrinter, IconGift, IconLayoutList, IconListCheck, IconCoins, IconFileInvoice, IconChecklist
} from '@tabler/icons-react';

// Registro centrale: nome semantico -> componente icona. Un solo punto da aggiornare per cambiare set di icone.
const REGISTRO_ICONE = {
  preventivatore: IconCalculator,
  voucher: IconTicket,
  prenotazioni: IconCalendarEvent,
  costiricavi: IconReportMoney,
  disponibilita: IconUserCheck,
  compensi: IconCoins,
  impostazioni: IconSettings,

  configuratore: IconSettings,
  vendita: IconShoppingCart,
  storico: IconHistory,
  sedi: IconMapPin,
  gonfiabili: IconBalloon,
  extra: IconAdjustments,
  pacchetti: IconPackage,
  campi: IconMapPin,
  nuovaPrenotazione: IconCalendarPlus,
  gestione: IconBell,
  evasi: IconCircleCheck,
  rimborsi: IconCurrencyEuro,
  calendario: IconCalendar,
  riepiloghi: IconClipboardList,
  attesaPagamento: IconClock,
  daConfermare: IconCurrencyEuro,
  partiteAttive: IconDeviceGamepad2,
  daCompletare: IconPuzzle,
  perOperatore: IconUser,
  perCampo: IconMapPin,
  tabella: IconTable,
  andamento: IconChartLine,
  completate: IconCircleCheck,
  riepilogo: IconChartBar,
  miedisp: IconListCheck,
  daconsuntivare: IconChecklist,
  consuntivati: IconFileInvoice,
  rimborso: IconCurrencyEuro,
  indicatori: IconChartBar,
  utenti: IconUsers,
  ruoli: IconShield,
  moduli: IconApps,
  nuovoVoucher: IconTicket,
  logout: IconPower,

  modifica: IconEdit,
  elimina: IconTrash,
  nuovo: IconPlus,
  salva: IconCheck,
  annulla: IconX,
  apri: IconFolderOpen,
  riporta: IconArrowBackUp,
  stampa: IconPrinter,
  offerta: IconGift,
  opzioni: IconLayoutList,
};

// Icona coerente per moduli e schede, in sostituzione delle emoji. `nome` è una chiave di REGISTRO_ICONE.
function Icona({ nome, size = 17, style, ...rest }) {
  const Componente = REGISTRO_ICONE[nome] || IconCircle;
  return <Componente size={size} stroke={1.9} style={{ verticalAlign: '-3px', marginRight: '6px', ...style }} {...rest} />;
}

export default Icona;
