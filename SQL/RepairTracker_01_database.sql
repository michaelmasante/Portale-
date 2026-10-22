/*
 * Repair Tracker (riparazioni urgenti) - database, tabelle e ruoli.
 * Si esegue UNA volta in SSMS, collegati al server del Portale con un utente amministratore
 * (serve il permesso di creare database). Si puo' rieseguire: non cancella nulla.
 *
 *   Parte 1: database RepairTracker con le sue tabelle (le pratiche e il loro storico).
 *   Parte 2: in PortaleLogin si aggiungono SOLO i 5 ruoli nuovi (PortaleLogin resta: utenti e ruoli).
 *   Parte 3: l'utente SQL del Portale (ToolUser) puo' leggere e scrivere in RepairTracker.
 *
 * I nomi delle colonne sono gli stessi della vecchia app (repair-tracker su MySQL), cosi' un domani
 * si potrebbero importare i vecchi dati senza rinominare nulla.
 * Attenzione: "codice_componente" e' in realta' la "Descrizione breve" (nome ereditato dalla vecchia app).
 */

-- =====================================================================
-- Parte 1: database e tabelle
-- =====================================================================
IF DB_ID(N'RepairTracker') IS NULL
BEGIN
	CREATE DATABASE RepairTracker;
	PRINT 'Creato il database RepairTracker';
END
GO

USE RepairTracker;
GO

IF OBJECT_ID(N'dbo.Riparazioni', N'U') IS NULL
BEGIN
	CREATE TABLE dbo.Riparazioni (
		id                      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Riparazioni PRIMARY KEY,
		numero_pratica          NVARCHAR(20)   NOT NULL,   -- es. 2026-0001, lo assegna l'API
		data_inserimento        DATE           NOT NULL CONSTRAINT DF_Riparazioni_data DEFAULT (CAST(SYSDATETIME() AS DATE)),

		-- Manutentori
		codice_componente       NVARCHAR(200)  NOT NULL,   -- "Descrizione breve"
		codice_sap              NVARCHAR(50)   NULL,
		descrizione             NVARCHAR(2000) NULL,
		tipo_guasto             NVARCHAR(200)  NULL,
		macchina                NVARCHAR(100)  NULL,       -- "Targa macchina"
		area                    NVARCHAR(50)   NULL,
		centro_costo            NVARCHAR(50)   NULL,
		priorita                TINYINT        NOT NULL CONSTRAINT DF_Riparazioni_priorita DEFAULT (2),  -- 1 macchina ferma, 2 macchina lavora
		note                    NVARCHAR(2000) NULL,

		-- Magazzino 1
		tipo_riparazione        NVARCHAR(20)   NULL,       -- Meccanica / Elettronica
		ubicazione              NVARCHAR(100)  NULL,
		movimento_sap           NVARCHAR(50)   NULL,

		-- Team Ricambi 1
		fornitore               NVARCHAR(150)  NULL,       -- sempre MAIUSCOLO
		bolla                   NVARCHAR(50)   NULL,

		-- Magazzino 2
		data_spedizione         DATE           NULL,

		-- Team Ricambi 2
		preventivo              DECIMAL(12,2)  NULL,
		tempo_consegna_valore   INT            NULL,
		tempo_consegna_unita    NVARCHAR(10)   NULL,       -- giorni / settimane

		-- RUO
		note_ruo                NVARCHAR(2000) NULL,

		-- Team Ricambi 3
		numero_rda              NVARCHAR(50)   NULL,
		data_ordine             DATE           NULL,
		data_consegna_fornitore DATE           NULL,
		data_ritardo            DATE           NULL,       -- se c'e', il pallino diventa viola

		-- Team Ricambi 4
		bolla_rientro           NVARCHAR(50)   NULL,
		data_rientro_effettiva  DATE           NULL,
		entrata_merci_sap       NVARCHAR(50)   NULL,

		stato                   NVARCHAR(30)   NOT NULL CONSTRAINT DF_Riparazioni_stato DEFAULT (N'in_magazzino'),
		creato_da               NVARCHAR(50)   NULL,       -- Username del Portale
		creato_il               DATETIME2(0)   NOT NULL CONSTRAINT DF_Riparazioni_creato DEFAULT (SYSDATETIME()),
		modificato_il           DATETIME2(0)   NULL,

		CONSTRAINT UQ_Riparazioni_numero UNIQUE (numero_pratica),
		CONSTRAINT CK_Riparazioni_priorita CHECK (priorita IN (1, 2)),
		CONSTRAINT CK_Riparazioni_stato CHECK (stato IN (
			N'in_magazzino', N'richiesta_inoltrata', N'attesa_spedizione', N'spedito', N'attesa_approvazione',
			N'rifiutato', N'accettata', N'attesa_consegna', N'consegnato_magazzino', N'chiuso'))
	);
	CREATE INDEX IX_Riparazioni_stato ON dbo.Riparazioni (stato);
	PRINT 'Creata dbo.Riparazioni';
END
GO

-- Storico: chi ha fatto cosa e quando (creazione, modifiche, avanzamenti, decisioni RUO)
IF OBJECT_ID(N'dbo.RiparazioniLog', N'U') IS NULL
BEGIN
	CREATE TABLE dbo.RiparazioniLog (
		id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RiparazioniLog PRIMARY KEY,
		riparazione_id INT            NOT NULL CONSTRAINT FK_RiparazioniLog_Riparazioni
		                                  REFERENCES dbo.Riparazioni (id) ON DELETE CASCADE,
		stato          NVARCHAR(30)   NOT NULL,   -- stato della pratica DOPO l'azione
		azione         NVARCHAR(30)   NOT NULL,   -- Creazione, Modifica, Avanzamento, Regressione, Approvata, Rifiutata
		dettaglio      NVARCHAR(2000) NULL,
		username       NVARCHAR(50)   NULL,       -- Username del Portale (nessun collegamento a PortaleLogin: i database restano separati)
		nome_utente    NVARCHAR(150)  NULL,
		data           DATETIME2(0)   NOT NULL CONSTRAINT DF_RiparazioniLog_data DEFAULT (SYSDATETIME())
	);
	CREATE INDEX IX_RiparazioniLog_riparazione ON dbo.RiparazioniLog (riparazione_id);
	PRINT 'Creata dbo.RiparazioniLog';
END
GO

-- =====================================================================
-- Parte 2: ruoli (in PortaleLogin, dove stanno tutti i ruoli del Portale)
--   Riparazioni  = vede tutto, non modifica nulla
--   Manutentori  = apre le richieste
--   Magazzino    = anagrafica, spedizione, chiusura
--   TeamRicambi  = fornitore, preventivo, ordine, rientro (puo' anche aprire richieste)
--   RUO          = approva / rifiuta il preventivo
--   Admin        = tutto (gia' esistente)
-- Si assegnano dalla pagina Gestione utenti.
-- =====================================================================
USE PortaleLogin;
GO

INSERT INTO dbo.Ruoli (Nome, Descrizione)
SELECT v.Nome, v.Descrizione
FROM (VALUES
	(N'Riparazioni', N'Repair Tracker: sola lettura'),
	(N'Manutentori', N'Repair Tracker: apre le richieste di riparazione'),
	(N'Magazzino',   N'Repair Tracker: anagrafica, spedizione e chiusura'),
	(N'TeamRicambi', N'Repair Tracker: fornitore, preventivo, ordine e rientro'),
	(N'RUO',         N'Repair Tracker: approva o rifiuta il preventivo')
) AS v (Nome, Descrizione)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Ruoli r WHERE r.Nome = v.Nome);
GO

-- =====================================================================
-- Parte 3: l'utente SQL del Portale legge e scrive in RepairTracker
-- (se il Portale usa un altro utente SQL, cambiare 'ToolUser' nella riga DECLARE e nel controllo in fondo)
-- =====================================================================
USE RepairTracker;
GO

DECLARE @utente SYSNAME = N'ToolUser';

IF SUSER_ID(@utente) IS NULL
	PRINT 'ATTENZIONE: il login ' + @utente + ' non esiste sul server. Saltata la parte 3.';
ELSE IF SUSER_SID(@utente) = (SELECT owner_sid FROM sys.databases WHERE name = N'RepairTracker')
	PRINT @utente + ' e'' il proprietario del database: ha gia'' tutti i permessi.';
ELSE
BEGIN
	IF USER_ID(@utente) IS NULL
	BEGIN
		DECLARE @sql NVARCHAR(300) = N'CREATE USER ' + QUOTENAME(@utente) + N' FOR LOGIN ' + QUOTENAME(@utente) + N';';
		EXEC (@sql);
	END
	EXEC sp_addrolemember N'db_datareader', @utente;
	EXEC sp_addrolemember N'db_datawriter', @utente;
	PRINT @utente + ': lettura e scrittura su RepairTracker.';
END
GO

-- =====================================================================
-- Controllo: devono comparire le due tabelle, i 5 ruoli nuovi e ToolUser
-- =====================================================================
SELECT name AS tabella FROM RepairTracker.sys.tables WHERE name IN (N'Riparazioni', N'RiparazioniLog');
SELECT Id, Nome, Descrizione FROM PortaleLogin.dbo.Ruoli ORDER BY Nome;
SELECT dp.name AS utente, r.name AS permesso
FROM RepairTracker.sys.database_role_members m
JOIN RepairTracker.sys.database_principals r  ON r.principal_id  = m.role_principal_id
JOIN RepairTracker.sys.database_principals dp ON dp.principal_id = m.member_principal_id
WHERE dp.name = N'ToolUser';
GO
