<%@ WebHandler Language="C#" Class="EntraHandler" %>

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web;
using System.Web.Script.Serialization;
using System.Web.Security;

// Accesso con Microsoft Entra ID (OpenID Connect, codice di autorizzazione + PKCE).
// Configurazione nel Web.config (appSettings): EntraTenantId, EntraClientId, EntraClientSecret, EntraRedirectUri.
// L'utente viene cercato in PortaleLogin.dbo.Utenti per EntraOid, poi per Email/Username; se non c'è viene creato non attivo.
public class EntraHandler : IHttpHandler
{
	private const string ConnectionName = "PortaleLogin";
	private const string CookieName = ".PortaleEntra";
	private const string Scopo = "Portale.EntraLogin";
	private const int MaxPendingRegistrations = 100;
	private const int HashIterations = 100000;
	private static readonly Regex LocalPageRx = new Regex(@"^[A-Za-z0-9_.-]+\.html(\?[^\s]*)?$");
	private static readonly Regex GuidRx = new Regex("^[0-9a-fA-F-]{36}$");

	private class EntraException : Exception
	{
		public string Codice;
		public EntraException(string codice, string message) : base(message) { Codice = codice; }
	}

	private class Config
	{
		public string Tenant, ClientId, Secret, RedirectUri;
	}

	public bool IsReusable { get { return true; } }

	public void ProcessRequest(HttpContext ctx)
	{
		ctx.Response.Cache.SetCacheability(HttpCacheability.NoCache);
		ctx.Response.Cache.SetNoStore();
		try
		{
			Config cfg = LeggiConfig();
			HttpRequest req = ctx.Request;
			if (!string.IsNullOrEmpty(req.QueryString["error"]))
			{
				CancellaCookie(ctx);
				string err = req.QueryString["error"];
				if (err == "access_denied") throw new EntraException("annullato", "Accesso con Microsoft annullato.");
				throw new EntraException("errore", "Microsoft ha rifiutato l'accesso (" + Taglia(err, 60) + ").");
			}
			if (!string.IsNullOrEmpty(req.QueryString["code"])) { Ritorno(ctx, cfg); return; }
			Avvio(ctx, cfg);
		}
		catch (EntraException ex)
		{
			VaiAlLogin(ctx, ex.Codice, ex.Message);
		}
		catch (Exception ex)
		{
			string msg = "Accesso con Microsoft non riuscito. Avvisa l'amministratore.";
			if (ctx.Request.IsLocal) msg += " (" + Taglia(ex.Message, 200) + ")";
			try { using (SqlConnection cn = Open()) WriteLog(cn, null, null, "EntraErrore", ctx.Request.UserHostAddress, Taglia(ex.Message, 200)); }
			catch (Exception) { }
			VaiAlLogin(ctx, "errore", msg);
		}
	}

	private static Config LeggiConfig()
	{
		Config c = new Config();
		c.Tenant = (ConfigurationManager.AppSettings["EntraTenantId"] ?? "").Trim();
		c.ClientId = (ConfigurationManager.AppSettings["EntraClientId"] ?? "").Trim();
		c.Secret = ConfigurationManager.AppSettings["EntraClientSecret"] ?? "";
		c.RedirectUri = (ConfigurationManager.AppSettings["EntraRedirectUri"] ?? "").Trim();
		if (c.Tenant.Length == 0 || c.ClientId.Length == 0 || c.Secret.Length == 0 || c.RedirectUri.Length == 0)
			throw new EntraException("config", "Accesso con Microsoft non ancora configurato: mancano EntraTenantId, EntraClientId, EntraClientSecret o EntraRedirectUri nel Web.config.");
		if (!c.RedirectUri.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !c.RedirectUri.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase))
			throw new EntraException("config", "EntraRedirectUri nel Web.config deve cominciare con https://.");
		return c;
	}

	// 1) Manda l'utente alla pagina di login Microsoft
	private static void Avvio(HttpContext ctx, Config cfg)
	{
		string state = Base64Url(RandomBytes(24));
		string nonce = Base64Url(RandomBytes(24));
		string verifier = Base64Url(RandomBytes(48));
		string challenge;
		using (SHA256 sha = SHA256.Create()) challenge = Base64Url(sha.ComputeHash(Encoding.ASCII.GetBytes(verifier)));
		string ritorno = SafeReturnUrl(ctx.Request.QueryString["ReturnUrl"]);

		string dati = string.Join("\n", new string[] { state, nonce, verifier, ritorno, DateTime.UtcNow.Ticks.ToString() });
		HttpCookie c = new HttpCookie(CookieName, Base64Url(MachineKey.Protect(Encoding.UTF8.GetBytes(dati), Scopo)));
		c.HttpOnly = true;
		c.Secure = ctx.Request.IsSecureConnection;
		c.Path = "/";
		ctx.Response.Cookies.Add(c);

		string url = "https://login.microsoftonline.com/" + Uri.EscapeDataString(cfg.Tenant) + "/oauth2/v2.0/authorize" +
			"?client_id=" + Uri.EscapeDataString(cfg.ClientId) +
			"&response_type=code" +
			"&redirect_uri=" + Uri.EscapeDataString(cfg.RedirectUri) +
			"&response_mode=query" +
			"&scope=" + Uri.EscapeDataString("openid profile email") +
			"&state=" + state +
			"&nonce=" + nonce +
			"&code_challenge=" + challenge +
			"&code_challenge_method=S256" +
			"&prompt=select_account";
		ctx.Response.Redirect(url, false);
		ctx.ApplicationInstance.CompleteRequest();
	}

	// 2) Ritorno da Microsoft con il codice: lo scambia con i token, controlla l'id_token e fa entrare l'utente
	private static void Ritorno(HttpContext ctx, Config cfg)
	{
		HttpCookie c = ctx.Request.Cookies[CookieName];
		CancellaCookie(ctx);
		if (c == null || string.IsNullOrEmpty(c.Value)) throw new EntraException("scaduto", "Sessione di accesso scaduta: riprova.");
		string[] parti;
		try { parti = Encoding.UTF8.GetString(MachineKey.Unprotect(FromBase64Url(c.Value), Scopo)).Split('\n'); }
		catch (Exception) { throw new EntraException("scaduto", "Sessione di accesso non valida: riprova."); }
		if (parti.Length != 5) throw new EntraException("scaduto", "Sessione di accesso non valida: riprova.");
		string state = parti[0], nonce = parti[1], verifier = parti[2], ritorno = parti[3];
		long ticks;
		if (!long.TryParse(parti[4], out ticks) || DateTime.UtcNow - new DateTime(ticks, DateTimeKind.Utc) > TimeSpan.FromMinutes(15))
			throw new EntraException("scaduto", "Sessione di accesso scaduta: riprova.");
		if (!string.Equals(ctx.Request.QueryString["state"], state, StringComparison.Ordinal))
			throw new EntraException("scaduto", "Sessione di accesso non valida: riprova.");

		Dictionary<string, object> token = ScambiaCodice(cfg, ctx.Request.QueryString["code"], verifier);
		string idToken = token.ContainsKey("id_token") ? token["id_token"] as string : null;
		if (string.IsNullOrEmpty(idToken)) throw new Exception("Risposta di Microsoft senza id_token.");
		Dictionary<string, object> claim = LeggiIdToken(idToken);

		// L'id_token arriva direttamente da Microsoft via HTTPS (back-channel): si controllano destinatario, tenant, nonce e scadenza
		if (Claim(claim, "aud") != cfg.ClientId) throw new Exception("id_token per un'altra applicazione.");
		string tid = Claim(claim, "tid");
		if (GuidRx.IsMatch(cfg.Tenant) && !string.Equals(tid, cfg.Tenant, StringComparison.OrdinalIgnoreCase))
			throw new EntraException("tenant", "Questo account Microsoft non è dell'azienda.");
		if (Claim(claim, "iss") != "https://login.microsoftonline.com/" + tid + "/v2.0") throw new Exception("id_token con emittente non valido.");
		if (Claim(claim, "nonce") != nonce) throw new Exception("id_token con nonce non valido.");
		long exp;
		if (!long.TryParse(Claim(claim, "exp"), out exp) || DateTimeOffset.FromUnixTimeSeconds(exp) < DateTimeOffset.UtcNow.AddMinutes(-5))
			throw new Exception("id_token scaduto.");

		string oidTesto = Claim(claim, "oid");
		Guid oid;
		if (!Guid.TryParse(oidTesto, out oid)) throw new Exception("id_token senza oid.");
		string upn = Claim(claim, "preferred_username");
		string email = Claim(claim, "email");
		if (string.IsNullOrEmpty(email)) email = upn;
		string nome = Claim(claim, "name");
		if (string.IsNullOrEmpty(email)) throw new EntraException("errore", "L'account Microsoft non ha un indirizzo email.");
		if (string.IsNullOrWhiteSpace(nome)) nome = email;

		Entra(ctx, oid, email, upn, nome, ritorno);
	}

	private static void Entra(HttpContext ctx, Guid oid, string email, string upn, string nome, string ritorno)
	{
		string ip = ctx.Request.UserHostAddress;
		using (SqlConnection cn = Open())
		{
			int id = 0;
			string username = null, nomeCompleto = null;
			bool attivo = false, trovato = false, legato = false;
			using (SqlCommand cmd = new SqlCommand(
				"SELECT TOP 1 Id, Username, NomeCompleto, Attivo, CASE WHEN EntraOid IS NULL THEN 0 ELSE 1 END FROM dbo.Utenti " +
				"WHERE EntraOid = @oid OR (EntraOid IS NULL AND (Email = @e OR Username = @e OR Username = @upn)) " +
				"ORDER BY CASE WHEN EntraOid = @oid THEN 0 WHEN Email = @e THEN 1 ELSE 2 END, Id", cn))
			{
				cmd.Parameters.Add("@oid", SqlDbType.UniqueIdentifier).Value = oid;
				cmd.Parameters.Add("@e", SqlDbType.NVarChar, 150).Value = Taglia(email, 150);
				cmd.Parameters.Add("@upn", SqlDbType.NVarChar, 150).Value = (object)Taglia(upn, 150) ?? DBNull.Value;
				using (SqlDataReader r = cmd.ExecuteReader())
				{
					if (r.Read())
					{
						trovato = true;
						id = r.GetInt32(0);
						username = r.GetString(1);
						nomeCompleto = r.GetString(2);
						attivo = r.GetBoolean(3);
						legato = r.GetInt32(4) == 1;
					}
				}
			}

			if (!trovato)
			{
				int inAttesa;
				using (SqlCommand cmd = new SqlCommand("SELECT COUNT(*) FROM dbo.Utenti WHERE Attivo = 0", cn))
					inAttesa = (int)cmd.ExecuteScalar();
				if (inAttesa >= MaxPendingRegistrations)
					throw new EntraException("errore", "Ci sono troppe richieste in attesa di attivazione. Contatta l'amministratore.");

				username = Taglia(upn ?? email, 50);
				byte[] salt = RandomBytes(16);
				try
				{
					using (SqlCommand cmd = new SqlCommand(
						"INSERT INTO dbo.Utenti (Username, NomeCompleto, Email, PasswordHash, PasswordSalt, Iterazioni, Attivo, EntraOid) " +
						"VALUES (@u, @n, @e, @h, @s, @i, 0, @oid)", cn))
					{
						cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = username;
						cmd.Parameters.Add("@n", SqlDbType.NVarChar, 100).Value = Taglia(nome, 100);
						cmd.Parameters.Add("@e", SqlDbType.NVarChar, 150).Value = Taglia(email, 150);
						// Password inutilizzabile: chi entra con Microsoft non ha una password del Portale
						cmd.Parameters.Add("@h", SqlDbType.VarBinary, 32).Value = RandomBytes(32);
						cmd.Parameters.Add("@s", SqlDbType.VarBinary, 16).Value = salt;
						cmd.Parameters.Add("@i", SqlDbType.Int).Value = HashIterations;
						cmd.Parameters.Add("@oid", SqlDbType.UniqueIdentifier).Value = oid;
						cmd.ExecuteNonQuery();
					}
				}
				catch (SqlException ex)
				{
					if (ex.Number == 2627 || ex.Number == 2601)
						throw new EntraException("errore", "Esiste già un utente \"" + username + "\" collegato a un altro account Microsoft. Contatta l'amministratore.");
					throw;
				}
				WriteLog(cn, null, username, "Registrazione", ip, "Da Microsoft (" + Taglia(email, 120) + "), in attesa di attivazione");
				throw new EntraException("attesa", "Richiesta registrata: potrai entrare quando un amministratore avrà attivato il tuo account.");
			}

			using (SqlCommand cmd = new SqlCommand(
				"UPDATE dbo.Utenti SET EntraOid = ISNULL(EntraOid, @oid), Email = ISNULL(Email, @e)" +
				(attivo ? ", UltimoAccesso = SYSDATETIME(), TentativiFalliti = 0, BloccatoFinoA = NULL" : "") + " WHERE Id = @id", cn))
			{
				cmd.Parameters.Add("@oid", SqlDbType.UniqueIdentifier).Value = oid;
				cmd.Parameters.Add("@e", SqlDbType.NVarChar, 150).Value = Taglia(email, 150);
				cmd.Parameters.Add("@id", SqlDbType.Int).Value = id;
				cmd.ExecuteNonQuery();
			}
			if (!legato) WriteLog(cn, id, username, "EntraCollegato", ip, Taglia(email, 200));

			if (!attivo)
			{
				WriteLog(cn, id, username, "NonAttivo", ip, "Accesso Microsoft ma account non attivato");
				throw new EntraException("attesa", "Il tuo account non è ancora stato attivato. Chiedi all'amministratore di attivarlo.");
			}

			WriteLog(cn, id, username, "LoginEntra", ip, null);
			SignIn(ctx, username, nomeCompleto);
		}
		ctx.Response.Redirect(VirtualPathUtility.ToAbsolute("~/") + ritorno.TrimStart('/'), false);
		ctx.ApplicationInstance.CompleteRequest();
	}

	private static Dictionary<string, object> ScambiaCodice(Config cfg, string code, string verifier)
	{
		ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
		string corpo = "client_id=" + Uri.EscapeDataString(cfg.ClientId) +
			"&scope=" + Uri.EscapeDataString("openid profile email") +
			"&code=" + Uri.EscapeDataString(code) +
			"&redirect_uri=" + Uri.EscapeDataString(cfg.RedirectUri) +
			"&grant_type=authorization_code" +
			"&code_verifier=" + Uri.EscapeDataString(verifier) +
			"&client_secret=" + Uri.EscapeDataString(cfg.Secret);
		HttpWebRequest req = (HttpWebRequest)WebRequest.Create("https://login.microsoftonline.com/" + Uri.EscapeDataString(cfg.Tenant) + "/oauth2/v2.0/token");
		req.Method = "POST";
		req.ContentType = "application/x-www-form-urlencoded";
		req.Timeout = 15000;
		byte[] b = Encoding.ASCII.GetBytes(corpo);
		using (Stream s = req.GetRequestStream()) s.Write(b, 0, b.Length);
		string json;
		try
		{
			using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
			using (StreamReader sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8)) json = sr.ReadToEnd();
		}
		catch (WebException ex)
		{
			if (ex.Response == null) throw new Exception("Il server del Portale non raggiunge login.microsoftonline.com (" + ex.Status + ").");
			using (StreamReader sr = new StreamReader(ex.Response.GetResponseStream(), Encoding.UTF8)) json = sr.ReadToEnd();
			Dictionary<string, object> e = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
			string desc = e != null && e.ContainsKey("error_description") ? Convert.ToString(e["error_description"]) : json;
			throw new Exception("Microsoft ha rifiutato il codice: " + Taglia(desc, 300));
		}
		Dictionary<string, object> d = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
		if (d == null) throw new Exception("Risposta di Microsoft non valida.");
		return d;
	}

	private static Dictionary<string, object> LeggiIdToken(string jwt)
	{
		string[] p = jwt.Split('.');
		if (p.Length < 2) throw new Exception("id_token non valido.");
		Dictionary<string, object> d = new JavaScriptSerializer().DeserializeObject(Encoding.UTF8.GetString(FromBase64Url(p[1]))) as Dictionary<string, object>;
		if (d == null) throw new Exception("id_token non valido.");
		return d;
	}

	private static string Claim(Dictionary<string, object> d, string k)
	{
		object v;
		return d.TryGetValue(k, out v) && v != null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : null;
	}

	private static void VaiAlLogin(HttpContext ctx, string codice, string msg)
	{
		ctx.Response.Redirect(VirtualPathUtility.ToAbsolute("~/Login.html") + "?entra=" + Uri.EscapeDataString(codice) + "&msg=" + Uri.EscapeDataString(Taglia(msg, 300)), false);
		ctx.ApplicationInstance.CompleteRequest();
	}

	private static void CancellaCookie(HttpContext ctx)
	{
		HttpCookie c = new HttpCookie(CookieName, "");
		c.Expires = DateTime.UtcNow.AddDays(-1);
		c.Path = "/";
		c.HttpOnly = true;
		ctx.Response.Cookies.Add(c);
	}

	// Uguale a Auth.ashx
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

	private static string SafeReturnUrl(string url)
	{
		const string home = "Portale.html";
		if (url == null) return home;
		url = url.Trim();
		if (url.Length == 0 || url.Length > 500) return home;
		foreach (char ch in url) if (ch < ' ' || ch == '\\') return home;
		bool local = (url[0] == '/' && !url.StartsWith("//", StringComparison.Ordinal)) || LocalPageRx.IsMatch(url);
		if (!local) return home;
		string path = url;
		int q = url.IndexOfAny(new char[] { '?', '#' });
		if (q >= 0) path = url.Substring(0, q);
		path = path.ToLowerInvariant();
		if (path == "login.html" || path.EndsWith("/login.html", StringComparison.Ordinal) || path.Contains("/api/")) return home;
		// Indirizzo assoluto dell'applicazione: si tiene solo la parte dopo la radice
		string radice = VirtualPathUtility.ToAbsolute("~/");
		if (url[0] == '/') url = url.StartsWith(radice, StringComparison.OrdinalIgnoreCase) ? url.Substring(radice.Length) : home;
		return url;
	}

	private static SqlConnection Open()
	{
		ConnectionStringSettings cs = ConfigurationManager.ConnectionStrings[ConnectionName];
		if (cs == null || string.IsNullOrEmpty(cs.ConnectionString))
			throw new InvalidOperationException("Nel Web.config manca la stringa di connessione '" + ConnectionName + "'.");
		SqlConnection cn = new SqlConnection(cs.ConnectionString);
		cn.Open();
		return cn;
	}

	private static void WriteLog(SqlConnection cn, int? userId, string username, string evento, string ip, string detail)
	{
		try
		{
			using (SqlCommand cmd = new SqlCommand(
				"INSERT INTO dbo.AccessiLog (UserId, Username, Evento, Indirizzo, Dettaglio) VALUES (@id, @u, @e, @ip, @d)", cn))
			{
				cmd.Parameters.Add("@id", SqlDbType.Int).Value = userId.HasValue ? (object)userId.Value : DBNull.Value;
				cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = (object)Taglia(username, 50) ?? DBNull.Value;
				cmd.Parameters.Add("@e", SqlDbType.NVarChar, 30).Value = evento;
				cmd.Parameters.Add("@ip", SqlDbType.NVarChar, 45).Value = (object)Taglia(ip, 45) ?? DBNull.Value;
				cmd.Parameters.Add("@d", SqlDbType.NVarChar, 200).Value = (object)Taglia(detail, 200) ?? DBNull.Value;
				cmd.ExecuteNonQuery();
			}
		}
		catch (Exception)
		{
		}
	}

	private static string Taglia(string s, int max)
	{
		if (s == null) return null;
		return s.Length > max ? s.Substring(0, max) : s;
	}

	private static byte[] RandomBytes(int n)
	{
		byte[] b = new byte[n];
		using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider()) rng.GetBytes(b);
		return b;
	}

	private static string Base64Url(byte[] b)
	{
		return Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
	}

	private static byte[] FromBase64Url(string s)
	{
		string t = s.Replace('-', '+').Replace('_', '/');
		switch (t.Length % 4) { case 2: t += "=="; break; case 3: t += "="; break; }
		return Convert.FromBase64String(t);
	}
}
