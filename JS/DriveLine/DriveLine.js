(function () {
	"use strict";

	const API = "API/DriveLine.ashx";
	const VERSIONE = "0.1.0";
	const CHIAVE_CONN = "dl_conn_v1";
	const CHIAVE_SQL = "dl_sql_v1_";

	const $ = (s, root) => (root || document).querySelector(s);
	const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));
	const esc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	const numIt = n => Number(n).toLocaleString("it-IT");
	const durata = ms => ms < 1000 ? ms + " ms" : (ms / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 }) + " s";

	const MODELLI = {
		oracle: [
			{ nome: "Oracle – server:porta/servizio", dialetto: "oracle", porta: "1521", testo: "Data Source={SERVER}:{PORTA}/{DATABASE};User Id={UTENTE};Password={PASSWORD};Connection Timeout={TIMEOUT}" }
		],
		odbc: [
			{ nome: "Oracle (driver ODBC di Oracle)", dialetto: "oracle", porta: "1521", testo: "Driver={Oracle in OraClient19Home1};Dbq={SERVER}:{PORTA}/{DATABASE};Uid={UTENTE};Pwd={PASSWORD};" },
			{ nome: "IBM i / AS400 (IBM i Access)", dialetto: "db2", porta: "", testo: "Driver={IBM i Access ODBC Driver};System={SERVER};DefaultLibraries={DATABASE};Uid={UTENTE};Pwd={PASSWORD};" },
			{ nome: "DB2 (IBM DB2 ODBC)", dialetto: "db2", porta: "50000", testo: "Driver={IBM DB2 ODBC DRIVER};Database={DATABASE};Hostname={SERVER};Port={PORTA};Protocol=TCPIP;Uid={UTENTE};Pwd={PASSWORD};" },
			{ nome: "SQL Server (ODBC Driver 17)", dialetto: "sqlserver", porta: "1433", testo: "Driver={ODBC Driver 17 for SQL Server};Server={SERVER},{PORTA};Database={DATABASE};Uid={UTENTE};Pwd={PASSWORD};TrustServerCertificate=yes;" },
			{ nome: "DSN di sistema (già configurato sul server)", dialetto: "odbc", porta: "", testo: "DSN=NOME_DEL_DSN;Uid={UTENTE};Pwd={PASSWORD};" }
		],
		oledb: [
			{ nome: "Oracle (OraOLEDB)", dialetto: "oracle", porta: "1521", testo: "Provider=OraOLEDB.Oracle;Data Source={SERVER}:{PORTA}/{DATABASE};User Id={UTENTE};Password={PASSWORD};" },
			{ nome: "IBM i / AS400 (IBMDA400)", dialetto: "db2", porta: "", testo: "Provider=IBMDA400;Data Source={SERVER};User Id={UTENTE};Password={PASSWORD};" },
			{ nome: "SQL Server (MSOLEDBSQL)", dialetto: "sqlserver", porta: "1433", testo: "Provider=MSOLEDBSQL;Data Source={SERVER},{PORTA};Initial Catalog={DATABASE};User ID={UTENTE};Password={PASSWORD};" }
		]
	};
	const PORTA_STANDARD = { sqlserver: "1433", oracle: "1521" };

	const COLONNE_GAN = `    ACT_CENTER_CODE     AS CDA,
    WORK_CENTER_CODE    AS LINEA,
    ASSEMBLY_ORDER_NBR  AS GAN,
    LTRIM(PARTNBR)      AS DISEGNO,
    USER_CDA            AS CDA_U,
    BUSINESS_NUMBER     AS COC_CLIENTE,
    DUE_ALLOTMENT_DATE  AS DPA_MOBILE,
    DUE_DATE            AS DPI_MOBILE,
    CALC_ONLINE_DATE    AS DPI_TIRO,
    ACTUAL_ONLINE_DATE  AS DATA_IMPOST,
    ACT_ALLOTMENT_DATE  AS DATA_ASSEGNAZIONE,
    PROGRESS_STATUS     AS STATO,
    PROGRESS_SUBSTATUS  AS SOT_STATO,
    ORDER_IDN           AS TIPO_ORDINE,
    ORDER_NUMBER        AS NUMERO_ORDINE,
    ORDER_LINE          AS LINEA_ORDINE,
    ANNULL_FLG,`;

	const QUERY = [
		{
			id: "0005", tipo: "sorgente", titolo: "Crea GAN_DRIVELINE_1", salva: "GAN_DRIVELINE_1",
			descr: "GAN dei CDA costruttori assegnati da inizio anno, o non ancora assegnati. In Access era «SELECT … INTO»: qui «Esegui e salva» svuota e ricarica GAN_DRIVELINE_1. La colonna Chiave (Val del GAN) la calcola la pagina.",
			sql: `SELECT
${COLONNE_GAN}
    ANNULL_DATE,
    CALC_ALLOT_DATE     AS DP_SPED,
    ACT_ALLOTMENT_DATE  AS DATA_SPED,
    DATA_EFFETT_DISLIN,
    LAST_UPDATE_DATE,
    SERIAL_NO           AS MATRICOLA,
    DATA_EFFETT_DELIB,
    DATA_RILASCIO_LEV3
FROM {FI_GAN_L4}
WHERE ACT_CENTER_CODE IN {CDA_COSTRUTTORI}
  AND (ACT_ALLOTMENT_DATE >= {INIZIO_ANNO} OR ACT_ALLOTMENT_DATE IS NULL)`,
			originale: `SELECT Val([ASSEMBLY_ORDER_NBR]) AS Chiave, FI_GAN_L4.ACT_CENTER_CODE AS CDA, … LTrim([PARTNBR]) AS DISEGNO, …
       FI_GAN_L4.SERIAL_NO AS Matricola, FI_GAN_L4.DATA_EFFETT_DELIB, FI_GAN_L4.DATA_RILASCIO_LEV3
INTO GAN_DRIVELINE_1
FROM FI_GAN_L4 INNER JOIN [CDA-COSTRUTTORI] ON FI_GAN_L4.ACT_CENTER_CODE = [CDA-COSTRUTTORI].CDA
WHERE ((FI_GAN_L4.ACT_ALLOTMENT_DATE) >= CVDate("01/01/" & Year(Date())) OR (FI_GAN_L4.ACT_ALLOTMENT_DATE) IS NULL);`
		},
		{
			id: "0010", tipo: "sorgente", titolo: "Crea GAN_DRIVELINE_Ant_Sped", salva: "GAN_DRIVELINE_Ant_Sped",
			descr: "Spedizioni anticipate: data prevista di spedizione quest'anno, spedite l'anno scorso. «Year(x) = Year(Date())» è diventato «x dal 1/1 al 31/12», che il database risolve con gli indici. Anno_DP_SPED e Anno_DATA_SPED le calcola il DB di test.",
			sql: `SELECT
${COLONNE_GAN}
    CALC_ALLOT_DATE     AS DP_SPED,
    ACT_ALLOTMENT_DATE  AS DATA_SPED,
    DATA_EFFETT_DISLIN,
    LAST_UPDATE_DATE,
    DATA_EFFETT_DELIB,
    DATA_RILASCIO_LEV3
FROM {FI_GAN_L4}
WHERE ACT_CENTER_CODE IN {CDA_COSTRUTTORI}
  AND CALC_ALLOT_DATE    >= {INIZIO_ANNO}      AND CALC_ALLOT_DATE    < {INIZIO_ANNO_SUCC}
  AND ACT_ALLOTMENT_DATE >= {INIZIO_ANNO_PREC} AND ACT_ALLOTMENT_DATE < {INIZIO_ANNO}`,
			originale: `SELECT FI_GAN_L4.ACT_CENTER_CODE AS CDA, … Year([CALC_ALLOT_DATE]) AS Anno_DP_SPED, Year([ACT_ALLOTMENT_DATE]) AS Anno_DATA_SPED, …
INTO GAN_DRIVELINE_Ant_Sped
FROM FI_GAN_L4 INNER JOIN [CDA-COSTRUTTORI] ON FI_GAN_L4.ACT_CENTER_CODE = [CDA-COSTRUTTORI].CDA
WHERE (((Year([CALC_ALLOT_DATE])) = Year(Date())) AND ((Year([ACT_ALLOTMENT_DATE])) = Year(Date()) -1));`
		},
		{
			id: "0015", tipo: "locale", titolo: "Accoda Ant_Sped a GAN_DRIVELINE_1",
			descr: "Lavora solo sul DB di test. Si rifiuta se le righe sono già state accodate (per rifare: prima di nuovo la 0005 con «Esegui e salva»).",
			sql: `INSERT INTO GAN_DRIVELINE_1 (CDA, LINEA, GAN, DISEGNO, CDA_U, COC_CLIENTE, DPA_MOBILE, DPI_MOBILE, DPI_TIRO,
       DATA_IMPOST, DATA_ASSEGNAZIONE, STATO, SOT_STATO, TIPO_ORDINE, NUMERO_ORDINE, LINEA_ORDINE, ANNULL_FLG,
       DP_SPED, DATA_SPED, DATA_EFFETT_DISLIN, LAST_UPDATE_DATE, DATA_EFFETT_DELIB, DATA_RILASCIO_LEV3, Origine)
SELECT …stesse colonne…, '0015'
FROM GAN_DRIVELINE_Ant_Sped`,
			originale: `INSERT INTO GAN_DRIVELINE_1 (CDA, LINEA, GAN, …, DATA_EFFETT_DELIB, DATA_RILASCIO_LEV3)
SELECT GAN_DRIVELINE_Ant_Sped.CDA, …, GAN_DRIVELINE_Ant_Sped.DATA_RILASCIO_LEV3
FROM GAN_DRIVELINE_Ant_Sped;`
		},
		{
			id: "S35", codice: "Stato35", tipo: "sorgente", titolo: "Legge N09J0121_DLT (per Stato35)", salva: "N09J0121_DLT",
			descr: "In Access Stato35 è una query su N09J0121_DLT con Stato < 95; nel DB di test è una vista che fa lo stesso filtro. Qui si legge tutta la tabella. Se N09J0121_DLT non è nel database ma è il file DLT.TXT, usa la sezione 4.",
			sql: `SELECT Cda, Linea, Tipo_Ordine, Gan, Disegno, Matricola, Cda_U, Cod_Cliente,
       Data_Imp, Data_Dis_Lin, Data_Finiz, Data_Sped, Stato, Sotto_Stato,
       Data_Ult_Var, Ora_Ult_Var, Polmone, Data_Seq, Num_Seq, Data_Ord
FROM {N09J0121_DLT}`,
			originale: `SELECT N09J0121_DLT.Cda, N09J0121_DLT.Linea, …, N09J0121_DLT.Data_Ord
FROM N09J0121_DLT
WHERE (((N09J0121_DLT.Stato) < 95));`
		},
		{
			id: "0020", tipo: "locale", titolo: "Aggiorna GAN_DRIVELINE_1 da Stato35",
			descr: "Lavora solo sul DB di test. Dice anche quanti GAN si trovano in tutte e due le tabelle: se sono zero, il GAN è scritto in modo diverso (es. con la G davanti).",
			sql: `UPDATE g SET g.DATA_IMPOST = s.Data_Imp, g.STATO = s.Stato
FROM GAN_DRIVELINE_1 g INNER JOIN Stato35 s ON g.GAN = s.Gan
WHERE g.STATO < s.Stato`,
			originale: `UPDATE GAN_DRIVELINE_1 INNER JOIN Stato35 ON GAN_DRIVELINE_1.GAN = Stato35.Gan
SET GAN_DRIVELINE_1.DATA_IMPOST = [Stato35]![Data_Imp], GAN_DRIVELINE_1.STATO = [Stato35]![Stato]
WHERE ((([GAN_DRIVELINE_1]![STATO])<[Stato35]![Stato]));`
		}
	];

	const TABELLE_TEST = ["GAN_DRIVELINE_1", "GAN_DRIVELINE_Ant_Sped", "N09J0121_DLT", "Stato35", "CDA_COSTRUTTORI"];

	async function api(action, opzioni) {
		const o = opzioni || {};
		let url = API + "?action=" + encodeURIComponent(action);
		Object.keys(o.query || {}).forEach(k => { url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(o.query[k]); });
		const init = { credentials: "same-origin", cache: "no-store" };
		if (o.body !== undefined) {
			init.method = "POST";
			init.headers = { "Content-Type": "application/json", "X-Portale": "1" };
			init.body = JSON.stringify(o.body);
		}
		let res;
		try {
			res = await fetch(url, init);
		} catch (e) {
			throw new Error("Il server del Portale non risponde. Controlla la rete e riprova.");
		}
		if (res.redirected) {
			window.location.href = "Login.html?ReturnUrl=" + encodeURIComponent(window.location.pathname);
			throw new Error("Sessione scaduta.");
		}
		const testo = await res.text();
		try {
			return JSON.parse(testo);
		} catch (e) {
			if (res.status === 404) throw new Error("API/DriveLine.ashx non trovato sul server: il file va copiato nella cartella API del Portale.");
			if (/compil|CS\d{4}/i.test(testo)) throw new Error("API/DriveLine.ashx non si compila sul server: apri l'indirizzo API/DriveLine.ashx?health=1 nel browser per vedere l'errore.");
			if (res.status === 413 || /maxRequestLength|exceeded/i.test(testo)) throw new Error("Richiesta troppo grande per IIS: manca nel Web.config la sezione <location path=\"API/DriveLine.ashx\"> del LEGGIMI.");
			throw new Error("Risposta non valida dal server (" + res.status + ").");
		}
	}

	let toastTimer = null;
	function avviso(testo, errore) {
		const t = $("#dl-toast");
		t.textContent = testo;
		t.classList.toggle("is-error", !!errore);
		t.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => { t.hidden = true; }, errore ? 7000 : 3000);
	}

	function htmlDiagnosi(d) {
		if (!d) return "";
		const fare = (d.fare || []).filter(Boolean);
		return `<div class="dl-diag">
			<div class="dl-diag-titolo"><i class="bi bi-lightbulb"></i>${esc(d.titolo)}</div>
			${d.cosa ? `<p>${esc(d.cosa)}</p>` : ""}
			${fare.length ? `<div class="dl-diag-fare">Cosa fare</div><ul>${fare.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
			${d.tecnico ? `<details class="dl-tecnico"><summary>Messaggio tecnico</summary><pre>${esc(d.tecnico)}</pre></details>` : ""}
		</div>`;
	}

	function htmlErrore(messaggio, diagnosi) {
		return `<div class="dl-alert dl-alert-danger"><i class="bi bi-x-octagon"></i><div><strong>${esc(messaggio || "Operazione non riuscita.")}</strong>${htmlDiagnosi(diagnosi)}</div></div>`;
	}

	function htmlOk(testo, extra) {
		return `<div class="dl-alert dl-alert-success"><i class="bi bi-check-circle"></i><div>${testo}${extra || ""}</div></div>`;
	}

	function htmlAttenzione(testo, extra) {
		return `<div class="dl-alert dl-alert-warning"><i class="bi bi-exclamation-triangle"></i><div>${testo}${extra || ""}</div></div>`;
	}

	function cella(v, col) {
		if (v === null || v === undefined) return `<td class="dl-null">NULL</td>`;
		if (typeof v === "number") return `<td class="dl-n">${esc(String(v).replace(".", ","))}</td>`;
		if (typeof v === "boolean") return `<td>${v ? "sì" : "no"}</td>`;
		const s = String(v);
		const vis = s.replace(/ /g, "·");
		const mostraSpazi = /^\s|\s$/.test(s);
		return `<td${mostraSpazi ? ' class="dl-spazi" title="Il valore ha spazi all\'inizio o alla fine"' : ""}>${esc(mostraSpazi ? vis : s)}</td>`;
	}

	function htmlTabella(colonne, righe) {
		if (!colonne || colonne.length === 0) return `<p class="dl-nota">Nessuna colonna.</p>`;
		const testa = colonne.map(c => `<th title="${esc((c.tipoDb || "") + (c.tipo ? " → " + c.tipo : ""))}">${esc(c.nome)}${c.tipoDb ? `<small>${esc(c.tipoDb.toLowerCase())}</small>` : ""}</th>`).join("");
		const corpo = (righe || []).length === 0
			? `<tr><td colspan="${colonne.length + 1}" class="dl-vuoto">Nessuna riga.</td></tr>`
			: righe.map((r, i) => `<tr><td class="dl-nriga">${i + 1}</td>${r.map((v, j) => cella(v, colonne[j])).join("")}</tr>`).join("");
		return `<div class="dl-table-wrap"><table class="dl-table"><thead><tr><th class="dl-nriga">#</th>${testa}</tr></thead><tbody>${corpo}</tbody></table></div>`;
	}

	function tipoSql(c) {
		const dim = c.dimensione, p = c.precisione, s = c.scala;
		switch (c.tipo) {
			case "String": return "nvarchar(" + (dim > 0 && dim <= 4000 ? dim : dim > 4000 ? "max" : 255) + ")";
			case "Int16": return "smallint";
			case "Int32": return "int";
			case "Int64": return "bigint";
			case "Byte": return "tinyint";
			case "Boolean": return "bit";
			case "Decimal": {
				let pp = p > 0 && p <= 38 ? p : 38;
				let ss = s >= 0 && s <= pp ? s : 10;
				if (!(p > 0 && p <= 38)) ss = s > 0 && s <= 38 ? s : 10;
				if (pp === 38 && ss === 0 && !(p > 0)) ss = 10;
				return "decimal(" + pp + "," + ss + ")";
			}
			case "Double": return "float";
			case "Single": return "real";
			case "DateTime": return "datetime2(0)";
			case "DateTimeOffset": return "datetimeoffset(0)";
			case "TimeSpan": return "time(0)";
			case "Guid": return "uniqueidentifier";
			case "Byte[]": return "varbinary(max)";
			default: return "nvarchar(255)";
		}
	}

	function createTable(nome, colonne) {
		const larg = Math.max(...colonne.map(c => c.nome.length)) + 2;
		const righe = colonne.map(c => "\t" + ("[" + c.nome + "]").padEnd(larg + 2) + " " + tipoSql(c).padEnd(16) + " NULL");
		return "CREATE TABLE dbo." + nome + " (\n" + righe.join(",\n") + "\n);";
	}

	function leggiConn() {
		return {
			tipo: $("#c-tipo").value,
			dialetto: $("#c-dialetto").value,
			server: $("#c-server").value.trim(),
			istanza: $("#c-istanza").value.trim(),
			porta: $("#c-porta").value.trim(),
			database: $("#c-database").value.trim(),
			utente: $("#c-utente").value.trim(),
			password: $("#c-password").value,
			windows: $("#c-windows").checked,
			encrypt: $("#c-encrypt").checked,
			trust: $("#c-trust").checked,
			stringa: $("#c-stringa").value.trim(),
			timeoutConn: $("#c-timeout-conn").value.trim(),
			timeoutQuery: $("#c-timeout-query").value.trim()
		};
	}

	function leggiTabelle() {
		return { gan: $("#t-gan").value.trim(), dlt: $("#t-dlt").value.trim(), cda: $("#t-cda").value.trim() };
	}

	function salvaConn() {
		const c = leggiConn();
		delete c.password;
		c.tabelle = leggiTabelle();
		try { localStorage.setItem(CHIAVE_CONN, JSON.stringify(c)); } catch (e) { }
	}

	function caricaConn() {
		let c = null;
		try { c = JSON.parse(localStorage.getItem(CHIAVE_CONN) || "null"); } catch (e) { }
		if (!c) return;
		const metti = (id, v) => { if (v !== undefined && v !== null) $(id).value = v; };
		metti("#c-tipo", c.tipo); metti("#c-dialetto", c.dialetto); metti("#c-server", c.server);
		metti("#c-istanza", c.istanza); metti("#c-porta", c.porta); metti("#c-database", c.database);
		metti("#c-utente", c.utente); metti("#c-stringa", c.stringa);
		metti("#c-timeout-conn", c.timeoutConn); metti("#c-timeout-query", c.timeoutQuery);
		$("#c-windows").checked = !!c.windows; $("#c-encrypt").checked = !!c.encrypt; $("#c-trust").checked = c.trust !== false;
		if (c.tabelle) { metti("#t-gan", c.tabelle.gan); metti("#t-dlt", c.tabelle.dlt); metti("#t-cda", c.tabelle.cda); }
	}

	function aggiornaCampiTipo(cambiato) {
		const tipo = $("#c-tipo").value;
		$$(".dl-solo").forEach(el => { el.hidden = !el.dataset.tipi.split(",").includes(tipo); });
		$("#c-porta").placeholder = PORTA_STANDARD[tipo] || (tipo === "webconfig" ? "solo per la prova di rete" : "facoltativa");
		$("#c-database-etichetta").textContent = tipo === "oracle" ? "Servizio Oracle (service name)" : tipo === "odbc" || tipo === "oledb" ? "Database / libreria" : "Database";
		const sel = $("#c-modello");
		sel.innerHTML = `<option value="">Modelli…</option>` + (MODELLI[tipo] || []).map((m, i) => `<option value="${i}">${esc(m.nome)}</option>`).join("");
		const pwd = $("#c-windows").checked && tipo === "sqlserver";
		$("#c-utente").disabled = pwd; $("#c-password").disabled = pwd;
		if (cambiato) {
			if (tipo === "sqlserver" || tipo === "oracle") $("#c-dialetto").value = tipo;
			if (tipo === "oracle" && !$("#c-stringa").value.trim()) $("#c-stringa").value = MODELLI.oracle[0].testo;
		}
	}

	function scegliModello() {
		const tipo = $("#c-tipo").value;
		const m = (MODELLI[tipo] || [])[$("#c-modello").value];
		if (!m) return;
		$("#c-stringa").value = m.testo;
		$("#c-dialetto").value = m.dialetto;
		if (m.porta && !$("#c-porta").value.trim()) $("#c-porta").value = m.porta;
		$("#c-modello").value = "";
		salvaConn();
	}

	function statoConn(testo, classe) {
		const b = $("#dl-conn-stato");
		b.textContent = testo;
		b.className = "dl-badge" + (classe ? " dl-badge-" + classe : "");
	}

	const ICONE = { ok: "bi-check-circle-fill", ko: "bi-x-circle-fill", avviso: "bi-exclamation-triangle-fill", salto: "bi-dash-circle" };

	function htmlPassi(data) {
		const passi = data.passi || [];
		const primoKo = passi.find(p => p.esito === "ko");
		let testa;
		if (data.riuscito) testa = htmlOk("<strong>Collegamento riuscito e tabelle leggibili.</strong> Ora prova le query nella sezione 2.");
		else if (primoKo) testa = `<div class="dl-alert dl-alert-danger"><i class="bi bi-x-octagon"></i><div><strong>Si ferma qui: ${esc(primoKo.nome)}.</strong> ${esc(primoKo.diagnosi ? primoKo.diagnosi.titolo : primoKo.testo)}</div></div>`;
		else testa = htmlAttenzione("<strong>Collegamento riuscito, con qualche avviso.</strong> Leggi i passi in giallo.");
		const lista = passi.map(p => `<li class="dl-passo dl-passo-${esc(p.esito)}">
				<i class="bi ${ICONE[p.esito] || "bi-circle"}"></i>
				<div class="dl-passo-corpo">
					<div class="dl-passo-riga"><strong>${esc(p.nome)}</strong>${p.ms !== undefined ? `<span class="dl-ms">${durata(p.ms)}</span>` : ""}</div>
					<div class="dl-passo-testo">${esc(p.testo)}</div>
					${p.diagnosi ? htmlDiagnosi(p.diagnosi) : ""}
					${p.colonne ? `<details class="dl-dettagli-sm"><summary>Colonne della tabella (${p.colonne.length})</summary><div class="dl-colonne">${p.colonne.map(c => `<code>${esc(c)}</code>`).join(" ")}</div></details>` : ""}
				</div>
			</li>`).join("");
		return testa + `<ol class="dl-passi">${lista}</ol>` +
			(data.stringa ? `<details class="dl-dettagli-sm"><summary>Stringa di connessione usata (password nascosta)</summary><pre class="dl-pre">${esc(data.stringa)}</pre></details>` : "");
	}

	async function provaCollegamento() {
		salvaConn();
		const btn = $("#dl-prova");
		btn.disabled = true;
		$("#dl-prova-attesa").hidden = false;
		statoConn("prova in corso…", "attesa");
		$("#dl-passi").innerHTML = "";
		try {
			const data = await api("test", { body: { conn: leggiConn(), tabelle: leggiTabelle() } });
			if (data.ok === false) {
				$("#dl-passi").innerHTML = htmlErrore(data.message, data.diagnosi);
				statoConn("dati mancanti", "ko");
				return;
			}
			$("#dl-passi").innerHTML = htmlPassi(data);
			const ko = (data.passi || []).some(p => p.esito === "ko");
			statoConn(data.riuscito ? "collegato" : ko ? (data.passi.some(p => p.nome === "Accesso al database" && p.esito === "ok") ? "collegato, con errori" : "non collegato") : "collegato, con avvisi", data.riuscito ? "ok" : ko ? "ko" : "avviso");
		} catch (e) {
			$("#dl-passi").innerHTML = htmlErrore(e.message);
			statoConn("errore", "ko");
		} finally {
			btn.disabled = false;
			$("#dl-prova-attesa").hidden = true;
		}
	}

	async function infoServer() {
		const box = $("#dl-info");
		box.innerHTML = `<p class="dl-nota"><span class="dl-spinner"></span> Lettura…</p>`;
		try {
			const d = await api("info");
			if (d.ok === false) { box.innerHTML = htmlErrore(d.message, d.diagnosi); return; }
			const lista = (titolo, l, nota) => `<div class="dl-info-blocco"><h4>${esc(titolo)}</h4>${nota ? `<p class="dl-nota">${esc(nota)}</p>` : ""}${(l && l.length) ? `<ul>${l.map(x => `<li><code>${esc(x)}</code></li>`).join("")}</ul>` : `<p class="dl-nota">nessuno</p>`}</div>`;
			box.innerHTML = `<div class="dl-info">
				<div class="dl-info-chip"><span>Server del Portale</span><strong>${esc(d.computer)}</strong></div>
				<div class="dl-info-chip"><span>IP (da dare a chi apre il firewall)</span><strong>${esc(d.ip)}</strong></div>
				<div class="dl-info-chip"><span>Utente del pool IIS</span><strong>${esc(d.utentePool || "?")}</strong></div>
				<div class="dl-info-chip"><span>Processo</span><strong>${esc(d.bit)} bit · .NET ${esc(d.dotnet)}</strong></div>
				<div class="dl-info-chip"><span>DriveLineSorgente nel Web.config</span><strong>${d.sorgenteWebConfig ? "sì" : "no"}</strong></div>
			</div>
			<div class="dl-info-griglia">
				${lista("Driver ODBC usabili (" + d.bit + " bit)", d.driverOdbc, "Il nome dopo Driver= deve essere uno di questi, identico.")}
				${lista("Driver ODBC a " + (d.bit === 64 ? 32 : 64) + " bit (NON usabili dal Portale)", d.driverOdbcAltri)}
				${lista("DSN di sistema", d.dsnSistema)}
				${lista("Provider OLE DB", d.providerOledb)}
				${lista("Provider .NET", d.providerNet, "Oracle via .NET: deve esserci Oracle.ManagedDataAccess.Client.")}
			</div>`;
		} catch (e) {
			box.innerHTML = htmlErrore(e.message);
		}
	}

	function testoSalvato(q) {
		try { return localStorage.getItem(CHIAVE_SQL + q.id); } catch (e) { return null; }
	}

	function disegnaQuery() {
		$("#dl-query").innerHTML = QUERY.map(q => {
			const codice = q.codice || q.id;
			const tag = q.tipo === "sorgente"
				? `<span class="dl-tag dl-tag-sorgente"><i class="bi bi-cloud-download"></i>sorgente → ${esc(q.salva)}</span>`
				: `<span class="dl-tag dl-tag-locale"><i class="bi bi-database"></i>solo DB di test</span>`;
			const sql = q.tipo === "sorgente" ? (testoSalvato(q) || q.sql) : q.sql;
			const modificata = q.tipo === "sorgente" && testoSalvato(q) && testoSalvato(q) !== q.sql;
			const azioni = q.tipo === "sorgente"
				? `<label class="dl-mini">Righe da mostrare <input type="text" inputmode="numeric" class="dl-max" value="200"></label>
				   <label class="dl-mini"><input type="checkbox" class="dl-conta" checked> conta tutte le righe</label>
				   <span class="dl-spazio"></span>
				   <button type="button" class="dl-btn dl-btn-outline dl-btn-sm" data-azione="ripristina" ${modificata ? "" : "hidden"}><i class="bi bi-arrow-counterclockwise"></i>Testo originale</button>
				   <button type="button" class="dl-btn dl-btn-outline dl-btn-sm" data-azione="esegui"><i class="bi bi-play"></i>Esegui (anteprima)</button>
				   <button type="button" class="dl-btn dl-btn-primary dl-btn-sm" data-azione="salva"><i class="bi bi-database-down"></i>Esegui e salva in ${esc(q.salva)}</button>`
				: `<span class="dl-spazio"></span>
				   <button type="button" class="dl-btn dl-btn-primary dl-btn-sm" data-azione="locale"><i class="bi bi-play"></i>Esegui nel DB di test</button>`;
			return `<article class="dl-q" data-id="${esc(q.id)}">
				<header class="dl-q-head">
					<span class="dl-q-codice">${esc(codice)}</span>
					<h3>${esc(q.titolo)}</h3>
					${tag}
				</header>
				<p class="dl-q-descr">${esc(q.descr)}</p>
				<textarea class="dl-sql" spellcheck="false" ${q.tipo === "locale" ? "readonly" : ""} rows="${Math.min(22, sql.split("\n").length + 1)}">${esc(sql)}</textarea>
				<details class="dl-dettagli-sm"><summary>Query originale di Access</summary><pre class="dl-pre">${esc(q.originale)}</pre></details>
				<div class="dl-q-azioni">${azioni}</div>
				<div class="dl-q-out"></div>
			</article>`;
		}).join("");
	}

	function htmlSalvataggio(s) {
		if (!s) return "";
		const avvisi = [];
		if (s.colonneIgnorate && s.colonneIgnorate.length) avvisi.push(`Colonne della query che ${esc(s.tabella || "la tabella")} non ha (non salvate): ${s.colonneIgnorate.map(c => `<code>${esc(c)}</code>`).join(" ")}`);
		if (s.colonneMancanti && s.colonneMancanti.length) avvisi.push(`Colonne della tabella che la query non dà (restano vuote): ${s.colonneMancanti.map(c => `<code>${esc(c)}</code>`).join(" ")}`);
		const extra = avvisi.length ? `<ul class="dl-lista-avvisi">${avvisi.map(a => `<li>${a}</li>`).join("")}</ul>` : "";
		if (s.salvato) {
			return htmlOk(`<strong>Salvate ${numIt(s.righe)} righe in ${esc(s.tabella)}</strong> (ne aveva ${numIt(s.cancellatePrima)}, sostituite).`, extra);
		}
		let errori = "";
		if (s.errori && s.errori.length) {
			errori = `<div class="dl-table-wrap dl-table-errori"><table class="dl-table"><thead><tr><th>Riga</th><th>Colonna</th><th>Valore</th><th>Problema</th></tr></thead><tbody>` +
				s.errori.map(e => `<tr><td class="dl-n">${esc(e.riga)}</td><td><code>${esc(e.colonna)}</code></td>${cella(e.valore)}<td>${esc(e.motivo)}</td></tr>`).join("") +
				`</tbody></table></div>` + (s.nErrori > s.errori.length ? `<p class="dl-nota">…e altri ${numIt(s.nErrori - s.errori.length)}.</p>` : "") +
				`<p class="dl-nota">Si corregge allargando la colonna (o cambiandone il tipo) in <code>SQL/DriveLine_01_database.sql</code>, oppure convertendo il valore nella query.</p>`;
		}
		return `<div class="dl-alert dl-alert-danger"><i class="bi bi-x-octagon"></i><div><strong>${esc(s.message || "Salvataggio non riuscito.")}</strong>${htmlDiagnosi(s.diagnosi)}${errori}${extra}</div></div>`;
	}

	function htmlRisultato(d, q, salva) {
		if (d.ok === false) {
			return htmlErrore(d.message, d.diagnosi) +
				(d.sql ? `<details class="dl-dettagli-sm"><summary>SQL inviata al database</summary><pre class="dl-pre">${esc(d.sql)}</pre></details>` : "");
		}
		const chip = (etichetta, valore) => `<span class="dl-chip"><span>${esc(etichetta)}</span><strong>${valore}</strong></span>`;
		const totale = d.completo ? numIt(d.totale) : "almeno " + numIt(d.totale);
		const nCol = (d.colonne || []).length;
		const vuota = d.totale === 0;
		let html = `<div class="dl-chips">
				${chip("Righe", totale)}
				${chip("Colonne", nCol)}
				${chip("Query", durata(d.msQuery))}
				${chip("Totale", durata(d.ms))}
				${chip("Mostrate", numIt((d.righe || []).length))}
			</div>`;
		if (vuota) html += htmlAttenzione("<strong>La query funziona ma non restituisce righe.</strong> Collegamento e permessi sono a posto: controlla il filtro (elenco CDA, anno, formato delle date).");
		if (!d.completo) html += `<p class="dl-nota">Conteggio fermato: togli la spunta «conta tutte le righe» per non contarle, o alza il «Timeout query».</p>`;
		if (salva) html += htmlSalvataggio(d.salvataggio);
		html += htmlTabella(d.colonne, d.righe);
		html += `<details class="dl-dettagli-sm"><summary>SQL inviata al database</summary><pre class="dl-pre">${esc(d.sql)}</pre></details>`;
		if (nCol) html += `<details class="dl-dettagli-sm"><summary>Tipi delle colonne e CREATE TABLE suggerita</summary>
				<div class="dl-table-wrap"><table class="dl-table dl-table-tipi"><thead><tr><th>Colonna</th><th>Tipo nel sorgente</th><th>Tipo .NET</th><th>Dimensione</th><th>Precisione</th><th>Scala</th><th>Tipo SQL Server</th></tr></thead><tbody>
				${d.colonne.map(c => `<tr><td><code>${esc(c.nome)}</code></td><td>${esc(c.tipoDb)}</td><td>${esc(c.tipo)}</td><td class="dl-n">${esc(c.dimensione ?? "")}</td><td class="dl-n">${esc(c.precisione ?? "")}</td><td class="dl-n">${esc(c.scala ?? "")}</td><td><code>${esc(tipoSql(c))}</code></td></tr>`).join("")}
				</tbody></table></div>
				<pre class="dl-pre">${esc(createTable(q.salva || "NUOVA_TABELLA", d.colonne))}</pre>
				<button type="button" class="dl-btn dl-btn-outline dl-btn-sm" data-azione="copia-create"><i class="bi bi-clipboard"></i>Copia</button>
			</details>`;
		return html;
	}

	function confermaSulBottone(btn, testo) {
		if (btn.dataset.conferma === "1") { btn.dataset.conferma = ""; clearTimeout(btn._t); btn.innerHTML = btn._html; return true; }
		btn._html = btn.innerHTML;
		btn.dataset.conferma = "1";
		btn.innerHTML = `<i class="bi bi-question-circle"></i>${esc(testo)}`;
		btn._t = setTimeout(() => { btn.dataset.conferma = ""; btn.innerHTML = btn._html; }, 5000);
		return false;
	}

	async function eseguiQuery(art, salva, btn) {
		const q = QUERY.find(x => x.id === art.dataset.id);
		const out = $(".dl-q-out", art);
		if (salva && !confermaSulBottone(btn, "Svuota e ricarica " + q.salva + "? Clicca di nuovo")) return;
		salvaConn();
		const bottoni = $$(".dl-q-azioni button", art);
		bottoni.forEach(b => { b.disabled = true; });
		out.innerHTML = `<p class="dl-attesa"><span class="dl-spinner"></span>${salva ? "Lettura e salvataggio" : "Esecuzione"} in corso…</p>`;
		try {
			const d = await api("query", {
				body: {
					conn: leggiConn(), tabelle: leggiTabelle(),
					sql: $(".dl-sql", art).value,
					max: parseInt($(".dl-max", art).value, 10) || 200,
					contaTutte: $(".dl-conta", art).checked,
					salva: salva ? q.salva : ""
				}
			});
			out.innerHTML = htmlRisultato(d, q, salva);
			if (salva) aggiornaStatoTest();
		} catch (e) {
			out.innerHTML = htmlErrore(e.message);
		} finally {
			bottoni.forEach(b => { b.disabled = false; });
		}
	}

	async function eseguiLocale(art, btn) {
		const out = $(".dl-q-out", art);
		btn.disabled = true;
		out.innerHTML = `<p class="dl-attesa"><span class="dl-spinner"></span>Esecuzione nel DB di test…</p>`;
		try {
			const d = await api("locale", { body: { passo: art.dataset.id } });
			if (d.ok === false) { out.innerHTML = htmlErrore(d.message, d.diagnosi); return; }
			const numeri = (d.numeri || []).map(n => `<span class="dl-chip"><span>${esc(n.etichetta)}</span><strong>${numIt(n.valore)}</strong></span>`).join("");
			let esempi = "";
			if (d.esempi) {
				esempi = `<div class="dl-esempi">${Object.keys(d.esempi).map(k => `<div><h4>${esc(k)}</h4>${(d.esempi[k] || []).map(g => `<code>${esc(g)}</code>`).join(" ") || "—"}</div>`).join("")}</div>`;
			}
			out.innerHTML = `<div class="dl-chips">${numeri}</div>` + (d.avviso ? htmlAttenzione(esc(d.testo), esempi) : htmlOk(esc(d.testo)));
			aggiornaStatoTest();
		} catch (e) {
			out.innerHTML = htmlErrore(e.message);
		} finally {
			btn.disabled = false;
		}
	}

	async function aggiornaStatoTest() {
		const b = $("#dl-test-stato");
		try {
			const res = await fetch(API + "?health=1", { credentials: "same-origin", cache: "no-store" });
			const d = await res.json();
			if (d.status === "ok") {
				b.className = "dl-badge dl-badge-ok";
				b.textContent = "pronto";
				b.title = Object.keys(d.righe || {}).map(k => k + ": " + numIt(d.righe[k]) + " righe").join("\n");
			} else {
				b.className = "dl-badge dl-badge-ko";
				b.textContent = d.status;
				b.title = d.message || "";
				if (!aggiornaStatoTest.avvisato) { aggiornaStatoTest.avvisato = true; avviso("Database di test: " + (d.message || d.status), true); }
			}
			$$("#dl-tabelle-btn button").forEach(btn => {
				const n = d.righe ? d.righe[btn.dataset.tabella] : undefined;
				$(".dl-conta-righe", btn).textContent = n === undefined ? "" : numIt(n);
			});
		} catch (e) {
			b.className = "dl-badge dl-badge-ko";
			b.textContent = "non raggiungibile";
		}
	}

	async function caricaCda() {
		try {
			const d = await api("cda");
			if (d.ok === false) { $("#dl-cda-info").textContent = d.message; return; }
			$("#dl-cda").value = d.elenco.map(x => x.cda + (x.descrizione ? ";" + x.descrizione : "")).join("\n");
			$("#dl-cda-info").textContent = d.elenco.length ? d.elenco.length + " CDA nell'elenco." : "Elenco vuoto: le query 0005 e 0010 non partono finché non lo riempi.";
		} catch (e) {
			$("#dl-cda-info").textContent = e.message;
		}
	}

	async function salvaCda() {
		const btn = $("#dl-cda-salva");
		btn.disabled = true;
		try {
			const d = await api("cda_salva", { body: { righe: $("#dl-cda").value.split(/\r?\n/) } });
			if (d.ok === false) { avviso(d.message, true); return; }
			$("#dl-cda").value = d.elenco.map(x => x.cda + (x.descrizione ? ";" + x.descrizione : "")).join("\n");
			$("#dl-cda-info").textContent = "Salvato: " + d.elenco.length + " CDA.";
			avviso("Elenco CDA salvato.");
			aggiornaStatoTest();
		} catch (e) {
			avviso(e.message, true);
		} finally {
			btn.disabled = false;
		}
	}

	async function vediTabella(tabella) {
		const box = $("#dl-vedi");
		box.innerHTML = `<p class="dl-attesa"><span class="dl-spinner"></span>Lettura di ${esc(tabella)}…</p>`;
		try {
			const d = await api("vedi", { query: { tabella: tabella, max: 200 } });
			if (d.ok === false) { box.innerHTML = htmlErrore(d.message, d.diagnosi); return; }
			box.innerHTML = `<h3 class="dl-h3">${esc(d.tabella)} <span class="dl-nota">${numIt(d.totale)} righe${d.totale > d.righe.length ? ", mostrate le prime " + numIt(d.righe.length) : ""}</span>
				<button type="button" class="dl-btn dl-btn-outline dl-btn-sm" data-chiudi-vedi><i class="bi bi-x-lg"></i>Chiudi</button></h3>` + htmlTabella(d.colonne, d.righe);
		} catch (e) {
			box.innerHTML = htmlErrore(e.message);
		}
	}

	let righeDlt = null;

	function leggiFile(file) {
		return new Promise((ok, ko) => {
			const fr = new FileReader();
			fr.onload = () => ok(String(fr.result));
			fr.onerror = () => ko(new Error("Non riesco a leggere il file."));
			fr.readAsText(file, "windows-1252");
		});
	}

	function htmlDlt(d) {
		if (d.ok === false) return htmlErrore(d.message, d.diagnosi);
		const chip = (e, v) => `<span class="dl-chip"><span>${esc(e)}</span><strong>${v}</strong></span>`;
		let html = `<div class="dl-chips">
			${chip("Righe nel file", numIt(d.righeFile))}
			${chip("Lette bene", numIt(d.righeLette))}
			${chip("Errori", numIt(d.nErrori))}
			${chip("In Stato35 (Stato < 95)", numIt(d.righeStato35))}
			${chip("GAN diversi", numIt(d.ganDistinti))}
			${chip("GAN ripetuti", numIt(d.ganRipetuti))}
		</div>`;
		if (d.salvataggio) html += htmlSalvataggio(d.salvataggio);
		if (d.nErrori > 0) {
			html += `<div class="dl-alert dl-alert-danger"><i class="bi bi-x-octagon"></i><div><strong>${numIt(d.nErrori)} valori non si leggono: il caricamento è bloccato.</strong>
				<div class="dl-table-wrap dl-table-errori"><table class="dl-table"><thead><tr><th>Riga</th><th>Campo</th><th>Testo</th><th>Problema</th></tr></thead><tbody>
				${d.errori.map(e => `<tr><td class="dl-n">${esc(e.riga)}</td><td><code>${esc(e.colonna)}</code></td>${cella(e.valore)}<td>${esc(e.motivo)}</td></tr>`).join("")}
				</tbody></table></div></div></div>`;
		}
		html += `<div class="dl-griglia-2">
			<div><h4 class="dl-h4">Righe per stato</h4><div class="dl-stati">${(d.stati || []).map(s => `<span class="dl-stato${s.stato < 95 ? " is-35" : ""}"><strong>${esc(s.stato)}</strong>${numIt(s.righe)}</span>`).join("")}</div>
				<p class="dl-nota">In evidenza quelli che finiscono in Stato35 (sotto 95).</p></div>
			<div><h4 class="dl-h4">Intestazione (posizioni 1-10, non salvata)</h4>${(d.testate || []).map(t => `<code>${esc(t.testata)}</code> ${numIt(t.righe)} righe`).join("<br>")}</div>
		</div>`;
		html += `<details class="dl-dettagli-sm" open><summary>Tracciato usato (posizioni da 1) — Cda, Linea e Tipo_Ordine da confermare</summary>
			<div class="dl-tracciato">${(d.tracciato || []).map(t => `<span><code>${esc(t.nome)}</code> ${t.da}–${t.a}${t.tipo !== "testo" ? " · " + esc(t.tipo) : ""}</span>`).join("")}</div></details>`;
		html += `<h4 class="dl-h4">Prime righe lette</h4>` + htmlTabella(d.colonne, d.righe);
		return html;
	}

	async function anteprimaDlt(file) {
		const out = $("#dl-dlt-out");
		$("#dl-dlt-nome").textContent = file.name + " (" + numIt(Math.round(file.size / 1024)) + " KB)";
		$("#dl-dlt-carica").disabled = true;
		$("#dl-dlt-attesa").hidden = false;
		out.innerHTML = "";
		try {
			const testo = await leggiFile(file);
			righeDlt = testo.split(/\r?\n/).map(r => r.replace(/\s+$/, "")).filter(r => r.length > 0);
			const d = await api("dlt_anteprima", { body: { righe: righeDlt } });
			out.innerHTML = htmlDlt(d);
			$("#dl-dlt-carica").disabled = !(d.ok !== false && d.nErrori === 0 && d.righeLette > 0);
		} catch (e) {
			out.innerHTML = htmlErrore(e.message);
		} finally {
			$("#dl-dlt-attesa").hidden = true;
		}
	}

	async function caricaDlt() {
		const btn = $("#dl-dlt-carica");
		if (!righeDlt) return;
		if (!confermaSulBottone(btn, "Svuota e ricarica N09J0121_DLT? Clicca di nuovo")) return;
		btn.disabled = true;
		$("#dl-dlt-attesa").hidden = false;
		try {
			const d = await api("dlt_carica", { body: { righe: righeDlt } });
			$("#dl-dlt-out").innerHTML = htmlDlt(d);
			aggiornaStatoTest();
		} catch (e) {
			$("#dl-dlt-out").innerHTML = htmlErrore(e.message);
		} finally {
			btn.disabled = false;
			$("#dl-dlt-attesa").hidden = true;
		}
	}

	function aggiornaBottoneTema() {
		const chiaro = document.documentElement.getAttribute("data-tema") === "chiaro";
		$("#dl-tema").innerHTML = chiaro ? `<i class="bi bi-moon"></i>Tema scuro` : `<i class="bi bi-sun"></i>Tema chiaro`;
	}

	function cambiaTema() {
		const chiaro = document.documentElement.getAttribute("data-tema") !== "chiaro";
		if (chiaro) document.documentElement.setAttribute("data-tema", "chiaro");
		else document.documentElement.removeAttribute("data-tema");
		try { localStorage.setItem("dl_tema", chiaro ? "chiaro" : "scuro"); } catch (e) { }
		aggiornaBottoneTema();
	}

	function versioneNelFooter() {
		const placeholder = document.getElementById("footer-placeholder");
		if (!placeholder) return;
		const inserisci = () => {
			const container = placeholder.querySelector(".footer-container");
			if (!container) return false;
			if (!container.querySelector(".footer-right")) {
				const right = document.createElement("div");
				right.className = "footer-right";
				right.innerHTML = `<span>Versione ${esc(VERSIONE)}</span>`;
				container.appendChild(right);
			}
			return true;
		};
		if (inserisci()) return;
		const observer = new MutationObserver(() => { if (inserisci()) observer.disconnect(); });
		observer.observe(placeholder, { childList: true, subtree: true });
	}

	function collegaEventi() {
		$("#c-tipo").addEventListener("change", () => { aggiornaCampiTipo(true); salvaConn(); });
		$("#c-windows").addEventListener("change", () => aggiornaCampiTipo(false));
		$("#c-modello").addEventListener("change", scegliModello);
		$$("#sez-conn input:not([type=password]), #sez-conn select, #sez-conn textarea").forEach(el => el.addEventListener("change", salvaConn));
		$("#c-password-vedi").addEventListener("click", () => {
			const p = $("#c-password");
			p.type = p.type === "password" ? "text" : "password";
			$("#c-password-vedi i").className = p.type === "password" ? "bi bi-eye" : "bi bi-eye-slash";
		});
		$("#c-password").addEventListener("keydown", e => { if (e.key === "Enter") provaCollegamento(); });
		$("#dl-prova").addEventListener("click", provaCollegamento);
		$("#dl-info-btn").addEventListener("click", infoServer);
		$("#dl-tema").addEventListener("click", cambiaTema);

		$("#dl-query").addEventListener("click", e => {
			const btn = e.target.closest("button[data-azione]");
			if (!btn) return;
			const art = btn.closest(".dl-q");
			const az = btn.dataset.azione;
			if (az === "esegui") eseguiQuery(art, false, btn);
			else if (az === "salva") eseguiQuery(art, true, btn);
			else if (az === "locale") eseguiLocale(art, btn);
			else if (az === "ripristina") {
				const q = QUERY.find(x => x.id === art.dataset.id);
				$(".dl-sql", art).value = q.sql;
				try { localStorage.removeItem(CHIAVE_SQL + q.id); } catch (err) { }
				btn.hidden = true;
			} else if (az === "copia-create") {
				const pre = btn.parentElement.querySelector("pre.dl-pre:last-of-type");
				navigator.clipboard.writeText(pre.textContent).then(() => avviso("CREATE TABLE copiata."), () => avviso("Copia non riuscita: selezionala a mano.", true));
			}
		});
		$("#dl-query").addEventListener("input", e => {
			if (!e.target.classList.contains("dl-sql")) return;
			const art = e.target.closest(".dl-q");
			const q = QUERY.find(x => x.id === art.dataset.id);
			if (q.tipo !== "sorgente") return;
			try {
				if (e.target.value === q.sql) localStorage.removeItem(CHIAVE_SQL + q.id);
				else localStorage.setItem(CHIAVE_SQL + q.id, e.target.value);
			} catch (err) { }
			$("[data-azione=ripristina]", art).hidden = e.target.value === q.sql;
		});

		$("#dl-tabelle-btn").innerHTML = TABELLE_TEST.map(t => `<button type="button" class="dl-btn dl-btn-outline dl-btn-sm" data-tabella="${esc(t)}"><i class="bi bi-table"></i>${esc(t)}<span class="dl-conta-righe"></span></button>`).join("");
		$("#dl-tabelle-btn").addEventListener("click", e => {
			const b = e.target.closest("button[data-tabella]");
			if (b) vediTabella(b.dataset.tabella);
		});
		$("#dl-vedi").addEventListener("click", e => { if (e.target.closest("[data-chiudi-vedi]")) $("#dl-vedi").innerHTML = ""; });
		$("#dl-cda-salva").addEventListener("click", salvaCda);

		$("#dl-dlt-file").addEventListener("change", e => { const f = e.target.files[0]; if (f) anteprimaDlt(f); e.target.value = ""; });
		$("#dl-dlt-carica").addEventListener("click", caricaDlt);
	}

	function avvia() {
		versioneNelFooter();
		aggiornaBottoneTema();
		caricaConn();
		aggiornaCampiTipo(false);
		disegnaQuery();
		collegaEventi();
		const quandoUtente = () => { aggiornaStatoTest(); caricaCda(); };
		if (window.PortaleUtente) quandoUtente();
		else document.addEventListener("portale:utente", quandoUtente, { once: true });
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
	else avvia();
})();
