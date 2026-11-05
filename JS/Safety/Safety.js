/* ============ Safety (Safety.html) ============
   Rifacimento della vecchia app Angular "Safety" come pagina del Portale.
   - Tabelle Worked Hours / Total LTI / Lost Days in SOLA LETTURA, per perimetro (Manufacturing / Non-Manufacturing)
     e, per MFG, per area (BUS, POWERTRAIN EU+AMEA, TRUCK EU, LATAM come nella vecchia app).
   - Carica Excel: il file viene letto nel browser (SheetJS), controllato, confrontato col database e poi inviato
     ad API/Safety.ashx, che sostituisce i dati in un'unica transazione. Solo con il ruolo "Safety Upload" (o Admin).
   - Presentazione: anteprima delle slide ed export PowerPoint (SafetyReport.js).
   Calcoli in SafetyCalcoli.js. Versione nel piè di pagina: VERSIONE. */

(function () {
	"use strict";

	const VERSIONE = "0.2.1";
	const API = "API/Safety.ashx";
	const C = window.SafetyCalcoli;
	const R = window.SafetyReport;

	const PARAMETRI = {
		wh: { codice: "WH", titolo: "Total Worked Hours", menu: "Worked Hours", decimali: 2 },
		lti: { codice: "LTI", titolo: "Total N. of LTI - WR", menu: "Total LTI", decimali: 0 },
		days: { codice: "DAYS", titolo: "Total N. of days lost due to LTI - WR", menu: "Lost Days", decimali: 0 }
	};

	const $ = (s, r) => (r || document).querySelector(s);
	const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
	const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

	const stato = {
		perimetro: leggiMemoria("sf_perimetro") === "NMFG" ? "NMFG" : "MFG",
		vista: "wh",
		area: { MFG: "MFG", NMFG: "NMFG" },
		dati: {},             // perimetro -> risposta di ?action=dati
		img: null,            // immagini standard (copertina, loghi)
		report: null,         // { chiave, slides }
		testi: {},            // testi della presentazione per perimetro (modificabili)
		copertina: null,      // immagine copertina scelta dall'utente (data URL)
		file: null            // analisi del file Excel da caricare
	};

	function leggiMemoria(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
	function scriviMemoria(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* senza memoria del browser vale solo per questa visita */ } }

	/* ================= API ================= */

	async function api(azione, opzioni) {
		const o = opzioni || {};
		const url = API + "?action=" + encodeURIComponent(azione) + (o.query ? "&" + o.query : "");
		const init = { credentials: "same-origin", cache: "no-store", headers: { "X-Portale": "1" } };
		if (o.body) { init.method = "POST"; init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(o.body); }
		let res, json;
		try {
			res = await fetch(url, init);
			json = await res.json();
		} catch (e) {
			throw new Error("Il server non risponde (" + API + "). Controllare che il Portale sia pubblicato su IIS.");
		}
		if (!json || json.ok === false) throw new Error((json && (json.message + (json.detail ? " — " + json.detail : ""))) || "Errore del server.");
		return json;
	}

	async function caricaDati(perimetro, forza) {
		if (!forza && stato.dati[perimetro]) return stato.dati[perimetro];
		const d = await api("dati", { query: "perimetro=" + perimetro });
		stato.dati[perimetro] = d;
		return d;
	}

	/* ================= navigazione ================= */

	function leggiHash() {
		const p = location.hash.replace(/^#\/?/, "").split("/");
		if (p[0] === "MFG" || p[0] === "NMFG") stato.perimetro = p[0];
		if (p[1] && ["wh", "lti", "days", "presentazione", "carica"].includes(p[1])) stato.vista = p[1];
		if (stato.vista === "days" && stato.perimetro !== "MFG") stato.vista = "wh";
	}

	function vai(perimetro, vista) {
		const h = "#/" + perimetro + "/" + vista;
		if (location.hash !== h) location.hash = h;
		else mostra();
	}

	async function mostra() {
		leggiHash();
		scriviMemoria("sf_perimetro", stato.perimetro);
		$$(".sf-perimetro button").forEach(b => b.classList.toggle("is-on", b.dataset.perimetro === stato.perimetro));
		$$("#sf-menu a").forEach(a => {
			a.classList.toggle("is-on", a.dataset.vista === stato.vista);
			a.hidden = !!a.dataset.solo && a.dataset.solo !== stato.perimetro;
			a.href = "#/" + stato.perimetro + "/" + a.dataset.vista;
		});
		$$(".sf-vista").forEach(s => { s.hidden = true; });
		errore(null);
		$("#sf-loading").hidden = false;
		try {
			const d = await caricaDati(stato.perimetro);
			infoUltimo(d);
			if (!d.puoCaricare) $('#sf-menu a[data-vista="carica"]').hidden = true;
			$("#sf-loading").hidden = true;
			if (PARAMETRI[stato.vista]) mostraTabelle(d);
			else if (stato.vista === "presentazione") {
				if (!window.Chart || !window.PptxGenJS) { errore("Le librerie per grafici e PowerPoint (JS/Safety/lib/) non si sono caricate: controllare che la cartella sia stata copiata sul server."); return; }
				mostraPresentazione(d);
			}
			else if (stato.vista === "carica") {
				if (!d.puoCaricare) { vai(stato.perimetro, "wh"); return; }
				$('.sf-vista[data-vista="carica"]').hidden = false;
			}
		} catch (e) {
			$("#sf-loading").hidden = true;
			errore(e.message);
		}
	}

	function errore(msg) {
		const el = $("#sf-errore");
		el.hidden = !msg;
		el.textContent = msg || "";
	}

	function toast(msg) {
		const t = $("#sf-toast");
		t.textContent = msg;
		t.hidden = false;
		clearTimeout(toast.timer);
		toast.timer = setTimeout(() => { t.hidden = true; }, 4500);
	}

	function infoUltimo(d) {
		const u = d.ultimo;
		$("#sf-ultimo").innerHTML = u
			? `Ultimo caricamento ${esc(d.perimetro)}:<br><strong>${esc(formatoData(u.data))}</strong><br>${esc(u.utente)}<br><span title="${esc(u.file)}">${esc(u.file)}</span>`
			: `Nessun file caricato per ${esc(d.perimetro)}.`;
	}

	function formatoData(s) {
		const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
		return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : s;
	}

	/* ================= tabelle ================= */

	function aree(d) {
		if (d.perimetro !== "MFG") return [{ chiave: "NMFG", etichetta: "NMFG", locs: null }];
		const l = [{ chiave: "MFG", etichetta: "MFG", locs: null }];
		R.AREE_MFG.forEach(a => {
			const g = (d.gruppi || []).find(x => x.gruppo === a.gruppo);
			if (g) l.push({ chiave: a.gruppo, etichetta: a.etichetta, locs: g.location });
		});
		return l;
	}

	function anni(d) {
		const s = new Set();
		Object.keys(d.valori || {}).forEach(p => Object.keys(d.valori[p]).forEach(a => s.add(Number(a))));
		return Array.from(s).sort((a, b) => b - a);
	}

	// formato italiano con il punto delle migliaia anche sotto 10.000 (toLocaleString "it-IT" scrive 7989 ma 10.596)
	function numero(v, dec) {
		if (v == null) return "—";
		const f = Math.pow(10, dec);
		const r = Math.round(Number(v) * f) / f;
		const [int, d] = Math.abs(r).toFixed(dec).split(".");
		const dd = d ? d.replace(/0+$/, "") : "";
		return (r < 0 ? "-" : "") + int.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (dd ? "," + dd : "");
	}

	function mostraTabelle(d) {
		const par = PARAMETRI[stato.vista];
		const sez = $('.sf-vista[data-vista="tabelle"]');
		sez.hidden = false;
		sez.classList.toggle("sf-nmfg", d.perimetro === "NMFG");
		$("#sf-crumb").textContent = par.menu;

		const elenco = aree(d);
		if (!elenco.some(a => a.chiave === stato.area[d.perimetro])) stato.area[d.perimetro] = elenco[0].chiave;
		const area = elenco.find(a => a.chiave === stato.area[d.perimetro]);
		const tabs = $("#sf-aree");
		tabs.hidden = elenco.length < 2;
		tabs.innerHTML = elenco.map(a => `<button type="button" data-area="${esc(a.chiave)}" class="${a === area ? "is-on" : ""}">${esc(a.etichetta)}</button>`).join("");

		const box = $("#sf-tabelle");
		const lista = anni(d);
		if (!lista.length) {
			box.innerHTML = `<div class="sf-card"><div class="sf-vuota">Nessun dato nel database per ${esc(d.perimetro)}.${d.puoCaricare ? ` Caricare il file Excel da <a href="#/${d.perimetro}/carica">Carica Excel</a>.` : ""}</div></div>`;
			return;
		}
		const mesi = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
		const ex = esclusi(d.perimetro);
		const fuori = n => ex.has(n.toLowerCase());
		box.innerHTML = lista.map(anno => {
			const tutte = C.location(d, anno);
			const locs = area.locs ? C.ordina(area.locs) : tutte;
			const valori = (d.valori[par.codice] || {})[String(anno)] || {};
			const trova = l => Object.keys(valori).find(x => x.toLowerCase() === l.toLowerCase());
			const tot = Array(12).fill(null);
			const spunta = (nome) => `<td class="sel"><input type="checkbox" data-loc="${esc(nome)}" ${fuori(nome) ? "" : "checked"} title="Includi nella presentazione"></td>`;
			const righe = locs.map(l => {
				const k = trova(l);
				const v = k ? valori[k] : null;
				const nome = k || l;
				const cls = fuori(nome) ? ' class="sf-escluso"' : "";
				if (!v) return `<tr${cls}>${spunta(nome)}<td class="loc sf-mancante" title="Location non presente nel file per questo parametro/anno">${esc(l)} <i class="bi bi-exclamation-triangle"></i></td>${mesi.map(() => `<td class="vuoto">—</td>`).join("")}</tr>`;
				if (!fuori(nome)) v.forEach((x, i) => { if (x != null) tot[i] = (tot[i] || 0) + Number(x); });
				return `<tr${cls}>${spunta(nome)}<td class="loc" title="${esc(k)}">${esc(k)}</td>${v.map(x => `<td class="${x == null ? "vuoto" : ""}">${numero(x, par.decimali)}</td>`).join("")}</tr>`;
			}).join("");
			const nSel = locs.filter(l => !fuori(trova(l) || l)).length;
			return `<div class="sf-card sf-tab-card">
				<div class="sf-tab-head">${esc(area.etichetta)} – ${esc(par.titolo)} ${anno}<small>${nSel === locs.length ? locs.length + " location" : nSel + " di " + locs.length + " location selezionate"}</small></div>
				<div class="sf-table-wrap"><table class="sf-dati">
					<thead><tr><th class="sel"><input type="checkbox" data-tutte="${esc(JSON.stringify(locs.map(l => trova(l) || l)))}" title="Seleziona / deseleziona tutte" ${nSel === locs.length ? "checked" : ""} ${nSel > 0 && nSel < locs.length ? "data-mezzo=\"1\"" : ""}></th><th class="loc">Location Name</th>${mesi.map(m => `<th>${m}</th>`).join("")}</tr></thead>
					<tbody>${righe}</tbody>
					<tfoot><tr><td class="sel"></td><td class="loc">${esc(area.etichetta)} ${esc(par.titolo)}</td>${tot.map(t => `<td>${t == null ? "—" : numero(t, 0)}</td>`).join("")}</tr></tfoot>
				</table></div>
			</div>`;
		}).join("");
		$$("input[data-mezzo]", box).forEach(c => { c.indeterminate = true; });
	}

	/* ================= location selezionate (spunte) =================
	   Come nella vecchia app: le spunte decidono quali location entrano nella presentazione (e nei totali delle tabelle).
	   Si salvano nel browser (chiave sf_esclusi_MFG / sf_esclusi_NMFG) come elenco delle location TOLTE:
	   una location nuova nel file è quindi sempre inclusa finché non si toglie la spunta. Valgono per tutti gli anni e i parametri. */

	function esclusi(perimetro) {
		try { return new Set(JSON.parse(leggiMemoria("sf_esclusi_" + perimetro) || "[]").map(x => String(x).toLowerCase())); }
		catch (e) { return new Set(); }
	}

	function salvaEsclusi(perimetro, set) {
		scriviMemoria("sf_esclusi_" + perimetro, JSON.stringify(Array.from(set)));
	}

	function cambiaSpunta(e) {
		const c = e.target;
		if (!c.matches('input[type="checkbox"]')) return;
		const per = stato.perimetro;
		const set = esclusi(per);
		const nomi = c.dataset.tutte ? JSON.parse(c.dataset.tutte) : [c.dataset.loc];
		nomi.forEach(n => { if (c.checked) set.delete(n.toLowerCase()); else set.add(n.toLowerCase()); });
		salvaEsclusi(per, set);
		stato.report = null;
		mostraTabelle(stato.dati[per]);
	}

	/* Copia dei dati senza le location tolte: è quella che va alla presentazione */
	function datiSelezionati(d) {
		const ex = esclusi(d.perimetro);
		if (!ex.size) return { dati: d, tolte: [] };
		const tolte = new Set();
		const valori = {};
		Object.keys(d.valori || {}).forEach(par => {
			valori[par] = {};
			Object.keys(d.valori[par]).forEach(anno => {
				valori[par][anno] = {};
				Object.keys(d.valori[par][anno]).forEach(loc => {
					if (ex.has(loc.toLowerCase())) tolte.add(loc);
					else valori[par][anno][loc] = d.valori[par][anno][loc];
				});
			});
		});
		const gruppi = (d.gruppi || []).map(g => ({ gruppo: g.gruppo, location: g.location.filter(l => !ex.has(l.toLowerCase())) }));
		return { dati: Object.assign({}, d, { valori, gruppi }), tolte: C.ordina(Array.from(tolte)) };
	}

	/* ================= presentazione ================= */

	function mesiDisponibili(d) {
		const out = [];
		anni(d).forEach(anno => {
			const locs = Object.keys(((d.valori.WH || {})[String(anno)]) || {});
			for (let m = 11; m >= 0; m--) if (C.meseCompilato(d, anno, m, locs)) out.push({ anno, mese: m });
		});
		return out;
	}

	function meseScelto(d) {
		const sel = $("#sf-mese");
		const lista = mesiDisponibili(d);
		const chiave = sel.dataset.perimetro === d.perimetro ? sel.value : "";
		sel.innerHTML = lista.map(x => `<option value="${x.anno}-${x.mese}">${R.MESI_FULL[x.mese]} ${x.anno}</option>`).join("");
		sel.dataset.perimetro = d.perimetro;
		if (chiave && lista.some(x => `${x.anno}-${x.mese}` === chiave)) sel.value = chiave;
		const [a, m] = (sel.value || "").split("-").map(Number);
		return lista.length ? { anno: a, mese: m } : null;
	}

	function chiaveTesti(d, k) { return `${d.perimetro}-${k.anno}-${k.mese}`; }

	function testi(d, k) {
		const c = chiaveTesti(d, k);
		if (!stato.testi[c]) stato.testi[c] = R.testiStandard(d.perimetro, k.anno, k.mese);
		return stato.testi[c];
	}

	function compilaTesti(t) {
		$("#sf-cover-titolo").value = t.coverTitolo;
		$("#sf-cover-sotto").value = t.coverSotto;
		$("#sf-cover-data").value = t.coverData;
		$("#sf-note").value = t.note;
	}

	async function mostraPresentazione(d) {
		$('.sf-vista[data-vista="presentazione"]').hidden = false;
		const k = meseScelto(d);
		const box = $("#sf-slides");
		if (!k) {
			box.innerHTML = `<div class="sf-card"><div class="sf-vuota">Nessun dato da presentare per ${esc(d.perimetro)}.</div></div>`;
			$("#sf-export").disabled = true;
			return;
		}
		compilaTesti(testi(d, k));
		await aggiornaAnteprima();
	}

	let giro = 0;
	async function aggiornaAnteprima() {
		const d = stato.dati[stato.perimetro];
		if (!d || stato.vista !== "presentazione") return;
		const k = meseScelto(d);
		if (!k) return;
		const mio = ++giro;
		const box = $("#sf-slides");
		const exp = $("#sf-export");
		exp.disabled = true;
		if (!stato.img) stato.img = await R.immagini();
		const img = Object.assign({}, stato.img, stato.copertina ? { copertina: stato.copertina } : {});
		const t = testi(d, k);
		box.innerHTML = "";
		const sel = datiSelezionati(d);
		const info = $("#sf-esclusi-info");
		info.hidden = !sel.tolte.length;
		info.innerHTML = sel.tolte.length ? `<i class="bi bi-funnel"></i> Escluse dalla presentazione (${sel.tolte.length}): ${sel.tolte.map(esc).join(", ")}. Per rimetterle, spuntarle nelle <a href="#/${d.perimetro}/wh">tabelle</a>.` : "";
		const ris = await R.costruisci(sel.dati, d.perimetro, k.anno, k.mese, t, img, (i, n, slide) => {
			if (mio !== giro) return;
			const w = document.createElement("div");
			w.className = "sf-slide-wrap";
			w.innerHTML = `<div class="sf-slide-num">${i} / ${n} · ${esc(slide.titolo)}</div><div class="sf-slide"></div>`;
			box.appendChild(w);
			const s = $(".sf-slide", w);
			osserva(s);
			R.disegnaHtml(slide, s);
		});
		if (mio !== giro) return;
		stato.report = { perimetro: d.perimetro, anno: k.anno, mese: k.mese, slides: ris.slides };
		const av = $("#sf-avvisi-report");
		av.hidden = !ris.avvisi.length;
		av.innerHTML = ris.avvisi.length ? "<strong>Da controllare:</strong><ul>" + ris.avvisi.map(a => `<li>${esc(a)}</li>`).join("") + "</ul>" : "";
		exp.disabled = false;
	}

	// --ppi = pixel per pollice dell'anteprima (serve alle dimensioni dei caratteri)
	const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(voci => voci.forEach(v => v.target.style.setProperty("--ppi", (v.contentRect.width / 13.333) + "px"))) : null;
	function osserva(el) {
		if (ro) ro.observe(el);
		el.style.setProperty("--ppi", (el.clientWidth / 13.333 || 40) + "px");
	}

	let ritardo = null;
	function testoCambiato() {
		const d = stato.dati[stato.perimetro];
		const k = d && meseScelto(d);
		if (!k) return;
		const t = testi(d, k);
		t.coverTitolo = $("#sf-cover-titolo").value;
		t.coverSotto = $("#sf-cover-sotto").value;
		t.coverData = $("#sf-cover-data").value;
		t.note = $("#sf-note").value;
		clearTimeout(ritardo);
		ritardo = setTimeout(aggiornaAnteprima, 700);
	}

	async function esporta() {
		const r = stato.report;
		if (!r) return;
		const b = $("#sf-export");
		b.disabled = true;
		const testo = b.innerHTML;
		b.innerHTML = '<span class="sf-spinner"></span>Creazione file…';
		try {
			const cfg = R.PERIMETRI[r.perimetro];
			await R.esportaPpt(r.slides, `${cfg.file}_${r.anno}-${String(r.mese + 1).padStart(2, "0")}.pptx`);
		} catch (e) {
			errore("Export PowerPoint non riuscito: " + e.message);
		} finally {
			b.innerHTML = testo;
			b.disabled = false;
		}
	}

	/* ================= carica Excel ================= */

	function leggiFileExcel(file) {
		return new Promise((res, rej) => {
			if (!window.XLSX) { rej(new Error("La libreria per leggere i file Excel (JS/Safety/lib/xlsx-0.18.5.full.min.js) non si è caricata.")); return; }
			const fr = new FileReader();
			fr.onload = () => {
				try { res(window.XLSX.read(new Uint8Array(fr.result), { type: "array" })); }
				catch (e) { rej(new Error("Il file non è un Excel leggibile: " + e.message)); }
			};
			fr.onerror = () => rej(new Error("Impossibile leggere il file."));
			fr.readAsArrayBuffer(file);
		});
	}

	const uguali = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-6);

	async function analizza(file) {
		const box = $("#sf-analisi");
		box.innerHTML = `<div class="sf-loading"><span class="sf-spinner"></span>Lettura di ${esc(file.name)}…</div>`;
		stato.file = null;
		try {
			const wb = await leggiFileExcel(file);
			const fogli = wb.SheetNames.map(n => C.leggiFoglio(n, window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }), window.XLSX.SSF.parse_date_code));
			const validi = fogli.filter(f => f.perimetro && f.blocchi.length);
			const ignorati = fogli.filter(f => !f.perimetro).map(f => f.foglio);
			const info = fogli.map(f => f.info).filter(Boolean);
			const errori = [].concat.apply([], fogli.map(f => f.errori));
			const avvisi = [].concat.apply([], fogli.map(f => f.avvisi));
			if (!validi.length) errori.push('Nel file non c\'è un foglio "MFG" o "NMFG" con i blocchi attesi.');
			const doppi = validi.map(f => f.perimetro).filter((p, i, a) => a.indexOf(p) !== i);
			if (doppi.length) errori.push("Ci sono due fogli per lo stesso perimetro: " + doppi.join(", ") + ".");
			validi.forEach(f => { if (f.perimetro === "NMFG" && f.blocchi.some(b => b.parametro === "DAYS")) avvisi.push('Foglio NMFG: il blocco "days lost" verrà caricato ma la pagina non lo usa (non c\'era neanche prima).'); });

			// confronto col database
			const db = {};
			for (const f of validi) db[f.perimetro] = await caricaDati(f.perimetro, true);
			const righe = [];
			validi.forEach(f => f.blocchi.forEach(b => Object.keys(b.anni).sort().forEach(anno => {
				const nuovi = b.anni[anno];
				const vecchi = ((db[f.perimetro].valori[b.parametro] || {})[anno]) || {};
				const nomiVecchi = Object.keys(vecchi);
				let cambiate = 0, piene = 0, ultimo = -1;
				nuovi.forEach(r => {
					const v = vecchi[nomiVecchi.find(x => x.toLowerCase() === r[0].toLowerCase())] || Array(12).fill(null);
					for (let m = 0; m < 12; m++) {
						if (r[m + 1] != null) { piene++; if (m > ultimo) ultimo = m; }
						if (!uguali(r[m + 1], v[m])) cambiate++;
					}
				});
				const nuove = nuovi.filter(r => !nomiVecchi.some(x => x.toLowerCase() === r[0].toLowerCase())).map(r => r[0]);
				const tolte = nomiVecchi.filter(x => !nuovi.some(r => r[0].toLowerCase() === x.toLowerCase()));
				righe.push({ perimetro: f.perimetro, parametro: b.parametro, anno, location: nuovi.length, piene, ultimo, cambiate, nuove, tolte, vuotoDb: !nomiVecchi.length });
			})));
			stato.file = { nome: file.name, fogli: validi, errori, avvisi, righe, ignorati, info };
			disegnaAnalisi();
		} catch (e) {
			box.innerHTML = `<div class="sf-alert sf-alert-danger">${esc(e.message)}</div>`;
		}
	}

	function disegnaAnalisi(conferma) {
		const f = stato.file;
		const box = $("#sf-analisi");
		if (!f) { box.innerHTML = ""; return; }
		const mesi = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
		const nomePar = p => C.NOMI_PARAMETRO[p];
		const dettagli = [];
		f.righe.forEach(r => {
			if (r.nuove.length && !r.vuotoDb) dettagli.push(`${r.perimetro} ${nomePar(r.parametro)} ${r.anno}: location nuove (${r.nuove.length}) — ${r.nuove.join(", ")}`);
			if (r.tolte.length) dettagli.push(`${r.perimetro} ${nomePar(r.parametro)} ${r.anno}: location nel database ma non nel file, verranno tolte (${r.tolte.length}) — ${r.tolte.join(", ")}`);
		});
		const bloccato = f.errori.length > 0;
		box.innerHTML = `
			<div class="sf-card">
				<div class="sf-card-head"><i class="bi bi-file-earmark-excel"></i>${esc(f.nome)}
					<span style="margin-left:auto" class="sf-badge ${bloccato ? "sf-badge-err" : f.avvisi.length ? "sf-badge-warn" : "sf-badge-ok"}">${bloccato ? f.errori.length + " errori" : f.avvisi.length ? f.avvisi.length + " avvisi" : "pronto"}</span></div>
				<div class="sf-card-body">
					${f.ignorati.length ? `<p class="sf-testo sf-muted">Fogli ignorati: ${f.ignorati.map(esc).join(", ")}.</p>` : ""}
					${f.info.map(t => `<p class="sf-testo sf-muted"><i class="bi bi-info-circle"></i> ${esc(t)}</p>`).join("")}
					<table class="sf-riepilogo">
						<thead><tr><th>Perimetro</th><th>Parametro</th><th>Anno</th><th class="num">Location</th><th class="num">Celle con valore</th><th>Ultimo mese</th><th class="num">Celle che cambiano</th></tr></thead>
						<tbody>${f.righe.map(r => `<tr><td>${r.perimetro}</td><td>${esc(nomePar(r.parametro))}</td><td>${r.anno}</td><td class="num">${r.location}</td><td class="num">${r.piene}</td>
							<td>${r.ultimo >= 0 ? mesi[r.ultimo] + "-" + r.anno : "—"}</td><td class="num">${r.vuotoDb ? '<span class="sf-badge sf-badge-ok">nuovo</span>' : r.cambiate}</td></tr>`).join("")}</tbody>
					</table>
					${f.errori.length ? `<div class="sf-alert sf-alert-danger" style="margin-top:14px"><strong>Errori: correggere il file e ricaricarlo.</strong><ul class="sf-lista">${f.errori.map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
					${f.avvisi.length ? `<div class="sf-alert sf-alert-warning" style="margin-top:14px"><strong>Avvisi</strong> (il caricamento è possibile):<ul class="sf-lista">${f.avvisi.map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
					${dettagli.length ? `<div class="sf-alert sf-alert-warning" style="margin-top:14px"><strong>Location</strong><ul class="sf-lista">${dettagli.map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
				</div>
				<div class="sf-azioni">
					${conferma
						? `<span class="sf-muted">I dati di ${esc(Array.from(new Set(f.righe.map(r => r.perimetro + " " + r.anno))).join(", "))} nel database verranno sostituiti. Confermi?</span>
						   <button type="button" class="sf-btn sf-btn-outline" data-azione="annulla">Annulla</button>
						   <button type="button" class="sf-btn sf-btn-ok" data-azione="conferma"><i class="bi bi-check-lg"></i>Sì, carica</button>`
						: `<button type="button" class="sf-btn sf-btn-outline" data-azione="annulla">Scarta</button>
						   <button type="button" class="sf-btn sf-btn-primary" data-azione="carica" ${bloccato ? "disabled" : ""}><i class="bi bi-cloud-arrow-up"></i>Carica nel database</button>`}
				</div>
			</div>`;
	}

	async function invia() {
		const f = stato.file;
		if (!f || f.errori.length) return;
		const body = {
			file: f.nome,
			perimetri: f.fogli.map(fg => ({
				perimetro: fg.perimetro,
				dati: [].concat.apply([], fg.blocchi.map(b => Object.keys(b.anni).map(anno => ({ parametro: b.parametro, anno: Number(anno), righe: b.anni[anno] }))))
			}))
		};
		const az = $("#sf-analisi .sf-azioni");
		az.innerHTML = '<span class="sf-spinner"></span><span class="sf-muted">Caricamento in corso…</span>';
		try {
			const r = await api("carica", { body });
			const perimetri = f.fogli.map(x => x.perimetro);
			for (const p of perimetri) await caricaDati(p, true);
			stato.testi = {};
			stato.report = null;
			stato.file = null;
			$("#sf-file").value = "";
			$("#sf-drop-testo").innerHTML = "Trascina qui il file Excel oppure <u>sceglilo dal computer</u>";
			$("#sf-analisi").innerHTML = `<div class="sf-alert" style="background:var(--ok-bg);color:var(--ok-text)"><i class="bi bi-check-circle"></i> Caricati ${r.righe} valori (${r.blocchi} blocchi, ${r.location} location) per ${esc(perimetri.join(" e "))}.
				Vai alle <a href="#/${perimetri[0]}/wh">tabelle</a> o alla <a href="#/${perimetri[0]}/presentazione">presentazione</a>.</div>`;
			infoUltimo(stato.dati[stato.perimetro]);
			toast("Dati caricati nel database.");
		} catch (e) {
			disegnaAnalisi();
			$("#sf-analisi .sf-card-body").insertAdjacentHTML("afterbegin", `<div class="sf-alert sf-alert-danger">Caricamento non riuscito, il database non è cambiato: ${esc(e.message)}</div>`);
		}
	}

	/* ================= tema ================= */

	function temaChiaro() { return document.documentElement.getAttribute("data-tema") === "chiaro"; }
	function scriviTema() {
		$("#sf-tema").innerHTML = temaChiaro() ? '<i class="bi bi-moon-stars"></i>Tema scuro' : '<i class="bi bi-sun"></i>Tema chiaro';
	}
	function cambiaTema() {
		const chiaro = !temaChiaro();
		if (chiaro) document.documentElement.setAttribute("data-tema", "chiaro");
		else document.documentElement.removeAttribute("data-tema");
		scriviMemoria("sf_tema", chiaro ? "chiaro" : "scuro");
		scriviTema();
	}

	/* ================= piè di pagina ================= */

	function versioneFooter() {
		const ph = $("#footer-placeholder");
		if (!ph) return;
		const prova = () => {
			const c = ph.querySelector(".footer-container");
			if (!c) return false;
			if (!c.querySelector(".footer-right")) c.insertAdjacentHTML("beforeend", `<div class="footer-right"><span>Safety ${VERSIONE}</span></div>`);
			return true;
		};
		if (prova()) return;
		const mo = new MutationObserver(() => { if (prova()) mo.disconnect(); });
		mo.observe(ph, { childList: true, subtree: true });
	}

	/* ================= avvio ================= */

	function avvia() {
		scriviTema();
		versioneFooter();
		$("#sf-tema").addEventListener("click", cambiaTema);
		$$(".sf-perimetro button").forEach(b => b.addEventListener("click", () => {
			const p = b.dataset.perimetro;
			vai(p, stato.vista === "days" && p !== "MFG" ? "wh" : stato.vista);
		}));
		$("#sf-tabelle").addEventListener("change", cambiaSpunta);
		$("#sf-aree").addEventListener("click", e => {
			const b = e.target.closest("button[data-area]");
			if (!b) return;
			stato.area[stato.perimetro] = b.dataset.area;
			mostraTabelle(stato.dati[stato.perimetro]);
		});

		// presentazione
		$("#sf-mese").addEventListener("change", () => { compilaTesti(testi(stato.dati[stato.perimetro], meseScelto(stato.dati[stato.perimetro]))); aggiornaAnteprima(); });
		["#sf-cover-titolo", "#sf-cover-sotto", "#sf-cover-data", "#sf-note"].forEach(s => $(s).addEventListener("input", testoCambiato));
		$("#sf-export").addEventListener("click", esporta);
		$("#sf-cover-file").addEventListener("change", async e => {
			const f = e.target.files[0];
			if (!f) return;
			stato.copertina = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
			aggiornaAnteprima();
		});
		$("#sf-cover-reset").addEventListener("click", () => { stato.copertina = null; $("#sf-cover-file").value = ""; aggiornaAnteprima(); });
		$("#sf-testi-reset").addEventListener("click", () => {
			const d = stato.dati[stato.perimetro], k = meseScelto(d);
			if (!k) return;
			stato.testi[chiaveTesti(d, k)] = R.testiStandard(d.perimetro, k.anno, k.mese);
			compilaTesti(stato.testi[chiaveTesti(d, k)]);
			aggiornaAnteprima();
		});

		// carica Excel
		const drop = $("#sf-drop");
		$("#sf-file").addEventListener("change", e => { const f = e.target.files[0]; if (f) { $("#sf-drop-testo").textContent = f.name; analizza(f); } });
		["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("is-over"); }));
		["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("is-over"); }));
		drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) { $("#sf-drop-testo").textContent = f.name; analizza(f); } });
		$("#sf-analisi").addEventListener("click", e => {
			const b = e.target.closest("button[data-azione]");
			if (!b) return;
			if (b.dataset.azione === "carica") disegnaAnalisi(true);
			else if (b.dataset.azione === "conferma") invia();
			else if (b.dataset.azione === "annulla") {
				if (b.closest(".sf-azioni").querySelector('[data-azione="conferma"]')) disegnaAnalisi();
				else { stato.file = null; $("#sf-file").value = ""; $("#sf-drop-testo").innerHTML = "Trascina qui il file Excel oppure <u>sceglilo dal computer</u>"; disegnaAnalisi(); }
			}
		});

		window.addEventListener("hashchange", mostra);
		if (!location.hash) history.replaceState(null, "", "#/" + stato.perimetro + "/" + stato.vista);
		mostra();
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
	else avvia();
})();
