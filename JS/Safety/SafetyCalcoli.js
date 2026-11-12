(function (root) {
	"use strict";

	const FATTORE = { IFI: 100000, ISI: 1000 };
	const PARAMETRO = { IFI: "LTI", ISI: "DAYS" };

	function riga(dati, par, anno, loc) {
		const p = dati.valori && dati.valori[par];
		const a = p && p[String(anno)];
		return (a && a[loc]) || null;
	}

	function location(dati, anno) {
		const set = new Set();
		["WH", "LTI", "DAYS"].forEach(par => {
			const a = dati.valori && dati.valori[par] && dati.valori[par][String(anno)];
			if (a) Object.keys(a).forEach(l => set.add(l));
		});
		return ordina(Array.from(set));
	}

	function ordina(nomi) {
		return nomi.slice().sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
	}

	function somma(dati, par, locs, mesi) {
		let s = 0;
		locs.forEach(loc => {
			mesi.forEach(({ anno, mese }) => {
				const r = riga(dati, par, anno, loc);
				const v = r ? r[mese] : null;
				if (v != null) s += Number(v);
			});
		});
		return s;
	}

	function mensili(dati, par, anno, locs) {
		const out = [];
		for (let m = 0; m < 12; m++) out.push(somma(dati, par, locs, [{ anno, mese: m }]));
		return out;
	}

	function meseCompilato(dati, anno, mese, locs) {
		return locs.some(loc => {
			const r = riga(dati, "WH", anno, loc);
			return r && r[mese] != null && Number(r[mese]) > 0;
		});
	}

	function ultimoMese(dati) {
		const anni = Object.keys((dati.valori && dati.valori.WH) || {}).map(Number).sort((a, b) => b - a);
		for (const anno of anni) {
			const locs = Object.keys(dati.valori.WH[String(anno)]);
			for (let m = 11; m >= 0; m--) if (meseCompilato(dati, anno, m, locs)) return { anno, mese: m };
		}
		return null;
	}

	function mesiYtd(anno, mese) {
		const l = [];
		for (let m = 0; m <= mese; m++) l.push({ anno, mese: m });
		return l;
	}

	function mesi12mr(anno, mese) {
		const l = [];
		for (let m = mese + 1; m < 12; m++) l.push({ anno: anno - 1, mese: m });
		for (let m = 0; m <= mese; m++) l.push({ anno, mese: m });
		return l;
	}

	function mesiFy(anno) {
		return mesiYtd(anno, 11);
	}

	function rapporto(num, ore, fattore) {
		return ore > 0 ? num * fattore / ore : null;
	}

	function indice(dati, tipo, locs, mesi) {
		const casi = somma(dati, PARAMETRO[tipo], locs, mesi);
		const ore = somma(dati, "WH", locs, mesi);
		return { valore: rapporto(casi, ore, FATTORE[tipo]), casi, ore };
	}

	function ytd(dati, tipo, locs, anno, mese) { return indice(dati, tipo, locs, mesiYtd(anno, mese)); }
	function r12(dati, tipo, locs, anno, mese) { return indice(dati, tipo, locs, mesi12mr(anno, mese)); }
	function fy(dati, tipo, locs, anno) { return indice(dati, tipo, locs, mesiFy(anno)); }
	function mese1(dati, tipo, locs, anno, mese) { return indice(dati, tipo, locs, [{ anno, mese }]); }

	function r3(v) {
		return v == null ? null : Math.round(v * 1000 + 1e-9) / 1000;
	}

	function colore(valore, target, treColori) {
		if (valore == null || target == null) return "none";
		const v = r3(valore);
		if (target === 0) return v === 0 ? "green" : "red";
		if (v <= target + 1e-9) return "green";
		if (treColori !== false && v <= target * 1.2 + 1e-9) return "yellow";
		return "red";
	}

	const MESI_EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
	const MESI_IT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
	const NOMI_PARAMETRO = { WH: "Total Worked Hours", LTI: "Total N. of LTI - WR", DAYS: "Total N. of days lost due to LTI - WR" };

	function testo(v) {
		return v == null ? "" : String(v).replace(/\s+/g, " ").trim();
	}

	function norm(v) {
		return testo(v).toLowerCase();
	}

	function perimetroDelFoglio(nome) {
		const n = norm(nome).replace(/[\s_-]/g, "");
		if (n === "mfg") return "MFG";
		if (n === "nmfg" || n === "nonmfg" || n === "nonmanufacturing") return "NMFG";
		return null;
	}

	function parametroDi(v) {
		const n = norm(v);
		if (!n) return null;
		if (n.indexOf("worked hours") >= 0) return "WH";
		if (n.indexOf("lti") >= 0 && n.indexOf("days") >= 0) return "DAYS";
		if (n.indexOf("lti") >= 0) return "LTI";
		return null;
	}

	function meseDi(v, dataExcel) {
		if (v == null || v === "") return null;
		if (v instanceof Date) {
			const d = new Date(v.getTime() + 12 * 3600 * 1000);
			return { anno: d.getFullYear(), mese: d.getMonth() };
		}
		if (typeof v === "number") {
			if (v > 20000 && v < 80000 && dataExcel) {
				const d = dataExcel(v);
				if (d) return { anno: d.y, mese: d.m - 1 };
			}
			return null;
		}
		const s = norm(v);
		let m = s.match(/^([a-z]{3})[a-z]*[\s\-\/.']*(\d{2}|\d{4})$/);
		if (m) {
			let i = MESI_EN.indexOf(m[1]);
			if (i < 0) i = MESI_IT.indexOf(m[1]);
			if (i < 0) return null;
			const a = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
			return { anno: a, mese: i };
		}
		m = s.match(/^(\d{4})-(\d{1,2})(-\d{1,2})?/);
		if (m) return { anno: Number(m[1]), mese: Number(m[2]) - 1 };
		m = s.match(/^(\d{1,2})[\/.-](\d{4})$/);
		if (m) return { anno: Number(m[2]), mese: Number(m[1]) - 1 };
		m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
		if (m) return { anno: Number(m[3]), mese: Number(m[2]) - 1 };
		return null;
	}

	function numeroDi(v) {
		if (v == null) return null;
		if (typeof v === "number") return isFinite(v) ? v : { errore: true };
		const s = testo(v);
		if (s === "" || s === "-" || s === "—") return null;
		let t = s.replace(/\s/g, "");
		if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
		else if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
		else t = t.replace(/,/g, "");
		const n = Number(t);
		return isFinite(n) && t !== "" ? n : { errore: true };
	}

	function eTotale(nome, perimetro) {
		const n = norm(nome);
		const p = String(perimetro || "").toLowerCase();
		return n === "tot" || n === "total" || n === "totale" || n.indexOf("tot ") === 0 || n.indexOf("total ") === 0 ||
			n === p || n === "ivg " + p || n === p + " ww";
	}

	function leggiFoglio(nomeFoglio, righe, dataExcel) {
		const perimetro = perimetroDelFoglio(nomeFoglio);
		const out = { foglio: nomeFoglio, perimetro, blocchi: [], errori: [], avvisi: [] };
		if (!perimetro) return out;

		let blocco = null;
		const chiudi = () => { blocco = null; };

		righe.forEach((r, i) => {
			const nRiga = i + 1;
			const c0 = r && r[0], c1 = r && r[1];
			if (norm(c0) === "location name") {
				const colonne = [];
				for (let c = 2; c < r.length; c++) {
					const m = meseDi(r[c], dataExcel);
					if (m) colonne.push({ c, anno: m.anno, mese: m.mese });
				}
				if (colonne.length === 0) {
					out.errori.push(`Foglio ${nomeFoglio}, riga ${nRiga}: nell'intestazione non ci sono mesi riconoscibili (es. "Jan-2025").`);
					blocco = null;
					return;
				}
				blocco = { riga: nRiga, parametro: null, nomeParametro: "", colonne, location: [], totale: null };
				out.blocchi.push(blocco);
				return;
			}
			if (!blocco) return;
			const nome = testo(c0);
			const vuota = !r || r.every(v => v == null || testo(v) === "");
			if (vuota) { chiudi(); return; }
			if (!nome) return;

			const valori = {};
			blocco.colonne.forEach(col => {
				const n = numeroDi(r[col.c]);
				if (n && n.errore) {
					out.errori.push(`Foglio ${nomeFoglio}, riga ${nRiga} (${nome}), colonna ${MESI_EN[col.mese]}-${col.anno}: "${testo(r[col.c])}" non è un numero.`);
				} else if (n != null && n < 0) {
					out.errori.push(`Foglio ${nomeFoglio}, riga ${nRiga} (${nome}): valore negativo (${n}).`);
				}
				valori[col.anno + "-" + col.mese] = (n && n.errore) ? null : n;
			});

			if (eTotale(nome, perimetro)) { blocco.totale = { riga: nRiga, valori }; return; }

			const par = parametroDi(c1);
			if (!par) {
				out.errori.push(`Foglio ${nomeFoglio}, riga ${nRiga} (${nome}): "Parameter Name" non riconosciuto ("${testo(c1)}").`);
				return;
			}
			if (!blocco.parametro) { blocco.parametro = par; blocco.nomeParametro = testo(c1); }
			else if (blocco.parametro !== par) {
				out.errori.push(`Foglio ${nomeFoglio}, riga ${nRiga} (${nome}): parametro "${testo(c1)}" diverso dal resto del blocco ("${blocco.nomeParametro}").`);
				return;
			}
			if (blocco.location.some(l => l.nome.toLowerCase() === nome.toLowerCase())) {
				out.errori.push(`Foglio ${nomeFoglio}, riga ${nRiga}: la location "${nome}" compare due volte nello stesso blocco.`);
				return;
			}
			blocco.location.push({ nome, riga: nRiga, valori });
		});

		const principali = {};
		const ripetuti = [];
		out.blocchi = out.blocchi.filter(b => b.parametro && b.location.length).filter(b => {
			if (!principali[b.parametro]) { principali[b.parametro] = b; return true; }
			ripetuti.push(b);
			return false;
		});
		if (ripetuti.length) {
			const diff = [];
			ripetuti.forEach(b => {
				const base = principali[b.parametro];
				b.location.forEach(l => {
					const ref = base.location.find(x => x.nome.toLowerCase() === l.nome.toLowerCase());
					if (!ref) return;
					b.colonne.forEach(col => {
						const k = col.anno + "-" + col.mese;
						const a = l.valori[k], v = ref.valori[k];
						if ((a == null) !== (v == null) || (a != null && Math.abs(a - v) > 0.005)) diff.push(`riga ${l.riga} (${l.nome}, ${MESI_EN[col.mese]}-${col.anno}): ${a == null ? "vuota" : a} invece di ${v == null ? "vuota" : v}`);
					});
				});
			});
			out.info = `Foglio ${nomeFoglio}: usati i primi blocchi (righe ${Object.keys(principali).map(p => principali[p].riga).join(", ")}); ${ripetuti.length} blocchi ripetuti più sotto (sezioni per gruppo) non vengono caricati.`;
			if (diff.length) out.avvisi.push(`Foglio ${nomeFoglio}: nelle sezioni ripetute ${diff.length} celle non coincidono con il primo blocco (si caricano i valori del primo blocco): ${diff.slice(0, 8).join("; ")}${diff.length > 8 ? "; …" : ""}.`);
		}
		out.blocchi.forEach(b => {
			if (/nwr/i.test(b.nomeParametro)) out.avvisi.push(`Foglio ${nomeFoglio}, riga ${b.riga + 1}: il parametro si chiama "${b.nomeParametro}"; viene caricato come "${NOMI_PARAMETRO[b.parametro]}".`);
			if (b.totale) {
				const diversi = [];
				b.colonne.forEach(col => {
					const k = col.anno + "-" + col.mese;
					const t = b.totale.valori[k];
					if (t == null) return;
					const s = b.location.reduce((a, l) => a + (l.valori[k] || 0), 0);
					if (Math.abs(s - t) > 0.05) diversi.push(`${MESI_EN[col.mese]}-${col.anno} (TOT ${t}, somma ${Math.round(s * 100) / 100})`);
				});
				if (diversi.length) out.avvisi.push(`Foglio ${nomeFoglio}, riga ${b.totale.riga}: la riga TOT di "${NOMI_PARAMETRO[b.parametro]}" non è la somma delle location in ${diversi.length} mes${diversi.length === 1 ? "e" : "i"}: ${diversi.join("; ")}. La pagina usa la somma delle location.`);
			}
			b.anni = {};
			b.colonne.forEach(col => { b.anni[col.anno] = b.anni[col.anno] || true; });
			Object.keys(b.anni).forEach(anno => {
				b.anni[anno] = b.location.map(l => {
					const v = [];
					for (let m = 0; m < 12; m++) {
						const x = l.valori[anno + "-" + m];
						v.push(x == null ? null : x);
					}
					return [l.nome].concat(v);
				});
			});
		});

		const wh = out.blocchi.find(b => b.parametro === "WH");
		if (wh) {
			const nomiWh = new Set(wh.location.map(l => l.nome.toLowerCase()));
			out.blocchi.forEach(b => {
				if (b === wh) return;
				b.location.forEach(l => {
					if (!nomiWh.has(l.nome.toLowerCase())) out.avvisi.push(`Foglio ${nomeFoglio}: "${l.nome}" c'è in "${NOMI_PARAMETRO[b.parametro]}" ma non in "Total Worked Hours" (i suoi casi contano, le ore no).`);
				});
			});
		} else if (out.blocchi.length) {
			out.errori.push(`Foglio ${nomeFoglio}: manca il blocco "Total Worked Hours".`);
		}
		return out;
	}

	const api = { FATTORE, NOMI_PARAMETRO, leggiFoglio, meseDi, numeroDi, perimetroDelFoglio, location, ordina, somma, mensili, ultimoMese, meseCompilato, mesiYtd, mesi12mr, mesiFy, indice, ytd, r12, fy, mese1, r3, colore, riga };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	else root.SafetyCalcoli = api;
})(this);
