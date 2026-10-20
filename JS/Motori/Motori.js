document.addEventListener("DOMContentLoaded", () => {

	/* File SHOP ORDER e TAG */
	const certificatiFilePath = 'File/Certificati/ShopOrderTOT.xlsx';
	const tagFilePath = 'File/Certificati/TAG.xlsx';

	// Colonne chiave usate per far corrispondere le righe fra i due file
	const CERTIFICATI_KEY_COLUMN = "P/N Motore";
	const TAG_KEY_COLUMN = "Element";

	/* Colonne da leggere da Certificati. Per ora solo la chiave:
	 aggiungi qui le altre colonne mano a mano che ti servono,
	 scrivendo il nome esattamente come compare nell'intestazione Excel.*/
	const certificatiAllowedColumns = ["P/N Motore", "Engine code", "REF. EU FAMILY", "REF. US FAMILY",
		"Application", "Customer Eng.", "Customer",
		"Tipo Motore", "Omologazione", "ENTE", "PRP", "FGF GROUP", "Status",
		CERTIFICATI_KEY_COLUMN
	];

	/* Colonne da leggere da TAG: la chiave + le 3 colonne che formano
	 il dettaglio mostrato all'apertura della riga.*/
	const tagAllowedColumns = [
		TAG_KEY_COLUMN, "VStart", "VEnd", "TagElementDescription"
	];

	/* Colonne che hanno anche il filtro a tendina, oltre alla ricerca testuale.
	 Tutte le altre colonne hanno solo il campo "Cerca...".*/
	const dropdownColumns = ["Customer Eng.", "Customer", "Tipo Motore", "Omologazione", "ENTE", "PRP", "Status"];
	// Versione di questa pagina: viene aggiunta al footer condiviso
	const PAGE_VERSION = "0.2.0";

	/* Il footer viene caricato in modo asincrono dentro #footer-placeholder,
	 quindi si aspetta che compaia e poi ci si inserisce la versione*/
	function addVersionToFooter() {
		const placeholder = document.getElementById("footer-placeholder");
		if (!placeholder) return;

		const tryInsert = () => {
			const container = placeholder.querySelector(".footer-container");
			if (!container) return false;
			if (!container.querySelector(".footer-right")) {
				const right = document.createElement("div");
				right.className = "footer-right";
				right.innerHTML = `<span>Versione ${escapeHtml(PAGE_VERSION)}</span>`;
				container.appendChild(right);
			}
			return true;
		};

		if (tryInsert()) return;
		const observer = new MutationObserver(() => { if (tryInsert()) observer.disconnect(); });
		observer.observe(placeholder, { childList: true, subtree: true });
	}
	addVersionToFooter();

	/* Normalizza una stringa per il confronto: toglie spazi non-interrompibili,
	 comprime spazi multipli, elimina spazi ai bordi, ignora maiuscole/minuscole.
	 Usata sia per i nomi di colonna (es. "Customer Eng. " vs "customer eng.")
	 sia per i valori delle chiavi di match (es. "f1ae..." vs "F1AE...").*/
	function normalizeText(value) {
		return String(value)
			.replace(/\u00A0/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase();
	}

	function escapeHtml(value) {
		return String(value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}


	function formatDateValue(value) {
		if (value instanceof Date && !isNaN(value.getTime())) {
			const dd = String(value.getDate()).padStart(2, "0");
			const mm = String(value.getMonth() + 1).padStart(2, "0");
			const yyyy = value.getFullYear();
			return `${dd}/${mm}/${yyyy}`;
		}
		return (value === undefined || value === null || value === "") ? "" : String(value);
	}

	/* Legge un foglio Excel tenendo solo le colonne presenti in allowedColumnsMap.
	 Stessa logica robusta già usata per Motori: la riga di intestazione è quella
	 con più celle che combaciano con le colonne attese (non "la più piena"),
	 il confronto nomi è tollerante a spazi/maiuscole, e c'è deduplica per
	 evitare due colonne con lo stesso nome.*/
	function parseSheet(worksheet, allowedColumnsMap) {
		const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
		if (!rawRows.length) return { headers: [], tableData: [] };

		let headerIndex = 0, maxMatches = -1;
		rawRows.forEach((row, idx) => {
			const matches = row.filter(c => allowedColumnsMap.has(normalizeText(c))).length;
			if (matches > maxMatches) { maxMatches = matches; headerIndex = idx; }
		});

		const headers = [], validColIndexes = [];
		const seenColumns = new Set();
		rawRows[headerIndex].forEach((h, i) => {
			const canonical = allowedColumnsMap.get(normalizeText(h));
			if (canonical && !seenColumns.has(canonical)) {
				headers.push(canonical);
				validColIndexes.push(i);
				seenColumns.add(canonical);
			}
		});

		const tableData = rawRows.slice(headerIndex + 1).map(row =>
			headers.reduce((acc, h, i) => ({ ...acc, [h]: row[validColIndexes[i]] ?? "" }), {})
		);

		return { headers, tableData };
	}

	function loadExcelFile(filePath) {
		return nextPaint.then(() => fetch(filePath))
			.then(res => {
				if (!res.ok) {
					console.warn(`File non trovato (HTTP ${res.status}): ${filePath}`);
					return null;
				}
				return res.arrayBuffer();
			})
			.then(buffer => buffer ? XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true }) : null)
			.catch(err => {
				console.warn(`Errore durante il caricamento del file ${filePath}:`, err);
				return null;
			});
	}

	const certificatiAllowedColumnsMap = new Map(certificatiAllowedColumns.map(c => [normalizeText(c), c]));
	const tagAllowedColumnsMap = new Map(tagAllowedColumns.map(c => [normalizeText(c), c]));

	const tabsContainer = document.getElementById("tabs-container");
	const gridsWrapper = document.getElementById("grids-wrapper");
	if (!gridsWrapper) return;
	gridsWrapper.innerHTML = "";
	if (tabsContainer) tabsContainer.innerHTML = "";

	// Indicatore "Caricamento": compare subito e sparisce quando la tabella è pronta 
	const loadingIndicator = document.createElement("div");
	loadingIndicator.className = "loading-indicator";
	loadingIndicator.innerHTML = `<div class="loading-spinner"></div><span class="loading-text">Caricamento completo degli SHOP ORDER</span>`;
	gridsWrapper.appendChild(loadingIndicator);

	function hideLoadingIndicator() {
		loadingIndicator.remove();
	}

	/* Lascia al browser il tempo di disegnare l'indicatore prima del lavoro
	 pesante di lettura dei file (altrimenti non si vedrebbe)*/
	const nextPaint = new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

	let selectedCustomers = new Set();
	const columnFilters = {};
	const selectElements = {};
	let certificatiHeaders = [];
	let certificatiTableData = [];
	let table = null;

	// Vista "Per Tag": si parte dai tag e si arriva ai PN
	let activeView = "pn";
	let tagTable = null;
	let tagsIndex = null;
	let certByKey = null;
	let tagSheetName = "";        // nome del foglio del file TAG (è una data)
	let pnGridDiv = null;
	let tagGridDiv = null;
	const searchByView = { pn: "", tag: "", month: "" };

	Promise.all([
		loadExcelFile(certificatiFilePath),
		loadExcelFile(tagFilePath)
	]).then(([certificatiWorkbook, tagWorkbook]) => {
		const missing = [];
		if (!certificatiWorkbook) missing.push(certificatiFilePath);
		if (!tagWorkbook) missing.push(tagFilePath);

		if (missing.length) {
			gridsWrapper.innerHTML = `<div style="padding:20px; color:red; font-weight:bold;">File Excel non trovato: ${missing.map(escapeHtml).join(", ")}. Controlla i percorsi in cima a Certificati.js.</div>`;
			return;
		}

		// Si prende il primo foglio di ciascun file: non serve sapere il nome del foglio
		const certificatiSheet = certificatiWorkbook.Sheets[certificatiWorkbook.SheetNames[0]];
		const tagSheet = tagWorkbook.Sheets[tagWorkbook.SheetNames[0]];
		tagSheetName = String(tagWorkbook.SheetNames[0] ?? "").trim();

		const certificatiParsed = parseSheet(certificatiSheet, certificatiAllowedColumnsMap);
		const tagParsed = parseSheet(tagSheet, tagAllowedColumnsMap);

		if (!certificatiParsed.headers.includes(CERTIFICATI_KEY_COLUMN)) {
			gridsWrapper.innerHTML = `<div style="padding:20px; color:red; font-weight:bold;">Non trovo la colonna chiave "${escapeHtml(CERTIFICATI_KEY_COLUMN)}" nel file Certificati. Controlla il nome dell'intestazione nel file.</div>`;
			return;
		}
		if (!tagParsed.headers.includes(TAG_KEY_COLUMN)) {
			gridsWrapper.innerHTML = `<div style="padding:20px; color:red; font-weight:bold;">Non trovo la colonna chiave "${escapeHtml(TAG_KEY_COLUMN)}" nel file TAG. Controlla il nome dell'intestazione nel file.</div>`;
			return;
		}

		certificatiHeaders = certificatiParsed.headers;
		certificatiTableData = certificatiParsed.tableData;

		/* Raggruppa le righe TAG per chiave: ogni Element può ripetersi,
		 quindi ogni chiave ha un ARRAY di intervalli (VStart/VEnd + descrizione)*/
		const tagByKey = new Map();
		tagsIndex = new Map();
		tagParsed.tableData.forEach(row => {
			const key = normalizeText(row[TAG_KEY_COLUMN]);
			if (!key) return;
			if (!tagByKey.has(key)) tagByKey.set(key, []);
			tagByKey.get(key).push({
				VStart: row["VStart"],
				VEnd: row["VEnd"],
				TagElementDescription: row["TagElementDescription"]
			});

			// Stesso dato visto dal lato del tag: per ogni tag, i PN che lo hanno
			// e gli intervalli di deprecamento di ciascuno
			const tagName = String(row["TagElementDescription"] ?? "").trim();
			if (!tagName) return;
			let byPn = tagsIndex.get(tagName);
			if (!byPn) { byPn = new Map(); tagsIndex.set(tagName, byPn); }
			let entry = byPn.get(key);
			if (!entry) { entry = { pn: String(row[TAG_KEY_COLUMN]).trim(), intervals: [] }; byPn.set(key, entry); }
			entry.intervals.push({ VStart: row["VStart"], VEnd: row["VEnd"] });
		});

		/* Aggancia a ogni riga Certificati l'elenco (eventualmente vuoto)
		 delle corrispondenze trovate in TAG*/
		certificatiTableData.forEach(row => {
			const key = normalizeText(row[CERTIFICATI_KEY_COLUMN]);
			row.__tagMatches = tagByKey.get(key) || [];
		});

		buildTable();
	}).catch(err => {
		console.error("Errore durante la preparazione della tabella:", err);
		gridsWrapper.innerHTML = `<div style="padding:20px; color:red; font-weight:bold;">Errore durante il caricamento dei dati. Dettagli nella console del browser.</div>`;
	});

	// ---- Timeline mesi: da questo mese per TIMELINE_MONTHS mesi ----
	const TIMELINE_MONTHS = 12;
	const MONTH_LABELS = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

	/* Converte VStart/VEnd in Date: accetta Date veri (cellDates), testo
	 aaaa-mm-gg (es. 2022-01-01) oppure gg/mm/aaaa; qualsiasi altra cosa
	 viene trattata come "non indicata"*/
	function toDate(value) {
		if (value instanceof Date && !isNaN(value.getTime())) return value;
		const text = String(value ?? "").trim();

		const iso = text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
		if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

		const dmy = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
		if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));

		return null;
	}

	function getTimelineMonths() {
		const now = new Date();
		const months = [];
		for (let i = 0; i < TIMELINE_MONTHS; i++) {
			const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
			const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
			const label = MONTH_LABELS[start.getMonth()];
			months.push({ label, title: `${label} ${start.getFullYear()}`, start, end });
		}
		return months;
	}

	/* Un mese è "deprecato" se si sovrappone, anche solo in parte, all'intervallo
	 VStart-VEnd. Se manca una delle due date l'intervallo resta aperto da
	 quel lato; se mancano entrambe non si può dire nulla, quindi non deprecato.*/
	function isDeprecatedInMonth(vStart, vEnd, month) {
		const s = toDate(vStart);
		const e = toDate(vEnd);
		if (!s && !e) return false;
		return (!s || s <= month.end) && (!e || e >= month.start);
	}

	/* Riga sotto i mesi con la data di aggiornamento del file TAG
	 (il nome del foglio del file TAG è sempre una data)*/
	function buildTagUpdatedNote() {
		if (!tagSheetName) return "";
		return `<div class="cert-tag-updated">Nessun TAG VUOTO trovato. File dei TAG aggiornato al "${escapeHtml(tagSheetName)}"</div>`;
	}

	function buildDetailPanel(tagMatches) {
		const panel = document.createElement("div");
		panel.className = "cert-detail-panel";

		const months = getTimelineMonths();
		const monthHeaders = months.map(mo => `<th class="cert-month-col" title="${mo.title}">${mo.label}</th>`).join("");

		// Nessun TAG per questo PN: solo la barra dei 12 mesi, tutta verde
		if (!tagMatches || !tagMatches.length) {
			const okCells = months.map(mo =>
				`<td class="cert-month-col" title="${mo.title}"><div class="cert-month-bar cert-month-bar--ok"></div></td>`
			).join("");

			panel.innerHTML = `
				<table class="cert-detail-table">
					<thead>
						<tr>${monthHeaders}</tr>
					</thead>
					<tbody>
						<tr>${okCells}</tr>
					</tbody>
				</table>
				${buildTagUpdatedNote()}
			`;
			return panel;
		}

		const rowsHtml = tagMatches.map(m => {
			const monthCells = months.map(mo =>
				`<td class="cert-month-col" title="${mo.title}"><div class="cert-month-bar ${isDeprecatedInMonth(m.VStart, m.VEnd, mo) ? "cert-month-bar--deprecated" : "cert-month-bar--ok"}"></div></td>`
			).join("");

			return `
			<tr>
				<td>${escapeHtml(m.TagElementDescription ?? "")}</td>
				<td>${escapeHtml(formatDateValue(m.VStart))}</td>
				<td>${escapeHtml(formatDateValue(m.VEnd))}</td>
				${monthCells}
			</tr>
		`;
		}).join("");

		panel.innerHTML = `
			<table class="cert-detail-table">
				<thead>
					<tr><th>Tag</th><th>Inizio Deprecamento</th><th>Fine Deprecamento</th>${monthHeaders}</tr>
				</thead>
				<tbody>${rowsHtml}</tbody>
			</table>
			${buildTagUpdatedNote()}
		`;
		return panel;
	}

	function customHybridFilter(cell, onRendered, success) {
		const field = cell.getColumn().getField();
		const container = document.createElement("div");
		container.style.cssText = "display:flex; gap:0; width:100%; box-sizing:border-box;";

		const hasDropdown = dropdownColumns.includes(field);
		let select = null;
		if (hasDropdown) {
			select = document.createElement("select");
			select.style.cssText = "padding:4px 2px; font-size:12px; border:1px solid #ccc; border-right:none; border-radius:4px 0 0 4px; background:#f9f9f9; cursor:pointer; max-width:70px; outline:none;";
			selectElements[field] = select;
		}

		const input = document.createElement("input");
		input.type = "text";
		input.placeholder = "Cerca...";
		input.style.cssText = hasDropdown
			? "flex:1; min-width:0; padding:4px 6px; font-size:12px; border:1px solid #ccc; border-radius:0 4px 4px 0; outline:none;"
			: "flex:1; min-width:0; padding:4px 6px; font-size:12px; border:1px solid #ccc; border-radius:4px; outline:none;";

		if (select) container.append(select, input);
		else container.append(input);

		/* Filtro passa sempre
		 da applyCombinedFilters()+table.setFilter(), non dal sistema
		 nativo headerFilter di Tabulator.*/
		let filterDebounceTimer = null;

		if (select) select.onchange = () => {
			input.value = select.value;
			// Scelta dal menu: corrispondenza esatta (solo "IVECO", non "IVECO BUS")
			columnFilters[field] = { value: input.value, exact: true };
			applyCombinedFilters();
		};
		input.oninput = () => {
			/* Testo digitato: ricerca "contiene". Il menu torna su "Tutti", così
			 scegliere poi un valore dal menu fa sempre scattare il filtro esatto
			 (riselezionare lo stesso valore già mostrato non genererebbe nessun evento)*/
			if (select) select.value = "";
			columnFilters[field] = { value: input.value, exact: false };
			clearTimeout(filterDebounceTimer);
			filterDebounceTimer = setTimeout(applyCombinedFilters, 300);
		};

		return container;
	}

	function updateDropdownOptions(activeData) {
		certificatiHeaders.forEach(header => {
			const select = selectElements[header];
			if (!select) return;

			const currentVal = select.value;
			const visibleValues = [...new Set(activeData.map(d => String(d[header] || "").trim()))].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

			select.innerHTML = '<option value="">Tutti</option>' + visibleValues.map(v => `<option value="${v}">${v}</option>`).join("");
			select.value = visibleValues.includes(currentVal) ? currentVal : "";
		});
	}

	function buildTable() {
		const gridDiv = document.createElement("div");
		gridDiv.className = "tab-grid";
		gridsWrapper.appendChild(gridDiv);
		pnGridDiv = gridDiv;

		table = new Tabulator(gridDiv, {
			data: certificatiTableData,
			columns: [
				{
					title: "",
					field: "__expand",
					width: 36,
					headerSort: false,
					formatter: () => `<span class="cert-expand-icon">▸</span>`
				},
				...certificatiHeaders.map(h => ({ title: h, field: h, headerFilter: customHybridFilter, minWidth: 170, sorter: "string" }))
			],
			layout: "fitDataFill",
			pagination: "local",
			paginationSize: 25,
			// Render reale non virutale
			nestedFieldSeparator: false,
			rowFormatter: function (row) {
				const el = row.getElement();
				if (el.querySelector(".cert-detail-panel")) return;
				const panel = buildDetailPanel(row.getData().__tagMatches);
				el.appendChild(panel);
			},
		});

		// Tabulator v5: i callback si registrano con table.on(), non come opzioni
		table.on("rowClick", function (e, row) {
			/* non chiudere la riga se si clicca dentro il pannello
			 di dettaglio (es. per selezionare un testo)*/
			if (e.target.closest(".cert-detail-panel")) return;
			row.getElement().classList.toggle("cert-row-expanded");
			// Dopo un filtro Tabulator fissa l'altezza del contenitore interno a quella
			// delle righe visibili: ricalcolarla fa comparire (o sparire) il pannello
			table.redraw();
		});

		table.on("tableBuilt", () => updateDropdownOptions(certificatiTableData));
		table.on("tableBuilt", hideLoadingIndicator);
		table.on("renderComplete", hideLoadingIndicator);
		table.on("dataFiltered", (filters, rows) => updateDropdownOptions(rows.map(r => r.getData())));

		setupCustomerDropdown();
		multiFilters.forEach(setupMultiFilter);
		createTabs();
	}

	/* ================= Vista "Per Tag" =================
	 Righe = tag (ricercabili con la casella in alto). Aprendo un tag si vedono
	 i mesi (rosso se almeno un PN è deprecato in quel mese, verde se nessuno);
	 cliccando un mese si apre l'elenco dei PN con le colonne di Certificati.*/

	const TAG_LIST_PAGE = 100; // PN mostrati per volta nell'elenco di un mese
	const TAG_LIST_MAX_OPTIONS = 500; // oltre questi valori distinti il menu a tendina di colonna non viene creato
	const listCollator = new Intl.Collator("it", { numeric: true, sensitivity: "base" }); // ordina "T2" prima di "T10"
	const searchPlaceholderPn = document.getElementById("global-search")?.placeholder || "";

	function createTabs() {
		if (!tabsContainer) return;
		tabsContainer.innerHTML = "";
		[{ id: "pn", label: "Per PN Motore" }, { id: "tag", label: "Per Tag" }, { id: "month", label: "Per Mese" }].forEach(t => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "tab-btn" + (t.id === activeView ? " active" : "");
			btn.dataset.view = t.id;
			btn.textContent = t.label;
			btn.onclick = () => switchView(t.id);
			tabsContainer.appendChild(btn);
		});
	}

	function switchView(view) {
		if (view === activeView) return;
		const firstTagOpen = view === "tag" && !tagTable; // la tabella sta per essere creata
		const searchInput = document.getElementById("global-search");
		if (searchInput) searchByView[activeView] = searchInput.value; // ogni scheda ricorda la sua ricerca
		activeView = view;
		tabsContainer.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));

		pnGridDiv.style.display = view === "pn" ? "" : "none";
		if (view === "tag") ensureTagTable();
		if (view === "month") ensureMonthView();
		if (tagGridDiv) tagGridDiv.style.display = view === "tag" ? "" : "none";
		if (monthViewDiv) monthViewDiv.style.display = view === "month" ? "" : "none";

		if (searchInput) {
			searchInput.value = searchByView[view];
			// nelle schede Per Tag e Per Mese la casella cerca fra i nomi dei tag
			searchInput.placeholder = view === "pn" ? searchPlaceholderPn : "🔍 Cerca un tag...";
		}
		// il filtro Customer riguarda solo i PN
		if (multiselectContainer) multiselectContainer.style.display = view === "pn" ? "" : "none";
		refreshMultiFiltersVisibility(); // anche quelli per Ref. US/EU Family
		// alla prima apertura la tabella dei tag è appena nata (e Tabulator non ha finito di costruirla): niente redraw
		// la scheda Per Mese non ha una tabella Tabulator da ridisegnare
		if (!firstTagOpen && view !== "month") (view === "pn" ? table : tagTable).redraw();
	}

	function ensureTagTable() {
		if (tagTable) return;
		tagGridDiv = document.createElement("div");
		tagGridDiv.className = "tab-grid";
		gridsWrapper.appendChild(tagGridDiv);

		const data = [...tagsIndex.entries()]
			.map(([tag, byPn]) => ({ Tag: tag, pnCount: byPn.size }))
			.sort((a, b) => a.Tag.localeCompare(b.Tag, undefined, { sensitivity: "base", numeric: true }));

		tagTable = new Tabulator(tagGridDiv, {
			data,
			columns: [
				{ title: "", field: "__expand", width: 36, headerSort: false, formatter: () => `<span class="cert-expand-icon">▸</span>` },
				{ title: "Tag", field: "Tag", minWidth: 220, sorter: "string" },
				{ title: "N° PN", field: "pnCount", width: 130, sorter: "number" }
			],
			layout: "fitDataFill",
			pagination: "local",
			paginationSize: 25,
			nestedFieldSeparator: false,
			rowFormatter: function (row) {
				const el = row.getElement();
				if (el.querySelector(".cert-detail-panel")) return;
				const panel = document.createElement("div");
				panel.className = "cert-detail-panel tag-panel";
				panel.dataset.tag = row.getData().Tag;
				el.appendChild(panel);
				// contenuto costruito solo quando la riga si apre (vedi rowClick)
				if (el.classList.contains("cert-row-expanded")) fillTagPanel(panel);
			}
		});

		tagTable.on("rowClick", function (e, row) {
			if (e.target.closest(".cert-detail-panel")) return;
			const el = row.getElement();
			if (el.classList.toggle("cert-row-expanded")) fillTagPanel(el.querySelector(".tag-panel"));
			redrawTagTable(); // ricalcola l'altezza dopo l'apertura/chiusura
		});
	}

	// Ricerca globale della scheda "Per Tag": filtra i tag (contiene, senza distinguere maiuscole)
	function applyTagFilter() {
		if (!tagTable) return;
		const val = document.getElementById("global-search")?.value.toLowerCase().trim() || "";
		if (!val) return tagTable.clearFilter();
		tagTable.setFilter(data => String(data.Tag).toLowerCase().includes(val));
	}

	// Come isDeprecatedInMonth, ma con le date convertite una sola volta e tenute nell'intervallo
	function intervalHitsMonth(iv, month) {
		if (iv.s === undefined) { iv.s = toDate(iv.VStart); iv.e = toDate(iv.VEnd); }
		if (!iv.s && !iv.e) return false;
		return (!iv.s || iv.s <= month.end) && (!iv.e || iv.e >= month.start);
	}

	function getCertByKey() {
		if (!certByKey) {
			certByKey = new Map();
			for (const row of certificatiTableData) {
				const k = normalizeText(row[CERTIFICATI_KEY_COLUMN]);
				if (k && !certByKey.has(k)) certByKey.set(k, row);
			}
		}
		return certByKey;
	}

	/* Stato di un tag: i suoi PN, i 12 mesi e, per ogni mese, i PN deprecati (con l'intervallo
	 che li copre). Lo usano sia la scheda Per Tag sia la scheda Per Mese.*/
	function makeTagState(tag) {
		const byPn = tagsIndex.get(tag);
		const months = getTimelineMonths();
		const total = byPn.size;

		// per ogni mese: i PN di questo tag deprecati in quel mese (con l'intervallo che li copre)
		const deprecated = months.map(() => []);
		for (const [key, entry] of byPn) {
			months.forEach((mo, i) => {
				const iv = entry.intervals.find(x => intervalHitsMonth(x, mo));
				if (iv) deprecated[i].push({ key, entry, iv });
			});
		}
		return { byPn, months, deprecated, total, selected: null, items: [], shown: 0, isRed: false };
	}

	function fillTagPanel(panel) {
		if (!panel || panel._tag) return;
		const tag = panel.dataset.tag;
		panel._tag = makeTagState(tag);
		const { months, deprecated, total } = panel._tag;

		const heads = months.map(mo => `<th class="cert-month-col" title="${mo.title}">${mo.label}</th>`).join("");
		const cells = months.map((mo, i) => {
			const n = deprecated[i].length;
			const tip = n ? `${mo.title}: ${n} PN deprecati su ${total}` : `${mo.title}: nessun PN deprecato (${total} PN)`;
			return `<td class="cert-month-col"><div class="tag-month-btn" role="button" data-month="${i}" title="${escapeHtml(tip)}">`
				+ `<div class="cert-month-bar ${n === 0 ? "cert-month-bar--ok" : (n === total ? "cert-month-bar--deprecated" : "cert-month-bar--mixed")}"></div>`
				+ `<span class="tag-month-count">${n}/${total}</span></div></td>`;
		}).join("");

		panel.innerHTML = `
			<table class="cert-detail-table tag-month-table">
				<thead><tr>${heads}</tr></thead>
				<tbody><tr>${cells}</tr></tbody>
			</table>
			<div class="tag-pn-list"></div>
		`;

		attachTagListHandlers(panel);
	}

	/* Clic su mese / intestazioni / "Mostra altri" e filtri dell'elenco PN di un pannello tag:
	 gli stessi per la scheda Per Tag e per i tag aperti nella scheda Per Mese*/
	function attachTagListHandlers(panel) {
		panel.addEventListener("click", e => {
			const monthBtn = e.target.closest(".tag-month-btn");
			if (monthBtn) return selectTagMonth(panel, Number(monthBtn.dataset.month));
			const sortTh = e.target.closest(".tag-sort-th");
			if (sortTh) return sortTagList(panel, Number(sortTh.dataset.col));
			if (e.target.closest(".tag-more-btn")) appendTagItems(panel);
		});
		// filtri dell'elenco PN: testo (contiene, con piccolo ritardo) e menu a tendina (esatto)
		panel.addEventListener("input", e => {
			const input = e.target.closest(".tag-list-filter-input");
			if (input) onTagFilterInput(panel, input);
		});
		panel.addEventListener("change", e => {
			const select = e.target.closest(".tag-list-filter-select");
			if (select) onTagFilterSelect(panel, select);
		});
	}

	/* Ridisegna la tabella dei tag senza far perdere il focus alla casella in cui si sta scrivendo
	 (Tabulator stacca e riattacca le righe, e il browser toglierebbe il focus al filtro)*/
	function redrawTagTable() {
		if (!tagTable || activeView === "month") return; // nella scheda Per Mese l'elenco PN è HTML normale
		const active = document.activeElement;
		const inPanel = active && active.closest && active.closest(".tag-panel");
		const caret = inPanel && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
		tagTable.redraw();
		if (inPanel && document.body.contains(active)) {
			active.focus();
			if (caret) { try { active.setSelectionRange(caret[0], caret[1]); } catch (err) { /* campo senza selezione */ } }
		}
	}

	// Colonne dell'elenco PN: stato (rosso/verde), le colonne di Certificati, le due date
	function tagListColumns() {
		return [
			{ id: "__status", label: "", kind: "status" },
			...certificatiHeaders.map(h => ({ id: h, label: h, kind: "text", dropdown: dropdownColumns.includes(h) })),
			{ id: "__start", label: "Inizio Deprecamento", kind: "date" },
			{ id: "__end", label: "Fine Deprecamento", kind: "date" }
		];
	}

	// Valore (testo) di una cella dell'elenco, usato per mostrarla, filtrarla e ordinarla
	function tagItemValue(item, col) {
		if (col.id === "__status") return item.iv ? "Deprecato" : "Non deprecato";
		if (col.id === "__start") return item.iv ? formatDateValue(item.iv.VStart) : "";
		if (col.id === "__end") return item.iv ? formatDateValue(item.iv.VEnd) : "";
		return String(item.cert ? (item.cert[col.id] ?? "") : (col.id === CERTIFICATI_KEY_COLUMN ? item.entry.pn : ""));
	}

	function tagItemDateKey(item, col) {
		if (!item.iv) return -Infinity;
		const d = toDate(col.id === "__start" ? item.iv.VStart : item.iv.VEnd);
		return d ? d.getTime() : -Infinity;
	}

	function compareTagItems(col, dir) {
		const sign = dir === "desc" ? -1 : 1;
		if (col.kind === "status") return (a, b) => sign * ((a.iv ? 0 : 1) - (b.iv ? 0 : 1));
		if (col.kind === "date") return (a, b) => sign * (tagItemDateKey(a, col) - tagItemDateKey(b, col) || 0);
		return (a, b) => sign * listCollator.compare(tagItemValue(a, col), tagItemValue(b, col));
	}

	// Ordine di partenza: prima i PN deprecati, poi gli altri; dentro ogni gruppo per PN
	function defaultTagOrder(a, b) {
		return ((a.iv ? 0 : 1) - (b.iv ? 0 : 1)) || (a.entry.pn < b.entry.pn ? -1 : a.entry.pn > b.entry.pn ? 1 : 0);
	}

	function tagFilterControl(st, col, ci) {
		if (col.kind === "status") {
			return `<select class="tag-list-filter-select" data-col="${ci}"><option value="">Tutti</option><option value="Deprecato">Deprecati</option><option value="Non deprecato">Non deprecati</option></select>`;
		}
		const input = `<input type="text" class="tag-list-filter-input" data-col="${ci}" placeholder="Cerca...">`;
		if (!col.dropdown) return input;

		const distinct = new Set();
		for (const item of st.base) {
			const v = tagItemValue(item, col).trim();
			if (v) distinct.add(v);
		}
		if (distinct.size > TAG_LIST_MAX_OPTIONS) return input;
		const options = [...distinct].sort(listCollator.compare).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
		return `<div class="tag-filter-combo"><select class="tag-list-filter-select" data-col="${ci}"><option value="">Tutti</option>${options}</select>${input}</div>`;
	}

	function selectTagMonth(panel, i) {
		const st = panel._tag;
		const listEl = panel.querySelector(".tag-pn-list");
		const closing = st.selected === i; // secondo click sullo stesso mese: chiude l'elenco
		panel.querySelectorAll(".tag-month-btn").forEach(b => b.classList.toggle("is-selected", !closing && Number(b.dataset.month) === i));

		if (closing) {
			st.selected = null;
			clearTimeout(st.filterTimer);
			listEl.innerHTML = "";
			redrawTagTable();
			return;
		}

		st.selected = i;
		const mo = st.months[i];
		const dep = st.deprecated[i];
		st.isRed = dep.length > 0;

		// Tutti i PN del tag, ognuno col suo stato in questo mese (rosso = deprecato, verde = no)
		const certMap = getCertByKey();
		const depIv = new Map(dep.map(d => [d.key, d.iv]));
		const base = [...st.byPn].map(([key, entry]) => ({ key, entry, iv: depIv.get(key) || null, cert: certMap.get(key) || null }));
		base.sort(defaultTagOrder);

		// ogni mese riparte da zero: nessun filtro, ordine di partenza
		clearTimeout(st.filterTimer);
		st.base = base;
		st.items = base;
		st.shown = 0;
		st.cols = tagListColumns();
		st.filters = {};
		st.sort = null;

		const title = st.isRed
			? `${mo.title}: ${dep.length} PN deprecati su ${st.total}`
			: `${mo.title}: nessun PN deprecato (${st.total} PN)`;
		const sortHeads = st.cols.map((c, ci) =>
			`<th class="tag-sort-th${c.kind === "status" ? " cert-month-col" : ""}" data-col="${ci}" title="Clicca per ordinare">${escapeHtml(c.label)}<span class="tag-sort-ind"></span></th>`
		).join("");
		const filterHeads = st.cols.map((c, ci) => `<th class="tag-filter-th">${tagFilterControl(st, c, ci)}</th>`).join("");

		listEl.innerHTML = `
			<p class="tag-pn-title">${escapeHtml(title)}<span class="tag-pn-filtered"></span></p>
			<div class="tag-pn-scroll">
				<table class="cert-detail-table tag-pn-table">
					<thead>
						<tr class="tag-sort-row">${sortHeads}</tr>
						<tr class="tag-filter-row">${filterHeads}</tr>
					</thead>
					<tbody></tbody>
				</table>
			</div>
			<button type="button" class="tag-more-btn" hidden></button>
		`;
		appendTagItems(panel);
	}

	// Applica filtri e ordinamento correnti alla lista completa e ricomincia dalla prima pagina
	function applyTagListView(panel) {
		const st = panel._tag;
		const active = Object.entries(st.filters)
			.filter(([, f]) => f.value && f.value.trim())
			.map(([ci, f]) => [st.cols[Number(ci)], f.value.trim(), f.value.trim().toLowerCase(), f.exact]);

		let items = st.base;
		if (active.length) {
			items = items.filter(item => active.every(([col, v, vLower, exact]) => {
				const cell = tagItemValue(item, col);
				return exact ? cell.trim() === v : cell.toLowerCase().includes(vLower);
			}));
		}
		if (st.sort) items = items.slice().sort(compareTagItems(st.cols[st.sort.col], st.sort.dir));

		st.items = items;
		st.shown = 0;
		appendTagItems(panel);
	}

	function sortTagList(panel, ci) {
		const st = panel._tag;
		const dir = st.sort && st.sort.col === ci && st.sort.dir === "asc" ? "desc" : "asc";
		st.sort = { col: ci, dir };
		panel.querySelectorAll(".tag-sort-th").forEach(th => {
			const current = Number(th.dataset.col) === ci;
			th.classList.toggle("is-asc", current && dir === "asc");
			th.classList.toggle("is-desc", current && dir === "desc");
		});
		applyTagListView(panel);
	}

	function onTagFilterInput(panel, input) {
		const st = panel._tag;
		const select = input.parentElement.querySelector(".tag-list-filter-select");
		if (select) select.value = ""; // testo digitato: ricerca "contiene", il menu torna su "Tutti"
		st.filters[Number(input.dataset.col)] = { value: input.value, exact: false };
		clearTimeout(st.filterTimer);
		st.filterTimer = setTimeout(() => applyTagListView(panel), 250);
	}

	function onTagFilterSelect(panel, select) {
		const st = panel._tag;
		const input = select.parentElement.querySelector(".tag-list-filter-input");
		if (input) input.value = select.value;
		st.filters[Number(select.dataset.col)] = { value: select.value, exact: true }; // scelta dal menu: esatta
		applyTagListView(panel);
	}

	function appendTagItems(panel) {
		const st = panel._tag;
		const tbody = panel.querySelector(".tag-pn-table tbody");
		const moreBtn = panel.querySelector(".tag-more-btn");
		if (st.shown === 0) tbody.innerHTML = "";

		const chunk = st.items.slice(st.shown, st.shown + TAG_LIST_PAGE);
		const rows = chunk.map(item => {
			const tds = st.cols.map(col => col.kind === "status"
				? `<td class="cert-month-col"><div class="cert-month-bar ${item.iv ? "cert-month-bar--deprecated" : "cert-month-bar--ok"}"></div></td>`
				: `<td>${escapeHtml(tagItemValue(item, col))}</td>`
			).join("");
			return `<tr${item.cert ? "" : ' class="tag-pn-missing" title="PN non presente in Certificati"'}>${tds}</tr>`;
		}).join("");
		tbody.insertAdjacentHTML("beforeend", rows);
		if (!st.items.length) {
			tbody.innerHTML = `<tr><td class="tag-pn-none" colspan="${st.cols.length}">Nessun PN corrisponde ai filtri</td></tr>`;
		}

		st.shown += chunk.length;
		const remaining = st.items.length - st.shown;
		moreBtn.hidden = remaining <= 0;
		moreBtn.textContent = `Mostra altri (${Math.min(TAG_LIST_PAGE, remaining)} di ${remaining} rimasti)`;

		const filteredEl = panel.querySelector(".tag-pn-filtered");
		if (filteredEl) filteredEl.textContent = st.items.length === st.base.length ? "" : ` — filtrati: ${st.items.length} su ${st.base.length}`;

		redrawTagTable();
	}

	/* ================= Vista "Per Mese" =================
	 In alto i 12 mesi (la stessa barra del dettaglio PN e della scheda Per Tag).
	 Il colore di un mese è quello dei suoi TAG (ognuno è verde, rosso o a strisce come nella scheda Per Tag):
	 verde se sono tutti verdi, rosso se sono tutti rossi, verde a strisce rosse in tutti gli altri casi.
	 Cliccando un mese si apre l'elenco dei TAG (ognuno col suo colore: quanti dei suoi PN
	 sono deprecati); cliccando un tag si apre l'elenco dei suoi PN, lo stesso della scheda Per Tag.*/

	let monthViewDiv = null;
	let monthStats = null;   // calcolato una volta sola, alla prima apertura della scheda
	let monthState = null;   // elenco dei tag del mese aperto (filtri, ordine, righe mostrate)

	function monthBarClass(n, total) {
		return n === 0 ? "cert-month-bar--ok" : (n === total ? "cert-month-bar--deprecated" : "cert-month-bar--mixed");
	}

	function monthTagState(item) {
		return item.n === 0 ? "Non deprecato" : (item.n === item.total ? "Deprecato" : "Parziale");
	}

	/* Per ogni tag e per ognuno dei 12 mesi: quanti PN sono deprecati.
	 Per ogni mese: quanti tag hanno almeno un PN deprecato (hit) e quanti li hanno deprecati tutti (full).*/
	function getMonthStats() {
		if (monthStats) return monthStats;
		const months = getTimelineMonths();
		const tags = [];
		for (const [tag, byPn] of tagsIndex) {
			const counts = months.map(() => 0);
			for (const entry of byPn.values()) {
				months.forEach((mo, i) => {
					if (entry.intervals.some(iv => intervalHitsMonth(iv, mo))) counts[i]++;
				});
			}
			tags.push({ tag, total: byPn.size, counts });
		}
		tags.sort((a, b) => listCollator.compare(a.tag, b.tag));
		const hit = months.map((mo, i) => tags.reduce((acc, t) => acc + (t.counts[i] > 0 ? 1 : 0), 0));
		const full = months.map((mo, i) => tags.reduce((acc, t) => acc + (t.counts[i] > 0 && t.counts[i] === t.total ? 1 : 0), 0));
		monthStats = { months, tags, hit, full };
		return monthStats;
	}

	// colore del mese: verde se nessun tag ha PN deprecati, rosso se ogni tag li ha deprecati tutti, altrimenti a strisce
	function monthColorClass(stats, i) {
		const totalTags = stats.tags.length;
		return stats.hit[i] === 0 ? "cert-month-bar--ok" : (stats.full[i] === totalTags ? "cert-month-bar--deprecated" : "cert-month-bar--mixed");
	}

	function ensureMonthView() {
		if (monthViewDiv) return;
		const stats = getMonthStats();
		const totalTags = stats.tags.length;

		monthViewDiv = document.createElement("div");
		monthViewDiv.className = "month-view";
		gridsWrapper.appendChild(monthViewDiv);

		const heads = stats.months.map(mo => `<th class="cert-month-col" title="${mo.title}">${mo.label}</th>`).join("");
		const cells = stats.months.map((mo, i) => {
			const n = stats.hit[i];
			const tip = n ? `${mo.title}: ${n} tag con PN deprecati su ${totalTags} (${stats.full[i]} con tutti i PN deprecati)` : `${mo.title}: nessun tag con PN deprecati (${totalTags} tag)`;
			return `<td class="cert-month-col"><div class="tag-month-btn" role="button" data-month="${i}" title="${escapeHtml(tip)}">`
				+ `<div class="cert-month-bar ${monthColorClass(stats, i)}"></div>`
				+ `<span class="tag-month-count">${n}/${totalTags}</span></div></td>`;
		}).join("");

		monthViewDiv.innerHTML = `
			<table class="cert-detail-table tag-month-table month-bar-table">
				<thead><tr>${heads}</tr></thead>
				<tbody><tr>${cells}</tr></tbody>
			</table>
			${tagSheetName ? `<div class="cert-tag-updated">File dei TAG aggiornato al "${escapeHtml(tagSheetName)}"</div>` : ""}
			<div class="month-tag-list"></div>
		`;

		monthViewDiv.addEventListener("click", onMonthViewClick);
		// filtri dell'elenco dei tag: testo (contiene, con piccolo ritardo) e menu dello stato (esatto)
		monthViewDiv.addEventListener("input", e => {
			const input = e.target.closest(".month-filter-input");
			if (!input || !monthState) return;
			monthState.filters[input.dataset.col] = input.value;
			clearTimeout(monthState.filterTimer);
			monthState.filterTimer = setTimeout(applyMonthList, 250);
		});
		monthViewDiv.addEventListener("change", e => {
			const select = e.target.closest(".month-filter-select");
			if (!select || !monthState) return;
			monthState.filters[select.dataset.col] = select.value;
			applyMonthList();
		});
	}

	function onMonthViewClick(e) {
		const monthBtn = e.target.closest(".month-bar-table .tag-month-btn");
		if (monthBtn) return selectMonth(Number(monthBtn.dataset.month));
		const sortTh = e.target.closest(".month-sort-th");
		if (sortTh) return sortMonthList(sortTh.dataset.col);
		if (e.target.closest(".month-more-btn")) return appendMonthTags();
		const row = e.target.closest(".month-tag-row");
		if (row) return toggleMonthTag(row);
	}

	function selectMonth(i) {
		const stats = getMonthStats();
		const listEl = monthViewDiv.querySelector(".month-tag-list");
		const closing = !!monthState && monthState.selected === i; // secondo clic sullo stesso mese: chiude l'elenco
		monthViewDiv.querySelectorAll(".month-bar-table .tag-month-btn").forEach(b =>
			b.classList.toggle("is-selected", !closing && Number(b.dataset.month) === i));

		if (monthState) clearTimeout(monthState.filterTimer);
		if (closing) {
			monthState = null;
			listEl.innerHTML = "";
			return;
		}

		const mo = stats.months[i];
		// tutti i tag, ognuno col numero dei suoi PN deprecati in questo mese; prima quelli colpiti
		const base = stats.tags.map(t => ({ tag: t.tag, total: t.total, n: t.counts[i] }));
		base.sort((a, b) => ((a.n > 0 ? 0 : 1) - (b.n > 0 ? 0 : 1)) || listCollator.compare(a.tag, b.tag));
		monthState = { selected: i, month: mo, base, items: base, shown: 0, filters: {}, sort: null, filterTimer: null };

		const title = stats.hit[i]
			? `${mo.title}: ${stats.hit[i]} tag con PN deprecati su ${stats.tags.length} (${stats.full[i]} con tutti i PN deprecati)`
			: `${mo.title}: nessun tag con PN deprecati (${stats.tags.length} tag)`;
		const sortTh = (col, label, extra) =>
			`<th class="tag-sort-th month-sort-th${extra || ""}" data-col="${col}" title="Clicca per ordinare">${label}<span class="tag-sort-ind"></span></th>`;
		// larghezze fisse (vedi il CSS): così l'elenco dei PN aperto sotto un tag, che è molto largo, scorre da solo e non allarga questa tabella

		listEl.innerHTML = `
			<p class="tag-pn-title">${escapeHtml(title)}<span class="month-tag-filtered"></span></p>
			<div class="tag-pn-scroll">
				<table class="cert-detail-table month-tag-table">
					<thead>
						<tr class="tag-sort-row">
							<th class="month-col-open"></th>
							${sortTh("state", "Stato", " month-col-state")}
							${sortTh("tag", "Tag", " month-col-tag")}
							${sortTh("total", "N° PN", " month-col-num")}
							${sortTh("n", "PN deprecati", " month-col-num")}
							<th></th>
						</tr>
						<tr class="tag-filter-row">
							<th></th>
							<th><select class="tag-list-filter-select month-filter-select" data-col="state"><option value="">Tutti</option><option value="Deprecato">Deprecati</option><option value="Parziale">Parziali</option><option value="Non deprecato">Non deprecati</option></select></th>
							<th><input type="text" class="tag-list-filter-input month-filter-input" data-col="tag" placeholder="Cerca..."></th>
							<th></th>
							<th></th>
							<th></th>
						</tr>
					</thead>
					<tbody></tbody>
				</table>
			</div>
			<button type="button" class="tag-more-btn month-more-btn" hidden></button>
		`;
		applyMonthList(); // tiene conto anche del testo già scritto nella casella di ricerca in alto
	}

	function compareMonthItems(col, dir) {
		const sign = dir === "desc" ? -1 : 1;
		const rank = it => it.n === it.total && it.n > 0 ? 0 : (it.n > 0 ? 1 : 2); // deprecato, parziale, non deprecato
		const byName = (a, b) => listCollator.compare(a.tag, b.tag);
		if (col === "state") return (a, b) => sign * (rank(a) - rank(b)) || byName(a, b);
		if (col === "total") return (a, b) => sign * (a.total - b.total) || byName(a, b);
		if (col === "n") return (a, b) => sign * (a.n - b.n) || byName(a, b);
		return (a, b) => sign * byName(a, b);
	}

	// Applica ricerca in alto, filtri dell'intestazione e ordine, e riparte dalla prima pagina
	function applyMonthList() {
		const st = monthState;
		if (!st) return;
		const globalText = (document.getElementById("global-search")?.value || "").toLowerCase().trim();
		const tagText = (st.filters.tag || "").toLowerCase().trim();
		const stateValue = st.filters.state || "";

		let items = st.base.filter(it =>
			(!globalText || it.tag.toLowerCase().includes(globalText)) &&
			(!tagText || it.tag.toLowerCase().includes(tagText)) &&
			(!stateValue || monthTagState(it) === stateValue)
		);
		if (st.sort) items = items.slice().sort(compareMonthItems(st.sort.col, st.sort.dir));

		st.items = items;
		st.shown = 0;
		appendMonthTags();
	}

	function sortMonthList(col) {
		const st = monthState;
		if (!st) return;
		const dir = st.sort && st.sort.col === col && st.sort.dir === "asc" ? "desc" : "asc";
		st.sort = { col, dir };
		monthViewDiv.querySelectorAll(".month-sort-th").forEach(th => {
			const current = th.dataset.col === col;
			th.classList.toggle("is-asc", current && dir === "asc");
			th.classList.toggle("is-desc", current && dir === "desc");
		});
		applyMonthList();
	}

	function appendMonthTags() {
		const st = monthState;
		if (!st) return;
		const listEl = monthViewDiv.querySelector(".month-tag-list");
		const tbody = listEl.querySelector(".month-tag-table tbody");
		const moreBtn = listEl.querySelector(".month-more-btn");
		if (st.shown === 0) tbody.innerHTML = "";

		const chunk = st.items.slice(st.shown, st.shown + TAG_LIST_PAGE);
		const rows = chunk.map(item => {
			const tip = item.n === 0 ? "Nessun PN deprecato" : `${item.n} PN deprecati su ${item.total}`;
			return `<tr class="month-tag-row" data-tag="${escapeHtml(item.tag)}" title="Clicca per vedere i PN di questo tag">`
				+ `<td class="month-col-open"><span class="cert-expand-icon">▸</span></td>`
				+ `<td class="month-col-state"><div class="cert-month-bar ${monthBarClass(item.n, item.total)}" title="${escapeHtml(tip)}"></div></td>`
				+ `<td>${escapeHtml(item.tag)}</td><td>${item.total}</td><td>${item.n}</td><td></td></tr>`;
		}).join("");
		tbody.insertAdjacentHTML("beforeend", rows);
		if (!st.items.length) {
			tbody.innerHTML = `<tr><td class="tag-pn-none" colspan="6">Nessun tag corrisponde ai filtri</td></tr>`;
		}

		st.shown += chunk.length;
		const remaining = st.items.length - st.shown;
		moreBtn.hidden = remaining <= 0;
		moreBtn.textContent = `Mostra altri (${Math.min(TAG_LIST_PAGE, remaining)} di ${remaining} rimasti)`;

		const filteredEl = listEl.querySelector(".month-tag-filtered");
		if (filteredEl) filteredEl.textContent = st.items.length === st.base.length ? "" : ` — filtrati: ${st.items.length} su ${st.base.length}`;
	}

	/* Apre o chiude l'elenco dei PN di un tag: lo stesso elenco della scheda Per Tag,
	 già posizionato sul mese scelto. Si costruisce solo alla prima apertura.*/
	function toggleMonthTag(row) {
		let detail = row.nextElementSibling;
		if (detail && detail.classList.contains("month-tag-detail")) {
			detail.hidden = !detail.hidden;
			row.classList.toggle("is-open", !detail.hidden);
			return;
		}

		const panel = document.createElement("div");
		panel.className = "month-tag-panel";
		panel.dataset.tag = row.dataset.tag;
		panel._tag = makeTagState(row.dataset.tag);
		panel.innerHTML = `<div class="tag-pn-list"></div>`;
		attachTagListHandlers(panel);

		detail = document.createElement("tr");
		detail.className = "month-tag-detail";
		const cell = document.createElement("td");
		cell.colSpan = 6;
		cell.appendChild(panel);
		detail.appendChild(cell);
		row.after(detail);
		row.classList.add("is-open");

		selectTagMonth(panel, monthState.selected);
	}

	function setupCustomerDropdown() {
		const optionsList = document.getElementById("customer-options-list");
		const btnText = document.getElementById("customer-btn-text");
		const searchInput = document.getElementById("customer-search-input");
		if (!optionsList || !btnText) return;

		selectedCustomers = new Set();
		if (searchInput) searchInput.value = "";

		const uniqueCustomers = [...new Set(certificatiTableData.map(d => String(d["Customer"] || "").trim()))]
			.filter(Boolean)
			.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

		function updateBtnText() {
			const n = selectedCustomers.size;
			btnText.textContent = n === 0
				? "Tutti i Customer"
				: n === 1
					? [...selectedCustomers][0]
					: `Customer (${n} selezionati)`;
		}

		function renderOptions(filterText = "") {
			const filtered = uniqueCustomers.filter(c => c.toLowerCase().includes(filterText.trim().toLowerCase()));

			optionsList.innerHTML = filtered.length
				? filtered.map(c => `<label class="multiselect-option"><input type="checkbox" value="${c}" ${selectedCustomers.has(c) ? "checked" : ""}> ${c}</label>`).join('')
				: `<div class="multiselect-empty">Nessun cliente trovato</div>`;

			optionsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
				cb.onchange = () => {
					if (cb.checked) selectedCustomers.add(cb.value);
					else selectedCustomers.delete(cb.value);
					updateBtnText();
					applyCombinedFilters();
				};
			});
		}

		renderOptions();
		updateBtnText();

		if (searchInput) {
			searchInput.oninput = () => renderOptions(searchInput.value);
		}

		const selectAllBtn = document.getElementById("customer-select-all");
		const clearAllBtn = document.getElementById("customer-clear-all");

		if (selectAllBtn) {
			selectAllBtn.onclick = () => {
				uniqueCustomers.forEach(c => selectedCustomers.add(c));
				renderOptions(searchInput ? searchInput.value : "");
				updateBtnText();
				applyCombinedFilters();
			};
		}
		if (clearAllBtn) {
			clearAllBtn.onclick = () => {
				selectedCustomers.clear();
				renderOptions(searchInput ? searchInput.value : "");
				updateBtnText();
				applyCombinedFilters();
			};
		}
	}

	/* ================= Filtri Ref. US Family e Ref. EU Family =================
	 Stessa struttura del filtro Customer (menu con spunte, ricerca interna,
	 "Seleziona tutti" / "Azzera"), ognuno applicato alla propria colonna.
	 Si combinano fra loro e con tutti gli altri filtri (applyCombinedFilters).*/
	const multiFilters = [
		{ prefix: "usfamily", column: "REF. US FAMILY", allLabel: "Tutte le Ref. US Family", shortLabel: "Ref. US Family", noneLabel: "Nessuna Ref. US Family trovata" },
		{ prefix: "eufamily", column: "REF. EU FAMILY", allLabel: "Tutte le Ref. EU Family", shortLabel: "Ref. EU Family", noneLabel: "Nessuna Ref. EU Family trovata" }
	];
	multiFilters.forEach(f => {
		f.selected = new Set();
		f.container = document.getElementById(f.prefix + "-multiselect");
		f.available = false; // diventa true quando il file contiene la colonna
	});

	/* I filtri si vedono solo nella scheda "Per PN Motore" e solo se la colonna
	 esiste nel file Excel*/
	function refreshMultiFiltersVisibility() {
		multiFilters.forEach(f => {
			if (f.container) f.container.style.display = (f.available && activeView === "pn") ? "" : "none";
		});
	}

	function setupMultiFilter(f) {
		const optionsList = document.getElementById(f.prefix + "-options-list");
		const btnText = document.getElementById(f.prefix + "-btn-text");
		const searchInput = document.getElementById(f.prefix + "-search-input");
		if (!f.container || !optionsList || !btnText) return;

		f.available = certificatiHeaders.includes(f.column);
		refreshMultiFiltersVisibility();
		if (!f.available) return;

		f.selected = new Set();
		if (searchInput) searchInput.value = "";

		const uniqueValues = [...new Set(certificatiTableData.map(d => String(d[f.column] ?? "").trim()))]
			.filter(Boolean)
			.sort(listCollator.compare);

		function updateBtnText() {
			const n = f.selected.size;
			btnText.textContent = n === 0
				? f.allLabel
				: n === 1
					? [...f.selected][0]
					: `${f.shortLabel} (${n} selezionate)`;
		}

		function renderOptions(filterText = "") {
			const needle = filterText.trim().toLowerCase();
			const filtered = uniqueValues.filter(v => v.toLowerCase().includes(needle));

			optionsList.innerHTML = filtered.length
				? filtered.map(v => `<label class="multiselect-option"><input type="checkbox" value="${escapeHtml(v)}" ${f.selected.has(v) ? "checked" : ""}> ${escapeHtml(v)}</label>`).join("")
				: `<div class="multiselect-empty">${f.noneLabel}</div>`;

			optionsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
				cb.onchange = () => {
					if (cb.checked) f.selected.add(cb.value);
					else f.selected.delete(cb.value);
					updateBtnText();
					applyCombinedFilters();
				};
			});
		}

		renderOptions();
		updateBtnText();

		if (searchInput) searchInput.oninput = () => renderOptions(searchInput.value);

		const selectAllBtn = document.getElementById(f.prefix + "-select-all");
		const clearAllBtn = document.getElementById(f.prefix + "-clear-all");
		if (selectAllBtn) {
			selectAllBtn.onclick = () => {
				uniqueValues.forEach(v => f.selected.add(v));
				renderOptions(searchInput ? searchInput.value : "");
				updateBtnText();
				applyCombinedFilters();
			};
		}
		if (clearAllBtn) {
			clearAllBtn.onclick = () => {
				f.selected.clear();
				renderOptions(searchInput ? searchInput.value : "");
				updateBtnText();
				applyCombinedFilters();
			};
		}
	}

	// Apertura e chiusura dei menu di questi filtri
	multiFilters.forEach(f => {
		const btn = document.getElementById(f.prefix + "-dropdown-btn");
		const menu = document.getElementById(f.prefix + "-dropdown-menu");
		if (!btn || !menu || !f.container) return;
		btn.onclick = () => {
			menu.classList.toggle("show");
			f.container.classList.toggle("open");
		};
	});

	/* Un solo menu aperto alla volta: un clic fuori da un menu aperto lo chiude.
	 Il listener è in fase di "cattura" perché il bottone Customer ferma la propagazione
	 del clic (stopPropagation) e altrimenti non chiuderebbe gli altri menu.*/
	document.addEventListener("click", e => {
		document.querySelectorAll(".multiselect-container.open").forEach(c => {
			if (c.contains(e.target)) return;
			c.classList.remove("open");
			const menu = c.querySelector(".multiselect-dropdown");
			if (menu) menu.classList.remove("show");
		});
	}, true);

	const dropdownBtn = document.getElementById("customer-dropdown-btn");
	const dropdownMenu = document.getElementById("customer-dropdown-menu");
	const multiselectContainer = document.getElementById("customer-multiselect");

	if (dropdownBtn && dropdownMenu && multiselectContainer) {
		dropdownBtn.onclick = e => {
			e.stopPropagation();
			dropdownMenu.classList.toggle("show");
			multiselectContainer.classList.toggle("open");
		};
		document.addEventListener("click", e => {
			if (multiselectContainer && !multiselectContainer.contains(e.target)) {
				dropdownMenu.classList.remove("show");
				multiselectContainer.classList.remove("open");
			}
		});
	}

	function getSelectedCustomers() {
		return [...selectedCustomers];
	}

	function applyCombinedFilters() {
		if (!table) return;

		const globalVal = document.getElementById("global-search")?.value.toLowerCase().trim() || "";
		const selectedCust = getSelectedCustomers();
		const colFilterEntries = Object.entries(columnFilters)
			.filter(([, f]) => f && f.value && f.value.trim())
			.map(([field, f]) => [field, f.value.trim(), f.value.trim().toLowerCase(), f.exact]);
		// Ref. US / EU Family: solo i filtri con almeno una voce spuntata
		const multiActive = multiFilters.filter(f => f.available && f.selected.size);

		if (!globalVal && !selectedCust.length && !colFilterEntries.length && !multiActive.length) {
			return table.clearFilter();
		}

		table.setFilter(data => {
			const custMatch = !selectedCust.length || selectedCust.includes(String(data["Customer"] || "").trim());
			/* __tagMatches è un array interno*/
			const globalMatch = !globalVal || certificatiHeaders.some(h => String(data[h] ?? "").toLowerCase().includes(globalVal));
			const colMatch = colFilterEntries.every(([field, val, valLower, exact]) => {
				const cell = String(data[field] ?? "");
				return exact ? cell.trim() === val : cell.toLowerCase().includes(valLower);
			});
			const multiMatch = multiActive.every(f => f.selected.has(String(data[f.column] ?? "").trim()));
			return custMatch && globalMatch && colMatch && multiMatch;
		});
	}

	/* Ricerca globale parte una volta sola quando si smette di scrivere */
	let globalSearchTimer = null;
	document.getElementById("global-search")?.addEventListener("keyup", () => {
		clearTimeout(globalSearchTimer);
		globalSearchTimer = setTimeout(() => {
			if (activeView === "tag") applyTagFilter();
			else if (activeView === "month") applyMonthList();
			else applyCombinedFilters();
		}, 300);
	});
});