# DriveLine – test di collegamento (12/11/2026)

Pagina del Portale che serve a provare, prima di costruire il cruscotto DriveLine, se dal server del Portale si arriva al loro database (rete, firewall, utente, permessi) e se le query di Access restituiscono dati. Si apre dalla tile **DriveLine** della Home.

- **Database sorgente** (il loro): i parametri si scrivono nella pagina. La password non si salva da nessuna parte. Sul sorgente si eseguono **solo SELECT**: l'API rifiuta INTO, INSERT, UPDATE, DELETE, DROP, EXEC e simili.
- **Database di test** (il nostro, `DriveLineTest`): qui si salvano i dati letti e si eseguono i passi 0015 e 0020.

## File

| File | Dove va nel Portale |
|---|---|
| `DriveLine.html` | radice |
| `CSS/DriveLine/DriveLine.css` | `CSS/DriveLine/` |
| `JS/DriveLine/DriveLine.js` | `JS/DriveLine/` |
| `API/DriveLine.ashx` | `API/` |
| `SQL/DriveLine_01_database.sql` | si esegue una volta in SSMS |
| `Portale.html`, `JS/Portal/Portal.js` | tile DriveLine al posto del "Prossimamente" verde della colonna destra |
| `Web.config` | stringa `DriveLineTest` e limiti per `API/DriveLine.ashx` |

## Web.config

Già presenti: la stringa `DriveLineTest` (stesso server e utente delle altre) e la sezione `<location path="API/DriveLine.ashx">` per le query lunghe e il file DLT.TXT. Tolta la riga `Safety` che era doppia.

Facoltativa, quando i parametri saranno definitivi: `<add name="DriveLineSorgente" providerName="..." connectionString="..." />`. Nella pagina, tipo «Stringa DriveLineSorgente del Web.config».

## Chi la vede

Ruolo `DriveLine` (lo crea l'ultima parte dello script SQL) oppure Admin. Lo stesso controllo è nella pagina (`<meta name="ruoli">`) e nell'API.

## Come si usa

1. **Collegamento**: tipo di database, server, porta, utente e password, poi «Prova collegamento». La prova va passo per passo e si ferma al primo che non va. Ogni passo ✗ ha una spiegazione e cosa fare.
   - Driver sul server del Portale (per ODBC controlla che il nome del driver sia installato, anche 32/64 bit)
   - Nome del server (DNS)
   - Porta dell'istanza (SQL Server con istanza con nome: la chiede a SQL Browser, UDP 1434)
   - Porta TCP (5 secondi): distingue «firewall, nessuna risposta» da «porta chiusa»
   - Accesso (utente e password)
   - Chi sono sul database (utente, database, server)
   - Tabelle `FI_GAN_L4` e `N09J0121_DLT`: esistono, sono leggibili, ci sono tutte le colonne usate dalle query?
   «Info server Portale» mostra l'IP del server (da dare a chi apre il firewall), l'utente del pool IIS, 32/64 bit e i driver ODBC/OLE DB/.NET installati.
2. **Query**: le query di Access tradotte in SQL valido per ogni database. Ogni query ha «Esegui (anteprima)» e «Esegui e salva», che svuota e ricarica la tabella del DB di test (come il SELECT INTO di Access). Mostra righe, tempi, tipi delle colonne e una «CREATE TABLE suggerita». Il testo si può modificare e resta nel browser.
3. **DB di test**: elenco CDA costruttori (la tabella `[CDA-COSTRUTTORI]` di Access, da riempire a mano) e le prime righe delle tabelle.
4. **File DLT.TXT**: se `N09J0121_DLT` arriva come file a larghezza fissa. Prima mostra l'anteprima, poi carica.

### Traduzione delle query

| Access | Qui |
|---|---|
| `Year(x) = Year(Date())` | `x >= {INIZIO_ANNO} AND x < {INIZIO_ANNO_SUCC}` |
| `Year(x) = Year(Date()) - 1` | `x >= {INIZIO_ANNO_PREC} AND x < {INIZIO_ANNO}` |
| `x >= CVDate("01/01/" & Year(Date()))` | `x >= {INIZIO_ANNO}` |
| `INNER JOIN [CDA-COSTRUTTORI]` | `ACT_CENTER_CODE IN {CDA_COSTRUTTORI}` (elenco della sezione 3) |
| `Val([ASSEMBLY_ORDER_NBR]) AS Chiave` | calcolata dall'API al salvataggio |
| `Year(...) AS Anno_...` (0010) | colonne calcolate nel DB di test |
| `SELECT ... INTO tabella` | «Esegui e salva» |
| 0015, 0020 | eseguite dall'API sul DB di test (testo fisso) |
| Stato35 | vista `dbo.Stato35` nel DB di test |

I segnaposto delle date diventano `CAST('20260101' AS datetime)` (SQL Server), `DATE '2026-01-01'` (Oracle), `DATE('2026-01-01')` (DB2) o `{d '2026-01-01'}` (ODBC), secondo il «Dialetto SQL» scelto.

### Tracciato DLT.TXT

Verificato sul file del 12/11/2026: 14.233 righe, tutte lette senza errori, GAN tutti diversi, 11.340 con Stato < 95. Posizioni contate da 1:

`Cda` 11-15 · `Linea` 16-23 · `Tipo_Ordine` 24 · `Gan` 25-32 · `Disegno` 33-47 · `Matricola` 48-56 · `Cda_U` 57-63 · `Cod_Cliente` 64-69 · `Data_Imp` 70-75 · `Data_Dis_Lin` 76-81 · `Data_Finiz` 82-87 · `Data_Sped` 88-93 · `Stato` 94-95 · `Sotto_Stato` 96-97 · `Data_Ult_Var` 98-103 · `Ora_Ult_Var` 104-107 · `Polmone` 108-110 · `Data_Seq` 111-116 · `Num_Seq` 117-120 · `Data_Ord` 121-126.

Le date sono aammgg; `000000` vuol dire vuota. Le posizioni 1-10 (`PJ22N09DLN`) sono un'intestazione e non si salvano. **Da confermare:** `Cda`, `Linea` e `Tipo_Ordine`. Nel file il GAN è di 8 cifre, senza la `G` (la `G` è in posizione 24): se in `FI_GAN_L4` il GAN ha la G, la 0020 non trova GAN in comune e lo dice. Il tracciato si cambia in un punto solo: `TracciatoDlt` in `API/DriveLine.ashx`.

## Cosa NON è stato provato

- `DriveLine.ashx` non è stato compilato né eseguito (nell'ambiente di lavoro non c'è .NET). È scritto in C# 5, come gli altri. Primo controllo: aprire `API/DriveLine.ashx?health=1`, che deve rispondere `"status":"ok"`.
- Lo script SQL non è stato eseguito.
- La pagina è stata provata nel browser con un server finto che imita l'API in tutti i casi: DNS, porta, login sbagliato, permesso mancante su una tabella, errore di sintassi, salvataggio riuscito e bloccato per tipo/lunghezza, 0015, 0020 senza GAN in comune, file DLT.TXT vero (14.233 righe), CDA, tema chiaro.
- Le spiegazioni degli errori si basano sui codici noti di SQL Server, Oracle, ODBC e DB2: un errore che non è nell'elenco compare come «Errore non riconosciuto» con il messaggio tecnico completo.
- Driver Oracle/DB2: sul server del Portale potrebbero non esserci. «Info server Portale» lo dice subito.

## Note per chi modifica

- Query della pagina: `QUERY` in `DriveLine.js`. Passi locali 0015/0020: `Locale()` in `DriveLine.ashx`.
- Tabelle in cui la pagina può scrivere: `TabelleScrivibili` in `DriveLine.ashx`. Le colonne si abbinano per nome, ignorando maiuscole e minuscole.
- Spiegazioni degli errori: `Regole` in `DriveLine.ashx` (vince la prima che corrisponde).
- Dopo ogni modifica a JS o CSS cambiare il `?v=` in `DriveLine.html` (ora 1 e 1). Versione nel footer: `VERSIONE` in `DriveLine.js` (0.1.0).
- Ogni prova viene scritta in `App_Data\DriveLine.log`, senza password (solo se la cartella esiste ed è scrivibile).
