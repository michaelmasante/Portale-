/* ============ Repair Tracker (RepairTracker.html) ============
 Riparazioni urgenti: il manutentore apre la richiesta, poi la pratica passa tra
 Magazzino, Team Ricambi e RUO fino alla chiusura. Una sola pagina con piu' "viste",
 scelte dall'indirizzo dopo il # (#/dashboard, #/pratica/12, ...).

 Dati: API/RepairTracker.ashx (SQL Server: pratiche nel database RepairTracker, utenti e ruoli in PortaleLogin).
 Ruoli: Riparazioni (sola lettura), Manutentori, Magazzino, TeamRicambi, RUO, Admin.
 La pagina nasconde i bottoni che l'utente non puo' usare, ma il controllo vero e' nell'API.

 Indice del file:
   1. CONFIGURAZIONE  aree, stati, code, fasi del flusso (le fasi vanno tenute uguali a Fasi nell'.ashx)
   2. STATO           i dati in memoria
   3. REGOLE          chi puo' fare cosa, colore del pallino
   4. UTILITA'        formattazione, chiamate al server, avvisi
   5. VISTE           dashboard e code, coda RUO, nuova richiesta, dettaglio, analisi fornitori
   6. EVENTI e AVVIO
*/
(function () {
	"use strict";

	const API = "API/RepairTracker.ashx";

	/* =====================================================================
	   1. CONFIGURAZIONE
	   ===================================================================== */

	// Aree dello stabilimento (menu a tendina). Per aggiungerne una basta scriverla qui.
	const AREE = ["Cambi", "CKD", "Elettrificato", "NEF Lavorazione", "NEF Montaggio", "PFC", "Ponti"];

	// Stati della pratica, nell'ordine del flusso. cls = colore del badge (in RepairTracker.css)
	const STATI = {
		in_magazzino:         { label: "Attesa completamento anagrafica - Magazzino", cls: "st-in-magazzino" },
		richiesta_inoltrata:  { label: "Attesa fornitore - Team Ricambi",             cls: "st-richiesta-inoltrata" },
		attesa_spedizione:    { label: "Attesa data spedizione - Magazzino",          cls: "st-attesa-spedizione" },
		spedito:              { label: "Attesa rientro da spedito - Team Ricambi",    cls: "st-spedito" },
		attesa_approvazione:  { label: "Attesa approvazione - RUO",                   cls: "st-attesa-approvazione" },
		rifiutato:            { label: "Rifiutato",                                   cls: "st-rifiutato" },
		accettata:            { label: "Accettata - RUO",                             cls: "st-accettata" },
		attesa_consegna:      { label: "Attesa consegna - Team Ricambi",              cls: "st-attesa-consegna" },
		consegnato_magazzino: { label: "Attesa chiusura pratica - Magazzino",         cls: "st-consegnato-magazzino" },
		chiuso:               { label: "Chiusa",                                      cls: "st-chiuso" }
	};

	// Stati di competenza di ogni coda (pagine "Richieste ..." e numerino nel menu)
	const CODE = {
		magazzino: ["in_magazzino", "attesa_spedizione", "consegnato_magazzino"],
		ricambi: ["richiesta_inoltrata", "spedito", "accettata", "attesa_consegna"],
		ruo: ["attesa_approvazione"]
	};

	const PRIORITA = { 1: "Macchina ferma", 2: "Macchina lavora" };

	/* Le fasi del flusso, una card ciascuna nel dettaglio, in quest'ordine.
	   ruolo  = chi compila la fase           chi    = come si chiama nei messaggi "In attesa di ..."
	   stato  = stato in cui la fase e' attiva avanti = stato dopo il bottone di conferma
	   campi: k = colonna del database, tipo = testo | testoLungo | area | scelta | data | euro | intero | maiuscolo | priorita
	          obbl = obbligatorio, span = larghezza nel modulo (su 12), largo = riga intera nella vista
	   ATTENZIONE: fasi, campi obbligatori e ruoli sono ripetuti in API/RepairTracker.ashx (Fasi): tenerli uguali. */
	const FASI = [
		{
			key: "manutentori", titolo: "Manutentori", icona: "bi-tools", ruolo: "Manutentori", chi: "Manutentori",
			stato: null, avanti: null,
			campi: [
				{ k: "codice_componente", label: "Descrizione breve", tipo: "testo", obbl: true, placeholder: "Es. Motore linea 3" },
				{ k: "codice_sap", label: "Codice SAP", tipo: "testo", placeholder: "Es. 100234567" },
				{ k: "priorita", label: "Priorità", tipo: "priorita" },
				{ k: "area", label: "Area", tipo: "area", obbl: true },
				{ k: "descrizione", label: "Descrizione", tipo: "testoLungo", span: 12, largo: true, placeholder: "Descrivi il componente e il guasto" },
				{ k: "tipo_guasto", label: "Tipo guasto", tipo: "testo", placeholder: "Es. Cortocircuito, usura, perdita olio" },
				{ k: "macchina", label: "Targa macchina", tipo: "testo", obbl: true, placeholder: "Es. AB123CD" },
				{ k: "centro_costo", label: "Centro di costo", tipo: "testo", obbl: true, placeholder: "Es. CC-4521" },
				{ k: "note", label: "Note", tipo: "testoLungo", span: 12, largo: true, placeholder: "Note aggiuntive" }
			],
			// nella vista compaiono anche numero e data, che non si modificano
			primaDeiCampi: p => [
				{ label: "N. Pratica", valore: p.numero_pratica },
				{ label: "Data inserimento", valore: dataIt(p.data_inserimento) }
			]
		},
		{
			key: "magazzino_1", titolo: "Magazzino", icona: "bi-building", ruolo: "Magazzino", chi: "Magazzino",
			stato: "in_magazzino", avanti: "richiesta_inoltrata", bottone: "Conferma e inoltra a Team Ricambi",
			campi: [
				{ k: "tipo_riparazione", label: "Tipo riparazione", tipo: "scelta", obbl: true, opzioni: ["Meccanica", "Elettronica"] },
				{ k: "ubicazione", label: "Ubicazione", tipo: "testo" },
				{ k: "movimento_sap", label: "Movimento SAP", tipo: "testo", span: 12, largo: true }
			]
		},
		{
			key: "ricambi_1", titolo: "Team Ricambi", icona: "bi-box-seam", ruolo: "TeamRicambi", chi: "Team Ricambi",
			stato: "richiesta_inoltrata", avanti: "attesa_spedizione", bottone: "Conferma e passa a Magazzino",
			campi: [
				{ k: "fornitore", label: "Fornitore", tipo: "maiuscolo", obbl: true },
				{ k: "bolla", label: "Bolla", tipo: "testo", obbl: true, span: 12, largo: true }
			]
		},
		{
			key: "magazzino_2", titolo: "Magazzino — Spedizione", icona: "bi-building", ruolo: "Magazzino", chi: "Magazzino",
			stato: "attesa_spedizione", avanti: "spedito", bottone: "Conferma e passa a Team Ricambi",
			campi: [
				{ k: "data_spedizione", label: "Data spedizione", tipo: "data", obbl: true, largo: true }
			]
		},
		{
			key: "ricambi_2", titolo: "Team Ricambi — Preventivo", icona: "bi-box-seam", ruolo: "TeamRicambi", chi: "Team Ricambi",
			stato: "spedito", avanti: "attesa_approvazione", bottone: "Conferma e invia al RUO",
			campi: [
				{ k: "preventivo", label: "Preventivo (€)", tipo: "euro", obbl: true },
				{ k: "tempo_consegna_unita", label: "Unità", tipo: "scelta", obbl: true, span: 3, opzioni: ["giorni", "settimane"], etichette: ["Giorni", "Settimane"] },
				{ k: "tempo_consegna_valore", label: "Tempo di consegna", tipo: "intero", obbl: true, span: 3, placeholder: "es. 10" }
			],
			// nella vista preventivo e tempo si leggono meglio cosi'
			vista: p => [
				{ label: "Preventivo", valore: p.preventivo != null ? euro(p.preventivo) + " €" : "" },
				{ label: "Tempo di consegna", valore: p.tempo_consegna_valore ? p.tempo_consegna_valore + " " + (p.tempo_consegna_unita || "") : "" }
			]
		},
		{
			key: "ruo", titolo: "RUO — Approvazione", icona: "bi-clipboard-check", ruolo: "RUO", chi: "approvazione RUO",
			stato: "attesa_approvazione", avanti: null,
			campi: [] // la nota del RUO (note_ruo) si scrive con Approva / Rifiuta
		},
		{
			key: "ricambi_3", titolo: "Team Ricambi — Ordine", icona: "bi-box-seam", ruolo: "TeamRicambi", chi: "Team Ricambi",
			stato: "accettata", avanti: "attesa_consegna", bottone: "Conferma e passa ad Attesa consegna",
			campi: [
				{ k: "numero_rda", label: "Numero RDA/ordine", tipo: "testo", obbl: true },
				{ k: "data_ordine", label: "Data ordine", tipo: "data", obbl: true },
				{ k: "data_consegna_fornitore", label: "Data consegna fornitore", tipo: "data", obbl: true, largo: true },
				{ k: "data_ritardo", label: "Data di ritardo (facoltativo, sovrascrive la data consegna fornitore)", tipo: "data", largo: true,
				  labelVista: "Data di ritardo (sovrascrive la data consegna fornitore)", nascondiSeVuoto: true }
			]
		},
		{
			key: "ricambi_4", titolo: "Team Ricambi — Rientro", icona: "bi-box-seam", ruolo: "TeamRicambi", chi: "Team Ricambi",
			stato: "attesa_consegna", avanti: "consegnato_magazzino", bottone: "Conferma e consegna a Magazzino",
			campi: [
				{ k: "bolla_rientro", label: "Bolla di rientro", tipo: "testo", obbl: true },
				{ k: "data_rientro_effettiva", label: "Data rientro", tipo: "data", obbl: true },
				{ k: "entrata_merci_sap", label: "Entrata merci a SAP (numero)", tipo: "testo", span: 12, largo: true, labelVista: "Entrata merci a SAP" }
			]
		},
		{
			key: "magazzino_3", titolo: "Magazzino — Conferma chiusura", icona: "bi-building", ruolo: "Magazzino", chi: "Magazzino",
			stato: "consegnato_magazzino", avanti: "chiuso", bottone: "Conferma e chiudi pratica",
			campi: []
		}
	];

	// Colonne delle tabelle (dashboard e code). filtro: "testo" = casella di ricerca, "lista" = caselle da spuntare
	const COLONNE = [
		{ k: "numero_pratica", label: "N. Pratica", filtro: "testo", ph: "Cerca n. pratica...", w: 150, forte: true },
		{ k: "fornitore", label: "Fornitore", filtro: "testo", ph: "Cerca fornitore...", w: 160 },
		{ k: "codice_componente", label: "Descrizione", filtro: "testo", ph: "Cerca descrizione breve...", w: 220 },
		{ k: "area", label: "Area", filtro: "lista", w: 140 },
		{ k: "priorita", label: "Priorità", filtro: "lista", w: 100 },
		{ k: "stato", label: "Stato", filtro: "lista", w: 290 },
		{ k: "creato_il", label: "Data inserimento", w: 130 }
	];

	// Colonne dell'export Excel (tutti i campi della pratica)
	const COLONNE_EXCEL = [
		["N. Pratica", "numero_pratica", 14], ["Data inserimento", "data_inserimento", 16], ["Descrizione breve", "codice_componente", 22],
		["Codice SAP", "codice_sap", 14], ["Descrizione", "descrizione", 30], ["Tipo guasto", "tipo_guasto", 18], ["Targa macchina", "macchina", 18],
		["Area", "area", 16], ["Centro di costo", "centro_costo", 14], ["Tipo riparazione", "tipo_riparazione", 16], ["Ubicazione", "ubicazione", 16],
		["Movimento SAP", "movimento_sap", 16], ["Fornitore", "fornitore", 20], ["Bolla", "bolla", 14], ["Data spedizione", "data_spedizione", 16],
		["Preventivo", "preventivo", 12], ["Tempo consegna valore", "tempo_consegna_valore", 14], ["Tempo consegna unità", "tempo_consegna_unita", 14],
		["Numero RDA/ordine", "numero_rda", 16], ["Data ordine", "data_ordine", 14], ["Data consegna fornitore", "data_consegna_fornitore", 18],
		["Data di ritardo", "data_ritardo", 14], ["Bolla di rientro", "bolla_rientro", 16], ["Data rientro effettiva", "data_rientro_effettiva", 16],
		["Entrata merci SAP", "entrata_merci_sap", 16], ["Priorità", "priorita", 10], ["Stato", "stato_label", 34], ["Note", "note", 24],
		["Note RUO", "note_ruo", 24], ["Creato il", "creato_il", 18]
	];

	/* =====================================================================
	   2. STATO
	   ===================================================================== */

	const S = {
		io: null,              // utente collegato: { username, nome, ruoli }
		pratiche: [],          // tutte le pratiche (dall'API)
		caricato: false,
		vista: null,
		filtri: {},            // un oggetto filtri per ogni tabella (dashboard, magazzino, ricambi)
		ricerca: "",           // ricerca globale della dashboard
		colore: "",            // filtro KPI della dashboard
		popover: null,         // filtro di colonna aperto: { vista, k }
		pratica: null,         // pratica aperta nel dettaglio
		log: [],
		modifica: null,        // fase aperta in modifica
		aperte: {},            // schede del dettaglio aperte/chiuse a mano: { magazzino_1: true, storico: false, ... }
		campi: {},             // valori del modulo della fase in modifica
		noteRuo: "",
		nuova: {},             // valori del modulo "Nuova richiesta"
		indietro: "#/dashboard",
		grafici: []
	};

	function nuoviFiltri() {
		return { numero_pratica: "", fornitore: "", codice_componente: "", area: [], priorita: [], stato: [] };
	}
	["dashboard", "magazzino", "ricambi"].forEach(v => { S.filtri[v] = nuoviFiltri(); });

	/* =====================================================================
	   3. REGOLE (uguali a quelle dell'API)
	   ===================================================================== */

	function ha(ruolo) {
		if (!S.io) return false;
		const mie = (S.io.ruoli || []).map(r => String(r).toLowerCase());
		return mie.includes("admin") || mie.includes(String(ruolo).toLowerCase());
	}
	function haUno(lista) { return String(lista).split(",").map(s => s.trim()).filter(Boolean).some(ha); }
	function isAdmin() { return ha("Admin"); }
	function puoCreare() { return haUno("Manutentori,TeamRicambi"); }
	function puoApprovare() { return ha("RUO"); }

	function indice(key) { return FASI.findIndex(f => f.key === key); }

	// Indice della fase su cui si deve agire ora. Rifiutato si ferma sul RUO; chiuso = tutto completato.
	function indiceCorrente(stato) {
		if (stato === "rifiutato") return indice("ruo");
		const i = FASI.findIndex(f => f.stato === stato);
		return i >= 0 ? i : FASI.length;
	}

	// "completata", "attiva" o "futura"
	function statoFase(f, stato) {
		if (f.key === "manutentori") return stato === "in_magazzino" ? "attiva" : "completata";
		if (stato === "rifiutato" && f.key === "ruo") return "completata";
		const i = indice(f.key), cur = indiceCorrente(stato);
		if (i < cur) return "completata";
		if (i === cur) return "attiva";
		return "futura";
	}

	// La fase dopo ha gia' dati? Allora chi ha compilato questa non la puo' piu' toccare (solo Admin):
	// si puo' correggere un proprio errore finche' chi viene dopo non ha iniziato a lavorarci.
	function successivaHaDati(f, p) {
		const i = indice(f.key);
		const s = FASI[i + 1];
		if (!s) return false;
		if (s.key === "ruo") return p.stato === "rifiutato" || indiceCorrente(p.stato) > i + 1; // il RUO ha gia' deciso
		if (!s.campi.length) return indiceCorrente(p.stato) > i + 1;
		return s.campi.some(c => haValore(p[c.k]));
	}

	function puoModificare(f, p) {
		const st = statoFase(f, p.stato);
		if (st === "futura") return false;
		if (isAdmin()) return true;
		if (st === "completata" && successivaHaDati(f, p)) return false;
		return ha(f.ruolo);
	}

	// Solo l'Admin cambia la decisione del RUO, e solo finche' la pratica e' ferma li'
	function puoModificareRuo(p) {
		return isAdmin() && (p.stato === "accettata" || p.stato === "rifiutato");
	}

	function completa(f, valori) {
		return f.campi.every(c => !c.obbl || haValore(valori[c.k]));
	}

	/* Pallino: verde/giallo/rosso in base ai giorni alla data consegna fornitore,
	   viola se c'e' una data di ritardo, grigio se la data consegna non c'e' ancora. */
	function colore(p) {
		if (p.stato === "consegnato_magazzino" || p.stato === "chiuso") return "green";
		if (p.stato === "rifiutato") return "red";
		if (p.data_ritardo) return "purple";
		if (!p.data_consegna_fornitore) return "grey";
		const giorni = Math.ceil((parseData(p.data_consegna_fornitore) - new Date()) / 864e5);
		if (giorni <= 3) return "red";
		if (giorni <= 10) return "yellow";
		return "green";
	}

	/* =====================================================================
	   4. UTILITA'
	   ===================================================================== */

	const $ = (sel, root) => (root || document).querySelector(sel);
	const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

	function esc(v) {
		return String(v == null ? "" : v)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	function haValore(v) { return v !== null && v !== undefined && String(v).trim() !== ""; }

	function parseData(s) {
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
		return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(NaN);
	}

	// "2026-10-20" o "2026-10-20 14:30" -> "20/10/2026"
	function dataIt(s) {
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
		return m ? m[3] + "/" + m[2] + "/" + m[1] : (s || "");
	}

	// 1500 -> "1.500", 1500.5 -> "1.500,50"
	function euro(v) {
		if (!haValore(v)) return "";
		const n = Number(v);
		if (isNaN(n)) return "";
		return new Intl.NumberFormat("it-IT", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
	}

	function labelStato(stato) { return STATI[stato] ? STATI[stato].label : stato; }
	function badgeStato(stato) { return `<span class="rt-badge ${STATI[stato] ? STATI[stato].cls : ""}">${esc(labelStato(stato))}</span>`; }
	function dot(p) { return `<span class="rt-dot dot-${colore(p)}"></span>`; }
	function priorita(p) { return "P" + p.priorita + " — " + (PRIORITA[p.priorita] || ""); }

	function vaiAlLogin() {
		window.location.href = "Login.html?ReturnUrl=" + encodeURIComponent(window.location.pathname + window.location.search);
	}

	// Chiamata all'API. body presente = POST. Errore -> eccezione con il messaggio del server.
	async function api(action, opzioni) {
		const o = opzioni || {};
		let url = API + "?action=" + encodeURIComponent(action);
		if (o.id) url += "&id=" + encodeURIComponent(o.id);
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
			throw new Error("Server non raggiungibile. Controlla la rete e riprova.");
		}
		if (res.redirected) { vaiAlLogin(); throw new Error("Sessione scaduta."); }
		let data;
		try {
			data = await res.json();
		} catch (e) {
			throw new Error("Risposta non valida dal server (" + res.status + ").");
		}
		if (data.ok === false && !data.regressione) {
			const err = new Error(data.message || "Operazione non riuscita.");
			if (data.detail) console.error("Dettaglio errore:", data.detail);
			throw err;
		}
		return data;
	}

	let toastTimer = null;
	function avviso(testo, errore) {
		const t = $("#rt-toast");
		t.textContent = testo;
		t.classList.toggle("is-error", !!errore);
		t.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => { t.hidden = true; }, errore ? 6000 : 3000);
	}

	function erroreGenerale(testo) {
		const box = $("#rt-errore");
		box.textContent = testo || "";
		box.hidden = !testo;
	}

	/* =====================================================================
	   5. VISTE
	   ===================================================================== */

	const VISTE = ["dashboard", "magazzino", "ricambi", "ruo", "nuova", "pratica", "fornitori"];

	function mostraVista(vista) {
		S.vista = vista;
		chiudiPopover();
		$$(".rt-vista").forEach(s => { s.hidden = s.dataset.vista !== vista; });
		$$("#rt-nav a").forEach(a => a.classList.toggle("is-on", a.dataset.vista === vista));
	}

	// Menu: voci visibili secondo i ruoli, numerini delle code
	function aggiornaMenu() {
		$$("#rt-nav a").forEach(a => {
			const r = a.dataset.ruoliRt;
			a.hidden = !!r && !haUno(r);
		});
		Object.keys(CODE).forEach(coda => {
			const n = S.pratiche.filter(p => CODE[coda].includes(p.stato)).length;
			$$(`[data-coda="${coda}"]`).forEach(el => { el.textContent = n > 0 ? n : ""; el.hidden = n === 0; });
		});
	}

	async function caricaElenco() {
		const data = await api("elenco");
		S.io = data.io;
		S.pratiche = data.pratiche || [];
		S.caricato = true;
		aggiornaMenu();
	}

	// ---------------- DASHBOARD E CODE (tabella con filtri) ----------------

	function praticheDellaVista(vista) {
		if (vista === "dashboard") return S.pratiche;
		return S.pratiche.filter(p => CODE[vista].includes(p.stato));
	}

	function valoreColonna(p, k) {
		if (k === "priorita") return "P" + p.priorita;
		if (k === "stato") return labelStato(p.stato);
		if (k === "creato_il") return dataIt(p.creato_il);
		return p[k] == null ? "" : String(p[k]);
	}

	// Ricerca globale: n. pratica, fornitore, descrizione, area, priorita', stato, data (come si vedono a schermo)
	function matchRicerca(p) {
		const t = S.ricerca.trim().toLowerCase();
		if (!t) return true;
		return ["numero_pratica", "fornitore", "codice_componente", "area", "priorita", "stato", "creato_il"]
			.some(k => valoreColonna(p, k).toLowerCase().includes(t));
	}

	function praticheFiltrate(vista) {
		const f = S.filtri[vista];
		return praticheDellaVista(vista).filter(p => {
			for (const c of COLONNE) {
				if (c.filtro === "testo" && f[c.k] && !String(p[c.k] || "").toLowerCase().includes(f[c.k].toLowerCase())) return false;
				if (c.filtro === "lista" && f[c.k].length && !f[c.k].includes(String(p[c.k]))) return false;
			}
			if (vista === "dashboard") {
				if (S.colore && colore(p) !== S.colore) return false;
				if (!matchRicerca(p)) return false;
			}
			return true;
		});
	}

	function filtroAttivo(vista, k) {
		const v = S.filtri[vista][k];
		return Array.isArray(v) ? v.length > 0 : !!v;
	}

	function haFiltri(vista) {
		const any = COLONNE.some(c => c.filtro && filtroAttivo(vista, c.k));
		return any || (vista === "dashboard" && (!!S.colore || !!S.ricerca));
	}

	// Disegna intestazione + righe della tabella di una vista
	function renderTabella(vista) {
		const sez = $(`.rt-vista[data-vista="${vista}"]`);
		const box = $("[data-tabella]", sez);
		const dash = vista === "dashboard";
		const admin = dash && isAdmin();

		const th = COLONNE.map(c => {
			if (!c.filtro) return `<th style="width:${c.w}px">${esc(c.label)}</th>`;
			const icona = filtroAttivo(vista, c.k) ? "bi-funnel-fill" : "bi-chevron-down";
			return `<th style="width:${c.w}px" class="rt-th-filtro${filtroAttivo(vista, c.k) ? " is-filtrato" : ""}" data-filtro-col="${c.k}" tabindex="0">` +
				`${esc(c.label)} <i class="bi ${icona}"></i></th>`;
		}).join("");

		box.innerHTML =
			`<table class="rt-table rt-table-fixed">` +
				`<thead><tr>${dash ? '<th style="width:44px"></th>' : ""}${th}${admin ? '<th style="width:56px"></th>' : ""}</tr></thead>` +
				`<tbody></tbody>` +
			`</table>`;
		renderRighe(vista);
	}

	function renderRighe(vista) {
		const sez = $(`.rt-vista[data-vista="${vista}"]`);
		const tbody = $("tbody", sez);
		if (!tbody) return;
		const dash = vista === "dashboard";
		const admin = dash && isAdmin();
		const righe = praticheFiltrate(vista);
		const colonne = COLONNE.length + (dash ? 1 : 0) + (admin ? 1 : 0);
		const vuoto = { dashboard: "Nessun record trovato", magazzino: "Nessuna richiesta in magazzino", ricambi: "Nessuna richiesta ricambi" }[vista];

		tbody.innerHTML = righe.length === 0
			? `<tr><td colspan="${colonne}" class="rt-vuoto">${vuoto}</td></tr>`
			: righe.map(p =>
				`<tr data-id="${p.id}" tabindex="0">` +
					(dash ? `<td>${dot(p)}</td>` : "") +
					COLONNE.map(c => {
						const v = valoreColonna(p, c.k) || (c.k === "codice_componente" ? "" : "—");
						return `<td${c.forte ? ' class="rt-forte"' : ""} title="${esc(v)}">${esc(v)}</td>`;
					}).join("") +
					(admin ? `<td><button type="button" class="rt-btn-icon" data-elimina="${p.id}" title="Elimina"><svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47M8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5"/></svg></button></td>` : "") +
				`</tr>`
			).join("");

		$$("[data-azione=reset]", sez).forEach(b => { b.hidden = !haFiltri(vista); });

		if (dash) {
			$("[data-kpi=tutti]").textContent = S.pratiche.length;
			["green", "yellow", "red", "purple"].forEach(c => {
				$(`[data-kpi=${c}]`).textContent = S.pratiche.filter(p => colore(p) === c).length;
			});
			$$(".rt-kpi").forEach(k => k.classList.toggle("is-on", k.dataset.colore === S.colore));
			$("#rt-export").hidden = righe.length === 0;
			$("#rt-ricerca-pulisci").hidden = !S.ricerca;
		}
	}

	// Aggiorna solo l'icona/colore delle intestazioni (senza ridisegnare: il filtro aperto resta com'e')
	function aggiornaIntestazioni(vista) {
		$$(`.rt-vista[data-vista="${vista}"] [data-filtro-col]`).forEach(th => {
			const on = filtroAttivo(vista, th.dataset.filtroCol);
			th.classList.toggle("is-filtrato", on);
			const i = $("i", th);
			if (i) i.className = "bi " + (on ? "bi-funnel-fill" : "bi-chevron-down");
		});
	}

	// ----- filtro di colonna: un piccolo pannello sotto l'intestazione -----

	function popoverEl() {
		let el = $("#rt-popover");
		if (!el) {
			el = document.createElement("div");
			el.id = "rt-popover";
			el.className = "rt-popover";
			el.hidden = true;
			document.body.appendChild(el);
		}
		return el;
	}

	function apriPopover(vista, k, th) {
		if (S.popover && S.popover.vista === vista && S.popover.k === k) { chiudiPopover(); return; }
		const c = COLONNE.find(x => x.k === k);
		const f = S.filtri[vista];
		const el = popoverEl();

		if (c.filtro === "testo") {
			el.innerHTML = `<div class="rt-pop-search"><input type="text" data-filtro-testo="${k}" placeholder="${esc(c.ph)}" value="${esc(f[k])}" autocomplete="off"></div>`;
		} else {
			let opzioni;
			if (k === "area") opzioni = Array.from(new Set(praticheDellaVista(vista).map(p => p.area).filter(Boolean))).sort().map(a => [a, a]);
			else if (k === "priorita") opzioni = [["1", "P1"], ["2", "P2"]];
			else opzioni = Object.keys(STATI).map(s => [s, STATI[s].label]);
			el.innerHTML = opzioni.length
				? opzioni.map(([v, l]) =>
					`<label class="rt-pop-item"><input type="checkbox" data-filtro-val="${esc(v)}" ${f[k].includes(v) ? "checked" : ""}> ${esc(l)}</label>`).join("")
				: `<div class="rt-pop-vuoto">Nessun valore</div>`;
		}

		S.popover = { vista: vista, k: k };
		el.hidden = false;
		const r = th.getBoundingClientRect();
		const larghezza = Math.max(200, el.offsetWidth);
		const left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - larghezza - 8);
		el.style.left = Math.max(8, left) + "px";
		el.style.top = (r.bottom + window.scrollY + 4) + "px";
		const input = $("input[type=text]", el);
		if (input) input.focus();
	}

	function chiudiPopover() {
		S.popover = null;
		const el = $("#rt-popover");
		if (el) el.hidden = true;
	}

	function resetFiltri(vista) {
		S.filtri[vista] = nuoviFiltri();
		if (vista === "dashboard") {
			S.colore = "";
			S.ricerca = "";
			$("#rt-ricerca").value = "";
		}
		chiudiPopover();
		renderTabella(vista);
	}

	async function eliminaPratica(id) {
		const p = S.pratiche.find(x => x.id === id);
		if (!p) return;
		if (!confirm(`Eliminare la richiesta "${p.codice_componente}"?`)) return;
		try {
			await api("elimina", { body: { id: id } });
			avviso("Pratica eliminata.");
			await caricaElenco();
			renderTabella(S.vista);
		} catch (e) {
			avviso(e.message, true);
		}
	}

	// ----- export Excel delle righe visibili (dashboard) -----

	async function esportaExcel() {
		const righe = praticheFiltrate("dashboard").map(p => {
			const r = {};
			COLONNE_EXCEL.forEach(([, k]) => { r[k] = p[k] == null ? "" : p[k]; });
			r.stato_label = labelStato(p.stato);
			return r;
		});
		const nome = "repair-tracker-export-" + new Date().toISOString().slice(0, 10);

		if (!window.ExcelJS) { // libreria non caricata: si scarica un CSV che Excel apre lo stesso
			const sep = ";";
			const cella = v => '"' + String(v).replace(/"/g, '""') + '"';
			const csv = [COLONNE_EXCEL.map(c => cella(c[0])).join(sep)]
				.concat(righe.map(r => COLONNE_EXCEL.map(c => cella(r[c[1]])).join(sep))).join("\r\n");
			scarica(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), nome + ".csv");
			return;
		}

		const wb = new window.ExcelJS.Workbook();
		const ws = wb.addWorksheet("Pratiche");
		ws.columns = COLONNE_EXCEL.map(([header, key, width]) => ({ header: header, key: key, width: width }));
		righe.forEach(r => ws.addRow(r));
		ws.getRow(1).eachCell(cell => {
			cell.font = { bold: true };
			cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
		});
		const buffer = await wb.xlsx.writeBuffer();
		scarica(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nome + ".xlsx");
	}

	function scarica(blob, nomeFile) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = nomeFile;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	// ---------------- CODA RUO ----------------

	function renderRuo() {
		const lista = S.pratiche.filter(p => p.stato === "attesa_approvazione");
		$("#rt-ruo-titolo").textContent = puoApprovare() ? "Coda approvazioni RUO" : "Richieste in attesa di approvazione RUO";
		$("#rt-ruo-vuota").hidden = lista.length > 0;
		$("#rt-ruo-lista").innerHTML = lista.map(p =>
			`<div class="rt-ruo-card">` +
				`<div class="rt-ruo-head"><strong>${esc(p.numero_pratica || p.codice_componente)}</strong><span>P${esc(p.priorita)}</span></div>` +
				`<div class="rt-ruo-body">` +
					`<p class="rt-muted">${esc(p.codice_componente)}</p>` +
					`<div><span class="rt-muted">Area:</span> ${esc(p.area || "—")}</div>` +
					`<div><span class="rt-muted">Fornitore:</span> ${esc(p.fornitore || "—")}</div>` +
					`<div><span class="rt-muted">Preventivo:</span> <strong>${p.preventivo != null ? esc(euro(p.preventivo)) + " €" : "—"}</strong></div>` +
					`<div><span class="rt-muted">Tempo di consegna:</span> ${p.tempo_consegna_valore ? esc(p.tempo_consegna_valore + " " + (p.tempo_consegna_unita || "")) : "—"}</div>` +
				`</div>` +
				`<a class="rt-btn rt-btn-primary rt-btn-sm rt-btn-block" href="#/pratica/${p.id}"><i class="bi bi-eye"></i>${puoApprovare() ? "Apri e gestisci" : "Visualizza"}</a>` +
			`</div>`
		).join("");
	}

	// ---------------- CAMPI DEI MODULI ----------------

	// Il valore come si vede (vista di sola lettura)
	function mostraValore(c, v) {
		if (!haValore(v)) return "";
		switch (c.tipo) {
			case "data": return dataIt(v);
			case "euro": return euro(v) + " €";
			case "priorita": return "P" + v + " — " + (PRIORITA[v] || "");
			case "maiuscolo": return String(v).toUpperCase();
			default: return String(v);
		}
	}

	// Un campo del modulo. form = "pratica" o "nuova" (dice dove salvare cio' che si scrive)
	function campoHtml(c, v, form) {
		const id = "rt-" + form + "-" + c.k;
		const val = v == null ? "" : v;
		const attr = `id="${id}" data-campo="${c.k}" data-tipo="${c.tipo}"`;
		const ph = c.placeholder ? ` placeholder="${esc(c.placeholder)}"` : "";
		let input;
		switch (c.tipo) {
			case "testoLungo":
				input = `<textarea ${attr} rows="${form === "nuova" ? 3 : 2}"${ph}>${esc(val)}</textarea>`;
				break;
			case "area":
				input = `<select ${attr}><option value="">Seleziona area</option>` +
					AREE.map(a => `<option value="${esc(a)}"${a === val ? " selected" : ""}>${esc(a)}</option>`).join("") + `</select>`;
				break;
			case "scelta":
				input = `<select ${attr}><option value="">Seleziona</option>` +
					c.opzioni.map((o, i) => `<option value="${esc(o)}"${o === val ? " selected" : ""}>${esc(c.etichette ? c.etichette[i] : o)}</option>`).join("") + `</select>`;
				break;
			case "priorita":
				input = `<select ${attr}>` +
					[1, 2].map(n => `<option value="${n}"${String(val || 2) === String(n) ? " selected" : ""}>${n} — ${PRIORITA[n]}</option>`).join("") + `</select>`;
				break;
			case "data":
				input = `<input type="date" ${attr} value="${esc(val)}">`;
				break;
			case "euro":
				input = `<input type="text" inputmode="decimal" ${attr} placeholder="0,00" value="${esc(euro(val))}">`;
				break;
			case "intero":
				input = `<input type="number" min="1" step="1" ${attr} value="${esc(val)}"${ph}>`;
				break;
			case "maiuscolo":
				input = `<input type="text" class="rt-upper" ${attr} value="${esc(String(val).toUpperCase())}"${ph}>`;
				break;
			default:
				input = `<input type="text" ${attr} value="${esc(val)}"${ph}>`;
		}
		return `<div class="rt-campo" style="--span:${c.span || 6}">` +
			`<label for="${id}">${esc(c.label)}${c.obbl ? ' <span class="rt-obbl">*</span>' : ""}</label>${input}</div>`;
	}

	// Legge l'input e lo mette in obj (S.campi o S.nuova), con le regole dei tipi speciali
	function leggiCampo(input, obj) {
		const k = input.dataset.campo;
		const tipo = input.dataset.tipo;
		if (tipo === "maiuscolo") {
			const a = input.selectionStart, b = input.selectionEnd;
			input.value = input.value.toUpperCase();
			try { input.setSelectionRange(a, b); } catch (e) { /* alcuni input non lo permettono */ }
			obj[k] = input.value;
		} else if (tipo === "euro") {
			// solo cifre e una virgola; la formattazione con i punti arriva quando si esce dal campo
			let raw = input.value.replace(/[^\d,]/g, "");
			const v = raw.indexOf(",");
			if (v !== -1) raw = raw.slice(0, v + 1) + raw.slice(v + 1).replace(/,/g, "");
			input.value = raw;
			const n = parseFloat(raw.replace(",", "."));
			obj[k] = raw === "" || isNaN(n) ? "" : n;
		} else if (tipo === "priorita") {
			obj[k] = Number(input.value);
		} else {
			obj[k] = input.value;
		}
	}

	// ---------------- NUOVA RICHIESTA ----------------

	function renderNuova() {
		S.nuova = { priorita: 2 };
		$("#rt-nuova-errore").hidden = true;
		$("#rt-nuova-form").innerHTML = FASI[0].campi.map(c => campoHtml(c, S.nuova[c.k], "nuova")).join("");
		const b = $("#rt-nuova-invia");
		b.disabled = false;
	}

	async function inviaNuova() {
		const n = S.nuova;
		const errore = !haValore(n.codice_componente) ? "Descrizione breve obbligatoria."
			: !haValore(n.area) ? "Seleziona un'area."
			: !haValore(n.centro_costo) ? "Centro di costo obbligatorio."
			: !haValore(n.macchina) ? "Targa macchina obbligatoria."
			: "";
		const box = $("#rt-nuova-errore");
		if (errore) { box.textContent = errore; box.hidden = false; return; }
		box.hidden = true;

		const btn = $("#rt-nuova-invia");
		btn.disabled = true;
		try {
			const campi = {};
			FASI[0].campi.forEach(c => { campi[c.k] = n[c.k] == null ? "" : n[c.k]; });
			const r = await api("crea", { body: { campi: campi } });
			await caricaElenco();
			S.indietro = "#/dashboard";
			window.location.hash = "#/pratica/" + r.id;
		} catch (e) {
			box.textContent = e.message;
			box.hidden = false;
			btn.disabled = false;
		}
	}

	// ---------------- DETTAGLIO PRATICA ----------------

	async function apriPratica(id) {
		S.modifica = null;
		S.noteRuo = "";
		S.aperte = {};
		$("#rt-pratica").innerHTML = `<div class="rt-loading"><span class="rt-spinner"></span>Caricamento…</div>`;
		$("#rt-pratica-indietro").setAttribute("href", S.indietro);
		await caricaPratica(id);
	}

	async function caricaPratica(id) {
		try {
			const data = await api("pratica", { id: id });
			// se la pratica e' andata avanti (o indietro) si torna alle schede di base: aperta solo quella attiva
			const prima = S.pratica && S.pratica.id === data.pratica.id ? S.pratica.stato : null;
			if (prima !== data.pratica.stato) S.aperte = {};
			S.pratica = data.pratica;
			S.log = data.log || [];
			renderPratica();
		} catch (e) {
			$("#rt-pratica").innerHTML = `<div class="rt-alert rt-alert-danger">${esc(e.message)}</div>`;
		}
	}

	function renderPratica() {
		const p = S.pratica;
		if (!p) return;
		const hero =
			`<div class="rt-fase rt-hero">` +
				`<div class="rt-hero-top">` +
					`<div>${dot(p)}<span class="rt-hero-numero">${esc(p.numero_pratica || p.codice_componente)}</span></div>` +
					badgeStato(p.stato) +
				`</div>` +
				(p.descrizione ? `<p class="rt-hero-titolo">${esc(p.descrizione)}</p>` : "") +
				`<span class="rt-pill">${esc(priorita(p))}</span>` +
			`</div>`;

		const chiusa = p.stato === "chiuso"
			? `<div class="rt-alert rt-alert-success"><i class="bi bi-check-circle-fill"></i>Pratica conclusa e chiusa.</div>` : "";

		$("#rt-pratica").innerHTML = hero + FASI.map(f => renderFase(f, p)).join("") + chiusa + renderStorico();
		aggiornaBottoniModulo();
	}

	function renderFase(f, p) {
		const st = statoFase(f, p.stato);
		const classe = f.key === "manutentori" ? "completata" : st; // la card Manutentori appare sempre compilata
		let corpo;
		if (f.key === "ruo") corpo = corpoRuo(p, st);
		else if (f.key === "magazzino_3") corpo = corpoChiusura(f, p, st);
		else if (S.modifica === f.key) corpo = moduloFase(f, st);
		else if (f.key === "manutentori" || st === "completata") {
			corpo = vistaFase(f, p) + (puoModificare(f, p)
				? `<div class="rt-fase-body rt-pt0"><button type="button" class="rt-btn rt-btn-outline rt-btn-sm" data-modifica="${f.key}"><i class="bi bi-pencil"></i>Modifica</button></div>` : "");
		}
		else if (st === "futura") corpo = attesaCompilazione();
		else corpo = `<div class="rt-fase-body">` + (puoModificare(f, p)
			? `<button type="button" class="rt-btn rt-btn-outline rt-btn-sm" data-modifica="${f.key}"><i class="bi bi-pencil"></i>Compila dati</button>`
			: `<span class="rt-muted rt-small">In attesa di ${esc(f.chi)}</span>`) + `</div>`;

		const nota = classe === "completata" ? "Completata" : classe === "attiva" ? "Da fare ora" : "";
		return scheda(f.key, "fase-" + classe, f.icona, f.titolo, nota, corpo);
	}

	/* ----- schede apribili: di base e' aperta solo la fase su cui si lavora adesso ----- */

	// La fase "attiva in questo momento": quella dello stato attuale (nessuna se la pratica e' chiusa)
	function faseCorrente(p) {
		const f = FASI[indiceCorrente(p.stato)];
		return f ? f.key : null;
	}

	function schedaAperta(key) {
		if (S.modifica === key) return true;                       // chi sta scrivendo non perde il modulo
		if (Object.prototype.hasOwnProperty.call(S.aperte, key)) return S.aperte[key];
		return key === faseCorrente(S.pratica);
	}

	function scheda(key, classe, icona, titolo, nota, corpo) {
		const aperta = schedaAperta(key);
		return `<div class="rt-fase ${classe}${aperta ? "" : " is-chiusa"}" data-fase="${key}">` +
			`<h2 class="rt-fase-titolo"><button type="button" class="rt-fase-toggle" data-toggle-fase="${key}" aria-expanded="${aperta}">` +
				`<i class="bi ${icona}"></i><span class="rt-fase-nome">${esc(titolo)}</span>` +
				(nota ? `<span class="rt-fase-nota">${esc(nota)}</span>` : "") +
				`<svg class="rt-chevron" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708"/></svg>` +
			`</button></h2>` +
			`<div class="rt-fase-corpo">${corpo}</div></div>`;
	}

	// Apre/chiude una scheda senza ridisegnare la pagina (un modulo aperto altrove resta com'e')
	function toggleScheda(key) {
		const el = $(`#rt-pratica [data-fase="${key}"]`);
		if (!el) return;
		const aperta = el.classList.contains("is-chiusa"); // era chiusa: ora si apre
		S.aperte[key] = aperta;
		el.classList.toggle("is-chiusa", !aperta);
		const b = $("[data-toggle-fase]", el);
		if (b) b.setAttribute("aria-expanded", String(aperta));
	}

	function attesaCompilazione() {
		return `<div class="rt-fase-body rt-attesa"><i class="bi bi-hourglass-split"></i>In attesa di compilazione</div>`;
	}

	function vistaFase(f, p) {
		let voci;
		if (f.vista) voci = f.vista(p);
		else {
			voci = (f.primaDeiCampi ? f.primaDeiCampi(p) : []).concat(
				f.campi.filter(c => !(c.nascondiSeVuoto && !haValore(p[c.k])))
					.map(c => ({ label: c.labelVista || c.label.replace(/\s*\(€\)$/, ""), valore: mostraValore(c, p[c.k]), largo: c.largo })));
		}
		const unaColonna = voci.length === 1;
		return `<div class="rt-grid${unaColonna ? " rt-grid-1" : ""}">` + voci.map(v =>
			`<div class="rt-field${v.largo ? " rt-largo" : ""}"><span class="rt-field-label">${esc(v.label)}</span>` +
			`<span class="rt-field-value">${esc(v.valore || "—")}</span></div>`).join("") + `</div>`;
	}

	function moduloFase(f, st) {
		const bottoni = [];
		if (st === "attiva" && f.avanti)
			bottoni.push(`<button type="button" class="rt-btn rt-btn-avanza rt-btn-sm" data-azione="avanza" data-fase-btn="${f.key}"><i class="bi bi-arrow-right-circle"></i>${esc(f.bottone)}</button>`);
		if (st === "completata" || f.key === "manutentori")
			bottoni.push(`<button type="button" class="rt-btn rt-btn-primary rt-btn-sm" data-azione="salva" data-fase-btn="${f.key}"><i class="bi bi-check-circle"></i>Salva</button>`);
		bottoni.push(`<button type="button" class="rt-btn rt-btn-outline rt-btn-sm" data-azione="annulla">Annulla</button>`);

		return `<div class="rt-fase-form" data-form="pratica">` +
			`<div class="rt-form">${f.campi.map(c => campoHtml(c, S.campi[c.k], "pratica")).join("")}</div>` +
			`<div class="rt-actions">${bottoni.join("")}</div></div>`;
	}

	// Avanza (e Salva per i Manutentori) restano spenti finche' mancano i campi obbligatori
	function aggiornaBottoniModulo() {
		if (!S.modifica) return;
		const f = FASI[indice(S.modifica)];
		const ok = completa(f, S.campi);
		$$(`[data-fase-btn="${f.key}"]`).forEach(b => {
			if (b.dataset.azione === "avanza" || f.key === "manutentori") b.disabled = !ok;
		});
	}

	function corpoRuo(p, st) {
		if (st === "futura") return attesaCompilazione();

		const moduloNote = (bottoni) =>
			`<div class="rt-fase-form" data-form="ruo">` +
				`<div class="rt-campo" style="--span:12"><label for="rt-note-ruo">Note approvazione (opzionale)</label>` +
				`<textarea id="rt-note-ruo" rows="2">${esc(S.noteRuo)}</textarea></div>` +
				`<div class="rt-actions">${bottoni}</div></div>`;
		const approva = `<button type="button" class="rt-btn rt-btn-avanza rt-btn-sm" data-azione="approva"><i class="bi bi-check-circle"></i>Approva</button>`;
		const rifiuta = `<button type="button" class="rt-btn rt-btn-danger rt-btn-sm" data-azione="rifiuta"><i class="bi bi-x-circle"></i>Rifiuta</button>`;
		const annulla = `<button type="button" class="rt-btn rt-btn-outline rt-btn-sm" data-azione="annulla">Annulla</button>`;

		if (S.modifica === "ruo")
			return moduloNote((p.stato !== "accettata" ? approva : "") + (p.stato !== "rifiutato" ? rifiuta : "") + annulla);

		if (st === "completata") {
			return `<div class="rt-fase-body">` +
				(p.stato === "rifiutato" ? `<span class="rt-badge st-rifiutato">Rifiutata</span>` : `<span class="rt-badge st-accettata">Accettata</span>`) +
				(p.note_ruo ? `<p class="rt-muted rt-small rt-mt">${esc(p.note_ruo)}</p>` : "") + `</div>` +
				(puoModificareRuo(p)
					? `<div class="rt-fase-body rt-pt0"><button type="button" class="rt-btn rt-btn-outline rt-btn-sm" data-modifica="ruo"><i class="bi bi-pencil"></i>Modifica</button></div>` : "");
		}

		// attiva
		if (puoApprovare()) return moduloNote(approva + rifiuta);
		return `<div class="rt-fase-body"><span class="rt-muted rt-small">In attesa di approvazione RUO</span></div>`;
	}

	function corpoChiusura(f, p, st) {
		if (st === "futura") return attesaCompilazione();
		if (st === "completata") return `<div class="rt-fase-body rt-ok"><i class="bi bi-check-circle-fill"></i>Pratica chiusa da Magazzino.</div>`;
		return `<div class="rt-fase-body">` + (puoModificare(f, p)
			? `<button type="button" class="rt-btn rt-btn-avanza rt-btn-sm" data-azione="avanza" data-fase-btn="${f.key}" data-chiusura="1"><i class="bi bi-check-circle"></i>${esc(f.bottone)}</button>`
			: `<span class="rt-muted rt-small">In attesa di ${esc(f.chi)}</span>`) + `</div>`;
	}

	function renderStorico() {
		if (!S.log.length) return "";
		const voci = S.log.slice().reverse().map(l =>
			`<li><span class="rt-storico-data">${esc(dataIt(l.data))} ${esc(String(l.data).slice(11, 16))}</span>` +
			`<span><strong>${esc(l.azione)}</strong>${l.dettaglio ? " — " + esc(l.dettaglio) : ""}` +
			`<span class="rt-muted"> · ${esc(l.nome || l.username)}</span></span></li>`).join("");
		return scheda("storico", "", "bi-clock-history", "Storico", S.log.length + (S.log.length === 1 ? " evento" : " eventi"),
			`<ul class="rt-storico">${voci}</ul>`);
	}

	function apriModifica(key) {
		const p = S.pratica;
		const f = FASI[indice(key)];
		S.campi = {};
		f.campi.forEach(c => { S.campi[c.k] = p[c.k] == null ? "" : p[c.k]; });
		if (key === "ruo") S.noteRuo = p.note_ruo || "";
		S.modifica = key;
		renderPratica();
		const primo = $(`[data-fase="${key}"] input, [data-fase="${key}"] select, [data-fase="${key}"] textarea`);
		if (primo) primo.focus();
	}

	function valoriFase(f) {
		const campi = {};
		f.campi.forEach(c => { campi[c.k] = S.campi[c.k] == null ? "" : S.campi[c.k]; });
		return campi;
	}

	// Dopo ogni modifica: si ricarica la pratica (dati + storico) e, in sottofondo, l'elenco per i numerini del menu
	async function dopoModifica(messaggio) {
		S.modifica = null;
		S.noteRuo = "";
		avviso(messaggio);
		await caricaPratica(S.pratica.id);
		caricaElenco().catch(() => { /* i numerini si aggiornano alla prossima apertura */ });
	}

	async function eseguiInPratica(fn, bottone) {
		if (bottone) bottone.disabled = true;
		try {
			await fn();
		} catch (e) {
			avviso(e.message, true);
			if (bottone) bottone.disabled = false;
		}
	}

	function avanza(key, bottone) {
		const f = FASI[indice(key)];
		const campi = S.modifica === key ? valoriFase(f) : {};
		return eseguiInPratica(async () => {
			await api("avanza", { body: { id: S.pratica.id, card: key, campi: campi } });
			await dopoModifica(f.avanti === "chiuso" ? "Pratica chiusa." : "Fase confermata.");
		}, bottone);
	}

	function salva(key, bottone) {
		const f = FASI[indice(key)];
		return eseguiInPratica(async () => {
			const body = { id: S.pratica.id, card: key, campi: valoriFase(f) };
			let r = await api("salva", { body: body });
			if (r.regressione) {
				if (!confirm(r.message)) { if (bottone) bottone.disabled = false; return; } // annullato: nulla e' stato scritto
				body.conferma = true;
				r = await api("salva", { body: body });
			}
			await dopoModifica("Dati salvati.");
		}, bottone);
	}

	function decidi(esito, bottone) {
		return eseguiInPratica(async () => {
			await api("decidi", { body: { id: S.pratica.id, esito: esito, note: S.noteRuo } });
			await dopoModifica(esito === "accettata" ? "Pratica approvata." : "Pratica rifiutata.");
		}, bottone);
	}

	// ---------------- ANALISI FORNITORI ----------------

	function giorniTra(a, b) {
		if (!a || !b) return null;
		return Math.round((parseData(b) - parseData(a)) / 864e5);
	}

	function tempoPromesso(p) {
		if (!p.tempo_consegna_valore || !p.tempo_consegna_unita) return null;
		return p.tempo_consegna_unita === "settimane" ? p.tempo_consegna_valore * 7 : p.tempo_consegna_valore;
	}

	const media = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

	function statsFornitori(pratiche) {
		const gruppi = new Map();
		pratiche.forEach(p => {
			const k = String(p.fornitore).toUpperCase();
			if (!gruppi.has(k)) gruppi.set(k, []);
			gruppi.get(k).push(p);
		});
		return Array.from(gruppi.entries()).map(([fornitore, lista]) => {
			let puntuali = 0, inRitardo = 0;
			lista.forEach(p => {
				// puntuale se il rientro e' entro la data di ritardo (se c'e') o la data consegna fornitore
				const rif = p.data_ritardo || p.data_consegna_fornitore;
				if (rif && p.data_rientro_effettiva) {
					if (parseData(p.data_rientro_effettiva) <= parseData(rif)) puntuali++; else inRitardo++;
				}
			});
			const valutate = puntuali + inRitardo;
			return {
				fornitore: fornitore,
				numero: lista.length,
				promesso: media(lista.map(tempoPromesso).filter(v => v !== null)),
				effettivo: media(lista.map(p => giorniTra(p.data_ordine, p.data_rientro_effettiva)).filter(v => v !== null)),
				puntualita: valutate ? Math.round(puntuali / valutate * 100) : null
			};
		}).sort((a, b) => b.numero - a.numero);
	}

	// Giorni di ritardo medi (rientro - data attesa) per mese di rientro, per i 5 fornitori con piu' pratiche
	function andamentoMensile(pratiche, stats) {
		const top = stats.slice(0, 5).map(s => s.fornitore);
		const mesi = new Set();
		const dati = new Map();
		pratiche.forEach(p => {
			const f = String(p.fornitore).toUpperCase();
			const rif = p.data_ritardo || p.data_consegna_fornitore;
			if (!top.includes(f) || !rif || !p.data_rientro_effettiva) return;
			const mese = p.data_rientro_effettiva.slice(0, 7);
			mesi.add(mese);
			if (!dati.has(f)) dati.set(f, new Map());
			const m = dati.get(f);
			if (!m.has(mese)) m.set(mese, []);
			m.get(mese).push(giorniTra(rif, p.data_rientro_effettiva) || 0);
		});
		const elencoMesi = Array.from(mesi).sort();
		const serie = top.filter(f => dati.has(f)).map(f => ({
			fornitore: f,
			valori: elencoMesi.map(m => media(dati.get(f).get(m) || []) || 0)
		}));
		return { mesi: elencoMesi, serie: serie };
	}

	function renderFornitori() {
		const pratiche = S.pratiche.filter(p => haValore(p.fornitore));
		const stats = statsFornitori(pratiche);
		$("#rt-fornitori-vuota").hidden = stats.length > 0;
		$("#rt-fornitori-dati").hidden = stats.length === 0;

		$("#rt-fornitori-tabella").innerHTML = stats.map(s =>
			`<tr><td class="rt-forte">${esc(s.fornitore)}</td><td>${s.numero}</td>` +
			`<td>${s.promesso !== null ? s.promesso + " giorni" : "—"}</td>` +
			`<td>${s.effettivo !== null ? s.effettivo + " giorni" : "—"}</td>` +
			`<td>${s.puntualita !== null ? s.puntualita + "%" : "—"}</td></tr>`).join("");

		S.grafici.forEach(g => g.destroy());
		S.grafici = [];
		if (!stats.length) return;
		if (!window.Chart) {
			$$("#rt-fornitori-dati .rt-chart").forEach(c => { c.innerHTML = `<p class="rt-muted rt-small">Grafico non disponibile: la libreria dei grafici non si è caricata.</p>`; });
			return;
		}

		const assi = titoloY => ({
			x: { ticks: { color: "#7E8299" }, grid: { color: "#EBEDF3" } },
			y: { beginAtZero: true, ticks: { color: "#7E8299" }, grid: { color: "#EBEDF3" }, title: { display: true, text: titoloY, color: "#7E8299" } }
		});
		const legenda = { labels: { color: "#3F4254", usePointStyle: true, pointStyle: "circle", padding: 16 } };

		const ctx = $("#rt-chart-tempi").getContext("2d");
		const grad = (c1, c2) => { const g = ctx.createLinearGradient(0, 0, 0, 360); g.addColorStop(0, c1); g.addColorStop(1, c2); return g; };
		S.grafici.push(new window.Chart(ctx, {
			type: "bar",
			data: {
				labels: stats.map(s => s.fornitore),
				datasets: [
					{ label: "Tempo promesso (giorni)", data: stats.map(s => s.promesso || 0), backgroundColor: grad("#60a5fa", "#2563eb"), borderRadius: 8, borderSkipped: false, barPercentage: 0.7, categoryPercentage: 0.6 },
					{ label: "Tempo effettivo (giorni)", data: stats.map(s => s.effettivo || 0), backgroundColor: grad("#fbbf24", "#d97706"), borderRadius: 8, borderSkipped: false, barPercentage: 0.7, categoryPercentage: 0.6 }
				]
			},
			options: { responsive: true, maintainAspectRatio: false, scales: assi("Giorni"), plugins: { legend: legenda } }
		}));

		const andamento = andamentoMensile(pratiche, stats);
		const colori = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4"];
		if (andamento.mesi.length) {
			S.grafici.push(new window.Chart($("#rt-chart-andamento").getContext("2d"), {
				type: "line",
				data: {
					labels: andamento.mesi,
					datasets: andamento.serie.map((s, i) => ({
						label: s.fornitore, data: s.valori, borderColor: colori[i % colori.length],
						backgroundColor: colori[i % colori.length], tension: 0.3, fill: false
					}))
				},
				options: { responsive: true, maintainAspectRatio: false, scales: assi("Giorni di ritardo medi"), plugins: { legend: legenda } }
			}));
		}
	}

	/* =====================================================================
	   6. EVENTI e AVVIO
	   ===================================================================== */

	async function route() {
		const m = /^#\/([a-z]+)(?:\/(\d+))?/.exec(window.location.hash || "");
		let vista = m ? m[1] : "dashboard";
		const id = m && m[2] ? Number(m[2]) : null;
		if (!VISTE.includes(vista) || (vista === "pratica" && !id)) vista = "dashboard";
		if (vista === "nuova" && !puoCreare()) { window.location.replace("#/dashboard"); return; }
		if (vista !== "pratica" && vista !== "nuova") S.indietro = "#/" + vista; // il bottone "indietro" del dettaglio torna qui

		mostraVista(vista);
		erroreGenerale("");

		try {
			if (vista === "pratica") { await apriPratica(id); return; }
			if (vista === "nuova") { renderNuova(); return; }

			// le liste si disegnano subito con i dati che ci sono e si ridisegnano con quelli freschi
			const disegna = () => {
				if (S.vista !== vista) return;
				if (vista === "ruo") renderRuo();
				else if (vista === "fornitori") renderFornitori();
				else renderTabella(vista);
			};
			if (S.caricato) disegna();
			await caricaElenco();
			disegna();
		} catch (e) {
			erroreGenerale(e.message);
		}
	}

	function collegaEventi() {
		window.addEventListener("hashchange", route);

		// ---- tabelle ----
		document.addEventListener("click", ev => {
			const t = ev.target;

			const th = t.closest("[data-filtro-col]");
			if (th) { ev.stopPropagation(); apriPopover(S.vista, th.dataset.filtroCol, th); return; }
			if (t.closest("#rt-popover")) return;
			chiudiPopover();

			const del = t.closest("[data-elimina]");
			if (del) { ev.stopPropagation(); eliminaPratica(Number(del.dataset.elimina)); return; }

			const tr = t.closest("tr[data-id]");
			if (tr) { window.location.hash = "#/pratica/" + tr.dataset.id; return; }

			const kpi = t.closest(".rt-kpi");
			if (kpi) {
				S.colore = S.colore === kpi.dataset.colore ? "" : kpi.dataset.colore;
				renderRighe("dashboard");
				return;
			}

			const reset = t.closest("[data-azione=reset]");
			if (reset) { resetFiltri(S.vista); return; }

			// ---- dettaglio pratica ----
			const tog = t.closest("[data-toggle-fase]");
			if (tog) { toggleScheda(tog.dataset.toggleFase); return; }

			const mod = t.closest("[data-modifica]");
			if (mod) { apriModifica(mod.dataset.modifica); return; }

			const az = t.closest("#rt-pratica [data-azione]");
			if (az && !az.disabled) {
				const a = az.dataset.azione;
				if (a === "annulla") { S.modifica = null; S.noteRuo = ""; renderPratica(); }
				else if (a === "avanza") avanza(az.dataset.faseBtn, az);
				else if (a === "salva") salva(az.dataset.faseBtn, az);
				else if (a === "approva") decidi("accettata", az);
				else if (a === "rifiuta") decidi("rifiutato", az);
			}
		});

		document.addEventListener("keydown", ev => {
			if (ev.key === "Escape") chiudiPopover();
			if (ev.key === "Enter") {
				const tr = ev.target.closest && ev.target.closest("tr[data-id]");
				if (tr) window.location.hash = "#/pratica/" + tr.dataset.id;
				const th = ev.target.closest && ev.target.closest("[data-filtro-col]");
				if (th) apriPopover(S.vista, th.dataset.filtroCol, th);
			}
		});

		window.addEventListener("resize", chiudiPopover);

		// filtro di colonna: testo e caselle
		document.addEventListener("input", ev => {
			const t = ev.target;
			if (t.matches("[data-filtro-testo]") && S.popover) {
				S.filtri[S.popover.vista][t.dataset.filtroTesto] = t.value;
				renderRighe(S.popover.vista);
				aggiornaIntestazioni(S.popover.vista);
				return;
			}
			if (t.id === "rt-ricerca") {
				S.ricerca = t.value;
				renderRighe("dashboard");
				return;
			}
			const form = t.closest("[data-form]");
			if (form && t.dataset.campo) {
				leggiCampo(t, form.dataset.form === "nuova" ? S.nuova : S.campi);
				aggiornaBottoniModulo();
				return;
			}
			if (t.id === "rt-note-ruo") S.noteRuo = t.value;
		});

		document.addEventListener("change", ev => {
			const t = ev.target;
			if (t.matches("[data-filtro-val]") && S.popover) {
				const lista = S.filtri[S.popover.vista][S.popover.k];
				const v = t.dataset.filtroVal;
				const i = lista.indexOf(v);
				if (t.checked && i === -1) lista.push(v);
				if (!t.checked && i !== -1) lista.splice(i, 1);
				renderRighe(S.popover.vista);
				aggiornaIntestazioni(S.popover.vista);
				return;
			}
			const form = t.closest("[data-form]");
			if (form && t.dataset.campo) { // select e date
				leggiCampo(t, form.dataset.form === "nuova" ? S.nuova : S.campi);
				aggiornaBottoniModulo();
			}
		});

		// importo: quando si esce dal campo compare 1.500,50
		document.addEventListener("focusout", ev => {
			const t = ev.target;
			if (t.dataset && t.dataset.tipo === "euro") {
				const form = t.closest("[data-form]");
				const obj = form && form.dataset.form === "nuova" ? S.nuova : S.campi;
				t.value = euro(obj[t.dataset.campo]);
			}
		});

		$("#rt-ricerca-pulisci").addEventListener("click", () => {
			S.ricerca = "";
			$("#rt-ricerca").value = "";
			renderRighe("dashboard");
		});
		$("#rt-export").addEventListener("click", () => {
			esportaExcel().catch(e => avviso("Export non riuscito: " + e.message, true));
		});
		$("#rt-nuova-invia").addEventListener("click", inviaNuova);
	}

	async function avvia() {
		$("#rt-nuova-form").dataset.form = "nuova";
		collegaEventi();
		try {
			await caricaElenco();
		} catch (e) {
			$("#rt-loading").hidden = true;
			erroreGenerale(e.message);
			return;
		}
		$("#rt-loading").hidden = true;
		route();
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
	else avvia();
})();
