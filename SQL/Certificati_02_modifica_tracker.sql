-- Modifica del Tracker EPA/CARB dal web. Eseguire una volta in SSMS (si può rieseguire)
USE TrackerEPA;
GO

-- Storico delle modifiche fatte dalla scheda "Modifica Tracker".
-- CaricamentoId = ultimo caricamento Excel al momento della modifica: serve per avvisare
-- chi ricarica l'Excel che ci sono modifiche fatte dal web che andrebbero perse.
IF OBJECT_ID(N'dbo.EpaModifiche', N'U') IS NULL
CREATE TABLE dbo.EpaModifiche (
	Id             int IDENTITY(1,1) NOT NULL CONSTRAINT PK_EpaModifiche PRIMARY KEY,
	DataOra        datetime2(0)  NOT NULL CONSTRAINT DF_EpaModifiche_DataOra DEFAULT SYSDATETIME(),
	CaricamentoId  int           NOT NULL,
	Username       nvarchar(50)  NOT NULL,
	NomeUtente     nvarchar(150) NULL,
	Famiglia       nvarchar(50)  NOT NULL,
	Azione         nvarchar(20)  NOT NULL,   -- Modificata, Nuova, Eliminata
	Campo          nvarchar(50)  NULL,
	Prima          nvarchar(max) NULL,
	Dopo           nvarchar(max) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_EpaModifiche_CaricamentoId' AND object_id = OBJECT_ID(N'dbo.EpaModifiche'))
	CREATE INDEX IX_EpaModifiche_CaricamentoId ON dbo.EpaModifiche (CaricamentoId) INCLUDE (Famiglia, DataOra);
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'ToolUser')
	CREATE USER ToolUser FOR LOGIN ToolUser;
GO
ALTER ROLE db_datareader ADD MEMBER ToolUser;
ALTER ROLE db_datawriter ADD MEMBER ToolUser;
GO

-- Ruolo per vedere la scheda "Modifica Tracker" e salvare le modifiche
USE PortaleLogin;
GO
IF NOT EXISTS (SELECT 1 FROM dbo.Ruoli WHERE Nome = N'Certificati Modifica')
	INSERT INTO dbo.Ruoli (Nome, Descrizione) VALUES (N'Certificati Modifica', N'Certificati: modifica del Tracker EPA/CARB dal web');
GO

-- Controllo
SELECT 'EpaModifiche' AS Oggetto, CASE WHEN OBJECT_ID(N'TrackerEPA.dbo.EpaModifiche', N'U') IS NULL THEN 'MANCA' ELSE 'OK' END AS Esito
UNION ALL
SELECT 'Ruolo Certificati Modifica', CASE WHEN EXISTS (SELECT 1 FROM dbo.Ruoli WHERE Nome = N'Certificati Modifica') THEN 'OK' ELSE 'MANCA' END;
