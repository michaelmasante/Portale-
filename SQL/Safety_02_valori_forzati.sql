-- Valori forzati della Safety: sostituiscono nelle slide il valore FY dell'anno prima calcolato dai dati
-- (es. quando il dato nel file è sbagliato). Eseguire in SSMS (si può rieseguire).
USE Safety;
GO

IF OBJECT_ID(N'dbo.SafetyForzati', N'U') IS NULL
CREATE TABLE dbo.SafetyForzati (
	Perimetro  varchar(10)   NOT NULL,   -- MFG o NMFG
	Nome       nvarchar(50)  NOT NULL,   -- MFG, NMFG o il gruppo (BUS, PWT EU, ...), come in SafetyTarget
	Indice     varchar(10)   NOT NULL,   -- IFI o ISI
	Anno       smallint      NOT NULL,   -- anno del valore FY (2025 = il "2025" delle slide 2026)
	Valore     decimal(9,4)  NOT NULL,
	Nota       nvarchar(200) NULL,
	Inserito   datetime2(0)  NOT NULL CONSTRAINT DF_SafetyForzati_Inserito DEFAULT SYSDATETIME(),
	CONSTRAINT PK_SafetyForzati PRIMARY KEY (Perimetro, Nome, Indice, Anno)
);
GO

-- IFI 2025 di IVG NMFG: nel file è sbagliato (calcolato 0,1148), valore corretto 0,114
MERGE dbo.SafetyForzati AS t
USING (SELECT 'NMFG' AS Perimetro, N'NMFG' AS Nome, 'IFI' AS Indice, CAST(2025 AS smallint) AS Anno,
              CAST(0.114 AS decimal(9,4)) AS Valore, N'Dato del file sbagliato, valore comunicato da chi carica' AS Nota) AS s
ON t.Perimetro = s.Perimetro AND t.Nome = s.Nome AND t.Indice = s.Indice AND t.Anno = s.Anno
WHEN MATCHED THEN UPDATE SET Valore = s.Valore, Nota = s.Nota
WHEN NOT MATCHED THEN INSERT (Perimetro, Nome, Indice, Anno, Valore, Nota) VALUES (s.Perimetro, s.Nome, s.Indice, s.Anno, s.Valore, s.Nota);
GO

SELECT * FROM dbo.SafetyForzati;
-- Per tornare al valore calcolato: DELETE FROM dbo.SafetyForzati WHERE Perimetro = 'NMFG' AND Nome = N'NMFG' AND Indice = 'IFI' AND Anno = 2025;
