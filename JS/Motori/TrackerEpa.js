/* ============ Certificati: scheda "Tracker EPA" ============
 Mostra le famiglie del file Tracker EPA (database TrackerEPA, caricato dalla scheda "Carica Excel")
 incrociate con Shop Order e TAG che la pagina ha già caricato (window.CertificatiDati).

 Collegamento: la famiglia EPA è la parte finale di "REF. US FAMILY" dello Shop Order
 (FPXL03.4ASD -> 03.4ASD; "06.7FR1 LSI" usa la famiglia 06.7FR1). Dai P/N si arriva ai TAG (Element = P/N).

 Si vedono solo le famiglie che ci sono nel file. Due viste: Tabella (righe che si aprono sui P/N) e Calendario
 (settimane di sottomissione e approvazione). Riquadri in alto e menu = filtri.*/
(function () {
	const API = "API/Certificati.ashx";

	// Stato complessivo della famiglia: colore e ordine
	const STATI = {
		ok: { nome: "Approvata", colore: "#1BC5BD", ordine: 4 },
		corso: { nome: "In approvazione", colore: "#3699FF", ordine: 2 },
		dafare: { nome: "Da sottomettere", colore: "#FFA800", ordine: 1 },
		standby: { nome: "Stand by", colore: "#A1A5B7", ordine: 5 },
		phased: { nome: "Phased out", colore: "#5E6278", ordine: 6 }
	};
	// Stato di una singola voce (EPA / CARB, sottomissione / approvazione)
	const VOCI = {
		approvata: { nome: "Approvata", cls: "ok" },
		inviata: { nome: "Sottomessa", cls: "inviata" },
		attesa: { nome: "Da approvare", cls: "corso" },
		dafare: { nome: "Da sottomettere", cls: "dafare" },
		standby: { nome: "Stand by", cls: "standby" },
		phased: { nome: "Phased out", cls: "phased" },
		na: { nome: "Non richiesta", cls: "na" },
		vuota: { nome: "—", cls: "na" }
	};
	const RISCHI = { HIGH: { nome: "Alto", cls: "alto" }, MED: { nome: "Medio", cls: "medio" }, MEDIUM: { nome: "Medio", cls: "medio" }, LOW: { nome: "Basso", cls: "basso" } };

	const $ = sel => document.querySelector(sel);
	const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	const num = n => Number(n || 0).toLocaleString("it-IT");
	const up = v => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();

	const st = {
		caricato: false, famiglie: [], ultimo: null, oggi: null, annoBase: null,
		vista: "tabella", filtroStato: "", soloRischio: "", soloRitardo: false, cerca: "",
		ordine: { col: "ordine", dir: 1 }, aperte: new Set()
	};

	/* ================= settimane ================= */

	// Settimana ISO (anno e numero) di una data
	function settimanaIso(d) {
		const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
		const g = t.getUTCDay() || 7;
		t.setUTCDate(t.getUTCDate() + 4 - g);
		const inizio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
		return { anno: t.getUTCFullYear(), sett: Math.ceil(((t - inizio) / 86400000 + 1) / 7) };
	}
	// Numero progressivo della settimana (0 = settimana del 5 gennaio 1970): due settimane vicine differiscono di 1,
	// anche a cavallo d'anno (gli anni con 53 settimane, come il 2026, sono contati giusti)
	const GIORNO = 86400000;
	function indice(anno, sett) {
		const quattro = Date.UTC(anno, 0, 4);
		const dow = new Date(quattro).getUTCDay() || 7;
		const lunedi = quattro - (dow - 1) * GIORNO + (sett - 1) * 7 * GIORNO;
		return Math.round((lunedi / GIORNO - 4) / 7);
	}
	function daIndice(i) {
		const giovedi = new Date((i * 7 + 4 + 3) * GIORNO);
		return settimanaIso(new Date(giovedi.getUTCFullYear(), giovedi.getUTCMonth(), giovedi.getUTCDate()));
	}

	// "CW38", "38", "CW 08/2027" -> { anno, sett, i }; senza anno vale l'anno del file
	function leggiSettimana(v) {
		const s = up(v).replace(/^CW\s*/, "");
		const m = s.match(/^(\d{1,2})(?:\s*\/\s*(\d{4}))?$/);
		if (!m) return null;
		const sett = Number(m[1]);
		if (sett < 1 || sett > 53) return null;
		const anno = m[2] ? Number(m[2]) : st.annoBase;
		return { anno, sett, i: indice(anno, sett), testo: `CW${String(sett).padStart(2, "0")}${m[2] || anno !== st.oggi.anno ? "/" + anno : ""}` };
	}

	/* ================= stati ================= */

	function voce(stato, sett) {
		const s = up(stato);
		const w = leggiSettimana(sett);
		let tipo;
		if (!s) tipo = "vuota";
		else if (s === "APPROVED") tipo = "approvata";
		else if (s === "TO BE APPROVED" || s === "PENDING") tipo = "attesa";
		else if (s === "SUBMITTED") tipo = "inviata";
		else if (s === "TO BE SUBMITTED") tipo = "dafare";
		else if (s === "STAND BY") tipo = "standby";
		else if (s === "PHASED OUT") tipo = "phased";
		else if (s === "NA" || s === "N/A") tipo = "na";
		else if (leggiSettimana(s)) tipo = "approvata"; // nel file a volte al posto dello stato c'è la settimana (es. CARB "CW22")
		else tipo = "attesa";
		const daFare = tipo === "attesa" || tipo === "dafare";
		// settimana prevista già passata e voce non ancora fatta
		const ritardo = !!(daFare && w && w.i < indice(st.oggi.anno, st.oggi.sett));
		return { tipo, testo: stato || "", sett: w, settTesto: w ? w.testo : (sett ? String(sett) : ""), ritardo };
	}

	function statoFamiglia(f) {
		const tutte = [f.epaSub, f.epaApp, f.carbSub, f.carbApp].map(v => v.tipo);
		if (tutte.includes("phased")) return "phased";
		if (f.epaSub.tipo === "standby" || f.epaApp.tipo === "standby") return "standby";
		if (f.epaSub.tipo === "dafare") return "dafare";
		const okCarb = ["approvata", "na", "vuota"].includes(f.carbApp.tipo);
		if (f.epaApp.tipo === "approvata" && okCarb) return "ok";
		return "corso";
	}

	/* ================= dati ================= */

	async function api(azione) {
		let json;
		try {
			const res = await fetch(API + "?action=" + azione, { credentials: "same-origin", cache: "no-store" });
			json = await res.json();
		} catch (e) {
			throw new Error("Il server non risponde (" + API + ").");
		}
		if (!json || json.ok === false) throw new Error((json && (json.message + (json.detail ? " — " + json.detail : ""))) || "Errore del server.");
		return json;
	}

	async function datiPortale(tipo) {
		const c = window.CertificatiDati || {};
		if (c[tipo] && c[tipo].righe) return c[tipo];
		const d = await api(tipo);
		window.CertificatiDati = Object.assign({}, window.CertificatiDati || {}, { [tipo]: d });
		return d;
	}

	// Famiglia US dello Shop Order: le ultime 7 lettere (03.4ASD); prima ci sono costruttore e anno (FPXL, VEXL...)
	function famigliaUs(v) {
		const m = up(v).match(/(\d{2}\.\d[A-Z0-9]{3})$/);
		return m ? m[1] : "";
	}
	const famigliaBase = f => up(f).split(" ")[0];

	function impattoUltimoPiano(dati) {
		// piano più recente (numero più alto: PO10R dopo PO09R) e la sua misura "TOTAL IMPACT"
		const piani = (dati.piani || []).filter(p => /^PO\d+/i.test(p.nome));
		piani.sort((a, b) => Number(b.nome.replace(/\D/g, "")) - Number(a.nome.replace(/\D/g, "")));
		for (const p of piani) {
			const v = (p.valori || []).find(x => /total\s*impact/i.test(x.nome));
			if (v && typeof v.valore === "number") return { piano: p.nome, valore: v.valore };
		}
		return null;
	}

	async function carica() {
		const box = $("#epa-contenuto");
		box.innerHTML = `<div class="cx-loading"><span class="cx-spinner"></span>Lettura del Tracker EPA…</div>`;
		try {
			const [epa, shop, tag] = await Promise.all([api("epa"), datiPortale("shoporder"), datiPortale("tag")]);
			st.ultimo = epa.ultimo || null;
			const oggi = new Date();
			st.oggi = settimanaIso(oggi);
			// anno delle settimane scritte senza anno: quello del caricamento del file
			const dataFile = st.ultimo && st.ultimo.data ? new Date(String(st.ultimo.data).slice(0, 10)) : oggi;
			st.annoBase = isNaN(dataFile) ? oggi.getFullYear() : dataFile.getFullYear();
			const oggiIso = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, "0")}-${String(oggi.getDate()).padStart(2, "0")}`;

			// Shop Order per famiglia US
			const sc = shop.colonne || [];
			const iPn = sc.indexOf("P/N Motore"), iUs = sc.indexOf("REF. US FAMILY");
			const perFam = new Map();
			(shop.righe || []).forEach(r => {
				const f = famigliaUs(r[iUs]);
				if (!f) return;
				if (!perFam.has(f)) perFam.set(f, []);
				perFam.get(f).push(r);
			});
			// TAG per P/N
			const tc = tag.colonne || [];
			const iEl = tc.indexOf("Element"), iVs = tc.indexOf("VStart"), iVe = tc.indexOf("VEnd"), iTg = tc.indexOf("TagElementDescription");
			const perPn = new Map();
			(tag.righe || []).forEach(r => {
				const k = up(r[iEl]);
				if (!perPn.has(k)) perPn.set(k, []);
				const vs = String(r[iVs] ?? "").slice(0, 10), ve = String(r[iVe] ?? "").slice(0, 10);
				const stato = vs && vs > oggiIso ? "futuro" : ve && ve < oggiIso ? "finito" : (vs || ve) ? "oggi" : "nessuno";
				perPn.get(k).push({ tag: String(r[iTg] ?? "").trim(), vs, ve, stato });
			});

			const ec = epa.colonne;
			const g = (r, c) => r[ec.indexOf(c)];
			st.famiglie = (epa.righe || []).map((r, n) => {
				let dati = {};
				try { dati = JSON.parse(g(r, "Dati") || "{}") || {}; } catch (e) { dati = {}; }
				const f = {
					nome: g(r, "Famiglia"), ordine: Number(g(r, "Ordine")) || n + 1,
					epaSub: voce(g(r, "EpaSottomissione"), g(r, "EpaSottomissioneSett")),
					epaApp: voce(g(r, "EpaApprovazione"), g(r, "EpaApprovazioneSett")),
					carbSub: voce(g(r, "CarbSottomissione"), g(r, "CarbSottomissioneSett")),
					carbApp: voce(g(r, "CarbApprovazione"), g(r, "CarbApprovazioneSett")),
					rischio: up(g(r, "Rischio")), note: g(r, "Note") || "", dati,
					impatto: impattoUltimoPiano(dati)
				};
				f.stato = statoFamiglia(f);
				f.ritardo = [f.epaSub, f.epaApp, f.carbSub, f.carbApp].some(v => v.ritardo);
				// incrocio con Shop Order e TAG
				f.pn = (perFam.get(famigliaBase(f.nome)) || []).map(row => {
					const obj = {};
					sc.forEach((c, j) => { obj[c] = row[j] ?? ""; });
					obj.__tag = perPn.get(up(row[iPn])) || [];
					return obj;
				});
				const clienti = {}, tagConta = {};
				f.pn.forEach(p => {
					const c = p["Customer"] || "—";
					clienti[c] = (clienti[c] || 0) + 1;
					const visti = new Set();
					p.__tag.forEach(t => {
						if (!t.tag) return;
						if (!tagConta[t.tag]) tagConta[t.tag] = { pn: 0, oggi: 0 };
						if (!visti.has(t.tag)) { tagConta[t.tag].pn++; visti.add(t.tag); }
						if (t.stato === "oggi") tagConta[t.tag].oggi++;
					});
				});
				f.clienti = Object.entries(clienti).sort((a, b) => b[1] - a[1]);
				f.tag = Object.entries(tagConta).sort((a, b) => b[1].pn - a[1].pn);
				f.pnDeprecati = f.pn.filter(p => p.__tag.some(t => t.stato === "oggi")).length;
				f.cercaTesto = [f.nome, f.note, ...f.pn.map(p => [p["P/N Motore"], p["Engine code"], p["Customer"], p["Application"], p["REF. US FAMILY"]].join(" "))].join(" ").toLowerCase();
				return f;
			});
			st.caricato = true;
			disegna();
		} catch (e) {
			box.innerHTML = `<div class="cx-alert cx-alert-danger">Tracker EPA non disponibile: ${esc(e.message)}</div>
				<p class="cx-testo cx-muted">Se il database non è ancora stato creato: eseguire SQL/TrackerEPA_01_database.sql e poi caricare il file dalla scheda Carica Excel.</p>`;
		}
	}

	/* ================= filtri ================= */

	function filtrate() {
		const q = st.cerca.trim().toLowerCase();
		let l = st.famiglie.filter(f =>
			(!st.filtroStato || f.stato === st.filtroStato) &&
			(!st.soloRischio || f.rischio === st.soloRischio) &&
			(!st.soloRitardo || f.ritardo) &&
			(!q || f.cercaTesto.includes(q)));
		const o = st.ordine, d = o.dir;
		const val = f => o.col === "famiglia" ? f.nome.toLowerCase()
			: o.col === "stato" ? STATI[f.stato].ordine
			: o.col === "rischio" ? ({ HIGH: 0, MED: 1, MEDIUM: 1, LOW: 2 }[f.rischio] ?? 3)
			: o.col === "impatto" ? -(f.impatto ? f.impatto.valore : -1)
			: o.col === "pn" ? -f.pn.length
			: f.ordine;
		l = l.slice().sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * d || a.ordine - b.ordine; });
		return l;
	}

	/* ================= disegno ================= */

	function pill(v) {
		const t = VOCI[v.tipo];
		return `<span class="epa-pill epa-pill-${t.cls}${v.ritardo ? " epa-ritardo" : ""}" title="${esc(v.testo)}${v.ritardo ? " — settimana prevista già passata" : ""}">${esc(t.nome)}</span>${v.settTesto ? `<span class="epa-sett${v.ritardo ? " epa-sett-ritardo" : ""}">${esc(v.settTesto)}</span>` : ""}`;
	}

	function rischio(r) {
		const x = RISCHI[r];
		return x ? `<span class="epa-rischio epa-rischio-${x.cls}">${x.nome}</span>` : `<span class="cx-muted">—</span>`;
	}

	function disegna() {
		const box = $("#epa-contenuto");
		if (!st.famiglie.length) {
			box.innerHTML = `<div class="cx-card"><div class="cx-card-body">Nessuna famiglia nel database: caricare il file Tracker EPA dalla scheda <strong>Carica Excel</strong>.</div></div>`;
			return;
		}
		const tutte = st.famiglie;
		const conta = k => tutte.filter(f => f.stato === k).length;
		const pnTot = tutte.reduce((a, f) => a + f.pn.length, 0);
		const alto = tutte.filter(f => f.rischio === "HIGH").length;
		const ritardo = tutte.filter(f => f.ritardo).length;
		const u = st.ultimo;

		const kpi = (k, nome, n, colore, extra) => `<button type="button" class="epa-kpi${st.filtroStato === k ? " is-on" : ""}" data-stato="${k}" style="--c:${colore}">
			<span class="epa-kpi-n">${num(n)}</span><span class="epa-kpi-nome">${nome}</span>${extra || ""}</button>`;

		box.innerHTML = `
			<div class="epa-testa">
				<div>
					<h2 class="epa-titolo">Tracker EPA</h2>
					<div class="cx-muted epa-sotto">${u ? `${esc(u.foglio || u.file || "")} · caricato il ${esc(String(u.data || "").slice(0, 10).split("-").reverse().join("/"))}${u.utente ? " da " + esc(u.utente) : ""}` : ""} · oggi CW${String(st.oggi.sett).padStart(2, "0")}/${st.oggi.anno}</div>
				</div>
				<div class="epa-viste" role="group">
					<button type="button" data-vista="tabella" class="${st.vista === "tabella" ? "is-on" : ""}">Tabella</button>
					<button type="button" data-vista="calendario" class="${st.vista === "calendario" ? "is-on" : ""}">Calendario</button>
				</div>
			</div>

			<div class="epa-kpis">
				${kpi("", "Famiglie", tutte.length, "#3f4254", `<span class="epa-kpi-extra">${num(pnTot)} P/N nel portale</span>`)}
				${Object.keys(STATI).map(k => kpi(k, STATI[k].nome, conta(k), STATI[k].colore)).join("")}
				<button type="button" class="epa-kpi epa-kpi-flag${st.soloRischio === "HIGH" ? " is-on" : ""}" data-flag="rischio" style="--c:#F64E60"><span class="epa-kpi-n">${num(alto)}</span><span class="epa-kpi-nome">Rischio alto</span></button>
				<button type="button" class="epa-kpi epa-kpi-flag${st.soloRitardo ? " is-on" : ""}" data-flag="ritardo" style="--c:#B5179E"><span class="epa-kpi-n">${num(ritardo)}</span><span class="epa-kpi-nome">Settimana passata</span></button>
			</div>

			<div class="epa-barre">
				${barra("EPA", tutte.map(f => [f.epaSub, f.epaApp]))}
				${barra("CARB", tutte.map(f => [f.carbSub, f.carbApp]))}
			</div>

			<div class="epa-filtri">
				<input type="text" id="epa-cerca" placeholder="🔍 Cerca famiglia, P/N, engine code, customer…" value="${esc(st.cerca)}">
				<select id="epa-rischio">
					<option value="">Tutti i rischi</option>
					${["HIGH", "MED", "LOW"].map(r => `<option value="${r}" ${st.soloRischio === r ? "selected" : ""}>Rischio ${RISCHI[r].nome.toLowerCase()}</option>`).join("")}
				</select>
				<span class="cx-muted" id="epa-conteggio"></span>
				${st.filtroStato || st.soloRischio || st.soloRitardo || st.cerca ? `<button type="button" class="cx-btn cx-btn-outline cx-btn-sm" id="epa-azzera">Azzera filtri</button>` : ""}
			</div>

			<div id="epa-elenco"></div>`;
		disegnaElenco();
	}

	// Barra a segmenti: per ogni famiglia lo stato "più avanti" fra sottomissione e approvazione
	function barra(nome, coppie) {
		const passo = ([sub, app]) => {
			if ([sub.tipo, app.tipo].includes("phased")) return "phased";
			if ([sub.tipo, app.tipo].includes("standby")) return "standby";
			if (sub.tipo === "na" && app.tipo === "na") return "na";
			if (app.tipo === "approvata") return "approvata";
			if (sub.tipo === "dafare") return "dafare";
			return "attesa";
		};
		const ordine = ["approvata", "attesa", "dafare", "standby", "phased", "na"];
		const nomi = { approvata: "Approvata", attesa: "Sottomessa, da approvare", dafare: "Da sottomettere", standby: "Stand by", phased: "Phased out", na: "Non richiesta" };
		const conta = {};
		coppie.forEach(c => { const k = passo(c); conta[k] = (conta[k] || 0) + 1; });
		const tot = coppie.length || 1;
		return `<div class="epa-barra">
			<span class="epa-barra-nome">${nome}</span>
			<div class="epa-barra-seg">${ordine.filter(k => conta[k]).map(k => `<span class="epa-seg epa-seg-${k}" style="width:${(conta[k] / tot * 100).toFixed(2)}%" title="${nomi[k]}: ${conta[k]}">${conta[k]}</span>`).join("")}</div>
			<span class="epa-barra-legenda">${ordine.filter(k => conta[k]).map(k => `<i class="epa-dot epa-seg-${k}"></i>${nomi[k]} ${conta[k]}`).join(" &nbsp; ")}</span>
		</div>`;
	}

	function disegnaElenco() {
		const l = filtrate();
		const conteggio = $("#epa-conteggio");
		if (conteggio) conteggio.textContent = l.length === st.famiglie.length ? `${l.length} famiglie` : `${l.length} di ${st.famiglie.length} famiglie`;
		const box = $("#epa-elenco");
		if (!l.length) { box.innerHTML = `<div class="cx-card"><div class="cx-card-body cx-muted">Nessuna famiglia con questi filtri.</div></div>`; return; }
		box.innerHTML = st.vista === "calendario" ? calendario(l) : tabella(l);
	}

	function th(col, testo, cls) {
		const on = st.ordine.col === col;
		return `<th class="epa-sort${cls ? " " + cls : ""}${on ? " is-on" : ""}" data-col="${col}">${testo}<span class="epa-sort-ind">${on ? (st.ordine.dir > 0 ? "▲" : "▼") : ""}</span></th>`;
	}

	function tabella(l) {
		const maxImp = Math.max(1, ...st.famiglie.map(f => f.impatto ? Math.abs(f.impatto.valore) : 0));
		const piano = (st.famiglie.find(f => f.impatto) || {}).impatto;
		return `<div class="epa-tabella-box"><table class="epa-tabella">
			<thead><tr>
				<th class="epa-col-apri"></th>
				${th("famiglia", "Famiglia")}
				${th("stato", "Stato")}
				<th>EPA<span class="epa-th-sotto">sottomissione · approvazione</span></th>
				<th>CARB<span class="epa-th-sotto">sottomissione · approvazione</span></th>
				${th("rischio", "Rischio")}
				${th("impatto", "Impatto" + (piano ? `<span class="epa-th-sotto">${esc(piano.piano)} total impact</span>` : ""), "num")}
				${th("pn", "P/N", "num")}
				<th>Customer principali</th>
				<th>TAG dei P/N</th>
				<th>Note</th>
			</tr></thead>
			<tbody>${l.map(f => riga(f, maxImp)).join("")}</tbody>
		</table></div>`;
	}

	function riga(f, maxImp) {
		const aperta = st.aperte.has(f.nome);
		const s = STATI[f.stato];
		const imp = f.impatto ? f.impatto.valore : null;
		return `<tr class="epa-riga${aperta ? " is-open" : ""}" data-fam="${esc(f.nome)}" style="--c:${s.colore}">
			<td class="epa-col-apri"><span class="cert-expand-icon">▸</span></td>
			<td class="epa-fam">${esc(f.nome)}</td>
			<td><span class="epa-stato" style="--c:${s.colore}">${s.nome}</span></td>
			<td class="epa-voci">${pill(f.epaSub)}<span class="epa-freccia">›</span>${pill(f.epaApp)}</td>
			<td class="epa-voci">${pill(f.carbSub)}<span class="epa-freccia">›</span>${pill(f.carbApp)}</td>
			<td>${rischio(f.rischio)}</td>
			<td class="num">${imp === null ? `<span class="cx-muted">—</span>` : `<div class="epa-imp"><span>${num(imp)}</span>${imp ? `<i style="width:${Math.max(3, Math.abs(imp) / maxImp * 100).toFixed(1)}%"></i>` : ""}</div>`}</td>
			<td class="num">${f.pn.length ? `<strong>${num(f.pn.length)}</strong>` : `<span class="epa-zero" title="Nessun P/N con questa REF. US FAMILY nello Shop Order">0</span>`}</td>
			<td>${f.clienti.slice(0, 2).map(([c, n]) => `<span class="epa-chip" title="${esc(c)}: ${n} P/N">${esc(c.length > 22 ? c.slice(0, 21) + "…" : c)} <b>${n}</b></span>`).join("")}${f.clienti.length > 2 ? `<span class="cx-muted"> +${f.clienti.length - 2}</span>` : ""}</td>
			<td class="epa-col-tag">${tagChips(f)}</td>
			<td class="epa-col-note"><div class="epa-note" title="${esc(f.note)}">${esc(f.note)}</div></td>
		</tr>${aperta ? `<tr class="epa-dettaglio"><td colspan="11">${dettaglio(f)}</td></tr>` : ""}`;
	}

	// TAG della famiglia: quanti P/N li hanno; rosso se qualcuno è deprecato oggi (intervallo VStart-VEnd che comprende oggi)
	function tagChips(f, tutti) {
		if (!f.tag.length) return `<span class="cx-muted">—</span>`;
		const lista = tutti ? f.tag : f.tag.slice(0, 6);
		return lista.map(([t, c]) => `<span class="epa-tag${c.oggi ? " epa-tag-dep" : ""}" title="${esc(t)}: ${c.pn} P/N${c.oggi ? `, deprecato oggi su ${c.oggi}` : ""}">${esc(t)}<b>${c.pn}</b></span>`).join("")
			+ (!tutti && f.tag.length > 6 ? `<span class="cx-muted"> +${f.tag.length - 6}</span>` : "");
	}

	function dettaglio(f) {
		const piani = (f.dati.piani || []).filter(p => p.valori && p.valori.length);
		const storico = (f.dati.storico || []).filter(x => x.testo);
		const pnRighe = f.pn.slice().sort((a, b) => String(a["P/N Motore"]).localeCompare(String(b["P/N Motore"]), "it", { numeric: true }));
		const tagPn = p => p.__tag.length
			? p.__tag.map(t => `<span class="epa-tag epa-tag-${t.stato}" title="${esc(t.tag)}: ${esc(t.vs || "?")} → ${esc(t.ve || "?")} (${({ oggi: "deprecato oggi", futuro: "deprecazione futura", finito: "deprecazione finita", nessuno: "senza date" })[t.stato]})">${esc(t.tag)}</span>`).join("")
			: `<span class="cx-muted">nessun TAG</span>`;
		return `<div class="epa-det">
			<div class="epa-det-col">
				<h4>Passi</h4>
				<div class="epa-passi">
					${passo("EPA sottomissione", f.epaSub)}${passo("EPA approvazione", f.epaApp)}
					${passo("CARB sottomissione", f.carbSub)}${passo("CARB approvazione", f.carbApp)}
				</div>
				${f.note ? `<h4>Note</h4><p class="epa-testo-lungo">${esc(f.note)}</p>` : ""}
				${piani.map(p => `<h4>${esc(p.nome)}</h4><table class="epa-mini">${p.valori.map(v => `<tr><td>${esc(v.nome)}</td><td class="num">${typeof v.valore === "number" ? num(v.valore) : esc(v.valore)}</td></tr>`).join("")}</table>`).join("")}
				${storico.length ? `<h4>Previous planning</h4>${storico.map(x => `<p class="epa-testo-lungo"><strong>${esc(x.titolo.replace(/^previous planning\s*/i, ""))}</strong> ${esc(x.testo)}</p>`).join("")}` : ""}
				${f.tag.length ? `<h4>TAG (P/N che li hanno)</h4><div>${tagChips(f, true)}</div>` : ""}
			</div>
			<div class="epa-det-col epa-det-pn">
				<h4>P/N Motore della famiglia ${esc(famigliaBase(f.nome))} (${num(f.pn.length)})${f.pnDeprecati ? ` · <span class="epa-rosso">${num(f.pnDeprecati)} con TAG deprecati oggi</span>` : ""}</h4>
				${f.pn.length ? `<div class="epa-pn-scroll"><table class="epa-mini epa-pn">
					<thead><tr><th>P/N Motore</th><th>Engine code</th><th>REF. US FAMILY</th><th>Customer</th><th>Application</th><th>Status</th><th>TAG</th></tr></thead>
					<tbody>${pnRighe.map(p => `<tr><td><strong>${esc(p["P/N Motore"])}</strong></td><td>${esc(p["Engine code"])}</td><td>${esc(p["REF. US FAMILY"])}</td><td>${esc(p["Customer"])}</td><td>${esc(p["Application"])}</td><td>${esc(p["Status"])}</td><td class="epa-pn-tag">${tagPn(p)}</td></tr>`).join("")}</tbody>
				</table></div>
				<p class="cx-muted epa-legenda-tag"><span class="epa-tag epa-tag-oggi">X</span> deprecato oggi · <span class="epa-tag epa-tag-futuro">X</span> deprecazione futura · <span class="epa-tag epa-tag-finito">X</span> deprecazione finita</p>`
				: `<p class="cx-muted">Nessun P/N nello Shop Order ha REF. US FAMILY che finisce con ${esc(famigliaBase(f.nome))}.</p>`}
			</div>
		</div>`;
	}

	function passo(nome, v) {
		return `<div class="epa-passo epa-passo-${VOCI[v.tipo].cls}${v.ritardo ? " epa-ritardo" : ""}"><span class="epa-passo-nome">${nome}</span>
			<span class="epa-passo-stato">${esc(VOCI[v.tipo].nome)}${v.settTesto ? " · " + esc(v.settTesto) : ""}${v.ritardo ? " · settimana passata" : ""}</span>
			${v.testo && up(v.testo) !== up(VOCI[v.tipo].nome) ? `<span class="epa-passo-file">${esc(v.testo)}</span>` : ""}</div>`;
	}

	/* ---- calendario: una riga per famiglia, una colonna per settimana ---- */
	function calendario(l) {
		const tutteSett = [];
		l.forEach(f => [f.epaSub, f.epaApp, f.carbSub, f.carbApp].forEach(v => { if (v.sett) tutteSett.push(v.sett.i); }));
		const oggiI = indice(st.oggi.anno, st.oggi.sett);
		if (!tutteSett.length) return `<div class="cx-card"><div class="cx-card-body cx-muted">Nessuna settimana indicata per queste famiglie.</div></div>`;
		let min = Math.min(...tutteSett, oggiI), max = Math.max(...tutteSett, oggiI);
		if (max - min > 78) min = max - 78; // al massimo un anno e mezzo
		const col = [];
		for (let i = min; i <= max; i++) col.push(i);
		const etich = i => { const w = daIndice(i); return { anno: w.anno, s: w.sett }; };
		const segni = { epaSub: "●", epaApp: "◆", carbSub: "○", carbApp: "◇" };
		const nomiSegni = { epaSub: "EPA sottomissione", epaApp: "EPA approvazione", carbSub: "CARB sottomissione", carbApp: "CARB approvazione" };
		const cella = (f, i) => {
			const qui = Object.keys(segni).filter(k => f[k].sett && Math.max(f[k].sett.i, min) === i);
			if (!qui.length) return "";
			return qui.map(k => `<span class="epa-segno epa-segno-${VOCI[f[k].tipo].cls}${f[k].ritardo ? " epa-ritardo" : ""}" title="${esc(f.nome)} — ${nomiSegni[k]}: ${esc(VOCI[f[k].tipo].nome)} ${esc(f[k].settTesto)}${f[k].ritardo ? " (settimana passata)" : ""}">${segni[k]}</span>`).join("");
		};
		return `<div class="epa-cal-legenda">
				<span><b>●</b> EPA sottomissione</span><span><b>◆</b> EPA approvazione</span><span><b>○</b> CARB sottomissione</span><span><b>◇</b> CARB approvazione</span>
				<span><i class="epa-dot epa-seg-approvata"></i>fatto</span><span><i class="epa-dot epa-seg-attesa"></i>da approvare</span><span><i class="epa-dot epa-seg-dafare"></i>da sottomettere</span>
				<span><i class="epa-dot epa-ritardo-dot"></i>settimana passata</span>
			</div>
			<div class="epa-cal-box"><table class="epa-cal">
			<thead><tr><th class="epa-cal-fam">Famiglia</th>${col.map(i => { const e = etich(i); return `<th class="${i === oggiI ? "epa-oggi" : ""}${e.s === 1 ? " epa-anno" : ""}" title="CW${e.s}/${e.anno}">${e.s === 1 || i === min ? `<span class="epa-cal-anno">${e.anno}</span>` : ""}${e.s}</th>`; }).join("")}</tr></thead>
			<tbody>${l.map(f => `<tr><td class="epa-cal-fam" style="--c:${STATI[f.stato].colore}"><span class="epa-cal-nome">${esc(f.nome)}</span>${f.rischio === "HIGH" ? `<span class="epa-rischio epa-rischio-alto">!</span>` : ""}</td>${col.map(i => `<td class="${i === oggiI ? "epa-oggi" : ""}">${cella(f, i)}</td>`).join("")}</tr>`).join("")}</tbody>
		</table></div>`;
	}

	/* ================= eventi ================= */

	function avvia() {
		const sez = $("#epa-view");
		if (!sez) return;
		sez.addEventListener("click", e => {
			const k = e.target.closest(".epa-kpi[data-stato]");
			if (k) { st.filtroStato = st.filtroStato === k.dataset.stato ? "" : k.dataset.stato; disegna(); return; }
			const fl = e.target.closest(".epa-kpi[data-flag]");
			if (fl) {
				if (fl.dataset.flag === "rischio") st.soloRischio = st.soloRischio === "HIGH" ? "" : "HIGH";
				else st.soloRitardo = !st.soloRitardo;
				disegna(); return;
			}
			const v = e.target.closest(".epa-viste button");
			if (v) { st.vista = v.dataset.vista; disegna(); return; }
			if (e.target.closest("#epa-azzera")) { st.filtroStato = ""; st.soloRischio = ""; st.soloRitardo = false; st.cerca = ""; disegna(); return; }
			const h = e.target.closest(".epa-sort");
			if (h) { st.ordine = { col: h.dataset.col, dir: st.ordine.col === h.dataset.col ? -st.ordine.dir : 1 }; disegnaElenco(); return; }
			const r = e.target.closest(".epa-riga");
			if (r) { const n = r.dataset.fam; if (st.aperte.has(n)) st.aperte.delete(n); else st.aperte.add(n); disegnaElenco(); }
		});
		sez.addEventListener("input", e => {
			if (e.target.id !== "epa-cerca") return;
			st.cerca = e.target.value;
			clearTimeout(avvia.t);
			avvia.t = setTimeout(() => {
				disegnaElenco();
				const az = $("#epa-azzera");
				if (!az && st.cerca) disegna(), $("#epa-cerca").focus(), $("#epa-cerca").setSelectionRange(st.cerca.length, st.cerca.length);
			}, 200);
		});
		sez.addEventListener("change", e => {
			if (e.target.id === "epa-rischio") { st.soloRischio = e.target.value; disegna(); }
		});
	}

	// Usate da Motori.js quando si apre / chiude la scheda
	window.CertificatiEpa = {
		mostra() {
			const s = $("#epa-view");
			if (!s) return;
			s.hidden = false;
			if (!st.caricato) carica();
		},
		nascondi() {
			const s = $("#epa-view");
			if (s) s.hidden = true;
		},
		ricarica() { st.caricato = false; }
	};

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
	else avvia();
})();
