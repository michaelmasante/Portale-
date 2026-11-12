<%@ WebHandler Language="C#" Class="DriveLineHandler" %>

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data;
using System.Data.Common;
using System.Data.Odbc;
using System.Data.OleDb;
using System.Data.SqlClient;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Web;
using System.Web.Script.Serialization;
using Microsoft.Win32;

public class DriveLineHandler : IHttpHandler
{
	private const string LoginConnection = "PortaleLogin";
	private const string TestConnection = "DriveLineTest";
	private const string SorgenteWebConfig = "DriveLineSorgente";
	// Tenere uguali al meta "ruoli" di DriveLine.html
	private static readonly string[] RuoliAccesso = { "DriveLine", "Admin" };
	private const int MaxBodyChars = 16 * 1024 * 1024;
	private const int MaxRigheSalvate = 1000000;
	private const int SecondiPorta = 5;
	private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

	private static readonly string[] TabelleScrivibili = { "GAN_DRIVELINE_1", "GAN_DRIVELINE_Ant_Sped", "N09J0121_DLT" };
	private static readonly string[] TabelleVisibili = { "GAN_DRIVELINE_1", "GAN_DRIVELINE_Ant_Sped", "N09J0121_DLT", "Stato35", "CDA_COSTRUTTORI" };

	private const string ColOrigine = "Origine";
	private const string ColCaricato = "CaricatoIl";

	private static readonly Dictionary<string, string[]> ColonneAttese = new Dictionary<string, string[]>
	{
		{ "gan", new string[] { "ACT_CENTER_CODE", "WORK_CENTER_CODE", "ASSEMBLY_ORDER_NBR", "PARTNBR", "USER_CDA", "BUSINESS_NUMBER",
			"DUE_ALLOTMENT_DATE", "DUE_DATE", "CALC_ONLINE_DATE", "ACTUAL_ONLINE_DATE", "ACT_ALLOTMENT_DATE", "PROGRESS_STATUS",
			"PROGRESS_SUBSTATUS", "ORDER_IDN", "ORDER_NUMBER", "ORDER_LINE", "ANNULL_FLG", "ANNULL_DATE", "CALC_ALLOT_DATE",
			"DATA_EFFETT_DISLIN", "LAST_UPDATE_DATE", "SERIAL_NO", "DATA_EFFETT_DELIB", "DATA_RILASCIO_LEV3" } },
		{ "dlt", new string[] { "Cda", "Linea", "Tipo_Ordine", "Gan", "Disegno", "Matricola", "Cda_U", "Cod_Cliente", "Data_Imp",
			"Data_Dis_Lin", "Data_Finiz", "Data_Sped", "Stato", "Sotto_Stato", "Data_Ult_Var", "Ora_Ult_Var", "Polmone",
			"Data_Seq", "Num_Seq", "Data_Ord" } },
		{ "cda", new string[] { "CDA" } }
	};
	private static readonly Dictionary<string, string> TabellePredefinite = new Dictionary<string, string>
	{
		{ "gan", "FI_GAN_L4" }, { "dlt", "N09J0121_DLT" }, { "cda", "" }
	};

	private class CampoTxt
	{
		public string Nome;
		public int Da;
		public int Lung;
		public string Tipo;
	}

	private static CampoTxt T(string nome, int da, int lung, string tipo)
	{
		CampoTxt c = new CampoTxt();
		c.Nome = nome; c.Da = da; c.Lung = lung; c.Tipo = tipo;
		return c;
	}

	// Posizioni di Cda, Linea e Tipo_Ordine da confermare
	private static readonly CampoTxt[] TracciatoDlt = {
		T("Cda", 11, 5, "testo"),
		T("Linea", 16, 8, "testo"),
		T("Tipo_Ordine", 24, 1, "testo"),
		T("Gan", 25, 8, "testo"),
		T("Disegno", 33, 15, "testo"),
		T("Matricola", 48, 9, "testo"),
		T("Cda_U", 57, 7, "testo"),
		T("Cod_Cliente", 64, 6, "testo"),
		T("Data_Imp", 70, 6, "data"),
		T("Data_Dis_Lin", 76, 6, "data"),
		T("Data_Finiz", 82, 6, "data"),
		T("Data_Sped", 88, 6, "data"),
		T("Stato", 94, 2, "intero"),
		T("Sotto_Stato", 96, 2, "testo"),
		T("Data_Ult_Var", 98, 6, "data"),
		T("Ora_Ult_Var", 104, 4, "testo"),
		T("Polmone", 108, 3, "testo"),
		T("Data_Seq", 111, 6, "data"),
		T("Num_Seq", 117, 4, "intero"),
		T("Data_Ord", 121, 6, "data")
	};
	private const int LunghezzaRigaDlt = 126;

	private class UserException : Exception
	{
		public Dictionary<string, object> Diagnosi;
		public UserException(string message) : base(message) { }
		public UserException(string message, Dictionary<string, object> diagnosi) : base(message) { Diagnosi = diagnosi; }
	}

	private class ForbiddenException : Exception
	{
		public ForbiddenException(string message) : base(message) { }
	}

	private class Utente
	{
		public string Username;
		public string Nome;
		public List<string> Ruoli = new List<string>();

		public bool HaUno(string[] ruoli)
		{
			foreach (string r in Ruoli)
				foreach (string x in ruoli)
					if (string.Equals(r, x, StringComparison.OrdinalIgnoreCase)) return true;
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
			if (req.QueryString["health"] != null) { Reply(context, Health()); return; }

			Utente u = CaricaUtente(context);
			string action = (req.QueryString["action"] ?? "").Trim().ToLowerInvariant();
			Dictionary<string, object> d;

			if (action == "info") d = InfoServer();
			else if (action == "vedi") d = Vedi(req.QueryString["tabella"], IntDaQuery(req, "max", 200));
			else if (action == "cda") d = CdaElenco();
			else
			{
				Dictionary<string, object> body = LeggiPost(context);
				if (action == "test") d = Test(body, u);
				else if (action == "query") d = Query(body, u);
				else if (action == "locale") d = Locale(body, u);
				else if (action == "cda_salva") d = CdaSalva(body, u);
				else if (action == "dlt_anteprima") d = Dlt(body, u, false);
				else if (action == "dlt_carica") d = Dlt(body, u, true);
				else throw new UserException("Richiesta non valida.");
			}
			Reply(context, d);
		}
		catch (ForbiddenException ex)
		{
			res.StatusCode = 403;
			res.TrySkipIisCustomErrors = true;
			Error(context, ex.Message, null);
		}
		catch (UserException ex)
		{
			Error(context, ex.Message, ex.Diagnosi);
		}
		catch (Exception ex)
		{
			res.StatusCode = 500;
			res.TrySkipIisCustomErrors = true;
			Error(context, "Errore imprevisto sul server del Portale.", Spiega(ex));
		}
	}

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
			using (SqlConnection cn = ApriConfig(LoginConnection))
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
		if (!u.HaUno(RuoliAccesso)) throw new ForbiddenException("Questa pagina è riservata ai ruoli DriveLine e Admin.");
		return u;
	}

	private class Sorgente
	{
		public string Tipo;
		public string Dialetto;
		public string Invariant;
		public string Host = "";
		public int Porta;
		public bool PortaPredefinita;
		public string Istanza = "";
		public string Stringa;
		public string StringaVisibile;
		public int TimeoutConn = 15;
		public int TimeoutQuery = 120;
		public string Descrizione;
	}

	private static readonly string[] Tipi = { "sqlserver", "oracle", "odbc", "oledb", "webconfig" };
	private static readonly string[] Dialetti = { "sqlserver", "oracle", "db2", "odbc" };

	private static Sorgente CreaSorgente(Dictionary<string, object> c)
	{
		Sorgente s = new Sorgente();
		s.Tipo = StrOpt(c, "tipo").ToLowerInvariant();
		if (Array.IndexOf(Tipi, s.Tipo) < 0) throw new UserException("Scegli il tipo di database.");
		s.Dialetto = StrOpt(c, "dialetto").ToLowerInvariant();
		if (Array.IndexOf(Dialetti, s.Dialetto) < 0) s.Dialetto = s.Tipo == "oracle" ? "oracle" : s.Tipo == "odbc" ? "odbc" : "sqlserver";
		s.TimeoutConn = Limita(IntOpt(c, "timeoutConn", 15), 3, 120);
		s.TimeoutQuery = Limita(IntOpt(c, "timeoutQuery", 120), 5, 1800);

		string server = StrOpt(c, "server").Trim();
		s.Porta = IntOpt(c, "porta", 0);
		s.Istanza = StrOpt(c, "istanza").Trim();
		int virgola = server.IndexOf(',');
		if (virgola > 0)
		{
			int p;
			if (s.Porta == 0 && int.TryParse(server.Substring(virgola + 1).Trim(), NumberStyles.None, Inv, out p)) s.Porta = p;
			server = server.Substring(0, virgola).Trim();
		}
		int barra = server.IndexOf('\\');
		if (barra > 0)
		{
			if (s.Istanza.Length == 0) s.Istanza = server.Substring(barra + 1).Trim();
			server = server.Substring(0, barra).Trim();
		}
		int duePunti = server.LastIndexOf(':');
		if (duePunti > 0 && server.IndexOf(':') == duePunti)
		{
			int p;
			if (int.TryParse(server.Substring(duePunti + 1), NumberStyles.None, Inv, out p))
			{
				if (s.Porta == 0) s.Porta = p;
				server = server.Substring(0, duePunti);
			}
		}
		s.Host = server;
		if (s.Porta < 0 || s.Porta > 65535) throw new UserException("La porta deve essere un numero fra 1 e 65535.");

		string database = StrOpt(c, "database").Trim();
		string utente = StrOpt(c, "utente").Trim();
		string password = StrOpt(c, "password");
		bool windows = BoolOpt(c, "windows");

		if (s.Tipo == "sqlserver")
		{
			if (s.Host.Length == 0) throw new UserException("Scrivi il nome o l'indirizzo IP del server.");
			if (!windows && utente.Length == 0) throw new UserException("Scrivi l'utente (oppure spunta «Autenticazione Windows»).");
			SqlConnectionStringBuilder b = new SqlConnectionStringBuilder();
			string ds = s.Host;
			if (s.Istanza.Length > 0) ds += "\\" + s.Istanza;
			if (s.Porta > 0) ds += "," + s.Porta.ToString(Inv);
			b.DataSource = ds;
			if (database.Length > 0) b.InitialCatalog = database;
			if (windows) b.IntegratedSecurity = true;
			else { b.UserID = utente; b.Password = password; }
			b.ConnectTimeout = s.TimeoutConn;
			b.Encrypt = BoolOpt(c, "encrypt");
			b.TrustServerCertificate = BoolOpt(c, "trust");
			b.ApplicationName = "Portale Servizi - test DriveLine";
			b.Pooling = false;
			s.Stringa = b.ConnectionString;
			if (!windows && password.Length > 0) b.Password = "*****";
			s.StringaVisibile = b.ConnectionString;
			if (s.Porta == 0 && s.Istanza.Length == 0) { s.Porta = 1433; s.PortaPredefinita = true; }
		}
		else if (s.Tipo == "webconfig")
		{
			ConnectionStringSettings cs = ConfigurationManager.ConnectionStrings[SorgenteWebConfig];
			if (cs == null || string.IsNullOrEmpty(cs.ConnectionString))
				throw new UserException("Nel Web.config non c'è la stringa di connessione «" + SorgenteWebConfig + "».");
			s.Invariant = string.IsNullOrEmpty(cs.ProviderName) ? "System.Data.SqlClient" : cs.ProviderName;
			s.Stringa = cs.ConnectionString;
			s.StringaVisibile = Regex.Replace(cs.ConnectionString, @"(?i)\b(password|pwd)\s*=\s*(\{[^}]*\}|""[^""]*""|[^;]*)", "$1=*****");
		}
		else
		{
			if (s.Tipo == "oracle") s.Invariant = "Oracle.ManagedDataAccess.Client";
			string modello = StrOpt(c, "stringa").Trim();
			if (modello.Length == 0) throw new UserException("Scrivi la stringa di connessione (c'è un modello per ogni driver nel menu).");
			s.Stringa = Riempi(modello, s, database, utente, password, false);
			s.StringaVisibile = Riempi(modello, s, database, utente, password.Length > 0 ? "*****" : "", true);
			if (s.Porta == 0 && s.Tipo == "oracle" && s.Host.Length > 0) { s.Porta = 1521; s.PortaPredefinita = true; }
		}

		s.Descrizione = s.Tipo + " " + s.Host + (s.Istanza.Length > 0 ? "\\" + s.Istanza : "") + (s.Porta > 0 ? ":" + s.Porta.ToString(Inv) : "");
		return s;
	}

	private static string Riempi(string modello, Sorgente s, string database, string utente, string password, bool visibile)
	{
		bool odbc = s.Tipo == "odbc";
		return Regex.Replace(modello, @"\{([A-Z]+)\}", delegate (Match m)
		{
			string k = m.Groups[1].Value;
			string v;
			if (k == "SERVER") v = s.Host;
			else if (k == "PORTA")
			{
				if (s.Porta == 0) throw new UserException("La stringa di connessione usa {PORTA}: scrivi la porta.");
				v = s.Porta.ToString(Inv);
			}
			else if (k == "ISTANZA") v = s.Istanza;
			else if (k == "DATABASE") v = database;
			else if (k == "UTENTE") v = utente;
			else if (k == "PASSWORD") v = password;
			else if (k == "TIMEOUT") v = s.TimeoutConn.ToString(Inv);
			else throw new UserException("Nella stringa di connessione c'è {" + k + "}, che non conosco. Valgono: {SERVER} {PORTA} {ISTANZA} {DATABASE} {UTENTE} {PASSWORD} {TIMEOUT}.");
			if (visibile || (k != "PASSWORD" && k != "UTENTE")) return v;
			if (v.IndexOf(';') < 0 && !v.StartsWith("{") && !v.StartsWith("\"") && !v.StartsWith("'")) return v;
			if (odbc) return "{" + v.Replace("}", "}}") + "}";
			return "\"" + v.Replace("\"", "\"\"") + "\"";
		});
	}

	private static DbProviderFactory Fabbrica(Sorgente s)
	{
		if (s.Tipo == "sqlserver") return SqlClientFactory.Instance;
		if (s.Tipo == "odbc") return OdbcFactory.Instance;
		if (s.Tipo == "oledb") return OleDbFactory.Instance;
		return DbProviderFactories.GetFactory(s.Invariant);
	}

	private static DbConnection Apri(Sorgente s, DbProviderFactory f)
	{
		DbConnection cn = f.CreateConnection();
		try
		{
			cn.ConnectionString = s.Stringa;
			OdbcConnection oc = cn as OdbcConnection;
			if (oc != null) oc.ConnectionTimeout = s.TimeoutConn;
			cn.Open();
			return cn;
		}
		catch
		{
			cn.Dispose();
			throw;
		}
	}

	private static Dictionary<string, string> TabelleDa(Dictionary<string, object> body)
	{
		Dictionary<string, string> t = new Dictionary<string, string>();
		Dictionary<string, object> dati = Dict(body, "tabelle");
		foreach (KeyValuePair<string, string> kv in TabellePredefinite)
		{
			string v = StrOpt(dati, kv.Key).Trim();
			if (!dati.ContainsKey(kv.Key)) v = kv.Value;
			if (v.Length > 0 && !Regex.IsMatch(v, @"^[A-Za-z0-9_$#@.\[\]""\-]{1,128}$"))
				throw new UserException("Il nome tabella «" + v + "» non è valido: lettere, numeri, _ . - e, se serve, [ ] o \" \" (niente spazi).");
			t[kv.Key] = v;
		}
		return t;
	}

	private static Dictionary<string, object> Passo(List<object> passi, string nome, string esito, string testo, Stopwatch sw, Dictionary<string, object> diagnosi)
	{
		Dictionary<string, object> p = new Dictionary<string, object>();
		p["nome"] = nome;
		p["esito"] = esito;
		p["testo"] = testo;
		if (sw != null) p["ms"] = (int)sw.ElapsedMilliseconds;
		if (diagnosi != null) p["diagnosi"] = diagnosi;
		passi.Add(p);
		return p;
	}

	private static Dictionary<string, object> Test(Dictionary<string, object> body, Utente u)
	{
		Sorgente s = CreaSorgente(Dict(body, "conn"));
		Dictionary<string, string> tabelle = TabelleDa(body);
		List<object> passi = new List<object>();
		bool riuscito = EseguiPassi(s, tabelle, passi);

		Log(u, "test", s.Descrizione + " -> " + (riuscito ? "riuscito" : "NON riuscito"));
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["riuscito"] = riuscito;
		d["passi"] = passi;
		d["stringa"] = s.StringaVisibile;
		return d;
	}

	private static bool EseguiPassi(Sorgente s, Dictionary<string, string> tabelle, List<object> passi)
	{
		Stopwatch sw = Stopwatch.StartNew();
		DbProviderFactory f;
		try
		{
			f = Fabbrica(s);
		}
		catch (Exception ex)
		{
			Passo(passi, "Driver sul server del Portale", "ko", "Il driver per questo tipo di database non c'è.", sw, Spiega(ex));
			return false;
		}
		if (s.Tipo == "odbc")
		{
			Dictionary<string, object> diag = ControllaOdbc(s.Stringa);
			if (diag != null)
			{
				Passo(passi, "Driver sul server del Portale", "ko", (string)diag["titolo"], sw, diag);
				return false;
			}
		}
		Passo(passi, "Driver sul server del Portale", "ok", NomeDriver(s), sw, null);

		IPAddress ip = null;
		if (s.Host.Length == 0)
		{
			Passo(passi, "Nome del server (DNS)", "salto", "Server non indicato nel campo «Server»: le prove di rete si saltano, decide la stringa di connessione.", null, null);
		}
		else
		{
			sw = Stopwatch.StartNew();
			try
			{
				if (!IPAddress.TryParse(s.Host, out ip))
				{
					IPAddress[] tutti = Dns.GetHostAddresses(s.Host);
					foreach (IPAddress a in tutti) if (a.AddressFamily == AddressFamily.InterNetwork) { ip = a; break; }
					if (ip == null && tutti.Length > 0) ip = tutti[0];
					if (ip == null) throw new SocketException(11001);
					Passo(passi, "Nome del server (DNS)", "ok", s.Host + " → " + ip, sw, null);
				}
				else Passo(passi, "Nome del server (DNS)", "ok", "È già un indirizzo IP: " + s.Host, sw, null);
			}
			catch (Exception ex)
			{
				Passo(passi, "Nome del server (DNS)", "ko", "Il nome «" + s.Host + "» non viene trovato.", sw, DiagDns(s.Host, ex));
				return false;
			}
		}

		if (ip != null && s.Tipo == "sqlserver" && s.Porta == 0 && s.Istanza.Length > 0)
		{
			sw = Stopwatch.StartNew();
			string errore;
			int porta = PortaIstanza(ip, s.Istanza, out errore);
			if (porta > 0)
			{
				s.Porta = porta;
				Passo(passi, "Porta dell'istanza " + s.Istanza, "ok", "SQL Browser risponde: l'istanza è sulla porta TCP " + porta + ".", sw, null);
			}
			else
			{
				Passo(passi, "Porta dell'istanza " + s.Istanza, "avviso",
					"SQL Browser (UDP 1434) non risponde: provo lo stesso ad accedere. Se l'accesso fallisce, chiedi la porta TCP dell'istanza e scrivila nel campo Porta.",
					sw, Diag("SQL Browser non risponde",
						"Con un'istanza con nome il client chiede la porta al servizio SQL Browser sulla porta UDP 1434. Nessuna risposta: firewall che blocca UDP 1434, oppure servizio SQL Browser fermo.",
						new string[] { "Chiedi a chi gestisce il loro SQL Server la porta TCP fissa dell'istanza " + s.Istanza + " e scrivila nel campo Porta.", "In alternativa va aperta la porta UDP 1434 dal server del Portale (" + IpServer() + ")." },
						errore));
			}
		}

		if (ip != null)
		{
			if (s.Porta == 0)
				Passo(passi, "Porta TCP", "salto", "Porta non indicata: la prova della porta si salta (scrivila per avere la diagnosi di rete).", null, null);
			else
			{
				sw = Stopwatch.StartNew();
				string esitoPorta;
				Exception exPorta;
				bool aperta = ProvaPorta(ip, s.Porta, out esitoPorta, out exPorta);
				string dove = s.Host + ":" + s.Porta + (s.PortaPredefinita ? " (porta standard)" : "");
				if (aperta) Passo(passi, "Porta TCP " + s.Porta, "ok", dove + " risponde (" + sw.ElapsedMilliseconds + " ms).", sw, null);
				else
				{
					Passo(passi, "Porta TCP " + s.Porta, "ko", dove + ": " + esitoPorta, sw, DiagPorta(s, esitoPorta, exPorta));
					return false;
				}
			}
		}

		sw = Stopwatch.StartNew();
		DbConnection cn;
		try
		{
			cn = Apri(s, f);
		}
		catch (Exception ex)
		{
			Passo(passi, "Accesso al database", "ko", "Il server non ha accettato il collegamento.", sw, Spiega(ex));
			return false;
		}

		using (cn)
		{
			string versione = "";
			try { versione = cn.ServerVersion; } catch (Exception) { }
			string db = "";
			try { db = cn.Database; } catch (Exception) { }
			Passo(passi, "Accesso al database", "ok",
				"Collegato in " + sw.ElapsedMilliseconds + " ms" + (db.Length > 0 ? ", database «" + db + "»" : "") + (versione.Length > 0 ? ", versione " + versione : "") + ".",
				sw, null);

			string sqlChi = null;
			if (s.Dialetto == "sqlserver") sqlChi = "SELECT SUSER_SNAME(), DB_NAME(), @@SERVERNAME";
			else if (s.Dialetto == "oracle") sqlChi = "SELECT USER, SYS_CONTEXT('USERENV','DB_NAME'), SYS_CONTEXT('USERENV','SERVER_HOST') FROM DUAL";
			else if (s.Dialetto == "db2") sqlChi = "SELECT CURRENT USER, CURRENT SERVER, CURRENT SCHEMA FROM SYSIBM.SYSDUMMY1";
			if (sqlChi != null)
			{
				sw = Stopwatch.StartNew();
				try
				{
					using (DbCommand cmd = cn.CreateCommand())
					{
						cmd.CommandText = sqlChi;
						cmd.CommandTimeout = 30;
						using (DbDataReader r = cmd.ExecuteReader())
						{
							if (r.Read())
							{
								List<string> parti = new List<string>();
								string[] etichette = s.Dialetto == "db2" ? new string[] { "utente", "server", "schema" } : new string[] { "utente", "database", "server" };
								for (int i = 0; i < r.FieldCount && i < 3; i++) if (!r.IsDBNull(i)) parti.Add(etichette[i] + " " + Convert.ToString(r.GetValue(i), Inv));
								Passo(passi, "Chi sono sul database", "ok", string.Join(", ", parti.ToArray()) + ".", sw, null);
							}
						}
					}
				}
				catch (Exception ex)
				{
					Passo(passi, "Chi sono sul database", "avviso",
						"Non riesco a leggere utente e database. Non blocca la prova, ma può voler dire che il «Dialetto SQL» scelto non è quello di questo database.",
						sw, Spiega(ex));
				}
			}

			bool tutteOk = true;
			foreach (KeyValuePair<string, string> kv in tabelle)
			{
				if (kv.Value.Length == 0) continue;
				sw = Stopwatch.StartNew();
				try
				{
					List<string> colonne = new List<string>();
					using (DbCommand cmd = cn.CreateCommand())
					{
						cmd.CommandText = "SELECT * FROM " + kv.Value + " WHERE 1 = 0";
						cmd.CommandTimeout = 60;
						using (DbDataReader r = cmd.ExecuteReader())
							for (int i = 0; i < r.FieldCount; i++) colonne.Add(r.GetName(i));
					}
					List<string> mancanti = new List<string>();
					foreach (string attesa in ColonneAttese[kv.Key])
					{
						bool c = false;
						foreach (string x in colonne) if (string.Equals(x, attesa, StringComparison.OrdinalIgnoreCase)) { c = true; break; }
						if (!c) mancanti.Add(attesa);
					}
					Dictionary<string, object> p;
					if (mancanti.Count == 0)
						p = Passo(passi, "Tabella " + kv.Value, "ok",
							"Trovata e leggibile, " + colonne.Count + " colonne: ci sono tutte le " + ColonneAttese[kv.Key].Length + " colonne usate dalle query.", sw, null);
					else
					{
						tutteOk = false;
						p = Passo(passi, "Tabella " + kv.Value, "avviso",
							"Trovata e leggibile (" + colonne.Count + " colonne), ma mancano " + mancanti.Count + " colonne usate dalle query: " + string.Join(", ", mancanti.ToArray()) + ".",
							sw, Diag("Colonne con un altro nome",
								"La tabella c'è, ma alcune colonne delle query di Access qui hanno un altro nome (o non ci sono).",
								new string[] { "Guarda l'elenco delle colonne vere qui sotto e correggi i nomi nelle query (sezione 2), ad esempio «NOME_VERO AS NOME_ACCESS».", "Se l'elenco è molto diverso, forse è un'altra tabella con lo stesso nome: chiedi lo schema giusto (es. SCHEMA." + kv.Value + ")." },
								null));
					}
					p["colonne"] = colonne;
				}
				catch (Exception ex)
				{
					tutteOk = false;
					Passo(passi, "Tabella " + kv.Value, "ko", "Non riesco a leggerla.", sw, Spiega(ex));
				}
			}
			return tutteOk;
		}
	}

	private static string NomeDriver(Sorgente s)
	{
		if (s.Tipo == "sqlserver") return "SqlClient (.NET, già presente nel server). Processo a " + (Environment.Is64BitProcess ? "64" : "32") + " bit.";
		if (s.Tipo == "odbc")
		{
			Match m = Regex.Match(s.Stringa, @"(?i)\b(?:driver\s*=\s*\{?([^};]+)\}?|dsn\s*=\s*([^;]+))");
			string che = m.Success ? (m.Groups[1].Success && m.Groups[1].Value.Length > 0 ? "driver «" + m.Groups[1].Value.Trim() + "»" : "DSN «" + m.Groups[2].Value.Trim() + "»") : "ODBC";
			return "ODBC: " + che + " trovato. Processo a " + (Environment.Is64BitProcess ? "64" : "32") + " bit.";
		}
		if (s.Tipo == "oledb") return "OLE DB (il provider si verifica al collegamento).";
		return "Provider .NET «" + s.Invariant + "» trovato.";
	}

	private static Dictionary<string, object> ControllaOdbc(string stringa)
	{
		Match drv = Regex.Match(stringa, @"(?i)\bdriver\s*=\s*\{?([^};]+)\}?");
		Match dsn = Regex.Match(stringa, @"(?i)\bdsn\s*=\s*([^;]+)");
		bool a64 = Environment.Is64BitProcess;
		if (drv.Success)
		{
			string nome = drv.Groups[1].Value.Trim();
			List<string> qui = ChiaviRegistro(@"SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers", a64 ? RegistryView.Registry64 : RegistryView.Registry32);
			if (Contiene(qui, nome)) return null;
			List<string> altri = ChiaviRegistro(@"SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers", a64 ? RegistryView.Registry32 : RegistryView.Registry64);
			if (Contiene(altri, nome))
				return Diag("Il driver «" + nome + "» è installato solo a " + (a64 ? "32" : "64") + " bit",
					"Il Portale gira a " + (a64 ? "64" : "32") + " bit e vede solo i driver ODBC a " + (a64 ? "64" : "32") + " bit.",
					new string[] { "Va installata la versione a " + (a64 ? "64" : "32") + " bit del driver sul server del Portale.", a64 ? "In alternativa (sconsigliato): in IIS, pool dell'applicazione → Impostazioni avanzate → «Abilita applicazioni a 32 bit» = True." : "" },
					"Driver ODBC a " + (a64 ? "64" : "32") + " bit installati: " + Elenco(qui));
			return Diag("Il driver ODBC «" + nome + "» non è installato sul server del Portale",
				"Il nome dopo Driver= deve essere identico a uno di quelli installati (maiuscole comprese, senza graffe).",
				new string[] { "Driver installati qui: " + Elenco(qui) + ".", "Se quello giusto non c'è, va installato sul server del Portale (es. client Oracle, IBM i Access, driver DB2)." },
				null);
		}
		if (dsn.Success)
		{
			string nome = dsn.Groups[1].Value.Trim();
			List<string> qui = ChiaviRegistro(@"SOFTWARE\ODBC\ODBC.INI\ODBC Data Sources", a64 ? RegistryView.Registry64 : RegistryView.Registry32);
			if (Contiene(qui, nome)) return null;
			return Diag("Il DSN «" + nome + "» non esiste sul server del Portale",
				"Un DSN è un collegamento ODBC salvato su un computer. Quello di Access sta sul PC dove gira Access, non sul server del Portale. Il Portale vede solo i DSN di sistema a " + (a64 ? "64" : "32") + " bit.",
				new string[] { "DSN di sistema presenti qui: " + Elenco(qui) + ".", "Meglio non usare il DSN: scegli il modello «Driver=...» con server, utente e password scritti nella stringa." },
				null);
		}
		return null;
	}

	private static bool Contiene(List<string> l, string nome)
	{
		foreach (string x in l) if (string.Equals(x, nome, StringComparison.OrdinalIgnoreCase)) return true;
		return false;
	}

	private static string Elenco(List<string> l)
	{
		return l.Count == 0 ? "nessuno" : "«" + string.Join("», «", l.ToArray()) + "»";
	}

	private static List<string> ChiaviRegistro(string percorso, RegistryView vista)
	{
		List<string> l = new List<string>();
		try
		{
			using (RegistryKey baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, vista))
			using (RegistryKey k = baseKey.OpenSubKey(percorso))
			{
				if (k != null) foreach (string n in k.GetValueNames()) if (n.Length > 0) l.Add(n);
			}
		}
		catch (Exception) { }
		l.Sort(StringComparer.OrdinalIgnoreCase);
		return l;
	}

	private static int PortaIstanza(IPAddress ip, string istanza, out string errore)
	{
		errore = null;
		try
		{
			using (UdpClient udp = new UdpClient(ip.AddressFamily))
			{
				udp.Client.ReceiveTimeout = 3000;
				byte[] nome = Encoding.ASCII.GetBytes(istanza);
				byte[] msg = new byte[nome.Length + 2];
				msg[0] = 0x04;
				Buffer.BlockCopy(nome, 0, msg, 1, nome.Length);
				udp.Connect(ip, 1434);
				udp.Send(msg, msg.Length);
				IPEndPoint da = null;
				byte[] r = udp.Receive(ref da);
				if (r.Length <= 3) { errore = "Risposta vuota da SQL Browser."; return 0; }
				string testo = Encoding.ASCII.GetString(r, 3, r.Length - 3);
				Match m = Regex.Match(testo, @"(?i)tcp;(\d+)");
				if (m.Success) return int.Parse(m.Groups[1].Value, Inv);
				errore = "SQL Browser risponde ma per l'istanza non indica una porta TCP: " + testo;
				return 0;
			}
		}
		catch (Exception ex)
		{
			errore = ex.GetType().Name + ": " + ex.Message;
			return 0;
		}
	}

	private static bool ProvaPorta(IPAddress ip, int porta, out string esito, out Exception errore)
	{
		esito = null;
		errore = null;
		using (TcpClient tc = new TcpClient(ip.AddressFamily))
		{
			try
			{
				IAsyncResult ar = tc.BeginConnect(ip, porta, null, null);
				if (!ar.AsyncWaitHandle.WaitOne(SecondiPorta * 1000))
				{
					esito = "nessuna risposta in " + SecondiPorta + " secondi.";
					return false;
				}
				tc.EndConnect(ar);
				return true;
			}
			catch (SocketException ex)
			{
				errore = ex;
				esito = ex.SocketErrorCode == SocketError.ConnectionRefused ? "connessione rifiutata." : "errore di rete (" + ex.SocketErrorCode + ").";
				return false;
			}
		}
	}

	private static Dictionary<string, object> Query(Dictionary<string, object> body, Utente u)
	{
		Sorgente s = CreaSorgente(Dict(body, "conn"));
		Dictionary<string, string> tabelle = TabelleDa(body);
		string testo = Str(body, "sql");
		int max = Limita(IntOpt(body, "max", 200), 1, 2000);
		bool contaTutte = BoolOpt(body, "contaTutte");
		string salva = StrOpt(body, "salva").Trim();
		string destinazione = null;
		if (salva.Length > 0)
		{
			destinazione = TrovaNome(salva, TabelleScrivibili);
			if (destinazione == null) throw new UserException("Tabella di destinazione non valida.");
		}

		string sql = Risolvi(testo, s, tabelle);
		ControllaSoloLettura(sql);

		DbProviderFactory f;
		try { f = Fabbrica(s); }
		catch (Exception ex) { return Fallita("Il driver per questo database non c'è sul server del Portale.", ex, sql); }

		Stopwatch swTot = Stopwatch.StartNew();
		DbConnection cn;
		try { cn = Apri(s, f); }
		catch (Exception ex) { return Fallita("Collegamento non riuscito: usa «Prova collegamento» per capire a che punto si ferma.", ex, sql); }

		List<object> colonne;
		string[] nomi;
		List<object[]> anteprima = new List<object[]>();
		List<object[]> tutte = destinazione != null ? new List<object[]>() : null;
		long totale = 0;
		bool completo = true;
		long msQuery;
		using (cn)
		{
			try
			{
				using (DbCommand cmd = cn.CreateCommand())
				{
					cmd.CommandText = sql;
					cmd.CommandTimeout = s.TimeoutQuery;
					Stopwatch sw = Stopwatch.StartNew();
					using (DbDataReader r = cmd.ExecuteReader())
					{
						colonne = DescriviColonne(r);
						nomi = new string[r.FieldCount];
						for (int i = 0; i < nomi.Length; i++) nomi[i] = r.GetName(i);
						DateTime limite = DateTime.UtcNow.AddSeconds(s.TimeoutQuery);
						while (r.Read())
						{
							totale++;
							if (tutte != null || anteprima.Count < max)
							{
								object[] v = LeggiRiga(r);
								if (tutte != null)
								{
									if (tutte.Count >= MaxRigheSalvate) throw new UserException("La query restituisce più di " + MaxRigheSalvate.ToString("N0", CultureInfo.GetCultureInfo("it-IT")) + " righe: per il test restringi il filtro.");
									tutte.Add(v);
								}
								if (anteprima.Count < max) anteprima.Add(v);
							}
							else if (!contaTutte || DateTime.UtcNow > limite)
							{
								completo = false;
								break;
							}
						}
						if (!completo) { try { cmd.Cancel(); } catch (Exception) { } }
					}
					msQuery = sw.ElapsedMilliseconds;
				}
			}
			catch (UserException) { throw; }
			catch (Exception ex)
			{
				Log(u, "query", s.Descrizione + " -> errore: " + ex.Message);
				return Fallita("La query non è andata a buon fine.", ex, sql);
			}
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["sql"] = sql;
		d["colonne"] = colonne;
		d["righe"] = RighePerJson(anteprima);
		d["totale"] = totale;
		d["completo"] = completo;
		d["msQuery"] = msQuery;

		if (destinazione != null)
		{
			try
			{
				d["salvataggio"] = Scrivi(destinazione, nomi, tutte, OrigineDi(destinazione));
			}
			catch (UserException ex)
			{
				d["salvataggio"] = SalvataggioFallito(ex.Message, ex.Diagnosi);
			}
			catch (Exception ex)
			{
				d["salvataggio"] = SalvataggioFallito("Lettura riuscita, ma il salvataggio nel database di test no.", Spiega(ex));
			}
		}
		d["ms"] = swTot.ElapsedMilliseconds;
		Log(u, "query", s.Descrizione + " -> " + totale + " righe" + (destinazione != null ? ", salva in " + destinazione : ""));
		return d;
	}

	private static string OrigineDi(string tabella)
	{
		if (tabella == "GAN_DRIVELINE_1") return "0005";
		if (tabella == "GAN_DRIVELINE_Ant_Sped") return "0010";
		return "DB";
	}

	private static Dictionary<string, object> Fallita(string messaggio, Exception ex, string sql)
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = false;
		d["message"] = messaggio;
		d["diagnosi"] = Spiega(ex);
		if (sql != null) d["sql"] = sql;
		return d;
	}

	private static Dictionary<string, object> SalvataggioFallito(string messaggio, Dictionary<string, object> diagnosi)
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["salvato"] = false;
		d["message"] = messaggio;
		if (diagnosi != null) d["diagnosi"] = diagnosi;
		return d;
	}

	private static string Risolvi(string sql, Sorgente s, Dictionary<string, string> tabelle)
	{
		int anno = DateTime.Today.Year;
		string[] cda = null;
		return Regex.Replace(sql, @"\{([A-Z0-9_]+)\}", delegate (Match m)
		{
			string k = m.Groups[1].Value;
			if (k == "INIZIO_ANNO") return DataSql(new DateTime(anno, 1, 1), s.Dialetto);
			if (k == "INIZIO_ANNO_PREC") return DataSql(new DateTime(anno - 1, 1, 1), s.Dialetto);
			if (k == "INIZIO_ANNO_SUCC") return DataSql(new DateTime(anno + 1, 1, 1), s.Dialetto);
			if (k == "OGGI") return DataSql(DateTime.Today, s.Dialetto);
			if (k == "FI_GAN_L4") return NomeTabella(tabelle, "gan");
			if (k == "N09J0121_DLT") return NomeTabella(tabelle, "dlt");
			if (k == "CDA_COSTRUTTORI")
			{
				if (cda == null) cda = LeggiCda();
				List<string> parti = new List<string>();
				foreach (string c in cda) parti.Add("'" + c.Replace("'", "''") + "'");
				return "(" + string.Join(", ", parti.ToArray()) + ")";
			}
			throw new UserException("Nella query c'è {" + k + "}, che non conosco. Valgono: {INIZIO_ANNO} {INIZIO_ANNO_PREC} {INIZIO_ANNO_SUCC} {OGGI} {CDA_COSTRUTTORI} {FI_GAN_L4} {N09J0121_DLT}.");
		});
	}

	private static string NomeTabella(Dictionary<string, string> tabelle, string chiave)
	{
		string v;
		if (!tabelle.TryGetValue(chiave, out v) || v.Length == 0) v = TabellePredefinite[chiave];
		return v;
	}

	private static string DataSql(DateTime d, string dialetto)
	{
		if (dialetto == "oracle") return "DATE '" + d.ToString("yyyy-MM-dd", Inv) + "'";
		if (dialetto == "db2") return "DATE('" + d.ToString("yyyy-MM-dd", Inv) + "')";
		if (dialetto == "odbc") return "{d '" + d.ToString("yyyy-MM-dd", Inv) + "'}";
		return "CAST('" + d.ToString("yyyyMMdd", Inv) + "' AS datetime)";
	}

	private static string[] LeggiCda()
	{
		List<string> l = new List<string>();
		try
		{
			using (SqlConnection cn = ApriConfig(TestConnection))
			using (SqlCommand cmd = new SqlCommand("SELECT CDA FROM dbo.CDA_COSTRUTTORI ORDER BY CDA", cn))
			using (SqlDataReader r = cmd.ExecuteReader())
				while (r.Read()) l.Add(r.GetString(0));
		}
		catch (Exception ex)
		{
			throw new UserException("La query usa {CDA_COSTRUTTORI}, ma non riesco a leggere l'elenco dal database di test.", Spiega(ex));
		}
		if (l.Count == 0)
			throw new UserException("La query usa {CDA_COSTRUTTORI}, ma l'elenco è vuoto: scrivi i CDA nella sezione 3 (sono quelli della tabella CDA-COSTRUTTORI di Access) oppure togli quella riga dalla query.");
		return l.ToArray();
	}

	private static void ControllaSoloLettura(string sql)
	{
		string t = Regex.Replace(sql, @"--[^\r\n]*|/\*.*?\*/", " ", RegexOptions.Singleline);
		t = Regex.Replace(t, @"'(?:[^']|'')*'", "''");
		t = Regex.Replace(t, @"""(?:[^""]|"""")*""", "\"\"");
		t = Regex.Replace(t, @"\[[^\]]*\]", "[]");
		t = t.Trim();
		while (t.EndsWith(";")) t = t.Substring(0, t.Length - 1).TrimEnd();
		if (t.Length == 0) throw new UserException("La query è vuota.");
		if (!Regex.IsMatch(t, @"^\(*\s*(SELECT|WITH)\b", RegexOptions.IgnoreCase))
			throw new UserException("Sul database sorgente si eseguono solo letture: la query deve iniziare con SELECT (o WITH).");
		if (t.IndexOf(';') >= 0) throw new UserException("Una query alla volta: c'è un punto e virgola in mezzo al testo.");
		Match m = Regex.Match(t, @"\b(INTO|INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|CALL)\b", RegexOptions.IgnoreCase);
		if (m.Success)
		{
			if (m.Value.ToUpperInvariant() == "INTO")
				throw new UserException("Togli «INTO ...» dalla query: qui la query legge soltanto. Il salvataggio nel database di test lo fa il bottone «Esegui e salva».");
			throw new UserException("Sul database sorgente si eseguono solo letture: la query contiene «" + m.Value.ToUpperInvariant() + "».");
		}
	}

	private static object[] LeggiRiga(DbDataReader r)
	{
		object[] v = new object[r.FieldCount];
		try
		{
			r.GetValues(v);
		}
		catch (Exception)
		{
			for (int i = 0; i < v.Length; i++)
			{
				try { v[i] = r.GetValue(i); }
				catch (Exception)
				{
					try { v[i] = r.GetString(i); }
					catch (Exception ex2) { v[i] = "(valore non leggibile: " + ex2.Message + ")"; }
				}
			}
		}
		return v;
	}

	private static List<object> DescriviColonne(DbDataReader r)
	{
		DataTable schema = null;
		try { schema = r.GetSchemaTable(); } catch (Exception) { }
		List<object> l = new List<object>();
		for (int i = 0; i < r.FieldCount; i++)
		{
			Dictionary<string, object> c = new Dictionary<string, object>();
			c["nome"] = r.GetName(i);
			try { c["tipoDb"] = r.GetDataTypeName(i); } catch (Exception) { c["tipoDb"] = ""; }
			try { c["tipo"] = r.GetFieldType(i).Name; } catch (Exception) { c["tipo"] = ""; }
			if (schema != null && i < schema.Rows.Count)
			{
				DataRow row = schema.Rows[i];
				c["dimensione"] = IntDaSchema(row, "ColumnSize");
				c["precisione"] = IntDaSchema(row, "NumericPrecision");
				c["scala"] = IntDaSchema(row, "NumericScale");
				object n = schema.Columns.Contains("AllowDBNull") ? row["AllowDBNull"] : null;
				c["nullabile"] = n is bool ? (bool)n : true;
			}
			l.Add(c);
		}
		return l;
	}

	private static object IntDaSchema(DataRow row, string col)
	{
		if (!row.Table.Columns.Contains(col)) return null;
		object v = row[col];
		if (v == null || v is DBNull) return null;
		try { return Convert.ToInt32(v, Inv); } catch (Exception) { return null; }
	}

	private class ColDest
	{
		public string Nome;
		public string Tipo;
		public int MaxCaratteri;
		public int Precisione;
		public int Scala;
		public bool Nullabile;
		public bool Calcolata;
	}

	private static List<ColDest> ColonneDest(SqlConnection cn, SqlTransaction tx, string tabella)
	{
		List<ColDest> l = new List<ColDest>();
		using (SqlCommand cmd = new SqlCommand(
			"SELECT c.name, t.name, c.max_length, c.precision, c.scale, c.is_nullable, CAST(CASE WHEN c.is_computed = 1 OR c.is_identity = 1 THEN 1 ELSE 0 END AS bit) " +
			"FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id " +
			"WHERE c.object_id = OBJECT_ID(@t) ORDER BY c.column_id", cn, tx))
		{
			cmd.Parameters.Add("@t", SqlDbType.NVarChar, 300).Value = "dbo." + tabella;
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				while (r.Read())
				{
					ColDest c = new ColDest();
					c.Nome = r.GetString(0);
					c.Tipo = r.GetString(1).ToLowerInvariant();
					int len = r.GetInt16(2);
					c.MaxCaratteri = len < 0 ? -1 : (c.Tipo == "nvarchar" || c.Tipo == "nchar" ? len / 2 : len);
					c.Precisione = r.GetByte(3);
					c.Scala = r.GetByte(4);
					c.Nullabile = r.GetBoolean(5);
					c.Calcolata = r.GetBoolean(6);
					l.Add(c);
				}
			}
		}
		if (l.Count == 0) throw new UserException("Nel database di test manca la tabella dbo." + tabella + ": esegui SQL/DriveLine_01_database.sql in SSMS.");
		return l;
	}

	private static Type TipoNet(ColDest c)
	{
		switch (c.Tipo)
		{
			case "int": return typeof(int);
			case "bigint": return typeof(long);
			case "smallint": return typeof(short);
			case "tinyint": return typeof(byte);
			case "bit": return typeof(bool);
			case "decimal": case "numeric": case "money": case "smallmoney": return typeof(decimal);
			case "float": return typeof(double);
			case "real": return typeof(float);
			case "date": case "datetime": case "datetime2": case "smalldatetime": return typeof(DateTime);
			case "time": return typeof(TimeSpan);
			case "varbinary": case "binary": return typeof(byte[]);
			default: return typeof(string);
		}
	}

	private static Dictionary<string, object> Scrivi(string tabella, string[] nomi, List<object[]> righe, string origine)
	{
		using (SqlConnection cn = ApriConfig(TestConnection))
		{
			List<ColDest> dest = ColonneDest(cn, null, tabella);
			List<ColDest> scrivibili = new List<ColDest>();
			foreach (ColDest c in dest) if (!c.Calcolata) scrivibili.Add(c);

			int[] mappa = new int[scrivibili.Count];
			for (int j = 0; j < mappa.Length; j++) mappa[j] = -1;
			List<string> ignorate = new List<string>();
			for (int i = 0; i < nomi.Length; i++)
			{
				int j = scrivibili.FindIndex(delegate (ColDest c) { return string.Equals(c.Nome, nomi[i], StringComparison.OrdinalIgnoreCase); });
				bool tecnica = j >= 0 && (scrivibili[j].Nome == ColOrigine || scrivibili[j].Nome == ColCaricato);
				if (j < 0 || tecnica || mappa[j] >= 0) ignorate.Add(nomi[i]);
				else mappa[j] = i;
			}
			int jGan = scrivibili.FindIndex(delegate (ColDest c) { return c.Nome == "GAN"; });
			bool chiaveDaGan = false;
			List<string> mancanti = new List<string>();
			for (int j = 0; j < scrivibili.Count; j++)
			{
				string n = scrivibili[j].Nome;
				if (mappa[j] >= 0 || n == ColOrigine || n == ColCaricato) continue;
				if (n == "Chiave" && jGan >= 0 && mappa[jGan] >= 0) { chiaveDaGan = true; continue; }
				mancanti.Add(n);
			}
			int abbinate = 0;
			foreach (int x in mappa) if (x >= 0) abbinate++;
			if (abbinate == 0)
				throw new UserException("Nessuna colonna della query ha il nome di una colonna di " + tabella + ": usa gli alias (AS ...) con i nomi della tabella.");

			DataTable dt = new DataTable(tabella);
			foreach (ColDest c in scrivibili) dt.Columns.Add(c.Nome, TipoNet(c));

			List<object> errori = new List<object>();
			int nErrori = 0;
			DateTime adesso = DateTime.Now;
			for (int k = 0; k < righe.Count; k++)
			{
				object[] src = righe[k];
				DataRow dr = dt.NewRow();
				for (int j = 0; j < scrivibili.Count; j++)
				{
					ColDest c = scrivibili[j];
					object v = DBNull.Value;
					if (c.Nome == ColOrigine) v = origine;
					else if (c.Nome == ColCaricato) v = adesso;
					else if (mappa[j] >= 0)
					{
						string err;
						v = Converti(src[mappa[j]], c, out err);
						if (err != null)
						{
							nErrori++;
							if (errori.Count < 25) errori.Add(ErroreValore(k + 1, c.Nome, src[mappa[j]], err));
							v = DBNull.Value;
						}
					}
					if (v is DBNull && !c.Nullabile && !(c.Nome == "Chiave" && chiaveDaGan))
					{
						nErrori++;
						if (errori.Count < 25) errori.Add(ErroreValore(k + 1, c.Nome, null, "vuoto, ma la colonna non accetta valori vuoti"));
					}
					dr[j] = v;
				}
				if (chiaveDaGan)
				{
					int jChiave = dt.Columns.IndexOf("Chiave");
					dr[jChiave] = ValAccess(dr[jGan] as string);
				}
				dt.Rows.Add(dr);
			}

			Dictionary<string, object> d = new Dictionary<string, object>();
			d["tabella"] = tabella;
			d["colonneIgnorate"] = ignorate;
			d["colonneMancanti"] = mancanti;
			if (nErrori > 0)
			{
				d["salvato"] = false;
				d["message"] = nErrori + (nErrori == 1 ? " valore non entra" : " valori non entrano") + " nelle colonne di " + tabella + ": non ho scritto nulla.";
				d["errori"] = errori;
				d["nErrori"] = nErrori;
				return d;
			}

			int primaErano;
			using (SqlTransaction tx = cn.BeginTransaction())
			{
				using (SqlCommand cmd = new SqlCommand("DELETE FROM dbo.[" + tabella + "]", cn, tx))
				{
					cmd.CommandTimeout = 600;
					primaErano = cmd.ExecuteNonQuery();
				}
				using (SqlBulkCopy bc = new SqlBulkCopy(cn, SqlBulkCopyOptions.CheckConstraints, tx))
				{
					bc.DestinationTableName = "dbo.[" + tabella + "]";
					bc.BatchSize = 5000;
					bc.BulkCopyTimeout = 600;
					foreach (DataColumn col in dt.Columns) bc.ColumnMappings.Add(col.ColumnName, col.ColumnName);
					bc.WriteToServer(dt);
				}
				tx.Commit();
			}
			d["salvato"] = true;
			d["righe"] = dt.Rows.Count;
			d["cancellatePrima"] = primaErano;
			return d;
		}
	}

	private static Dictionary<string, object> ErroreValore(int riga, string colonna, object valore, string motivo)
	{
		Dictionary<string, object> e = new Dictionary<string, object>();
		e["riga"] = riga;
		e["colonna"] = colonna;
		e["valore"] = valore == null || valore is DBNull ? null : Testo(valore);
		e["motivo"] = motivo;
		return e;
	}

	private static long ValAccess(string s)
	{
		if (s == null) return 0;
		string t = s.Replace(" ", "");
		Match m = Regex.Match(t, @"^[+-]?\d+");
		long v;
		if (m.Success && long.TryParse(m.Value, NumberStyles.AllowLeadingSign, Inv, out v)) return v;
		return 0;
	}

	private static object Converti(object v, ColDest c, out string err)
	{
		err = null;
		if (v == null || v is DBNull) return DBNull.Value;
		switch (c.Tipo)
		{
			case "nvarchar": case "varchar": case "nchar": case "char": case "ntext": case "text":
				{
					string t = Testo(v).TrimEnd();
					if (c.MaxCaratteri > 0 && t.Length > c.MaxCaratteri)
					{
						err = "testo di " + t.Length + " caratteri, la colonna ne tiene " + c.MaxCaratteri;
						return DBNull.Value;
					}
					return t;
				}
			case "int": case "bigint": case "smallint": case "tinyint":
				{
					decimal n; bool vuoto;
					if (!Numero(v, out n, out vuoto)) { err = "non è un numero"; return DBNull.Value; }
					if (vuoto) return DBNull.Value;
					if (n != decimal.Truncate(n)) { err = "ha dei decimali, la colonna è intera"; return DBNull.Value; }
					try
					{
						if (c.Tipo == "int") return decimal.ToInt32(n);
						if (c.Tipo == "bigint") return decimal.ToInt64(n);
						if (c.Tipo == "smallint") return decimal.ToInt16(n);
						return decimal.ToByte(n);
					}
					catch (OverflowException) { err = "numero troppo grande per una colonna " + c.Tipo; return DBNull.Value; }
				}
			case "decimal": case "numeric": case "money": case "smallmoney":
				{
					decimal n; bool vuoto;
					if (!Numero(v, out n, out vuoto)) { err = "non è un numero"; return DBNull.Value; }
					if (vuoto) return DBNull.Value;
					n = Math.Round(n, c.Scala, MidpointRounding.AwayFromZero);
					int cifre = c.Precisione - c.Scala;
					decimal limite = 1;
					for (int i = 0; i < cifre && i < 28; i++) limite *= 10;
					if (!c.Tipo.EndsWith("money") && cifre < 28 && Math.Abs(n) >= limite) { err = "numero troppo grande per decimal(" + c.Precisione + "," + c.Scala + ")"; return DBNull.Value; }
					return n;
				}
			case "float": case "real":
				{
					if (v is double || v is float)
					{
						double x = Convert.ToDouble(v, Inv);
						if (c.Tipo == "real") return (float)x;
						return x;
					}
					decimal n; bool vuoto;
					if (!Numero(v, out n, out vuoto)) { err = "non è un numero"; return DBNull.Value; }
					if (vuoto) return DBNull.Value;
					if (c.Tipo == "real") return (float)n;
					return (double)n;
				}
			case "bit":
				{
					if (v is bool) return v;
					string t = Testo(v).Trim().ToUpperInvariant();
					if (t.Length == 0) return DBNull.Value;
					if (t == "1" || t == "S" || t == "SI" || t == "SÌ" || t == "Y" || t == "YES" || t == "TRUE" || t == "VERO" || t == "X" || t == "-1") return true;
					if (t == "0" || t == "N" || t == "NO" || t == "FALSE" || t == "FALSO") return false;
					err = "non è un sì/no";
					return DBNull.Value;
				}
			case "date": case "datetime": case "datetime2": case "smalldatetime":
				{
					DateTime d; bool vuoto;
					if (!Data(v, out d, out vuoto)) { err = "non è una data riconoscibile"; return DBNull.Value; }
					if (vuoto) return DBNull.Value;
					if (c.Tipo == "datetime" && d.Year < 1753) { err = "data prima del 1753, non entra in datetime"; return DBNull.Value; }
					if (c.Tipo == "smalldatetime" && (d.Year < 1900 || d.Year > 2078)) { err = "data fuori dal campo di smalldatetime"; return DBNull.Value; }
					return c.Tipo == "date" ? d.Date : d;
				}
			case "time":
				{
					if (v is TimeSpan) return v;
					if (v is DateTime) return ((DateTime)v).TimeOfDay;
					string t = Testo(v).Trim();
					if (t.Length == 0) return DBNull.Value;
					DateTime d;
					if (DateTime.TryParseExact(t, new string[] { "HHmm", "HHmmss", "HH:mm", "HH:mm:ss", "HH.mm", "HH.mm.ss" }, Inv, DateTimeStyles.None, out d)) return d.TimeOfDay;
					err = "non è un orario";
					return DBNull.Value;
				}
			default:
				return v;
		}
	}

	private static bool Numero(object v, out decimal n, out bool vuoto)
	{
		n = 0;
		vuoto = false;
		if (v is bool) { n = (bool)v ? 1 : 0; return true; }
		if (v is byte || v is sbyte || v is short || v is ushort || v is int || v is uint || v is long || v is ulong || v is decimal || v is float || v is double)
		{
			try { n = Convert.ToDecimal(v, Inv); return true; }
			catch (OverflowException) { return false; }
		}
		string t = Testo(v).Trim();
		if (t.Length == 0) { vuoto = true; return true; }
		if (decimal.TryParse(t, NumberStyles.Float, Inv, out n)) return true;
		return decimal.TryParse(t, NumberStyles.Float | NumberStyles.AllowThousands, CultureInfo.GetCultureInfo("it-IT"), out n);
	}

	private static readonly string[] FormatiData = {
		"yyyy-MM-dd", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-ddTHH:mm:ss", "yyyy-MM-dd HH:mm:ss.fff", "yyyy-MM-dd HH:mm:ss.FFFFFFF",
		"yyyy-MM-dd-HH.mm.ss.ffffff", "yyyyMMdd", "yyyyMMddHHmmss", "yyMMdd",
		"dd/MM/yyyy", "dd/MM/yyyy HH:mm:ss", "dd/MM/yyyy HH:mm", "d/M/yyyy", "d/M/yyyy H:mm:ss", "dd.MM.yyyy", "dd-MM-yyyy"
	};

	private static bool Data(object v, out DateTime d, out bool vuoto)
	{
		d = DateTime.MinValue;
		vuoto = false;
		if (v is DateTime) { d = (DateTime)v; return true; }
		if (v is DateTimeOffset) { d = ((DateTimeOffset)v).DateTime; return true; }
		string t;
		if (v is int || v is long || v is decimal || v is double || v is short)
		{
			decimal n = Convert.ToDecimal(v, Inv);
			if (n != decimal.Truncate(n)) return false;
			t = n.ToString("0", Inv);
		}
		else t = Testo(v).Trim();
		if (t.Length == 0 || Regex.IsMatch(t, @"^0+$")) { vuoto = true; return true; }
		return DateTime.TryParseExact(t, FormatiData, Inv, DateTimeStyles.None, out d);
	}

	private static readonly string ColonneAccoda =
		"CDA, LINEA, GAN, DISEGNO, CDA_U, COC_CLIENTE, DPA_MOBILE, DPI_MOBILE, DPI_TIRO, DATA_IMPOST, DATA_ASSEGNAZIONE, STATO, SOT_STATO, " +
		"TIPO_ORDINE, NUMERO_ORDINE, LINEA_ORDINE, ANNULL_FLG, DP_SPED, DATA_SPED, DATA_EFFETT_DISLIN, LAST_UPDATE_DATE, DATA_EFFETT_DELIB, DATA_RILASCIO_LEV3";

	private static Dictionary<string, object> Locale(Dictionary<string, object> body, Utente u)
	{
		string passo = Str(body, "passo");
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		using (SqlConnection cn = ApriConfig(TestConnection))
		{
			if (passo == "0015")
			{
				int antSped = Conta(cn, null, "SELECT COUNT(*) FROM dbo.GAN_DRIVELINE_Ant_Sped");
				if (antSped == 0) throw new UserException("GAN_DRIVELINE_Ant_Sped è vuota: esegui prima la 0010 con «Esegui e salva».");
				int gia = Conta(cn, null, "SELECT COUNT(*) FROM dbo.GAN_DRIVELINE_1 WHERE Origine = '0015'");
				if (gia > 0)
					throw new UserException("Le righe di Ant_Sped sono già accodate (" + gia + " righe con origine 0015). Per rifare il giro: rilancia la 0005 con «Esegui e salva» (svuota e ricarica GAN_DRIVELINE_1), poi la 0015.");
				int n;
				using (SqlTransaction tx = cn.BeginTransaction())
				{
					using (SqlCommand cmd = new SqlCommand(
						"INSERT INTO dbo.GAN_DRIVELINE_1 (" + ColonneAccoda + ", Origine, CaricatoIl) " +
						"SELECT " + ColonneAccoda + ", '0015', SYSDATETIME() FROM dbo.GAN_DRIVELINE_Ant_Sped", cn, tx))
					{
						cmd.CommandTimeout = 600;
						n = cmd.ExecuteNonQuery();
					}
					tx.Commit();
				}
				int tot = Conta(cn, null, "SELECT COUNT(*) FROM dbo.GAN_DRIVELINE_1");
				d["testo"] = "Accodate " + n + " righe di GAN_DRIVELINE_Ant_Sped in GAN_DRIVELINE_1, che ora ne ha " + tot + ".";
				d["numeri"] = Coppie("Righe accodate", n, "Totale GAN_DRIVELINE_1", tot);
			}
			else if (passo == "0020")
			{
				int s35 = Conta(cn, null, "SELECT COUNT(*) FROM dbo.Stato35");
				if (s35 == 0) throw new UserException("Stato35 è vuota: carica prima N09J0121_DLT (query «Stato35» con «Esegui e salva», oppure il file DLT.TXT nella sezione 4).");
				int gan = Conta(cn, null, "SELECT COUNT(*) FROM dbo.GAN_DRIVELINE_1");
				if (gan == 0) throw new UserException("GAN_DRIVELINE_1 è vuota: esegui prima la 0005 con «Esegui e salva».");
				int comuni = Conta(cn, null, "SELECT COUNT(DISTINCT g.GAN) FROM dbo.GAN_DRIVELINE_1 g JOIN dbo.Stato35 s ON g.GAN = s.Gan");
				int doppi = Conta(cn, null, "SELECT COUNT(*) FROM (SELECT Gan FROM dbo.Stato35 GROUP BY Gan HAVING COUNT(*) > 1) x");
				int n;
				using (SqlTransaction tx = cn.BeginTransaction())
				{
					using (SqlCommand cmd = new SqlCommand(
						"UPDATE g SET g.DATA_IMPOST = s.Data_Imp, g.STATO = s.Stato " +
						"FROM dbo.GAN_DRIVELINE_1 g INNER JOIN dbo.Stato35 s ON g.GAN = s.Gan " +
						"WHERE g.STATO < s.Stato", cn, tx))
					{
						cmd.CommandTimeout = 600;
						n = cmd.ExecuteNonQuery();
					}
					tx.Commit();
				}
				d["numeri"] = Coppie("Righe in Stato35", s35, "Righe in GAN_DRIVELINE_1", gan, "GAN in comune", comuni, "GAN ripetuti in Stato35", doppi, "Righe aggiornate", n);
				string testo = "Aggiornate " + n + " righe di GAN_DRIVELINE_1 (DATA_IMPOST e STATO presi da Stato35 dove lo stato era più indietro).";
				if (comuni == 0)
				{
					testo = "Nessun GAN in comune fra GAN_DRIVELINE_1 e Stato35: quasi certamente il GAN è scritto in modo diverso nelle due tabelle (lettera iniziale, zeri davanti, spazi). Confronta gli esempi qui sotto.";
					d["avviso"] = true;
					d["esempi"] = Esempi(cn);
				}
				else if (doppi > 0) testo += " Attenzione: " + doppi + " GAN compaiono più volte in Stato35; come in Access, per quelli vince una riga qualsiasi.";
				d["testo"] = testo;
			}
			else throw new UserException("Passo non valido.");
		}
		Log(u, "locale", passo);
		return d;
	}

	private static Dictionary<string, object> Esempi(SqlConnection cn)
	{
		Dictionary<string, object> e = new Dictionary<string, object>();
		e["GAN_DRIVELINE_1"] = Primi(cn, "SELECT TOP 5 GAN FROM dbo.GAN_DRIVELINE_1 WHERE GAN IS NOT NULL ORDER BY GAN");
		e["Stato35"] = Primi(cn, "SELECT TOP 5 Gan FROM dbo.Stato35 WHERE Gan IS NOT NULL ORDER BY Gan");
		return e;
	}

	private static List<string> Primi(SqlConnection cn, string sql)
	{
		List<string> l = new List<string>();
		using (SqlCommand cmd = new SqlCommand(sql, cn))
		using (SqlDataReader r = cmd.ExecuteReader())
			while (r.Read()) l.Add("«" + Testo(r.GetValue(0)) + "»");
		return l;
	}

	private static List<object> Coppie(params object[] v)
	{
		List<object> l = new List<object>();
		for (int i = 0; i + 1 < v.Length; i += 2)
		{
			Dictionary<string, object> x = new Dictionary<string, object>();
			x["etichetta"] = v[i];
			x["valore"] = v[i + 1];
			l.Add(x);
		}
		return l;
	}

	private static int Conta(SqlConnection cn, SqlTransaction tx, string sql)
	{
		using (SqlCommand cmd = new SqlCommand(sql, cn, tx))
		{
			cmd.CommandTimeout = 300;
			return Convert.ToInt32(cmd.ExecuteScalar(), Inv);
		}
	}

	private static Dictionary<string, object> Vedi(string tabella, int max)
	{
		string t = TrovaNome(tabella, TabelleVisibili);
		if (t == null) throw new UserException("Tabella non valida.");
		max = Limita(max, 1, 2000);
		Dictionary<string, object> d = new Dictionary<string, object>();
		using (SqlConnection cn = ApriConfig(TestConnection))
		{
			d["totale"] = Conta(cn, null, "SELECT COUNT(*) FROM dbo.[" + t + "]");
			using (SqlCommand cmd = new SqlCommand("SELECT TOP (" + max + ") * FROM dbo.[" + t + "]", cn))
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				d["colonne"] = DescriviColonne(r);
				List<object[]> righe = new List<object[]>();
				while (r.Read()) righe.Add(LeggiRiga(r));
				d["righe"] = RighePerJson(righe);
			}
		}
		d["ok"] = true;
		d["tabella"] = t;
		return d;
	}

	private static Dictionary<string, object> CdaElenco()
	{
		List<object> l = new List<object>();
		using (SqlConnection cn = ApriConfig(TestConnection))
		using (SqlCommand cmd = new SqlCommand("SELECT CDA, Descrizione FROM dbo.CDA_COSTRUTTORI ORDER BY CDA", cn))
		using (SqlDataReader r = cmd.ExecuteReader())
		{
			while (r.Read())
			{
				Dictionary<string, object> x = new Dictionary<string, object>();
				x["cda"] = r.GetString(0);
				x["descrizione"] = r.IsDBNull(1) ? "" : r.GetString(1);
				l.Add(x);
			}
		}
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["elenco"] = l;
		return d;
	}

	private static Dictionary<string, object> CdaSalva(Dictionary<string, object> body, Utente u)
	{
		object v;
		object[] arr = body.TryGetValue("righe", out v) ? v as object[] : null;
		if (arr == null || arr.Length > 5000) throw new UserException("Richiesta non valida.");
		List<string[]> righe = new List<string[]>();
		HashSet<string> visti = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
		foreach (object o in arr)
		{
			string riga = (o as string ?? "").Trim();
			if (riga.Length == 0) continue;
			string[] p = riga.Split(new char[] { '\t', ';' }, 2);
			string cda = p[0].Trim();
			string desc = p.Length > 1 ? p[1].Trim() : "";
			if (cda.Length == 0) continue;
			if (cda.Length > 20) throw new UserException("Il CDA «" + cda + "» è più lungo di 20 caratteri.");
			if (desc.Length > 100) desc = desc.Substring(0, 100);
			if (visti.Add(cda)) righe.Add(new string[] { cda, desc });
		}
		using (SqlConnection cn = ApriConfig(TestConnection))
		using (SqlTransaction tx = cn.BeginTransaction())
		{
			using (SqlCommand cmd = new SqlCommand("DELETE FROM dbo.CDA_COSTRUTTORI", cn, tx)) cmd.ExecuteNonQuery();
			foreach (string[] r in righe)
			{
				using (SqlCommand cmd = new SqlCommand("INSERT INTO dbo.CDA_COSTRUTTORI (CDA, Descrizione) VALUES (@c, @d)", cn, tx))
				{
					cmd.Parameters.Add("@c", SqlDbType.NVarChar, 20).Value = r[0];
					cmd.Parameters.Add("@d", SqlDbType.NVarChar, 100).Value = r[1].Length > 0 ? (object)r[1] : DBNull.Value;
					cmd.ExecuteNonQuery();
				}
			}
			tx.Commit();
		}
		Log(u, "cda_salva", righe.Count + " CDA");
		Dictionary<string, object> d = CdaElenco();
		d["salvati"] = righe.Count;
		return d;
	}

	private static Dictionary<string, object> Dlt(Dictionary<string, object> body, Utente u, bool carica)
	{
		object v;
		object[] arr = body.TryGetValue("righe", out v) ? v as object[] : null;
		if (arr == null) throw new UserException("Richiesta non valida.");
		string[] nomi = new string[TracciatoDlt.Length];
		for (int i = 0; i < nomi.Length; i++) nomi[i] = TracciatoDlt[i].Nome;

		List<object[]> righe = new List<object[]>();
		List<object> errori = new List<object>();
		int nErrori = 0, vuote = 0;
		Dictionary<string, int> testate = new Dictionary<string, int>();
		SortedDictionary<int, int> stati = new SortedDictionary<int, int>();
		Dictionary<string, int> gan = new Dictionary<string, int>();
		int iStato = Array.FindIndex(TracciatoDlt, delegate (CampoTxt c) { return c.Nome == "Stato"; });
		int iGan = Array.FindIndex(TracciatoDlt, delegate (CampoTxt c) { return c.Nome == "Gan"; });

		for (int n = 0; n < arr.Length; n++)
		{
			string l = (arr[n] as string ?? "").TrimEnd('\r', '\n', ' ', '\t');
			if (l.Length == 0) { vuote++; continue; }
			if (l.Length < LunghezzaRigaDlt)
			{
				nErrori++;
				if (errori.Count < 30) errori.Add(ErroreValore(n + 1, "(riga)", l, "lunga " + l.Length + " caratteri, ne servono " + LunghezzaRigaDlt));
				continue;
			}
			string testa = l.Substring(0, 10);
			int c0;
			testate[testa] = testate.TryGetValue(testa, out c0) ? c0 + 1 : 1;

			object[] valori = new object[TracciatoDlt.Length];
			bool rigaOk = true;
			for (int i = 0; i < TracciatoDlt.Length; i++)
			{
				CampoTxt c = TracciatoDlt[i];
				string pezzo = l.Substring(c.Da - 1, c.Lung);
				string t = pezzo.Trim();
				if (c.Tipo == "testo") valori[i] = t.Length == 0 ? (object)DBNull.Value : t;
				else if (c.Tipo == "intero")
				{
					int x;
					if (t.Length == 0) valori[i] = DBNull.Value;
					else if (int.TryParse(t, NumberStyles.AllowLeadingSign, Inv, out x)) valori[i] = x;
					else { rigaOk = false; nErrori++; if (errori.Count < 30) errori.Add(ErroreValore(n + 1, c.Nome, pezzo, "non è un numero (posizioni " + c.Da + "-" + (c.Da + c.Lung - 1) + ")")); }
				}
				else
				{
					DateTime dt;
					if (t.Length == 0 || t == "000000") valori[i] = DBNull.Value;
					else if (DateTime.TryParseExact(t, "yyMMdd", Inv, DateTimeStyles.None, out dt)) valori[i] = dt;
					else { rigaOk = false; nErrori++; if (errori.Count < 30) errori.Add(ErroreValore(n + 1, c.Nome, pezzo, "non è una data aammgg (posizioni " + c.Da + "-" + (c.Da + c.Lung - 1) + ")")); }
				}
			}
			if (!rigaOk) continue;
			righe.Add(valori);
			if (valori[iStato] is int) { int s0; int st = (int)valori[iStato]; stati[st] = stati.TryGetValue(st, out s0) ? s0 + 1 : 1; }
			string g = valori[iGan] as string;
			if (g != null) { int g0; gan[g] = gan.TryGetValue(g, out g0) ? g0 + 1 : 1; }
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["righeFile"] = arr.Length - vuote;
		d["righeLette"] = righe.Count;
		d["nErrori"] = nErrori;
		d["errori"] = errori;

		int sotto95 = 0;
		List<object> elencoStati = new List<object>();
		foreach (KeyValuePair<int, int> kv in stati)
		{
			if (kv.Key < 95) sotto95 += kv.Value;
			Dictionary<string, object> x = new Dictionary<string, object>();
			x["stato"] = kv.Key;
			x["righe"] = kv.Value;
			elencoStati.Add(x);
		}
		int ganDoppi = 0;
		foreach (int x in gan.Values) if (x > 1) ganDoppi++;
		d["stati"] = elencoStati;
		d["righeStato35"] = sotto95;
		d["ganDistinti"] = gan.Count;
		d["ganRipetuti"] = ganDoppi;
		List<object> elencoTestate = new List<object>();
		foreach (KeyValuePair<string, int> kv in testate)
		{
			if (elencoTestate.Count >= 5) break;
			Dictionary<string, object> x = new Dictionary<string, object>();
			x["testata"] = kv.Key;
			x["righe"] = kv.Value;
			elencoTestate.Add(x);
		}
		d["testate"] = elencoTestate;

		List<object> tracciato = new List<object>();
		foreach (CampoTxt c in TracciatoDlt)
		{
			Dictionary<string, object> x = new Dictionary<string, object>();
			x["nome"] = c.Nome; x["da"] = c.Da; x["a"] = c.Da + c.Lung - 1; x["tipo"] = c.Tipo;
			tracciato.Add(x);
		}
		d["tracciato"] = tracciato;

		List<object> colonne = new List<object>();
		foreach (string n in nomi) { Dictionary<string, object> x = new Dictionary<string, object>(); x["nome"] = n; colonne.Add(x); }
		d["colonne"] = colonne;
		d["righe"] = RighePerJson(righe.GetRange(0, Math.Min(25, righe.Count)));

		if (carica)
		{
			if (nErrori > 0) throw new UserException(nErrori + " valori del file non si leggono: correggi il file (o il tracciato) prima di caricarlo. Gli errori sono nell'anteprima.");
			if (righe.Count == 0) throw new UserException("Il file non ha righe.");
			Dictionary<string, object> s = Scrivi("N09J0121_DLT", nomi, righe, "TXT");
			d["salvataggio"] = s;
			Log(u, "dlt_carica", righe.Count + " righe");
		}
		return d;
	}

	private static Dictionary<string, object> InfoServer()
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["computer"] = Environment.MachineName;
		d["ip"] = IpServer();
		string utentePool = "";
		try { utentePool = System.Security.Principal.WindowsIdentity.GetCurrent().Name; } catch (Exception) { }
		d["utentePool"] = utentePool;
		d["bit"] = Environment.Is64BitProcess ? 64 : 32;
		d["dotnet"] = Environment.Version.ToString();

		List<object> provider = new List<object>();
		try
		{
			DataTable t = DbProviderFactories.GetFactoryClasses();
			foreach (DataRow r in t.Rows) provider.Add(Convert.ToString(r["Name"], Inv) + " (" + Convert.ToString(r["InvariantName"], Inv) + ")");
		}
		catch (Exception ex) { provider.Add("non leggibili: " + ex.Message); }
		d["providerNet"] = provider;

		bool a64 = Environment.Is64BitProcess;
		d["driverOdbc"] = ChiaviRegistro(@"SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers", a64 ? RegistryView.Registry64 : RegistryView.Registry32);
		d["driverOdbcAltri"] = ChiaviRegistro(@"SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers", a64 ? RegistryView.Registry32 : RegistryView.Registry64);
		d["dsnSistema"] = ChiaviRegistro(@"SOFTWARE\ODBC\ODBC.INI\ODBC Data Sources", a64 ? RegistryView.Registry64 : RegistryView.Registry32);

		List<object> oledb = new List<object>();
		try
		{
			DataTable t = new OleDbEnumerator().GetElements();
			foreach (DataRow r in t.Rows)
			{
				string tipo = Convert.ToString(r["SOURCES_TYPE"], Inv);
				if (tipo == "1") oledb.Add(Convert.ToString(r["SOURCES_NAME"], Inv) + " – " + Convert.ToString(r["SOURCES_DESCRIPTION"], Inv));
			}
		}
		catch (Exception ex) { oledb.Add("non leggibili: " + ex.Message); }
		d["providerOledb"] = oledb;

		ConnectionStringSettings cs = ConfigurationManager.ConnectionStrings[SorgenteWebConfig];
		d["sorgenteWebConfig"] = cs != null && !string.IsNullOrEmpty(cs.ConnectionString);
		return d;
	}

	private static string IpServer()
	{
		List<string> l = new List<string>();
		try
		{
			foreach (IPAddress a in Dns.GetHostAddresses(Dns.GetHostName()))
				if (a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a)) l.Add(a.ToString());
		}
		catch (Exception) { }
		return l.Count == 0 ? "sconosciuto" : string.Join(", ", l.ToArray());
	}

	private static Dictionary<string, object> Health()
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["status"] = "ok";
		try
		{
			using (SqlConnection cn = ApriConfig(TestConnection))
			{
				d["database"] = cn.Database;
				Dictionary<string, object> righe = new Dictionary<string, object>();
				foreach (string t in TabelleVisibili)
				{
					using (SqlCommand cmd = new SqlCommand("SELECT COUNT(*) FROM sys.objects WHERE object_id = OBJECT_ID(@t)", cn))
					{
						cmd.Parameters.Add("@t", SqlDbType.NVarChar, 300).Value = "dbo." + t;
						if ((int)cmd.ExecuteScalar() == 0)
						{
							d["status"] = "da preparare";
							d["message"] = "Manca dbo." + t + ": eseguire SQL/DriveLine_01_database.sql in SSMS.";
							continue;
						}
					}
					righe[t] = Conta(cn, null, "SELECT COUNT(*) FROM dbo.[" + t + "]");
				}
				d["righe"] = righe;
			}
		}
		catch (Exception ex)
		{
			d["status"] = "errore";
			d["message"] = "Database di test (" + TestConnection + "): " + ex.Message;
		}
		ConnectionStringSettings cs = ConfigurationManager.ConnectionStrings[SorgenteWebConfig];
		d["sorgenteWebConfig"] = cs != null && !string.IsNullOrEmpty(cs.ConnectionString);
		return d;
	}

	private class Regola
	{
		public Regex Re;
		public string Titolo;
		public string Cosa;
		public string[] Fare;
	}

	private static Regola R(string re, string titolo, string cosa, params string[] fare)
	{
		Regola r = new Regola();
		r.Re = new Regex(re, RegexOptions.IgnoreCase | RegexOptions.Compiled);
		r.Titolo = titolo; r.Cosa = cosa; r.Fare = fare;
		return r;
	}

	// Vince la prima che corrisponde: le più specifiche prima
	private static readonly Regola[] Regole = {
		R(@"Unable to find the requested \.Net Framework Data Provider|Impossibile trovare il provider di dati|Failed to find or load the registered \.Net Framework Data Provider",
			"Il driver non è installato sul server del Portale",
			"Il server IIS non ha il componente .NET per questo tipo di database (per Oracle serve ODP.NET, «Oracle.ManagedDataAccess»).",
			"Premi «Info server Portale» per vedere i driver installati.",
			"Se c'è un driver ODBC per quel database, scegli il tipo «ODBC» e usa quello.",
			"Altrimenti il driver va installato sul server del Portale."),
		R(@"is not registered on the local machine|non è registrato nel computer locale|non registrato",
			"Il provider OLE DB non è installato (o è solo a 32 bit)",
			"Il nome dopo Provider= non corrisponde a un provider installato con lo stesso numero di bit del Portale.",
			"Premi «Info server Portale»: c'è l'elenco dei provider OLE DB che il Portale vede.",
			"Se esiste anche un driver ODBC per quel database, di solito è più semplice usare ODBC."),
		R(@"STATE:IM014|architecture mismatch|mancata corrispondenza tra l'architettura",
			"Driver a 32 bit con il Portale a 64 bit (o viceversa)",
			"Il DSN o il driver esiste, ma con un numero di bit diverso da quello del Portale.",
			"Serve la versione del driver con gli stessi bit del Portale (vedi «Info server Portale»).",
			"In alternativa: pool IIS con «Abilita applicazioni a 32 bit» = True (vale per tutto il Portale)."),
		R(@"STATE:IM002|STATE:IM003|Data source name not found|Nome origine dati non trovato|Specified driver could not be loaded|Impossibile caricare il driver specificato",
			"Driver o DSN ODBC non trovato",
			"Il nome del driver (o del DSN) nella stringa non corrisponde a uno installato sul server del Portale.",
			"Premi «Info server Portale» e copia il nome esatto del driver.",
			"Un DSN creato sul PC di Access non esiste sul server: meglio la stringa con Driver=..."),
		R(@"Format of the initialization string|formato della stringa di inizializzazione|Keyword not supported|Parola chiave non supportata",
			"Stringa di connessione scritta male",
			"C'è una parola che il driver non conosce, oppure un ; o una virgoletta fuori posto.",
			"Riparti dal modello del menu e cambia solo i valori.",
			"Password con ; o = : scrivila nel campo Password, la pagina la racchiude da sola."),
		R(@"ORA-12154|ORA-12162|TNS:could not resolve|TNS: impossibile risolvere",
			"Oracle non riconosce il nome del servizio",
			"La stringa usa un nome «TNS» che il server del Portale non conosce (manca il tnsnames.ora), oppure il formato è sbagliato.",
			"Scrivi la forma completa: server:porta/NOME_SERVIZIO (es. Data Source=10.1.2.3:1521/DWHPRD).",
			"Chiedi a chi ti ha dato i parametri il «service name» (non il SID)."),
		R(@"SQL:11001\b|SOCK:11001\b|No such host is known|Host sconosciuto|Host non noto|ORA-12545|Name or service not known",
			"Il nome del server non viene trovato (DNS)",
			"Il server del Portale non riesce a trasformare il nome in un indirizzo IP.",
			"Controlla di averlo scritto giusto.",
			"Prova con l'indirizzo IP al posto del nome.",
			"Se dal tuo PC il nome funziona e dal server no, il server usa un DNS diverso: serve l'IP."),
		R(@"Execution Timeout Expired|Timeout esecuzione scaduto|ORA-01013|Query timeout expired|Timeout della query",
			"La query ci mette troppo",
			"Il collegamento funziona, ma la query non ha finito entro il «Timeout query».",
			"Alza «Timeout query» (in alto) e riprova.",
			"Per il test restringi il filtro (es. un solo CDA o un solo mese).",
			"Se servono comunque minuti, chiedi se sulla tabella ci sono indici sulle date usate nel filtro."),
		R(@"SQL:-1\b|SQL:26\b|Error Locating Server/Instance|individuazione del server/dell'istanza",
			"Istanza SQL Server non trovata",
			"Il server risponde, ma il nome dell'istanza è sbagliato, oppure SQL Browser (UDP 1434) è bloccato.",
			"Controlla il nome dell'istanza (la parte dopo la \\).",
			"Meglio ancora: chiedi la porta TCP dell'istanza e scrivila nel campo Porta."),
		R(@"SQL:10060\b|SOCK:10060\b|SQL:258\b|Connection Timeout Expired|Timeout di connessione|ORA-12170|ORA-12535|SQL30081N|Login timeout expired|STATE:HYT00|STATE:HYT01|timed out|timeout scaduto",
			"Nessuna risposta dal server (rete o firewall)",
			"La richiesta parte ma dall'altra parte non risponde nessuno: tipico di un firewall che blocca, o di un server non raggiungibile da questa rete.",
			"Chiedi di aprire il firewall dall'IP del server del Portale (vedi «Info server Portale») verso server e porta del database.",
			"Prova lo stesso collegamento da un PC della stessa rete del database: se lì va, il blocco è solo verso il server del Portale."),
		R(@"SQL:10061\b|SOCK:10061\b|actively refused|Rifiuto persistente|ORA-12541|no listener|nessun listener",
			"Il server risponde, ma su quella porta non c'è il database",
			"Il computer si raggiunge, ma la porta è chiusa o il servizio del database non è in ascolto lì.",
			"Controlla il numero di porta.",
			"SQL Server con istanza con nome: la porta non è 1433, chiedi quella giusta.",
			"Oracle: il «listener» di solito è sulla 1521."),
		R(@"SQL:53\b|SQL:2\b|SQL:40\b|network-related or instance-specific|errore di rete o specifico dell'istanza|could not open a connection|Network path was not found|Impossibile trovare il percorso di rete",
			"Il server SQL non è raggiungibile",
			"Il client non riesce ad aprire il collegamento: nome/IP, istanza o porta sbagliati, servizio fermo, o firewall.",
			"Guarda i passi «DNS» e «Porta TCP» qui sopra: dicono a che punto si ferma.",
			"Se manca la porta, scrivila: senza porta il test di rete viene saltato."),
		R(@"certificate|certificato|SSL Provider|TLS",
			"Problema di cifratura (certificato)",
			"Il server chiede (o rifiuta) un collegamento cifrato e il certificato non è accettato.",
			"Spunta «Fidati del certificato del server» e riprova.",
			"Se è già spuntata, prova a togliere «Cifra il collegamento»."),
		R(@"SQL:10054\b|SOCK:10054\b|forcibly closed|chiusa forzatamente|pre-login handshake|SQL:233\b|SQL:20\b",
			"Il collegamento è stato chiuso dall'altra parte",
			"La porta risponde, ma il dialogo si interrompe subito: protocollo o cifratura incompatibili, oppure un firewall che taglia le connessioni.",
			"Prova a cambiare «Cifra il collegamento» e «Fidati del certificato».",
			"Se il loro server è molto vecchio (SQL 2008 e prima) potrebbe servire TLS 1.0: va chiesto a chi gestisce il server."),
		R(@"SQL:18452\b|untrusted domain|dominio non (trusted|attendibile|considerato attendibile)",
			"Il server accetta solo utenti Windows di un dominio fidato",
			"Con «Autenticazione Windows» si presenta l'utente del pool IIS, che quel server non riconosce; oppure il server accetta solo utenti Windows.",
			"Usa utente e password SQL (togli «Autenticazione Windows»).",
			"Se il server accetta solo utenti Windows, va dato accesso all'utente del pool IIS (vedi «Info server Portale»)."),
		R(@"SQL:18486\b|SQL:18487\b|SQL:18488\b|SQL:18470\b|ORA-28000|ORA-28001|password has expired|password è scaduta|account is locked|account è bloccato|account is disabled|account è disabilitato",
			"Utente bloccato, disattivato o con password scaduta",
			"Utente e password sono riconosciuti, ma l'account non può entrare così com'è.",
			"Chiedi a chi gestisce il database di sbloccarlo o di rinnovare la password.",
			"Troppi tentativi sbagliati di fila possono bloccarlo: non riprovare a raffica."),
		R(@"SQL:4060\b|SQL:4064\b|Cannot open database|Impossibile aprire il database|ORA-12514|ORA-12505|ORA-12528|SQL1013N",
			"Database (o servizio) non trovato, o senza permesso",
			"Il server c'è e l'utente entra, ma il database indicato non esiste con quel nome oppure l'utente non ha accesso a quel database.",
			"Controlla il nome del database (Oracle: il service name).",
			"Prova a lasciarlo vuoto: si entra nel database predefinito dell'utente, e il passo «Chi sono» dice quale è."),
		R(@"SQL:18456\b|ORA-01017|ORA-01005|STATE:28000|SQL30082N|SQL1403N|Login failed|Accesso non riuscito|invalid username|nome utente/password non valid|Authorization failure|CWBSY000[1-9]",
			"Utente o password non accettati",
			"Il server si raggiunge ed è il database giusto, ma rifiuta l'accesso.",
			"Ricontrolla utente e password (maiuscole, spazi alla fine copiando).",
			"SQL Server: l'utente deve essere un «login SQL» e il server deve accettarli (autenticazione mista).",
			"Se avevi spuntato «Autenticazione Windows», si presenta l'utente del pool IIS e non il tuo."),
		R(@"SQL:229\b|SQL:230\b|SQL:262\b|SQL:300\b|ORA-01031|STATE:42501|SQL0551N|SQL0552N|permission was denied|autorizzazione .{0,40}negat|non dispone dell'autorizzazione|not authorized|insufficient privileges|privilegi insufficienti",
			"Collegamento riuscito, ma l'utente non può leggere questo dato",
			"Il database risponde, ma all'utente manca il permesso di SELECT su questa tabella (o vista).",
			"Chiedi a chi gestisce il database il permesso di lettura (SELECT) per questo utente sulla tabella.",
			"Il passo «Chi sono» dice con quale utente sei collegato: è quello da abilitare."),
		R(@"SQL:208\b|ORA-00942|ORA-04043|STATE:42S02|SQL0204N|STATE:42704|Invalid object name|Nome di oggetto .{0,5}non valido|table or view does not exist|tabella o vista inesistente",
			"Tabella non trovata",
			"Con questo utente la tabella non si vede: nome sbagliato, schema mancante, oppure (su Oracle) manca il permesso di leggerla.",
			"Controlla il nome; spesso serve lo schema davanti: SCHEMA.FI_GAN_L4 (nella sezione «Tabelle da controllare»).",
			"Su Oracle questo errore compare anche se la tabella c'è ma l'utente non ha il permesso: chiedi il SELECT."),
		R(@"SQL:207\b|ORA-00904|STATE:42S22|SQL0206N|STATE:42703|Invalid column name|Nome di colonna non valido|invalid identifier|identificativo non valido",
			"Una colonna della query non esiste",
			"La query usa un nome di colonna che in questa tabella non c'è (o ha un altro nome).",
			"Premi «Prova collegamento»: nel passo della tabella c'è l'elenco delle colonne vere.",
			"Correggi il nome nella query; se serve tieni il nome di Access come alias: NOME_VERO AS NOME_ACCESS."),
		R(@"SQL:241\b|SQL:242\b|SQL:245\b|SQL:8114\b|SQL:8115\b|ORA-01861|ORA-01843|ORA-01840|ORA-01722|ORA-00932|STATE:22007|STATE:22018|STATE:22008|SQL0420N|SQL0180N|SQL0401N|conversion failed|conversione non riuscita|Operand type clash|Conflitto del tipo",
			"Tipo di dato diverso da quello atteso",
			"La query confronta o converte una colonna come data/numero, ma nel database è di un altro tipo (es. date salvate come testo o come numero 20261112).",
			"Esegui la query senza filtro sulle date (togli il WHERE) e guarda i tipi delle colonne nel risultato.",
			"Se le date sono numeri o testo, il filtro va scritto con quel formato: dimmelo e adattiamo la query."),
		R(@"SQL:102\b|SQL:156\b|SQL:195\b|SQL:4145\b|ORA-00933|ORA-00936|ORA-00907|ORA-00923|ORA-00911|ORA-00905|STATE:42000|STATE:37000|SQL0104N|Incorrect syntax|Sintassi non corretta|syntax error|errore di sintassi|not a recognized built-in function|non è un nome di funzione predefinita",
			"Il database non capisce la query (sintassi)",
			"La query è scritta in un SQL diverso da quello di questo database.",
			"Controlla il «Dialetto SQL» in alto: cambia il modo in cui si scrivono le date.",
			"Funzioni di Access come Year(Date()), CVDate, Val, Nz, IIf e le [parentesi quadre] non vanno su Oracle/DB2: nelle query della pagina sono già tolte.",
			"Oracle: niente «AS» dopo il nome di una tabella e niente punto e virgola finale."),
	};

	private static Dictionary<string, object> Spiega(Exception ex)
	{
		StringBuilder firma = new StringBuilder(" ");
		StringBuilder tecnico = new StringBuilder();
		for (Exception e = ex; e != null; e = e.InnerException)
		{
			tecnico.Append(e.GetType().FullName).Append(": ").Append(e.Message).Append("\n");
			SqlException se = e as SqlException;
			if (se != null)
				foreach (SqlError er in se.Errors)
				{
					firma.Append(" SQL:").Append(er.Number.ToString(Inv)).Append(" ");
					tecnico.Append("  SQL Server: errore ").Append(er.Number).Append(", stato ").Append(er.State).Append(", livello ").Append(er.Class).Append("\n");
				}
			OdbcException oe = e as OdbcException;
			if (oe != null)
				foreach (OdbcError er in oe.Errors)
				{
					firma.Append(" STATE:").Append(er.SQLState).Append(" NATIVE:").Append(er.NativeError.ToString(Inv)).Append(" ");
					tecnico.Append("  ODBC: SQLSTATE ").Append(er.SQLState).Append(", errore nativo ").Append(er.NativeError).Append(", ").Append(er.Message).Append("\n");
				}
			OleDbException le = e as OleDbException;
			if (le != null)
				foreach (OleDbError er in le.Errors)
				{
					firma.Append(" STATE:").Append(er.SQLState).Append(" NATIVE:").Append(er.NativeError.ToString(Inv)).Append(" ");
					tecnico.Append("  OLE DB: SQLSTATE ").Append(er.SQLState).Append(", errore nativo ").Append(er.NativeError).Append(", ").Append(er.Message).Append("\n");
				}
			SocketException so = e as SocketException;
			if (so != null) firma.Append(" SOCK:").Append(so.ErrorCode.ToString(Inv)).Append(" ");
			if (e.GetType().FullName.StartsWith("Oracle.", StringComparison.Ordinal))
			{
				try
				{
					object num = e.GetType().GetProperty("Number").GetValue(e, null);
					firma.Append(" ORA-").Append(Convert.ToInt32(num, Inv).ToString("00000", Inv)).Append(" ");
				}
				catch (Exception) { }
			}
			firma.Append(" ").Append(e.Message).Append(" ");
		}
		string f = firma.ToString();
		foreach (Regola r in Regole)
			if (r.Re.IsMatch(f)) return Diag(r.Titolo, r.Cosa, r.Fare, tecnico.ToString().TrimEnd());
		return Diag("Errore non riconosciuto",
			"Non ho una spiegazione pronta per questo errore: il motivo esatto è nel messaggio tecnico qui sotto.",
			new string[] { "Copia il messaggio tecnico e mandalo a chi gestisce il database sorgente (o a me)." },
			tecnico.ToString().TrimEnd());
	}

	private static Dictionary<string, object> Diag(string titolo, string cosa, string[] fare, string tecnico)
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["titolo"] = titolo;
		d["cosa"] = cosa;
		List<string> l = new List<string>();
		foreach (string x in fare) if (!string.IsNullOrEmpty(x)) l.Add(x);
		d["fare"] = l;
		if (!string.IsNullOrEmpty(tecnico)) d["tecnico"] = tecnico;
		return d;
	}

	private static Dictionary<string, object> DiagDns(string host, Exception ex)
	{
		return Diag("Il nome «" + host + "» non viene trovato (DNS)",
			"Il server del Portale non riesce a trasformare il nome in un indirizzo IP.",
			new string[] { "Controlla di averlo scritto giusto (senza \\istanza e senza porta: quelle vanno nei loro campi).",
				"Prova con l'indirizzo IP al posto del nome.",
				"Se dal tuo PC il nome funziona e dal server del Portale no, il server usa un DNS diverso: serve l'IP o una voce DNS." },
			ex.GetType().Name + ": " + ex.Message);
	}

	private static Dictionary<string, object> DiagPorta(Sorgente s, string esito, Exception ex)
	{
		string tecnico = ex != null ? ex.GetType().Name + ": " + ex.Message : "Nessuna risposta in " + SecondiPorta + " secondi.";
		if (ex is SocketException && ((SocketException)ex).SocketErrorCode == SocketError.ConnectionRefused)
			return Diag("Il server risponde, ma la porta " + s.Porta + " è chiusa",
				"Il computer " + s.Host + " si raggiunge, ma su quella porta non c'è nessun servizio in ascolto (oppure il firewall rifiuta).",
				new string[] { "Controlla il numero di porta con chi ti ha dato i parametri.",
					s.Tipo == "sqlserver" ? "SQL Server con istanza con nome: la porta non è 1433. Lascia vuota la porta e scrivi l'istanza, oppure chiedi la porta giusta." : "",
					s.PortaPredefinita ? "Non avevi scritto la porta: ho provato quella standard (" + s.Porta + "). Scrivi quella vera." : "" },
				tecnico);
		return Diag("Nessuna risposta da " + s.Host + " sulla porta " + s.Porta,
			"Di solito è un firewall che scarta i pacchetti, oppure il server non è raggiungibile dalla rete del server del Portale.",
			new string[] { "Chiedi a rete/IT di aprire il firewall: da " + IpServer() + " (server del Portale) verso " + s.Host + " porta TCP " + s.Porta + ".",
				"Prova lo stesso indirizzo e porta da un PC della stessa rete del database: se lì va, il blocco è solo verso il server del Portale.",
				s.PortaPredefinita ? "Non avevi scritto la porta: ho provato quella standard (" + s.Porta + ")." : "" },
			tecnico);
	}

	private static SqlConnection ApriConfig(string name)
	{
		ConnectionStringSettings cs = ConfigurationManager.ConnectionStrings[name];
		if (cs == null || string.IsNullOrEmpty(cs.ConnectionString))
			throw new UserException("Nel Web.config manca la stringa di connessione «" + name + "».");
		SqlConnection cn = new SqlConnection(cs.ConnectionString);
		try
		{
			cn.Open();
		}
		catch (Exception ex)
		{
			cn.Dispose();
			if (name == TestConnection)
				throw new UserException("Non riesco ad aprire il database di test (stringa «" + TestConnection + "» del Web.config).", Spiega(ex));
			throw;
		}
		return cn;
	}

	private static string TrovaNome(string nome, string[] ammessi)
	{
		if (nome == null) return null;
		foreach (string a in ammessi) if (string.Equals(a, nome.Trim(), StringComparison.OrdinalIgnoreCase)) return a;
		return null;
	}

	private static string Testo(object v)
	{
		if (v == null || v is DBNull) return "";
		string s = v as string;
		if (s != null) return s;
		if (v is DateTime)
		{
			DateTime d = (DateTime)v;
			return d.TimeOfDay == TimeSpan.Zero ? d.ToString("yyyy-MM-dd", Inv) : d.ToString("yyyy-MM-dd HH:mm:ss", Inv);
		}
		byte[] b = v as byte[];
		if (b != null) return "(binario, " + b.Length + " byte)";
		IFormattable f = v as IFormattable;
		if (f != null) return f.ToString(null, Inv);
		return v.ToString();
	}

	private static List<object> RighePerJson(List<object[]> righe)
	{
		List<object> l = new List<object>();
		foreach (object[] r in righe)
		{
			object[] o = new object[r.Length];
			for (int i = 0; i < r.Length; i++) o[i] = PerJson(r[i]);
			l.Add(o);
		}
		return l;
	}

	private static object PerJson(object v)
	{
		if (v == null || v is DBNull) return null;
		if (v is string || v is bool) return v;
		if (v is int || v is short || v is byte) return Convert.ToInt32(v, Inv);
		if (v is long || v is decimal)
		{
			decimal n = Convert.ToDecimal(v, Inv);
			if (Math.Abs(n) < 9000000000000000m) return n;
			return Testo(v);
		}
		if (v is double || v is float)
		{
			double x = Convert.ToDouble(v, Inv);
			if (double.IsNaN(x) || double.IsInfinity(x)) return Testo(v);
			return x;
		}
		return Testo(v);
	}

	private static void Log(Utente u, string azione, string testo)
	{
		try
		{
			string dir = HttpContext.Current.Server.MapPath("~/App_Data");
			if (!Directory.Exists(dir)) return;
			File.AppendAllText(Path.Combine(dir, "DriveLine.log"),
				DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", Inv) + "\t" + (u != null ? u.Username : "") + "\t" + azione + "\t" + testo.Replace("\r", " ").Replace("\n", " ") + "\r\n",
				Encoding.UTF8);
		}
		catch (Exception) { }
	}

	private static int Limita(int v, int min, int max)
	{
		return v < min ? min : v > max ? max : v;
	}

	private static int IntDaQuery(HttpRequest req, string nome, int predefinito)
	{
		int v;
		return int.TryParse(req.QueryString[nome], NumberStyles.None, Inv, out v) ? v : predefinito;
	}

	private static Dictionary<string, object> LeggiPost(HttpContext ctx)
	{
		if (ctx.Request.HttpMethod != "POST" || ctx.Request.Headers["X-Portale"] != "1") throw new UserException("Richiesta non valida.");
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
				if (sb.Length > MaxBodyChars) throw new UserException("Richiesta troppo grande.");
			}
		}
		Dictionary<string, object> body;
		try
		{
			JavaScriptSerializer js = new JavaScriptSerializer();
			js.MaxJsonLength = int.MaxValue;
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
		if (body == null || !body.TryGetValue(key, out v) || v == null) return "";
		return Convert.ToString(v, Inv);
	}

	private static int IntOpt(Dictionary<string, object> body, string key, int predefinito)
	{
		object v;
		if (!body.TryGetValue(key, out v) || v == null) return predefinito;
		if (v is int) return (int)v;
		if (v is decimal) return (int)(decimal)v;
		int x;
		string s = Convert.ToString(v, Inv).Trim();
		if (s.Length == 0) return predefinito;
		if (int.TryParse(s, NumberStyles.AllowLeadingSign, Inv, out x)) return x;
		throw new UserException("Il valore «" + s + "» non è un numero.");
	}

	private static bool BoolOpt(Dictionary<string, object> body, string key)
	{
		object v;
		return body.TryGetValue(key, out v) && v is bool && (bool)v;
	}

	private static Dictionary<string, object> Dict(Dictionary<string, object> body, string key)
	{
		object v;
		if (!body.TryGetValue(key, out v) || v == null) return new Dictionary<string, object>();
		Dictionary<string, object> d = v as Dictionary<string, object>;
		if (d == null) throw new UserException("Richiesta non valida.");
		return d;
	}

	private static void Error(HttpContext ctx, string message, Dictionary<string, object> diagnosi)
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = false;
		d["message"] = message;
		if (diagnosi != null) d["diagnosi"] = diagnosi;
		Reply(ctx, d);
	}

	private static void Reply(HttpContext ctx, Dictionary<string, object> data)
	{
		JavaScriptSerializer js = new JavaScriptSerializer();
		js.MaxJsonLength = int.MaxValue;
		ctx.Response.Write(js.Serialize(data));
	}
}
