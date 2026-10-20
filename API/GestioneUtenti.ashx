<%@ WebHandler Language="C#" Class="GestioneUtentiHandler" %>

/*
 * Gestione utenti del Portale (pagina GestioneUtenti.html). Solo per chi ha il ruolo Admin:
 * il controllo e' fatto qui, sul server, a ogni richiesta (non basta nascondere la pagina).
 *
 * Azioni:
 *   GET  ?action=elenco      utenti, ruoli e chi ha quale ruolo
 *   POST ?action=attiva      { id, attivo }   attiva / disattiva un utente
 *   POST ?action=sblocca     { id }           toglie il blocco per password sbagliate
 *   POST ?action=ruoli       { id, ruoli: [idRuolo, ...] }   sostituisce i ruoli dell'utente
 *
 * Un admin non puo' disattivare se stesso ne' togliersi il ruolo Admin (per non restare tutti fuori).
 * Ogni modifica finisce in AccessiLog con Evento = "Gestione".
 * Stesso database e stessa stringa di connessione di Auth.ashx ("PortaleLogin" nel Web.config).
 * Codice in C# 5, lettere accentate scritte come è (vedi Auth.ashx).
 */

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Text;
using System.Web;
using System.Web.Script.Serialization;

public class GestioneUtentiHandler : IHttpHandler
{
	private const string ConnectionName = "PortaleLogin";
	private const string AdminRole = "Admin";
	private const int MaxBodyChars = 16384;

	private class UserException : Exception
	{
		public UserException(string message) : base(message) { }
	}

	private class ForbiddenException : Exception
	{
		public ForbiddenException() : base("Questa pagina è riservata agli amministratori.") { }
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
			string action = (req.QueryString["action"] ?? "").Trim().ToLowerInvariant();

			using (SqlConnection cn = Open())
			{
				int adminId = RequireAdmin(context, cn);

				if (action == "elenco") { List(context, cn); return; }

				if (req.HttpMethod != "POST" || req.Headers["X-Portale"] != "1") throw new UserException("Richiesta non valida.");
				Dictionary<string, object> body = ReadJson(context);
				int id = Int(body, "id");
				string adminName = context.User.Identity.Name;

				if (action == "attiva") SetActive(context, cn, adminId, adminName, id, Bool(body, "attivo"));
				else if (action == "sblocca") Unlock(context, cn, adminName, id);
				else if (action == "ruoli") SetRoles(context, cn, adminId, adminName, id, IntList(body, "ruoli"));
				else throw new UserException("Richiesta non valida.");
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

	// ================= controllo Admin =================

	// Restituisce l'Id dell'admin collegato; altrimenti 403.
	private static int RequireAdmin(HttpContext ctx, SqlConnection cn)
	{
		if (ctx.User == null || !ctx.User.Identity.IsAuthenticated) throw new ForbiddenException();
		using (SqlCommand cmd = new SqlCommand(
			"SELECT u.Id FROM dbo.Utenti u " +
			"JOIN dbo.UtentiRuoli ur ON ur.UserId = u.Id " +
			"JOIN dbo.Ruoli r ON r.Id = ur.RuoloId " +
			"WHERE u.Username = @u AND u.Attivo = 1 AND r.Nome = @r", cn))
		{
			cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = ctx.User.Identity.Name;
			cmd.Parameters.Add("@r", SqlDbType.NVarChar, 50).Value = AdminRole;
			object v = cmd.ExecuteScalar();
			if (v == null || v == DBNull.Value) throw new ForbiddenException();
			return (int)v;
		}
	}

	// ================= azioni =================

	private static void List(HttpContext ctx, SqlConnection cn)
	{
		List<object> ruoli = new List<object>();
		using (SqlCommand cmd = new SqlCommand("SELECT Id, Nome, Descrizione FROM dbo.Ruoli ORDER BY Nome", cn))
		using (SqlDataReader r = cmd.ExecuteReader())
		{
			while (r.Read())
			{
				Dictionary<string, object> x = new Dictionary<string, object>();
				x["id"] = r.GetInt32(0);
				x["nome"] = r.GetString(1);
				x["descrizione"] = r.IsDBNull(2) ? "" : r.GetString(2);
				ruoli.Add(x);
			}
		}

		Dictionary<int, List<int>> assegnati = new Dictionary<int, List<int>>();
		using (SqlCommand cmd = new SqlCommand("SELECT UserId, RuoloId FROM dbo.UtentiRuoli", cn))
		using (SqlDataReader r = cmd.ExecuteReader())
		{
			while (r.Read())
			{
				int u = r.GetInt32(0);
				if (!assegnati.ContainsKey(u)) assegnati[u] = new List<int>();
				assegnati[u].Add(r.GetInt32(1));
			}
		}

		List<object> utenti = new List<object>();
		using (SqlCommand cmd = new SqlCommand(
			"SELECT Id, Username, NomeCompleto, Email, Attivo, " +
			"CASE WHEN BloccatoFinoA > SYSDATETIME() THEN 1 ELSE 0 END, CreatoIl, UltimoAccesso " +
			"FROM dbo.Utenti ORDER BY Attivo, Username", cn))
		using (SqlDataReader r = cmd.ExecuteReader())
		{
			while (r.Read())
			{
				int id = r.GetInt32(0);
				Dictionary<string, object> x = new Dictionary<string, object>();
				x["id"] = id;
				x["username"] = r.GetString(1);
				x["nome"] = r.GetString(2);
				x["email"] = r.IsDBNull(3) ? "" : r.GetString(3);
				x["attivo"] = r.GetBoolean(4);
				x["bloccato"] = r.GetInt32(5) == 1;
				x["creatoIl"] = r.GetDateTime(6).ToString("yyyy-MM-dd HH:mm");
				x["ultimoAccesso"] = r.IsDBNull(7) ? "" : r.GetDateTime(7).ToString("yyyy-MM-dd HH:mm");
				x["ruoli"] = assegnati.ContainsKey(id) ? assegnati[id] : new List<int>();
				utenti.Add(x);
			}
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["io"] = ctx.User.Identity.Name;
		d["ruoli"] = ruoli;
		d["utenti"] = utenti;
		Reply(ctx, d);
	}

	private static void SetActive(HttpContext ctx, SqlConnection cn, int adminId, string adminName, int id, bool attivo)
	{
		if (id == adminId && !attivo) throw new UserException("Non puoi disattivare il tuo stesso utente.");
		string name = UpdateUser(cn, id, "UPDATE dbo.Utenti SET Attivo = @a OUTPUT inserted.Username WHERE Id = @id",
			delegate(SqlCommand cmd) { cmd.Parameters.Add("@a", SqlDbType.Bit).Value = attivo; });
		Log(ctx, cn, adminName, (attivo ? "Attivato " : "Disattivato ") + name);
		Ok(ctx);
	}

	private static void Unlock(HttpContext ctx, SqlConnection cn, string adminName, int id)
	{
		string name = UpdateUser(cn, id,
			"UPDATE dbo.Utenti SET TentativiFalliti = 0, BloccatoFinoA = NULL OUTPUT inserted.Username WHERE Id = @id", null);
		Log(ctx, cn, adminName, "Sbloccato " + name);
		Ok(ctx);
	}

	private static void SetRoles(HttpContext ctx, SqlConnection cn, int adminId, string adminName, int id, List<int> ruoli)
	{
		if (id == adminId)
		{
			int adminRoleId;
			using (SqlCommand cmd = new SqlCommand("SELECT Id FROM dbo.Ruoli WHERE Nome = @r", cn))
			{
				cmd.Parameters.Add("@r", SqlDbType.NVarChar, 50).Value = AdminRole;
				adminRoleId = (int)cmd.ExecuteScalar();
			}
			if (!ruoli.Contains(adminRoleId)) throw new UserException("Non puoi toglierti il ruolo Admin da solo.");
		}

		string name;
		using (SqlTransaction tx = cn.BeginTransaction())
		{
			using (SqlCommand cmd = new SqlCommand("SELECT Username FROM dbo.Utenti WHERE Id = @id", cn, tx))
			{
				cmd.Parameters.Add("@id", SqlDbType.Int).Value = id;
				name = cmd.ExecuteScalar() as string;
			}
			if (name == null) throw new UserException("Utente non trovato. Ricarica la pagina.");

			// rimuove solo i ruoli tolti e aggiunge solo quelli nuovi (le date delle altre assegnazioni restano)
			StringBuilder sbLista = new StringBuilder();
			foreach (int r in ruoli)
			{
				if (sbLista.Length > 0) sbLista.Append(',');
				sbLista.Append(r.ToString(System.Globalization.CultureInfo.InvariantCulture));
			}
			string lista = sbLista.Length == 0 ? "-1" : sbLista.ToString(); // -1: nessun ruolo ha questo Id (con NULL il DELETE non toglierebbe nulla)
			using (SqlCommand cmd = new SqlCommand(
				"DELETE FROM dbo.UtentiRuoli WHERE UserId = @id AND RuoloId NOT IN (" + lista + "); " +
				"INSERT INTO dbo.UtentiRuoli (UserId, RuoloId, AssegnatoDa) " +
				"SELECT @id, r.Id, @da FROM dbo.Ruoli r WHERE r.Id IN (" + lista + ") " +
				"AND NOT EXISTS (SELECT 1 FROM dbo.UtentiRuoli x WHERE x.UserId = @id AND x.RuoloId = r.Id);", cn, tx))
			{
				cmd.Parameters.Add("@id", SqlDbType.Int).Value = id;
				cmd.Parameters.Add("@da", SqlDbType.NVarChar, 50).Value = adminName;
				cmd.ExecuteNonQuery();
			}
			tx.Commit();
		}

		Log(ctx, cn, adminName, "Ruoli di " + name + " cambiati");
		Ok(ctx);
	}

	// ================= database =================

	private delegate void AddParams(SqlCommand cmd);

	private static string UpdateUser(SqlConnection cn, int id, string sql, AddParams add)
	{
		using (SqlCommand cmd = new SqlCommand(sql, cn))
		{
			cmd.Parameters.Add("@id", SqlDbType.Int).Value = id;
			if (add != null) add(cmd);
			string name = cmd.ExecuteScalar() as string;
			if (name == null) throw new UserException("Utente non trovato. Ricarica la pagina.");
			return name;
		}
	}

	private static SqlConnection Open()
	{
		ConnectionStringSettings cs = ConfigurationManager.ConnectionStrings[ConnectionName];
		if (cs == null || string.IsNullOrEmpty(cs.ConnectionString))
			throw new InvalidOperationException("Nel Web.config manca la stringa di connessione '" + ConnectionName + "'.");
		SqlConnection cn = new SqlConnection(cs.ConnectionString);
		try
		{
			cn.Open();
		}
		catch (Exception)
		{
			cn.Dispose();
			throw;
		}
		return cn;
	}

	// registro: un errore qui non deve far fallire la modifica gia' fatta
	private static void Log(HttpContext ctx, SqlConnection cn, string adminName, string detail)
	{
		try
		{
			using (SqlCommand cmd = new SqlCommand(
				"INSERT INTO dbo.AccessiLog (UserId, Username, Evento, Indirizzo, Dettaglio) " +
				"SELECT Id, Username, N'Gestione', @ip, @d FROM dbo.Utenti WHERE Username = @u", cn))
			{
				cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = adminName;
				cmd.Parameters.Add("@ip", SqlDbType.NVarChar, 45).Value = (object)Cut(ctx.Request.UserHostAddress, 45) ?? DBNull.Value;
				cmd.Parameters.Add("@d", SqlDbType.NVarChar, 200).Value = Cut(detail, 200);
				cmd.ExecuteNonQuery();
			}
		}
		catch (Exception)
		{
		}
	}

	private static string Cut(string s, int max)
	{
		if (s == null) return null;
		return s.Length > max ? s.Substring(0, max) : s;
	}

	// ================= richiesta e risposta =================

	private static Dictionary<string, object> ReadJson(HttpContext ctx)
	{
		string type = ctx.Request.ContentType ?? "";
		if (type.IndexOf("application/json", StringComparison.OrdinalIgnoreCase) < 0) throw new UserException("Richiesta non valida.");

		StringBuilder sb = new StringBuilder();
		using (StreamReader sr = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
		{
			char[] buffer = new char[1024];
			int n;
			while ((n = sr.Read(buffer, 0, buffer.Length)) > 0)
			{
				sb.Append(buffer, 0, n);
				if (sb.Length > MaxBodyChars) throw new UserException("Richiesta non valida.");
			}
		}

		Dictionary<string, object> body;
		try
		{
			body = new JavaScriptSerializer().DeserializeObject(sb.ToString()) as Dictionary<string, object>;
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

	private static bool Bool(Dictionary<string, object> body, string key)
	{
		object v;
		if (!body.TryGetValue(key, out v) || !(v is bool)) throw new UserException("Richiesta non valida.");
		return (bool)v;
	}

	// solo numeri interi: e' cio' che rende sicuro scrivere la lista dentro la query
	private static List<int> IntList(Dictionary<string, object> body, string key)
	{
		object v;
		object[] arr = body.TryGetValue(key, out v) ? v as object[] : null;
		if (arr == null || arr.Length > 200) throw new UserException("Richiesta non valida.");
		List<int> list = new List<int>();
		foreach (object o in arr)
		{
			if (!(o is int)) throw new UserException("Richiesta non valida.");
			if (!list.Contains((int)o)) list.Add((int)o);
		}
		return list;
	}

	private static void Ok(HttpContext ctx)
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		Reply(ctx, d);
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
		ctx.Response.Write(new JavaScriptSerializer().Serialize(data));
	}
}
