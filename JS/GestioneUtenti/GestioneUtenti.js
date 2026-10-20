/* Gestione utenti: attivazione, sblocco e ruoli. Tutto passa da API/GestioneUtenti.ashx,
   che controlla sul server che chi chiama abbia il ruolo Admin. */
document.addEventListener("DOMContentLoaded", function () {
	const API = "API/GestioneUtenti.ashx";
	const head = document.getElementById("gu-head");
	const body = document.getElementById("gu-body");
	const search = document.getElementById("gu-search");
	const counts = document.getElementById("gu-counts");
	const toast = document.getElementById("gu-toast");

	let dati = { io: "", ruoli: [], utenti: [] };
	let filtro = "tutti";
	let toastTimer = null;

	function esc(v) {
		return String(v == null ? "" : v)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	function avviso(msg, errore) {
		toast.textContent = msg;
		toast.classList.toggle("is-error", !!errore);
		toast.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => { toast.hidden = true; }, errore ? 6000 : 2500);
	}

	function chiama(action, payload) {
		const opt = payload === undefined
			? { credentials: "same-origin", cache: "no-store" }
			: {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json", "X-Portale": "1" },
				body: JSON.stringify(payload)
			};
		return fetch(API + "?action=" + action, opt)
			.then(res => {
				if (res.redirected) { window.location.href = "Login.html"; throw new Error("Sessione scaduta"); }
				return res.json().catch(() => ({ ok: false, message: "Risposta non valida dal server (" + res.status + ")." }));
			})
			.then(data => {
				if (!data.ok) throw new Error(data.message + (data.detail ? " — " + data.detail : ""));
				return data;
			});
	}

	function carica() {
		return chiama("elenco")
			.then(d => { dati = d; disegna(); })
			.catch(err => {
				head.innerHTML = "";
				body.innerHTML = '<tr><td class="gu-empty">' + esc(err.message) + "</td></tr>";
			});
	}

	function stato(u) {
		let html = u.attivo
			? '<span class="gu-badge ok">Attivo</span>'
			: (u.ultimoAccesso ? '<span class="gu-badge off">Disattivato</span>' : '<span class="gu-badge wait">In attesa</span>');
		if (u.bloccato) html += '<span class="gu-badge lock">Bloccato</span>';
		return html;
	}

	function disegna() {
		const utenti = dati.utenti;
		const inAttesa = utenti.filter(u => !u.attivo && !u.ultimoAccesso).length;
		const bloccati = utenti.filter(u => u.bloccato).length;
		counts.innerHTML =
			'<div class="gu-count"><strong>' + utenti.length + "</strong>utenti</div>" +
			'<div class="gu-count' + (inAttesa ? " is-alert" : "") + '"><strong>' + inAttesa + "</strong>in attesa</div>" +
			(bloccati ? '<div class="gu-count is-alert"><strong>' + bloccati + "</strong>bloccati</div>" : "");

		head.innerHTML = "<tr><th>Utente</th><th>Stato</th><th>Registrato</th><th>Ultimo accesso</th>" +
			dati.ruoli.map(r => '<th class="gu-role" title="' + esc(r.descrizione) + '">' + esc(r.nome) + "</th>").join("") +
			"<th></th></tr>";

		const q = search.value.trim().toLowerCase();
		const righe = utenti.filter(u => {
			if (filtro === "attesa" && (u.attivo || u.ultimoAccesso)) return false;
			if (filtro === "bloccati" && !u.bloccato) return false;
			if (!q) return true;
			return (u.username + " " + u.nome + " " + u.email).toLowerCase().includes(q);
		});

		if (!righe.length) {
			body.innerHTML = '<tr><td class="gu-empty" colspan="' + (5 + dati.ruoli.length) + '">Nessun utente da mostrare.</td></tr>';
			return;
		}

		body.innerHTML = righe.map(u => {
			const io = u.username.toLowerCase() === String(dati.io).toLowerCase();
			const ruoli = dati.ruoli.map(r => {
				const checked = u.ruoli.includes(r.id) ? " checked" : "";
				const bloccaAdmin = io && r.nome.toLowerCase() === "admin" ? ' disabled title="Non puoi toglierti il ruolo Admin"' : "";
				return '<td class="gu-role"><input type="checkbox" data-ruolo="' + r.id + '"' + checked + bloccaAdmin +
					' aria-label="' + esc(r.nome) + " per " + esc(u.username) + '"></td>';
			}).join("");
			const attiva = u.attivo
				? '<button type="button" class="gu-btn" data-azione="disattiva"' + (io ? ' disabled title="Non puoi disattivare te stesso"' : "") + ">Disattiva</button>"
				: '<button type="button" class="gu-btn primary" data-azione="attiva">Attiva</button>';
			const sblocca = u.bloccato ? '<button type="button" class="gu-btn" data-azione="sblocca">Sblocca</button>' : "";
			return '<tr data-id="' + u.id + '"' + (!u.attivo && !u.ultimoAccesso ? ' class="is-pending"' : "") + ">" +
				'<td class="gu-user"><strong>' + esc(u.username) + (io ? " (tu)" : "") + "</strong><span>" + esc(u.nome) +
				(u.email ? " · " + esc(u.email) : "") + "</span></td>" +
				"<td>" + stato(u) + "</td>" +
				'<td class="gu-date">' + esc(u.creatoIl) + "</td>" +
				'<td class="gu-date">' + (u.ultimoAccesso ? esc(u.ultimoAccesso) : "—") + "</td>" +
				ruoli +
				'<td class="gu-actions">' + sblocca + attiva + "</td></tr>";
		}).join("");
	}

	/* ruoli: ogni spunta salva subito tutti i ruoli di quell'utente */
	body.addEventListener("change", function (ev) {
		const box = ev.target;
		if (!box.matches("input[data-ruolo]")) return;
		const tr = box.closest("tr");
		const id = Number(tr.dataset.id);
		const scelti = Array.from(tr.querySelectorAll("input[data-ruolo]:checked")).map(x => Number(x.dataset.ruolo));
		const inputs = tr.querySelectorAll("input[data-ruolo]");
		inputs.forEach(x => { x.dataset.wasDisabled = x.disabled ? "1" : ""; x.disabled = true; });

		chiama("ruoli", { id: id, ruoli: scelti })
			.then(() => {
				const u = dati.utenti.find(x => x.id === id);
				if (u) u.ruoli = scelti;
				avviso("Ruoli salvati per " + (u ? u.username : "l'utente") + ".");
			})
			.catch(err => {
				box.checked = !box.checked; // torna com'era
				avviso(err.message, true);
			})
			.finally(() => inputs.forEach(x => { x.disabled = x.dataset.wasDisabled === "1"; }));
	});

	/* attiva / disattiva / sblocca */
	body.addEventListener("click", function (ev) {
		const btn = ev.target.closest("button[data-azione]");
		if (!btn) return;
		const id = Number(btn.closest("tr").dataset.id);
		const u = dati.utenti.find(x => x.id === id);
		const azione = btn.dataset.azione;

		if (azione === "disattiva" && !confirm("Disattivare " + u.username + "? Verrà fatto uscire alla prossima pagina che apre.")) return;

		btn.disabled = true;
		const req = azione === "sblocca" ? chiama("sblocca", { id: id }) : chiama("attiva", { id: id, attivo: azione === "attiva" });
		req.then(() => {
			avviso(azione === "attiva" ? u.username + " attivato." : azione === "disattiva" ? u.username + " disattivato." : u.username + " sbloccato.");
			return carica();
		}).catch(err => {
			btn.disabled = false;
			avviso(err.message, true);
		});
	});

	search.addEventListener("input", disegna);
	document.querySelectorAll(".gu-filter").forEach(b => b.addEventListener("click", function () {
		filtro = b.dataset.filtro;
		document.querySelectorAll(".gu-filter").forEach(x => x.classList.toggle("is-on", x === b));
		disegna();
	}));

	carica();
});
