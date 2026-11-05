# Repair Tracker nel Portale (aggiornato al 03/11/2026)

Rifacimento di `davidefriscia/repair-tracker` (Angular + PHP + MySQL su XAMPP) come pagina del Portale: un HTML, un JS, un CSS, l'API `.ashx` e un database SQL Server tutto suo (`RepairTracker`). Login e ruoli sono quelli del Portale.

## File

| File | Dove va nel Portale |
|---|---|
| `RepairTracker.html` | radice |
| `CSS/RepairTracker/RepairTracker.css` | `CSS/RepairTracker/` |
| `JS/RepairTracker/RepairTracker.js` | `JS/RepairTracker/` |
| `API/RepairTracker.ashx` | `API/` |
| `SQL/RepairTracker_01_database.sql` | solo per installare da zero (crea tutto com'è oggi) |
| `SQL/RepairTracker_02_op_richiedente.sql` | aggiornamento, già eseguito il 23/10 |
| `SQL/RepairTracker_03_ruo_aree_disponibile.sql` | aggiornamento, già eseguito il 23/10 |
| `SQL/RepairTracker_04_aree_budget_ritardo.sql` | aggiornamento, già eseguito il 23/10 sera |
| `SQL/RepairTracker_06_rda_laboratorio.sql` | aggiornamento del 03/11: da eseguire una volta (rieseguibile) |
| `SQL/RepairTracker_05_svuota_pratiche.sql` (consegnato il 23/10) | **solo dopo il training**: cancella tutte le pratiche (ha una sicura) |
| `Portale.html`, `JS/Portal/Portal.js` | tile "Riparazioni" nella Home (consegnati il 20/10) |

## Dati

- **`RepairTracker`**: `dbo.Riparazioni` (una riga per pratica), `dbo.RiparazioniLog` (storico), `dbo.BudgetAree` (budget mensile per area).
- **`PortaleLogin`**: solo utenti e ruoli; qui ci sono anche i ruoli del Repair Tracker.
- Web.config: due stringhe di connessione, `PortaleLogin` e `RepairTracker` (stesso server e utente, cambia `Initial Catalog`).
- Controllo: `API/RepairTracker.ashx?health=1` deve dare `"status":"ok"`; se manca un aggiornamento SQL lo dice.
- Numero pratica: `anno-progressivo` (2026-0001), lo assegna l'API.

## Ruoli (si assegnano da Gestione utenti del Portale, o dalla pagina Gestione del Repair Tracker)

| Ruolo | Cosa fa |
|---|---|
| Riparazioni | vede tutto, non modifica |
| Manutentori | apre richieste, corregge la sua scheda |
| Magazzino | anagrafica, spedizione, chiusura |
| TeamRicambi | fornitore, preventivo, RDA, ordine, rientro; può aprire richieste |
| RUO | approva / rifiuta le pratiche di tutte le aree |
| RUO NEF, RUO I&M, RUO CAMBI, RUO PONTI, RUO ePWT, RUO COMPRENSORIO | approva / rifiuta solo le pratiche di quell'area (un utente può averne più di uno) |
| Admin Repair | pagina **Gestione**: budget mensile delle aree e ruoli del Repair Tracker degli utenti |
| Admin | tutto, anche modificare fasi passate, cambiare la decisione RUO, eliminare, dare/togliere Admin Repair |

L'Admin Repair, in Gestione → Utenti e ruoli, vede e cambia **solo** i ruoli della tabella qui sopra (non Admin, Certificati, Safety…). Non può dare o togliere "Admin Repair" (solo l'Admin). Attivare un utente nuovo resta all'Admin (Gestione utenti del Portale).

## Aree e centri di costo

Scritti **solo** in `API/RepairTracker.ashx` (`UoCentri`, generati dal file CDC.xlsx del 23/10/2026); la pagina li riceve dall'API.

| Area | Centri di costo |
|---|---|
| NEF | blocco CDC NEF (26) |
| I&M | blocco CDC VECTOR (8) |
| CAMBI | blocco CDC CAMBI (38) |
| PONTI | blocco CDC PONTI (32) |
| ePWT | blocco CDC CURSOR (5) |
| COMPRENSORIO | blocco CDC COMPRENSORIO (16) |

Nel database si salva il codice (es. `C6611004`); la pagina mostra "codice — descrizione". Se si aggiunge o rinomina un'area servono anche: il ruolo `RUO <area>` in PortaleLogin e il nome nel meta "ruoli" di `RepairTracker.html`.

## Il flusso

Manutentori → Magazzino → Team Ricambi (fornitore) → Magazzino (spedizione) → Team Ricambi (preventivo) → RUO → Team Ricambi (RDA) → Team Ricambi (ordine) → Team Ricambi (rientro) → Magazzino (chiusura).

| Scheda | Campi (* obbligatorio) |
|---|---|
| Manutentori / Nuova richiesta | Descrizione breve*, Codice SAP, Area*, Centro di costo* (dell'area), Targa macchina*, Operazione*, Priorità, Tipo guasto (Elettrico/Meccanico/Oleodinamico/Usura), Descrizione e note |
| Magazzino | Tipo riparazione* (Meccanica / Elettronica / **Laboratorio Elettrotecnico**), Ubicazione*, Movimento SAP*; solo con Laboratorio Elettrotecnico compare **Previsione riparazione** (data, facoltativa) |
| Team Ricambi | Fornitore*, Bolla* |
| Magazzino — Spedizione | Data spedizione* |
| Team Ricambi — Preventivo | Numero preventivo, Preventivo*, Tempo di consegna* (testo libero, es. "2 settimane", "fine mese") |
| RUO | Approva / Rifiuta (niente note). Vede area, preventivo, tempo di consegna e il **disponibile del mese** della sua area |
| Team Ricambi — RDA | Numero RDA*, Data RDA* (proposta oggi, modificabile), spunta **Rilascio RDA**: senza spunta si salva ma la pratica resta lì (stato "Accettata"); con la spunta "Rilascia RDA e passa all'ordine" (stato "Attesa ordine") |
| Team Ricambi — Ordine | Numero ordine*, Data ordine* (proposta oggi, modificabile), Data consegna fornitore*, spunta **Pezzo in ritardo**; con la spunta compare **Data consegna ritardo*** (senza spunta non si vede e si svuota) |
| Team Ricambi — Rientro | Bolla di rientro*, Data rientro*, Entrata merci a SAP* |
| Magazzino — Chiusura | Istruzione "Verifica la completezza della pratica e conferma", poi Conferma |

- **Laboratorio Elettrotecnico**: alla Conferma del Magazzino la pratica salta Team Ricambi, Spedizione, Preventivo, RUO, RDA e Ordine (schede grigie "Saltata") e va dritta al **Rientro**. Niente preventivo = niente budget scalato; pallino grigio in dashboard fino alla chiusura (poi verde). Se l'Admin cambia il tipo di riparazione dopo la conferma (da/verso Laboratorio) la pratica torna al Magazzino e i dati successivi si cancellano (con conferma).
- Le schede del Team Ricambi hanno **Salva** (dati anche incompleti, la pratica resta lì) oltre a **Conferma** (passa avanti).
- Chi ha compilato una scheda la può correggere finché la scheda dopo non ha dati; l'Admin sempre.
- Se l'Admin svuota un campo obbligatorio di una scheda già superata, la pratica torna a quella scheda e i dati successivi si cancellano (con conferma), approvazione RUO compresa: l'importo torna nel budget.
- Dettaglio: ogni scheda si apre/chiude dal titolo; di base è aperta solo quella su cui si lavora adesso.

## Budget mensile (Admin Repair)

- Gestione → Budget mensile: si sceglie il mese e si scrive il budget di ogni area (vuoto = non impostato). Si vede anche quanto è già stato approvato e quanto resta.
- Disponibile = budget dell'area nel mese − preventivi delle pratiche di quell'area **approvate in quel mese**.
- Quando il RUO approva, l'API salva data di approvazione e disponibile di quel momento (`data_approvazione`, `disponibile_mese`): da lì l'importo è scalato. Se la pratica viene rifiutata dall'Admin o torna indietro, l'importo torna disponibile.
- Il RUO vede nella scheda il disponibile del mese della sua area e quanto resterebbe approvando; se il preventivo supera il disponibile c'è un avviso rosso. Non blocca l'approvazione.

## Dashboard

- Pallino: **grigio** in corso prima del RUO, **arancione** tocca al RUO, **verde** approvata (fino alla chiusura), **rosso** rifiutata.
- Riga **rossa**: pezzo in ritardo (spunta messa) finché non è rientrato. Riga **verde**: rientrata, manca solo la chiusura del Magazzino.
- Riquadri in alto (cliccabili come filtro): Totale, In corso, Attesa RUO, Approvate, Rifiutate, Pezzi in ritardo.
- Colonna "Richiesto da", filtri per colonna, ricerca, export Excel (con descrizione del centro di costo, pezzo in ritardo, data di approvazione).

## Tema

Scuro di base. Il bottone in alto a destra passa al chiaro e viceversa; la scelta resta salvata nel browser (`localStorage`, chiave `rt_tema`). Vale solo per il Repair Tracker. I colori sono variabili in cima al CSS: `:root` (scuro) e `:root[data-tema="chiaro"]`.

## Note per chi modifica

- Fasi, campi obbligatori e ruoli sono in due posti da tenere uguali: `FASI` in `RepairTracker.js` e `Fasi` in `RepairTracker.ashx`.
- Dopo ogni modifica a JS o CSS cambiare il `?v=` nei link di `RepairTracker.html` (ora JS `v=7`, CSS `v=6`).
- Versione nel footer: `VERSIONE` in cima a `RepairTracker.js` (ora 0.3.0).
- Librerie da cdnjs: Chart.js 4.4.1, ExcelJS 4.4.0, Bootstrap Icons 1.11.3. Se non si caricano: niente grafici, export in CSV, niente icone.

## Cosa NON è stato provato

- `RepairTracker.ashx` non è stato compilato né eseguito contro SQL Server (nel sandbox non c'è .NET). C# 5. Primo controllo: `API/RepairTracker.ashx?health=1`.
- Gli script SQL non sono stati eseguiti (nessun SQL Server nel sandbox).
- La pagina è stata provata nel browser con un server finto che imita l'API: flusso completo per ogni ruolo, RUO per area, budget scalato e restituito, gestione ruoli, pezzo in ritardo, colori della dashboard, tema scuro/chiaro. Il 03/11: numero preventivo, tempo a testo, RDA → Rilascio RDA → Ordine, Laboratorio Elettrotecnico (salto al rientro, previsione, cambio percorso).
- Analisi fornitori: il "tempo promesso" si ricava dal testo (numero + giorni/settimane/mesi; senza unità = giorni). Testi senza numero (es. "fine mese") non entrano nella media.
