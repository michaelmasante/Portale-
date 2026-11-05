/* ============ Certificati: Carica Excel ============
 Scheda "Carica Excel" della pagina Certificati (solo ruolo "Certificati Upload" o Admin), come in Safety:
 il file viene letto nel browser (SheetJS), controllato, confrontato col database e poi inviato
 ad API/Certificati.ashx (action=carica), che scrive tutto in un'unica transazione.

 Il tipo di file si riconosce dalle intestazioni:
   - Shop Order (colonna "P/N Motore"): si AGGIUNGONO i P/N nuovi e si AGGIORNANO quelli cambiati.
     Non si cancella niente: i P/N che nel file non ci sono restano come sono.
   - TAG (colonne "Element" e "TagElementDescription"): il file e' l'elenco completo e SOSTITUISCE tutti i TAG.

 Le colonne si cercano per NOME, non per lettera: i due file Shop Order (Estrazione N1 e N2) hanno le stesse
 colonne in posizioni diverse. La riga di intestazione e' quella, fra le prime 30, con piu' nomi riconosciuti
 (nei file Shop Order e' la terza: sopra ci sono titolo e gruppi). Le altre colonne del file si ignorano.
 Le colonne e le lunghezze massime sono le stesse di API/Certificati.ashx: se si cambiano, cambiarle in tutti e due.*/
(function () {
	const API = "API/Certificati.ashx";

	const TIPI = {
		shoporder: {
			nome: "Shop Order",
			chiave: "P/N Motore",
			colonne: { "P/N Motore": 255, "Engine code": 255, "REF. EU FAMILY": 255, "REF. US FAMILY": 255, "Application": 255,
				"Customer Eng.": 255, "Customer": 255, "Tipo Motore": 255, "Omologazione": 255, "ENTE": 255, "PRP": 255,
				"FGF GROUP": 255, "Status": 50 },
			obbligatorie: ["P/N Motore"]
		},
		tag: {
			nome: "TAG",
			chiave: "Element",
			// 0 = data
			colonne: { "Element": 255, "PartNbrEngineering": 255, "VersioneManufacturing": 255, "VStart": 0, "VEnd": 0,
				"TagElementDescription": 255, "TagElementValue": 255 },
			obbligatorie: ["Element", "VStart", "VEnd", "TagElementDescription"]
		},
		// Tracker EPA: riconosciuto dalla colonna "EPA FAMILY"; il file ha due righe di intestazione e si legge con leggiEpa
		epa: {
			nome: "Tracker EPA",
			chiave: "Famiglia",
			colonne: { "Famiglia": 50, "Ordine": 20, "EpaSottomissione": 100, "EpaSottomissioneSett": 50, "CarbSottomissione": 100,
				"CarbSottomissioneSett": 50, "EpaApprovazione": 100, "EpaApprovazioneSett": 50, "CarbApprovazione": 100,
				"CarbApprovazioneSett": 50, "Rischio": 50, "Note": 4000, "Dati": 1000000 },
			obbligatorie: ["Famiglia", "EpaSottomissione", "EpaApprovazione"]
		}
	};

	/* Tracker EPA: per ogni campo i nomi di colonna accettati (in minuscolo, senza spazi né simboli:
	 "EPA \nSUB DATE\n[ WK ]" diventa "epasubdatewk"). Le colonne che non sono qui (piani PO09R, PO10R...,
	 PREVIOUS PLANNING) finiscono nel campo Dati, in JSON.*/
	const NOMI_EPA = {
		Famiglia: ["epafamily"],
		Ordine: ["id"],
		EpaSottomissione: ["epasubmissionstatus"],
		EpaSottomissioneSett: ["epasubdatewk", "epasubmissiondatewk", "epasubdate"],
		CarbSottomissione: ["carbsubmissionstatus", "carbonsubmissionstatus"],
		CarbSottomissioneSett: ["carbonsubdatewk", "carbsubdatewk", "carbsubdate", "carbonsubdate"],
		EpaApprovazione: ["epaapprovalstatus"],
		EpaApprovazioneSett: ["epaapprovalwk", "epaapprovaldatewk"],
		CarbApprovazione: ["carbonapprovalstatus", "carbapprovalstatus"],
		CarbApprovazioneSett: ["carbapprovalwk", "carbonapprovalwk", "carbapprovaldatewk"],
		Rischio: ["risk", "rischio"],
		Note: ["note", "notes"]
	};
	const CAMPI_EPA = Object.keys(TIPI.epa.colonne);
	const ETICHETTE_EPA = { EpaSottomissione: "EPA sottomissione", EpaSottomissioneSett: "EPA settimana sottomissione", CarbSottomissione: "CARB sottomissione",
		CarbSottomissioneSett: "CARB settimana sottomissione", EpaApprovazione: "EPA approvazione", EpaApprovazioneSett: "EPA settimana approvazione",
		CarbApprovazione: "CARB approvazione", CarbApprovazioneSett: "CARB settimana approvazione", Rischio: "Rischio", Note: "Note", Ordine: "ID" };

	const stato = { file: null, storico: null };
	const $ = sel => document.querySelector(sel);
	const norm = v => String(v ?? "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
	const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	const num = n => Number(n || 0).toLocaleString("it-IT");

	async function api(azione, opzioni) {
		const o = opzioni || {};
		const init = { credentials: "same-origin", cache: "no-store", headers: { "X-Portale": "1" } };
		if (o.body) { init.method = "POST"; init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(o.body); }
		let json;
		try {
			const res = await fetch(API + "?action=" + encodeURIComponent(azione), init);
			json = await res.json();
		} catch (e) {
			throw new Error("Il server non risponde (" + API + "). Controllare che il Portale sia pubblicato su IIS.");
		}
		if (!json || json.ok === false) throw new Error((json && (json.message + (json.detail ? " — " + json.detail : ""))) || "Errore del server.");
		return json;
	}

	function toast(msg) {
		const t = $("#cx-toast");
		if (!t) return;
		t.textContent = msg;
		t.hidden = false;
		clearTimeout(toast.timer);
		toast.timer = setTimeout(() => { t.hidden = true; }, 4500);
	}

	function formatoData(s) {
		const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
		return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : String(s || "");
	}

	/* ================= lettura del file ================= */

	function leggiFileExcel(file) {
		return new Promise((res, rej) => {
			if (!window.XLSX) { rej(new Error("La libreria per leggere i file Excel (SheetJS) non si è caricata.")); return; }
			const fr = new FileReader();
			fr.onload = () => {
				try { res(window.XLSX.read(new Uint8Array(fr.result), { type: "array", dense: true })); }
				catch (e) { rej(new Error("Il file non è un Excel leggibile: " + e.message)); }
			};
			fr.onerror = () => rej(new Error("Impossibile leggere il file."));
			fr.readAsArrayBuffer(file);
		});
	}

	// Cerca, foglio per foglio, la riga di intestazione e il tipo di file
	function trovaIntestazione(wb) {
		let best = null;
		for (const nomeFoglio of wb.SheetNames) {
			const righe = window.XLSX.utils.sheet_to_json(wb.Sheets[nomeFoglio], { header: 1, raw: true, defval: null, blankrows: true });
			const limite = Math.min(righe.length, 30);
			for (let i = 0; i < limite; i++) {
				const nomi = (righe[i] || []).map(norm);
				if (nomi.includes("epa family")) return { tipo: "epa", foglio: nomeFoglio, righe, riga: i, trovate: [] };
				for (const tipo of Object.keys(TIPI)) {
					if (tipo === "epa") continue;
					const t = TIPI[tipo];
					const trovate = Object.keys(t.colonne).filter(c => nomi.includes(norm(c)));
					if (!trovate.includes(t.chiave)) continue;
					if (tipo === "tag" && !trovate.includes("TagElementDescription")) continue;
					if (!best || trovate.length > best.trovate.length) best = { tipo, foglio: nomeFoglio, righe, riga: i, trovate };
				}
			}
			if (best) break; // primo foglio con un'intestazione riconosciuta
		}
		return best;
	}

	// Data in aaaa-mm-gg: accetta data Excel (numero), testo aaaa-mm-gg o gg/mm/aaaa
	function normalizzaData(v) {
		if (typeof v === "number" && window.XLSX && window.XLSX.SSF) {
			const d = window.XLSX.SSF.parse_date_code(v);
			if (d && d.y) return `${String(d.y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
			return undefined;
		}
		if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
		const s = String(v).trim();
		let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
		if (!m) { const x = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if (x) m = [x[0], x[3], x[2], x[1]]; }
		if (!m) return undefined;
		const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
		const dt = new Date(y, mo - 1, d);
		if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return undefined;
		return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
	}

	function normalizzaTesto(v) {
		if (v === null || v === undefined) return null;
		let s = typeof v === "number" ? String(v) : (v instanceof Date ? normalizzaData(v) : String(v));
		s = String(s).replace(/\u00A0/g, " ").trim();
		if (!s || s.toUpperCase() === "NULL") return null;
		return s;
	}

	async function datiDatabase(tipo, forza) {
		const cache = window.CertificatiDati || {};
		if (!forza && cache[tipo] && cache[tipo].righe) return cache[tipo];
		const d = await api(tipo);
		window.CertificatiDati = Object.assign({}, window.CertificatiDati || {}, { [tipo]: d });
		return d;
	}

	async function analizza(file) {
		const box = $("#cx-analisi");
		box.innerHTML = `<div class="cx-loading"><span class="cx-spinner"></span>Lettura di ${esc(file.name)}…</div>`;
		stato.file = null;
		try {
			await new Promise(r => setTimeout(r, 30)); // lascia disegnare il messaggio prima del lavoro pesante
			const wb = await leggiFileExcel(file);
			const h = trovaIntestazione(wb);
			if (!h) throw new Error('Non riconosco il file: non trovo la colonna "P/N Motore" (Shop Order), le colonne "Element" e "TagElementDescription" (TAG) o la colonna "EPA FAMILY" (Tracker EPA).');

			if (h.tipo === "epa") {
				const x = leggiEpa(h, wb.Sheets[h.foglio]);
				const confronto = await confrontaEpa(x.righe);
				stato.file = { nome: file.name, tipo: "epa", foglio: h.foglio, rigaIntestazione: h.riga + 1, colonne: CAMPI_EPA, letti: x.letti,
					righe: x.righe, numeri: x.numeri, errori: x.errori, avvisi: x.avvisi, confronto };
				disegnaAnalisi();
				return;
			}

			const t = TIPI[h.tipo];
			const errori = [], avvisi = [];
			const intest = h.righe[h.riga].map(norm);
			// colonne del file, nell'ordine del tipo (chiave per prima); se un nome c'è due volte vale la prima
			const colonne = Object.keys(t.colonne).filter(c => h.trovate.includes(c));
			const indici = colonne.map(c => intest.indexOf(norm(c)));
			const mancanti = Object.keys(t.colonne).filter(c => !colonne.includes(c));
			const obbligMancanti = t.obbligatorie.filter(c => !colonne.includes(c));
			if (obbligMancanti.length) errori.push("Mancano le colonne: " + obbligMancanti.join(", ") + ".");
			if (mancanti.length && !obbligMancanti.length) {
				avvisi.push(h.tipo === "shoporder"
					? "Colonne non trovate nel file: " + mancanti.join(", ") + ". Nel database restano i valori che ci sono adesso."
					: "Colonne non trovate nel file: " + mancanti.join(", ") + ". Nel database resteranno vuote.");
			}

			// righe
			const righe = [], numeri = [];
			const visti = new Map(), doppi = [];
			let senzaChiave = 0, vuote = 0;
			for (let i = h.riga + 1; i < h.righe.length; i++) {
				const r = h.righe[i] || [];
				const valori = indici.map((ix, j) => {
					const v = r[ix];
					return t.colonne[colonne[j]] === 0 ? (v === null || v === undefined || String(v).trim() === "" ? null : (normalizzaData(v) ?? { errore: String(v) })) : normalizzaTesto(v);
				});
				if (valori.every(v => v === null)) { vuote++; continue; }
				if (valori[0] === null) { senzaChiave++; continue; }
				const nRiga = i + 1;
				valori.forEach((v, j) => {
					const max = t.colonne[colonne[j]];
					if (v && typeof v === "object") errori.push(`Riga ${nRiga}, ${colonne[j]}: data non valida (${v.errore}).`);
					else if (max && v && v.length > max) errori.push(`Riga ${nRiga}, ${colonne[j]}: testo troppo lungo (${v.length} caratteri, massimo ${max}).`);
				});
				// chiave ripetuta (come nel database: senza distinguere maiuscole/minuscole)
				const k = h.tipo === "shoporder" ? valori[0].toLowerCase()
					: ["Element", "PartNbrEngineering", "VersioneManufacturing", "VStart", "TagElementDescription"].map(c => { const j = colonne.indexOf(c); return j < 0 || valori[j] === null ? "" : String(valori[j]).toLowerCase(); }).join("\u0001");
				if (visti.has(k)) doppi.push(`righe ${visti.get(k)} e ${nRiga}` + (h.tipo === "shoporder" ? ` (P/N ${valori[0]})` : ` (${valori[0]})`));
				else visti.set(k, nRiga);
				righe.push(valori);
				numeri.push(nRiga);
			}
			if (doppi.length) errori.push((h.tipo === "shoporder" ? "P/N Motore ripetuti" : "TAG ripetuti (stesso Element, PartNbrEngineering, VersioneManufacturing, VStart e TAG)") + ` (${doppi.length}): ` + doppi.slice(0, 10).join("; ") + (doppi.length > 10 ? "; …" : "") + ".");
			if (senzaChiave) avvisi.push(`${num(senzaChiave)} righe senza ${t.chiave}: vengono ignorate.`);
			if (!righe.length) errori.push("Nel file non ci sono righe con dati sotto l'intestazione.");
			if (errori.length > 30) errori.splice(30, errori.length - 30, `… e altri errori (${num(errori.length - 30)}).`);

			// confronto col database
			const confronto = await confronta(h.tipo, colonne, righe);

			stato.file = { nome: file.name, tipo: h.tipo, foglio: h.foglio, rigaIntestazione: h.riga + 1, colonne, righe, numeri, errori, avvisi, confronto };
			disegnaAnalisi();
		} catch (e) {
			box.innerHTML = `<div class="cx-alert cx-alert-danger">${esc(e.message)}</div>`;
		}
	}

	async function confronta(tipo, colonne, righe) {
		let db;
		try { db = await datiDatabase(tipo); }
		catch (e) { return { errore: "Confronto col database non riuscito: " + e.message }; }
		const iDb = {};
		db.colonne.forEach((c, j) => { iDb[c] = j; });
		const uguale = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

		if (tipo === "shoporder") {
			const perPn = new Map(db.righe.map(r => [String(r[0]).toLowerCase(), r]));
			let nuove = 0, cambiano = 0, uguali = 0;
			const perColonna = {};
			const inFile = new Set();
			righe.forEach(v => {
				const k = v[0].toLowerCase();
				inFile.add(k);
				const r = perPn.get(k);
				if (!r) { nuove++; return; }
				let diverse = false;
				colonne.forEach((c, j) => {
					if (j === 0 || iDb[c] === undefined) return;
					if (!uguale(v[j], r[iDb[c]])) { diverse = true; perColonna[c] = (perColonna[c] || 0) + 1; }
				});
				if (diverse) cambiano++; else uguali++;
			});
			let soloDb = 0;
			perPn.forEach((r, k) => { if (!inFile.has(k)) soloDb++; });
			return { nuove, cambiano, uguali, soloDb, perColonna, totaleDb: db.righe.length };
		}

		// TAG: confronto sulle colonne che la pagina legge (Element, VStart, VEnd, TagElementDescription)
		const usate = db.colonne.filter(c => colonne.includes(c));
		const chiave = (get) => usate.map(c => String(get(c) ?? "").toLowerCase()).join("\u0001");
		const chiaviDb = db.righe.map(r => chiave(c => r[iDb[c]]));
		const chiaviFile = righe.map(v => chiave(c => v[colonne.indexOf(c)]));
		const nelDb = new Set(chiaviDb), nelFile = new Set(chiaviFile);
		// si contano le righe (due righe possono avere le stesse 4 colonne e differire per PartNbrEngineering o VersioneManufacturing)
		const nuove = chiaviFile.filter(k => !nelDb.has(k)).length;
		const tolte = chiaviDb.filter(k => !nelFile.has(k)).length;
		return { nuove, tolte, uguali: righe.length - nuove, totaleDb: db.righe.length, foglioDb: db.foglio || "" };
	}

	/* ================= Tracker EPA ================= */

	const chiaveNome = v => norm(v).replace(/[^a-z0-9]/g, "");
	// testo su una riga (stati, settimane): spazi e a capo diventano uno spazio
	function pulisci(v) {
		if (v === null || v === undefined) return null;
		const s = String(v).replace(/\s+/g, " ").trim();
		return s && s.toUpperCase() !== "NULL" ? s : null;
	}
	// testo lungo (note): si tengono gli a capo
	function pulisciNota(v) {
		if (v === null || v === undefined) return null;
		const s = String(v).split(/\r?\n/).map(r => r.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{2,}/g, "\n").trim();
		return s || null;
	}

	function leggiEpa(h, ws) {
		const errori = [], avvisi = [];
		const intest = h.righe[h.riga] || [];
		const sopra = (h.righe[h.riga - 1] || []).slice();
		// celle unite nella riga sopra l'intestazione (es. "PO10R" su più colonne): il valore vale per tutte
		(ws && ws["!merges"] || []).forEach(m => {
			if (m.s.r <= h.riga - 1 && m.e.r >= h.riga - 1) for (let c = m.s.c + 1; c <= m.e.c; c++) sopra[c] = sopra[m.s.c];
		});

		const pos = {}, letti = [];
		intest.forEach((v, j) => {
			const k = chiaveNome(v);
			for (const campo of Object.keys(NOMI_EPA)) {
				if (pos[campo] === undefined && NOMI_EPA[campo].includes(k)) { pos[campo] = j; letti.push(pulisci(v)); break; }
			}
		});
		const obblig = TIPI.epa.obbligatorie.filter(c => pos[c] === undefined);
		if (obblig.length) errori.push("Mancano le colonne: " + obblig.map(c => c === "Famiglia" ? "EPA FAMILY" : ETICHETTE_EPA[c]).join(", ") + ".");
		const altre = Object.keys(NOMI_EPA).filter(c => pos[c] === undefined && !TIPI.epa.obbligatorie.includes(c));
		if (altre.length && !obblig.length) avvisi.push("Colonne non trovate nel file: " + altre.map(c => ETICHETTE_EPA[c]).join(", ") + ". Resteranno vuote.");

		// le altre colonne: piani (PO09R, PO10R... con le loro misure) e "previous planning"
		const usate = new Set(Object.values(pos));
		const extra = [];
		const isPiano = t => /^PO\d+R?$/i.test(t || "");
		for (let j = 0; j < intest.length; j++) {
			if (usate.has(j)) continue;
			const a = pulisci(intest[j]), b = pulisci(sopra[j]);
			if (!a && !b) continue;
			if (/^previous planning/i.test(a || "")) { extra.push({ j, storico: a }); continue; }
			let piano = "Altro", misura = a || b;
			if (isPiano(a)) { piano = a.toUpperCase(); misura = b || a; }
			else if (isPiano(b)) { piano = b.toUpperCase(); misura = a || b; }
			extra.push({ j, piano, misura });
		}
		const piani = [];
		extra.forEach(x => { if (x.piano && !piani.includes(x.piano)) piani.push(x.piano); });
		if (piani.length) letti.push("piani " + piani.join(", "));
		if (extra.some(x => x.storico)) letti.push("previous planning");

		const righe = [], numeri = [], viste = new Map(), doppie = [];
		for (let i = h.riga + 1; i < h.righe.length; i++) {
			const r = h.righe[i] || [];
			const fam = pos.Famiglia === undefined ? null : pulisci(r[pos.Famiglia]);
			if (!fam) continue;
			const nRiga = i + 1;
			const dati = { piani: [], storico: [] };
			extra.forEach(x => {
				const v = r[x.j];
				if (v === null || v === undefined || String(v).trim() === "") return;
				if (x.storico) { dati.storico.push({ titolo: x.storico, testo: pulisciNota(v) }); return; }
				let p = dati.piani.find(q => q.nome === x.piano);
				if (!p) { p = { nome: x.piano, valori: [] }; dati.piani.push(p); }
				p.valori.push({ nome: x.misura, valore: typeof v === "number" ? v : pulisci(v) });
			});
			const valori = CAMPI_EPA.map(c => {
				if (c === "Dati") return JSON.stringify(dati);
				if (pos[c] === undefined) return null;
				return c === "Note" ? pulisciNota(r[pos[c]]) : pulisci(r[pos[c]]);
			});
			valori.forEach((v, j) => {
				const max = TIPI.epa.colonne[CAMPI_EPA[j]];
				if (v && v.length > max) errori.push(`Riga ${nRiga}, ${CAMPI_EPA[j] === "Dati" ? "dati della riga" : ETICHETTE_EPA[CAMPI_EPA[j]] || CAMPI_EPA[j]}: testo troppo lungo (${v.length} caratteri, massimo ${max}).`);
			});
			const k = fam.toLowerCase();
			if (viste.has(k)) doppie.push(`${fam} (righe ${viste.get(k)} e ${nRiga})`); else viste.set(k, nRiga);
			righe.push(valori);
			numeri.push(nRiga);
		}
		if (doppie.length) errori.push("Famiglie ripetute: " + doppie.join("; ") + ".");
		if (!righe.length && !obblig.length) errori.push("Nel file non ci sono famiglie sotto l'intestazione.");
		return { righe, numeri, errori, avvisi, letti };
	}

	async function confrontaEpa(righe) {
		let db;
		try { db = await datiDatabase("epa"); }
		catch (e) { return { errore: "Confronto col database non riuscito: " + e.message }; }
		const iFam = db.colonne.indexOf("Famiglia");
		const perFam = new Map(db.righe.map(r => [String(r[iFam]).toLowerCase(), r]));
		const confrontati = ["EpaSottomissione", "EpaSottomissioneSett", "CarbSottomissione", "CarbSottomissioneSett", "EpaApprovazione",
			"EpaApprovazioneSett", "CarbApprovazione", "CarbApprovazioneSett", "Rischio"];
		let nuove = 0, cambiano = 0;
		const cambi = [], inFile = new Set();
		righe.forEach(v => {
			const k = String(v[0]).toLowerCase();
			inFile.add(k);
			const r = perFam.get(k);
			if (!r) { nuove++; return; }
			let diverso = false;
			confrontati.forEach(c => {
				const a = v[CAMPI_EPA.indexOf(c)], b = r[db.colonne.indexOf(c)];
				if (String(a ?? "").toLowerCase() !== String(b ?? "").toLowerCase()) {
					diverso = true;
					if (cambi.length < 40) cambi.push(`${v[0]} — ${ETICHETTE_EPA[c]}: ${b || "vuoto"} → ${a || "vuoto"}`);
				}
			});
			if (diverso) cambiano++;
		});
		const tolte = [...perFam.keys()].filter(k => !inFile.has(k)).map(k => perFam.get(k)[iFam]);
		return { nuove, tolte: tolte.length, nomiTolte: tolte, cambiano, cambi, totaleDb: db.righe.length, foglioDb: db.ultimo ? db.ultimo.foglio : "" };
	}

	/* ================= analisi e conferma ================= */

	function disegnaAnalisi(conferma) {
		const f = stato.file;
		const box = $("#cx-analisi");
		if (!f) { box.innerHTML = ""; return; }
		const c = f.confronto || {};
		const bloccato = f.errori.length > 0;
		const shop = f.tipo === "shoporder";
		const epa = f.tipo === "epa";

		const riepilogo = c.errore
			? `<div class="cx-alert cx-alert-warning">${esc(c.errore)}</div>`
			: epa
				? `<table class="cx-riepilogo">
						<thead><tr><th>Tipo</th><th>Foglio</th><th class="num">Famiglie nel file</th><th class="num">Nel database</th><th class="num">Nuove</th><th class="num">Tolte</th><th class="num">Cambiano</th></tr></thead>
						<tbody><tr><td>Tracker EPA</td><td>${esc(f.foglio)}</td><td class="num">${num(f.righe.length)}</td><td class="num">${num(c.totaleDb)}</td><td class="num">${num(c.nuove)}</td><td class="num">${num(c.tolte)}</td><td class="num">${num(c.cambiano)}</td></tr></tbody>
					</table>
					${c.foglioDb ? `<p class="cx-testo cx-muted">Nel database adesso: "${esc(c.foglioDb)}".</p>` : ""}
					${c.cambi && c.cambi.length ? `<div class="cx-alert cx-alert-warning"><strong>Cosa cambia</strong>${c.cambiano > c.cambi.length ? " (primi " + c.cambi.length + ")" : ""}:<ul class="cx-lista">${c.cambi.map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
					${c.nomiTolte && c.nomiTolte.length ? `<p class="cx-testo cx-muted">Famiglie che non ci saranno più: ${c.nomiTolte.map(esc).join(", ")}.</p>` : ""}`
			: shop
				? `<table class="cx-riepilogo">
						<thead><tr><th>Tipo</th><th>Foglio</th><th class="num">P/N nel file</th><th class="num">Nuovi</th><th class="num">Cambiano</th><th class="num">Uguali</th><th class="num">Solo nel database</th></tr></thead>
						<tbody><tr><td>Shop Order</td><td>${esc(f.foglio)}</td><td class="num">${num(f.righe.length)}</td><td class="num">${num(c.nuove)}</td><td class="num">${num(c.cambiano)}</td><td class="num">${num(c.uguali)}</td><td class="num">${num(c.soloDb)}</td></tr></tbody>
					</table>
					${Object.keys(c.perColonna || {}).length ? `<p class="cx-testo cx-muted">Valori che cambiano, per colonna: ${Object.keys(c.perColonna).map(k => `${esc(k)} ${num(c.perColonna[k])}`).join(" · ")}.</p>` : ""}
					<p class="cx-testo cx-muted">"Solo nel database": P/N che nel file non ci sono. Restano come sono (non si cancella niente).</p>`
				: `<table class="cx-riepilogo">
						<thead><tr><th>Tipo</th><th>Foglio</th><th class="num">Righe nel file</th><th class="num">Righe nel database</th><th class="num">Nuove</th><th class="num">Tolte</th><th class="num">Uguali</th></tr></thead>
						<tbody><tr><td>TAG</td><td>${esc(f.foglio)}</td><td class="num">${num(f.righe.length)}</td><td class="num">${num(c.totaleDb)}</td><td class="num">${num(c.nuove)}</td><td class="num">${num(c.tolte)}</td><td class="num">${num(c.uguali)}</td></tr></tbody>
					</table>
					<p class="cx-testo cx-muted">Confronto su Element, VStart, VEnd e TAG.${c.foglioDb ? ` Nel database adesso: file TAG "${esc(c.foglioDb)}".` : ""}</p>`;

		box.innerHTML = `
			<div class="cx-card">
				<div class="cx-card-head">${esc(f.nome)}
					<span class="cx-badge cx-badge-tipo">${esc(TIPI[f.tipo].nome)}</span>
					<span style="margin-left:auto" class="cx-badge ${bloccato ? "cx-badge-err" : f.avvisi.length ? "cx-badge-warn" : "cx-badge-ok"}">${bloccato ? f.errori.length + " errori" : f.avvisi.length ? f.avvisi.length + " avvisi" : "pronto"}</span></div>
				<div class="cx-card-body">
					<p class="cx-testo cx-muted">Intestazione alla riga ${f.rigaIntestazione} del foglio "${esc(f.foglio)}". Colonne lette: ${(f.letti || f.colonne).map(esc).join(", ")}.</p>
					${riepilogo}
					${f.errori.length ? `<div class="cx-alert cx-alert-danger"><strong>Errori: correggere il file e ricaricarlo.</strong><ul class="cx-lista">${f.errori.map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
					${f.avvisi.length ? `<div class="cx-alert cx-alert-warning"><strong>Avvisi</strong> (il caricamento è possibile):<ul class="cx-lista">${f.avvisi.map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
				</div>
				<div class="cx-azioni">
					${conferma
						? `<span class="cx-muted">${shop
							? `Verranno aggiunti ${num(c.nuove)} P/N e aggiornati ${num(c.cambiano)}. Nessun P/N viene cancellato. Confermi?`
							: epa ? `Il Tracker EPA nel database verrà sostituito da quello del file (${num(f.righe.length)} famiglie). Confermi?`
							: `Tutti i TAG nel database verranno sostituiti da quelli del file (${num(f.righe.length)} righe). Confermi?`}</span>
						   <button type="button" class="cx-btn cx-btn-outline" data-azione="annulla">Annulla</button>
						   <button type="button" class="cx-btn cx-btn-ok" data-azione="conferma">Sì, carica</button>`
						: `<button type="button" class="cx-btn cx-btn-outline" data-azione="annulla">Scarta</button>
						   <button type="button" class="cx-btn cx-btn-primary" data-azione="carica" ${bloccato ? "disabled" : ""}>Carica nel database</button>`}
				</div>
			</div>`;
	}

	async function invia() {
		const f = stato.file;
		if (!f || f.errori.length) return;
		const az = $("#cx-analisi .cx-azioni");
		az.innerHTML = '<span class="cx-spinner"></span><span class="cx-muted">Caricamento in corso…</span>';
		try {
			const r = await api("carica", { body: { tipo: f.tipo, file: f.nome, foglio: f.foglio, colonne: f.colonne, righe: f.righe, numeri: f.numeri } });
			// i dati della pagina ora sono vecchi: il prossimo confronto li rilegge dal database
			if (window.CertificatiDati) delete window.CertificatiDati[f.tipo];
			stato.file = null;
			$("#cx-file").value = "";
			$("#cx-drop-testo").innerHTML = "Trascina qui il file Excel oppure <u>sceglilo dal computer</u>";
			const testo = f.tipo === "shoporder"
				? `Shop Order caricati: ${num(r.nuove)} P/N nuovi, ${num(r.aggiornate)} aggiornati, ${num(r.invariate)} uguali.`
				: f.tipo === "epa" ? `Tracker EPA caricato: ${num(r.righe)} famiglie (${num(r.nuove)} nuove, ${num(r.tolte)} tolte).`
				: `TAG caricati: ${num(r.righe)} righe (${num(r.nuove)} nuove, ${num(r.tolte)} tolte).`;
			$("#cx-analisi").innerHTML = `<div class="cx-alert cx-alert-ok">${esc(testo)}
				<button type="button" class="cx-btn cx-btn-primary cx-btn-sm" data-azione="ricarica">Aggiorna la pagina</button>
				<span class="cx-muted">per vedere i nuovi dati nelle schede.</span></div>`;
			toast("Dati caricati nel database.");
			caricaStorico();
		} catch (e) {
			disegnaAnalisi();
			$("#cx-analisi .cx-card-body").insertAdjacentHTML("afterbegin", `<div class="cx-alert cx-alert-danger">Caricamento non riuscito, il database non è cambiato: ${esc(e.message)}</div>`);
		}
	}

	/* ================= storico ================= */

	async function caricaStorico() {
		const box = $("#cx-storico");
		if (!box) return;
		box.innerHTML = `<div class="cx-card-head">Ultimi caricamenti</div><div class="cx-card-body"><div class="cx-loading"><span class="cx-spinner"></span>Lettura…</div></div>`;
		try {
			const d = await api("caricamenti");
			const tabella = (lista, shop) => lista.length
				? `<table class="cx-riepilogo">
					<thead><tr><th>Data</th><th>Utente</th><th>File</th><th>Foglio</th><th class="num">Righe</th><th class="num">Nuove</th><th class="num">${shop ? "Aggiornate" : "Tolte"}</th></tr></thead>
					<tbody>${lista.map(c => `<tr><td>${esc(formatoData(c.data))}</td><td>${esc(c.utente)}</td><td>${esc(c.file)}</td><td>${esc(c.foglio)}</td>
						<td class="num">${num(c.righe)}</td><td class="num">${num(c.nuove)}</td><td class="num">${num(shop ? c.aggiornate : c.tolte)}</td></tr>`).join("")}</tbody>
				</table>`
				: `<p class="cx-testo cx-muted">Nessun caricamento.</p>`;
			box.innerHTML = `<div class="cx-card-head">Ultimi caricamenti</div>
				<div class="cx-card-body">
					<h3 class="cx-sottotitolo">Shop Order</h3>${tabella(d.shoporder || [], true)}
					<h3 class="cx-sottotitolo">TAG</h3>${tabella(d.tag || [], false)}
					<h3 class="cx-sottotitolo">Tracker EPA</h3>${d.epaErrore ? `<p class="cx-testo cx-muted">Database TrackerEPA non raggiungibile: ${esc(d.epaErrore)}</p>` : tabella(d.epa || [], false)}
				</div>`;
		} catch (e) {
			box.innerHTML = `<div class="cx-card-head">Ultimi caricamenti</div><div class="cx-card-body"><div class="cx-alert cx-alert-warning">${esc(e.message)}</div></div>`;
		}
	}

	/* ================= avvio ================= */

	function avvia() {
		const sezione = $("#cx-carica");
		if (!sezione) return;
		const drop = $("#cx-drop");
		const scegli = f => { if (f) { $("#cx-drop-testo").textContent = f.name; analizza(f); } };
		$("#cx-file").addEventListener("change", e => scegli(e.target.files[0]));
		["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("is-over"); }));
		["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("is-over"); }));
		drop.addEventListener("drop", e => scegli(e.dataTransfer.files[0]));
		sezione.addEventListener("click", e => {
			const b = e.target.closest("button[data-azione]");
			if (!b) return;
			if (b.dataset.azione === "carica") disegnaAnalisi(true);
			else if (b.dataset.azione === "conferma") invia();
			else if (b.dataset.azione === "ricarica") window.location.reload();
			else if (b.dataset.azione === "annulla") {
				if (b.closest(".cx-azioni").querySelector('[data-azione="conferma"]')) disegnaAnalisi();
				else { stato.file = null; $("#cx-file").value = ""; $("#cx-drop-testo").innerHTML = "Trascina qui il file Excel oppure <u>sceglilo dal computer</u>"; disegnaAnalisi(); }
			}
		});
	}

	// Usate da Motori.js quando si apre / chiude la scheda
	window.CertificatiCarica = {
		mostra() {
			const s = $("#cx-carica");
			if (!s) return;
			s.hidden = false;
			if (!stato.storico) { stato.storico = true; caricaStorico(); }
		},
		nascondi() {
			const s = $("#cx-carica");
			if (s) s.hidden = true;
		}
	};

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
	else avvia();
})();
