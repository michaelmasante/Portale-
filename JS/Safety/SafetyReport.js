/* ============ Safety - presentazione (anteprima nella pagina + export PowerPoint) ============
   Ogni slide è descritta UNA volta come elenco di elementi in pollici (slide 13,333 x 7,5 = LAYOUT_WIDE):
       testo, rettangolo, ellisse, linea, immagine, tabella
   e da lì si disegna sia l'anteprima HTML (disegnaHtml) sia il file PowerPoint (esportaPpt, con pptxgenjs):
   quello che si vede nella pagina è quello che finisce nel file.

   I grafici sono disegnati con Chart.js in immagini a 200 punti per pollice: le dimensioni dei caratteri
   qui sotto sono in punti tipografici "veri" della slide (PT).

   Cose da cambiare a mano più facilmente:
     AREE_MFG       linguette delle tabelle e righe della slide "IFI Scorecard"
     SEQUENZA_PERF  ordine delle righe delle slide "Plant Performance"
     MAX_TUTTE      sopra questo numero di location, i grafici per location mostrano solo quelle con casi (NMFG)
   I target e la composizione dei gruppi sono nel database (dbo.SafetyTarget, dbo.SafetyGruppi). */

(function (root) {
	"use strict";

	const C = root.SafetyCalcoli;
	const DPI = 200;
	const PT = DPI / 72;                 // pixel dell'immagine per un punto tipografico
	const FONT = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";
	const MESI_UP = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
	const MESI_HDR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUNE", "JULY", "AUG", "SEPT", "OCT", "NOV", "DEC"];
	const MESI_SC = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	const MESI_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
	const COLORI_MESI = ["#16a34a", "#eab308", "#f97316", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f59e0b", "#3b82f6", "#10b981", "#6366f1"];
	const BLU = "1D64C7", GRIGIO = "919191", SCURO = "1e293b";

	const AREE_MFG = [
		{ gruppo: "BUS", etichetta: "BUS" },
		{ gruppo: "PWT EU+AMEA", etichetta: "POWERTRAIN EU+AMEA" },
		{ gruppo: "TRUCK EU", etichetta: "TRUCK EU" },
		{ gruppo: "LATAM", etichetta: "LATAM" }
	];
	const SEQUENZA_PERF = ["BUS", "PWT EU", "PWT EU+AMEA", "TRUCK EU", "LATAM"];
	const MAX_TUTTE = 30;

	const PERIMETRI = {
		MFG: {
			sigla: "MFG", ivg: "IVG MFG", colore: "#1e40af", box: "1e40af",
			sottotitolo: "Perimeter Manufacturing (MFG)", etichettaPerimetro: "Perimeter", sizePerimetro: 18,
			note: "Permanent and Agency Employees\nMFG perimeter: complete\nLTI WR > 1 day of absence\nExcluded in itinere injuries",
			boxTrend: "SCORECARD", file: "Safety_Monthly_Report_MFG"
		},
		NMFG: {
			sigla: "NMFG", ivg: "IVG NMFG", colore: "#f97316", box: "f97316",
			sottotitolo: "Perimeter Non-Manufacturing (NMFG)", etichettaPerimetro: "Perimeter Non-Manufacturing", sizePerimetro: 14,
			note: "Permanent and Agency Employees\nNMFG perimeter: complete\nLTI WR > 1 day of absence\nExcluded in itinere injuries",
			boxTrend: "IVG NMFG", file: "Safety_Monthly_Report_NMFG"
		}
	};

	/* ================= formati ================= */

	const f3 = v => v == null ? "" : C.r3(v).toFixed(3).replace(".", ",");
	const fInt = v => v == null ? "" : String(Math.round(v));
	function fTarget(v) {
		if (v == null) return "—";
		const s = (Math.round(v * 10000) / 10000).toFixed(4).replace(/0$/, "");
		return s.replace(".", ",");
	}
	const aa = anno => String(anno).slice(-2);

	/* ================= elementi della slide ================= */

	const T = (x, y, w, h, runs, o) => Object.assign({ t: "testo", x, y, w, h, runs: typeof runs === "string" ? [{ testo: runs }] : runs }, o || {});
	const R = (x, y, w, h, fill, line, lineW, forma) => ({ t: forma || "rett", x, y, w, h, fill, line, lineW: lineW || 0 });
	const L = (x, y, w, colore, pt) => ({ t: "linea", x, y, w, colore, pt });
	const I = (x, y, w, h, data) => ({ t: "img", x, y, w, h, data });
	const TB = (x, y, colW, rowH, righe, bordo) => ({ t: "tabella", x, y, colW, rowH, righe, bordo: bordo || { pt: 0.75, colore: "000000" } });
	const cella = (testo, o) => Object.assign({ testo: testo == null ? "" : String(testo) }, o || {});

	/* ================= grafici (Chart.js -> immagine) ================= */

	// Etichette dei valori disegnate a mano: posizione sopra / sotto / al centro, testo verticale, nessuna sovrapposizione col bordo
	const pluginEtichette = {
		id: "sfEtichette",
		afterDatasetsDraw(chart) {
			const ctx = chart.ctx;
			chart.data.datasets.forEach((ds, di) => {
				const e = ds.sfEtichette;
				if (!e) return;
				const meta = chart.getDatasetMeta(di);
				if (meta.hidden) return;
				meta.data.forEach((el, i) => {
					const v = ds.data[i];
					const txt = e.testo(v, i);
					if (!txt) return;
					const p = el.getProps(["x", "y", "base"], true);
					ctx.save();
					ctx.font = (e.bold === false ? "" : "bold ") + Math.round(e.size * PT) + "px " + FONT;
					ctx.fillStyle = e.colore || "#1e293b";
					const off = (e.offset == null ? 3 : e.offset) * PT;
					if (e.pos === "centro") {
						ctx.textAlign = "center";
						ctx.textBaseline = "middle";
						ctx.fillText(txt, p.x, (p.y + p.base) / 2);
					} else if (e.verticale) {
						ctx.translate(p.x, p.y - off);
						ctx.rotate(-Math.PI / 2);
						ctx.textAlign = "left";
						ctx.textBaseline = "middle";
						ctx.fillText(txt, 0, 0);
					} else {
						const sotto = e.sotto ? e.sotto(v, i) : false;
						ctx.textAlign = "center";
						ctx.textBaseline = sotto ? "top" : "bottom";
						ctx.fillText(txt, p.x, sotto ? p.y + off : p.y - off);
					}
					ctx.restore();
				});
			});
		}
	};

	// Linea dell'asse orizzontale in basso (grafici a barre)
	const pluginAsse = {
		id: "sfAsse",
		afterDraw(chart, args, opts) {
			if (!opts || !opts.mostra) return;
			const a = chart.chartArea, ctx = chart.ctx;
			ctx.save();
			ctx.strokeStyle = "#1e293b";
			ctx.lineWidth = Math.max(1, 0.75 * PT);
			ctx.beginPath();
			ctx.moveTo(a.left, a.bottom);
			ctx.lineTo(a.right, a.bottom);
			ctx.stroke();
			ctx.restore();
		}
	};

	function disegna(w, h, config) {
		const cv = document.createElement("canvas");
		cv.width = Math.round(w * DPI);
		cv.height = Math.round(h * DPI);
		config.options = Object.assign({ responsive: false, animation: false, devicePixelRatio: 1, events: [] }, config.options || {});
		config.options.plugins = Object.assign({ legend: { display: false }, tooltip: { enabled: false } }, config.options.plugins || {});
		config.plugins = [pluginEtichette, pluginAsse];
		const chart = new root.Chart(cv.getContext("2d"), config);
		chart.draw();
		const url = cv.toDataURL("image/png");
		chart.destroy();
		return url;
	}

	function asseX(size, rot, colore) {
		return { grid: { display: false, drawBorder: false }, border: { display: false }, ticks: { autoSkip: false, maxRotation: rot || 0, minRotation: rot || 0, color: colore || "#475569", font: { size: Math.round(size * PT), family: FONT } } };
	}

	function asseY(min, max, griglia) {
		return { display: !!griglia, min, max, beginAtZero: min == null, grid: { color: "#e2e8f0", lineWidth: Math.max(1, 0.5 * PT), drawBorder: false }, border: { display: false }, ticks: { display: false } };
	}

	/* Etichette dell'asse X: nomi lunghi su più righe */
	function aCapo(nome, max) {
		const parole = String(nome).split(" ");
		const righe = [];
		let r = "";
		parole.forEach(p => {
			if (r && (r + " " + p).length > max) { righe.push(r); r = p; }
			else r = r ? r + " " + p : p;
		});
		if (r) righe.push(r);
		return righe.length > 1 ? righe : righe[0];
	}

	/* Grafico a linee IFI/ISI: punto anno precedente, linea anno corrente, retta tratteggiata fino al target */
	function graficoLinea(w, h, o) {
		const labels = [String(o.anno - 1)].concat(MESI_UP, [["TGT", String(o.anno)]]);
		const n = labels.length;
		const prev = o.prev == null ? null : C.r3(o.prev);
		const vals = o.valori.map(v => v == null ? null : C.r3(v));
		const tutti = [prev, o.target].concat(vals).filter(v => v != null);
		let min = Math.min.apply(null, tutti), max = Math.max.apply(null, tutti);
		let range = max - min;
		if (range <= 0) range = Math.max(max, 0.05) * 0.5;
		let yMin, yMax;
		if (o.scalaStretta) { yMin = min - range * 0.45; yMax = max + range * 0.5; }
		else { yMin = Math.max(0, min - range * 1.5); yMax = max + range * 1.2; }
		const ds0 = [prev].concat(Array(n - 1).fill(null));
		const ds1 = [null].concat(vals, [null]);
		const ds2 = [prev].concat(Array(n - 2).fill(null), [o.target]);
		const punto = (ds, r) => ({ pointRadius: ds.map(v => v == null ? 0 : r * PT), pointHoverRadius: 0 });
		const lw = 1.25 * PT;
		const etich = (size, sotto) => ({ size, testo: v => v == null ? "" : f3(v), sotto, offset: 3 });
		return disegna(w, h, {
			type: "line",
			data: {
				labels,
				datasets: [
					Object.assign({ data: ds0, borderColor: "#94a3b8", backgroundColor: "#94a3b8", pointStyle: o.pointStyle || "circle", borderWidth: lw, sfEtichette: etich(o.sizeVal) }, punto(ds0, 2.2)),
					Object.assign({ data: ds1, borderColor: o.colore, backgroundColor: o.colore, pointStyle: o.pointStyle || "circle", borderWidth: lw, spanGaps: false, tension: 0,
						sfEtichette: etich(o.sizeVal, v => prev != null && v < prev) }, punto(ds1, 2.2)),
					Object.assign({ data: ds2, borderColor: o.colore, backgroundColor: o.colore, borderDash: [4 * PT, 3 * PT], borderWidth: 0.9 * PT, spanGaps: true, tension: 0,
						sfEtichette: { size: o.sizeVal, testo: (v, i) => i === n - 1 ? f3(v) : "", offset: 4 } },
						{ pointRadius: ds2.map((v, i) => i === n - 1 ? 2.6 * PT : 0), pointHoverRadius: 0 })
				]
			},
			options: {
				layout: { padding: { top: 0.42 * DPI, right: 0.24 * DPI, bottom: 0.06 * DPI, left: 0.24 * DPI } },
				scales: { x: asseX(o.sizeAsse), y: asseY(yMin, yMax, true) }
			}
		});
	}

	/* Barre anno corrente vs anno precedente (LTI 26 vs 25 / IFI 26 vs 25) */
	function graficoConfronto(w, h, o) {
		const tutti = o.cur.concat(o.prev).filter(v => v != null);
		const max = Math.max.apply(null, tutti.concat([0])) || 1;
		const verticale = !!o.verticale;
		const etich = { size: o.sizeVal, verticale, offset: 2, testo: v => (v == null || v === 0) ? "" : o.formato(v) };
		return disegna(w, h, {
			type: "bar",
			data: {
				labels: o.labels,
				datasets: [
					{ label: o.nomi[0], data: o.cur, backgroundColor: "#1e40af", borderWidth: 0, categoryPercentage: 0.8, barPercentage: 0.9, sfEtichette: etich },
					{ label: o.nomi[1], data: o.prev, backgroundColor: "#94a3b8", borderWidth: 0, categoryPercentage: 0.8, barPercentage: 0.9, sfEtichette: etich }
				]
			},
			options: {
				layout: { padding: { top: 0.05 * DPI, right: 0.06 * DPI, bottom: 0.02 * DPI, left: 0.06 * DPI } },
				plugins: {
					legend: { display: true, position: "bottom", labels: { boxWidth: 7 * PT, boxHeight: 5 * PT, padding: 5 * PT, color: "#475569", font: { size: Math.round(6.5 * PT), family: FONT } } },
					sfAsse: { mostra: true }
				},
				scales: { x: asseX(o.sizeAsse), y: asseY(0, max * (verticale ? 1.55 : 1.22), false) }
			}
		});
	}

	/* Barre per location (una serie) */
	function graficoLocation(w, h, o) {
		const vals = o.valori;
		const max = Math.max.apply(null, vals.filter(v => v != null).concat([0])) || 1;
		const pochi = o.labels.length <= 14;
		return disegna(w, h, {
			type: "bar",
			data: {
				labels: o.labels.map(l => aCapo(l, pochi ? 18 : 26)),
				datasets: [{ data: vals, backgroundColor: "#0911fa", borderWidth: 0, categoryPercentage: 0.75, barPercentage: 0.8, maxBarThickness: 0.42 * DPI,
					sfEtichette: { size: o.sizeVal, offset: 2, testo: v => (v == null || v === 0) ? "" : o.formato(v) } }]
			},
			options: {
				layout: { padding: { top: 0.08 * DPI, right: 0.1 * DPI, bottom: 0.02 * DPI, left: 0.1 * DPI } },
				plugins: { sfAsse: { mostra: true } },
				scales: { x: asseX(o.sizeAsse, pochi ? 0 : 45, "#1e293b"), y: asseY(0, max * 1.2, false) }
			}
		});
	}

	/* Barre impilate per mese (LTI Cases Monthly Comparison) */
	function graficoMensile(w, h, o) {
		const tot = o.labels.map((_, i) => o.serie.reduce((a, s) => a + (s.data[i] || 0), 0));
		const max = Math.max.apply(null, tot.concat([0])) || 1;
		const pochi = o.labels.length <= 14;
		return disegna(w, h, {
			type: "bar",
			data: {
				labels: o.labels.map(l => aCapo(l, pochi ? 16 : 26)),
				datasets: o.serie.map(s => ({ label: s.nome, data: s.data, backgroundColor: s.colore, borderWidth: 0, categoryPercentage: 0.7, barPercentage: 0.85, maxBarThickness: 0.55 * DPI,
					sfEtichette: { size: o.sizeVal, pos: "centro", colore: "#000000", testo: v => v > 0 ? String(v) : "" } }))
			},
			options: {
				layout: { padding: { top: 0.08 * DPI, right: 0.1 * DPI, bottom: 0.02 * DPI, left: 0.1 * DPI } },
				plugins: { sfAsse: { mostra: true } },
				scales: { x: Object.assign(asseX(o.sizeAsse, pochi ? 0 : 45, "#1e293b"), { stacked: true }), y: Object.assign(asseY(0, max * 1.12, false), { stacked: true }) }
			}
		});
	}

	/* IFI Monthly Trend: barre + retta tratteggiata dal 2025 al target */
	function graficoTrend(w, h, o) {
		const n = o.labels.length;
		const vals = o.valori.map(v => v == null ? null : C.r3(v));
		const max = Math.max.apply(null, vals.filter(v => v != null).concat([o.target || 0])) || 0.2;
		const linea = vals.map((v, i) => i === 0 ? vals[0] : (i === n - 1 ? o.target : null));
		return disegna(w, h, {
			type: "bar",
			data: {
				labels: o.labels,
				datasets: [
					{ type: "bar", data: vals, backgroundColor: o.colori, borderWidth: 0, categoryPercentage: 1, barPercentage: 0.5, order: 2,
						sfEtichette: { size: 10, offset: 3, testo: v => v == null ? "" : f3(v) } },
					{ type: "line", data: linea, borderColor: "#1e40af", borderDash: [6 * PT, 4 * PT], borderWidth: 0.6 * PT, spanGaps: true, tension: 0, order: 1,
						pointStyle: "rectRot", pointRadius: linea.map(v => v == null ? 0 : 3 * PT), pointBackgroundColor: "#1e40af", pointBorderColor: "#1e40af" }
				]
			},
			options: {
				layout: { padding: { top: 0.25 * DPI, right: 0.2 * DPI, bottom: 0.05 * DPI, left: 0.1 * DPI } },
				scales: { x: asseX(10, 0, "#1e293b"), y: asseY(0, max * 1.18, true) }
			}
		});
	}

	/* ================= contesto e calcoli comuni ================= */

	function contesto(dati, perimetro, anno, mese) {
		const cfg = PERIMETRI[perimetro];
		const locs = C.location(dati, anno);
		const avvisi = [];
		const gruppi = {};
		(dati.gruppi || []).forEach(g => {
			const mancanti = g.location.filter(l => !locs.some(x => x.toLowerCase() === l.toLowerCase()));
			if (mancanti.length) avvisi.push(`Gruppo ${g.gruppo}: nel file non ci sono ${mancanti.map(m => '"' + m + '"').join(", ")} (controllare dbo.SafetyGruppi o i nomi nel file).`);
			gruppi[g.gruppo] = g.location.map(l => locs.find(x => x.toLowerCase() === l.toLowerCase()) || l);
		});
		const targetMancanti = new Set();
		function target(nome, indice) {
			const t = (dati.target || []).find(x => x.anno === anno && x.indice === indice && x.nome.trim().toLowerCase() === String(nome).trim().toLowerCase());
			if (!t) { targetMancanti.add(indice + " " + nome); return null; }
			return t.valore;
		}
		return { dati, perimetro, cfg, anno, mese, locs, gruppi, target, targetMancanti, avvisi };
	}

	function titoloMese(k) { return `${MESI_FULL[k.mese]} '${aa(k.anno)}`; }
	function numMese(k) { return `${String(k.mese + 1).padStart(2, "0")}/${aa(k.anno)}`; }

	function testiStandard(perimetro, anno, mese) {
		const cfg = PERIMETRI[perimetro];
		return {
			coverTitolo: `Safety Monthly Report – Updated ${MESI_FULL[mese]} '${aa(anno)}`,
			coverSotto: cfg.sottotitolo,
			coverData: `Report Date: ${MESI_FULL[mese]} ${anno}`,
			note: cfg.note
		};
	}

	function footer(els, img, n) {
		if (img.marchi) els.push(I(0.6006, 6.9231, 4.9835, 0.2323, img.marchi));
		if (img.gruppo) els.push(I(10.2086, 6.6339, 1.9685, 1.0633, img.gruppo));
		els.push(T(12.418, 7.105, 0.367, 0.168, [{ testo: String(n), size: 9, color: "94a3b8" }], { align: "right", valign: "middle", margine: 0 }));
	}

	function titolo(testo1, testo2, x, y, w, h, size1, size2) {
		return T(x, y, w, h, [
			{ testo: testo1, size: size1 || 22, bold: true, color: BLU, br: true },
			{ testo: testo2, size: size2 || 13, italic: true, color: GRIGIO }
		], { valign: "top" });
	}

	function pannelloPerimetro(els, k, note) {
		els.push(R(9.603, 0, 3.73, 6.585, "D2EBFF"));
		els.push(T(9.674, 0.584, 3.4, 0.328, [{ testo: k.cfg.etichettaPerimetro, size: k.cfg.sizePerimetro, bold: true, color: BLU }], { valign: "middle" }));
		const righe = String(note || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
		els.push(T(9.874, 1.063, 3.326, 1.4, righe.map((r, i) => ({ testo: r, size: 14, color: "404040", br: i < righe.length - 1 })), { valign: "top", bullet: true }));
	}

	function boxGrafico(els, x, y, w, h, titoloBox, colore) {
		els.push(R(x, y, w, h, null, colore, 0.75));
		els.push(T(x + 0.04, y + 0.03, 2, 0.3, [{ testo: titoloBox, size: 16, bold: true, color: SCURO }], { valign: "top" }));
	}

	/* ================= slide ================= */

	function slideCopertina(img, testi) {
		const els = [];
		if (img.copertina) els.push(I(0, 0, 13.333, 7.5, img.copertina));
		els.push(T(1.3, 5.9, 11, 0.5, [{ testo: testi.coverTitolo, size: 18, bold: true, color: "ffffff" }], { valign: "middle" }));
		els.push(T(1.3, 6.3, 11, 0.45, [{ testo: testi.coverSotto, size: 18, bold: true, color: "ffffff" }], { valign: "middle" }));
		els.push(T(1.3, 6.9, 11, 0.35, [{ testo: testi.coverData, size: 10, color: "ffffff" }], { valign: "middle" }));
		return { titolo: "Copertina", els };
	}

	function slideIfi(k, img, testi, n) {
		const els = [];
		const all = k.locs, a = k.anno, m = k.mese;
		els.push(titolo(`Safety Review Performance – ${titoloMese(k)}`, "Injury Frequency Index (IFI)", 0.537, 0.495, 8.8, 0.9, 20, 14));
		pannelloPerimetro(els, k, testi.note);

		const tgt = k.target(k.cfg.sigla, "IFI");
		const prevFy = C.fy(k.dati, "IFI", all, a - 1).valore;
		const ytd = [], r12 = [];
		for (let i = 0; i < 12; i++) {
			ytd.push(i <= m ? C.ytd(k.dati, "IFI", all, a, i).valore : null);
			r12.push(i <= m ? C.r12(k.dati, "IFI", all, a, i).valore : null);
		}
		const lineaOpt = { anno: a, prev: prevFy, target: tgt, colore: k.cfg.colore, sizeVal: 7, sizeAsse: 6 };
		boxGrafico(els, 0.437, 2.141, 3.45, 1.609, "IFI YTD", k.cfg.box);
		els.push(I(0.437, 2.141 + 0.3, 3.45, 1.609 - 0.32, graficoLinea(3.45, 1.609 - 0.32, Object.assign({ valori: ytd }, lineaOpt))));
		boxGrafico(els, 0.437, 4.012, 3.45, 1.765, "IFI 12MR", k.cfg.box);
		els.push(I(0.437, 4.012 + 0.3, 3.45, 1.765 - 0.32, graficoLinea(3.45, 1.765 - 0.32, Object.assign({ valori: r12, pointStyle: "rect" }, lineaOpt))));

		const labels = MESI_UP.slice(0, m + 1);
		const lti = C.mensili(k.dati, "LTI", a, all).slice(0, m + 1);
		const ltiP = C.mensili(k.dati, "LTI", a - 1, C.location(k.dati, a - 1)).slice(0, m + 1);
		const ifi = labels.map((_, i) => C.mese1(k.dati, "IFI", all, a, i).valore);
		const ifiP = labels.map((_, i) => C.mese1(k.dati, "IFI", C.location(k.dati, a - 1), a - 1, i).valore);
		const nomi = (p) => [`${p} ${a}`, `${p} ${a - 1}`];

		boxGrafico(els, 4.213, 2.45, 2.595, 1.959, `LTI ${aa(a)} vs ${aa(a - 1)}`, "1e40af");
		els.push(I(4.233, 2.8, 2.555, 1.59, graficoConfronto(2.555, 1.59, { labels, cur: lti, prev: ltiP, nomi: nomi("LTI"), formato: fInt, sizeVal: 7, sizeAsse: 6 })));
		boxGrafico(els, 6.924, 2.45, 2.539, 1.959, `IFI ${aa(a)} vs ${aa(a - 1)}`, "1e40af");
		els.push(I(6.944, 2.8, 2.499, 1.59, graficoConfronto(2.499, 1.59, { labels, cur: ifi.map(C.r3), prev: ifiP.map(C.r3), nomi: nomi("IFI"), formato: f3, sizeVal: 6.5, sizeAsse: 6, verticale: true })));

		const FX = 4.213, FY = 2.8 + 1.609 + 0.25;
		els.push(T(FX + 0.3, FY, 2.1, 0.5, [{ testo: "IFI (Injury Frequency Index) =", size: 9, color: GRIGIO }], { valign: "middle" }));
		els.push(L(FX + 2.35, FY + 0.25, 2.4, GRIGIO, 0.5));
		els.push(T(FX + 2.35, FY, 2.4, 0.25, [{ testo: "Number of lost time injuries x 100.000", size: 8, color: GRIGIO }], { align: "center", valign: "bottom" }));
		els.push(T(FX + 2.35, FY + 0.25, 2.4, 0.25, [{ testo: "Total number of hours worked", size: 8, color: GRIGIO }], { align: "center", valign: "top" }));
		els.push(T(FX, FY + 0.6, 5.25, 0.22, [{ testo: "LTI (Lost Time Injury):   an Injury which causes the employee to be absent at least one shift", size: 8, color: GRIGIO }], { valign: "top" }));
		footer(els, img, n);
		return { titolo: "Safety Review Performance – IFI", els };
	}

	function slideIsi(k, img, testi, n) {
		const els = [];
		const all = k.locs, a = k.anno, m = k.mese;
		els.push(titolo(`Safety Review Performance – ${titoloMese(k)}`, "Injury Severity Index (ISI)", 0.537, 0.495, 8.8, 0.9, 20, 14));
		pannelloPerimetro(els, k, testi.note);
		const tgt = k.target(k.cfg.sigla, "ISI");
		const prevFy = C.fy(k.dati, "ISI", all, a - 1).valore;
		const ytd = [], r12 = [];
		for (let i = 0; i < 12; i++) {
			ytd.push(i <= m ? C.ytd(k.dati, "ISI", all, a, i).valore : null);
			r12.push(i <= m ? C.r12(k.dati, "ISI", all, a, i).valore : null);
		}
		// scala "stretta": l'asse parte vicino al valore più basso, così si vedono i cambi di pendenza mese per mese
		const opt = { anno: a, prev: prevFy, target: tgt, colore: "#b91c1c", sizeVal: 8, sizeAsse: 8, scalaStretta: true, pointStyle: "rect" };
		boxGrafico(els, 0.437, 1.55, 8.9, 2.35, "ISI YTD", "b91c1c");
		els.push(I(0.437, 1.55 + 0.32, 8.9, 2.35 - 0.34, graficoLinea(8.9, 2.35 - 0.34, Object.assign({ valori: ytd }, opt))));
		boxGrafico(els, 0.437, 4.05, 8.9, 2.35, "ISI 12MR", "b91c1c");
		els.push(I(0.437, 4.05 + 0.32, 8.9, 2.35 - 0.34, graficoLinea(8.9, 2.35 - 0.34, Object.assign({ valori: r12 }, opt))));
		footer(els, img, n);
		return { titolo: "Safety Review Performance – ISI", els };
	}

	function scorecardBox(els, x, y, w, testo1, testo2, rosso) {
		const col = rosso ? "CC0000" : "16a34a";
		els.push(R(x, y, w, 0.8, null, "1e40af", 1.2));
		els.push(R(x + 0.15, y + 0.15, 0.5, 0.5, col, null, 0, "ellisse"));
		els.push(T(x + 0.75, y + 0.02, w - 0.85, 0.76, [{ testo: testo1, size: 11, bold: true, color: SCURO, br: true }, { testo: testo2, size: 11, bold: true, color: SCURO }], { valign: "middle" }));
	}

	function slideTrend(k, img, n) {
		const els = [];
		const all = k.locs, a = k.anno, m = k.mese;
		els.push(titolo(`IFI Monthly Trend – ${titoloMese(k)}`, "YTD Results", 0.4, 0.3, 7.5, 0.85));
		const tgt = k.target(k.cfg.sigla, "IFI");
		const r12 = C.r12(k.dati, "IFI", all, a, m).valore;
		const ytd = C.ytd(k.dati, "IFI", all, a, m);
		scorecardBox(els, 8.2, 0.2, 4.6, `${k.cfg.boxTrend} (12MR ${numMese(k)} vs. Target)`, `IFI 12MR ${f3(r12) || "—"} vs. ${f3(tgt) || "—"}`, r12 != null && tgt != null && C.r3(r12) > tgt);

		const mensIfi = MESI_UP.map((_, i) => i <= m ? C.mese1(k.dati, "IFI", all, a, i).valore : null);
		const mensLti = C.mensili(k.dati, "LTI", a, all).map((v, i) => i <= m ? v : null);
		const labels = [String(a - 1)].concat(MESI_UP, [`${a} YTD`, "12 MR", `Target '${aa(a)}`]);
		const valori = [C.fy(k.dati, "IFI", C.location(k.dati, a - 1), a - 1).valore].concat(mensIfi, [ytd.valore, r12, tgt]);
		const colori = ["#94a3b8"].concat(MESI_UP.map((_, i) => i <= m ? "#0028ff" : "transparent"), ["#0028ff", "#60a5fa", "#16a34a"]);
		els.push(I(0.4, 1.15, 12.4, 3.75, graficoTrend(12.4, 3.75, { labels, valori, colori, target: tgt })));

		const h = (t) => cella(t, { bold: true, color: "ffffff", fill: "1e40af", size: 11, align: "center" });
		const d = (t, o) => cella(t, Object.assign({ color: SCURO, size: 11, align: "center" }, o || {}));
		const righe = [
			[h(k.cfg.ivg)].concat(MESI_HDR.map(h), [h(`${a} YTD`)]),
			[d("LTI")].concat(mensLti.map(v => d(fInt(v))), [d(fInt(ytd.casi), { bold: true, fill: "dbeafe" })]),
			[d("IFI")].concat(mensIfi.map(v => d(f3(v))), [d(f3(ytd.valore), { bold: true, fill: "dbeafe" })])
		];
		const cw = (12.4 - 2) / 12;
		els.push(TB(0.4, 5.0, [1.0].concat(Array(12).fill(cw), [1.0]), 0.28, righe, { pt: 1, colore: "000000" }));
		footer(els, img, n);
		return { titolo: "IFI Monthly Trend", els };
	}

	function slideScorecard(k, img, n) {
		const els = [];
		const a = k.anno, m = k.mese;
		els.push(titolo("IFI Scorecard", "YTD and 12-month Rolling vs. Target", 0.3, 0.18, 6, 0.75));
		const tgtMfg = k.target(k.cfg.sigla, "IFI");
		const r12Mfg = C.r12(k.dati, "IFI", k.locs, a, m).valore;
		scorecardBox(els, 6.8, 0.15, 5.8, `SCORECARD (12MR ${numMese(k)} vs. Target)`, `IFI 12MR ${f3(r12Mfg) || "—"} vs. ${f3(tgtMfg) || "—"}`, r12Mfg != null && tgtMfg != null && C.r3(r12Mfg) > tgtMfg);

		const B = { pt: 0.75, colore: "000000" };
		const hdr = (t, o) => cella(t, Object.assign({ bold: true, color: "ffffff", fill: "808080", size: 10, align: "center" }, o || {}));
		const X0 = 0.837, COLW = [0.833, 0.472, 0.472, 0.669].concat(Array(14).fill(0.669));
		const xMesi = X0 + 0.833 + 0.472 + 0.472 + 0.669;
		els.push(TB(xMesi, 1.256, Array(14).fill(0.669), 0.18, [
			[hdr(String(a - 1)), hdr(String(a), { colspan: 12 }), hdr(`Target\n${a}`, { rowspan: 2 })],
			[hdr("FY")].concat(MESI_SC.map(x => hdr(x)))
		], B));

		const gruppi = [{ etichetta: "MFG WW", locs: k.locs, nome: k.cfg.sigla }].concat(
			AREE_MFG.filter(g => k.gruppi[g.gruppo] && k.gruppi[g.gruppo].length).map(g => ({ etichetta: g.etichetta, locs: k.gruppi[g.gruppo], nome: g.gruppo })));
		const passo = Math.min(0.912, (6.5 - 1.934) / gruppi.length);
		gruppi.forEach((g, gi) => {
			const tgt = k.target(g.nome, "IFI");
			const fyPrev = C.fy(k.dati, "IFI", g.locs, a - 1).valore;
			const ytd = [], r12 = [];
			for (let i = 0; i < 12; i++) {
				ytd.push(i <= m ? C.ytd(k.dati, "IFI", g.locs, a, i).valore : null);
				r12.push(i <= m ? C.r12(k.dati, "IFI", g.locs, a, i).valore : null);
			}
			const val = (v) => {
				const c = C.colore(v, tgt, false);
				const fill = c === "green" ? "16a34a" : c === "red" ? "dc2626" : "FFFFFF";
				return cella(f3(v), { bold: true, size: 10, align: "center", fill, color: c === "none" ? SCURO : "ffffff" });
			};
			const d = (t, fill, color, o) => cella(t, Object.assign({ bold: true, size: 10, align: "center", fill, color }, o || {}));
			els.push(TB(X0, 1.934 + gi * passo, COLW, 0.18, [
				[cella(g.etichetta, { bold: true, color: "ffffff", fill: "1e40af", size: 10, align: "left", colspan: 18 })],
				[d("SAFETY", "FFFFFF", SCURO, { rowspan: 2 }), d("IFI", "808080", "ffffff", { rowspan: 2 }), d("Freq", "808080", "ffffff", { rowspan: 2 }), d("YTD", "808080", "ffffff"), d(f3(fyPrev), "F1F5F9", SCURO)]
					.concat(ytd.map(val), [d(fTarget(tgt), "E8E8E8", SCURO, { rowspan: 2 })]),
				[d("12 MR", "808080", "ffffff"), d(f3(fyPrev), "F1F5F9", SCURO)].concat(r12.map(val))
			], B));
		});
		footer(els, img, n);
		return { titolo: "IFI Scorecard", els };
	}

	/* dati per location (YTD) usati dalle slide "IFI and LTI Cases" e "LTI Cases Monthly Comparison" */
	function perLocation(k) {
		return k.locs.map(nome => {
			const ytd = C.ytd(k.dati, "IFI", [nome], k.anno, k.mese);
			const mesi = [];
			for (let i = 0; i <= k.mese; i++) mesi.push(C.somma(k.dati, "LTI", [nome], [{ anno: k.anno, mese: i }]));
			return { nome, lti: ytd.casi, ifi: ytd.valore, mesi };
		});
	}

	const perNome = (a, b) => a.nome.localeCompare(b.nome, "en", { sensitivity: "base" });

	function notaNascoste(els, x, y, w, nascoste) {
		if (nascoste > 0) els.push(T(x, y, w, 0.22, [{ testo: `Not shown: ${nascoste} locations with no LTI YTD (IFI 0,000).`, size: 9, italic: true, color: "64748b" }], { align: "right", valign: "top" }));
	}

	function slideCasi(k, img, n) {
		const els = [];
		const pl = perLocation(k);
		const tutte = pl.length <= MAX_TUTTE;
		const visibili = tutte ? pl : pl.filter(p => p.lti > 0);
		const perLti = visibili.slice().sort((a, b) => (b.lti - a.lti) || perNome(a, b));
		const perIfi = visibili.slice().sort((a, b) => ((b.ifi || 0) - (a.ifi || 0)) || perNome(a, b));
		const tit = k.perimetro === "MFG" ? `${k.cfg.ivg} – IFI and LTI Cases` : "IFI and LTI Cases";
		els.push(titolo(tit, `Results YTD ${numMese(k)}`, 0.4, 0.25, 8, 0.85));
		const molte = visibili.length > 12;
		const gLti = { labels: perLti.map(p => p.nome), valori: perLti.map(p => p.lti), formato: fInt, sizeVal: 11, sizeAsse: molte ? 9 : 10 };
		const gIfi = { labels: perIfi.map(p => p.nome), valori: perIfi.map(p => C.r3(p.ifi)), formato: f3, sizeVal: molte ? 8 : 11, sizeAsse: molte ? 9 : 10 };
		if (k.perimetro === "MFG") {
			els.push(T(0.4, 1.35, 6.2, 0.35, [{ testo: "LTI", size: 18, bold: true, color: SCURO }], { align: "center" }));
			els.push(T(6.8, 1.35, 6.0, 0.35, [{ testo: "IFI", size: 18, bold: true, color: SCURO }], { align: "center" }));
			els.push(I(0.4, 1.75, 6.2, 4.55, graficoLocation(6.2, 4.55, gLti)));
			els.push(I(6.8, 1.75, 6.0, 4.55, graficoLocation(6.0, 4.55, gIfi)));
		} else {
			els.push(T(0.4, 1.1, 12.4, 0.35, [{ testo: "IFI", size: 18, bold: true, color: SCURO }], { align: "center" }));
			els.push(I(0.4, 1.45, 12.4, 2.45, graficoLocation(12.4, 2.45, gIfi)));
			els.push(T(0.4, 3.95, 12.4, 0.35, [{ testo: "LTI", size: 18, bold: true, color: SCURO }], { align: "center" }));
			els.push(I(0.4, 4.3, 12.4, 2.2, graficoLocation(12.4, 2.2, gLti)));
			notaNascoste(els, 6.4, 6.48, 6.4, pl.length - visibili.length);
		}
		footer(els, img, n);
		return { titolo: "IFI and LTI Cases", els };
	}

	function slideMensile(k, img, n) {
		const els = [];
		const pl = perLocation(k);
		const tutte = pl.length <= MAX_TUTTE;
		const visibili = (tutte ? pl : pl.filter(p => p.lti > 0)).sort((a, b) => (b.lti - a.lti) || perNome(a, b));
		els.push(titolo("LTI Cases Monthly Comparison", `Results YTD ${numMese(k)}`, 0.4, 0.25, 8, 0.85));
		els.push(T(0.4, 1.1, 8.5, 0.35, [{ testo: "LTI", size: 18, bold: true, color: SCURO }], { align: "center" }));
		const serie = [];
		for (let i = 0; i <= k.mese; i++) serie.push({ nome: MESI_UP[i], colore: COLORI_MESI[i], data: visibili.map(p => p.mesi[i]) });
		els.push(I(0.4, 1.5, 8.5, 3.85, graficoMensile(8.5, 3.85, { labels: visibili.map(p => p.nome), serie, sizeVal: 9, sizeAsse: 9 })));
		serie.forEach((s, i) => {
			els.push(R(0.4 + i * 0.75, 5.5, 0.18, 0.18, s.colore.replace("#", "")));
			els.push(T(0.6 + i * 0.75, 5.47, 0.55, 0.24, [{ testo: s.nome, size: 10, bold: true, color: SCURO }], { valign: "middle", margine: 0 }));
		});
		if (!tutte) notaNascoste(els, 0.4, 5.85, 8.5, pl.length - visibili.length);

		const ultimo = pl.filter(p => p.mesi[k.mese] > 0).sort((a, b) => (b.mesi[k.mese] - a.mesi[k.mese]) || perNome(a, b));
		els.push(T(9.2, 1.1, 3.6, 0.4, [{ testo: `${MESI_FULL[k.mese]} ${k.anno}`, size: 16, bold: true, color: SCURO }], { align: "center" }));
		if (ultimo.length) {
			els.push(I(9.2, 1.55, 3.6, 3.8, graficoMensile(3.6, 3.8, {
				labels: ultimo.map(p => p.nome), serie: [{ nome: MESI_UP[k.mese], colore: COLORI_MESI[k.mese], data: ultimo.map(p => p.mesi[k.mese]) }], sizeVal: 16, sizeAsse: 9
			})));
		} else {
			els.push(T(9.2, 3, 3.6, 0.4, [{ testo: "No LTI in the month", size: 12, italic: true, color: "64748b" }], { align: "center" }));
		}
		els.push(T(0.4, 6.25, 12.4, 0.22, [{ testo: "LTI (Lost Time Injury):    an Injury which causes the employee to be absent at least one shift", size: 9, color: "404040" }], { valign: "top" }));
		footer(els, img, n);
		return { titolo: "LTI Cases Monthly Comparison", els };
	}

	/* righe Plant/BU: stabilimenti di ogni gruppo, poi il subtotale del gruppo; in fondo il totale MFG */
	function righePerf(k) {
		const righe = [];
		const messi = new Set();
		SEQUENZA_PERF.forEach(g => {
			const locs = k.gruppi[g];
			if (!locs || !locs.length) return;
			locs.forEach(l => { if (!messi.has(l)) { messi.add(l); righe.push({ nome: l, locs: [l], sub: false }); } });
			righe.push({ nome: g, locs, sub: true });
		});
		k.locs.filter(l => !messi.has(l)).forEach(l => righe.push({ nome: l, locs: [l], sub: false }));
		righe.push({ nome: k.cfg.sigla, locs: k.locs, sub: true });
		return righe;
	}

	function slidePerf(k, img, n, tipo) {
		const els = [];
		els.push(titolo(`MFG ${tipo} Plant Performance ${titoloMese(k)}`, "YTD and 12 MR Results vs. Annual Targets", 0.4, 0.2, 7.5, 0.85));
		[["16a34a", "in line with target"], ["eab308", "≤ 20% over target"], ["dc2626", "> 20% over target"]].forEach(([c, t], i) => {
			els.push(R(0.4, 5.2 + i * 0.28, 0.22, 0.22, c));
			els.push(T(0.68, 5.19 + i * 0.28, 2.6, 0.26, [{ testo: t, size: 10, color: SCURO }], { valign: "middle" }));
		});
		const COL = { green: "16a34a", yellow: "eab308", red: "dc2626", none: "f8fafc" };
		const h = (t, fill) => cella(t, { bold: true, color: "ffffff", fill: fill || BLU, size: 9, align: "center" });
		const righe = [[h("Plant/BU"), h(`Target ${k.anno}`), h(`${tipo} 12 MR`), h(`12 MR Vs. TARGET '${aa(k.anno)}`, "1e40af"), h(`${tipo} YTD ${k.anno}`), h(`YTD Vs. TARGET '${aa(k.anno)}`, "1e40af")]];
		const lista = righePerf(k);
		lista.forEach(r => {
			const tgt = k.target(r.nome, tipo);
			const v12 = C.r12(k.dati, tipo, r.locs, k.anno, k.mese).valore;
			const vy = C.ytd(k.dati, tipo, r.locs, k.anno, k.mese).valore;
			const bg = r.sub ? "dbeafe" : "ffffff";
			const d = (t, al) => cella(t, { bold: r.sub, color: SCURO, fill: bg, size: 9, align: al || "center" });
			righe.push([d(r.nome, "left"), d(fTarget(tgt)), d(v12 == null ? "0,000" : f3(v12)), cella("", { fill: COL[C.colore(v12 == null ? 0 : v12, tgt)] }),
				d(vy == null ? "0,000" : f3(vy)), cella("", { fill: COL[C.colore(vy == null ? 0 : vy, tgt)] })]);
		});
		const rowH = Math.min(0.2, (6.45 - 1.1) / righe.length);
		els.push(TB(4.6, 1.1, [2.6, 0.9, 0.9, 1.05, 0.95, 1.05], rowH, righe, { pt: 0.75, colore: "000000" }));
		footer(els, img, n);
		return { titolo: `${tipo} Plant Performance`, els };
	}

	/* ================= costruzione della presentazione ================= */

	function attesa() { return new Promise(r => setTimeout(r, 0)); }

	/* Restituisce { slides, avvisi }. avanzamento(i, totale) viene chiamata dopo ogni slide. */
	async function costruisci(dati, perimetro, anno, mese, testi, img, avanzamento) {
		const k = contesto(dati, perimetro, anno, mese);
		const fasi = perimetro === "MFG"
			? [() => slideCopertina(img, testi), n => slideIfi(k, img, testi, n), n => slideIsi(k, img, testi, n), n => slideTrend(k, img, n),
				n => slideScorecard(k, img, n), n => slideCasi(k, img, n), n => slideMensile(k, img, n), n => slidePerf(k, img, n, "IFI"), n => slidePerf(k, img, n, "ISI")]
			: [() => slideCopertina(img, testi), n => slideIfi(k, img, testi, n), n => slideTrend(k, img, n), n => slideCasi(k, img, n), n => slideMensile(k, img, n)];
		const slides = [];
		for (let i = 0; i < fasi.length; i++) {
			slides.push(fasi[i](i));
			if (avanzamento) avanzamento(i + 1, fasi.length, slides[i]);
			await attesa();
		}
		const avvisi = k.avvisi.slice();
		if (k.targetMancanti.size) avvisi.push(`Target ${anno} mancanti in dbo.SafetyTarget: ${Array.from(k.targetMancanti).join(", ")}.`);
		if (!C.location(dati, anno - 1).length) avvisi.push(`Non ci sono dati del ${anno - 1}: 12MR e confronti con l'anno prima sono incompleti.`);
		return { slides, avvisi };
	}

	/* ================= anteprima HTML ================= */

	function esc(s) {
		return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	const pct = (v, tot) => (v / tot * 100) + "%";
	const fs = pt => `calc(var(--ppi) * ${pt / 72})`;

	function disegnaHtml(slide, box) {
		box.innerHTML = "";
		slide.els.forEach(e => {
			let el;
			const pos = (n) => {
				n.style.left = pct(e.x, 13.333);
				n.style.top = pct(e.y, 7.5);
				if (e.w != null) n.style.width = pct(e.w, 13.333);
				if (e.h != null) n.style.height = pct(e.h, 7.5);
			};
			if (e.t === "rett" || e.t === "ellisse") {
				el = document.createElement("div");
				pos(el);
				if (e.fill) el.style.background = "#" + e.fill;
				if (e.line) el.style.border = `calc(var(--ppi) * ${(e.lineW || 0.75) / 72}) solid #${e.line}`;
				if (e.t === "ellisse") el.style.borderRadius = "50%";
			} else if (e.t === "linea") {
				el = document.createElement("div");
				pos(el);
				el.style.height = "0";
				el.style.borderTop = `max(1px, calc(var(--ppi) * ${e.pt / 72})) solid #${e.colore}`;
			} else if (e.t === "img") {
				el = document.createElement("img");
				el.className = "el-img";
				el.alt = "";
				el.src = e.data;
				pos(el);
			} else if (e.t === "testo") {
				el = document.createElement("div");
				el.className = "el-testo";
				pos(el);
				const m = e.margine === 0 ? 0 : 1;
				el.style.padding = `calc(var(--ppi) * ${0.05 * m}) calc(var(--ppi) * ${0.1 * m})`;
				el.style.justifyContent = e.valign === "middle" ? "center" : e.valign === "bottom" ? "flex-end" : "flex-start";
				el.style.textAlign = e.align || "left";
				const span = r => `<span style="font-size:${fs(r.size || 12)};color:#${r.color || "000000"};${r.bold ? "font-weight:700;" : ""}${r.italic ? "font-style:italic;" : ""}">${esc(r.testo)}</span>`;
				if (e.bullet) {
					el.innerHTML = "<ul>" + e.runs.map(r => `<li style="font-size:${fs(r.size || 12)};color:#${r.color || "000000"}">${span(r)}</li>`).join("") + "</ul>";
				} else {
					el.innerHTML = "<div>" + e.runs.map(r => span(r) + (r.br ? "<br>" : "")).join("") + "</div>";
				}
			} else if (e.t === "tabella") {
				el = document.createElement("table");
				const totW = e.colW.reduce((a, b) => a + b, 0);
				el.style.left = pct(e.x, 13.333);
				el.style.top = pct(e.y, 7.5);
				el.style.width = pct(totW, 13.333);
				const bordo = `max(1px, calc(var(--ppi) * ${e.bordo.pt / 72})) solid #${e.bordo.colore}`;
				const rowH = i => Array.isArray(e.rowH) ? e.rowH[i] : e.rowH;
				el.innerHTML = "<colgroup>" + e.colW.map(w => `<col style="width:${w / totW * 100}%">`).join("") + "</colgroup>" +
					e.righe.map((riga, ri) => `<tr style="height:calc(var(--ppi) * ${rowH(ri)})">` + riga.map(c =>
						`<td${c.colspan ? ` colspan="${c.colspan}"` : ""}${c.rowspan ? ` rowspan="${c.rowspan}"` : ""} style="border:${bordo};background:#${c.fill || "ffffff"};color:#${c.color || "000000"};font-size:${fs(c.size || 10)};text-align:${c.align || "left"};${c.bold ? "font-weight:700;" : ""}">${esc(c.testo).replace(/\n/g, "<br>")}</td>`
					).join("") + "</tr>").join("");
			}
			if (el) box.appendChild(el);
		});
	}

	/* ================= PowerPoint ================= */

	async function esportaPpt(slides, nomeFile) {
		const pptx = new root.PptxGenJS();
		pptx.layout = "LAYOUT_WIDE";
		slides.forEach(s => {
			const sl = pptx.addSlide();
			s.els.forEach(e => {
				if (e.t === "rett" || e.t === "ellisse") {
					sl.addShape(e.t === "rett" ? pptx.ShapeType.rect : pptx.ShapeType.ellipse, {
						x: e.x, y: e.y, w: e.w, h: e.h,
						fill: e.fill ? { color: e.fill } : { type: "none" },
						line: e.line ? { color: e.line, width: e.lineW || 0.75 } : { type: "none" }
					});
				} else if (e.t === "linea") {
					sl.addShape(pptx.ShapeType.line, { x: e.x, y: e.y, w: e.w, h: 0, line: { color: e.colore, width: e.pt } });
				} else if (e.t === "img") {
					sl.addImage({ data: e.data, x: e.x, y: e.y, w: e.w, h: e.h });
				} else if (e.t === "testo") {
					const runs = e.runs.map(r => ({ text: r.testo, options: Object.assign({ fontSize: r.size || 12, bold: !!r.bold, italic: !!r.italic, color: r.color || "000000", breakLine: !!r.br }, e.bullet ? { bullet: true } : {}) }));
					sl.addText(runs, Object.assign({ x: e.x, y: e.y, w: e.w, h: e.h, fontFace: "Calibri", valign: e.valign || "top", align: e.align || "left" }, e.margine === 0 ? { margin: 0 } : {}));
				} else if (e.t === "tabella") {
					const rows = e.righe.map(riga => riga.map(c => ({
						text: c.testo,
						options: Object.assign({ fontFace: "Calibri", fontSize: c.size || 10, bold: !!c.bold, color: c.color || "000000", fill: { color: c.fill || "FFFFFF" }, align: c.align || "left", valign: "middle" },
							c.colspan ? { colspan: c.colspan } : {}, c.rowspan ? { rowspan: c.rowspan } : {})
					})));
					sl.addTable(rows, { x: e.x, y: e.y, w: e.colW.reduce((a, b) => a + b, 0), colW: e.colW, rowH: e.rowH, border: { type: "solid", pt: e.bordo.pt, color: e.bordo.colore }, margin: 0.02 });
				}
			});
		});
		await pptx.writeFile({ fileName: nomeFile });
	}

	/* ================= immagini (copertina e loghi del piè di pagina) ================= */

	function leggiImmagine(url) {
		return fetch(url, { credentials: "same-origin" })
			.then(r => r.ok ? r.blob() : null)
			.then(b => b ? new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(b); }) : null)
			.catch(() => null);
	}

	async function immagini() {
		const [copertina, marchi, gruppo] = await Promise.all([
			leggiImmagine("IMG/Safety/cover-bg.png"), leggiImmagine("IMG/Safety/footer-marchi.png"), leggiImmagine("IMG/Safety/footer-iveco-group.png")
		]);
		return { copertina, marchi, gruppo };
	}

	root.SafetyReport = { AREE_MFG, PERIMETRI, MESI_FULL, costruisci, disegnaHtml, esportaPpt, immagini, leggiImmagine, testiStandard, f3 };
})(this);
