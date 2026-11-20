# Accesso con Microsoft Entra ID

- **Tutti** entrano con il pulsante **«Accedi con Microsoft»** (account aziendale).
- **Utente e password** restano solo per chi ha il ruolo **Admin** (sezione «Accesso amministratore» nella pagina di login). Agli altri il login con password risponde «usa Accedi con Microsoft».
- La registrazione con password è tolta: al primo accesso con Microsoft l'utente viene creato **non attivo**; un admin lo attiva e gli dà i ruoli da Gestione utenti.
- Collegamento con gli utenti che ci sono già: per **EntraOid** (dopo il primo accesso), altrimenti per **Email** oppure **Username** uguale all'account Microsoft. Al primo accesso l'utente resta collegato per sempre al suo account (colonna `EntraOid`), quindi tiene i suoi ruoli.

## Installazione

1. SSMS: eseguire `SQL/Login_02_entra.sql` (aggiunge `Utenti.EntraOid`). L'elenco finale mostra chi è Admin e a chi manca l'email.
2. Registrazione dell'app in Entra ID (portale Azure → Microsoft Entra ID → Registrazioni app):
   - Tipo di account: solo questa organizzazione.
   - URI di reindirizzamento, piattaforma **Web**: `https://<indirizzo del Portale>/API/Entra.ashx`.
   - Certificati e segreti: un client secret (annotare la scadenza: quando scade, il login Microsoft smette di funzionare).
   - Autorizzazioni API: `openid`, `profile`, `email` (Microsoft Graph, delegate) — sono quelle di default.
3. Web.config **sul server** (non su GitHub), in `appSettings`:
   - `EntraTenantId` = ID della directory (tenant)
   - `EntraClientId` = ID dell'applicazione (client)
   - `EntraClientSecret` = valore del secret
   - `EntraRedirectUri` = lo stesso URI del punto 2, identico
   - consigliato su HTTPS: `requireSSL="true"` nella riga `<forms ...>`.
4. Copiare sul server: `API/Entra.ashx`, `API/Auth.ashx`, `Login.html`, `JS/Login/Login.js`, `CSS/Login/Login.css`, e nel `Web.config` la sezione `<location path="API/Entra.ashx">` (accesso senza login).
5. Il server IIS deve poter uscire su internet verso `login.microsoftonline.com` (porta 443) per scambiare il codice con i token.

## Come funziona (tecnico)

OpenID Connect con codice di autorizzazione + PKCE, senza librerie esterne. `state`, `nonce` e `code_verifier` stanno in un cookie protetto con la machineKey (15 minuti). Il codice viene scambiato lato server con il client secret; dell'`id_token` si controllano destinatario (client id), tenant, emittente, nonce e scadenza (arriva direttamente da Microsoft via HTTPS). Poi si crea lo stesso cookie di accesso del login normale, quindi pagine, ruoli e API non cambiano. Ogni accesso va in `AccessiLog` (`LoginEntra`, `EntraCollegato`, `Registrazione`, `NonAttivo`, `LoginNegato`, `EntraErrore`).

## Non provato

`Entra.ashx` e `Auth.ashx` compilano (C# 5) ma non sono stati provati contro Entra ID e il database veri. La pagina di login è stata provata nel browser con un server finto.
