-- Fotografie di fine anno dei Certificati (Shop Order, TAG, Tracker EPA/CARB).
-- Eseguire una volta in SSMS (si può rieseguire). Le tabelle ...Storico hanno le stesse colonne di quelle di oggi più Anno.
-- La copia la fa il Portale da solo al primo accesso dell'anno nuovo (prima di qualunque modifica): la prima sarà quella del 2026.

------------------------------------------------------------------ Shop Order
USE ShopOrder;
GO
IF OBJECT_ID(N'dbo.Fotografie', N'U') IS NULL
CREATE TABLE dbo.Fotografie (
	Anno     smallint      NOT NULL CONSTRAINT PK_Fotografie PRIMARY KEY,
	DataOra  datetime2(0)  NOT NULL CONSTRAINT DF_Fotografie_DataOra DEFAULT SYSDATETIME(),
	Righe    int           NOT NULL,
	Ultimo   nvarchar(max) NULL   -- ultimo caricamento Excel al momento della fotografia (JSON)
);
GO
IF OBJECT_ID(N'dbo.ShopOrderStorico', N'U') IS NULL
BEGIN
	SELECT TOP 0 CAST(0 AS smallint) AS Anno,
		[P/N Motore], [Engine code], [REF. EU FAMILY], [REF. US FAMILY], [Application], [Customer Eng.], [Customer],
		[Tipo Motore], [Omologazione], [ENTE], [PRP], [FGF GROUP], [Status]
	INTO dbo.ShopOrderStorico FROM dbo.ShopOrder;
	CREATE CLUSTERED INDEX CX_ShopOrderStorico ON dbo.ShopOrderStorico (Anno);
END
GO

------------------------------------------------------------------ TAG
USE TAG;
GO
IF OBJECT_ID(N'dbo.Fotografie', N'U') IS NULL
CREATE TABLE dbo.Fotografie (
	Anno     smallint      NOT NULL CONSTRAINT PK_Fotografie PRIMARY KEY,
	DataOra  datetime2(0)  NOT NULL CONSTRAINT DF_Fotografie_DataOra DEFAULT SYSDATETIME(),
	Righe    int           NOT NULL,
	Ultimo   nvarchar(max) NULL
);
GO
IF OBJECT_ID(N'dbo.TAGStorico', N'U') IS NULL
BEGIN
	SELECT TOP 0 CAST(0 AS smallint) AS Anno,
		[Element], [PartNbrEngineering], [VersioneManufacturing], [VStart], [VEnd], [TagElementDescription], [TagElementValue]
	INTO dbo.TAGStorico FROM dbo.TAG;
	CREATE CLUSTERED INDEX CX_TAGStorico ON dbo.TAGStorico (Anno);
END
GO

------------------------------------------------------------------ Tracker EPA/CARB
USE TrackerEPA;
GO
IF OBJECT_ID(N'dbo.Fotografie', N'U') IS NULL
CREATE TABLE dbo.Fotografie (
	Anno     smallint      NOT NULL CONSTRAINT PK_Fotografie PRIMARY KEY,
	DataOra  datetime2(0)  NOT NULL CONSTRAINT DF_Fotografie_DataOra DEFAULT SYSDATETIME(),
	Righe    int           NOT NULL,
	Ultimo   nvarchar(max) NULL
);
GO
IF OBJECT_ID(N'dbo.EpaFamiglieStorico', N'U') IS NULL
BEGIN
	SELECT TOP 0 CAST(0 AS smallint) AS Anno,
		[Famiglia], [Ordine], [EpaSottomissione], [EpaSottomissioneSett], [CarbSottomissione], [CarbSottomissioneSett],
		[EpaApprovazione], [EpaApprovazioneSett], [CarbApprovazione], [CarbApprovazioneSett], [Rischio], [Note], [Dati]
	INTO dbo.EpaFamiglieStorico FROM dbo.EpaFamiglie;
	CREATE CLUSTERED INDEX CX_EpaFamiglieStorico ON dbo.EpaFamiglieStorico (Anno);
END
GO

------------------------------------------------------------------ Controllo
SELECT 'ShopOrder' AS DB, CASE WHEN OBJECT_ID(N'ShopOrder.dbo.Fotografie') IS NOT NULL AND OBJECT_ID(N'ShopOrder.dbo.ShopOrderStorico') IS NOT NULL THEN 'OK' ELSE 'MANCA' END AS Esito
UNION ALL
SELECT 'TAG', CASE WHEN OBJECT_ID(N'TAG.dbo.Fotografie') IS NOT NULL AND OBJECT_ID(N'TAG.dbo.TAGStorico') IS NOT NULL THEN 'OK' ELSE 'MANCA' END
UNION ALL
SELECT 'TrackerEPA', CASE WHEN OBJECT_ID(N'TrackerEPA.dbo.Fotografie') IS NOT NULL AND OBJECT_ID(N'TrackerEPA.dbo.EpaFamiglieStorico') IS NOT NULL THEN 'OK' ELSE 'MANCA' END;
