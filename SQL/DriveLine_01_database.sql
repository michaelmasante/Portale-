-- Eseguire una volta in SSMS sul server del Portale (si può rieseguire)
IF DB_ID(N'DriveLineTest') IS NULL
	CREATE DATABASE DriveLineTest;
GO

USE DriveLineTest;
GO

IF OBJECT_ID(N'dbo.CDA_COSTRUTTORI', N'U') IS NULL
CREATE TABLE dbo.CDA_COSTRUTTORI (
	CDA          nvarchar(20)  NOT NULL CONSTRAINT PK_CDA_COSTRUTTORI PRIMARY KEY,
	Descrizione  nvarchar(100) NULL
);
GO

-- Tipi da correggere dopo il test con la «CREATE TABLE suggerita» della pagina
IF OBJECT_ID(N'dbo.GAN_DRIVELINE_1', N'U') IS NULL
CREATE TABLE dbo.GAN_DRIVELINE_1 (
	Id                  int IDENTITY(1,1) NOT NULL CONSTRAINT PK_GAN_DRIVELINE_1 PRIMARY KEY,
	Chiave              bigint        NULL,
	CDA                 nvarchar(20)  NULL,
	LINEA               nvarchar(20)  NULL,
	GAN                 nvarchar(30)  NULL,
	DISEGNO             nvarchar(40)  NULL,
	CDA_U               nvarchar(20)  NULL,
	COC_CLIENTE         nvarchar(30)  NULL,
	DPA_MOBILE          datetime2(0)  NULL,
	DPI_MOBILE          datetime2(0)  NULL,
	DPI_TIRO            datetime2(0)  NULL,
	DATA_IMPOST         datetime2(0)  NULL,
	DATA_ASSEGNAZIONE   datetime2(0)  NULL,
	STATO               int           NULL,
	SOT_STATO           nvarchar(10)  NULL,
	TIPO_ORDINE         nvarchar(10)  NULL,
	NUMERO_ORDINE       nvarchar(30)  NULL,
	LINEA_ORDINE        nvarchar(20)  NULL,
	ANNULL_FLG          nvarchar(5)   NULL,
	ANNULL_DATE         datetime2(0)  NULL,
	DP_SPED             datetime2(0)  NULL,
	DATA_SPED           datetime2(0)  NULL,
	DATA_EFFETT_DISLIN  datetime2(0)  NULL,
	LAST_UPDATE_DATE    datetime2(0)  NULL,
	MATRICOLA           nvarchar(30)  NULL,
	DATA_EFFETT_DELIB   datetime2(0)  NULL,
	DATA_RILASCIO_LEV3  datetime2(0)  NULL,
	Origine             nvarchar(10)  NULL,
	CaricatoIl          datetime2(0)  NOT NULL CONSTRAINT DF_GAN_DRIVELINE_1_CaricatoIl DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_GAN_DRIVELINE_1_GAN' AND object_id = OBJECT_ID(N'dbo.GAN_DRIVELINE_1'))
	CREATE INDEX IX_GAN_DRIVELINE_1_GAN ON dbo.GAN_DRIVELINE_1 (GAN);
GO

IF OBJECT_ID(N'dbo.GAN_DRIVELINE_Ant_Sped', N'U') IS NULL
CREATE TABLE dbo.GAN_DRIVELINE_Ant_Sped (
	Id                  int IDENTITY(1,1) NOT NULL CONSTRAINT PK_GAN_DRIVELINE_Ant_Sped PRIMARY KEY,
	CDA                 nvarchar(20)  NULL,
	LINEA               nvarchar(20)  NULL,
	GAN                 nvarchar(30)  NULL,
	DISEGNO             nvarchar(40)  NULL,
	CDA_U               nvarchar(20)  NULL,
	COC_CLIENTE         nvarchar(30)  NULL,
	DPA_MOBILE          datetime2(0)  NULL,
	DPI_MOBILE          datetime2(0)  NULL,
	DPI_TIRO            datetime2(0)  NULL,
	DATA_IMPOST         datetime2(0)  NULL,
	DATA_ASSEGNAZIONE   datetime2(0)  NULL,
	STATO               int           NULL,
	SOT_STATO           nvarchar(10)  NULL,
	TIPO_ORDINE         nvarchar(10)  NULL,
	NUMERO_ORDINE       nvarchar(30)  NULL,
	LINEA_ORDINE        nvarchar(20)  NULL,
	ANNULL_FLG          nvarchar(5)   NULL,
	DP_SPED             datetime2(0)  NULL,
	DATA_SPED           datetime2(0)  NULL,
	DATA_EFFETT_DISLIN  datetime2(0)  NULL,
	LAST_UPDATE_DATE    datetime2(0)  NULL,
	Anno_DP_SPED        AS YEAR(DP_SPED),
	Anno_DATA_SPED      AS YEAR(DATA_SPED),
	DATA_EFFETT_DELIB   datetime2(0)  NULL,
	DATA_RILASCIO_LEV3  datetime2(0)  NULL,
	Origine             nvarchar(10)  NULL,
	CaricatoIl          datetime2(0)  NOT NULL CONSTRAINT DF_GAN_DRIVELINE_Ant_Sped_CaricatoIl DEFAULT SYSDATETIME()
);
GO

IF OBJECT_ID(N'dbo.N09J0121_DLT', N'U') IS NULL
CREATE TABLE dbo.N09J0121_DLT (
	Id            int IDENTITY(1,1) NOT NULL CONSTRAINT PK_N09J0121_DLT PRIMARY KEY,
	Cda           nvarchar(10)  NULL,
	Linea         nvarchar(10)  NULL,
	Tipo_Ordine   nvarchar(5)   NULL,
	Gan           nvarchar(20)  NULL,
	Disegno       nvarchar(30)  NULL,
	Matricola     nvarchar(20)  NULL,
	Cda_U         nvarchar(10)  NULL,
	Cod_Cliente   nvarchar(10)  NULL,
	Data_Imp      date          NULL,
	Data_Dis_Lin  date          NULL,
	Data_Finiz    date          NULL,
	Data_Sped     date          NULL,
	Stato         int           NULL,
	Sotto_Stato   nvarchar(5)   NULL,
	Data_Ult_Var  date          NULL,
	Ora_Ult_Var   nvarchar(6)   NULL,
	Polmone       nvarchar(10)  NULL,
	Data_Seq      date          NULL,
	Num_Seq       int           NULL,
	Data_Ord      date          NULL,
	Origine       nvarchar(10)  NULL,
	CaricatoIl    datetime2(0)  NOT NULL CONSTRAINT DF_N09J0121_DLT_CaricatoIl DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_N09J0121_DLT_Gan' AND object_id = OBJECT_ID(N'dbo.N09J0121_DLT'))
	CREATE INDEX IX_N09J0121_DLT_Gan ON dbo.N09J0121_DLT (Gan) INCLUDE (Stato, Data_Imp);
GO

IF OBJECT_ID(N'dbo.Stato35', N'V') IS NOT NULL
	DROP VIEW dbo.Stato35;
GO
CREATE VIEW dbo.Stato35
AS
SELECT Cda, Linea, Tipo_Ordine, Gan, Disegno, Matricola, Cda_U, Cod_Cliente,
       Data_Imp, Data_Dis_Lin, Data_Finiz, Data_Sped, Stato, Sotto_Stato,
       Data_Ult_Var, Ora_Ult_Var, Polmone, Data_Seq, Num_Seq, Data_Ord
FROM dbo.N09J0121_DLT
WHERE Stato < 95;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'ToolUser')
	CREATE USER ToolUser FOR LOGIN ToolUser;
GO
ALTER ROLE db_datareader ADD MEMBER ToolUser;
ALTER ROLE db_datawriter ADD MEMBER ToolUser;
GO

-- Facoltativo: ruolo DriveLine nel Portale (senza, la pagina la apre solo Admin)
USE PortaleLogin;
GO
IF NOT EXISTS (SELECT 1 FROM dbo.Ruoli WHERE Nome = N'DriveLine')
	INSERT INTO dbo.Ruoli (Nome, Descrizione) VALUES (N'DriveLine', N'Pagina DriveLine (test di collegamento al database DriveLine)');
GO

USE DriveLineTest;
SELECT name, type_desc FROM sys.objects WHERE type IN ('U', 'V') ORDER BY name;
