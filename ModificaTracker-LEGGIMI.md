# Certificati – Modifica Tracker EPA/CARB dal web

Nuova scheda **Modifica Tracker** nella pagina Certificati: si possono modificare, aggiungere ed eliminare le famiglie del Tracker EPA/CARB senza passare dall'Excel.

## Installazione

1. Eseguire una volta in SSMS `SQL/Certificati_02_modifica_tracker.sql` (si può rieseguire). Crea la tabella `TrackerEPA.dbo.EpaModifiche` e il ruolo **Certificati Modifica**.
2. Copiare sul server: `API/Certificati.ashx`, `Certificati.html`, `JS/Motori/ModificaTracker.js`, `CSS/Motori/ModificaTracker.css`, `JS/Motori/Motori.js`, `JS/Motori/CaricaExcel.js`.
3. Assegnare il ruolo **Certificati Modifica** a chi deve modificare (Gestione utenti). Admin ce l'ha già.

## Come funziona

- Senza il ruolo la scheda non si vede e l'API rifiuta il salvataggio.
- All'apertura i dati sono **bloccati**. «Sblocca» abilita i campi.
- Si possono cambiare: ordine, stato e settimana di EPA/CARB sottomissione e approvazione, rischio, note. Si possono aggiungere famiglie nuove ed eliminare quelle esistenti (con «Ripristina» finché non si salva).
- I campi cambiati diventano gialli (al passaggio del mouse si vede il valore di prima), le righe nuove verdi, quelle eliminate barrate.
- **Nel database non si scrive niente finché non si preme «Salva modifiche»** e si conferma. Il salvataggio è tutto o niente.
- Se nel frattempo qualcun altro ha cambiato gli stessi campi, il salvataggio viene rifiutato e dice quali: niente viene sovrascritto di nascosto.
- Ogni modifica viene registrata in `dbo.EpaModifiche` (chi, quando, campo, prima, dopo).
- Uscire dalla pagina con modifiche non salvate chiede conferma.

## Caricamento Excel dopo modifiche dal web

L'Excel del Tracker continua a **sostituire** tutto. Se dopo l'ultimo Excel sono state fatte modifiche dal web, l'anteprima del caricamento mostra un avviso rosso (quante, quante famiglie, chi e quando) e la conferma lo ripete. L'API controlla anche lato server: se arrivano modifiche nuove tra l'anteprima e il caricamento, lo rifiuta.

## Cosa NON è stato provato

- `Certificati.ashx` compila (Mono, C# 5) ma non è stato eseguito contro il database.
- La scheda è stata provata nel browser con un server finto (blocco/sblocco, modifiche, settimana non valida, aggiunta, eliminazione, conferma e salvataggio).
- I piani PO..R e il «Previous planning» (colonna `Dati`) non si modificano dal web: restano quelli dell'ultimo Excel.
