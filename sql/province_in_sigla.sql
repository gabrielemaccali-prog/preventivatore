-- ============================================================
-- Province già registrate: dal nome per esteso alla sigla
-- Facoltativo, da eseguire nell'SQL Editor di Supabase.
-- ============================================================

-- L'app ora scrive sempre la sigla e converte al volo quello che legge, quindi elenchi ed export
-- sono già corretti anche senza questo script: serve solo a mettere in riga i dati salvati prima,
-- che altrimenti restano col nome per esteso finché la prenotazione (o il campo) non viene risalvata.
-- I valori elencati sono quelli effettivamente presenti al 07/09/2026; aggiungere le coppie
-- mancanti se in futuro ne comparissero altre.

update prenotazioni set "fattProvincia" = case "fattProvincia"
    when 'Verbano-Cusio-Ossola' then 'VB' when 'Cuneo' then 'CN' when 'Bergamo' then 'BG'
    when 'Milano' then 'MI' when 'Torino' then 'TO' when 'Lodi' then 'LO' when 'Pavia' then 'PV'
    else "fattProvincia" end
 where length(coalesce("fattProvincia", '')) > 2;

update prenotazioni set "aziProvincia" = case "aziProvincia"
    when 'Verbano-Cusio-Ossola' then 'VB' when 'Cuneo' then 'CN' when 'Bergamo' then 'BG'
    when 'Milano' then 'MI' when 'Torino' then 'TO' when 'Lodi' then 'LO' when 'Pavia' then 'PV'
    else "aziProvincia" end
 where length(coalesce("aziProvincia", '')) > 2;

update prenotazioni set "locationProvincia" = case "locationProvincia"
    when 'Verbano-Cusio-Ossola' then 'VB' when 'Cuneo' then 'CN' when 'Bergamo' then 'BG'
    when 'Milano' then 'MI' when 'Torino' then 'TO' when 'Lodi' then 'LO' when 'Pavia' then 'PV'
    else "locationProvincia" end
 where length(coalesce("locationProvincia", '')) > 2;

update pren_campi set provincia = case provincia
    when 'Verbano-Cusio-Ossola' then 'VB' when 'Cuneo' then 'CN' when 'Bergamo' then 'BG'
    when 'Milano' then 'MI' when 'Torino' then 'TO' when 'Lodi' then 'LO' when 'Pavia' then 'PV'
    else provincia end
 where length(coalesce(provincia, '')) > 2;

-- Controllo finale: deve tornare zero righe.
-- select 'prenotazioni' as tabella, "fattProvincia" as valore from prenotazioni where length(coalesce("fattProvincia",'')) > 2
-- union select 'prenotazioni', "aziProvincia" from prenotazioni where length(coalesce("aziProvincia",'')) > 2
-- union select 'prenotazioni', "locationProvincia" from prenotazioni where length(coalesce("locationProvincia",'')) > 2
-- union select 'pren_campi', provincia from pren_campi where length(coalesce(provincia,'')) > 2;
