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
		"Tipo Motore", "Omologazione", "ENTE", "PRP", "FGF GROUP",
		CERTIFICATI_KEY_COLUMN
	];

	/* Colonne da leggere da TAG: la chiave + le 3 colonne che formano
	 il dettaglio mostrato all'apertura della riga. Aggiungi altre
	 colonne qui se in futuro ti servono anche quelle.*/
	const tagAllowedColumns = [
		TAG_KEY_COLUMN, "VStart", "VEnd", "TagElementDescription"
	];

	/* Colonne che hanno anche il filtro a tendina, oltre alla ricerca testuale.
	 Tutte le altre colonne hanno solo il campo "Cerca...".*/
	const dropdownColumns = ["Customer Eng.", "Customer", "Tipo Motore", "Omologazione", "ENTE", "PRP"];
	// Versione di questa pagina: viene aggiunta al footer condiviso
	const PAGE_VERSION = "0.0.8";

	/* Il footer viene caricato in modo asincrono dentro #footer-placeholder,
	/ quindi si aspetta che compaia e poi ci si inserisce la versione*/
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
		tagParsed.tableData.forEach(row => {
			const key = normalizeText(row[TAG_KEY_COLUMN]);
			if (!key) return;
			if (!tagByKey.has(key)) tagByKey.set(key, []);
			tagByKey.get(key).push({
				VStart: row["VStart"],
				VEnd: row["VEnd"],
				TagElementDescription: row["TagElementDescription"]
			});
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

	/* Defizione di deprecato Se vero è Rosso se falso Verde.*/
	function isDeprecatedInMonth(vStart, vEnd, month) {
		const s = toDate(vStart);
		const e = toDate(vEnd);
		if (!s && !e) return false;
		return (!s || s <= month.end) && (!e || e >= month.start);
	}

	function buildDetailPanel(tagMatches) {
		const panel = document.createElement("div");
		panel.className = "cert-detail-panel";

		if (!tagMatches || !tagMatches.length) {
			panel.innerHTML = `<div class="cert-detail-empty">Nessuna corrispondenza trovata in TAG.</div>`;
			return panel;
		}

		const months = getTimelineMonths();
		const monthHeaders = months.map(mo => `<th class="cert-month-col" title="${mo.title}">${mo.label}</th>`).join("");

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
			// Scelta dal menu: corrispondenza esatta 
			columnFilters[field] = { value: input.value, exact: true };
			applyCombinedFilters();
		};
		input.oninput = () => {
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
			/* Dopo un filtro Tabulator fissa l'altezza del contenitore interno a quella
			 delle righe visibili: ricalcolarla fa comparire (o sparire) il pannello*/
			table.redraw();
		});

		table.on("tableBuilt", () => updateDropdownOptions(certificatiTableData));
		table.on("tableBuilt", hideLoadingIndicator);
		table.on("renderComplete", hideLoadingIndicator);
		table.on("dataFiltered", (filters, rows) => updateDropdownOptions(rows.map(r => r.getData())));

		setupCustomerDropdown();
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

		if (!globalVal && !selectedCust.length && !colFilterEntries.length) {
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
			return custMatch && globalMatch && colMatch;
		});
	}

	/* Global search funziona solo quando smetti di scrivere*/
	let globalSearchTimer = null;
	document.getElementById("global-search")?.addEventListener("keyup", () => {
		clearTimeout(globalSearchTimer);
		globalSearchTimer = setTimeout(applyCombinedFilters, 300);
	});
});