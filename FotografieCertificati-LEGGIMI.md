# Certificati – stato degli anni passati (fotografia al 31/12)

In alto nella pagina Certificati c'è **Stato dei dati: Oggi / 31/12/XXXX**. Scegliendo un anno si vedono Shop Order, TAG e Tracker EPA/CARB com'erano a fine anno, in sola lettura (le schede Modifica Tracker e Carica Excel spariscono). «Torna a oggi» riporta ai dati attuali. L'anno è nell'indirizzo (`Certificati.html?anno=2026`), quindi si può anche mandare il link.

## Installazione

1. Eseguire una volta in SSMS `SQL/Certificati_03_fotografie.sql` (si può rieseguire). Crea in ognuno dei tre database (ShopOrder, TAG, TrackerEPA) la tabella `Fotografie` e la copia `...Storico` con la colonna `Anno`. Alla fine: tre righe **OK**.
2. Copiare sul server: `API/Certificati.ashx`, `Certificati.html`, `JS/Motori/AnnoCertificati.js`, `CSS/Motori/AnnoCertificati.css`, `JS/Motori/Motori.js`, `JS/Motori/TrackerEpa.js`.

## Come si salva la fotografia

Non serve un job: al **primo accesso del nuovo anno** (anche solo aprire la pagina) il Portale copia i dati di oggi nelle tabelle `...Storico` con l'anno appena finito. Tutte le modifiche (Carica Excel, Modifica Tracker) passano prima da questo controllo, quindi la copia è esattamente lo stato al 31/12. Se la copia non riesce, le modifiche vengono rifiutate per non perdere lo stato di fine anno.

- La prima fotografia è quella del **31/12/2026**, consultabile da gennaio 2027. Fino ad allora il menu mostra solo «Oggi».
- Ogni anno si fa una sola volta (`Fotografie.Anno` è chiave primaria).
- Nel Tracker, per un anno passato, la «settimana di oggi» (ritardi) è quella del 31/12 di quell'anno.

## Attenzione

- Se a gennaio qualcuno cambia i dati **direttamente in SSMS** prima che chiunque apra la pagina, la fotografia conterrà anche quelle modifiche.
- Se per un anno intero nessuno apre la pagina, quell'anno non avrà la fotografia (i dati sarebbero comunque uguali all'anno prima).
- Non provato contro il database vero: l'API compila (C# 5) e la pagina è stata provata nel browser con un server finto (oggi, anno passato, nessun anno disponibile).
