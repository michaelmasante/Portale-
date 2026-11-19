(function () {
	const API = "API/Certificati.ashx";

	const STATI = {
		ok: { nome: "Approvata", colore: "#1BC5BD", ordine: 4 },
		corso: { nome: "In approvazione", colore: "#3699FF", ordine: 2 },
		dafare: { nome: "Da sottomettere", colore: "#FFA800", ordine: 1 },
		standby: { nome: "Stand by", colore: "#A1A5B7", ordine: 5 },
		phased: { nome: "Phased out", colore: "#5E6278", ordine: 6 },
		na: { nome: "Non richiesta", colore: "#B5B5C3", ordine: 7 }
	};
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
		caricato: false, caricando: null, famiglie: [], ultimo: null, oggi: null, annoBase: null,
		aut: "EPA",
		vista: "tabella", filtroStato: "", soloRischio: "", soloRitardo: false, cerca: "",
		ordine: { col: "ordine", dir: 1 }, aperte: new Set()
	};

	function settimanaIso(d) {
		const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
		const g = t.getUTCDay() || 7;
		t.setUTCDate(t.getUTCDate() + 4 - g);
		const inizio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
		return { anno: t.getUTCFullYear(), sett: Math.ceil(((t - inizio) / 86400000 + 1) / 7) };
	}
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

	function leggiSettimana(v) {
		const s = up(v).replace(/^CW\s*/, "");
		const m = s.match(/^(\d{1,2})(?:\s*\/\s*(\d{4}))?$/);
		if (!m) return null;
		const sett = Number(m[1]);
		if (sett < 1 || sett > 53) return null;
		const anno = m[2] ? Number(m[2]) : st.annoBase;
		return { anno, sett, i: indice(anno, sett), testo: `CW${String(sett).padStart(2, "0")}${m[2] || anno !== st.oggi.anno ? "/" + anno : ""}` };
	}

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
		else if (leggiSettimana(s)) tipo = "approvata";
		else tipo = "attesa";
		const daFare = tipo === "attesa" || tipo === "dafare";
		const ritardo = !!(daFare && w && w.i < indice(st.oggi.anno, st.oggi.sett));
		return { tipo, testo: stato || "", sett: w, settTesto: w ? w.testo : (sett ? String(sett) : ""), ritardo };
	}

	function statoEnte(sub, app) {
		const t = [sub.tipo, app.tipo];
		if (t.includes("phased")) return "phased";
		if (t.includes("standby")) return "standby";
		if (t.every(x => x === "na" || x === "vuota")) return "na";
		if (sub.tipo === "dafare") return "dafare";
		if (app.tipo === "approvata") return "ok";
		return "corso";
	}

	const sub = f => st.aut === "EPA" ? f.epaSub : f.carbSub;
	const app = f => st.aut === "EPA" ? f.epaApp : f.carbApp;
	const statoDi = f => st.aut === "EPA" ? f.statoEpa : f.statoCarb;
	const ritardoDi = f => sub(f).ritardo || app(f).ritardo;

	async function api(azione) {
		let json;
		try {
			const res = await fetch(API + "?action=" + azione + ((window.CertificatiAnno || {}).q || ""), { credentials: "same-origin", cache: "no-store" });
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

	function famigliaUs(v) {
		const m = up(v).match(/(\d{2}\.\d[A-Z0-9]{3})$/);
		return m ? m[1] : "";
	}
	const famigliaBase = f => up(f).split(" ")[0];

	function impattoUltimoPiano(dati) {
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
			const [epa, shop] = await Promise.all([api("epa"), datiPortale("shoporder")]);
			st.ultimo = epa.ultimo || null;
			const annoFoto = (window.CertificatiAnno || {}).anno;
			const oggi = annoFoto ? new Date(annoFoto, 11, 31) : new Date();
			st.oggi = settimanaIso(oggi);
			const dataFile = st.ultimo && st.ultimo.data ? new Date(String(st.ultimo.data).slice(0, 10)) : oggi;
			st.annoBase = isNaN(dataFile) ? oggi.getFullYear() : dataFile.getFullYear();

			const sc = shop.colonne || [];
			const iUs = sc.indexOf("REF. US FAMILY");
			const perFam = new Map();
			(shop.righe || []).forEach(r => {
				const f = famigliaUs(r[iUs]);
				if (!f) return;
				if (!perFam.has(f)) perFam.set(f, []);
				perFam.get(f).push(r);
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
				f.statoEpa = statoEnte(f.epaSub, f.epaApp);
				f.statoCarb = statoEnte(f.carbSub, f.carbApp);
				f.pn = (perFam.get(famigliaBase(f.nome)) || []).map(row => {
					const obj = {};
					sc.forEach((c, j) => { obj[c] = row[j] ?? ""; });
					obj.__cerca = [obj["P/N Motore"], obj["Engine code"], obj["Customer"], obj["Application"], obj["REF. US FAMILY"]].join(" ").toLowerCase();
					return obj;
				});
				return f;
			});
			st.caricato = true;
			disegna();
		} catch (e) {
			box.innerHTML = `<div class="cx-alert cx-alert-danger">Tracker EPA non disponibile: ${esc(e.message)}</div>
				<p class="cx-testo cx-muted">Se il database non è ancora stato creato: eseguire SQL/TrackerEPA_01_database.sql e poi caricare il file dalla scheda Carica Excel.</p>`;
		}
	}

	function filtriPagina() {
		const f = window.CertificatiFiltri;
		const clienti = f && f.clienti ? f.clienti() : [];
		const us = f && f.usFamily ? f.usFamily() : [];
		return { clienti: new Set(clienti), us: new Set(us), attivi: clienti.length > 0 || us.length > 0, nClienti: clienti.length, nUs: us.length };
	}

	function pnVisibili(f, fp) {
		if (!fp.attivi) return f.pn;
		return f.pn.filter(p =>
			(!fp.clienti.size || fp.clienti.has(String(p["Customer"] || "").trim())) &&
			(!fp.us.size || fp.us.has(String(p["REF. US FAMILY"] || "").trim())));
	}

	function riassunto(f, fp) {
		const pn = pnVisibili(f, fp);
		const clienti = {};
		pn.forEach(p => {
			const c = p["Customer"] || "—";
			clienti[c] = (clienti[c] || 0) + 1;
		});
		return { pn, clienti: Object.entries(clienti).sort((a, b) => b[1] - a[1]) };
	}

	function famigliePagina(fp) {
		const l = [];
		st.famiglie.forEach(f => {
			const r = riassunto(f, fp);
			if (fp.attivi && !r.pn.length) return;
			l.push({ f, r });
		});
		return l;
	}

	function filtrate(base) {
		const q = st.cerca.trim().toLowerCase();
		let l = base.filter(({ f, r }) =>
			(!st.filtroStato || statoDi(f) === st.filtroStato) &&
			(!st.soloRischio || f.rischio === st.soloRischio) &&
			(!st.soloRitardo || ritardoDi(f)) &&
			(!q || f.nome.toLowerCase().includes(q) || f.note.toLowerCase().includes(q) || r.pn.some(p => p.__cerca.includes(q))));
		const o = st.ordine, d = o.dir;
		const val = ({ f, r }) => o.col === "famiglia" ? f.nome.toLowerCase()
			: o.col === "stato" ? STATI[statoDi(f)].ordine
			: o.col === "rischio" ? ({ HIGH: 0, MED: 1, MEDIUM: 1, LOW: 2 }[f.rischio] ?? 3)
			: o.col === "impatto" ? -(f.impatto ? f.impatto.valore : -1)
			: o.col === "pn" ? -r.pn.length
			: o.col === "approvazione" ? (app(f).sett ? app(f).sett.i : 1e9)
			: f.ordine;
		l = l.slice().sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * d || a.f.ordine - b.f.ordine; });
		return l;
	}

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
		if (!box || !st.caricato) return;
		if (!st.famiglie.length) {
			box.innerHTML = `<div class="cx-card"><div class="cx-card-body">Nessuna famiglia nel database: caricare il file Tracker EPA dalla scheda <strong>Carica Excel</strong>.</div></div>`;
			return;
		}
		const fp = filtriPagina();
		const base = famigliePagina(fp);
		const conta = k => base.filter(x => statoDi(x.f) === k).length;
		const pnTot = base.reduce((a, x) => a + x.r.pn.length, 0);
		const alto = base.filter(x => x.f.rischio === "HIGH").length;
		const ritardo = base.filter(x => ritardoDi(x.f)).length;
		const u = st.ultimo;
		const filtriTesto = fp.attivi
			? [fp.nClienti ? `Customer (${fp.nClienti})` : "", fp.nUs ? `Ref. US Family (${fp.nUs})` : ""].filter(Boolean).join(" · ")
			: "";

		const kpi = (k, nome, n, colore, extra) => `<button type="button" class="epa-kpi${st.filtroStato === k ? " is-on" : ""}" data-stato="${k}" style="--c:${colore}">
			<span class="epa-kpi-n">${num(n)}</span><span class="epa-kpi-nome">${nome}</span>${extra || ""}</button>`;
		const statiVisti = Object.keys(STATI).filter(k => k !== "na" || conta("na"));

		box.innerHTML = `
			<div class="epa-testa">
				<div>
					<h2 class="epa-titolo">Tracker ${st.aut}</h2>
					<div class="cx-muted epa-sotto">${u ? `${esc(u.foglio || u.file || "")} · caricato il ${esc(String(u.data || "").slice(0, 10).split("-").reverse().join("/"))}${u.utente ? " da " + esc(u.utente) : ""}` : ""} · ${(window.CertificatiAnno || {}).anno ? `fotografia al 31/12/${window.CertificatiAnno.anno} (CW${String(st.oggi.sett).padStart(2, "0")}/${st.oggi.anno})` : `oggi CW${String(st.oggi.sett).padStart(2, "0")}/${st.oggi.anno}`}</div>
					${filtriTesto ? `<div class="epa-filtri-pagina">Filtrato per ${esc(filtriTesto)}: si contano solo i P/N che li rispettano.</div>` : ""}
				</div>
				<div class="epa-viste" role="group">
					<button type="button" data-vista="tabella" class="${st.vista === "tabella" ? "is-on" : ""}">Tabella</button>
					<button type="button" data-vista="calendario" class="${st.vista === "calendario" ? "is-on" : ""}">Calendario</button>
				</div>
			</div>

			<div class="epa-kpis">
				${kpi("", "Famiglie", base.length, "#3f4254", `<span class="epa-kpi-extra">${num(pnTot)} P/N nel portale</span>`)}
				${statiVisti.map(k => kpi(k, STATI[k].nome, conta(k), STATI[k].colore)).join("")}
				<button type="button" class="epa-kpi epa-kpi-flag${st.soloRischio === "HIGH" ? " is-on" : ""}" data-flag="rischio" style="--c:#F64E60"><span class="epa-kpi-n">${num(alto)}</span><span class="epa-kpi-nome">Rischio alto</span></button>
				<button type="button" class="epa-kpi epa-kpi-flag${st.soloRitardo ? " is-on" : ""}" data-flag="ritardo" style="--c:#B5179E"><span class="epa-kpi-n">${num(ritardo)}</span><span class="epa-kpi-nome">Settimana passata</span></button>
			</div>

			<div class="epa-barre">
				${barra(st.aut, base.map(x => [sub(x.f), app(x.f)]))}
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
		disegnaElenco(base);
	}

	function barra(nome, coppie) {
		const passo = ([s, a]) => {
			if ([s.tipo, a.tipo].includes("phased")) return "phased";
			if ([s.tipo, a.tipo].includes("standby")) return "standby";
			if ([s.tipo, a.tipo].every(x => x === "na" || x === "vuota")) return "na";
			if (a.tipo === "approvata") return "approvata";
			if (s.tipo === "dafare") return "dafare";
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

	function disegnaElenco(base) {
		if (!base) base = famigliePagina(filtriPagina());
		const l = filtrate(base);
		const conteggio = $("#epa-conteggio");
		if (conteggio) conteggio.textContent = l.length === base.length ? `${l.length} famiglie` : `${l.length} di ${base.length} famiglie`;
		const box = $("#epa-elenco");
		if (!box) return;
		if (!l.length) { box.innerHTML = `<div class="cx-card"><div class="cx-card-body cx-muted">Nessuna famiglia con questi filtri.</div></div>`; return; }
		box.innerHTML = st.vista === "calendario" ? calendario(l) : tabella(l, base);
	}

	function th(col, testo, cls) {
		const on = st.ordine.col === col;
		return `<th class="epa-sort${cls ? " " + cls : ""}${on ? " is-on" : ""}" data-col="${col}">${testo}<span class="epa-sort-ind">${on ? (st.ordine.dir > 0 ? "▲" : "▼") : ""}</span></th>`;
	}

	function tabella(l, base) {
		const maxImp = Math.max(1, ...base.map(x => x.f.impatto ? Math.abs(x.f.impatto.valore) : 0));
		const piano = (st.famiglie.find(f => f.impatto) || {}).impatto;
		return `<div class="epa-tabella-box"><table class="epa-tabella">
			<thead><tr>
				<th class="epa-col-apri"></th>
				${th("famiglia", "Famiglia")}
				${th("stato", "Stato " + st.aut)}
				<th>Sottomissione ${st.aut}</th>
				${th("approvazione", "Approvazione " + st.aut)}
				${th("rischio", "Rischio")}
				${th("impatto", "Impatto" + (piano ? `<span class="epa-th-sotto">${esc(piano.piano)} total impact</span>` : ""), "num")}
				${th("pn", "P/N", "num")}
				<th>Customer principali</th>
				<th>Note</th>
			</tr></thead>
			<tbody>${l.map(x => riga(x.f, x.r, maxImp)).join("")}</tbody>
		</table></div>`;
	}

	function riga(f, r, maxImp) {
		const aperta = st.aperte.has(f.nome);
		const s = STATI[statoDi(f)];
		const imp = f.impatto ? f.impatto.valore : null;
		return `<tr class="epa-riga${aperta ? " is-open" : ""}" data-fam="${esc(f.nome)}" style="--c:${s.colore}">
			<td class="epa-col-apri"><span class="cert-expand-icon">▸</span></td>
			<td class="epa-fam">${esc(f.nome)}</td>
			<td><span class="epa-stato" style="--c:${s.colore}">${s.nome}</span></td>
			<td class="epa-voci">${pill(sub(f))}</td>
			<td class="epa-voci">${pill(app(f))}</td>
			<td>${rischio(f.rischio)}</td>
			<td class="num">${imp === null ? `<span class="cx-muted">—</span>` : `<div class="epa-imp"><span>${num(imp)}</span>${imp ? `<i style="width:${Math.max(3, Math.abs(imp) / maxImp * 100).toFixed(1)}%"></i>` : ""}</div>`}</td>
			<td class="num">${r.pn.length ? `<strong>${num(r.pn.length)}</strong>` : `<span class="epa-zero" title="Nessun P/N con questa REF. US FAMILY nello Shop Order">0</span>`}</td>
			<td>${r.clienti.slice(0, 2).map(([c, n]) => `<span class="epa-chip" title="${esc(c)}: ${n} P/N">${esc(c.length > 22 ? c.slice(0, 21) + "…" : c)} <b>${n}</b></span>`).join("")}${r.clienti.length > 2 ? `<span class="cx-muted"> +${r.clienti.length - 2}</span>` : ""}</td>
			<td class="epa-col-note"><div class="epa-note" title="${esc(f.note)}">${esc(f.note)}</div></td>
		</tr>${aperta ? `<tr class="epa-dettaglio"><td colspan="10">${dettaglio(f, r)}</td></tr>` : ""}`;
	}

	function dettaglio(f, r) {
		const piani = (f.dati.piani || []).filter(p => p.valori && p.valori.length);
		const storico = (f.dati.storico || []).filter(x => x.testo);
		const pnRighe = r.pn.slice().sort((a, b) => String(a["P/N Motore"]).localeCompare(String(b["P/N Motore"]), "it", { numeric: true }));
		const altro = st.aut === "EPA" ? "CARB" : "EPA";
		const altroStato = STATI[st.aut === "EPA" ? f.statoCarb : f.statoEpa];
		return `<div class="epa-det">
			<div class="epa-det-col">
				<h4>Passi ${st.aut}</h4>
				<div class="epa-passi">
					${passo(st.aut + " sottomissione", sub(f))}${passo(st.aut + " approvazione", app(f))}
				</div>
				<p class="epa-altro">${altro}: <span class="epa-stato" style="--c:${altroStato.colore}">${altroStato.nome}</span> (scheda Tracker ${altro})</p>
				${f.note ? `<h4>Note</h4><p class="epa-testo-lungo">${esc(f.note)}</p>` : ""}
				${piani.map(p => `<h4>${esc(p.nome)}</h4><table class="epa-mini">${p.valori.map(v => `<tr><td>${esc(v.nome)}</td><td class="num">${typeof v.valore === "number" ? num(v.valore) : esc(v.valore)}</td></tr>`).join("")}</table>`).join("")}
				${storico.length ? `<h4>Previous planning</h4>${storico.map(x => `<p class="epa-testo-lungo"><strong>${esc(x.titolo.replace(/^previous planning\s*/i, ""))}</strong> ${esc(x.testo)}</p>`).join("")}` : ""}
			</div>
			<div class="epa-det-col epa-det-pn">
				<h4>P/N Motore della famiglia ${esc(famigliaBase(f.nome))} (${num(r.pn.length)}${r.pn.length !== f.pn.length ? ` di ${num(f.pn.length)}, filtrati` : ""})</h4>
				${r.pn.length ? `<div class="epa-pn-scroll"><table class="epa-mini epa-pn">
					<thead><tr><th>P/N Motore</th><th>Engine code</th><th>REF. US FAMILY</th><th>Customer</th><th>Application</th><th>Status</th></tr></thead>
					<tbody>${pnRighe.map(p => `<tr><td><strong>${esc(p["P/N Motore"])}</strong></td><td>${esc(p["Engine code"])}</td><td>${esc(p["REF. US FAMILY"])}</td><td>${esc(p["Customer"])}</td><td>${esc(p["Application"])}</td><td>${esc(p["Status"])}</td></tr>`).join("")}</tbody>
				</table></div>`
				: `<p class="cx-muted">Nessun P/N nello Shop Order ha REF. US FAMILY che finisce con ${esc(famigliaBase(f.nome))}.</p>`}
			</div>
		</div>`;
	}

	function passo(nome, v) {
		return `<div class="epa-passo epa-passo-${VOCI[v.tipo].cls}${v.ritardo ? " epa-ritardo" : ""}"><span class="epa-passo-nome">${nome}</span>
			<span class="epa-passo-stato">${esc(VOCI[v.tipo].nome)}${v.settTesto ? " · " + esc(v.settTesto) : ""}${v.ritardo ? " · settimana passata" : ""}</span>
			${v.testo && up(v.testo) !== up(VOCI[v.tipo].nome) ? `<span class="epa-passo-file">${esc(v.testo)}</span>` : ""}</div>`;
	}

	function calendario(l) {
		const voci = f => ({ sub: sub(f), app: app(f) });
		const tutteSett = [];
		l.forEach(({ f }) => { const v = voci(f); [v.sub, v.app].forEach(x => { if (x.sett) tutteSett.push(x.sett.i); }); });
		const oggiI = indice(st.oggi.anno, st.oggi.sett);
		if (!tutteSett.length) return `<div class="cx-card"><div class="cx-card-body cx-muted">Nessuna settimana indicata per queste famiglie.</div></div>`;
		let min = Math.min(...tutteSett, oggiI), max = Math.max(...tutteSett, oggiI);
		if (max - min > 78) min = max - 78;
		const col = [];
		for (let i = min; i <= max; i++) col.push(i);
		const etich = i => { const w = daIndice(i); return { anno: w.anno, s: w.sett }; };
		const segni = { sub: "●", app: "◆" };
		const nomiSegni = { sub: st.aut + " sottomissione", app: st.aut + " approvazione" };
		const cella = (f, i) => {
			const v = voci(f);
			const qui = Object.keys(segni).filter(k => v[k].sett && Math.max(v[k].sett.i, min) === i);
			if (!qui.length) return "";
			return qui.map(k => `<span class="epa-segno epa-segno-${VOCI[v[k].tipo].cls}${v[k].ritardo ? " epa-ritardo" : ""}" title="${esc(f.nome)} — ${nomiSegni[k]}: ${esc(VOCI[v[k].tipo].nome)} ${esc(v[k].settTesto)}${v[k].ritardo ? " (settimana passata)" : ""}">${segni[k]}</span>`).join("");
		};
		return `<div class="epa-cal-legenda">
				<span><b>●</b> ${st.aut} sottomissione</span><span><b>◆</b> ${st.aut} approvazione</span>
				<span><i class="epa-dot epa-seg-approvata"></i>fatto</span><span><i class="epa-dot epa-seg-attesa"></i>da approvare</span><span><i class="epa-dot epa-seg-dafare"></i>da sottomettere</span>
				<span><i class="epa-dot epa-ritardo-dot"></i>settimana passata</span>
			</div>
			<div class="epa-cal-box"><table class="epa-cal">
			<thead><tr><th class="epa-cal-fam">Famiglia</th>${col.map(i => { const e = etich(i); return `<th class="${i === oggiI ? "epa-oggi" : ""}${e.s === 1 ? " epa-anno" : ""}" title="CW${e.s}/${e.anno}">${e.s === 1 || i === min ? `<span class="epa-cal-anno">${e.anno}</span>` : ""}${e.s}</th>`; }).join("")}</tr></thead>
			<tbody>${l.map(({ f }) => `<tr><td class="epa-cal-fam" style="--c:${STATI[statoDi(f)].colore}"><span class="epa-cal-nome">${esc(f.nome)}</span>${f.rischio === "HIGH" ? `<span class="epa-rischio epa-rischio-alto">!</span>` : ""}</td>${col.map(i => `<td class="${i === oggiI ? "epa-oggi" : ""}">${cella(f, i)}</td>`).join("")}</tr>`).join("")}</tbody>
		</table></div>`;
	}

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
		document.addEventListener("certificati:filtri", () => {
			const s = $("#epa-view");
			if (s && !s.hidden && st.caricato) disegna();
		});
	}

	window.CertificatiEpa = {
		mostra(ente) {
			const s = $("#epa-view");
			if (!s) return;
			const nuovo = ente === "CARB" ? "CARB" : "EPA";
			if (nuovo !== st.aut) {
				st.aut = nuovo;
				st.filtroStato = "";
				st.soloRitardo = false;
				if (st.ordine.col === "stato" || st.ordine.col === "approvazione") st.ordine = { col: "ordine", dir: 1 };
			}
			s.hidden = false;
			if (!st.caricato) { if (!st.caricando) st.caricando = carica(); }
			else disegna();
		},
		nascondi() {
			const s = $("#epa-view");
			if (s) s.hidden = true;
		},
		ricarica() { st.caricato = false; st.caricando = null; }
	};

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
	else avvia();
})();
