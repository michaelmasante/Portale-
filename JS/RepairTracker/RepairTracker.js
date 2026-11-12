(function () {
	"use strict";

	const API = "API/RepairTracker.ashx";
	const VERSIONE = "0.3.0";

	const STATI = {
		in_magazzino:         { label: "Attesa completamento anagrafica - Magazzino", cls: "st-in-magazzino" },
		richiesta_inoltrata:  { label: "Attesa fornitore - Team Ricambi",             cls: "st-richiesta-inoltrata" },
		attesa_spedizione:    { label: "Attesa data spedizione - Magazzino",          cls: "st-attesa-spedizione" },
		spedito:              { label: "Attesa rientro da spedito - Team Ricambi",    cls: "st-spedito" },
		attesa_approvazione:  { label: "Attesa approvazione - RUO",                   cls: "st-attesa-approvazione" },
		rifiutato:            { label: "Rifiutato",                                   cls: "st-rifiutato" },
		accettata:            { label: "Accettata - RUO",                             cls: "st-accettata" },
		rda_rilasciata:       { label: "Attesa ordine - Team Ricambi",                cls: "st-rda-rilasciata" },
		attesa_consegna:      { label: "Attesa consegna - Team Ricambi",              cls: "st-attesa-consegna" },
		consegnato_magazzino: { label: "Attesa chiusura pratica - Magazzino",         cls: "st-consegnato-magazzino" },
		chiuso:               { label: "Chiusa",                                      cls: "st-chiuso" }
	};

	const CODE = {
		magazzino: ["in_magazzino", "attesa_spedizione", "consegnato_magazzino"],
		ricambi: ["richiesta_inoltrata", "spedito", "accettata", "rda_rilasciata", "attesa_consegna"],
		ruo: ["attesa_approvazione"]
	};

	const PRIORITA = { 1: "Macchina ferma", 2: "Macchina lavora" };

	// Uguale a LabElettro in API/RepairTracker.ashx
	const LAB_ELETTRO = "Laboratorio Elettrotecnico";

	// Tenere uguale a Fasi in API/RepairTracker.ashx
	const FASI = [
		{
			key: "manutentori", titolo: "Manutentori", icona: "bi-tools", ruolo: "Manutentori", chi: "Manutentori",
			stato: null, avanti: null,
			campi: [
				{ k: "codice_componente", label: "Descrizione breve", tipo: "testo", obbl: true, placeholder: "Es. Motore linea 3" },
				{ k: "codice_sap", label: "Codice SAP", tipo: "testo", placeholder: "Es. 100234567" },
				{ k: "area", label: "Area", tipo: "area", obbl: true },
				{ k: "centro_costo", label: "Centro di costo", tipo: "centro", obbl: true },
				{ k: "macchina", label: "Targa macchina", tipo: "testo", obbl: true, placeholder: "Es. AB123CD" },
				{ k: "op", label: "Operazione", tipo: "testo", obbl: true, placeholder: "Es. OP 30" },
				{ k: "priorita", label: "Priorità", tipo: "priorita" },
				{ k: "tipo_guasto", label: "Tipo guasto", tipo: "scelta", fonte: "tipiGuasto" },
				{ k: "descrizione", label: "Descrizione e note", tipo: "testoLungo", span: 12, largo: true, placeholder: "Descrivi il componente e il guasto, aggiungi le note" }
			],
			primaDeiCampi: p => [
				{ label: "N. Pratica", valore: p.numero_pratica },
				{ label: "Data inserimento", valore: dataIt(p.data_inserimento) },
				{ label: "Richiesto da", valore: richiedente(p), largo: true }
			]
		},
		{
			key: "magazzino_1", titolo: "Magazzino", icona: "bi-building", ruolo: "Magazzino", chi: "Magazzino",
			stato: "in_magazzino", avanti: "richiesta_inoltrata", bottone: "Conferma e inoltra a Team Ricambi",
			campi: [
				{ k: "tipo_riparazione", label: "Tipo riparazione", tipo: "scelta", obbl: true, opzioni: ["Meccanica", "Elettronica", LAB_ELETTRO] },
				{ k: "ubicazione", label: "Ubicazione", tipo: "testo", obbl: true },
				{ k: "movimento_sap", label: "Movimento SAP", tipo: "testo", obbl: true, span: 12, largo: true },
				{ k: "previsione_riparazione", label: "Previsione riparazione", tipo: "data", se: ["tipo_riparazione", LAB_ELETTRO], largo: true,
				  aiuto: "Laboratorio Elettrotecnico: confermando, la pratica salta fornitore, spedizione, preventivo, RUO, RDA e ordine e passa direttamente al Rientro." }
			]
		},
		{
			key: "ricambi_1", titolo: "Team Ricambi", icona: "bi-box-seam", ruolo: "TeamRicambi", chi: "Team Ricambi",
			stato: "richiesta_inoltrata", avanti: "attesa_spedizione", bottone: "Conferma e passa a Magazzino", salvaBozza: true,
			campi: [
				{ k: "fornitore", label: "Fornitore", tipo: "maiuscolo", obbl: true },
				{ k: "bolla", label: "Bolla", tipo: "testo", obbl: true, span: 12, largo: true }
			]
		},
		{
			key: "magazzino_2", titolo: "Magazzino — Fase Spedizione", icona: "bi-building", ruolo: "Magazzino", chi: "Magazzino",
			stato: "attesa_spedizione", avanti: "spedito", bottone: "Conferma e passa a Team Ricambi",
			campi: [
				{ k: "data_spedizione", label: "Data spedizione", tipo: "data", obbl: true, largo: true }
			]
		},
		{
			key: "ricambi_2", titolo: "Team Ricambi — Preventivo", icona: "bi-box-seam", ruolo: "TeamRicambi", chi: "Team Ricambi",
			stato: "spedito", avanti: "attesa_approvazione", bottone: "Conferma e invia al RUO", salvaBozza: true,
			campi: [
				{ k: "numero_preventivo", label: "Numero preventivo", tipo: "testo", placeholder: "Es. PRV-2026-118" },
				{ k: "preventivo", label: "Preventivo (€)", tipo: "euro", obbl: true },
				{ k: "tempo_consegna_valore", label: "Tempo di consegna", tipo: "testo", obbl: true, span: 12, placeholder: "Es. 2 settimane, 10 giorni, fine mese" }
			],
			vista: p => [
				{ label: "Numero preventivo", valore: p.numero_preventivo || "" },
				{ label: "Preventivo", valore: p.preventivo != null ? euro(p.preventivo) + " €" : "" },
				{ label: "Tempo di consegna", valore: tempoConsegna(p), largo: true }
			]
		},
		{
			key: "ruo", titolo: "RUO — Approvazione", icona: "bi-clipboard-check", ruolo: "RUO", chi: "approvazione RUO",
			stato: "attesa_approvazione", avanti: null,
			campi: []
		},
		{
			key: "ricambi_rda", titolo: "Team Ricambi — RDA", icona: "bi-box-seam", ruolo: "TeamRicambi", chi: "Team Ricambi",
			stato: "accettata", avanti: "rda_rilasciata", bottone: "Rilascia RDA e passa all'ordine", salvaBozza: true,
			campi: [
				{ k: "numero_rda", label: "Numero RDA", tipo: "testo", obbl: true },
				{ k: "data_rda", label: "Data RDA", tipo: "data", obbl: true, oggi: true },
				{ k: "rilascio_rda", label: "Rilascio RDA", tipo: "bool", obbl: true, span: 12, largo: true,
				  aiuto: "Senza la spunta si può salvare la richiesta, ma la pratica resta qui finché l'RDA non è rilasciata." }
			]
		},
		{
			key: "ricambi_ordine", titolo: "Team Ricambi — Ordine", icona: "bi-box-seam", ruolo: "TeamRicambi", chi: "Team Ricambi",
			stato: "rda_rilasciata", avanti: "attesa_consegna", bottone: "Conferma e passa ad Attesa consegna", salvaBozza: true,
			campi: [
				{ k: "numero_ordine", label: "Numero ordine", tipo: "testo", obbl: true },
				{ k: "data_ordine", label: "Data ordine", tipo: "data", obbl: true, oggi: true },
				{ k: "data_consegna_fornitore", label: "Data consegna fornitore", tipo: "data", obbl: true },
				{ k: "in_ritardo", label: "Pezzo in ritardo", tipo: "bool" },
				{ k: "data_ritardo", label: "Data consegna ritardo", tipo: "data", obbl: true, se: ["in_ritardo", true], largo: true }
			]
		},
		{
			key: "ricambi_4", titolo: "Team Ricambi — Rientro", icona: "bi-box-seam", ruolo: "TeamRicambi", chi: "Team Ricambi",
			stato: "attesa_consegna", avanti: "consegnato_magazzino", bottone: "Conferma e consegna a Magazzino", salvaBozza: true,
			campi: [
				{ k: "bolla_rientro", label: "Bolla di rientro", tipo: "testo", obbl: true },
				{ k: "data_rientro_effettiva", label: "Data rientro", tipo: "data", obbl: true },
				{ k: "entrata_merci_sap", label: "Entrata merci a SAP (numero)", tipo: "testo", obbl: true, span: 12, largo: true, labelVista: "Entrata merci a SAP" }
			]
		},
		{
			key: "magazzino_3", titolo: "Magazzino — Conferma chiusura", icona: "bi-building", ruolo: "Magazzino", chi: "Magazzino",
			stato: "consegnato_magazzino", avanti: "chiuso", bottone: "Conferma e chiudi pratica",
			istruzione: "Verifica la completezza della pratica (tutte le schede qui sopra) e conferma.",
			campi: []
		}
	];

	const COLONNE = [
		{ k: "numero_pratica", label: "N. Pratica", filtro: "testo", ph: "Cerca n. pratica...", w: 130, forte: true },
		{ k: "fornitore", label: "Fornitore", filtro: "testo", ph: "Cerca fornitore...", w: 150 },
		{ k: "codice_componente", label: "Descrizione", filtro: "testo", ph: "Cerca descrizione breve...", w: 190 },
		{ k: "richiedente", label: "Richiesto da", filtro: "testo", ph: "Cerca richiedente...", w: 150 },
		{ k: "area", label: "Area", filtro: "lista", w: 130 },
		{ k: "priorita", label: "Priorità", filtro: "lista", w: 100 },
		{ k: "stato", label: "Stato", filtro: "lista", w: 260 },
		{ k: "creato_il", label: "Data inserimento", w: 130 }
	];

	const COLONNE_EXCEL = [
		["N. Pratica", "numero_pratica", 14], ["Data inserimento", "data_inserimento", 16], ["Descrizione breve", "codice_componente", 22],
		["Codice SAP", "codice_sap", 14], ["Descrizione", "descrizione", 30], ["Tipo guasto", "tipo_guasto", 18], ["Targa macchina", "macchina", 18],
		["Operazione", "op", 12],
		["Area", "area", 16], ["Centro di costo", "centro_costo", 14], ["Descrizione centro di costo", "centro_descrizione", 30],
		["Tipo riparazione", "tipo_riparazione", 16], ["Ubicazione", "ubicazione", 16],
		["Movimento SAP", "movimento_sap", 16], ["Fornitore", "fornitore", 20], ["Bolla", "bolla", 14], ["Data spedizione", "data_spedizione", 16],
		["Previsione riparazione", "previsione_riparazione", 16],
		["Numero preventivo", "numero_preventivo", 16], ["Preventivo", "preventivo", 12], ["Tempo di consegna", "tempo_consegna", 18],
		["Data approvazione RUO", "data_approvazione", 18], ["Disponibile all'approvazione", "disponibile_mese", 16],
		["Numero RDA", "numero_rda", 14], ["Data RDA", "data_rda", 12], ["Rilascio RDA", "rilascio_label", 10],
		["Numero ordine", "numero_ordine", 14], ["Data ordine", "data_ordine", 14], ["Data consegna fornitore", "data_consegna_fornitore", 18],
		["Pezzo in ritardo", "ritardo_label", 12], ["Data consegna ritardo", "data_ritardo", 16],
		["Bolla di rientro", "bolla_rientro", 16], ["Data rientro effettiva", "data_rientro_effettiva", 16],
		["Entrata merci SAP", "entrata_merci_sap", 16], ["Priorità", "priorita", 10], ["Stato", "stato_label", 34],
		["Richiesto da", "richiedente", 22], ["Utente richiedente", "creato_da", 16], ["Creato il", "creato_il", 18]
	];

	const S = {
		io: null,
		opzioni: { aree: [], tipiGuasto: [] },
		pratiche: [],
		caricato: false,
		vista: null,
		filtri: {},
		ricerca: "",
		colore: "",
		popover: null,
		pratica: null,
		log: [],
		modifica: null,
		aperte: {},
		campi: {},
		budget: {},
		budgetPratica: null,
		gest: { tab: "budget", mese: "", budget: null, utenti: null, ruoli: [], cerca: "" },
		nuova: {},
		indietro: "#/dashboard",
		grafici: []
	};

	function nuoviFiltri() {
		return { numero_pratica: "", fornitore: "", codice_componente: "", richiedente: "", area: [], priorita: [], stato: [] };
	}
	["dashboard", "magazzino", "ricambi"].forEach(v => { S.filtri[v] = nuoviFiltri(); });

	function ha(ruolo) {
		if (!S.io) return false;
		const mie = (S.io.ruoli || []).map(r => String(r).toLowerCase());
		return mie.includes("admin") || mie.includes(String(ruolo).toLowerCase());
	}
	function haUno(lista) { return String(lista).split(",").map(s => s.trim()).filter(Boolean).some(ha); }
	function isAdmin() { return ha("Admin"); }
	function isAdminRepair() { return ha("Admin Repair"); }
	function puoCreare() { return haUno("Manutentori,TeamRicambi"); }
	const PREFISSO_RUO = "RUO ";

	function areeRuo() {
		if (!S.io) return [];
		if (ha("RUO")) return null;
		const mie = (S.io.ruoli || []).map(r => String(r).toLowerCase());
		return S.opzioni.aree.map(a => a.nome).filter(n => mie.includes((PREFISSO_RUO + n).toLowerCase()));
	}
	function isRuo() { const a = areeRuo(); return a === null || a.length > 0; }
	function puoApprovare(p) {
		const a = areeRuo();
		if (a === null) return true;
		return p ? a.includes(p.area) : a.length > 0;
	}
	function codaRuo() {
		const lista = S.pratiche.filter(p => p.stato === "attesa_approvazione");
		return isRuo() ? lista.filter(p => puoApprovare(p)) : lista;
	}

	function indice(key) { return FASI.findIndex(f => f.key === key); }

	function indiceCorrente(stato) {
		if (stato === "rifiutato") return indice("ruo");
		const i = FASI.findIndex(f => f.stato === stato);
		return i >= 0 ? i : FASI.length;
	}

	function isLab(p) { return !!p && p.tipo_riparazione === LAB_ELETTRO; }

	function saltata(f, lab) {
		const i = indice(f.key);
		return !!lab && i > indice("magazzino_1") && i < indice("ricambi_4");
	}

	function statoFase(f, stato, lab) {
		if (saltata(f, lab)) return "saltata";
		if (f.key === "manutentori") return stato === "in_magazzino" ? "attiva" : "completata";
		if (stato === "rifiutato" && f.key === "ruo") return "completata";
		const i = indice(f.key), cur = indiceCorrente(stato);
		if (i < cur) return "completata";
		if (i === cur) return "attiva";
		return "futura";
	}

	function successivaHaDati(f, p) {
		let j = indice(f.key) + 1;
		while (j < FASI.length && saltata(FASI[j], isLab(p))) j++;
		const s = FASI[j];
		if (!s) return false;
		if (s.key === "ruo") return p.stato === "rifiutato" || indiceCorrente(p.stato) > j;
		if (!s.campi.length) return indiceCorrente(p.stato) > j;
		return s.campi.some(c => c.tipo === "bool" ? p[c.k] === true : haValore(p[c.k]));
	}

	function puoModificare(f, p) {
		const st = statoFase(f, p.stato, isLab(p));
		if (st === "futura" || st === "saltata") return false;
		if (isAdmin()) return true;
		if (st === "completata" && successivaHaDati(f, p)) return false;
		return ha(f.ruolo);
	}

	function puoModificareRuo(p) {
		return isAdmin() && (p.stato === "accettata" || p.stato === "rifiutato");
	}

	function condizione(c, valori) { return !c.se || valori[c.se[0]] === c.se[1]; }
	function obbligatorio(c, valori) { return !!c.obbl && condizione(c, valori); }

	function completa(f, valori) {
		return f.campi.every(c => !obbligatorio(c, valori) || (c.tipo === "bool" ? valori[c.k] === true : haValore(valori[c.k])));
	}

	const PRIMA_DEL_RUO = ["in_magazzino", "richiesta_inoltrata", "attesa_spedizione", "spedito"];
	function colore(p) {
		if (isLab(p)) return p.stato === "chiuso" ? "green" : "grey";
		if (p.stato === "rifiutato") return "red";
		if (p.stato === "attesa_approvazione") return "orange";
		if (PRIMA_DEL_RUO.includes(p.stato)) return "grey";
		return "green";
	}

	function attesaRda(p) { return p.stato === "accettata"; }
	function inRitardo(p) { return p.in_ritardo === true && ["accettata", "rda_rilasciata", "attesa_consegna"].includes(p.stato); }
	function rientrata(p) { return p.stato === "consegnato_magazzino"; }

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

	function dataIt(s) {
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
		return m ? m[3] + "/" + m[2] + "/" + m[1] : (s || "");
	}

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
	function tempoConsegna(p) { return p.tempo_consegna_valore == null ? "" : String(p.tempo_consegna_valore); }
	function oggiIso() {
		const d = new Date();
		return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
	}
	function richiedente(p) { return p.creato_nome || p.creato_da || ""; }

	function centriDi(area) {
		const a = S.opzioni.aree.find(x => x.nome === area);
		return a ? a.centri : [];
	}
	function codiciCentri(area) { return centriDi(area).map(c => c.codice); }
	function descrizioneCentro(area, codice) {
		const c = centriDi(area).find(x => x.codice === codice);
		return c ? c.descrizione : "";
	}
	function nomeCentro(area, codice) {
		if (!haValore(codice)) return "";
		const d = descrizioneCentro(area, codice);
		return d ? codice + " — " + d : String(codice);
	}

	function nomeMese(anno, mese) {
		return new Date(anno, mese - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
	}

	function vaiAlLogin() {
		window.location.href = "Login.html?ReturnUrl=" + encodeURIComponent(window.location.pathname + window.location.search);
	}

	async function api(action, opzioni) {
		const o = opzioni || {};
		let url = API + "?action=" + encodeURIComponent(action);
		if (o.id) url += "&id=" + encodeURIComponent(o.id);
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

	const VISTE = ["dashboard", "magazzino", "ricambi", "ruo", "nuova", "pratica", "gestione", "fornitori"];

	function mostraVista(vista) {
		S.vista = vista;
		chiudiPopover();
		$$(".rt-vista").forEach(s => { s.hidden = s.dataset.vista !== vista; });
		$$("#rt-nav a").forEach(a => a.classList.toggle("is-on", a.dataset.vista === vista));
	}

	function aggiornaMenu() {
		$$("#rt-nav a").forEach(a => {
			const r = a.dataset.ruoliRt;
			a.hidden = a.dataset.vista === "ruo" ? !(isRuo() || ha("Riparazioni")) : (!!r && !haUno(r));
		});
		Object.keys(CODE).forEach(coda => {
			const n = coda === "ruo" ? codaRuo().length : S.pratiche.filter(p => CODE[coda].includes(p.stato)).length;
			$$(`[data-coda="${coda}"]`).forEach(el => { el.textContent = n > 0 ? n : ""; el.hidden = n === 0; });
		});
	}

	async function caricaElenco() {
		const data = await api("elenco");
		S.io = data.io;
		if (data.opzioni) S.opzioni = data.opzioni;
		S.budget = data.budget || {};
		S.pratiche = data.pratiche || [];
		S.caricato = true;
		aggiornaMenu();
	}

	function praticheDellaVista(vista) {
		if (vista === "dashboard") return S.pratiche;
		return S.pratiche.filter(p => CODE[vista].includes(p.stato));
	}

	function valoreColonna(p, k) {
		if (k === "priorita") return "P" + p.priorita;
		if (k === "stato") return labelStato(p.stato);
		if (k === "creato_il") return dataIt(p.creato_il);
		if (k === "richiedente") return richiedente(p);
		return p[k] == null ? "" : String(p[k]);
	}

	function matchRicerca(p) {
		const t = S.ricerca.trim().toLowerCase();
		if (!t) return true;
		return ["numero_pratica", "fornitore", "codice_componente", "richiedente", "area", "priorita", "stato", "creato_il"]
			.some(k => valoreColonna(p, k).toLowerCase().includes(t));
	}

	function praticheFiltrate(vista) {
		const f = S.filtri[vista];
		return praticheDellaVista(vista).filter(p => {
			for (const c of COLONNE) {
				if (c.filtro === "testo" && f[c.k] && !valoreColonna(p, c.k).toLowerCase().includes(f[c.k].toLowerCase())) return false;
				if (c.filtro === "lista" && f[c.k].length && !f[c.k].includes(String(p[c.k]))) return false;
			}
			if (vista === "dashboard") {
				if (S.colore === "ritardo" ? !inRitardo(p) : S.colore === "rda" ? !attesaRda(p) : (S.colore && colore(p) !== S.colore)) return false;
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
				`<tr data-id="${p.id}" tabindex="0"${inRitardo(p) ? ' class="rt-riga-ritardo" title="Pezzo in ritardo"' : rientrata(p) ? ' class="rt-riga-rientrata" title="Rientrata: manca la chiusura del Magazzino"' : ""}>` +
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
			["grey", "orange", "green", "red"].forEach(c => {
				$(`[data-kpi=${c}]`).textContent = S.pratiche.filter(p => colore(p) === c).length;
			});
			$("[data-kpi=ritardo]").textContent = S.pratiche.filter(inRitardo).length;
			$("[data-kpi=rda]").textContent = S.pratiche.filter(attesaRda).length;
			$$(".rt-kpi").forEach(k => k.classList.toggle("is-on", k.dataset.colore === S.colore));
			$("#rt-export").hidden = righe.length === 0;
			$("#rt-ricerca-pulisci").hidden = !S.ricerca;
		}
	}

	function aggiornaIntestazioni(vista) {
		$$(`.rt-vista[data-vista="${vista}"] [data-filtro-col]`).forEach(th => {
			const on = filtroAttivo(vista, th.dataset.filtroCol);
			th.classList.toggle("is-filtrato", on);
			const i = $("i", th);
			if (i) i.className = "bi " + (on ? "bi-funnel-fill" : "bi-chevron-down");
		});
	}

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

	async function esportaExcel() {
		const righe = praticheFiltrate("dashboard").map(p => {
			const r = {};
			COLONNE_EXCEL.forEach(([, k]) => { r[k] = p[k] == null ? "" : p[k]; });
			r.stato_label = labelStato(p.stato);
			r.richiedente = richiedente(p);
			r.centro_descrizione = descrizioneCentro(p.area, p.centro_costo);
			r.ritardo_label = p.in_ritardo ? "Sì" : "";
			r.rilascio_label = p.rilascio_rda ? "Sì" : "";
			r.tempo_consegna = tempoConsegna(p);
			return r;
		});
		const nome = "repair-tracker-export-" + new Date().toISOString().slice(0, 10);

		if (!window.ExcelJS) {
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

	function renderRuo() {
		const lista = codaRuo();
		const aree = areeRuo();
		$("#rt-ruo-titolo").textContent = !puoApprovare() ? "Richieste in attesa di approvazione RUO"
			: aree === null ? "Coda approvazioni RUO" : "Coda approvazioni RUO — " + aree.join(", ");
		$("#rt-ruo-vuota").hidden = lista.length > 0;
		$("#rt-ruo-lista").innerHTML = lista.map(p =>
			`<div class="rt-ruo-card">` +
				`<div class="rt-ruo-head"><strong>${esc(p.numero_pratica || p.codice_componente)}</strong><span>P${esc(p.priorita)}</span></div>` +
				`<div class="rt-ruo-body">` +
					`<p class="rt-muted">${esc(p.codice_componente)}</p>` +
					`<div><span class="rt-muted">Area:</span> ${esc(p.area || "—")}</div>` +
					`<div><span class="rt-muted">Fornitore:</span> ${esc(p.fornitore || "—")}</div>` +
					`<div><span class="rt-muted">Preventivo:</span> <strong>${p.preventivo != null ? esc(euro(p.preventivo)) + " €" : "—"}</strong></div>` +
					`<div><span class="rt-muted">Disponibile ${esc(meseCorrente())}:</span> <strong>${esc(testoDisponibile(S.budget[p.area]))}</strong></div>` +
					(oltreDisponibile(p) ? `<div class="rt-oltre">Preventivo oltre il disponibile</div>` : "") +
					`<div><span class="rt-muted">Tempo di consegna:</span> ${esc(tempoConsegna(p) || "—")}</div>` +
				`</div>` +
				`<a class="rt-btn rt-btn-primary rt-btn-sm rt-btn-block" href="#/pratica/${p.id}"><i class="bi bi-eye"></i>${puoApprovare(p) ? "Apri e gestisci" : "Visualizza"}</a>` +
			`</div>`
		).join("");
	}

	function meseCorrente() { const d = new Date(); return nomeMese(d.getFullYear(), d.getMonth() + 1); }

	function testoDisponibile(b) {
		if (!b || b.disponibile == null) return "budget non impostato";
		return euro(b.disponibile) + " €";
	}

	function oltreDisponibile(p, b) {
		const budget = b || S.budget[p.area];
		return p.preventivo != null && budget && budget.disponibile != null && Number(p.preventivo) > Number(budget.disponibile);
	}

	function mostraValore(c, v) {
		if (!haValore(v)) return "";
		switch (c.tipo) {
			case "data": return dataIt(v);
			case "euro": return euro(v) + " €";
			case "priorita": return "P" + v + " — " + (PRIORITA[v] || "");
			case "maiuscolo": return String(v).toUpperCase();
			case "bool": return v === true ? "Sì" : "No";
			default: return String(v);
		}
	}

	function campoHtml(c, valori, form) {
		const id = "rt-" + form + "-" + c.k;
		const v = valori[c.k];
		const val = v == null ? "" : v;
		const attr = `id="${id}" data-campo="${c.k}" data-tipo="${c.tipo}"`;
		const ph = c.placeholder ? ` placeholder="${esc(c.placeholder)}"` : "";
		let input;
		switch (c.tipo) {
			case "testoLungo":
				input = `<textarea ${attr} rows="${form === "nuova" ? 4 : 3}"${ph}>${esc(val)}</textarea>`;
				break;
			case "bool":
				return `<div class="rt-campo" style="--span:${c.span || 6}"><label>&nbsp;</label>` +
					`<label class="rt-check"><input type="checkbox" ${attr}${v === true ? " checked" : ""}> ${esc(c.label)}${c.obbl ? ' <span class="rt-obbl">*</span>' : ""}</label>` +
					(c.aiuto ? `<span class="rt-aiuto">${esc(c.aiuto)}</span>` : "") + `</div>`;
			case "area":
				input = `<select ${attr}><option value="">Seleziona area</option>` +
					S.opzioni.aree.map(a => `<option value="${esc(a.nome)}"${a.nome === val ? " selected" : ""}>${esc(a.nome)}</option>`).join("") + `</select>`;
				break;
			case "centro":
				input = `<select ${attr}${valori.area ? "" : " disabled"}>${opzioniCentro(valori.area, val)}</select>`;
				break;
			case "scelta": {
				const opzioni = c.fonte ? (S.opzioni[c.fonte] || []) : c.opzioni;
				input = `<select ${attr}><option value="">Seleziona</option>` +
					opzioni.map((o, i) => `<option value="${esc(o)}"${o === val ? " selected" : ""}>${esc(c.etichette ? c.etichette[i] : o)}</option>`).join("") + `</select>`;
				break;
			}
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
		const nascosto = !condizione(c, valori);
		const se = c.se ? ` data-se-campo="${esc(c.se[0])}" data-se-valore="${esc(JSON.stringify(c.se[1]))}"` : "";
		return `<div class="rt-campo" style="--span:${c.span || 6}"${se}${nascosto ? " hidden" : ""}>` +
			`<label for="${id}">${esc(c.label)}${c.obbl ? ' <span class="rt-obbl">*</span>' : ""}</label>${input}` +
			(c.aiuto ? `<span class="rt-aiuto">${esc(c.aiuto)}</span>` : "") + `</div>`;
	}

	function opzioniCentro(area, val) {
		if (!area) return `<option value="">Prima scegli l'area</option>`;
		const centri = centriDi(area);
		return `<option value="">Seleziona centro di costo</option>` +
			centri.map(c => `<option value="${esc(c.codice)}"${c.codice === val ? " selected" : ""}>${esc(c.codice + " — " + c.descrizione)}</option>`).join("");
	}

	function aggiornaCentro(form, obj) {
		const sel = form.querySelector('[data-tipo="centro"]');
		if (!sel) return;
		const k = sel.dataset.campo;
		if (obj[k] && !codiciCentri(obj.area).includes(obj[k])) obj[k] = "";
		sel.innerHTML = opzioniCentro(obj.area, obj[k] || "");
		sel.disabled = !obj.area;
	}

	function leggiCampo(input, obj) {
		const k = input.dataset.campo;
		const tipo = input.dataset.tipo;
		if (tipo === "maiuscolo") {
			const a = input.selectionStart, b = input.selectionEnd;
			input.value = input.value.toUpperCase();
			try { input.setSelectionRange(a, b); } catch (e) {  }
			obj[k] = input.value;
		} else if (tipo === "euro") {
			let raw = input.value.replace(/[^\d,]/g, "");
			const v = raw.indexOf(",");
			if (v !== -1) raw = raw.slice(0, v + 1) + raw.slice(v + 1).replace(/,/g, "");
			input.value = raw;
			const n = parseFloat(raw.replace(",", "."));
			obj[k] = raw === "" || isNaN(n) ? "" : n;
		} else if (tipo === "priorita") {
			obj[k] = Number(input.value);
		} else if (tipo === "bool") {
			obj[k] = input.checked;
		} else {
			obj[k] = input.value;
		}
	}

	function aggiornaVisibili(form, obj) {
		$$("[data-se-campo]", form).forEach(box => {
			const visibile = obj[box.dataset.seCampo] === JSON.parse(box.dataset.seValore);
			box.hidden = !visibile;
			if (!visibile) {
				const input = $("[data-campo]", box);
				if (input) { input.value = ""; obj[input.dataset.campo] = ""; }
			}
		});
		const b = $('[data-azione="avanza"][data-fase-btn="magazzino_1"]', form);
		if (b) b.lastChild.textContent = obj.tipo_riparazione === LAB_ELETTRO
			? "Conferma e passa al Rientro (Laboratorio Elettrotecnico)" : FASI[indice("magazzino_1")].bottone;
	}

	function renderNuova() {
		S.nuova = { priorita: 2 };
		$("#rt-nuova-errore").hidden = true;
		$("#rt-nuova-form").innerHTML = FASI[0].campi.map(c => campoHtml(c, S.nuova, "nuova")).join("");
		const b = $("#rt-nuova-invia");
		b.disabled = false;
	}

	async function inviaNuova() {
		const n = S.nuova;
		const manca = FASI[0].campi.find(c => c.obbl && !haValore(n[c.k]));
		const errore = manca ? "Campo obbligatorio: " + manca.label + "." : "";
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

	async function apriPratica(id) {
		S.modifica = null;
		S.aperte = {};
		$("#rt-pratica").innerHTML = `<div class="rt-loading"><span class="rt-spinner"></span>Caricamento…</div>`;
		$("#rt-pratica-indietro").setAttribute("href", S.indietro);
		await caricaPratica(id);
	}

	async function caricaPratica(id) {
		try {
			const data = await api("pratica", { id: id });
			const prima = S.pratica && S.pratica.id === data.pratica.id ? S.pratica.stato : null;
			if (prima !== data.pratica.stato) S.aperte = {};
			S.pratica = data.pratica;
			S.log = data.log || [];
			S.budgetPratica = data.budget || null;
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
		const st = statoFase(f, p.stato, isLab(p));
		const classe = f.key === "manutentori" ? "completata" : st;
		let corpo;
		if (st === "saltata") corpo = `<div class="rt-fase-body rt-attesa">Non serve: riparazione in ${esc(LAB_ELETTRO)}.</div>`;
		else if (f.key === "ruo") corpo = corpoRuo(p, st);
		else if (f.key === "magazzino_3") corpo = corpoChiusura(f, p, st);
		else if (S.modifica === f.key) corpo = moduloFase(f, st);
		else if (f.key === "manutentori" || st === "completata") {
			corpo = vistaFase(f, p) + (puoModificare(f, p)
				? `<div class="rt-fase-body rt-pt0"><button type="button" class="rt-btn rt-btn-outline rt-btn-sm" data-modifica="${f.key}"><i class="bi bi-pencil"></i>Modifica</button></div>` : "");
		}
		else if (st === "futura") corpo = attesaCompilazione();
		else {
			const iniziata = f.campi.some(c => c.tipo === "bool" ? p[c.k] === true : haValore(p[c.k]));
			corpo = (iniziata ? vistaFase(f, p) : "") + `<div class="rt-fase-body${iniziata ? " rt-pt0" : ""}">` + (puoModificare(f, p)
				? `<button type="button" class="rt-btn rt-btn-outline rt-btn-sm" data-modifica="${f.key}"><i class="bi bi-pencil"></i>${iniziata ? "Continua a compilare" : "Compila dati"}</button>`
				: `<span class="rt-muted rt-small">${iniziata ? "In compilazione: " : "In attesa di "}${esc(f.chi)}</span>`) + `</div>`;
		}

		const nota = classe === "completata" ? "Completata" : classe === "attiva" ? "Da fare ora" : classe === "saltata" ? "Saltata" : "";
		return scheda(f.key, "fase-" + classe, f.icona, f.titolo, nota, corpo);
	}

	function faseCorrente(p) {
		const f = FASI[indiceCorrente(p.stato)];
		return f ? f.key : null;
	}

	function schedaAperta(key) {
		if (S.modifica === key) return true;
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

	function toggleScheda(key) {
		const el = $(`#rt-pratica [data-fase="${key}"]`);
		if (!el) return;
		const aperta = el.classList.contains("is-chiusa");
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
				f.campi.filter(c => condizione(c, p))
					.map(c => ({
						label: c.labelVista || c.label.replace(/\s*\(€\)$/, ""),
						valore: c.tipo === "centro" ? nomeCentro(p.area, p[c.k]) : mostraValore(c, p[c.k]),
						largo: c.largo || c.tipo === "centro"
					})));
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
		if (st === "completata" || f.key === "manutentori" || (st === "attiva" && f.salvaBozza)) {
			const titolo = st === "attiva" ? ' title="Salva i dati senza passare la pratica alla fase successiva"' : "";
			bottoni.push(`<button type="button" class="rt-btn rt-btn-primary rt-btn-sm" data-azione="salva" data-fase-btn="${f.key}"${titolo}><i class="bi bi-check-circle"></i>Salva</button>`);
		}
		bottoni.push(`<button type="button" class="rt-btn rt-btn-outline rt-btn-sm" data-azione="annulla">Annulla</button>`);

		return `<div class="rt-fase-form" data-form="pratica">` +
			`<div class="rt-form">${f.campi.map(c => campoHtml(c, S.campi, "pratica")).join("")}</div>` +
			`<div class="rt-actions">${bottoni.join("")}</div></div>`;
	}

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

		const approvata = !!p.data_approvazione && p.stato !== "rifiutato";
		const b = S.budgetPratica;

		const disponibile = approvata
			? ["Disponibile all'approvazione", p.disponibile_mese != null ? euro(p.disponibile_mese) + " €" : "budget non impostato"]
			: ["Disponibile " + meseCorrente() + " — " + (p.area || "area"), testoDisponibile(b)];

		const riepilogo =
			`<div class="rt-grid">` +
				[["Area", p.area || "—"],
				 ["Tempo di consegna", tempoConsegna(p) || "—"],
				 ["Preventivo", p.preventivo != null ? euro(p.preventivo) + " €" : "—"],
				 disponibile]
					.map(([l, v]) => `<div class="rt-field"><span class="rt-field-label">${esc(l)}</span><span class="rt-field-value">${esc(v)}</span></div>`).join("") +
			`</div>` +
			(!approvata && b && b.disponibile != null && p.preventivo != null
				? `<div class="rt-fase-body rt-pt0 rt-small ${oltreDisponibile(p, b) ? "rt-oltre" : "rt-budget-ok"}">` +
				  (oltreDisponibile(p, b)
					? "Il preventivo supera il disponibile del mese."
					: "Approvando restano " + esc(euro(Number(b.disponibile) - Number(p.preventivo))) + " € per " + esc(p.area) + " a " + esc(meseCorrente()) + ".") +
				  `</div>` : "") +
			(!approvata && b && b.disponibile == null
				? `<div class="rt-fase-body rt-pt0 rt-small rt-muted">Il budget di ${esc(meseCorrente())} per ${esc(p.area || "quest'area")} non è ancora stato impostato (Gestione, ruolo Admin Repair).</div>` : "") +
			(approvata ? `<div class="rt-budget-nota">Approvata il ${esc(dataIt(p.data_approvazione))} ${esc(String(p.data_approvazione).slice(11, 16))}: il preventivo è stato scalato dal budget di quel mese.</div>` : "");

		const bottoni = (html) => `<div class="rt-fase-body"><div class="rt-actions" style="margin-top:0">${html}</div></div>`;
		const approva = `<button type="button" class="rt-btn rt-btn-avanza rt-btn-sm" data-azione="approva"><i class="bi bi-check-circle"></i>Approva</button>`;
		const rifiuta = `<button type="button" class="rt-btn rt-btn-danger rt-btn-sm" data-azione="rifiuta"><i class="bi bi-x-circle"></i>Rifiuta</button>`;
		const annulla = `<button type="button" class="rt-btn rt-btn-outline rt-btn-sm" data-azione="annulla">Annulla</button>`;

		if (S.modifica === "ruo")
			return riepilogo + bottoni((p.stato !== "accettata" ? approva : "") + (p.stato !== "rifiutato" ? rifiuta : "") + annulla);

		if (st === "completata") {
			return riepilogo + `<div class="rt-fase-body">` +
				(p.stato === "rifiutato" ? `<span class="rt-badge st-rifiutato">Rifiutata</span>` : `<span class="rt-badge st-accettata">Accettata</span>`) + `</div>` +
				(puoModificareRuo(p)
					? `<div class="rt-fase-body rt-pt0"><button type="button" class="rt-btn rt-btn-outline rt-btn-sm" data-modifica="ruo"><i class="bi bi-pencil"></i>Modifica</button></div>` : "");
		}

		if (puoApprovare(p)) return riepilogo + bottoni(approva + rifiuta);
		return riepilogo + `<div class="rt-fase-body"><span class="rt-muted rt-small">In attesa di approvazione RUO${p.area ? " " + esc(p.area) : ""}</span></div>`;
	}

	function corpoChiusura(f, p, st) {
		if (st === "futura") return attesaCompilazione();
		if (st === "completata") return `<div class="rt-fase-body rt-ok"><i class="bi bi-check-circle-fill"></i>Pratica chiusa da Magazzino.</div>`;
		return `<div class="rt-fase-body">` +
			(f.istruzione ? `<p class="rt-istruzione"><strong>Istruzione:</strong> ${esc(f.istruzione)}</p>` : "") +
			(puoModificare(f, p)
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
		if ("centro_costo" in S.campi && !codiciCentri(S.campi.area).includes(S.campi.centro_costo)) S.campi.centro_costo = "";
		f.campi.forEach(c => {
			if (c.tipo === "bool") S.campi[c.k] = p[c.k] === true;
			if (c.oggi && !haValore(S.campi[c.k])) S.campi[c.k] = oggiIso();
		});
		S.modifica = key;
		renderPratica();
		const form = $(`[data-fase="${key}"] [data-form]`);
		if (form) aggiornaVisibili(form, S.campi);
		const primo = $(`[data-fase="${key}"] input, [data-fase="${key}"] select, [data-fase="${key}"] textarea`);
		if (primo) primo.focus();
	}

	function valoriFase(f) {
		const campi = {};
		f.campi.forEach(c => { campi[c.k] = S.campi[c.k] == null ? "" : S.campi[c.k]; });
		return campi;
	}

	async function dopoModifica(messaggio) {
		S.modifica = null;
		avviso(messaggio);
		await caricaPratica(S.pratica.id);
		caricaElenco().catch(() => {  });
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
			await dopoModifica(f.avanti === "chiuso" ? "Pratica chiusa."
				: key === "magazzino_1" && campi.tipo_riparazione === LAB_ELETTRO ? "Laboratorio Elettrotecnico: la pratica passa direttamente al Rientro."
				: "Fase confermata.");
		}, bottone);
	}

	function salva(key, bottone) {
		const f = FASI[indice(key)];
		return eseguiInPratica(async () => {
			const body = { id: S.pratica.id, card: key, campi: valoriFase(f) };
			let r = await api("salva", { body: body });
			if (r.regressione) {
				if (!confirm(r.message)) { if (bottone) bottone.disabled = false; return; }
				body.conferma = true;
				r = await api("salva", { body: body });
			}
			await dopoModifica(statoFase(f, S.pratica.stato, isLab(S.pratica)) === "attiva" && f.avanti
				? "Dati salvati. La pratica resta in questa fase finché non premi Conferma." : "Dati salvati.");
		}, bottone);
	}

	function decidi(esito, bottone) {
		return eseguiInPratica(async () => {
			await api("decidi", { body: { id: S.pratica.id, esito: esito } });
			await dopoModifica(esito === "accettata" ? "Pratica approvata." : "Pratica rifiutata.");
		}, bottone);
	}

	function renderGestione() {
		const g = S.gest;
		if (!g.mese) { const d = new Date(); g.mese = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
		$("#rt-budget-mese").value = g.mese;
		$$(".rt-tab").forEach(t => t.classList.toggle("is-on", t.dataset.tab === g.tab));
		$$("[data-pannello]").forEach(x => { x.hidden = x.dataset.pannello !== g.tab; });
		if (g.tab === "budget") caricaBudget(); else caricaUtenti();
	}

	async function caricaBudget() {
		const [anno, mese] = S.gest.mese.split("-").map(Number);
		try {
			S.gest.budget = await api("budget", { query: { anno: anno, mese: mese } });
			renderBudget();
		} catch (e) {
			$("#rt-budget-tabella").innerHTML = `<tr><td colspan="5" class="rt-vuoto">${esc(e.message)}</td></tr>`;
		}
	}

	function renderBudget() {
		const b = S.gest.budget;
		$("#rt-budget-tabella").innerHTML = b.aree.map(a =>
			`<tr><td class="rt-forte">${esc(a.area)}</td>` +
			`<td><input type="text" inputmode="decimal" class="rt-budget-input" data-budget-area="${esc(a.area)}" value="${esc(a.importo != null ? euro(a.importo) : "")}" placeholder="non impostato"></td>` +
			`<td>${esc(euro(a.approvato) || "0")} €</td>` +
			`<td class="${a.disponibile != null && a.disponibile < 0 ? "rt-neg" : ""}">${a.disponibile != null ? esc(euro(a.disponibile)) + " €" : "—"}</td>` +
			`<td>${a.pratiche}</td></tr>`).join("");
	}

	function numeroDaEuro(testo) {
		const t = String(testo || "").replace(/\./g, "").replace(",", ".").trim();
		if (!t) return null;
		const n = Number(t);
		return isNaN(n) ? NaN : n;
	}

	async function salvaBudget(bottone) {
		const [anno, mese] = S.gest.mese.split("-").map(Number);
		const importi = {};
		for (const input of $$("[data-budget-area]")) {
			const n = numeroDaEuro(input.value);
			if (Number.isNaN(n)) { avviso("Importo non valido per " + input.dataset.budgetArea + ".", true); input.focus(); return; }
			importi[input.dataset.budgetArea] = n;
		}
		bottone.disabled = true;
		try {
			S.gest.budget = await api("budget_salva", { body: { anno: anno, mese: mese, importi: importi } });
			renderBudget();
			avviso("Budget di " + nomeMese(anno, mese) + " salvato.");
			caricaElenco().catch(() => {});
		} catch (e) {
			avviso(e.message, true);
		} finally {
			bottone.disabled = false;
		}
	}

	async function caricaUtenti() {
		try {
			const d = await api("utenti");
			S.gest.utenti = d.utenti;
			S.gest.ruoli = d.ruoli;
			renderUtenti();
		} catch (e) {
			$("#rt-utenti-tabella").innerHTML = `<tr><td class="rt-vuoto">${esc(e.message)}</td></tr>`;
		}
	}

	function renderUtenti() {
		const g = S.gest;
		const t = g.cerca.trim().toLowerCase();
		const lista = g.utenti.filter(u => !t || (u.nome + " " + u.username).toLowerCase().includes(t));
		$("#rt-utenti-testa").innerHTML = `<tr><th>Utente</th>` +
			g.ruoli.map(r => `<th class="rt-gest-th-ruolo">${esc(r.nome)}</th>`).join("") + `</tr>`;
		$("#rt-utenti-tabella").innerHTML = lista.length === 0
			? `<tr><td colspan="${g.ruoli.length + 1}" class="rt-vuoto">Nessun utente</td></tr>`
			: lista.map(u =>
				`<tr${u.attivo ? "" : ' class="is-spento" title="Utente non attivo: lo attiva l\'amministratore in Gestione utenti"'}>` +
					`<td class="rt-gest-utente"><strong>${esc(u.nome)}</strong><span>${esc(u.username)}${u.attivo ? "" : " · non attivo"}</span></td>` +
					g.ruoli.map(r =>
						`<td class="rt-gest-ruolo"><input type="checkbox" data-utente="${u.id}" data-ruolo="${r.id}"` +
						`${u.ruoli.includes(r.id) ? " checked" : ""}${r.modificabile ? "" : ' disabled title="Lo può dare o togliere solo un amministratore"'}` +
						` aria-label="${esc(r.nome + " per " + u.nome)}"></td>`).join("") +
				`</tr>`).join("");
	}

	async function cambiaRuolo(input) {
		const u = S.gest.utenti.find(x => x.id === Number(input.dataset.utente));
		const rid = Number(input.dataset.ruolo);
		const ruoli = input.checked ? u.ruoli.concat([rid]) : u.ruoli.filter(r => r !== rid);
		input.disabled = true;
		try {
			await api("utenti_ruoli", { body: { id: u.id, ruoli: ruoli } });
			u.ruoli = ruoli;
			const r = S.gest.ruoli.find(x => x.id === rid);
			avviso((input.checked ? "Dato " : "Tolto ") + r.nome + " a " + u.nome + ".");
			if (S.io && u.username.toLowerCase() === String(S.io.username).toLowerCase()) caricaElenco().catch(() => {});
		} catch (e) {
			input.checked = !input.checked;
			avviso(e.message, true);
		} finally {
			input.disabled = false;
		}
	}

	function temaChiaro() { return document.documentElement.getAttribute("data-tema") === "chiaro"; }

	function aggiornaBottoneTema() {
		const b = $("#rt-tema");
		if (!b) return;
		const chiaro = temaChiaro();
		b.innerHTML = (chiaro
			? `<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278"/></svg>Tema scuro`
			: `<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708"/></svg>Tema chiaro`);
		b.title = chiaro ? "Passa al tema scuro" : "Passa al tema chiaro";
	}

	function cambiaTema() {
		const chiaro = !temaChiaro();
		if (chiaro) document.documentElement.setAttribute("data-tema", "chiaro");
		else document.documentElement.removeAttribute("data-tema");
		try { localStorage.setItem("rt_tema", chiaro ? "chiaro" : "scuro"); } catch (e) {  }
		aggiornaBottoneTema();
		if (S.vista === "fornitori") renderFornitori();
	}

	function coloreTema(nome) { return getComputedStyle(document.documentElement).getPropertyValue(nome).trim(); }

	function giorniTra(a, b) {
		if (!a || !b) return null;
		return Math.round((parseData(b) - parseData(a)) / 864e5);
	}

	function tempoPromesso(p) {
		const t = tempoConsegna(p).toLowerCase();
		const m = /(\d+(?:[.,]\d+)?)\s*([a-z]*)/.exec(t);
		if (!m) return null;
		const n = parseFloat(m[1].replace(",", "."));
		const unita = m[2] || p.tempo_consegna_unita || "giorni";
		if (/^sett/.test(unita)) return Math.round(n * 7);
		if (/^mes/.test(unita)) return Math.round(n * 30);
		return Math.round(n);
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

		const testo = coloreTema("--text-muted"), griglia = coloreTema("--line"), legendaColore = coloreTema("--text-2");
		const assi = titoloY => ({
			x: { ticks: { color: testo }, grid: { color: griglia } },
			y: { beginAtZero: true, ticks: { color: testo }, grid: { color: griglia }, title: { display: true, text: titoloY, color: testo } }
		});
		const legenda = { labels: { color: legendaColore, usePointStyle: true, pointStyle: "circle", padding: 16 } };

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

	async function route() {
		const m = /^#\/([a-z]+)(?:\/(\d+))?/.exec(window.location.hash || "");
		let vista = m ? m[1] : "dashboard";
		const id = m && m[2] ? Number(m[2]) : null;
		if (!VISTE.includes(vista) || (vista === "pratica" && !id)) vista = "dashboard";
		if (vista === "nuova" && !puoCreare()) { window.location.replace("#/dashboard"); return; }
		if (vista === "gestione" && !isAdminRepair()) { window.location.replace("#/dashboard"); return; }
		if (vista !== "pratica" && vista !== "nuova") S.indietro = "#/" + vista;

		mostraVista(vista);
		erroreGenerale("");

		try {
			if (vista === "pratica") { await apriPratica(id); return; }
			if (vista === "nuova") { renderNuova(); return; }
			if (vista === "gestione") { renderGestione(); return; }

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

			const tab = t.closest(".rt-tab");
			if (tab) { S.gest.tab = tab.dataset.tab; renderGestione(); return; }

			const tog = t.closest("[data-toggle-fase]");
			if (tog) { toggleScheda(tog.dataset.toggleFase); return; }

			const mod = t.closest("[data-modifica]");
			if (mod) { apriModifica(mod.dataset.modifica); return; }

			const az = t.closest("#rt-pratica [data-azione]");
			if (az && !az.disabled) {
				const a = az.dataset.azione;
				if (a === "annulla") { S.modifica = null; renderPratica(); }
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
				const obj = form.dataset.form === "nuova" ? S.nuova : S.campi;
				leggiCampo(t, obj);
				if (t.dataset.tipo === "area") aggiornaCentro(form, obj);
				aggiornaVisibili(form, obj);
				aggiornaBottoniModulo();
				return;
			}
			if (t.id === "rt-utenti-cerca") { S.gest.cerca = t.value; renderUtenti(); return; }
			if (t.matches("[data-budget-area]")) {
				let raw = t.value.replace(/[^\d.,]/g, "");
				const v = raw.indexOf(",");
				if (v !== -1) raw = raw.slice(0, v + 1) + raw.slice(v + 1).replace(/[,.]/g, "");
				t.value = raw;
			}
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
			if (form && t.dataset.campo) {
				const obj = form.dataset.form === "nuova" ? S.nuova : S.campi;
				leggiCampo(t, obj);
				if (t.dataset.tipo === "area") aggiornaCentro(form, obj);
				aggiornaVisibili(form, obj);
				aggiornaBottoniModulo();
				return;
			}
			if (t.matches("[data-utente][data-ruolo]")) { cambiaRuolo(t); return; }
			if (t.id === "rt-budget-mese" && t.value) { S.gest.mese = t.value; caricaBudget(); }
		});

		document.addEventListener("focusout", ev => {
			const t = ev.target;
			if (t.dataset && t.dataset.budgetArea !== undefined) {
				const n = numeroDaEuro(t.value);
				if (n != null && !Number.isNaN(n)) t.value = euro(n);
				return;
			}
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
		$("#rt-budget-salva").addEventListener("click", ev => salvaBudget(ev.currentTarget));
		$("#rt-tema").addEventListener("click", cambiaTema);
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

	async function avvia() {
		versioneNelFooter();
		aggiornaBottoneTema();
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
