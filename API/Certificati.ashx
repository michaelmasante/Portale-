<%@ WebHandler Language="C#" Class="CertificatiHandler" %>

/*
 * Certificati (pagina Certificati.html). Shop Order e TAG stanno in due database:
 *   "ShopOrder" (tabella dbo.ShopOrder) e "TAG" (tabella dbo.TAG), stringhe di connessione con lo stesso nome nel Web.config.
 * Le colonne delle due tabelle hanno gli stessi nomi delle intestazioni del file Excel ("P/N Motore", "Engine code"...),
 * tutte di testo (anche VStart e VEnd, scritte come aaaa-mm-gg): nel codice si scrivono fra parentesi quadre.
 * Utenti e ruoli da PortaleLogin, come le altre pagine.
 *
 * Azioni:
 *   GET  ?health=1               controllo veloce dei due database
 *   GET  ?action=shoporder       tutti gli Shop Order  { colonne: [nomi come nel file Excel], righe: [[...], ...] }
 *   GET  ?action=tag             tutti i TAG           { colonne, righe, foglio (del file TAG caricato per ultimo) }
 *   GET  ?action=epa             famiglie del Tracker EPA (database "TrackerEPA"), con l'ultimo caricamento
 *   GET  ?action=caricamenti     ultimi caricamenti dei tre tipi di file
 *   POST ?action=carica          { tipo: "shoporder" | "tag", file, foglio, colonne: [nomi], righe: [[...], ...] }
 *
 * Caricamento (il file e' letto nel browser, qui arrivano solo le colonne che servono):
 *   - Shop Order: AGGIUNGE i P/N Motore nuovi e AGGIORNA quelli gia' presenti. Non cancella mai nulla.
 *     Le colonne che nel file non ci sono restano come sono nel database.
 *   - TAG: il file e' l'elenco completo, quindi SOSTITUISCE tutti i TAG.
 *   - Tracker EPA: il file e' la fotografia dello stato, quindi SOSTITUISCE tutte le famiglie.
 *     Il file (due righe di intestazione, piani PO09R/PO10R...) lo interpreta la pagina: qui arrivano campi fissi
 *     piu' il resto della riga in JSON (colonna Dati).
 *   In tutti e due i casi un'unica transazione: o va tutto o non cambia niente.
 *
 * Ruoli: "Certificati" vede; "Certificati Upload" vede e carica; Admin fa tutto. Controllo fatto qui, a ogni richiesta.
 * C# 5 (compilatore di default di ASP.NET), come gli altri .ashx del Portale.
 */

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.Text;
using System.Web;
using System.Web.Script.Serialization;

public class CertificatiHandler : IHttpHandler
{
	private const string ShopConnection = "ShopOrder";
	private const string TagConnection = "TAG";
	private const string EpaConnection = "TrackerEPA";
	private const string LoginConnection = "PortaleLogin";
	private const string Admin = "Admin";
	private const string RuoloUpload = "Certificati Upload";
	private static readonly string[] RuoliAccesso = { "Certificati", RuoloUpload, Admin };
	private const int MaxBodyChars = 100 * 1024 * 1024;   // il file Shop Order piu' grande manda circa 5 MB
	private const int MaxRighe = 500000;
	private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

	// Colonna: nome nel file Excel (= intestazione mostrata nella pagina), colonna nel database, lunghezza massima (0 = data)
	private class Col
	{
		public string Excel;
		public string Db;
		public int Max;
		public Col(string excel, string db, int max) { Excel = excel; Db = db; Max = max; }
		public bool IsDate { get { return Max == 0; } }
		// nome per l'SQL: fra parentesi quadre, perche' contiene spazi, punti e "/"
		public string Q { get { return "[" + Db.Replace("]", "]]") + "]"; } }
	}

	// Shop Order: la prima e' la chiave
	private static readonly Col[] ShopCols = {
		new Col("P/N Motore", "P/N Motore", 255),
		new Col("Engine code", "Engine code", 255),
		new Col("REF. EU FAMILY", "REF. EU FAMILY", 255),
		new Col("REF. US FAMILY", "REF. US FAMILY", 255),
		new Col("Application", "Application", 255),
		new Col("Customer Eng.", "Customer Eng.", 255),
		new Col("Customer", "Customer", 255),
		new Col("Tipo Motore", "Tipo Motore", 255),
		new Col("Omologazione", "Omologazione", 255),
		new Col("ENTE", "ENTE", 255),
		new Col("PRP", "PRP", 255),
		new Col("FGF GROUP", "FGF GROUP", 255),
		new Col("Status", "Status", 50)
	};

	// TAG: tutte le colonne del file. Obbligatorie: Element, VStart, VEnd, TagElementDescription
	private static readonly Col[] TagCols = {
		new Col("Element", "Element", 255),
		new Col("PartNbrEngineering", "PartNbrEngineering", 255),
		new Col("VersioneManufacturing", "VersioneManufacturing", 255),
		new Col("VStart", "VStart", 0),
		new Col("VEnd", "VEnd", 0),
		new Col("TagElementDescription", "TagElementDescription", 255),
		new Col("TagElementValue", "TagElementValue", 255)
	};
	private static readonly string[] TagObbligatorie = { "Element", "VStart", "VEnd", "TagElementDescription" };
	// colonne che la pagina usa (le altre si salvano soltanto)
	private static readonly string[] TagLette = { "Element", "VStart", "VEnd", "TagElementDescription" };

	// Tracker EPA: nomi decisi dalla pagina (CaricaExcel.js), uguali alle colonne di dbo.EpaFamiglie. Max > 4000 = NVARCHAR(MAX)
	private static readonly Col[] EpaCols = {
		new Col("Famiglia", "Famiglia", 50),
		new Col("Ordine", "Ordine", 20),
		new Col("EpaSottomissione", "EpaSottomissione", 100),
		new Col("EpaSottomissioneSett", "EpaSottomissioneSett", 50),
		new Col("CarbSottomissione", "CarbSottomissione", 100),
		new Col("CarbSottomissioneSett", "CarbSottomissioneSett", 50),
		new Col("EpaApprovazione", "EpaApprovazione", 100),
		new Col("EpaApprovazioneSett", "EpaApprovazioneSett", 50),
		new Col("CarbApprovazione", "CarbApprovazione", 100),
		new Col("CarbApprovazioneSett", "CarbApprovazioneSett", 50),
		new Col("Rischio", "Rischio", 50),
		new Col("Note", "Note", 4000),
		new Col("Dati", "Dati", 1000000)
	};

	private class UserException : Exception
	{
		public UserException(string message) : base(message) { }
	}

	private class ForbiddenException : Exception
	{
		public ForbiddenException(string message) : base(message) { }
	}

	private class Utente
	{
		public string Username = "";
		public string Nome = "";
		public List<string> Ruoli = new List<string>();

		public bool Ha(string ruolo)
		{
			foreach (string r in Ruoli)
				if (string.Equals(r, ruolo, StringComparison.OrdinalIgnoreCase) || string.Equals(r, Admin, StringComparison.OrdinalIgnoreCase)) return true;
			return false;
		}

		public bool HaUno(string[] ruoli)
		{
			foreach (string r in ruoli) if (Ha(r)) return true;
			return false;
		}
	}

	public bool IsReusable
	{
		get { return true; }
	}

	public void ProcessRequest(HttpContext context)
	{
		HttpResponse res = context.Response;
		res.ContentType = "application/json";
		res.ContentEncoding = Encoding.UTF8;
		res.Cache.SetCacheability(HttpCacheability.NoCache);
		res.Cache.SetNoStore();

		try
		{
			HttpRequest req = context.Request;
			if (req.QueryString["health"] != null) { Health(context); return; }

			string action = (req.QueryString["action"] ?? "").Trim().ToLowerInvariant();
			Utente u = CaricaUtente(context);

			if (action == "shoporder") { ShopOrder(context); return; }
			if (action == "tag") { Tag(context); return; }
			if (action == "epa") { Epa(context); return; }
			if (action == "caricamenti") { Caricamenti(context); return; }
			if (action == "carica")
			{
				if (!u.Ha(RuoloUpload)) throw new ForbiddenException("Per caricare i file serve il ruolo \"" + RuoloUpload + "\". Chiedilo a un amministratore.");
				if (req.HttpMethod != "POST" || req.Headers["X-Portale"] != "1") throw new UserException("Richiesta non valida.");
				Carica(context, u, ReadJson(context));
				return;
			}
			throw new UserException("Richiesta non valida.");
		}
		catch (ForbiddenException ex)
		{
			res.StatusCode = 403;
			res.TrySkipIisCustomErrors = true;
			Error(context, ex.Message, null);
		}
		catch (UserException ex)
		{
			Error(context, ex.Message, null);
		}
		catch (Exception ex)
		{
			res.StatusCode = 500;
			res.TrySkipIisCustomErrors = true;
			Error(context, "Errore del server. Riprova o avvisa chi gestisce il Portale.", context.Request.IsLocal ? ex.Message : null);
		}
	}

	// ================= utente e ruoli (come Safety.ashx) =================

	private static Utente CaricaUtente(HttpContext ctx)
	{
		Utente u = new Utente();

		string sviluppo = ConfigurationManager.AppSettings["LoginSviluppo"];
		if (!string.IsNullOrWhiteSpace(sviluppo) && ctx.Request.IsLocal)
		{
			u.Username = "sviluppo";
			u.Nome = "Sviluppo (locale)";
			foreach (string r in sviluppo.Split(',')) if (r.Trim().Length > 0) u.Ruoli.Add(r.Trim());
		}
		else
		{
			if (ctx.User == null || !ctx.User.Identity.IsAuthenticated) throw new ForbiddenException("Sessione scaduta: rientra nel Portale.");
			u.Username = ctx.User.Identity.Name;
			bool trovato = false;
			using (SqlConnection cn = Open(LoginConnection))
			using (SqlCommand cmd = new SqlCommand(
				"SELECT u.NomeCompleto, r.Nome FROM dbo.Utenti u " +
				"LEFT JOIN dbo.UtentiRuoli ur ON ur.UserId = u.Id " +
				"LEFT JOIN dbo.Ruoli r ON r.Id = ur.RuoloId " +
				"WHERE u.Username = @u AND u.Attivo = 1", cn))
			{
				cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = u.Username;
				using (SqlDataReader r = cmd.ExecuteReader())
				{
					while (r.Read())
					{
						trovato = true;
						u.Nome = r.IsDBNull(0) ? u.Username : r.GetString(0);
						if (!r.IsDBNull(1)) u.Ruoli.Add(r.GetString(1));
					}
				}
			}
			if (!trovato) throw new ForbiddenException("Utente non attivo: rientra nel Portale.");
		}

		if (!u.HaUno(RuoliAccesso)) throw new ForbiddenException("Non hai il ruolo Certificati. Chiedilo a un amministratore.");
		return u;
	}

	// ================= lettura =================

	private static void ShopOrder(HttpContext ctx)
	{
		List<string> colonne = new List<string>();
		StringBuilder sql = new StringBuilder("SELECT ");
		for (int i = 0; i < ShopCols.Length; i++)
		{
			colonne.Add(ShopCols[i].Excel);
			sql.Append(i == 0 ? "" : ", ").Append(ShopCols[i].Q);
		}
		sql.Append(" FROM dbo.ShopOrder ORDER BY ").Append(ShopCols[0].Q);

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["colonne"] = colonne;
		using (SqlConnection cn = Open(ShopConnection))
		{
			d["righe"] = LeggiRighe(cn, sql.ToString(), ShopCols.Length);
			d["ultimo"] = UltimoCaricamento(cn);
		}
		Reply(ctx, d);
	}

	private static void Tag(HttpContext ctx)
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["colonne"] = TagLette;
		using (SqlConnection cn = Open(TagConnection))
		{
			d["righe"] = LeggiRighe(cn,
				"SELECT [Element], [VStart], [VEnd], [TagElementDescription] FROM dbo.TAG ORDER BY [Element], [VStart], [TagElementDescription]",
				TagLette.Length);
			Dictionary<string, object> ultimo = UltimoCaricamento(cn);
			d["ultimo"] = ultimo;
			d["foglio"] = ultimo == null ? "" : ultimo["foglio"];
		}
		Reply(ctx, d);
	}

	private static void Epa(HttpContext ctx)
	{
		List<string> colonne = new List<string>();
		StringBuilder sql = new StringBuilder("SELECT ");
		for (int i = 0; i < EpaCols.Length; i++)
		{
			colonne.Add(EpaCols[i].Excel);
			sql.Append(i == 0 ? "" : ", ").Append(EpaCols[i].Q);
		}
		sql.Append(" FROM dbo.EpaFamiglie ORDER BY TRY_CAST(Ordine AS INT), Famiglia");

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["colonne"] = colonne;
		using (SqlConnection cn = Open(EpaConnection))
		{
			d["righe"] = LeggiRighe(cn, sql.ToString(), EpaCols.Length);
			d["ultimo"] = UltimoCaricamento(cn);
		}
		Reply(ctx, d);
	}

	// Righe come array di valori: testo, date come aaaa-mm-gg, vuoti come null (piu' leggero di un oggetto per riga)
	private static List<object[]> LeggiRighe(SqlConnection cn, string sql, int n)
	{
		List<object[]> righe = new List<object[]>();
		using (SqlCommand cmd = new SqlCommand(sql, cn))
		{
			cmd.CommandTimeout = 120;
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				while (r.Read())
				{
					object[] riga = new object[n];
					for (int i = 0; i < n; i++)
					{
						if (r.IsDBNull(i)) riga[i] = null;
						else
						{
							object v = r.GetValue(i);
							riga[i] = v is DateTime ? ((DateTime)v).ToString("yyyy-MM-dd", Inv) : Convert.ToString(v, Inv);
						}
					}
					righe.Add(riga);
				}
			}
		}
		return righe;
	}

	private static Dictionary<string, object> UltimoCaricamento(SqlConnection cn)
	{
		List<Dictionary<string, object>> l = UltimiCaricamenti(cn, 1);
		return l.Count > 0 ? l[0] : null;
	}

	private static List<Dictionary<string, object>> UltimiCaricamenti(SqlConnection cn, int quanti)
	{
		List<Dictionary<string, object>> l = new List<Dictionary<string, object>>();
		// le colonne dei conteggi sono diverse nei due database (Aggiornate / Tolte): si leggono tutte con *
		using (SqlCommand cmd = new SqlCommand("SELECT TOP (" + quanti.ToString(Inv) + ") * FROM dbo.Caricamenti ORDER BY Id DESC", cn))
		using (SqlDataReader r = cmd.ExecuteReader())
		{
			while (r.Read())
			{
				Dictionary<string, object> c = new Dictionary<string, object>();
				for (int i = 0; i < r.FieldCount; i++)
				{
					string nome = r.GetName(i);
					object v = r.IsDBNull(i) ? null : r.GetValue(i);
					if (v is DateTime) v = ((DateTime)v).ToString("yyyy-MM-dd HH:mm", Inv);
					c[nome.Substring(0, 1).ToLowerInvariant() + nome.Substring(1)] = v;
				}
				// nomi brevi usati dalla pagina
				c["data"] = c.ContainsKey("dataOra") ? c["dataOra"] : null;
				c["utente"] = c.ContainsKey("nomeUtente") && c["nomeUtente"] != null ? c["nomeUtente"] : (c.ContainsKey("username") ? c["username"] : null);
				c["file"] = c.ContainsKey("nomeFile") ? c["nomeFile"] : null;
				l.Add(c);
			}
		}
		return l;
	}

	private static void Caricamenti(HttpContext ctx)
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		using (SqlConnection cn = Open(ShopConnection)) d["shoporder"] = UltimiCaricamenti(cn, 10);
		using (SqlConnection cn = Open(TagConnection)) d["tag"] = UltimiCaricamenti(cn, 10);
		// Tracker EPA: se il database non c'e' ancora, gli altri due elenchi si vedono lo stesso
		try { using (SqlConnection cn = Open(EpaConnection)) d["epa"] = UltimiCaricamenti(cn, 10); }
		catch (Exception ex) { d["epa"] = new List<object>(); d["epaErrore"] = ex.Message; }
		Reply(ctx, d);
	}

	// ================= caricamento =================

	private static void Carica(HttpContext ctx, Utente u, Dictionary<string, object> body)
	{
		string tipo = Str(body, "tipo").Trim().ToLowerInvariant();
		Col[] tutte;
		if (tipo == "shoporder") tutte = ShopCols;
		else if (tipo == "tag") tutte = TagCols;
		else if (tipo == "epa") tutte = EpaCols;
		else throw new UserException("Tipo di file sconosciuto.");

		string file = Cut(StrOpt(body, "file"), 260);
		string foglio = Cut(StrOpt(body, "foglio"), 100);

		// colonne mandate dalla pagina: solo nomi conosciuti, ognuno una volta, la chiave sempre
		object[] nomi = Arr(body, "colonne", 100);
		List<Col> cols = new List<Col>();
		foreach (object o in nomi)
		{
			string nome = o as string;
			Col c = null;
			foreach (Col x in tutte) if (string.Equals(x.Excel, nome, StringComparison.OrdinalIgnoreCase)) c = x;
			if (c == null) throw new UserException("Colonna sconosciuta: " + nome + ".");
			if (cols.Contains(c)) throw new UserException("Colonna ripetuta: " + c.Excel + ".");
			cols.Add(c);
		}
		if (cols.Count == 0 || cols[0] != tutte[0]) throw new UserException("La prima colonna deve essere \"" + tutte[0].Excel + "\".");
		if (tipo == "tag")
			foreach (string ob in TagObbligatorie)
			{
				bool c = false;
				foreach (Col x in cols) if (x.Excel == ob) c = true;
				if (!c) throw new UserException("Nel file TAG manca la colonna \"" + ob + "\".");
			}

		object[] righe = Arr(body, "righe", MaxRighe);
		if (righe.Length == 0) throw new UserException("Il file non contiene righe.");
		object[] numeri = body.ContainsKey("numeri") ? body["numeri"] as object[] : null; // numero di riga nel file Excel, per i messaggi

		// tabella in memoria con i valori controllati
		DataTable dt = new DataTable();
		foreach (Col c in cols) dt.Columns.Add(c.Db, typeof(string));
		List<string> errori = new List<string>();
		HashSet<string> chiavi = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
		for (int i = 0; i < righe.Length && errori.Count < 20; i++)
		{
			string dove = "Riga " + (numeri != null && i < numeri.Length && numeri[i] != null ? Convert.ToString(numeri[i], Inv) : (i + 1).ToString(Inv));
			object[] riga = righe[i] as object[];
			if (riga == null || riga.Length != cols.Count) throw new UserException("Richiesta non valida (riga " + (i + 1) + ").");
			DataRow dr = dt.NewRow();
			for (int j = 0; j < cols.Count; j++)
			{
				Col c = cols[j];
				string v = riga[j] == null ? null : Convert.ToString(riga[j], Inv).Trim();
				if (v != null && (v.Length == 0 || string.Equals(v, "NULL", StringComparison.OrdinalIgnoreCase))) v = null;
				if (v == null) { dr[j] = DBNull.Value; continue; }
				if (c.IsDate)
				{
					DateTime data;
					if (!DateTime.TryParseExact(v, "yyyy-MM-dd", Inv, DateTimeStyles.None, out data)) { errori.Add(dove + ", " + c.Excel + ": data non valida (" + v + ")."); continue; }
					dr[j] = data.ToString("yyyy-MM-dd", Inv);
				}
				else
				{
					if (v.Length > c.Max) { errori.Add(dove + ", " + c.Excel + ": testo troppo lungo (" + v.Length + " caratteri, massimo " + c.Max + ")."); continue; }
					dr[j] = v;
				}
			}
			if (dr[0] == DBNull.Value) { errori.Add(dove + ": manca " + cols[0].Excel + "."); continue; }

			// chiave ripetuta: Shop Order = P/N Motore; TAG = Element + PartNbrEngineering + VersioneManufacturing + VStart + TagElementDescription
			string chiave = tipo == "tag" ? ChiaveTag(dr, cols) : (string)dr[0];
			if (!chiavi.Add(chiave)) { errori.Add(dove + ": " + (tipo != "tag" ? cols[0].Excel + " " + chiave + " ripetuto nel file." : "TAG ripetuto nel file (" + chiave.Replace("\u0001", " | ") + ").")); continue; }
			dt.Rows.Add(dr);
		}
		if (errori.Count > 0) throw new UserException("Il file ha errori, nel database non e' cambiato niente: " + string.Join(" ", errori.ToArray()));

		Dictionary<string, object> d = tipo == "shoporder" ? CaricaShopOrder(dt, cols, u, file, foglio)
			: tipo == "tag" ? CaricaTag(dt, cols, u, file, foglio)
			: CaricaEpa(dt, cols, u, file, foglio);
		d["ok"] = true;
		d["righe"] = dt.Rows.Count;
		Reply(ctx, d);
	}

	private static string ChiaveTag(DataRow dr, List<Col> cols)
	{
		string[] parti = new string[5];
		string[] nomi = { "Element", "PartNbrEngineering", "VersioneManufacturing", "VStart", "TagElementDescription" };
		for (int k = 0; k < nomi.Length; k++)
		{
			parti[k] = "";
			for (int j = 0; j < cols.Count; j++)
			{
				if (cols[j].Excel != nomi[k] || dr[j] == DBNull.Value) continue;
				parti[k] = dr[j] is DateTime ? ((DateTime)dr[j]).ToString("yyyy-MM-dd", Inv) : (string)dr[j];
			}
		}
		return string.Join("\u0001", parti);
	}

	// Tabella temporanea con le stesse colonne (stessa collation del database, cosi' i confronti funzionano)
	private static void CopiaInTemp(SqlConnection cn, SqlTransaction tx, string temp, DataTable dt, List<Col> cols, bool chiave)
	{
		StringBuilder sql = new StringBuilder("CREATE TABLE " + temp + " (");
		for (int j = 0; j < cols.Count; j++)
		{
			Col c = cols[j];
			sql.Append(j == 0 ? "" : ", ").Append(c.Q).Append(" NVARCHAR(" + (c.IsDate ? "10" : c.Max > 4000 ? "MAX" : c.Max.ToString(Inv)) + ") COLLATE DATABASE_DEFAULT " + (j == 0 ? "NOT NULL" : "NULL"));
		}
		if (chiave) sql.Append(", PRIMARY KEY (").Append(cols[0].Q).Append(")");
		sql.Append(");");
		using (SqlCommand cmd = new SqlCommand(sql.ToString(), cn, tx)) cmd.ExecuteNonQuery();

		using (SqlBulkCopy bc = new SqlBulkCopy(cn, SqlBulkCopyOptions.Default, tx))
		{
			bc.DestinationTableName = temp;
			bc.BulkCopyTimeout = 600;
			bc.BatchSize = 5000;
			foreach (Col c in cols) bc.ColumnMappings.Add(c.Db, c.Db);
			bc.WriteToServer(dt);
		}
	}

	// Shop Order: aggiunge i nuovi, aggiorna quelli cambiati, non cancella niente
	private static Dictionary<string, object> CaricaShopOrder(DataTable dt, List<Col> cols, Utente u, string file, string foglio)
	{
		int nuove = 0, aggiornate = 0;
		using (SqlConnection cn = Open(ShopConnection))
		using (SqlTransaction tx = cn.BeginTransaction())
		{
			CopiaInTemp(cn, tx, "#Carica", dt, cols, true);

			StringBuilder elenco = new StringBuilder(), sorgente = new StringBuilder(), destinazione = new StringBuilder(), set = new StringBuilder();
			for (int j = 0; j < cols.Count; j++)
			{
				string c = cols[j].Q;
				elenco.Append(j == 0 ? "" : ", ").Append(c);
				if (j == 0) continue;
				sorgente.Append(sorgente.Length == 0 ? "" : ", ").Append("s.").Append(c);
				destinazione.Append(destinazione.Length == 0 ? "" : ", ").Append("t.").Append(c);
				set.Append("t.").Append(c).Append(" = s.").Append(c).Append(", ");
			}
			StringBuilder valori = new StringBuilder();
			foreach (Col c in cols) valori.Append(valori.Length == 0 ? "" : ", ").Append("s.").Append(c.Q);

			string sql =
				"DECLARE @esito TABLE (azione NVARCHAR(10)); " +
				"MERGE dbo.ShopOrder AS t USING #Carica AS s ON t." + cols[0].Q + " = s." + cols[0].Q + " " +
				// aggiorna solo se almeno un valore e' diverso (EXCEPT confronta anche i vuoti)
				(cols.Count > 1
					? "WHEN MATCHED AND EXISTS (SELECT " + sorgente + " EXCEPT SELECT " + destinazione + ") THEN UPDATE SET " + set + "t.AggiornatoIl = SYSDATETIME() "
					: "") +
				"WHEN NOT MATCHED BY TARGET THEN INSERT (" + elenco + ") VALUES (" + valori + ") " +
				"OUTPUT $action INTO @esito; " +
				"SELECT ISNULL(SUM(CASE WHEN azione = 'INSERT' THEN 1 ELSE 0 END), 0), ISNULL(SUM(CASE WHEN azione = 'UPDATE' THEN 1 ELSE 0 END), 0) FROM @esito;";
			using (SqlCommand cmd = new SqlCommand(sql, cn, tx))
			{
				cmd.CommandTimeout = 600;
				using (SqlDataReader r = cmd.ExecuteReader())
				{
					if (r.Read()) { nuove = r.GetInt32(0); aggiornate = r.GetInt32(1); }
				}
			}

			List<string> nomiColonne = new List<string>();
			foreach (Col c in cols) nomiColonne.Add(c.Excel);
			using (SqlCommand cmd = new SqlCommand(
				"INSERT INTO dbo.Caricamenti (Username, NomeUtente, NomeFile, Foglio, Righe, Nuove, Aggiornate, Invariate, Colonne) " +
				"VALUES (@u, @n, @f, @fg, @r, @nu, @ag, @in, @c)", cn, tx))
			{
				cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = Cut(u.Username, 50);
				cmd.Parameters.Add("@n", SqlDbType.NVarChar, 150).Value = Cut(u.Nome, 150);
				cmd.Parameters.Add("@f", SqlDbType.NVarChar, 260).Value = (object)file ?? DBNull.Value;
				cmd.Parameters.Add("@fg", SqlDbType.NVarChar, 100).Value = (object)foglio ?? DBNull.Value;
				cmd.Parameters.Add("@r", SqlDbType.Int).Value = dt.Rows.Count;
				cmd.Parameters.Add("@nu", SqlDbType.Int).Value = nuove;
				cmd.Parameters.Add("@ag", SqlDbType.Int).Value = aggiornate;
				cmd.Parameters.Add("@in", SqlDbType.Int).Value = dt.Rows.Count - nuove - aggiornate;
				cmd.Parameters.Add("@c", SqlDbType.NVarChar, 1000).Value = Cut(string.Join(", ", nomiColonne.ToArray()), 1000);
				cmd.ExecuteNonQuery();
			}
			tx.Commit();
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["nuove"] = nuove;
		d["aggiornate"] = aggiornate;
		d["invariate"] = dt.Rows.Count - nuove - aggiornate;
		return d;
	}

	// TAG: il contenuto della tabella diventa quello del file
	private static Dictionary<string, object> CaricaTag(DataTable dt, List<Col> cols, Utente u, string file, string foglio)
	{
		int nuove = 0, tolte = 0;
		using (SqlConnection cn = Open(TagConnection))
		using (SqlTransaction tx = cn.BeginTransaction())
		{
			CopiaInTemp(cn, tx, "#Carica", dt, cols, false);

			// colonne del database: quelle che il file non ha restano vuote
			StringBuilder tutteDb = new StringBuilder(), daFile = new StringBuilder();
			foreach (Col c in TagCols)
			{
				tutteDb.Append(tutteDb.Length == 0 ? "" : ", ").Append(c.Q);
				daFile.Append(daFile.Length == 0 ? "" : ", ");
				daFile.Append(cols.Contains(c) ? c.Q : "CAST(NULL AS NVARCHAR(255)) AS " + c.Q); // il nome serve nelle sottoquery con EXCEPT
			}

			string sql =
				"SELECT " +
				"(SELECT COUNT(*) FROM (SELECT " + daFile + " FROM #Carica EXCEPT SELECT " + tutteDb + " FROM dbo.TAG) x), " +
				"(SELECT COUNT(*) FROM (SELECT " + tutteDb + " FROM dbo.TAG EXCEPT SELECT " + daFile + " FROM #Carica) y);";
			using (SqlCommand cmd = new SqlCommand(sql, cn, tx))
			{
				cmd.CommandTimeout = 600;
				using (SqlDataReader r = cmd.ExecuteReader())
				{
					if (r.Read()) { nuove = r.GetInt32(0); tolte = r.GetInt32(1); }
				}
			}
			// comando a parte (non dentro il reader qui sopra): cosi' un errore qui arriva subito e la transazione non si chiude
			using (SqlCommand cmd = new SqlCommand("DELETE FROM dbo.TAG; INSERT INTO dbo.TAG (" + tutteDb + ") SELECT " + daFile + " FROM #Carica;", cn, tx))
			{
				cmd.CommandTimeout = 600;
				cmd.ExecuteNonQuery();
			}

			using (SqlCommand cmd = new SqlCommand(
				"INSERT INTO dbo.Caricamenti (Username, NomeUtente, NomeFile, Foglio, Righe, Nuove, Tolte, Invariate) " +
				"VALUES (@u, @n, @f, @fg, @r, @nu, @to, @in)", cn, tx))
			{
				cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = Cut(u.Username, 50);
				cmd.Parameters.Add("@n", SqlDbType.NVarChar, 150).Value = Cut(u.Nome, 150);
				cmd.Parameters.Add("@f", SqlDbType.NVarChar, 260).Value = (object)file ?? DBNull.Value;
				cmd.Parameters.Add("@fg", SqlDbType.NVarChar, 100).Value = (object)foglio ?? DBNull.Value;
				cmd.Parameters.Add("@r", SqlDbType.Int).Value = dt.Rows.Count;
				cmd.Parameters.Add("@nu", SqlDbType.Int).Value = nuove;
				cmd.Parameters.Add("@to", SqlDbType.Int).Value = tolte;
				cmd.Parameters.Add("@in", SqlDbType.Int).Value = dt.Rows.Count - nuove;
				cmd.ExecuteNonQuery();
			}
			tx.Commit();
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["nuove"] = nuove;
		d["tolte"] = tolte;
		d["invariate"] = dt.Rows.Count - nuove;
		return d;
	}

	// Tracker EPA: il contenuto della tabella diventa quello del file (una riga per famiglia)
	private static Dictionary<string, object> CaricaEpa(DataTable dt, List<Col> cols, Utente u, string file, string foglio)
	{
		int nuove = 0, tolte = 0;
		using (SqlConnection cn = Open(EpaConnection))
		using (SqlTransaction tx = cn.BeginTransaction())
		{
			CopiaInTemp(cn, tx, "#Carica", dt, cols, true);

			StringBuilder tutteDb = new StringBuilder(), daFile = new StringBuilder();
			foreach (Col c in EpaCols)
			{
				tutteDb.Append(tutteDb.Length == 0 ? "" : ", ").Append(c.Q);
				daFile.Append(daFile.Length == 0 ? "" : ", ");
				daFile.Append(cols.Contains(c) ? c.Q : "CAST(NULL AS NVARCHAR(100)) AS " + c.Q);
			}

			using (SqlCommand cmd = new SqlCommand(
				"SELECT (SELECT COUNT(*) FROM #Carica s WHERE NOT EXISTS (SELECT 1 FROM dbo.EpaFamiglie t WHERE t.Famiglia = s.Famiglia)), " +
				"(SELECT COUNT(*) FROM dbo.EpaFamiglie t WHERE NOT EXISTS (SELECT 1 FROM #Carica s WHERE s.Famiglia = t.Famiglia));", cn, tx))
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				if (r.Read()) { nuove = r.GetInt32(0); tolte = r.GetInt32(1); }
			}
			using (SqlCommand cmd = new SqlCommand("DELETE FROM dbo.EpaFamiglie; INSERT INTO dbo.EpaFamiglie (" + tutteDb + ") SELECT " + daFile + " FROM #Carica;", cn, tx))
			{
				cmd.CommandTimeout = 600;
				cmd.ExecuteNonQuery();
			}

			using (SqlCommand cmd = new SqlCommand(
				"INSERT INTO dbo.Caricamenti (Username, NomeUtente, NomeFile, Foglio, Righe, Nuove, Tolte, Invariate) " +
				"VALUES (@u, @n, @f, @fg, @r, @nu, @to, @in)", cn, tx))
			{
				cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = Cut(u.Username, 50);
				cmd.Parameters.Add("@n", SqlDbType.NVarChar, 150).Value = Cut(u.Nome, 150);
				cmd.Parameters.Add("@f", SqlDbType.NVarChar, 260).Value = (object)file ?? DBNull.Value;
				cmd.Parameters.Add("@fg", SqlDbType.NVarChar, 100).Value = (object)foglio ?? DBNull.Value;
				cmd.Parameters.Add("@r", SqlDbType.Int).Value = dt.Rows.Count;
				cmd.Parameters.Add("@nu", SqlDbType.Int).Value = nuove;
				cmd.Parameters.Add("@to", SqlDbType.Int).Value = tolte;
				cmd.Parameters.Add("@in", SqlDbType.Int).Value = dt.Rows.Count - nuove;
				cmd.ExecuteNonQuery();
			}
			tx.Commit();
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["nuove"] = nuove;
		d["tolte"] = tolte;
		d["invariate"] = dt.Rows.Count - nuove;
		return d;
	}

	// ================= controllo =================

	private static void Health(HttpContext ctx)
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["status"] = "ok";
		string[][] controlli = {
			new string[] { ShopConnection, "ShopOrder", "Caricamenti" },
			new string[] { TagConnection, "TAG", "Caricamenti" },
			new string[] { EpaConnection, "EpaFamiglie", "Caricamenti" }
		};
		foreach (string[] c in controlli)
		{
			try
			{
				using (SqlConnection cn = Open(c[0]))
				{
					for (int i = 1; i < c.Length; i++)
					{
						using (SqlCommand cmd = new SqlCommand("SELECT COUNT(*) FROM sys.tables WHERE name = @n", cn))
						{
							cmd.Parameters.Add("@n", SqlDbType.NVarChar, 128).Value = c[i];
							if ((int)cmd.ExecuteScalar() == 0)
							{
								d["status"] = "schema incompleto";
								d["message"] = "Database " + cn.Database + ": manca dbo." + c[i] + ". Eseguire SQL/Certificati_01_database.sql in SSMS.";
								Reply(ctx, d);
								return;
							}
						}
					}
					using (SqlCommand cmd = new SqlCommand("SELECT COUNT(*) FROM dbo." + c[1], cn))
						d[c[1].ToLowerInvariant()] = (int)cmd.ExecuteScalar();
				}
			}
			catch (Exception ex)
			{
				d["status"] = "errore";
				d["message"] = "Database " + c[0] + ": " + ex.Message;
				Reply(ctx, d);
				return;
			}
		}
		Reply(ctx, d);
	}

	// ================= richiesta e risposta =================

	private static SqlConnection Open(string name)
	{
		ConnectionStringSettings cs = ConfigurationManager.ConnectionStrings[name];
		if (cs == null || string.IsNullOrWhiteSpace(cs.ConnectionString))
			throw new InvalidOperationException("Manca la stringa di connessione \"" + name + "\" nel Web.config.");
		SqlConnection cn = new SqlConnection(cs.ConnectionString);
		cn.Open();
		return cn;
	}

	private static Dictionary<string, object> ReadJson(HttpContext ctx)
	{
		string type = ctx.Request.ContentType ?? "";
		if (type.IndexOf("application/json", StringComparison.OrdinalIgnoreCase) < 0) throw new UserException("Richiesta non valida.");

		StringBuilder sb = new StringBuilder();
		using (StreamReader sr = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
		{
			char[] buffer = new char[65536];
			int n;
			while ((n = sr.Read(buffer, 0, buffer.Length)) > 0)
			{
				sb.Append(buffer, 0, n);
				if (sb.Length > MaxBodyChars) throw new UserException("File troppo grande.");
			}
		}

		Dictionary<string, object> body;
		try
		{
			JavaScriptSerializer js = new JavaScriptSerializer();
			js.MaxJsonLength = MaxBodyChars;
			body = js.DeserializeObject(sb.ToString()) as Dictionary<string, object>;
		}
		catch (ArgumentException)
		{
			body = null;
		}
		if (body == null) throw new UserException("Richiesta non valida.");
		return body;
	}

	private static string Str(Dictionary<string, object> body, string key)
	{
		object v;
		if (!body.TryGetValue(key, out v) || !(v is string)) throw new UserException("Richiesta non valida.");
		return (string)v;
	}

	private static string StrOpt(Dictionary<string, object> body, string key)
	{
		object v;
		return body.TryGetValue(key, out v) ? v as string : null;
	}

	private static object[] Arr(Dictionary<string, object> body, string key, int max)
	{
		object v;
		object[] a = body.TryGetValue(key, out v) ? v as object[] : null;
		if (a == null || a.Length > max) throw new UserException("Richiesta non valida.");
		return a;
	}

	private static string Cut(string s, int max)
	{
		if (s == null) return null;
		return s.Length > max ? s.Substring(0, max) : s;
	}

	private static void Error(HttpContext ctx, string message, string detail)
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = false;
		d["message"] = message;
		if (detail != null) d["detail"] = detail;
		Reply(ctx, d);
	}

	private static void Reply(HttpContext ctx, Dictionary<string, object> data)
	{
		JavaScriptSerializer js = new JavaScriptSerializer();
		js.MaxJsonLength = int.MaxValue;
		ctx.Response.Write(js.Serialize(data));
	}
}
