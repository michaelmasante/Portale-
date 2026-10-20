<%@ WebHandler Language="C#" Class="AuthHandler" %>

/*
 * Accesso al Portale: login, registrazione, uscita. Gli utenti e il registro degli accessi
 * stanno nel database SQL Express "PortaleLogin" (script: Login_01_database.sql).
 *
 * Azioni (la pagina Login.html e l'header le chiamano da sole):
 *   GET  ?action=me         chi e' collegato in questo momento (risponde anche a chi non ha fatto il login)
 *   GET  ?health=1          prova di connessione al database (da aprire nel browser, dal server)
 *   POST ?action=login      nome utente + password -> cookie di accesso
 *   POST ?action=register   crea un utente (resta "in attesa" finche' non lo si attiva, vedi sotto)
 *   POST ?action=logout     esce
 *
 * Le password non vengono mai salvate: si salva solo l'impronta PBKDF2-SHA256 con un "sale" casuale
 * per ogni utente. Dopo 5 password sbagliate l'account si blocca per 15 minuti.
 * Tutti i login, gli errori, i blocchi, le uscite e le registrazioni finiscono in AccessiLog.
 *
 * Le richieste che cambiano qualcosa devono essere POST, in JSON, con l'intestazione X-Portale: un altro
 * sito web non puo' mandarle dal browser di un utente.
 *
 * Impostazioni nel Web.config (radice del Portale):
 *
 *   <connectionStrings>
 *     <add name="PortaleLogin" providerName="System.Data.SqlClient"
 *          connectionString="Data Source=.\SQLEXPRESS;Initial Catalog=PortaleLogin;Integrated Security=True" />
 *   </connectionStrings>
 *
 *   <appSettings>
 *     <!-- true = chi si registra puo' entrare subito; false (o voce assente) = deve prima essere attivato -->
 *     <add key="RegistrazioneAutomatica" value="false" />
 *     <!-- SOLO sul PC di sviluppo: entra senza database con questi ruoli (vedi RuoliSviluppo) -->
 *     <add key="LoginSviluppo" value="Admin" />
 *   </appSettings>
 *
 * Codice scritto in C# 5 (senza interpolazione di stringhe, "?." ecc.) e con le lettere accentate scritte
 * come \u00E8, \u00F9 ...: cosi' funziona qualunque sia la codifica con cui il file viene salvato o copiato.
 */

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web;
using System.Web.Script.Serialization;
using System.Web.Security;

public class AuthHandler : IHttpHandler
{
	private const string ConnectionName = "PortaleLogin";
	private const int HashIterations = 100000;
	private const int HashBytes = 32;
	private const int SaltBytes = 16;
	private const int MaxFailedAttempts = 5;        // password sbagliate prima del blocco
	private const int LockMinutes = 15;             // durata del blocco
	private const int MaxPendingRegistrations = 100; // richieste in attesa oltre le quali non se ne accettano altre
	private const int MinPasswordLength = 8;
	private const int MaxPasswordLength = 128;
	private const int MaxBodyChars = 16384;

	private const string BadLogin = "Nome utente o password non corretti.";
	private const string BadRequest = "Richiesta non valida.";

	private static readonly byte[] DummySalt = new byte[SaltBytes];
	private static readonly Regex UsernameRx = new Regex("^[A-Za-z0-9._@-]{3,50}$");
	private static readonly Regex EmailRx = new Regex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$");
	private static readonly Regex LocalPageRx = new Regex(@"^[A-Za-z0-9_.-]+\.html(\?[^\s]*)?$");

	// errori da mostrare all'utente cosi' come sono scritti
	private class UserException : Exception
	{
		public UserException(string message) : base(message) { }
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

			if (req.QueryString["health"] == "1") { Health(context); return; }
			if (action == "me") { Me(context); return; }

			// le azioni che cambiano qualcosa: solo POST con l'intestazione X-Portale
			if (req.HttpMethod != "POST" || req.Headers["X-Portale"] != "1") throw new UserException(BadRequest);

			if (action == "login") Login(context);
			else if (action == "register") Register(context);
			else if (action == "logout") Logout(context);
			else throw new UserException(BadRequest);
		}
		catch (UserException ex)
		{
			// errore previsto (password sbagliata, campo mancante...): risposta normale con ok = false
			Dictionary<string, object> d = new Dictionary<string, object>();
			d["ok"] = false;
			d["message"] = ex.Message;
			Reply(context, d);
		}
		catch (Exception ex)
		{
			// errore vero (database non raggiungibile, Web.config incompleto...): il dettaglio solo se si e' sul server
			res.StatusCode = 500;
			res.TrySkipIisCustomErrors = true;
			Dictionary<string, object> d = new Dictionary<string, object>();
			d["ok"] = false;
			d["message"] = "Il servizio di accesso non \u00E8 disponibile in questo momento. Avvisa l'amministratore.";
			if (context.Request.IsLocal) d["detail"] = ex.Message;
			Reply(context, d);
		}
	}

	// ================= azioni =================

	private static void Login(HttpContext ctx)
	{
		Dictionary<string, object> body = ReadJson(ctx);
		string username = Str(body, "username").Trim();
		string password = Str(body, "password");
		string returnUrl = Str(body, "returnUrl");

		if (username.Length == 0 || password.Length == 0) throw new UserException("Inserisci nome utente e password.");
		if (username.Length > 50 || password.Length > MaxPasswordLength) throw new UserException(BadLogin);

		string ip = ctx.Request.UserHostAddress;

		using (SqlConnection cn = Open())
		{
			bool found = false;
			int id = 0;
			string name = null;
			string fullName = null;
			byte[] hash = null;
			byte[] salt = null;
			int iterations = 0;
			bool active = false;
			int failed = 0;
			int lockedMinutes = 0;

			using (SqlCommand cmd = new SqlCommand(
				"SELECT Id, Username, NomeCompleto, PasswordHash, PasswordSalt, Iterazioni, Attivo, TentativiFalliti, " +
				"CASE WHEN BloccatoFinoA > SYSDATETIME() THEN DATEDIFF(MINUTE, SYSDATETIME(), BloccatoFinoA) + 1 ELSE 0 END " +
				"FROM dbo.Utenti WHERE Username = @u", cn))
			{
				cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = username;
				using (SqlDataReader r = cmd.ExecuteReader())
				{
					if (r.Read())
					{
						found = true;
						id = r.GetInt32(0);
						name = r.GetString(1);
						fullName = r.GetString(2);
						hash = (byte[])r.GetValue(3);
						salt = (byte[])r.GetValue(4);
						iterations = r.GetInt32(5);
						active = r.GetBoolean(6);
						failed = r.GetInt32(7);
						lockedMinutes = r.GetInt32(8);
					}
				}
			}

			if (!found)
			{
				// stesso tempo di risposta anche se l'utente non esiste (non si capisce quali nomi esistono)
				Hash(password, DummySalt, HashIterations);
				WriteLog(cn, null, username, "LoginFallito", ip, "Utente inesistente", true);
				throw new UserException(BadLogin);
			}

			if (lockedMinutes > 0)
			{
				// account bloccato: la password non viene nemmeno controllata
				throw new UserException("Troppi tentativi sbagliati. Riprova tra " + lockedMinutes + (lockedMinutes == 1 ? " minuto." : " minuti."));
			}

			if (!SameBytes(Hash(password, salt, iterations), hash))
			{
				// conta l'errore; al quinto l'account si blocca per 15 minuti
				using (SqlCommand cmd = new SqlCommand(
					"UPDATE dbo.Utenti SET " +
					"BloccatoFinoA = CASE WHEN TentativiFalliti + 1 >= @max THEN DATEADD(MINUTE, @min, SYSDATETIME()) ELSE BloccatoFinoA END, " +
					"TentativiFalliti = CASE WHEN TentativiFalliti + 1 >= @max THEN 0 ELSE TentativiFalliti + 1 END " +
					"WHERE Id = @id", cn))
				{
					cmd.Parameters.Add("@max", SqlDbType.Int).Value = MaxFailedAttempts;
					cmd.Parameters.Add("@min", SqlDbType.Int).Value = LockMinutes;
					cmd.Parameters.Add("@id", SqlDbType.Int).Value = id;
					cmd.ExecuteNonQuery();
				}
				bool nowLocked = failed + 1 >= MaxFailedAttempts;
				WriteLog(cn, id, name, nowLocked ? "Bloccato" : "LoginFallito", ip,
					nowLocked ? "Password errata: account bloccato per " + LockMinutes + " minuti" : "Password errata", false);
				throw new UserException(BadLogin);
			}

			if (!active)
			{
				WriteLog(cn, id, name, "NonAttivo", ip, "Password giusta ma account non attivato", false);
				throw new UserException("Il tuo account non \u00E8 ancora stato attivato. Chiedi all'amministratore di attivarlo.");
			}

			// accesso riuscito
			using (SqlCommand cmd = new SqlCommand(
				"UPDATE dbo.Utenti SET TentativiFalliti = 0, BloccatoFinoA = NULL, UltimoAccesso = SYSDATETIME() WHERE Id = @id", cn))
			{
				cmd.Parameters.Add("@id", SqlDbType.Int).Value = id;
				cmd.ExecuteNonQuery();
			}
			WriteLog(cn, id, name, "Login", ip, null, false);

			SignIn(ctx, name, fullName);

			Dictionary<string, object> d = new Dictionary<string, object>();
			d["ok"] = true;
			d["nome"] = fullName;
			d["redirect"] = SafeReturnUrl(returnUrl);
			Reply(ctx, d);
		}
	}

	private static void Register(HttpContext ctx)
	{
		Dictionary<string, object> body = ReadJson(ctx);
		string username = Str(body, "username").Trim();
		string fullName = Str(body, "nome").Trim();
		string email = Str(body, "email").Trim();
		string password = Str(body, "password");

		if (!UsernameRx.IsMatch(username))
			throw new UserException("Il nome utente deve avere da 3 a 50 caratteri: lettere, numeri, punto, trattino, trattino basso o @.");
		if (fullName.Length < 2 || fullName.Length > 100)
			throw new UserException("Scrivi nome e cognome (da 2 a 100 caratteri).");
		if (email.Length > 0 && (email.Length > 150 || !EmailRx.IsMatch(email)))
			throw new UserException("L'indirizzo email non \u00E8 valido.");
		if (password.Length < MinPasswordLength || password.Length > MaxPasswordLength)
			throw new UserException("La password deve avere da " + MinPasswordLength + " a " + MaxPasswordLength + " caratteri.");
		if (string.Equals(password, username, StringComparison.OrdinalIgnoreCase))
			throw new UserException("La password non pu\u00F2 essere uguale al nome utente.");

		bool auto = string.Equals(ConfigurationManager.AppSettings["RegistrazioneAutomatica"], "true", StringComparison.OrdinalIgnoreCase);
		string ip = ctx.Request.UserHostAddress;

		using (SqlConnection cn = Open())
		{
			if (!auto)
			{
				int pending;
				using (SqlCommand cmd = new SqlCommand("SELECT COUNT(*) FROM dbo.Utenti WHERE Attivo = 0", cn))
				{
					pending = (int)cmd.ExecuteScalar();
				}
				if (pending >= MaxPendingRegistrations)
					throw new UserException("Ci sono troppe richieste in attesa di attivazione. Riprova pi\u00F9 tardi o contatta l'amministratore.");
			}

			byte[] salt = RandomBytes(SaltBytes);
			byte[] hash = Hash(password, salt, HashIterations);

			try
			{
				using (SqlCommand cmd = new SqlCommand(
					"INSERT INTO dbo.Utenti (Username, NomeCompleto, Email, PasswordHash, PasswordSalt, Iterazioni, Attivo) " +
					"VALUES (@u, @n, @e, @h, @s, @i, @a)", cn))
				{
					cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = username;
					cmd.Parameters.Add("@n", SqlDbType.NVarChar, 100).Value = fullName;
					cmd.Parameters.Add("@e", SqlDbType.NVarChar, 150).Value = DbString(email.Length == 0 ? null : email, 150);
					cmd.Parameters.Add("@h", SqlDbType.VarBinary, HashBytes).Value = hash;
					cmd.Parameters.Add("@s", SqlDbType.VarBinary, SaltBytes).Value = salt;
					cmd.Parameters.Add("@i", SqlDbType.Int).Value = HashIterations;
					cmd.Parameters.Add("@a", SqlDbType.Bit).Value = auto;
					cmd.ExecuteNonQuery();
				}
			}
			catch (SqlException ex)
			{
				// 2627 / 2601 = esiste gia' un utente con questo nome
				if (ex.Number == 2627 || ex.Number == 2601) throw new UserException("Questo nome utente \u00E8 gi\u00E0 in uso.");
				throw;
			}

			WriteLog(cn, null, username, "Registrazione", ip, auto ? "Attivo subito" : "In attesa di attivazione", false);
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["active"] = auto;
		d["message"] = auto
			? "Account creato. Ora puoi accedere."
			: "Richiesta inviata. Potrai accedere quando un amministratore avr\u00E0 attivato il tuo account.";
		Reply(ctx, d);
	}

	private static void Logout(HttpContext ctx)
	{
		string user = (ctx.User != null && ctx.User.Identity.IsAuthenticated) ? ctx.User.Identity.Name : null;
		FormsAuthentication.SignOut();

		if (user != null)
		{
			try
			{
				using (SqlConnection cn = Open())
				{
					WriteLog(cn, null, user, "Logout", ctx.Request.UserHostAddress, null, false);
				}
			}
			catch (Exception)
			{
				// il registro non deve impedire l'uscita
			}
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		Reply(ctx, d);
	}

	private static void Me(HttpContext ctx)
	{
		string ruoliSviluppo = RuoliSviluppo(ctx);
		if (ruoliSviluppo != null) { MeSviluppo(ctx, ruoliSviluppo); return; }

		Dictionary<string, object> d = new Dictionary<string, object>();
		FormsIdentity id = ctx.User == null ? null : ctx.User.Identity as FormsIdentity;
		if (id != null && id.IsAuthenticated)
		{
			// ruoli letti ogni volta dal database: un ruolo dato o tolto vale dalla pagina successiva
			List<string> ruoli = new List<string>();
			bool exists = false, active = false;
			try
			{
				using (SqlConnection cn = Open())
				using (SqlCommand cmd = new SqlCommand(
					"SELECT u.Attivo, r.Nome FROM dbo.Utenti u " +
					"LEFT JOIN dbo.UtentiRuoli ur ON ur.UserId = u.Id " +
					"LEFT JOIN dbo.Ruoli r ON r.Id = ur.RuoloId " +
					"WHERE u.Username = @u", cn))
				{
					cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = id.Name;
					using (SqlDataReader r = cmd.ExecuteReader())
					{
						while (r.Read())
						{
							exists = true;
							active = r.GetBoolean(0);
							if (!r.IsDBNull(1)) ruoli.Add(r.GetString(1));
						}
					}
				}
			}
			catch (Exception)
			{
				// database non raggiungibile: l'utente resta dentro, ma senza ruoli
				exists = true;
				active = true;
				d["avviso"] = "Ruoli non disponibili: database non raggiungibile.";
			}

			if (!exists || !active)
			{
				// utente eliminato o disattivato: esce subito, senza aspettare la fine della sessione
				FormsAuthentication.SignOut();
				d["authenticated"] = false;
			}
			else
			{
				d["authenticated"] = true;
				d["username"] = id.Name;
				d["nome"] = id.Ticket.UserData;
				d["ruoli"] = ruoli;
			}
		}
		else
		{
			d["authenticated"] = false;
		}
		Reply(ctx, d);
	}

	/*
	 * Login di sviluppo, per lavorare sul proprio PC senza il database.
	 * Si attiva con la voce LoginSviluppo nel Web.config (i ruoli da simulare, separati da virgola):
	 *     <add key="LoginSviluppo" value="Admin" />
	 * Vale SOLO per le richieste fatte dallo stesso computer che ospita il sito (localhost):
	 * dagli altri PC il login resta quello vero. Sul server la voce va tolta (lo fa Web.Release.config).
	 * Restituisce i ruoli da simulare, oppure null se il login di sviluppo non e' attivo.
	 */
	private static string RuoliSviluppo(HttpContext ctx)
	{
		string ruoli = ConfigurationManager.AppSettings["LoginSviluppo"];
		if (string.IsNullOrWhiteSpace(ruoli) || !ctx.Request.IsLocal) return null;
		return ruoli;
	}

	private const string UtenteSviluppo = "sviluppo";

	private static void MeSviluppo(HttpContext ctx, string ruoliSviluppo)
	{
		const string nome = "Sviluppo (locale)";
		FormsIdentity id = ctx.User == null ? null : ctx.User.Identity as FormsIdentity;
		if (id == null || !id.IsAuthenticated) SignIn(ctx, UtenteSviluppo, nome); // cookie di accesso, cosi' IIS apre anche le pagine .html

		List<string> ruoli = new List<string>();
		foreach (string r in ruoliSviluppo.Split(','))
		{
			string t = r.Trim();
			if (t.Length > 0) ruoli.Add(t);
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["authenticated"] = true;
		d["username"] = UtenteSviluppo;
		d["nome"] = nome;
		d["ruoli"] = ruoli;
		d["sviluppo"] = true;
		Reply(ctx, d);
	}

	// Prova di connessione: dal server mostra il dettaglio, da un altro computer solo "ok" / "errore"
	private static void Health(HttpContext ctx)
	{
		bool local = ctx.Request.IsLocal;
		Dictionary<string, object> d = new Dictionary<string, object>();
		try
		{
			using (SqlConnection cn = Open())
			{
				int tables;
				using (SqlCommand cmd = new SqlCommand(
					"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME IN ('Utenti', 'AccessiLog')", cn))
				{
					tables = (int)cmd.ExecuteScalar();
				}
				if (tables < 2)
				{
					d["status"] = "schema incompleto";
					if (local) d["message"] = "Mancano le tabelle Utenti e/o AccessiLog: eseguire Login_01_database.sql in SSMS.";
				}
				else
				{
					d["status"] = "ok";
					if (local)
					{
						d["database"] = cn.Database;
						using (SqlCommand cmd = new SqlCommand("SELECT COUNT(*) FROM dbo.Utenti", cn))
						{
							d["utenti"] = (int)cmd.ExecuteScalar();
						}
						using (SqlCommand cmd = new SqlCommand("SELECT COUNT(*) FROM dbo.Utenti WHERE Attivo = 0", cn))
						{
							d["inAttesa"] = (int)cmd.ExecuteScalar();
						}
					}
				}
			}
		}
		catch (Exception ex)
		{
			d["status"] = "errore";
			if (local) d["message"] = ex.Message;
		}
		Reply(ctx, d);
	}

	// ================= cookie di accesso =================

	// Cookie di accesso di ASP.NET (autenticazione Forms): cifrato e firmato, HttpOnly, senza scadenza
	// (finisce quando si chiude il browser). Il nome visibile nell'header viaggia dentro il cookie.
	private static void SignIn(HttpContext ctx, string username, string fullName)
	{
		DateTime now = DateTime.Now;
		FormsAuthenticationTicket ticket = new FormsAuthenticationTicket(
			1, username, now, now.Add(FormsAuthentication.Timeout), false, fullName);
		HttpCookie cookie = new HttpCookie(FormsAuthentication.FormsCookieName, FormsAuthentication.Encrypt(ticket));
		cookie.HttpOnly = true;
		cookie.Secure = FormsAuthentication.RequireSSL;
		cookie.Path = FormsAuthentication.FormsCookiePath;
		ctx.Response.Cookies.Add(cookie);
	}

	// Dopo il login si va dove si voleva andare, ma solo dentro questo sito: mai su indirizzi di altri siti.
	private static string SafeReturnUrl(string url)
	{
		const string home = "Portale.html";
		if (url == null) return home;
		url = url.Trim();
		if (url.Length == 0 || url.Length > 500) return home;
		foreach (char c in url)
		{
			if (c < ' ' || c == '\\') return home;
		}
		bool local = (url[0] == '/' && !url.StartsWith("//", StringComparison.Ordinal)) || LocalPageRx.IsMatch(url);
		if (!local) return home;

		string path = url;
		int q = url.IndexOfAny(new char[] { '?', '#' });
		if (q >= 0) path = url.Substring(0, q);
		path = path.ToLowerInvariant();
		if (path == "login.html" || path.EndsWith("/login.html", StringComparison.Ordinal) || path.Contains("/api/")) return home;
		return url;
	}

	// ================= password =================

	private static byte[] Hash(string password, byte[] salt, int iterations)
	{
		Rfc2898DeriveBytes kdf = new Rfc2898DeriveBytes(password, salt, iterations, HashAlgorithmName.SHA256);
		return kdf.GetBytes(HashBytes);
	}

	private static byte[] RandomBytes(int count)
	{
		byte[] bytes = new byte[count];
		using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider())
		{
			rng.GetBytes(bytes);
		}
		return bytes;
	}

	// confronto che dura sempre lo stesso tempo, qualunque sia il punto in cui i due valori differiscono
	private static bool SameBytes(byte[] a, byte[] b)
	{
		if (a == null || b == null || a.Length != b.Length) return false;
		int diff = 0;
		for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
		return diff == 0;
	}

	// ================= database =================

	private static SqlConnection Open()
	{
		ConnectionStringSettings cs = ConfigurationManager.ConnectionStrings[ConnectionName];
		if (cs == null || string.IsNullOrEmpty(cs.ConnectionString))
			throw new InvalidOperationException("Nel Web.config manca la stringa di connessione '" + ConnectionName + "' (sezione connectionStrings).");
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

	// Registro degli accessi. Un errore qui non deve mai impedire un accesso.
	// throttle = true (nomi utente inesistenti): oltre 100 righe in 10 minuti non si scrive piu',
	// cosi' chi prova nomi a caso non puo' riempire il database.
	private static void WriteLog(SqlConnection cn, int? userId, string username, string evento, string ip, string detail, bool throttle)
	{
		try
		{
			using (SqlCommand cmd = new SqlCommand(
				"INSERT INTO dbo.AccessiLog (UserId, Username, Evento, Indirizzo, Dettaglio) " +
				"SELECT @id, @u, @e, @ip, @d " +
				"WHERE @t = 0 OR (SELECT COUNT(*) FROM dbo.AccessiLog " +
				"WHERE UserId IS NULL AND Evento = N'LoginFallito' AND DataOra > DATEADD(MINUTE, -10, SYSDATETIME())) < 100", cn))
			{
				cmd.Parameters.Add("@id", SqlDbType.Int).Value = userId.HasValue ? (object)userId.Value : DBNull.Value;
				cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = DbString(username, 50);
				cmd.Parameters.Add("@e", SqlDbType.NVarChar, 30).Value = evento;
				cmd.Parameters.Add("@ip", SqlDbType.NVarChar, 45).Value = DbString(ip, 45);
				cmd.Parameters.Add("@d", SqlDbType.NVarChar, 200).Value = DbString(detail, 200);
				cmd.Parameters.Add("@t", SqlDbType.Int).Value = throttle ? 1 : 0;
				cmd.ExecuteNonQuery();
			}
		}
		catch (Exception)
		{
			// vedi sopra
		}
	}

	private static object DbString(string s, int max)
	{
		if (s == null) return DBNull.Value;
		return s.Length > max ? s.Substring(0, max) : s;
	}

	// ================= richiesta e risposta =================

	private static Dictionary<string, object> ReadJson(HttpContext ctx)
	{
		string type = ctx.Request.ContentType ?? "";
		if (type.IndexOf("application/json", StringComparison.OrdinalIgnoreCase) < 0) throw new UserException(BadRequest);

		StringBuilder sb = new StringBuilder();
		using (StreamReader sr = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
		{
			char[] buffer = new char[1024];
			int n;
			while ((n = sr.Read(buffer, 0, buffer.Length)) > 0)
			{
				sb.Append(buffer, 0, n);
				if (sb.Length > MaxBodyChars) throw new UserException(BadRequest);
			}
		}

		object parsed;
		try
		{
			parsed = new JavaScriptSerializer().DeserializeObject(sb.ToString());
		}
		catch (ArgumentException)
		{
			throw new UserException(BadRequest);
		}
		Dictionary<string, object> body = parsed as Dictionary<string, object>;
		if (body == null) throw new UserException(BadRequest);
		return body;
	}

	private static string Str(Dictionary<string, object> body, string key)
	{
		object value;
		if (body.TryGetValue(key, out value) && value != null) return Convert.ToString(value);
		return "";
	}

	private static void Reply(HttpContext ctx, Dictionary<string, object> data)
	{
		ctx.Response.Write(new JavaScriptSerializer().Serialize(data));
	}
}
