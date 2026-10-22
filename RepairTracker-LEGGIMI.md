# Repair Tracker nel Portale (20/10/2026)

Rifacimento di `davidefriscia/repair-tracker` (Angular + PHP + MySQL su XAMPP) come pagina del Portale: un HTML, un JS, un CSS, più l'API `.ashx` e un database SQL Server tutto suo (`RepairTracker`). Login e ruoli sono quelli del Portale (niente login né pagina utenti propri).

## File

| File | Dove va nel Portale |
|---|---|
| `RepairTracker.html` | radice |
| `CSS/RepairTracker/RepairTracker.css` | `CSS/RepairTracker/` |
| `JS/RepairTracker/RepairTracker.js` | `JS/RepairTracker/` |
| `API/RepairTracker.ashx` | `API/` |
| `SQL/RepairTracker_01_database.sql` | solo SSMS, una volta |
| `Portale.html`, `JS/Portal/Portal.js` | sostituiscono i vecchi: tile "Riparazioni" al posto di un "Prossimamente" |

## Dati

Due database separati:
- **`RepairTracker`** (nuovo, tutto suo): `dbo.Riparazioni` (una riga per pratica) e `dbo.RiparazioniLog` (storico: chi, cosa, quando, mostrato in fondo al dettaglio). Colonne con gli stessi nomi della vecchia app (attenzione: `codice_componente` è la "Descrizione breve").
- **`PortaleLogin`**: resta solo utenti e ruoli. Ci si aggiungono soltanto i 5 ruoli del Repair Tracker.

`SQL/RepairTracker_01_database.sql` crea il database e le tabelle, aggiunge i ruoli in PortaleLogin e dà a `ToolUser` lettura e scrittura su RepairTracker (db_datareader + db_datawriter). Va eseguito con un utente che può creare database.

Nel Web.config, in `<connectionStrings>`, serve una seconda stringa `RepairTracker` (uguale a quella di PortaleLogin, cambia solo `Initial Catalog`). Sul server:

```xml
<add name="RepairTracker" providerName="System.Data.SqlClient" connectionString="Data Source=10.105.206.12,1433;Initial Catalog=RepairTracker;User ID=ToolUser;Password=…" />
```

Numero pratica assegnato dall'API: `anno-progressivo` (2026-0001).

Controllo: `API/RepairTracker.ashx?health=1` (da collegati) deve dare `"status":"ok"`, `"tabelle":2` e i 5 ruoli.

## Ruoli (si assegnano da Gestione utenti)

| Ruolo | Cosa fa |
|---|---|
| Riparazioni | vede tutto, non modifica |
| Manutentori | apre richieste, corregge la sua card |
| Magazzino | anagrafica, spedizione, chiusura |
| TeamRicambi | fornitore, preventivo, ordine, rientro; può aprire richieste |
| RUO | approva / rifiuta |
| Admin | tutto, anche modificare fasi passate, cambiare la decisione RUO, eliminare |

## Il flusso

Manutentori → Magazzino → Team Ricambi (fornitore) → Magazzino (spedizione) → Team Ricambi (preventivo) → RUO → Team Ricambi (ordine) → Team Ricambi (rientro) → Magazzino (chiusura).

- Chi ha compilato una fase la può correggere finché la fase dopo non ha dati.
- Se un Admin svuota un campo obbligatorio di una fase già superata, la pratica torna a quella fase e i dati delle fasi successive vengono cancellati (con conferma).
- Pallino: verde/giallo/rosso in base ai giorni alla data consegna fornitore (>10, 4-10, ≤3), viola se c'è una data di ritardo, grigio se la data consegna non c'è.

Le fasi (campi, obbligatori, ruoli) sono scritte in due posti da tenere uguali: `FASI` in `RepairTracker.js` e `Fasi` in `RepairTracker.ashx`. Le aree sono solo in `AREE` nel JS.

## Differenze volute rispetto alla vecchia app

- Bug corretti: Ubicazione, Movimento SAP ed Entrata merci SAP non venivano mai salvati; la nota del RUO sovrascriveva le Note del manutentore (ora è `note_ruo`); il preventivo restava modificabile dopo l'approvazione se il RUO non scriveva una nota.
- I permessi sono controllati anche sul server (prima solo nel browser).
- Aggiunto lo storico nel dettaglio (i dati c'erano già, non venivano mostrati).
- Colori chiari del Portale invece del tema scuro: si cambiano dalle variabili in cima al CSS.
- Priorità 2 si chiama sempre "Macchina lavora" (prima a volte "Ricambio a stock").

## Librerie

Da cdnjs (come SheetJS nelle altre pagine): Chart.js 4.4.1 (grafici), ExcelJS 4.4.0 (export), Bootstrap Icons 1.11.3 (icone). Se non si caricano: niente grafici (resta la tabella), export in CSV, niente icone.

## Cosa NON è stato provato

- `RepairTracker.ashx` non è stato compilato né eseguito contro SQL Server (nel sandbox non c'è .NET). C# 5. Primo controllo: `API/RepairTracker.ashx?health=1`.
- La pagina è stata provata nel browser con un server finto che imita l'API (flusso completo per ogni ruolo, regressione, filtri, export, sola lettura, telefono), con Chart.js ed ExcelJS simulati.
