<%@ WebHandler Language="C#" Class="RepairTrackerHandler" %>

/*
 * Repair Tracker (pagina RepairTracker.html): riparazioni urgenti, dal guasto alla chiusura.
 * Due database (li prepara SQL/RepairTracker_01_database.sql, poi gli aggiornamenti 02, 03, 04):
 *   - RepairTracker (stringa di connessione "RepairTracker"): pratiche (dbo.Riparazioni), storico (dbo.RiparazioniLog),
 *     budget mensile per area (dbo.BudgetAree);
 *   - PortaleLogin  (stringa "PortaleLogin", la stessa di Auth.ashx): utenti e ruoli.
 *
 * Azioni:
 *   GET  ?action=elenco            tutte le pratiche, utente collegato, menu a tendina, budget del mese corrente
 *   GET  ?action=pratica&id=N      una pratica + storico + budget del mese della sua area
 *   POST ?action=crea     { campi }                         nuova richiesta (Manutentori, TeamRicambi)
 *   POST ?action=salva    { id, card, campi, conferma }     modifica i dati di una fase
 *   POST ?action=avanza   { id, card, campi }               salva e passa alla fase successiva
 *                                                          (Magazzino con "Laboratorio Elettrotecnico": salta al Rientro)
 *   POST ?action=decidi   { id, esito }                     RUO: esito = "accettata" o "rifiutato"
 *   POST ?action=elimina  { id }                            solo Admin
 *   Solo "Admin Repair" (e Admin):
 *   GET  ?action=budget&anno=A&mese=M                      budget, approvato e disponibile di ogni area in quel mese
 *   POST ?action=budget_salva { anno, mese, importi }       importi = { "NEF": 15000, "CAMBI": null, ... } (null = nessun budget)
 *   GET  ?action=utenti                                     utenti del Portale con i loro ruoli del Repair Tracker
 *   POST ?action=utenti_ruoli { id, ruoli: [idRuolo, ...] } sostituisce SOLO i ruoli del Repair Tracker dell'utente
 *   GET  ?health=1                 controllo veloce dei database
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
	private const string DataConnection = "RepairTracker";   // pratiche e budget
	private const int MaxBodyChars = 65536;
	private const string Admin = "Admin";
	private const string AdminRepair = "Admin Repair";       // budget mensile e ruoli del Repair Tracker degli utenti

	// Chi ha almeno uno di questi ruoli puo' usare il Repair Tracker (uguale al meta "ruoli" della pagina),
	// piu' i ruoli RUO per area ("RUO CAMBI", ...), vedi RuoliAccesso()
	private static readonly string[] RuoliBase = { "Riparazioni", "Manutentori", "Magazzino", "TeamRicambi", "RUO", AdminRepair, Admin };

	// RUO per area: il ruolo si chiama "RUO " + nome dell'area (es. "RUO CAMBI") e approva solo le pratiche di quell'area.
	// Il ruolo "RUO" da solo approva tutte le aree.
	private const string PrefissoRuo = "RUO ";

	// Tipo di riparazione che salta fornitore, spedizione, preventivo, RUO, RDA e ordine: dal Magazzino si va al Rientro
	private const string LabElettro = "Laboratorio Elettrotecnico";

	// Chi puo' aprire una nuova richiesta
	private static readonly string[] RuoliCreazione = { "Manutentori", "TeamRicambi" };

	private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
	private static readonly CultureInfo It = CultureInfo.GetCultureInfo("it-IT");

	// ================= elenchi dei menu a tendina =================
	// Sono qui (e solo qui): la pagina li riceve con ?action=elenco. Per cambiarli basta modificare queste righe.
	// Se si aggiunge o rinomina un'area servono anche: il ruolo "RUO <area>" in PortaleLogin
	// e il nome nel meta "ruoli" di RepairTracker.html.

	private class Area
	{
		public string Nome;
		public string[][] Centri;   // { codice, descrizione }
	}

	private static Area A(string nome, params string[] coppie)
	{
		Area a = new Area();
		a.Nome = nome;
		a.Centri = new string[coppie.Length / 2][];
		for (int i = 0; i < a.Centri.Length; i++) a.Centri[i] = new string[] { coppie[2 * i], coppie[2 * i + 1] };
		return a;
	}

	// Aree (UO) con i loro centri di costo (file CDC.xlsx del 23/10/2026; I&M = centri VECTOR, ePWT = centri CURSOR)
	private static readonly Area[] UoCentri = {
		A("NEF",   // centri NEF
			"C6590001", "OTHER OPERATING MM92/93",
			"C6593900", "DIREZIONE",
			"C6593901", "UTILIZZO FATTORI",
			"C6593902", "QUALITA'",
			"C6593903", "LOGISTICA",
			"C6593904", "INGENIERIA DI PROD.",
			"C6593911", "LAVORAZ. BASAMENTI N",
			"C6593912", "LAVORAZ. TESTE CILIN",
			"C6593913", "PREPARAZ. TESTE CILI",
			"C6593914", "STRUTT. U.O. LAVOR.",
			"C6593915", "AFFILA. LAVORAZ. NEF",
			"C6593917", "MAN. COMAU LAVORAZ.",
			"C6593930", "LINEA IMBIELLATO",
			"C6593935", "ISOLA DRESSING 1",
			"C6593938", "CELLE DI PRODUZIONE",
			"C6593941", "FINIZIONE",
			"C6593942", "VERNICIATURA",
			"C6593943", "SPEDIZIONE",
			"C6593945", "STRUTT. U.O. MONTAGG",
			"C6593950", "COSTRUZIONE PRE-SERI",
			"C6593951", "FABBRICATI MONTAGGIO",
			"C6593952", "FAB. LAVORAZ. EEA",
			"C6593980", "O.L. / RECUPERI",
			"C6599200", "PERSONALE",
			"C6599300", "FINANCE",
			"C6599400", "ICT"),
		A("I&M",   // centri VECTOR
			"C6390001", "OTHER OPERATING MM92/93",
			"C6395250", "MONTAGGIO NUOVI MOTORI V",
			"C6395251", "SALA PROVA NUOVI MOTORI V",
			"C6395252", "MONTAGGIO/PROVA POWERPACK",
			"C6395253", "PROTOTIPI NUOVI MOTORI V",
			"C6395261", "FABBRICATI",
			"C6395265", "COSTI SPEC. DI SITO PROD.",
			"C6395280", "O.L./RECUPERI"),
		A("CAMBI",   // centri CAMBI
			"C6610001", "OTHER OPERATING MM92/93",
			"C6611004", "PROVA ROTAZIONE CAMBI",
			"C6611005", "RIGENERAZIONE CAMBI",
			"C6611006", "PREPARAZIONE GRUPPI, RIPARAZIONE",
			"C6611008", "RACC. ELEMENTI, IMBALLO E SPED.CAMBI CKD",
			"C6611009", "ORDINI DI LAVORO VARI",
			"C6611010", "MONTAGGIO CAMBI \"S\" \"SPR\"",
			"C6611012", "SMISTAMENTO MATERIALE",
			"C6611013", "LAVORAZINE PROTOTIPI E RE.LE CAMBI",
			"C6611014", "RIEMPIMENTO UDC",
			"C6611102", "LAVORAZIONE INGRANAGGI CAMBI",
			"C6611103", "RETT.INGRANAGGI, ALBERI E OVERLAPPING",
			"C6611104", "ISOLA ALBERI PRIMARI, ENTRATA, SECONDARI",
			"C6611107", "DIREZIONE STABILIMENTO CAMBI",
			"C6611111", "LAVORAZ. SCATOLE CAMBI \"S\"",
			"C6611121", "RICOTTURA ISOTERMICA-BONIFICA",
			"C6611123", "SALDATURA",
			"C6611124", "LAVAGGIO CEMENTAZIONE E TEMPRA",
			"C6611125", "GRANIGLIATRICE, BURATTATRICE, PALLINATR.",
			"C6611130", "TORNITURA INGRANAGGI MOTORE",
			"C6611131", "DENTAT/SBARBAT/RETTIF. I.M.",
			"C6611136", "RASOLAPPATURA I.M.",
			"C6611201", "STRUTTURA LAVORAZIONE CAMBI E INGR. MOT.",
			"C6611202", "STRUTTURA UNITA' OPERATIVA TRATT.TERMICI",
			"C6611211", "STRUTTURA MONTAGGIO CAMBI",
			"C6611380", "O.L./RECUPERI/PRESIDI",
			"C6611501", "RESPONSABILE OPERATIVO LOGISTICA",
			"C6611600", "ANALISI LAVORO",
			"C6611701", "INGEGNERIA PRODUZIONE",
			"C6611720", "MANUTENZIONE UNITA'",
			"C6611730", "GESTIONE MATERIALI AUSILIARI",
			"C6611740", "AFFILATURA UTENSILI",
			"C6611750", "MANUTENZIONE MACCHINARI",
			"C6611751", "FABBRICATI CAMBI",
			"C6611760", "SPECIALISTI DI INGEGNERIA",
			"C6611800", "QUALITA' (LABORATORIO/SALA METROLGICA)",
			"C6611900", "LAUNCH MANAGEMENT",
			"C6619200", "SERVIZIO PERSONALE"),
		A("PONTI",   // centri PONTI
			"C6620001", "OTHER OPERATING MM92/93",
			"C6621013", "COMMESSE, RELE PROTOTIPI",
			"C6621132", "LAV.COP.C.TV.T.T.-PERNI F.",
			"C6627100", "STRUTTURA DI STABILIMENTO",
			"C6627200", "STRUTTURA U.O. LAVORAZIONE",
			"C6627300", "STRUTTURA U.O. MONTAGGIO",
			"C6627380", "O.L. RECUPERI",
			"C6627401", "LAV.MOZZI/DISCHI SPR1/SEMIASSI PONTI LEG",
			"C6627402", "LAV.CARRIER RID HR LEVE/CO1/SC.DIF",
			"C6627403", "LAV.SCAT.PONTE SPR1",
			"C6627404", "FUSI SPR 2",
			"C6627405", "LAV.CORPO ASSALE T.T. FUSI SPR1",
			"C6627406", "LAV.SCATOLE HR MANICOTTI",
			"C6627408", "PREP.GRUPPI LINEA MONTAG.PONTI HR",
			"C6627409", "PREP.GRUPPI E LINEA MONT.PONTI S/SPR1",
			"C6627410", "PREP.GRUPPI MONT.PONTI ROCKWELL",
			"C6627412", "VERNICIATURA",
			"C6627418", "CONTROLLO COPPIE DI SERRAGGIO",
			"C6627419", "SPEDIZ.PONTI,CKD PONTI COMP,IMBALLO",
			"C6627500", "SERV PROD OPER PONTI",
			"C6627600", "UTILIZZO FATTORI PONTI",
			"C6627700", "INGEGNERIA PROD PONTI",
			"C6627719", "MANUTENZIONE COST. PART PONTI",
			"C6627721", "MANUTENZIONI PONTI",
			"C6627740", "AFFILATURA UTENSILI PONTI",
			"C6627750", "MANUTENZIONE COMAU",
			"C6627751", "BUILDING",
			"C6627800", "QUALITA'(SALA METR/ACCET)PONTI",
			"C6627900", "LAUNCH MANAGEMENT",
			"C6629200", "SERVIZIO PERSONALE",
			"C6627723", "ATTREZZERIA",
			"C6627722", "LABORATORIO ELETTRONICO"),
		A("ePWT",   // centri CURSOR
			"C64G0001", "OTHER OPERATING MASTRO 92/93",
			"C64G3949", "DRESSING CURSOR 9",
			"C64G3950", "STRUTTURA C9",
			"C64G3951", "BUILDING",
			"C64G3980", "O.I. / RECUPERI"),
		A("COMPRENSORIO",   // centri COMPRENSORIO
			"C6630001", "OTHER OPERATING MM92/93",
			"C6639200", "SERVIZIO PERSONALE",
			"C6639250", "SALA MEDICA",
			"C6639260", "SORVEGLIANZA",
			"C6639285", "MENSA AZIENDALE",
			"C6639300", "AMMINISTRAZIONE",
			"C6639380", "O.L./RECUPERI",
			"C6639400", "INFORMATICA",
			"C6639603", "ECOLOGIA DI STABILIMENTO",
			"C6639650", "PULIZIE CIVILI STURA",
			"C6639700", "SERVIZI TECNICI DI COMPRENSORIO",
			"C6639710", "IMPIANTI GENERALI",
			"C6639720", "MANUTENZIONE STURA",
			"C6639730", "MATERIALI AUSILIARI STURA",
			"C6639751", "FABBRICATI",
			"C6639752", "MANUTENZIONE MACCHINARI")
	};

	private static readonly string[] TipiGuasto = { "Elettrico", "Meccanico", "Oleodinamico", "Usura" };

	private static string[] Aree()
	{
		string[] a = new string[UoCentri.Length];
		for (int i = 0; i < UoCentri.Length; i++) a[i] = UoCentri[i].Nome;
		return a;
	}

	// Codici dei centri di costo dell'area (vuoto se l'area non esiste)
	private static List<string> CentriDi(string area)
	{
		List<string> l = new List<string>();
		foreach (Area a in UoCentri)
			if (a.Nome == area) foreach (string[] c in a.Centri) l.Add(c[0]);
		return l;
	}

	private static string[] RuoliAccesso()
	{
		List<string> l = new List<string>(RuoliBase);
		foreach (string a in Aree()) l.Add(PrefissoRuo + a);
		return l.ToArray();
	}

	// Ruoli che l'Admin Repair puo' dare e togliere (tutti quelli del Repair Tracker, nell'ordine delle colonne)
	private static List<string> RuoliGestibili()
	{
		List<string> l = new List<string>();
		l.Add("Riparazioni"); l.Add("Manutentori"); l.Add("Magazzino"); l.Add("TeamRicambi"); l.Add("RUO");
		foreach (string a in Aree()) l.Add(PrefissoRuo + a);
		l.Add(AdminRepair);   // questo lo puo' dare/togliere solo l'Admin
		return l;
	}

	// Il RUO puo' approvare/rifiutare questa pratica? "RUO" (o Admin) = tutte le aree, "RUO <area>" = solo quell'area.
	private static bool PuoApprovare(Utente u, Dictionary<string, object> row)
	{
		if (u.Ha("RUO")) return true;
		string area = row["area"] as string;
		return !string.IsNullOrEmpty(area) && u.Ha(PrefissoRuo + area);
	}

	// ================= il flusso =================

	private class Campo
	{
		public string Nome;            // colonna in dbo.Riparazioni
		public string Etichetta;       // per i messaggi di errore
		public string Tipo;            // testo, maiuscolo, data, decimale, intero, scelta, priorita, centro, bool, interno
		public int Max;                // lunghezza massima (testo)
		public string[] Valori;        // valori ammessi (scelta)
		public bool Obbligatorio;      // per un bool: deve essere spuntato
		public string SeCampo;         // il campo esiste solo se SeCampo vale SeValore (altrimenti si svuota e non e' obbligatorio)
		public object SeValore;
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

	private static Campo Se(Campo c, string campo, object valore)
	{
		c.SeCampo = campo;
		c.SeValore = valore;
		return c;
	}

	// Campo scritto solo dall'API (mai dalla pagina): serve per svuotarlo quando la pratica torna indietro
	private static Campo Interno(string nome)
	{
		return C(nome, nome, "interno", 0, false);
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
			S("area", "Area", true, Aree()),
			C("centro_costo", "Centro di costo", "centro", 50, true),   // uno dei centri dell'area scelta
			C("macchina", "Targa macchina", "testo", 100, true),
			C("op", "Operazione", "testo", 50, true),
			C("priorita", "Priorità", "priorita", 0, false),
			S("tipo_guasto", "Tipo guasto", false, TipiGuasto),
			C("descrizione", "Descrizione e note", "testo", 2000, false)),
		F("magazzino_1", "Magazzino", "Magazzino", "in_magazzino", "richiesta_inoltrata",
			S("tipo_riparazione", "Tipo riparazione", true, "Meccanica", "Elettronica", LabElettro),
			C("ubicazione", "Ubicazione", "testo", 100, true),
			C("movimento_sap", "Movimento SAP", "testo", 50, true),
			Se(C("previsione_riparazione", "Previsione riparazione", "data", 0, false), "tipo_riparazione", LabElettro)),
		F("ricambi_1", "Team Ricambi", "TeamRicambi", "richiesta_inoltrata", "attesa_spedizione",
			C("fornitore", "Fornitore", "maiuscolo", 150, true),
			C("bolla", "Bolla", "testo", 50, true)),
		F("magazzino_2", "Magazzino — Spedizione", "Magazzino", "attesa_spedizione", "spedito",
			C("data_spedizione", "Data spedizione", "data", 0, true)),
		F("ricambi_2", "Team Ricambi — Preventivo", "TeamRicambi", "spedito", "attesa_approvazione",
			C("numero_preventivo", "Numero preventivo", "testo", 50, false),
			C("preventivo", "Preventivo", "decimale", 0, true),
			C("tempo_consegna_valore", "Tempo di consegna", "testo", 50, true)),   // testo libero, es. "2 settimane"
		F("ruo", "RUO — Approvazione", "RUO", "attesa_approvazione", null,
			Interno("data_approvazione"), Interno("disponibile_mese"), Interno("note_ruo")),
		// RDA: si fa la richiesta di acquisto; si passa all'ordine solo con la spunta "Rilascio RDA"
		F("ricambi_rda", "Team Ricambi — RDA", "TeamRicambi", "accettata", "rda_rilasciata",
			C("numero_rda", "Numero RDA", "testo", 50, true),
			C("data_rda", "Data RDA", "data", 0, true),
			C("rilascio_rda", "Rilascio RDA", "bool", 0, true)),
		F("ricambi_ordine", "Team Ricambi — Ordine", "TeamRicambi", "rda_rilasciata", "attesa_consegna",
			C("numero_ordine", "Numero ordine", "testo", 50, true),
			C("data_ordine", "Data ordine", "data", 0, true),
			C("data_consegna_fornitore", "Data consegna fornitore", "data", 0, true),
			C("in_ritardo", "Pezzo in ritardo", "bool", 0, false),
			Se(C("data_ritardo", "Data consegna ritardo", "data", 0, true), "in_ritardo", true)),
		F("ricambi_4", "Team Ricambi — Rientro", "TeamRicambi", "attesa_consegna", "consegnato_magazzino",
			C("bolla_rientro", "Bolla di rientro", "testo", 50, true),
			C("data_rientro_effettiva", "Data rientro", "data", 0, true),
			C("entrata_merci_sap", "Entrata merci a SAP", "testo", 50, true)),
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

	// La pratica va in Laboratorio Elettrotecnico? (valore nuovo se c'e', altrimenti quello salvato)
	private static bool Lab(Dictionary<string, object> row, Dictionary<string, object> valori)
	{
		object v = valori != null && valori.ContainsKey("tipo_riparazione") ? valori["tipo_riparazione"] : (row == null ? null : row["tipo_riparazione"]);
		return (v as string) == LabElettro;
	}

	private static bool Lab(Dictionary<string, object> row)
	{
		return Lab(row, null);
	}

	// Con il Laboratorio Elettrotecnico le fasi tra il Magazzino e il Rientro non si fanno
	private static bool Saltata(Fase f, bool lab)
	{
		int i = Indice(f.Key);
		return lab && i > Indice("magazzino_1") && i < Indice("ricambi_4");
	}

	// Indice della fase su cui si deve agire ora. Rifiutato si ferma sulla fase RUO; chiuso = tutto completato.
	private static int IndiceCorrente(string stato)
	{
		if (stato == "rifiutato") return Indice("ruo");
		for (int i = 0; i < Fasi.Length; i++) if (Fasi[i].Stato == stato) return i;
		return Fasi.Length;
	}

	// "completata", "attiva", "futura" o "saltata" (Laboratorio Elettrotecnico)
	private static string StatoFase(Fase f, string stato, bool lab)
	{
		if (Saltata(f, lab)) return "saltata";
		if (f.Key == "manutentori") return stato == "in_magazzino" ? "attiva" : "completata";
		if (stato == "rifiutato" && f.Key == "ruo") return "completata";
		int i = Indice(f.Key);
		int cur = IndiceCorrente(stato);
		if (i < cur) return "completata";
		if (i == cur) return "attiva";
		return "futura";
	}

	// La fase dopo ha gia' dati? Se si', chi ha compilato questa fase non la puo' piu' toccare (solo Admin).
	// Le fasi saltate (Laboratorio Elettrotecnico) non contano: si guarda la prima fase che si fa davvero.
	private static bool SuccessivaHaDati(Fase f, Dictionary<string, object> row)
	{
		bool lab = Lab(row);
		int j = Indice(f.Key) + 1;
		while (j < Fasi.Length && Saltata(Fasi[j], lab)) j++;
		if (j >= Fasi.Length) return false;
		Fase s = Fasi[j];
		string stato = (string)row["stato"];
		if (s.Key == "ruo") return stato == "rifiutato" || IndiceCorrente(stato) > j; // il RUO ha gia' deciso
		if (s.Campi.Length == 0) return IndiceCorrente(stato) > j;
		foreach (Campo c in s.Campi) if (HaDato(row[c.Nome])) return true;
		return false;
	}

	private static bool PuoModificare(Fase f, Dictionary<string, object> row, Utente u)
	{
		string st = StatoFase(f, (string)row["stato"], Lab(row));
		if (st == "futura" || st == "saltata") return false;
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

		// Budget e ruoli del Repair Tracker
		public bool IsAdminRepair
		{
			get { return IsAdmin || Contiene(AdminRepair); }
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

			// gestione utenti: solo database del login
			if (action == "utenti") { RichiediAdminRepair(u); Utenti(context, u); return; }
			if (action == "utenti_ruoli")
			{
				RichiediAdminRepair(u);
				Dictionary<string, object> b = LeggiPost(context);
				UtentiRuoli(context, u, Int(b, "id"), IntList(b, "ruoli"));
				return;
			}

			using (SqlConnection cn = Open(DataConnection))
			{
				if (action == "elenco") { Elenco(context, cn, u); return; }
				if (action == "pratica") { Pratica(context, cn, IdDaQuery(req)); return; }
				if (action == "budget") { RichiediAdminRepair(u); BudgetMese(context, cn, IntDaQuery(req, "anno"), IntDaQuery(req, "mese")); return; }

				Dictionary<string, object> body = LeggiPost(context);

				if (action == "crea") Crea(context, cn, u, Dict(body, "campi"));
				else if (action == "salva") Salva(context, cn, u, Int(body, "id"), Str(body, "card"), Dict(body, "campi"), BoolOpt(body, "conferma"));
				else if (action == "avanza") Avanza(context, cn, u, Int(body, "id"), Str(body, "card"), Dict(body, "campi"));
				else if (action == "decidi") Decidi(context, cn, u, Int(body, "id"), Str(body, "esito"));
				else if (action == "elimina") Elimina(context, cn, u, Int(body, "id"));
				else if (action == "budget_salva") { RichiediAdminRepair(u); BudgetSalva(context, cn, u, Int(body, "anno"), Int(body, "mese"), Dict(body, "importi")); }
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

	private static Dictionary<string, object> LeggiPost(HttpContext ctx)
	{
		if (ctx.Request.HttpMethod != "POST" || ctx.Request.Headers["X-Portale"] != "1") throw new UserException("Richiesta non valida.");
		return ReadJson(ctx);
	}

	private static void RichiediAdminRepair(Utente u)
	{
		if (!u.IsAdminRepair) throw new ForbiddenException("Questa sezione è riservata al ruolo " + AdminRepair + ".");
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

		if (!u.HaUno(RuoliAccesso())) throw new ForbiddenException("Non hai un ruolo per il Repair Tracker. Chiedilo a un amministratore.");
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

		// menu a tendina: aree (UO) con i loro centri di costo, tipi di guasto
		List<object> aree = new List<object>();
		foreach (Area a in UoCentri)
		{
			List<object> centri = new List<object>();
			foreach (string[] c in a.Centri)
			{
				Dictionary<string, object> x = new Dictionary<string, object>();
				x["codice"] = c[0];
				x["descrizione"] = c[1];
				centri.Add(x);
			}
			Dictionary<string, object> ad = new Dictionary<string, object>();
			ad["nome"] = a.Nome;
			ad["centri"] = centri;
			aree.Add(ad);
		}
		Dictionary<string, object> opzioni = new Dictionary<string, object>();
		opzioni["aree"] = aree;
		opzioni["tipiGuasto"] = TipiGuasto;

		// budget del mese corrente di tutte le aree (coda RUO)
		DateTime oggi = DateTime.Today;
		Dictionary<string, object> budget = new Dictionary<string, object>();
		foreach (string a in Aree()) budget[a] = BudgetPerJson(LeggiBudget(cn, null, a, oggi.Year, oggi.Month, 0));

		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["io"] = io;
		d["opzioni"] = opzioni;
		d["budget"] = budget;
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
		string area = row["area"] as string;
		if (!string.IsNullOrEmpty(area))
		{
			DateTime oggi = DateTime.Today;
			d["budget"] = BudgetPerJson(LeggiBudget(cn, null, area, oggi.Year, oggi.Month, id));
		}
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
		ControllaCentro(f, null, valori);
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

			StringBuilder colonne = new StringBuilder("numero_pratica, stato, creato_da, creato_nome");
			StringBuilder param = new StringBuilder("@numero, N'in_magazzino', @da, @nome");
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
				cmd.Parameters.Add("@nome", SqlDbType.NVarChar, 150).Value = (object)Cut(u.Nome, 150) ?? DBNull.Value;
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
			ControllaCentro(f, row, valori);
			bool completa = Completa(f, row, valori);

			// Fase gia' superata con un campo obbligatorio svuotato, oppure Magazzino che entra o esce dal
			// Laboratorio Elettrotecnico (cambia il percorso): la pratica torna a questa fase
			// e i dati delle fasi successive vengono cancellati (come nella vecchia app).
			bool cambioPercorso = f.Key == "magazzino_1" && Lab(row) != Lab(row, valori);
			bool regressione = (!completa || cambioPercorso) && f.Stato != null && stato != f.Stato;

			if (!completa && f.Key == "manutentori")
				throw new UserException("Compila tutti i campi obbligatori.");

			if (regressione && !conferma)
			{
				Dictionary<string, object> q = new Dictionary<string, object>();
				q["ok"] = false;
				q["regressione"] = true;
				q["message"] = (cambioPercorso && completa
					? "Cambiando il tipo di riparazione cambia il percorso della pratica: tornerà a questa fase e tutti i dati "
					: "Rimuovendo questo campo obbligatorio, la pratica regredirà a questa fase e tutti i dati ") +
					"compilati nelle fasi successive verranno eliminati definitivamente. Continuare?";
				Reply(ctx, q);
				return;
			}

			string cambiati = Cambiati(f, row, valori);
			string nuovoStato = null;
			if (regressione)
			{
				// si svuotano anche i campi interni (approvazione RUO): l'importo torna nel budget del mese
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
			if (StatoFase(f, (string)row["stato"], Lab(row)) != "attiva")
				throw new UserException("La pratica è già andata avanti. Ricarica la pagina.");
			if (!PuoModificare(f, row, u)) throw new ForbiddenException("Questa fase la compila " + f.Ruolo + ".");

			Dictionary<string, object> valori = Valori(f, campi);
			if (!Completa(f, row, valori))
				throw new UserException(f.Key == "ricambi_rda" && !Vero(Get(valori, "rilascio_rda")) && !Vero(row["rilascio_rda"])
					? "Per passare all'ordine serve la spunta \"Rilascio RDA\"."
					: "Compila tutti i campi obbligatori.");

			// Laboratorio Elettrotecnico: dal Magazzino si va direttamente al Rientro (Team Ricambi)
			bool salto = f.Key == "magazzino_1" && Lab(row, valori);
			string avanti = salto ? Fasi[Indice("ricambi_4")].Stato : f.Avanti;

			if (Aggiorna(cn, tx, id, valori, avanti, f.Stato) == 0)
				throw new UserException("La pratica è stata modificata da un altro utente. Ricarica la pagina.");
			Log(cn, tx, id, avanti, "Avanzamento", f.Titolo + " confermata" +
				(salto ? " — " + LabElettro + ": si passa direttamente al rientro" : ""), u);
			tx.Commit();
		}
		Ok(ctx);
	}

	// Il RUO approva o rifiuta. Approvando, il preventivo si scala dal budget dell'area nel mese corrente:
	// si salvano la data di approvazione e il disponibile che c'era prima (per lo storico della pratica).
	private static void Decidi(HttpContext ctx, SqlConnection cn, Utente u, int id, string esito)
	{
		if (esito != "accettata" && esito != "rifiutato") throw new UserException("Richiesta non valida.");

		using (SqlTransaction tx = cn.BeginTransaction())
		{
			Dictionary<string, object> row = CaricaRiga(cn, tx, id);
			string stato = (string)row["stato"];

			// RUO (o Admin) decide quando la pratica e' in attesa di approvazione;
			// solo l'Admin puo' cambiare la decisione, e solo finche' nessuno e' andato avanti.
			bool ok = (stato == "attesa_approvazione" && PuoApprovare(u, row)) ||
			          (u.IsAdmin && (stato == "accettata" || stato == "rifiutato"));
			if (!ok) throw new ForbiddenException("Non puoi approvare o rifiutare questa pratica: è dell'area " + (row["area"] as string ?? "—") + ".");
			if (stato == esito) throw new UserException("La pratica è già " + (esito == "accettata" ? "accettata." : "rifiutata."));

			Dictionary<string, object> valori = new Dictionary<string, object>();
			string dettaglio = null;
			if (esito == "accettata")
			{
				DateTime ora = DateTime.Now;
				string area = row["area"] as string;
				decimal preventivo = row["preventivo"] == DBNull.Value ? 0m : (decimal)row["preventivo"];
				Budget b = string.IsNullOrEmpty(area) ? null : LeggiBudget(cn, tx, area, ora.Year, ora.Month, id);
				object disponibile = (b != null && b.Importo.HasValue) ? (object)(b.Importo.Value - b.Approvato) : DBNull.Value;
				valori["data_approvazione"] = ora;
				valori["disponibile_mese"] = disponibile;
				dettaglio = "Preventivo " + Euro(preventivo) + " — " + (disponibile == DBNull.Value
					? "budget " + NomeMese(ora.Year, ora.Month) + " non impostato per " + (area ?? "—")
					: "disponibile " + NomeMese(ora.Year, ora.Month) + " prima: " + Euro((decimal)disponibile) +
					  ", dopo: " + Euro((decimal)disponibile - preventivo));
			}
			else
			{
				valori["data_approvazione"] = DBNull.Value;   // se era stata approvata, l'importo torna nel budget
				valori["disponibile_mese"] = DBNull.Value;
			}

			if (Aggiorna(cn, tx, id, valori, esito, stato) == 0)
				throw new UserException("La pratica è stata modificata da un altro utente. Ricarica la pagina.");
			Log(cn, tx, id, esito, esito == "accettata" ? "Approvata" : "Rifiutata", dettaglio, u);
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

	// ================= budget mensile per area =================

	private class Budget
	{
		public string Area;
		public int Anno;
		public int Mese;
		public decimal? Importo;    // null = non impostato
		public decimal Approvato;   // preventivi delle pratiche dell'area approvate nel mese
		public int Pratiche;
	}

	// pratiche dell'area approvate nel mese (una pratica rifiutata o tornata indietro non ha data_approvazione)
	private const string Approvate =
		"WHERE area = @a AND data_approvazione >= @da AND data_approvazione < @a2 AND stato <> N'rifiutato' AND id <> @id";

	// Budget di un'area in un mese. escludiId: pratica da non contare (quella che si sta approvando).
	private static Budget LeggiBudget(SqlConnection cn, SqlTransaction tx, string area, int anno, int mese, int escludiId)
	{
		Budget b = new Budget();
		b.Area = area; b.Anno = anno; b.Mese = mese;
		DateTime da = new DateTime(anno, mese, 1);
		using (SqlCommand cmd = new SqlCommand(
			"SELECT (SELECT importo FROM dbo.BudgetAree WHERE area = @a AND anno = @y AND mese = @m), " +
			"(SELECT ISNULL(SUM(preventivo), 0) FROM dbo.Riparazioni " + Approvate + "), " +
			"(SELECT COUNT(*) FROM dbo.Riparazioni " + Approvate + ")", cn, tx))
		{
			cmd.Parameters.Add("@a", SqlDbType.NVarChar, 50).Value = area;
			cmd.Parameters.Add("@y", SqlDbType.SmallInt).Value = anno;
			cmd.Parameters.Add("@m", SqlDbType.TinyInt).Value = mese;
			cmd.Parameters.Add("@da", SqlDbType.DateTime2).Value = da;
			cmd.Parameters.Add("@a2", SqlDbType.DateTime2).Value = da.AddMonths(1);
			cmd.Parameters.Add("@id", SqlDbType.Int).Value = escludiId;
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				r.Read();
				b.Importo = r.IsDBNull(0) ? (decimal?)null : r.GetDecimal(0);
				b.Approvato = r.GetDecimal(1);
				b.Pratiche = r.GetInt32(2);
			}
		}
		return b;
	}

	private static Dictionary<string, object> BudgetPerJson(Budget b)
	{
		Dictionary<string, object> x = new Dictionary<string, object>();
		x["area"] = b.Area;
		x["anno"] = b.Anno;
		x["mese"] = b.Mese;
		x["importo"] = b.Importo;
		x["approvato"] = b.Approvato;
		x["pratiche"] = b.Pratiche;
		x["disponibile"] = b.Importo.HasValue ? (object)(b.Importo.Value - b.Approvato) : null;
		return x;
	}

	private static void ControllaMese(int anno, int mese)
	{
		if (anno < 2020 || anno > 2100 || mese < 1 || mese > 12) throw new UserException("Mese non valido.");
	}

	private static void BudgetMese(HttpContext ctx, SqlConnection cn, int anno, int mese)
	{
		ControllaMese(anno, mese);
		List<object> aree = new List<object>();
		foreach (string a in Aree()) aree.Add(BudgetPerJson(LeggiBudget(cn, null, a, anno, mese, 0)));
		Dictionary<string, object> d = new Dictionary<string, object>();
		d["ok"] = true;
		d["anno"] = anno;
		d["mese"] = mese;
		d["aree"] = aree;
		Reply(ctx, d);
	}

	// importi: { area: numero } imposta, { area: null o "" } toglie il budget. Le aree non presenti non cambiano.
	private static void BudgetSalva(HttpContext ctx, SqlConnection cn, Utente u, int anno, int mese, Dictionary<string, object> importi)
	{
		ControllaMese(anno, mese);
		Campo euro = C("importo", "Budget", "decimale", 0, false);
		List<string> aree = new List<string>(Aree());
		using (SqlTransaction tx = cn.BeginTransaction())
		{
			foreach (KeyValuePair<string, object> kv in importi)
			{
				if (!aree.Contains(kv.Key)) throw new UserException("Area sconosciuta: " + kv.Key + ".");
				euro.Etichetta = "Budget " + kv.Key;
				object v = Valore(euro, kv.Value);
				string sql = v == DBNull.Value
					? "DELETE FROM dbo.BudgetAree WHERE area = @a AND anno = @y AND mese = @m"
					: "MERGE dbo.BudgetAree AS t USING (SELECT @a AS area, @y AS anno, @m AS mese) AS s " +
					  "ON t.area = s.area AND t.anno = s.anno AND t.mese = s.mese " +
					  "WHEN MATCHED THEN UPDATE SET importo = @i, modificato_da = @u, modificato_il = SYSDATETIME() " +
					  "WHEN NOT MATCHED THEN INSERT (area, anno, mese, importo, modificato_da) VALUES (@a, @y, @m, @i, @u);";
				using (SqlCommand cmd = new SqlCommand(sql, cn, tx))
				{
					cmd.Parameters.Add("@a", SqlDbType.NVarChar, 50).Value = kv.Key;
					cmd.Parameters.Add("@y", SqlDbType.SmallInt).Value = anno;
					cmd.Parameters.Add("@m", SqlDbType.TinyInt).Value = mese;
					SqlParameter pi = cmd.Parameters.Add("@i", SqlDbType.Decimal);
					pi.Precision = 12; pi.Scale = 2; pi.Value = v;
					cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = (object)u.Username ?? DBNull.Value;
					cmd.ExecuteNonQuery();
				}
			}
			tx.Commit();
		}
		BudgetMese(ctx, cn, anno, mese);
	}

	private static string Euro(decimal v)
	{
		return v.ToString(v == decimal.Truncate(v) ? "#,##0" : "#,##0.00", It) + " €";
	}

	private static string NomeMese(int anno, int mese)
	{
		return It.DateTimeFormat.GetMonthName(mese) + " " + anno.ToString(Inv);
	}

	// ================= gestione utenti (solo ruoli del Repair Tracker) =================

	// Id dei ruoli gestibili presenti in PortaleLogin, nell'ordine di RuoliGestibili()
	private static List<KeyValuePair<int, string>> IdRuoliGestibili(SqlConnection cn)
	{
		Dictionary<string, int> perNome = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
		using (SqlCommand cmd = new SqlCommand("SELECT Id, Nome FROM dbo.Ruoli", cn))
		using (SqlDataReader r = cmd.ExecuteReader())
		{
			while (r.Read()) perNome[r.GetString(1)] = r.GetInt32(0);
		}
		List<KeyValuePair<int, string>> l = new List<KeyValuePair<int, string>>();
		foreach (string nome in RuoliGestibili())
			if (perNome.ContainsKey(nome)) l.Add(new KeyValuePair<int, string>(perNome[nome], nome));
		return l;
	}

	private static void Utenti(HttpContext ctx, Utente io)
	{
		using (SqlConnection cn = Open(LoginConnection))
		{
			List<KeyValuePair<int, string>> gestibili = IdRuoliGestibili(cn);
			List<int> ids = new List<int>();
			List<object> ruoli = new List<object>();
			foreach (KeyValuePair<int, string> kv in gestibili)
			{
				ids.Add(kv.Key);
				Dictionary<string, object> x = new Dictionary<string, object>();
				x["id"] = kv.Key;
				x["nome"] = kv.Value;
				x["modificabile"] = kv.Value != AdminRepair || io.IsAdmin;
				ruoli.Add(x);
			}

			Dictionary<int, List<int>> assegnati = new Dictionary<int, List<int>>();
			using (SqlCommand cmd = new SqlCommand("SELECT UserId, RuoloId FROM dbo.UtentiRuoli", cn))
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				while (r.Read())
				{
					int uid = r.GetInt32(0), rid = r.GetInt32(1);
					if (!ids.Contains(rid)) continue;   // gli altri ruoli del Portale qui non si vedono
					if (!assegnati.ContainsKey(uid)) assegnati[uid] = new List<int>();
					assegnati[uid].Add(rid);
				}
			}

			List<object> utenti = new List<object>();
			using (SqlCommand cmd = new SqlCommand("SELECT Id, Username, NomeCompleto, Attivo FROM dbo.Utenti ORDER BY NomeCompleto, Username", cn))
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				while (r.Read())
				{
					int uid = r.GetInt32(0);
					Dictionary<string, object> x = new Dictionary<string, object>();
					x["id"] = uid;
					x["username"] = r.GetString(1);
					x["nome"] = r.IsDBNull(2) ? r.GetString(1) : r.GetString(2);
					x["attivo"] = r.GetBoolean(3);
					x["ruoli"] = assegnati.ContainsKey(uid) ? assegnati[uid] : new List<int>();
					utenti.Add(x);
				}
			}

			Dictionary<string, object> d = new Dictionary<string, object>();
			d["ok"] = true;
			d["ruoli"] = ruoli;
			d["utenti"] = utenti;
			Reply(ctx, d);
		}
	}

	// Sostituisce i ruoli del Repair Tracker dell'utente con quelli indicati. Gli altri ruoli del Portale restano.
	// "Admin Repair" lo puo' dare o togliere solo l'Admin.
	private static void UtentiRuoli(HttpContext ctx, Utente io, int userId, List<int> richiesti)
	{
		using (SqlConnection cn = Open(LoginConnection))
		{
			List<KeyValuePair<int, string>> gestibili = IdRuoliGestibili(cn);
			List<int> ids = new List<int>();
			int idAdminRepair = -1;
			foreach (KeyValuePair<int, string> kv in gestibili)
			{
				ids.Add(kv.Key);
				if (kv.Value == AdminRepair) idAdminRepair = kv.Key;
			}
			foreach (int r in richiesti)
				if (!ids.Contains(r)) throw new UserException("Ruolo non previsto per il Repair Tracker.");

			string username;
			List<int> attuali = new List<int>();
			using (SqlCommand cmd = new SqlCommand("SELECT Username FROM dbo.Utenti WHERE Id = @id", cn))
			{
				cmd.Parameters.Add("@id", SqlDbType.Int).Value = userId;
				username = cmd.ExecuteScalar() as string;
			}
			if (username == null) throw new UserException("Utente non trovato. Ricarica la pagina.");
			using (SqlCommand cmd = new SqlCommand("SELECT RuoloId FROM dbo.UtentiRuoli WHERE UserId = @id", cn))
			{
				cmd.Parameters.Add("@id", SqlDbType.Int).Value = userId;
				using (SqlDataReader r = cmd.ExecuteReader()) { while (r.Read()) attuali.Add(r.GetInt32(0)); }
			}

			if (!io.IsAdmin && idAdminRepair >= 0 && attuali.Contains(idAdminRepair) != richiesti.Contains(idAdminRepair))
				throw new ForbiddenException("Il ruolo " + AdminRepair + " lo può dare o togliere solo un amministratore.");

			using (SqlTransaction tx = cn.BeginTransaction())
			{
				foreach (int rid in ids)
				{
					bool ha = attuali.Contains(rid), vuole = richiesti.Contains(rid);
					if (ha == vuole) continue;
					string sql = vuole
						? "INSERT INTO dbo.UtentiRuoli (UserId, RuoloId, AssegnatoDa) VALUES (@u, @r, @da)"
						: "DELETE FROM dbo.UtentiRuoli WHERE UserId = @u AND RuoloId = @r";
					using (SqlCommand cmd = new SqlCommand(sql, cn, tx))
					{
						cmd.Parameters.Add("@u", SqlDbType.Int).Value = userId;
						cmd.Parameters.Add("@r", SqlDbType.Int).Value = rid;
						cmd.Parameters.Add("@da", SqlDbType.NVarChar, 50).Value = (object)io.Username ?? DBNull.Value;
						cmd.ExecuteNonQuery();
					}
				}
				tx.Commit();
			}

			// registro accessi del Portale (come Gestione utenti): un errore qui non annulla la modifica
			try
			{
				using (SqlCommand cmd = new SqlCommand(
					"INSERT INTO dbo.AccessiLog (UserId, Username, Evento, Indirizzo, Dettaglio) " +
					"SELECT Id, Username, N'Gestione', @ip, @d FROM dbo.Utenti WHERE Username = @u", cn))
				{
					cmd.Parameters.Add("@u", SqlDbType.NVarChar, 50).Value = (object)io.Username ?? DBNull.Value;
					cmd.Parameters.Add("@ip", SqlDbType.NVarChar, 45).Value = (object)Cut(ctx.Request.UserHostAddress, 45) ?? DBNull.Value;
					cmd.Parameters.Add("@d", SqlDbType.NVarChar, 200).Value = Cut("Ruoli Repair Tracker di " + username + " cambiati", 200);
					cmd.ExecuteNonQuery();
				}
			}
			catch (Exception)
			{
			}
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
			if (c == null || c.Tipo == "interno") throw new UserException("Campo non previsto: " + nome + ".");
			valori[c.Nome] = Valore(c, campi[nome]);
		}
		// campo condizionato: se la condizione non c'e' piu', il campo si svuota
		// (es. niente "Pezzo in ritardo" -> niente data ritardo; tipo diverso dal laboratorio -> niente previsione)
		foreach (Campo c in f.Campi)
			if (c.SeCampo != null && valori.ContainsKey(c.SeCampo) && !Uguale(valori[c.SeCampo], c.SeValore))
				valori[c.Nome] = DBNull.Value;
		return valori;
	}

	private static object Valore(Campo c, object v)
	{
		if (c.Tipo == "bool")
		{
			if (v is bool) return (bool)v;
			string b = v == null ? "" : Convert.ToString(v, Inv).Trim().ToLowerInvariant();
			return b == "true" || b == "1";
		}
		if (v == null) return DBNull.Value;
		string s = v is string ? ((string)v).Trim() : Convert.ToString(v, Inv);
		if (s.Length == 0) return DBNull.Value;

		switch (c.Tipo)
		{
			case "testo":
			case "maiuscolo":
			case "centro":
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

	// Il centro di costo deve essere uno di quelli dell'area (UO). Si usano i valori nuovi, oppure quelli gia' salvati.
	private static void ControllaCentro(Fase f, Dictionary<string, object> row, Dictionary<string, object> valori)
	{
		if (f.Key != "manutentori") return;
		if (!valori.ContainsKey("area") && !valori.ContainsKey("centro_costo")) return;
		object area = valori.ContainsKey("area") ? valori["area"] : (row == null ? null : row["area"]);
		object centro = valori.ContainsKey("centro_costo") ? valori["centro_costo"] : (row == null ? null : row["centro_costo"]);
		if (!HaValore(centro)) return; // se e' obbligatorio, lo dice gia' il controllo dei campi obbligatori
		if (!HaValore(area) || !CentriDi((string)area).Contains((string)centro))
			throw new UserException("Il centro di costo \"" + centro + "\" non appartiene all'area scelta. Sceglilo di nuovo.");
	}

	// I campi obbligatori della fase sono compilati (valori nuovi, oppure quelli gia' nel database)?
	private static bool Completa(Fase f, Dictionary<string, object> row, Dictionary<string, object> valori)
	{
		foreach (Campo c in f.Campi)
		{
			if (!c.Obbligatorio) continue;
			if (c.SeCampo != null && !Uguale(valori.ContainsKey(c.SeCampo) ? valori[c.SeCampo] : row[c.SeCampo], c.SeValore)) continue;
			object v = valori.ContainsKey(c.Nome) ? valori[c.Nome] : row[c.Nome];
			if (c.Tipo == "bool" ? !Vero(v) : !HaValore(v)) return false;   // una spunta obbligatoria deve essere messa
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
		if (v is bool) return (bool)v ? "1" : "";
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

	// Come HaValore, ma una spunta tolta (false) non conta come dato compilato
	private static bool HaDato(object v)
	{
		if (v is bool) return (bool)v;
		return HaValore(v);
	}

	private static bool Vero(object v)
	{
		return v is bool && (bool)v;
	}

	// valore del campo uguale a quello atteso (true per le spunte, un testo per i menu)
	private static bool Uguale(object v, object atteso)
	{
		if (atteso is bool) return Vero(v) == (bool)atteso;
		return string.Equals(v as string, atteso as string, StringComparison.Ordinal);
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

	private static readonly string[] ColonneConOra = { "creato_il", "modificato_il", "data_approvazione" };

	private static Dictionary<string, object> PerJson(Dictionary<string, object> row)
	{
		Dictionary<string, object> x = new Dictionary<string, object>();
		foreach (KeyValuePair<string, object> kv in row)
		{
			object v = kv.Value;
			if (v == DBNull.Value) v = null;
			else if (v is DateTime)
				v = ((DateTime)v).ToString(Array.IndexOf(ColonneConOra, kv.Key) >= 0 ? "yyyy-MM-dd HH:mm" : "yyyy-MM-dd", Inv);
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

		// database delle pratiche: tabelle e colonne di tutti gli aggiornamenti
		try
		{
			using (SqlConnection cn = Open(DataConnection))
			{
				d["database"] = cn.Database;
				string[][] richiesti = {
					new string[] { "01", "T:Riparazioni", "T:RiparazioniLog" },
					new string[] { "02", "C:op", "C:creato_nome" },
					new string[] { "03", "C:disponibile_mese" },
					new string[] { "04", "C:in_ritardo", "C:data_approvazione", "T:BudgetAree" },
					new string[] { "06", "C:numero_preventivo", "C:data_rda", "C:rilascio_rda", "C:numero_ordine", "C:previsione_riparazione" }
				};
				foreach (string[] agg in richiesti)
				{
					for (int i = 1; i < agg.Length; i++)
					{
						string nome = agg[i].Substring(2);
						string sql = agg[i][0] == 'T'
							? "SELECT COUNT(*) FROM sys.tables WHERE name = @n"
							: "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.Riparazioni') AND name = @n";
						using (SqlCommand cmd = new SqlCommand(sql, cn))
						{
							cmd.Parameters.Add("@n", SqlDbType.NVarChar, 128).Value = nome;
							if ((int)cmd.ExecuteScalar() == 0 && (string)d["status"] == "ok")
							{
								d["status"] = "da aggiornare";
								d["message"] = "Manca " + nome + ": eseguire gli script SQL fino a RepairTracker_" + agg[0] + " in SSMS.";
							}
						}
					}
				}
				if ((string)d["status"] == "ok")
					using (SqlCommand cmd = new SqlCommand("SELECT COUNT(*) FROM dbo.Riparazioni", cn))
						d["pratiche"] = (int)cmd.ExecuteScalar();
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
			List<string> presenti = new List<string>();
			using (SqlConnection cn = Open(LoginConnection))
			using (SqlCommand cmd = new SqlCommand("SELECT Nome FROM dbo.Ruoli", cn))
			using (SqlDataReader r = cmd.ExecuteReader())
			{
				while (r.Read()) presenti.Add(r.GetString(0).ToLowerInvariant());
			}
			List<string> mancanti = new List<string>();
			foreach (string ruolo in RuoliAccesso())
				if (ruolo != Admin && !presenti.Contains(ruolo.ToLowerInvariant())) mancanti.Add(ruolo);
			d["ruoliMancanti"] = mancanti;
			if (mancanti.Count > 0 && (string)d["status"] == "ok")
			{
				d["status"] = "ruoli mancanti";
				d["message"] = "Eseguire SQL/RepairTracker_04_aree_budget_ritardo.sql in SSMS (mancano: " + string.Join(", ", mancanti.ToArray()) + ").";
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
		return IntDaQuery(req, "id");
	}

	private static int IntDaQuery(HttpRequest req, string nome)
	{
		int v;
		if (!int.TryParse(req.QueryString[nome], NumberStyles.None, Inv, out v)) throw new UserException("Richiesta non valida.");
		return v;
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

	// solo numeri interi
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
