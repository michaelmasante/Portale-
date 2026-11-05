<%@ WebHandler Language="C#" Class="SafetyHandler" %>

/*
 * Safety (pagina Safety.html). Dati di sicurezza MFG / NMFG nel database "Safety"
 * (stringa di connessione "Safety" nel Web.config). Utenti e ruoli da PortaleLogin, come le altre pagine.
 *
 * Azioni:
 *   GET  ?health=1                         controllo veloce del database
 *   GET  ?action=dati&perimetro=MFG|NMFG   valori, gruppi, target, ultimo caricamento
 *   POST ?action=carica                    { file, perimetri: [ { perimetro, dati: [ { parametro, anno, righe: [[location, v1..v12], ...] } ] } ] }
 *
 * Il caricamento SOSTITUISCE, per ogni perimetro/parametro/anno presente nel file, tutti i valori nel database
 * (in un'unica transazione: o va tutto o non cambia niente). Anni e parametri non presenti nel file restano come sono.
 * I dati non si modificano piu' dalla pagina: l'unico modo per scrivere e' il file Excel.
 *
 * Ruoli: "Safety" vede tabelle e presentazione; "Safety Upload" carica il file; Admin fa tutto.
 * Il controllo e' fatto qui, sul server, a ogni richiesta.
 * C# 5 (compilatore di default di ASP.NET), come RepairTracker.ashx.
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

public class SafetyHandler : IHttpHandler
{
	private const string DataConnection = "Safety";
	private const string LoginConnection = "PortaleLogin";
	private const string Admin = "Admin";
	private const string RuoloUpload = "Safety Upload";
	private static readonly string[] RuoliAccesso = { "Safety", RuoloUpload, Admin };
	private static readonly string[] Perimetri = { "MFG", "NMFG" };
	private static readonly string[] Parametri = { "WH", "LTI", "DAYS" };
	private const int MaxBodyChars = 4 * 1024 * 1024;
	private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

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

			using (SqlConnection cn = Open(DataConnection))
			{
				if (action == "dati") { Dati(context, cn, u, Perimetro(req.QueryString["perimetro"])); return; }
				if (action == "carica")
				{
					if (!u.Ha(RuoloUpload)) throw new ForbiddenException("Per caricare il file serve il ruolo \"" + RuoloUpload + "\". Chiedilo a un amministratore.");
					if (req.HttpMethod != "POST" || req.Headers["X-Portale"] != "1") throw new UserException("Richiesta non valida.");
					Carica(context, cn, u, ReadJson(context));
					return;
				}
				throw new UserException("Richiesta non valida.");
			}
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

	// ================= utente e ruoli (come RepairTracker.ashx) =================

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

		if (!u.HaUno(RuoliAccesso)) throw new ForbiddenException("Non hai il ruolo Safety. Chiedilo a un amministratore.");
		return u;
	}

	// ================= lettura =================

	private static string Perimetro(string p)
	{
		string v = (p ?? "").Trim().ToUpperInvariant();
		if (Array.IndexOf(Perimetri, v) < 0) throw new UserException("Perimetro non valido.");
		return v;
	}

	private static void Dati(HttpContext ctx, SqlConnection cn, Utente u, string perimetro)
	{
		// valori[parametro][anno][location] = [12 valori o null]
		Dictionary<string, object> valori = new Dictionary<string, object>();
		using (SqlCommand cmd = new SqlCommand(
			"SELECT Parametro, Anno, Location, Mese, Valore FROM dbo.SafetyValori WHERE Perimetro = @p", cn))
		{
			cmd.Parameters.Add("@p", SqlDbType.VarChar, 10).Value = perimetro;
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				while (r.Read())
				{
					string par = r.GetString(0);
					string anno = r.GetInt16(1).ToString(Inv);
					string loc = r.GetString(2);
					int mese = r.GetByte(3);
					object perPar;
					if (!valori.TryGetValue(par, out perPar)) { perPar = new Dictionary<string, object>(); valori[par] = perPar; }
					Dictionary<string, object> perAnno = (Dictionary<string, object>)perPar;
					object perLoc;
					if (!perAnno.TryGetValue(anno, out perLoc)) { perLoc = new Dictionary<string, object>(); perAnno[anno] = perLoc; }
					Dictionary<string, object> locs = (Dictionary<string, object>)perLoc;
					object arr;
					if (!locs.TryGetValue(loc, out arr)) { arr = new object[12]; locs[loc] = arr; }
					((object[])arr)[mese - 1] = r.IsDBNull(4) ? null : (object)(double)r.GetDecimal(4);
				}
			}
		}

		List<object> gruppi = new List<object>();
		Dictionary<string, List<string>> perGruppo = new Dictionary<string, List<string>>();
		using (SqlCommand cmd = new SqlCommand(
			"SELECT Gruppo, Location FROM dbo.SafetyGruppi WHERE Perimetro = @p ORDER BY " +
			"CASE Gruppo WHEN 'BUS' THEN 1 WHEN 'PWT EU' THEN 2 WHEN 'PWT EU+AMEA' THEN 3 WHEN 'TRUCK EU' THEN 4 WHEN 'LATAM' THEN 5 ELSE 9 END, Gruppo, Ordine", cn))
		{
			cmd.Parameters.Add("@p", SqlDbType.VarChar, 10).Value = perimetro;
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				while (r.Read())
				{
					string g = r.GetString(0);
					List<string> l;
					if (!perGruppo.TryGetValue(g, out l))
					{
						l = new List<string>();
						perGruppo[g] = l;
						Dictionary<string, object> x = new Dictionary<string, object>();
						x["gruppo"] = g;
						x["location"] = l;
						gruppi.Add(x);
					}
					l.Add(r.GetString(1));
				}
			}
		}

		List<object> target = new List<object>();
		using (SqlCommand cmd = new SqlCommand(
			"SELECT Nome, Indice, Anno, Valore FROM dbo.SafetyTarget WHERE Perimetro = @p", cn))
		{
			cmd.Parameters.Add("@p", SqlDbType.VarChar, 10).Value = perimetro;
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				while (r.Read())
				{
					Dictionary<string, object> x = new Dictionary<string, object>();
					x["nome"] = r.GetString(0);
					x["indice"] = r.GetString(1);
					x["anno"] = (int)r.GetInt16(2);
					x["valore"] = (double)r.GetDecimal(3);
					target.Add(x);
				}
			}
		}

		Dictionary<string, object> ultimo = null;
		using (SqlCommand cmd = new SqlCommand(
			"SELECT TOP 1 Data, Utente, NomeFile FROM dbo.SafetyCaricamenti " +
			"WHERE ',' + Perimetri + ',' LIKE '%,' + @p + ',%' ORDER BY Id DESC", cn))
		{
			cmd.Parameters.Add("@p", SqlDbType.VarChar, 10).Value = perimetro;
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				if (r.Read())
				{
					ultimo = new Dictionary<string, object>();
					ultimo["data"] = r.GetDateTime(0).ToString("yyyy-MM-dd HH:mm", Inv);
					ultimo["utente"] = r.GetString(1);
					ultimo["file"] = r.GetString(2);
				}
			}
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["perimetro"] = perimetro;
		d["valori"] = valori;
		d["gruppi"] = gruppi;
		d["target"] = target;
		d["ultimo"] = ultimo;
		d["puoCaricare"] = u.Ha(RuoloUpload);
		Reply(ctx, d);
	}

	// ================= caricamento del file =================

	private static void Carica(HttpContext ctx, SqlConnection cn, Utente u, Dictionary<string, object> body)
	{
		string nomeFile = Str(body, "file");
		if (nomeFile.Length > 260) nomeFile = nomeFile.Substring(0, 260);
		object[] perimetri = Arr(body, "perimetri", 2);
		if (perimetri.Length == 0) throw new UserException("Nel file non c'è nessun dato da caricare.");

		DataTable t = new DataTable();
		t.Columns.Add("Perimetro", typeof(string));
		t.Columns.Add("Location", typeof(string));
		t.Columns.Add("Parametro", typeof(string));
		t.Columns.Add("Anno", typeof(short));
		t.Columns.Add("Mese", typeof(byte));
		t.Columns.Add("Valore", typeof(decimal));

		// blocchi da sostituire: perimetro|parametro|anno
		List<string[]> blocchi = new List<string[]>();
		List<string> nomiPerimetri = new List<string>();
		List<string> anni = new List<string>();
		HashSet<string> tutteLeLocation = new HashSet<string>();

		foreach (object po in perimetri)
		{
			Dictionary<string, object> p = po as Dictionary<string, object>;
			if (p == null) throw new UserException("Richiesta non valida.");
			string perimetro = Perimetro(Str(p, "perimetro"));
			if (nomiPerimetri.Contains(perimetro)) throw new UserException("Il perimetro " + perimetro + " compare due volte.");
			nomiPerimetri.Add(perimetro);

			foreach (object bo in Arr(p, "dati", 20))
			{
				Dictionary<string, object> b = bo as Dictionary<string, object>;
				if (b == null) throw new UserException("Richiesta non valida.");
				string par = Str(b, "parametro");
				if (Array.IndexOf(Parametri, par) < 0) throw new UserException("Parametro non valido: " + par);
				int anno = Int(b, "anno");
				if (anno < 2000 || anno > 2100) throw new UserException("Anno non valido: " + anno);
				foreach (string[] gia in blocchi)
					if (gia[0] == perimetro && gia[1] == par && gia[2] == anno.ToString(Inv))
						throw new UserException(perimetro + ": il blocco " + par + " " + anno + " compare due volte.");
				blocchi.Add(new string[] { perimetro, par, anno.ToString(Inv) });
				if (!anni.Contains(anno.ToString(Inv))) anni.Add(anno.ToString(Inv));

				HashSet<string> locBlocco = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
				foreach (object ro in Arr(b, "righe", 1000))
				{
					object[] riga = ro as object[];
					if (riga == null || riga.Length != 13 || !(riga[0] is string)) throw new UserException("Richiesta non valida.");
					string loc = ((string)riga[0]).Trim();
					if (loc.Length == 0 || loc.Length > 200) throw new UserException("Nome location non valido: " + loc);
					if (!locBlocco.Add(loc)) throw new UserException(perimetro + " " + par + " " + anno + ": la location \"" + loc + "\" compare due volte.");
					tutteLeLocation.Add(perimetro + "|" + loc);
					for (int m = 1; m <= 12; m++)
					{
						object v = riga[m];
						object valore = DBNull.Value;
						if (v != null)
						{
							decimal dv;
							try { dv = Convert.ToDecimal(v, Inv); }
							catch { throw new UserException(loc + " " + par + " " + m + "/" + anno + ": valore non numerico."); }
							if (dv < 0 || dv > 999999999999m) throw new UserException(loc + " " + par + " " + m + "/" + anno + ": valore fuori limite.");
							valore = Math.Round(dv, 4);
						}
						t.Rows.Add(perimetro, loc, par, (short)anno, (byte)m, valore);
					}
				}
			}
		}

		using (SqlTransaction tx = cn.BeginTransaction())
		{
			foreach (string[] b in blocchi)
			{
				using (SqlCommand cmd = new SqlCommand(
					"DELETE FROM dbo.SafetyValori WHERE Perimetro = @p AND Parametro = @par AND Anno = @a", cn, tx))
				{
					cmd.Parameters.Add("@p", SqlDbType.VarChar, 10).Value = b[0];
					cmd.Parameters.Add("@par", SqlDbType.VarChar, 10).Value = b[1];
					cmd.Parameters.Add("@a", SqlDbType.SmallInt).Value = short.Parse(b[2], Inv);
					cmd.ExecuteNonQuery();
				}
			}

			using (SqlBulkCopy bulk = new SqlBulkCopy(cn, SqlBulkCopyOptions.CheckConstraints, tx))
			{
				bulk.DestinationTableName = "dbo.SafetyValori";
				foreach (DataColumn c in t.Columns) bulk.ColumnMappings.Add(c.ColumnName, c.ColumnName);
				bulk.WriteToServer(t);
			}

			anni.Sort();
			using (SqlCommand cmd = new SqlCommand(
				"INSERT INTO dbo.SafetyCaricamenti (Utente, NomeFile, Perimetri, Anni, Righe, Location) VALUES (@u, @f, @p, @a, @r, @l)", cn, tx))
			{
				cmd.Parameters.Add("@u", SqlDbType.NVarChar, 100).Value = u.Username;
				cmd.Parameters.Add("@f", SqlDbType.NVarChar, 260).Value = nomeFile;
				cmd.Parameters.Add("@p", SqlDbType.NVarChar, 50).Value = string.Join(",", nomiPerimetri.ToArray());
				cmd.Parameters.Add("@a", SqlDbType.NVarChar, 50).Value = string.Join(",", anni.ToArray());
				cmd.Parameters.Add("@r", SqlDbType.Int).Value = t.Rows.Count;
				cmd.Parameters.Add("@l", SqlDbType.Int).Value = tutteLeLocation.Count;
				cmd.ExecuteNonQuery();
			}
			tx.Commit();
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["righe"] = t.Rows.Count;
		d["blocchi"] = blocchi.Count;
		d["location"] = tutteLeLocation.Count;
		Reply(ctx, d);
	}

	// ================= controllo =================

	private static void Health(HttpContext ctx)
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["status"] = "ok";
		try
		{
			using (SqlConnection cn = Open(DataConnection))
			{
				d["database"] = cn.Database;
				foreach (string tab in new string[] { "SafetyValori", "SafetyGruppi", "SafetyTarget", "SafetyCaricamenti" })
				{
					using (SqlCommand cmd = new SqlCommand("SELECT COUNT(*) FROM sys.tables WHERE name = @n", cn))
					{
						cmd.Parameters.Add("@n", SqlDbType.NVarChar, 128).Value = tab;
						if ((int)cmd.ExecuteScalar() == 0)
						{
							d["status"] = "schema incompleto";
							d["message"] = "Manca dbo." + tab + ": eseguire SQL/Safety_01_database.sql in SSMS.";
							Reply(ctx, d);
							return;
						}
					}
				}
				using (SqlCommand cmd = new SqlCommand("SELECT COUNT(*) FROM dbo.SafetyValori", cn))
					d["valori"] = (int)cmd.ExecuteScalar();
				using (SqlCommand cmd = new SqlCommand("SELECT COUNT(*) FROM dbo.SafetyTarget", cn))
					d["target"] = (int)cmd.ExecuteScalar();
			}
		}
		catch (Exception ex)
		{
			d["status"] = "errore";
			d["message"] = "Database Safety: " + ex.Message;
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
			char[] buffer = new char[8192];
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

	private static int Int(Dictionary<string, object> body, string key)
	{
		object v;
		if (!body.TryGetValue(key, out v) || !(v is int)) throw new UserException("Richiesta non valida.");
		return (int)v;
	}

	private static string Str(Dictionary<string, object> body, string key)
	{
		object v;
		if (!body.TryGetValue(key, out v) || !(v is string)) throw new UserException("Richiesta non valida.");
		return (string)v;
	}

	private static object[] Arr(Dictionary<string, object> body, string key, int max)
	{
		object v;
		object[] a = body.TryGetValue(key, out v) ? v as object[] : null;
		if (a == null || a.Length > max) throw new UserException("Richiesta non valida.");
		return a;
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
		js.MaxJsonLength = MaxBodyChars;
		ctx.Response.Write(js.Serialize(data));
	}
}
