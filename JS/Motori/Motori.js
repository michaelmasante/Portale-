document.addEventListener("DOMContentLoaded", () => {
	// Array dei file con i nomi esatti dal Solution Explorer
	const excelFilePaths = [
		'File/Motori/ShopOrder F1A 01.09.2026.xlsx',
		'File/Motori/ShopOrder S8000 01.09.2026.xlsx'
	];

	const allowedColumns = [
		"P/N Motore", "Engine code", "REF. EU FAMILY", "P/N Interno",
		"P/N Figurino", "Application", "Customer Eng.", "Customer",
		"Tipo Motore", "Omologazione", "Alternatore", "Oil Filter",
		"Status", "ENTE", "PRP", "FGF GROUP"
	];

	let tablesInstances = [];
	let selectedCustomers = new Set();

	const tabsContainer = document.getElementById("tabs-container");
	const gridsWrapper = document.getElementById("grids-wrapper");

	if (!tabsContainer || !gridsWrapper) return;
	tabsContainer.innerHTML = "";
	gridsWrapper.innerHTML = "";

	Promise.all(
		excelFilePaths.map(filePath =>
			fetch(filePath)
				.then(res => {
					if (!res.ok) {
						console.warn(`File non trovato (HTTP ${res.status}): ${filePath}`);
						return null;
					}
					return res.arrayBuffer();
				})
				.then(buffer => {
					if (!buffer) return null;
					return {
						filePath,
						fileBaseName: filePath.split('/').pop().replace(/\.[^/.]+$/, ''),
						workbook: XLSX.read(new Uint8Array(buffer), { type: 'array' })
					};
				})
				.catch(err => {
					console.warn(`Errore durante il caricamento del file ${filePath}:`, err);
					return null;
				})
		)
	).then(results => {
		const validResults = results.filter(r => r !== null);

		if (validResults.length === 0) {
			gridsWrapper.innerHTML = "<div style='padding:20px; color:red; font-weight:bold;'>Nessun file Excel trovato sul server. Verificare i percorsi dei file nella cartella File/Motori/.</div>";
			return;
		}

		let globalTabIndex = 0;

		validResults.forEach(({ fileBaseName, workbook }) => {
			workbook.SheetNames.forEach(sheetName => {
				const worksheet = workbook.Sheets[sheetName];
				const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
				if (!rawRows.length) return;

				let headerIndex = 0, maxFilled = 0;
				rawRows.forEach((row, idx) => {
					const filled = row.filter(c => String(c).trim()).length;
					if (filled > maxFilled) { maxFilled = filled; headerIndex = idx; }
				});

				const headers = [], validColIndexes = [];
				rawRows[headerIndex].forEach((h, i) => {
					const name = String(h).trim() || `Colonna_${i + 1}`;
					if (allowedColumns.includes(name)) {
						headers.push(name);
						validColIndexes.push(i);
					}
				});

				const tableData = rawRows.slice(headerIndex + 1).map(row =>
					headers.reduce((acc, h, i) => ({ ...acc, [h]: row[validColIndexes[i]] ?? "" }), {})
				);

				const isFirstTab = globalTabIndex === 0;

				// Creazione del pulsante Tab
				const btn = document.createElement("button");
				btn.className = `tab-btn ${isFirstTab ? "active" : ""}`;
				btn.innerHTML = `
					<span class="tab-filename">${fileBaseName}</span>
					<span class="tab-sheetname">${sheetName}</span>
				`;
				tabsContainer.appendChild(btn);

				// Creazione del div per la griglia
				const gridDiv = document.createElement("div");
				gridDiv.className = "tab-grid";
				gridsWrapper.appendChild(gridDiv);

				const selectElements = {};

				function customHybridFilter(cell, onRendered, success) {
					const field = cell.getColumn().getField();
					const container = document.createElement("div");
					container.style.cssText = "display:flex; gap:0; width:100%; box-sizing:border-box;";

					const select = document.createElement("select");
					select.style.cssText = "padding:4px 2px; font-size:12px; border:1px solid #ccc; border-right:none; border-radius:4px 0 0 4px; background:#f9f9f9; cursor:pointer; max-width:70px; outline:none;";
					selectElements[field] = select;

					const input = document.createElement("input");
					input.type = "text";
					input.placeholder = "Cerca...";
					input.style.cssText = "flex:1; min-width:0; padding:4px 6px; font-size:12px; border:1px solid #ccc; border-radius:0 4px 4px 0; outline:none;";

					container.append(select, input);

					select.onchange = () => { input.value = select.value; success(input.value); };
					input.oninput = () => {
						const currentOpts = Array.from(select.options).map(o => o.value);
						select.value = currentOpts.includes(input.value) ? input.value : "";
						success(input.value);
					};

					return container;
				}

				function updateDropdownOptions(activeData) {
					headers.forEach(header => {
						const select = selectElements[header];
						if (!select) return;

						const currentVal = select.value;
						const visibleValues = [...new Set(activeData.map(d => String(d[header] || "").trim()))].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

						select.innerHTML = '<option value="">Tutti</option>' + visibleValues.map(v => `<option value="${v}">${v}</option>`).join('');
						select.value = visibleValues.includes(currentVal) ? currentVal : "";
					});
				}

				const table = new Tabulator(gridDiv, {
					data: tableData,
					columns: headers.map(h => ({ title: h, field: h, headerFilter: customHybridFilter, headerFilterFunc: "like", minWidth: 170, sorter: "string" })),
					layout: "fitDataFill",
					pagination: "local",
					paginationSize: 25,
					height: "700px",
					renderVertical: "virtual",
					renderHorizontal: "virtual"
				});

				// Gestione visibilità asincrona post-inizializzazione di Tabulator
				table.on("tableBuilt", () => {
					updateDropdownOptions(tableData);
					if (!isFirstTab) {
						gridDiv.style.display = "none";
					}
				});

				table.on("dataFiltered", (filters, rows) => updateDropdownOptions(rows.map(r => r.getData())));

				tablesInstances.push({ btn, gridDiv, table, tableData, isFirst: isFirstTab });

				// Evento cambio scheda
				btn.onclick = () => {
					tablesInstances.forEach(item => {
						item.btn.classList.remove("active");
						item.gridDiv.style.display = "none";
					});
					btn.classList.add("active");
					gridDiv.style.display = "block";
					table.redraw(true);
					setupCustomerDropdown();
				};

				globalTabIndex++;
			});
		});

		function getActiveInstance() {
			return tablesInstances.find(item => item.gridDiv.style.display !== "none") || tablesInstances[0];
		}

		function setupCustomerDropdown() {
			const active = getActiveInstance();
			if (!active) return;

			const optionsList = document.getElementById("customer-options-list");
			const btnText = document.getElementById("customer-btn-text");
			const searchInput = document.getElementById("customer-search-input");
			if (!optionsList || !btnText) return;

			selectedCustomers = new Set();
			if (searchInput) searchInput.value = "";

			const uniqueCustomers = [...new Set(active.tableData.map(d => String(d["Customer"] || "").trim()))]
				.filter(Boolean)
				.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

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
			const active = getActiveInstance();
			if (!active) return;

			const globalVal = document.getElementById("global-search")?.value.toLowerCase().trim() || "";
			const selectedCust = getSelectedCustomers();

			if (!globalVal && !selectedCust.length) return active.table.clearFilter();

			active.table.setFilter(data => {
				const custMatch = !selectedCust.length || selectedCust.includes(String(data["Customer"] || "").trim());
				const globalMatch = !globalVal || Object.values(data).some(v => String(v ?? "").toLowerCase().includes(globalVal));
				return custMatch && globalMatch;
			});
		}

		document.getElementById("global-search")?.addEventListener("keyup", applyCombinedFilters);
		setupCustomerDropdown();
	});
});