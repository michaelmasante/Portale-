Portale Servizi - Ricerca Fattibilità Motori

Un'applicazione web modulare e responsive progettata per centralizzare e ottimizzare l'accesso a vari strumenti aziendali
Iniezione dinamica dei componenti globali (Header e Footer) gestita lato client tramite fetch in JavaScript (ComponentsLoader.js).
📂 Struttura del Progetto
├── Components/         # Componenti HTML riutilizzabili (Header.html, Footer.html)
├── CSS/                # Fogli di stile organizzati per modulo (Header, Footer, Motori, Portal)
├── JS/                 # Script JavaScript client-side e logica applicativa
├── IMG/                # Risorse grafiche e loghi aziendali
├── File/               # Cartelle dati (es. File/Motori/ per i dataset locali)
├── Portale.html        # Landing page/Home del Portale Servizi
└── Motori.html         # Interfaccia di gestione e ricerca fattibilità motori

Portale
Il Portale Servizi funge da punto d'accesso unificato a diverse funzionalità aziendali.
<img width="2490" height="856" alt="HomePage" src="https://github.com/user-attachments/assets/082f7b77-2116-4457-b80a-50383bee6e42" />



- Funzionalità Principali: Ricerca con filtri in griglia più file e fogli

<img width="2502" height="970" alt="RIcerca" src="https://github.com/user-attachments/assets/86df4081-d07a-4c30-b564-d2a83ff8e476" />



Una delle componenti chiave integrate nel portale è il modulo di filtri avanzati in griglia, sviluppato per consentire la consultazione rapida con filtri incrociati.

Caratteristiche del Modulo:
Navigazione Dinamica tra File (Dataset):
Supporto al cambio rapido della fonte dati (file Excel / API backend) direttamente tramite menu a tendina/tab dedicati.

Filtri Avanzati per Colonna:
Filtri di ricerca incorporati direttamente negli intestatari della griglia dati.
Funzionalità di ricerca testuale immediata, ordinamento multivalore e pulizia rapida dei filtri applicati.
Aggiornamento istantaneo dell'interfaccia grazie all'integrazione con Tabulator.js.
