<%@ WebHandler Language="C#" Class="RepairTrackerHandler" %>

/*
 * Repair Tracker (pagina RepairTracker.html): riparazioni urgenti, dal guasto alla chiusura.
 * Due database (li prepara SQL/RepairTracker_01_database.sql):
 *   - RepairTracker (stringa di connessione "RepairTracker"): le pratiche, dbo.Riparazioni e dbo.RiparazioniLog;
 *   - PortaleLogin  (stringa "PortaleLogin", la stessa di Auth.ashx): solo per leggere utente e ruoli.
 *
 * Azioni:
 *   GET  ?action=elenco            tutte le pratiche + utente collegato e i suoi ruoli
 *   GET  ?action=pratica&id=N      una pratica + il suo storico
 *   POST ?action=crea     { campi }                         nuova richiesta (Manutentori, TeamRicambi)
 *   POST ?action=salva    { id, card, campi, conferma }     modifica i dati di una fase
 *   POST ?action=avanza   { id, card, campi }               salva e passa alla fase successiva
 *   POST ?action=decidi   { id, esito, note }               RUO: esito = "accettata" o "rifiutato"
 *   POST ?action=elimina  { id }                            solo Admin
 *   GET  ?health=1                 controllo veloce del collegamento al database
 *
 * I permessi sono controllati QUI, a ogni richiesta, con le stesse regole che la pagina usa
 * per mostrare o nascondere i bottoni. Il flusso (fasi, campi, ruoli) e' descritto in Fasi:
 * se si cambia, va cambiato anche FASI in JS/RepairTracker/RepairTracker.js.
 *
 * Login di sviluppo: se nel Web.config c'e' LoginSviluppo (vedi Auth.ashx) e la richiesta arriva
 * da localhost, l'utente e' "sviluppo" con quei ruoli. Il database serve comunque.
 *
 * Codice in C# 5 (compilatore di default di ASP.NET), come gli altri .ashx del Portale.
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

public class RepairTrackerHandler : IHttpHandler
{
	private const string LoginConnection = "PortaleLogin";   // utenti e ruoli
	private const string DataConnection = "RepairTracker";   // le pratiche
	private const int MaxBodyChars = 65536;
	private const string Admin = "Admin";

	// Chi ha almeno uno di questi ruoli puo' usare il Repair Tracker (uguale al meta "ruoli" della pagina)
	private static readonly string[] RuoliAccesso = { "Riparazioni", "Manutentori", "Magazzino", "TeamRicambi", "RUO", Admin };

	// Chi puo' aprire una nuova richiesta
	private static readonly string[] RuoliCreazione = { "Manutentori", "TeamRicambi" };

	private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

	// ================= il flusso =================

	private class Campo
	{
		public string Nome;        // colonna in dbo.Riparazioni
		public string Etichetta;   // per i messaggi di errore
		public string Tipo;        // testo, maiuscolo, data, decimale, intero, scelta, priorita
		public int Max;            // lunghezza massima (testo)
		public string[] Valori;    // valori ammessi (scelta)
		public bool Obbligatorio;
	}

	private class Fase
	{
		public string Key;
		public string Titolo;
		public string Ruolo;       // ruolo che compila la fase
		public string Stato;       // stato della pratica in cui questa fase e' "attiva" (null per manutentori)
		public string Avanti;      // stato dopo "Conferma" (null: nessun avanzamento con questa fase)
		public Campo[] Campi;
	}

	private static Campo C(string nome, string etichetta, string tipo, int max, bool obbligatorio)
	{
		Campo c = new Campo();
		c.Nome = nome; c.Etichetta = etichetta; c.Tipo = tipo; c.Max = max; c.Obbligatorio = obbligatorio;
		return c;
	}

	private static Campo S(string nome, string etichetta, bool obbligatorio, params string[] valori)
	{
		Campo c = C(nome, etichetta, "scelta", 0, obbligatorio);
		c.Valori = valori;
		return c;
	}

	private static Fase F(string key, string titolo, string ruolo, string stato, string avanti, params Campo[] campi)
	{
		Fase f = new Fase();
		f.Key = key; f.Titolo = titolo; f.Ruolo = ruolo; f.Stato = stato; f.Avanti = avanti; f.Campi = campi;
		return f;
	}

	// L'ordine conta: e' l'ordine delle card nella pagina di dettaglio.
	private static readonly Fase[] Fasi = {
		F("manutentori", "Manutentori", "Manutentori", null, null,
			C("codice_componente", "Descrizione breve", "testo", 200, true),
			C("codice_sap", "Codice SAP", "testo", 50, false),
			C("priorita", "Priorità", "priorita", 0, false),
			C("area", "Area", "testo", 50, true),
			C("descrizione", "Descrizione", "testo", 2000, false),
			C("tipo_guasto", "Tipo guasto", "testo", 200, false),
			C("macchina", "Targa macchina", "testo", 100, true),
			C("centro_costo", "Centro di costo", "testo", 50, true),
			C("note", "Note", "testo", 2000, false)),
		F("magazzino_1", "Magazzino", "Magazzino", "in_magazzino", "richiesta_inoltrata",
			S("tipo_riparazione", "Tipo riparazione", true, "Meccanica", "Elettronica"),
			C("ubicazione", "Ubicazione", "testo", 100, false),
			C("movimento_sap", "Movimento SAP", "testo", 50, false)),
		F("ricambi_1", "Team Ricambi", "TeamRicambi", "richiesta_inoltrata", "attesa_spedizione",
			C("fornitore", "Fornitore", "maiuscolo", 150, true),
			C("bolla", "Bolla", "testo", 50, true)),
		F("magazzino_2", "Magazzino — Spedizione", "Magazzino", "attesa_spedizione", "spedito",
			C("data_spedizione", "Data spedizione", "data", 0, true)),
		F("ricambi_2", "Team Ricambi — Preventivo", "TeamRicambi", "spedito", "attesa_approvazione",
			C("preventivo", "Preventivo", "decimale", 0, true),
			C("tempo_consegna_valore", "Tempo di consegna", "intero", 0, true),
			S("tempo_consegna_unita", "Unità tempo di consegna", true, "giorni", "settimane")),
		F("ruo", "RUO — Approvazione", "RUO", "attesa_approvazione", null,
			C("note_ruo", "Note approvazione", "testo", 2000, false)),
		F("ricambi_3", "Team Ricambi — Ordine", "TeamRicambi", "accettata", "attesa_consegna",
			C("numero_rda", "Numero RDA/ordine", "testo", 50, true),
			C("data_ordine", "Data ordine", "data", 0, true),
			C("data_consegna_fornitore", "Data consegna fornitore", "data", 0, true),
			C("data_ritardo", "Data di ritardo", "data", 0, false)),
		F("ricambi_4", "Team Ricambi — Rientro", "TeamRicambi", "attesa_consegna", "consegnato_magazzino",
			C("bolla_rientro", "Bolla di rientro", "testo", 50, true),
			C("data_rientro_effettiva", "Data rientro", "data", 0, true),
			C("entrata_merci_sap", "Entrata merci a SAP", "testo", 50, false)),
		F("magazzino_3", "Magazzino — Conferma chiusura", "Magazzino", "consegnato_magazzino", "chiuso")
	};

	private static int Indice(string key)
	{
		for (int i = 0; i < Fasi.Length; i++) if (Fasi[i].Key == key) return i;
		return -1;
	}

	private static Fase TrovaFase(string key)
	{
		int i = Indice(key);
		if (i < 0) throw new UserException("Fase sconosciuta.");
		return Fasi[i];
	}

	// Indice della fase su cui si deve agire ora. Rifiutato si ferma sulla fase RUO; chiuso = tutto completato.
	private static int IndiceCorrente(string stato)
	{
		if (stato == "rifiutato") return Indice("ruo");
		for (int i = 0; i < Fasi.Length; i++) if (Fasi[i].Stato == stato) return i;
		return Fasi.Length;
	}

	// "completata", "attiva" o "futura"
	private static string StatoFase(Fase f, string stato)
	{
		if (f.Key == "manutentori") return stato == "in_magazzino" ? "attiva" : "completata";
		if (stato == "rifiutato" && f.Key == "ruo") return "completata";
		int i = Indice(f.Key);
		int cur = IndiceCorrente(stato);
		if (i < cur) return "completata";
		if (i == cur) return "attiva";
		return "futura";
	}

	// La fase dopo ha gia' dati? Se si', chi ha compilato questa fase non la puo' piu' toccare (solo Admin).
	private static bool SuccessivaHaDati(Fase f, Dictionary<string, object> row)
	{
		int i = Indice(f.Key);
		if (i + 1 >= Fasi.Length) return false;
		Fase s = Fasi[i + 1];
		string stato = (string)row["stato"];
		if (s.Key == "ruo") return stato == "rifiutato" || IndiceCorrente(stato) > i + 1; // il RUO ha gia' deciso
		if (s.Campi.Length == 0) return IndiceCorrente(stato) > i + 1;
		foreach (Campo c in s.Campi) if (HaValore(row[c.Nome])) return true;
		return false;
	}

	private static bool PuoModificare(Fase f, Dictionary<string, object> row, Utente u)
	{
		string st = StatoFase(f, (string)row["stato"]);
		if (st == "futura") return false;
		if (u.IsAdmin) return true;
		if (st == "completata" && SuccessivaHaDati(f, row)) return false;
		return u.Ha(f.Ruolo);
	}

	// ================= richiesta =================

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
		public string Username;
		public string Nome;
		public List<string> Ruoli = new List<string>();

		public bool IsAdmin
		{
			get { return Contiene(Admin); }
		}

		private bool Contiene(string ruolo)
		{
			foreach (string r in Ruoli) if (string.Equals(r, ruolo, StringComparison.OrdinalIgnoreCase)) return true;
			return false;
		}

		public bool Ha(string ruolo)
		{
			return IsAdmin || Contiene(ruolo);
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
				if (action == "elenco") { Elenco(context, cn, u); return; }
				if (action == "pratica") { Pratica(context, cn, IdDaQuery(req)); return; }

				if (req.HttpMethod != "POST" || req.Headers["X-Portale"] != "1") throw new UserException("Richiesta non valida.");
				Dictionary<string, object> body = ReadJson(context);

				if (action == "crea") Crea(context, cn, u, Dict(body, "campi"));
				else if (action == "salva") Salva(context, cn, u, Int(body, "id"), Str(body, "card"), Dict(body, "campi"), BoolOpt(body, "conferma"));
				else if (action == "avanza") Avanza(context, cn, u, Int(body, "id"), Str(body, "card"), Dict(body, "campi"));
				else if (action == "decidi") Decidi(context, cn, u, Int(body, "id"), Str(body, "esito"), body.ContainsKey("note") ? body["note"] : null);
				else if (action == "elimina") Elimina(context, cn, u, Int(body, "id"));
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

	// ================= utente e ruoli =================

	// Utente e ruoli si leggono da PortaleLogin (come Auth.ashx); le pratiche stanno nell'altro database.
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

		if (!u.HaUno(RuoliAccesso)) throw new ForbiddenException("Non hai un ruolo per il Repair Tracker. Chiedilo a un amministratore.");
		return u;
	}

	// ================= letture =================

	private static void Elenco(HttpContext ctx, SqlConnection cn, Utente u)
	{
		List<object> pratiche = new List<object>();
		using (SqlCommand cmd = new SqlCommand("SELECT * FROM dbo.Riparazioni ORDER BY id DESC", cn))
		using (SqlDataReader r = cmd.ExecuteReader())
		{
			while (r.Read()) pratiche.Add(PerJson(LeggiRiga(r)));
		}

		Dictionary<string, object> io = new Dictionary<string, object>();
		io["username"] = u.Username;
		io["nome"] = u.Nome;
		io["ruoli"] = u.Ruoli;

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["io"] = io;
		d["pratiche"] = pratiche;
		Reply(ctx, d);
	}

	private static void Pratica(HttpContext ctx, SqlConnection cn, int id)
	{
		Dictionary<string, object> row = CaricaRiga(cn, null, id);

		List<object> log = new List<object>();
		using (SqlCommand cmd = new SqlCommand(
			"SELECT stato, azione, dettaglio, username, nome_utente, data FROM dbo.RiparazioniLog " +
			"WHERE riparazione_id = @id ORDER BY data, id", cn))
		{
			cmd.Parameters.Add("@id", SqlDbType.Int).Value = id;
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				while (r.Read())
				{
					Dictionary<string, object> x = new Dictionary<string, object>();
					x["stato"] = r.GetString(0);
					x["azione"] = r.GetString(1);
					x["dettaglio"] = r.IsDBNull(2) ? "" : r.GetString(2);
					x["username"] = r.IsDBNull(3) ? "" : r.GetString(3);
					x["nome"] = r.IsDBNull(4) ? "" : r.GetString(4);
					x["data"] = r.GetDateTime(5).ToString("yyyy-MM-dd HH:mm", Inv);
					log.Add(x);
				}
			}
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["pratica"] = PerJson(row);
		d["log"] = log;
		Reply(ctx, d);
	}

	// ================= scritture =================

	private static void Crea(HttpContext ctx, SqlConnection cn, Utente u, Dictionary<string, object> campi)
	{
		if (!u.HaUno(RuoliCreazione)) throw new ForbiddenException("Non puoi aprire nuove richieste.");

		Fase f = TrovaFase("manutentori");
		Dictionary<string, object> valori = Valori(f, campi);
		foreach (Campo c in f.Campi)
			if (c.Obbligatorio && !HaValore(Get(valori, c.Nome))) throw new UserException("Campo obbligatorio: " + c.Etichetta + ".");
		if (!HaValore(Get(valori, "priorita"))) valori["priorita"] = 2;

		int id;
		using (SqlTransaction tx = cn.BeginTransaction())
		{
			// Numero pratica: anno-progressivo (2026-0001). Il blocco evita due numeri uguali in contemporanea.
			string anno = DateTime.Now.Year.ToString(Inv);
			int prossimo = 1;
			using (SqlCommand cmd = new SqlCommand(
				"SELECT MAX(numero_pratica) FROM dbo.Riparazioni WITH (UPDLOCK, HOLDLOCK) WHERE numero_pratica LIKE @p", cn, tx))
			{
				cmd.Parameters.Add("@p", SqlDbType.NVarChar, 20).Value = anno + "-%";
				string max = cmd.ExecuteScalar() as string;
				int n;
				if (max != null && int.TryParse(max.Substring(anno.Length + 1), NumberStyles.None, Inv, out n)) prossimo = n + 1;
			}
			string numero = anno + "-" + prossimo.ToString("D4", Inv);

			StringBuilder colonne = new StringBuilder("numero_pratica, stato, creato_da");
			StringBuilder param = new StringBuilder("@numero, N'in_magazzino', @da");
			using (SqlCommand cmd = new SqlCommand())
			{
				int k = 0;
				foreach (KeyValuePair<string, object> kv in valori)
				{
					colonne.Append(", ").Append(kv.Key);            // solo nomi presi da Fasi, mai dalla richiesta
					param.Append(", @v").Append(k);
					cmd.Parameters.AddWithValue("@v" + k, kv.Value);
					k++;
				}
				cmd.Connection = cn;
				cmd.Transaction = tx;
				cmd.CommandText = "INSERT INTO dbo.Riparazioni (" + colonne + ") OUTPUT inserted.id VALUES (" + param + ")";
				cmd.Parameters.Add("@numero", SqlDbType.NVarChar, 20).Value = numero;
				cmd.Parameters.Add("@da", SqlDbType.NVarChar, 50).Value = u.Username;
				id = (int)cmd.ExecuteScalar();
			}

			Log(cn, tx, id, "in_magazzino", "Creazione", "Pratica " + numero, u);
			tx.Commit();
		}

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["id"] = id;
		Reply(ctx, d);
	}

	private static void Salva(HttpContext ctx, SqlConnection cn, Utente u, int id, string key, Dictionary<string, object> campi, bool conferma)
	{
		Fase f = TrovaFase(key);
		if (f.Key == "ruo") throw new UserException("La decisione del RUO si cambia con Approva / Rifiuta.");

		using (SqlTransaction tx = cn.BeginTransaction())
		{
			Dictionary<string, object> row = CaricaRiga(cn, tx, id);
			string stato = (string)row["stato"];
			if (!PuoModificare(f, row, u)) throw new ForbiddenException("Non puoi modificare questa fase.");

			Dictionary<string, object> valori = Valori(f, campi);
			bool completa = Completa(f, row, valori);

			// Fase gia' superata con un campo obbligatorio svuotato: la pratica torna a questa fase
			// e i dati delle fasi successive vengono cancellati (come nella vecchia app).
			bool regressione = !completa && f.Stato != null && stato != f.Stato;

			if (!completa && f.Key == "manutentori")
				throw new UserException("Compila tutti i campi obbligatori.");

			if (regressione && !conferma)
			{
				Dictionary<string, object> q = new Dictionary<string, object>();
				q["ok"] = false;
				q["regressione"] = true;
				q["message"] = "Rimuovendo questo campo obbligatorio, la pratica regredirà a questa fase e tutti i dati " +
					"compilati nelle fasi successive verranno eliminati definitivamente. Continuare?";
				Reply(ctx, q);
				return;
			}

			string cambiati = Cambiati(f, row, valori);
			string nuovoStato = null;
			if (regressione)
			{
				for (int i = Indice(f.Key) + 1; i < Fasi.Length; i++)
					foreach (Campo c in Fasi[i].Campi) valori[c.Nome] = DBNull.Value;
				nuovoStato = f.Stato;
			}

			if (valori.Count > 0 || nuovoStato != null)
			{
				Aggiorna(cn, tx, id, valori, nuovoStato, null);
				if (regressione) Log(cn, tx, id, nuovoStato, "Regressione", "Tornata a: " + f.Titolo + ". Dati delle fasi successive cancellati.", u);
				else if (cambiati.Length > 0) Log(cn, tx, id, stato, "Modifica", f.Titolo + ": " + cambiati, u);
			}
			tx.Commit();
		}
		Ok(ctx);
	}

	private static void Avanza(HttpContext ctx, SqlConnection cn, Utente u, int id, string key, Dictionary<string, object> campi)
	{
		Fase f = TrovaFase(key);
		if (f.Avanti == null) throw new UserException("Questa fase non si conferma così.");

		using (SqlTransaction tx = cn.BeginTransaction())
		{
			Dictionary<string, object> row = CaricaRiga(cn, tx, id);
			if (StatoFase(f, (string)row["stato"]) != "attiva")
				throw new UserException("La pratica è già andata avanti. Ricarica la pagina.");
			if (!PuoModificare(f, row, u)) throw new ForbiddenException("Questa fase la compila " + f.Ruolo + ".");

			Dictionary<string, object> valori = Valori(f, campi);
			if (!Completa(f, row, valori)) throw new UserException("Compila tutti i campi obbligatori.");

			if (Aggiorna(cn, tx, id, valori, f.Avanti, f.Stato) == 0)
				throw new UserException("La pratica è stata modificata da un altro utente. Ricarica la pagina.");
			Log(cn, tx, id, f.Avanti, "Avanzamento", f.Titolo + " confermata", u);
			tx.Commit();
		}
		Ok(ctx);
	}

	private static void Decidi(HttpContext ctx, SqlConnection cn, Utente u, int id, string esito, object note)
	{
		if (esito != "accettata" && esito != "rifiutato") throw new UserException("Richiesta non valida.");
		Fase f = TrovaFase("ruo");

		using (SqlTransaction tx = cn.BeginTransaction())
		{
			Dictionary<string, object> row = CaricaRiga(cn, tx, id);
			string stato = (string)row["stato"];

			// RUO (o Admin) decide quando la pratica e' in attesa di approvazione;
			// solo l'Admin puo' cambiare la decisione, e solo finche' nessuno e' andato avanti.
			bool ok = (stato == "attesa_approvazione" && u.Ha("RUO")) ||
			          (u.IsAdmin && (stato == "accettata" || stato == "rifiutato"));
			if (!ok) throw new ForbiddenException("Non puoi approvare o rifiutare questa pratica.");
			if (stato == esito) throw new UserException("La pratica è già " + (esito == "accettata" ? "accettata." : "rifiutata."));

			Dictionary<string, object> valori = new Dictionary<string, object>();
			valori["note_ruo"] = Valore(f.Campi[0], note);
			if (Aggiorna(cn, tx, id, valori, esito, stato) == 0)
				throw new UserException("La pratica è stata modificata da un altro utente. Ricarica la pagina.");
			Log(cn, tx, id, esito, esito == "accettata" ? "Approvata" : "Rifiutata",
				valori["note_ruo"] == DBNull.Value ? null : (string)valori["note_ruo"], u);
			tx.Commit();
		}
		Ok(ctx);
	}

	private static void Elimina(HttpContext ctx, SqlConnection cn, Utente u, int id)
	{
		if (!u.IsAdmin) throw new ForbiddenException("Solo un amministratore può eliminare una pratica.");
		using (SqlCommand cmd = new SqlCommand("DELETE FROM dbo.Riparazioni WHERE id = @id", cn)) // lo storico si cancella con la pratica
		{
			cmd.Parameters.Add("@id", SqlDbType.Int).Value = id;
			if (cmd.ExecuteNonQuery() == 0) throw new UserException("Pratica non trovata. Ricarica la pagina.");
		}
		Ok(ctx);
	}

	// ================= campi =================

	// Converte i campi inviati dalla pagina nei valori per il database. Solo i campi della fase sono accettati.
	private static Dictionary<string, object> Valori(Fase f, Dictionary<string, object> campi)
	{
		Dictionary<string, object> valori = new Dictionary<string, object>();
		foreach (string nome in campi.Keys)
		{
			Campo c = null;
			foreach (Campo x in f.Campi) if (x.Nome == nome) c = x;
			if (c == null || c.Nome == "note_ruo") throw new UserException("Campo non previsto: " + nome + ".");
			valori[c.Nome] = Valore(c, campi[nome]);
		}
		return valori;
	}

	private static object Valore(Campo c, object v)
	{
		if (v == null) return DBNull.Value;
		string s = v is string ? ((string)v).Trim() : Convert.ToString(v, Inv);
		if (s.Length == 0) return DBNull.Value;

		switch (c.Tipo)
		{
			case "testo":
			case "maiuscolo":
				if (s.Length > c.Max) throw new UserException(c.Etichetta + ": massimo " + c.Max + " caratteri.");
				return c.Tipo == "maiuscolo" ? s.ToUpperInvariant() : s;

			case "data":
				DateTime d;
				if (!DateTime.TryParseExact(s, "yyyy-MM-dd", Inv, DateTimeStyles.None, out d) || d.Year < 2000 || d.Year > 2100)
					throw new UserException(c.Etichetta + ": data non valida.");
				return d;

			case "decimale":
				decimal m;
				if (v is decimal || v is int || v is long || v is double) m = Convert.ToDecimal(v, Inv);
				else if (!decimal.TryParse(s.Replace(',', '.'), NumberStyles.Number, Inv, out m))
					throw new UserException(c.Etichetta + ": numero non valido.");
				if (m < 0 || m >= 10000000000m) throw new UserException(c.Etichetta + ": numero non valido.");
				return Math.Round(m, 2);

			case "intero":
				int n;
				if (!int.TryParse(s, NumberStyles.Integer, Inv, out n) || n < 1 || n > 100000)
					throw new UserException(c.Etichetta + ": deve essere un numero intero da 1 in su.");
				return n;

			case "priorita":
				if (s != "1" && s != "2") throw new UserException("Priorità non valida.");
				return s == "1" ? 1 : 2;

			case "scelta":
				foreach (string x in c.Valori) if (x == s) return s;
				throw new UserException(c.Etichetta + ": valore non valido.");
		}
		throw new UserException("Campo non previsto: " + c.Nome + ".");
	}

	// I campi obbligatori della fase sono compilati (valori nuovi, oppure quelli gia' nel database)?
	private static bool Completa(Fase f, Dictionary<string, object> row, Dictionary<string, object> valori)
	{
		foreach (Campo c in f.Campi)
		{
			if (!c.Obbligatorio) continue;
			object v = valori.ContainsKey(c.Nome) ? valori[c.Nome] : row[c.Nome];
			if (!HaValore(v)) return false;
		}
		return true;
	}

	// Elenco dei campi cambiati, per lo storico ("Fornitore, Bolla")
	private static string Cambiati(Fase f, Dictionary<string, object> row, Dictionary<string, object> valori)
	{
		StringBuilder sb = new StringBuilder();
		foreach (Campo c in f.Campi)
		{
			if (!valori.ContainsKey(c.Nome)) continue;
			if (Testo(valori[c.Nome]) == Testo(row[c.Nome])) continue;
			if (sb.Length > 0) sb.Append(", ");
			sb.Append(c.Etichetta);
		}
		return sb.ToString();
	}

	private static string Testo(object v)
	{
		if (!HaValore(v)) return "";
		if (v is DateTime) return ((DateTime)v).ToString("yyyy-MM-dd", Inv);
		if (v is decimal) return ((decimal)v).ToString("0.00", Inv);
		return Convert.ToString(v, Inv);
	}

	private static bool HaValore(object v)
	{
		if (v == null || v == DBNull.Value) return false;
		string s = v as string;
		return s == null || s.Trim().Length > 0;
	}

	private static object Get(Dictionary<string, object> d, string key)
	{
		return d.ContainsKey(key) ? d[key] : null;
	}

	// ================= database =================

	private static SqlConnection Open(string name)
	{
		ConnectionStringSettings cs = ConfigurationManager.ConnectionStrings[name];
		if (cs == null || string.IsNullOrEmpty(cs.ConnectionString))
			throw new InvalidOperationException("Nel Web.config manca la stringa di connessione '" + name + "'.");
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

	private static Dictionary<string, object> CaricaRiga(SqlConnection cn, SqlTransaction tx, int id)
	{
		// dentro una transazione la riga resta bloccata fino al commit: due persone non avanzano la stessa pratica insieme
		string sql = tx == null
			? "SELECT * FROM dbo.Riparazioni WHERE id = @id"
			: "SELECT * FROM dbo.Riparazioni WITH (UPDLOCK, ROWLOCK) WHERE id = @id";
		using (SqlCommand cmd = new SqlCommand(sql, cn, tx))
		{
			cmd.Parameters.Add("@id", SqlDbType.Int).Value = id;
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				if (!r.Read()) throw new UserException("Pratica non trovata. Forse è stata eliminata.");
				return LeggiRiga(r);
			}
		}
	}

	private static Dictionary<string, object> LeggiRiga(SqlDataReader r)
	{
		Dictionary<string, object> row = new Dictionary<string, object>();
		for (int i = 0; i < r.FieldCount; i++) row[r.GetName(i)] = r.GetValue(i);
		return row;
	}

	private static Dictionary<string, object> PerJson(Dictionary<string, object> row)
	{
		Dictionary<string, object> x = new Dictionary<string, object>();
		foreach (KeyValuePair<string, object> kv in row)
		{
			object v = kv.Value;
			if (v == DBNull.Value) v = null;
			else if (v is DateTime)
				v = ((DateTime)v).ToString(kv.Key == "creato_il" || kv.Key == "modificato_il" ? "yyyy-MM-dd HH:mm" : "yyyy-MM-dd", Inv);
			else if (v is byte) v = (int)(byte)v;
			x[kv.Key] = v;
		}
		return x;
	}

	// UPDATE dei campi indicati (+ stato). Con statoAtteso aggiorna solo se la pratica e' ancora in quello stato.
	private static int Aggiorna(SqlConnection cn, SqlTransaction tx, int id, Dictionary<string, object> valori, string nuovoStato, string statoAtteso)
	{
		using (SqlCommand cmd = new SqlCommand())
		{
			StringBuilder sql = new StringBuilder("UPDATE dbo.Riparazioni SET modificato_il = SYSDATETIME()");
			int k = 0;
			foreach (KeyValuePair<string, object> kv in valori)
			{
				sql.Append(", ").Append(kv.Key).Append(" = @v").Append(k);   // nomi presi da Fasi, mai dalla richiesta
				cmd.Parameters.AddWithValue("@v" + k, kv.Value);
				k++;
			}
			if (nuovoStato != null)
			{
				sql.Append(", stato = @stato");
				cmd.Parameters.Add("@stato", SqlDbType.NVarChar, 30).Value = nuovoStato;
			}
			sql.Append(" WHERE id = @id");
			cmd.Parameters.Add("@id", SqlDbType.Int).Value = id;
			if (statoAtteso != null)
			{
				sql.Append(" AND stato = @atteso");
				cmd.Parameters.Add("@atteso", SqlDbType.NVarChar, 30).Value = statoAtteso;
			}
			cmd.Connection = cn;
			cmd.Transaction = tx;
			cmd.CommandText = sql.ToString();
			return cmd.ExecuteNonQuery();
		}
	}

	private static void Log(SqlConnection cn, SqlTransaction tx, int id, string stato, string azione, string dettaglio, Utente u)
	{
		using (SqlCommand cmd = new SqlCommand(
			"INSERT INTO dbo.RiparazioniLog (riparazione_id, stato, azione, dettaglio, username, nome_utente) " +
			"VALUES (@id, @s, @a, @d, @u, @n)", cn, tx))
		{
			cmd.Parameters.Add("@id", SqlDbType.Int).Value = id;
			cmd.Parameters.Add("@s", SqlDbType.NVarChar, 30).Value = stato;
			cmd.Parameters.Add("@a", SqlDbType.NVarChar, 30).Value = azione;
			cmd.Parameters.Add("@d", SqlDbType.NVarChar, 2000).Value = (object)Cut(dettaglio, 2000) ?? DBNull.Value;
			cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = (object)u.Username ?? DBNull.Value;
			cmd.Parameters.Add("@n", SqlDbType.NVarChar, 150).Value = (object)Cut(u.Nome, 150) ?? DBNull.Value;
			cmd.ExecuteNonQuery();
		}
	}

	private static string Cut(string s, int max)
	{
		if (s == null) return null;
		return s.Length > max ? s.Substring(0, max) : s;
	}

	// ================= controllo veloce =================

	private static void Health(HttpContext ctx)
	{
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["status"] = "ok";

		// database delle pratiche
		try
		{
			using (SqlConnection cn = Open(DataConnection))
			{
				d["database"] = cn.Database;
				using (SqlCommand cmd = new SqlCommand(
					"SELECT COUNT(*) FROM sys.tables WHERE name IN (N'Riparazioni', N'RiparazioniLog')", cn))
					d["tabelle"] = (int)cmd.ExecuteScalar();
				if ((int)d["tabelle"] < 2)
				{
					d["status"] = "schema incompleto";
					d["message"] = "Eseguire SQL/RepairTracker_01_database.sql in SSMS.";
				}
				else
				{
					using (SqlCommand cmd = new SqlCommand("SELECT COUNT(*) FROM dbo.Riparazioni", cn))
						d["pratiche"] = (int)cmd.ExecuteScalar();
				}
			}
		}
		catch (Exception ex)
		{
			d["status"] = "errore";
			d["message"] = "Database RepairTracker: " + ex.Message;
		}

		// database del login: i ruoli del Repair Tracker devono esserci
		try
		{
			using (SqlConnection cn = Open(LoginConnection))
			using (SqlCommand cmd = new SqlCommand("SELECT Nome FROM dbo.Ruoli WHERE Nome IN (" +
				"N'Riparazioni', N'Manutentori', N'Magazzino', N'TeamRicambi', N'RUO') ORDER BY Nome", cn))
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				List<string> ruoli = new List<string>();
				while (r.Read()) ruoli.Add(r.GetString(0));
				d["ruoli"] = ruoli;
				if (ruoli.Count < 5 && (string)d["status"] == "ok")
				{
					d["status"] = "ruoli mancanti";
					d["message"] = "Eseguire SQL/RepairTracker_01_database.sql in SSMS (parte 2: ruoli).";
				}
			}
		}
		catch (Exception ex)
		{
			if ((string)d["status"] == "ok") d["status"] = "errore";
			d["messageLogin"] = "Database PortaleLogin: " + ex.Message;
		}

		Reply(ctx, d);
	}

	// ================= richiesta e risposta =================

	private static int IdDaQuery(HttpRequest req)
	{
		int id;
		if (!int.TryParse(req.QueryString["id"], NumberStyles.None, Inv, out id)) throw new UserException("Richiesta non valida.");
		return id;
	}

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
				if (sb.Length > MaxBodyChars) throw new UserException("Richiesta troppo grande.");
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

	private static string Str(Dictionary<string, object> body, string key)
	{
		object v;
		if (!body.TryGetValue(key, out v) || !(v is string)) throw new UserException("Richiesta non valida.");
		return (string)v;
	}

	private static bool BoolOpt(Dictionary<string, object> body, string key)
	{
		object v;
		return body.TryGetValue(key, out v) && v is bool && (bool)v;
	}

	private static Dictionary<string, object> Dict(Dictionary<string, object> body, string key)
	{
		object v;
		if (!body.TryGetValue(key, out v)) return new Dictionary<string, object>();
		Dictionary<string, object> d = v as Dictionary<string, object>;
		if (d == null) throw new UserException("Richiesta non valida.");
		return d;
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
