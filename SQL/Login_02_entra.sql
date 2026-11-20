-- Accesso con Microsoft Entra ID. Eseguire una volta in SSMS (si può rieseguire)
USE PortaleLogin;
GO

-- Id dell'account Microsoft (claim "oid"): collega per sempre l'utente del Portale al suo account aziendale
IF COL_LENGTH(N'dbo.Utenti', N'EntraOid') IS NULL
	ALTER TABLE dbo.Utenti ADD EntraOid uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Utenti_EntraOid' AND object_id = OBJECT_ID(N'dbo.Utenti'))
	CREATE UNIQUE INDEX UX_Utenti_EntraOid ON dbo.Utenti (EntraOid) WHERE EntraOid IS NOT NULL;
GO

-- Controllo: chi può ancora entrare con utente e password (solo gli Admin) e chi ha l'email per il collegamento automatico
SELECT u.Id, u.Username, u.NomeCompleto, u.Email, u.Attivo,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.UtentiRuoli ur JOIN dbo.Ruoli r ON r.Id = ur.RuoloId WHERE ur.UserId = u.Id AND r.Nome = N'Admin') THEN 'Sì' ELSE '' END AS Admin,
       CASE WHEN u.Email IS NULL THEN 'manca email: si collega solo se Username = account Microsoft' ELSE '' END AS Nota
FROM dbo.Utenti u
ORDER BY u.Attivo DESC, u.Username;
