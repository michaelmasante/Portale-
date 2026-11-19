(function () {
	const API = "API/Certificati.ashx";
	const RUOLO = "Certificati Modifica";

	const PASSI = [
		{ stato: "EpaSottomissione", sett: "EpaSottomissioneSett", nome: "EPA sottomissione" },
		{ stato: "EpaApprovazione", sett: "EpaApprovazioneSett", nome: "EPA approvazione" },
		{ stato: "CarbSottomissione", sett: "CarbSottomissioneSett", nome: "CARB sottomissione" },
		{ stato: "CarbApprovazione", sett: "CarbApprovazioneSett", nome: "CARB approvazione" }
	];
	const CAMPI = ["Ordine"].concat(...PASSI.map(p => [p.stato, p.sett]), ["Rischio", "Note"]);
	const MAX = { Famiglia: 50, Ordine: 20, Rischio: 50, Note: 4000 };
	PASSI.forEach(p => { MAX[p.stato] = 100; MAX[p.sett] = 50; });
	const STATI = ["APPROVED", "SUBMITTED", "TO BE SUBMITTED", "TO BE APPROVED", "PENDING", "STAND BY", "PHASED OUT", "NA"];
	const RISCHI = [["", "—"], ["HIGH", "Alto"], ["MED", "Medio"], ["LOW", "Basso"]];

	const $ = sel => document.querySelector(sel);
	const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	const num = n => Number(n || 0).toLocaleString("it-IT");
	const pulito = v => String(v ?? "").trim();
	const uguali = (a, b) => pulito(a) === pulito(b);

	const st = { caricato: false, caricando: null, righe: [], ultimo: null, modificheWeb: null, sbloccato: false, cerca: "", conferma: false, salvando: false, prossimoId: 1 };

	async function api(azione, body) {
		const init = { credentials: "same-origin", cache: "no-store", headers: { "X-Portale": "1" } };
		if (body) { init.method = "POST"; init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
		let json;
		try {
			const res = await fetch(API + "?action=" + azione, init);
			json = await res.json();
		} catch (e) {
			throw new Error("Il server non risponde (" + API + ").");
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

	const settValida = v => !pulito(v) || /^(CW\s*)?\d{1,2}(\s*\/\s*\d{4})?$/i.test(pulito(v)) && (n => n >= 1 && n <= 53)(Number(pulito(v).replace(/^CW\s*/i, "").split("/")[0]));
	const ordineValido = v => !pulito(v) || /^\d{1,6}$/.test(pulito(v));

	function nuovaRiga(orig) {
		const val = {};
		["Famiglia"].concat(CAMPI).forEach(c => { val[c] = orig ? (orig[c] ?? "") : ""; });
		return { id: st.prossimoId++, orig, val, eliminata: false };
	}

	async function carica() {
		const box = $("#mt-contenuto");
		box.innerHTML = `<div class="cx-loading"><span class="cx-spinner"></span>Lettura del Tracker…</div>`;
		try {
			const d = await api("epa");
			const c = d.colonne || [];
			st.righe = (d.righe || []).map(r => {
				const o = {};
				c.forEach((nome, i) => { if (nome !== "Dati") o[nome] = r[i]; });
				return nuovaRiga(o);
			});
			st.ultimo = d.ultimo || null;
			st.modificheWeb = d.modificheWeb || null;
			st.caricato = true;
			st.sbloccato = false;
			st.conferma = false;
			disegna();
		} catch (e) {
			st.caricando = null;
			box.innerHTML = `<div class="cx-alert cx-alert-danger">Tracker non disponibile: ${esc(e.message)}</div>`;
		}
	}

	function cambiati(r) {
		if (!r.orig) return CAMPI.filter(c => pulito(r.val[c]));
		return CAMPI.filter(c => !uguali(r.val[c], r.orig[c]));
	}

	function riepilogo() {
		let modificate = 0, nuove = 0, eliminate = 0;
		st.righe.forEach(r => {
			if (!r.orig) { if (!r.eliminata) nuove++; }
			else if (r.eliminata) eliminate++;
			else if (cambiati(r).length) modificate++;
		});
		return { modificate, nuove, eliminate, tot: modificate + nuove + eliminate };
	}

	function errori() {
		const l = [];
		const nomi = new Map();
		st.righe.forEach(r => {
			if (r.eliminata) return;
			const nome = pulito(r.val.Famiglia);
			if (!r.orig && !nome) l.push("Una famiglia nuova non ha il nome.");
			if (nome) {
				const k = nome.toLowerCase();
				if (nomi.has(k)) l.push(`La famiglia ${nome} c'è due volte.`);
				nomi.set(k, true);
			}
			const chi = nome || "Famiglia nuova";
			if (!ordineValido(r.val.Ordine)) l.push(`${chi}: l'ordine deve essere un numero intero.`);
			PASSI.forEach(p => { if (!settValida(r.val[p.sett])) l.push(`${chi}, ${p.nome}: settimana "${pulito(r.val[p.sett])}" non valida (es. CW12 oppure 12/2027).`); });
			["Famiglia"].concat(CAMPI).forEach(c => { if (pulito(r.val[c]).length > MAX[c]) l.push(`${chi}, ${c}: troppo lungo (massimo ${MAX[c]} caratteri).`); });
		});
		return [...new Set(l)];
	}

	function visibile(r) {
		const q = st.cerca.trim().toLowerCase();
		if (!q) return true;
		return [r.val.Famiglia, r.val.Note, r.val.Rischio].concat(PASSI.map(p => r.val[p.stato])).some(v => String(v ?? "").toLowerCase().includes(q));
	}

	function disegna() {
		const box = $("#mt-contenuto");
		if (!box || !st.caricato) return;
		const u = st.ultimo, mw = st.modificheWeb;
		box.innerHTML = `
			<div class="mt-testa">
				<div>
					<h2 class="epa-titolo">Modifica Tracker EPA / CARB</h2>
					<div class="cx-muted epa-sotto">${u ? `Ultimo Excel: ${esc(u.foglio || u.file || "")} · ${esc(String(u.data || "").slice(0, 10).split("-").reverse().join("/"))}${u.utente ? " da " + esc(u.utente) : ""}` : "Nessun Excel caricato"}${mw && mw.n ? ` · dopo l'Excel: ${num(mw.n)} modifiche dal web su ${num(mw.famiglie)} famiglie (ultima ${esc(mw.ultima)} da ${esc(mw.utente)})` : ""}</div>
				</div>
			</div>
			${mw === null ? `<div class="cx-alert cx-alert-warning">Per salvare le modifiche manca la tabella dbo.EpaModifiche: eseguire SQL/Certificati_02_modifica_tracker.sql in SSMS.</div>` : ""}
			<div class="mt-barra" id="mt-barra"></div>
			<div id="mt-messaggi"></div>
			<div class="mt-tabella-box"><table class="mt-tabella${st.sbloccato ? "" : " mt-bloccata"}">
				<thead><tr>
					<th class="mt-col-ord">Ord.</th><th class="mt-col-fam">Famiglia</th>
					${PASSI.map(p => `<th class="mt-col-passo">${p.nome}<span class="mt-th-sotto">stato · settimana</span></th>`).join("")}
					<th class="mt-col-rischio">Rischio</th><th class="mt-col-note">Note</th><th class="mt-col-az"></th>
				</tr></thead>
				<tbody id="mt-corpo"></tbody>
			</table></div>
			<datalist id="mt-stati">${STATI.map(s => `<option value="${s}"></option>`).join("")}</datalist>`;
		disegnaBarra();
		disegnaCorpo();
	}

	function disegnaBarra(soloSeCambia) {
		const b = $("#mt-barra");
		if (!b) return;
		const r = riepilogo();
		const err = errori();
		// Ridisegnare la barra mentre si clicca un suo pulsante farebbe perdere il clic
		const firma = [st.sbloccato, st.conferma, st.salvando, r.tot, r.modificate, r.nuove, r.eliminate, err.join("|")].join(";");
		if (soloSeCambia && firma === b.dataset.firma) return;
		b.dataset.firma = firma;
		if (!st.sbloccato) {
			b.innerHTML = `<span class="mt-lucchetto">&#128274; Dati bloccati</span>
				<span class="cx-muted">Premi «Sblocca» per iniziare a modificare. Nel database non cambia niente finché non premi «Salva modifiche».</span>
				<input type="text" id="mt-cerca" placeholder="🔍 Cerca famiglia, stato, note…" value="${esc(st.cerca)}">
				<button type="button" class="cx-btn cx-btn-primary" data-mt="sblocca"${st.modificheWeb === null ? " disabled" : ""}>&#128275; Sblocca</button>`;
		} else if (st.conferma) {
			b.innerHTML = `<span class="mt-lucchetto mt-aperto">&#128275; Modifica</span>
				<span><strong>Salvo nel database:</strong> ${[r.modificate ? `${num(r.modificate)} famiglie modificate` : "", r.nuove ? `${num(r.nuove)} nuove` : "", r.eliminate ? `${num(r.eliminate)} eliminate` : ""].filter(Boolean).join(", ")}. Confermi?</span>
				${st.salvando ? `<span class="cx-spinner"></span><span class="cx-muted">Salvataggio…</span>`
					: `<button type="button" class="cx-btn cx-btn-outline" data-mt="no">Torna alle modifiche</button>
					   <button type="button" class="cx-btn cx-btn-ok" data-mt="conferma">Sì, salva</button>`}`;
		} else {
			b.innerHTML = `<span class="mt-lucchetto mt-aperto">&#128275; Modifica</span>
				<button type="button" class="cx-btn cx-btn-outline cx-btn-sm" data-mt="aggiungi">+ Aggiungi famiglia</button>
				<input type="text" id="mt-cerca" placeholder="🔍 Cerca famiglia, stato, note…" value="${esc(st.cerca)}">
				<span class="mt-conta ${r.tot ? "mt-conta-on" : ""}">${r.tot ? `${num(r.tot)} famiglie con modifiche non salvate` : "Nessuna modifica"}</span>
				<button type="button" class="cx-btn cx-btn-outline" data-mt="annulla">${r.tot ? "Annulla modifiche" : "&#128274; Blocca"}</button>
				<button type="button" class="cx-btn cx-btn-primary" data-mt="salva"${r.tot && !err.length ? "" : " disabled"}>Salva modifiche</button>`;
		}
		const m = $("#mt-messaggi");
		if (m) m.innerHTML = st.sbloccato && err.length ? `<div class="cx-alert cx-alert-danger"><strong>Da correggere prima di salvare:</strong><ul class="cx-lista">${err.slice(0, 15).map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>` : (m.dataset.esito || "");
	}

	function campo(r, c, html) {
		const cambiato = r.orig && !r.eliminata && !uguali(r.val[c], r.orig[c]);
		return `<div class="mt-campo${cambiato ? " mt-cambiato" : ""}" data-campo="${c}"${cambiato ? ` title="Prima: ${esc(r.orig[c] || "vuoto")}"` : ""}>${html}</div>`;
	}

	function rigaHtml(r) {
		const off = st.sbloccato && !r.eliminata && !st.conferma ? "" : " disabled";
		const inp = (c, extra) => `<input type="text" data-c="${c}" value="${esc(r.val[c])}" maxlength="${MAX[c]}"${off}${extra || ""}>`;
		const rischi = RISCHI.slice();
		if (r.val.Rischio && !rischi.some(x => x[0] === r.val.Rischio)) rischi.push([r.val.Rischio, r.val.Rischio]);
		const cls = [r.orig ? "" : "mt-nuova", r.eliminata ? "mt-eliminata" : ""].filter(Boolean).join(" ");
		return `<tr data-id="${r.id}" class="${cls}">
			<td>${campo(r, "Ordine", inp("Ordine", ' class="mt-ord" inputmode="numeric"'))}</td>
			<td class="mt-fam">${r.orig ? `<strong>${esc(r.orig.Famiglia)}</strong>` : `<div class="mt-campo">${inp("Famiglia", ' placeholder="Nome famiglia"')}</div>`}</td>
			${PASSI.map(p => `<td><div class="mt-passo">${campo(r, p.stato, inp(p.stato, ' list="mt-stati" class="mt-stato" placeholder="stato"'))}${campo(r, p.sett, inp(p.sett, ` class="mt-sett${settValida(r.val[p.sett]) ? "" : " mt-errore"}" placeholder="CW"`))}</div></td>`).join("")}
			<td>${campo(r, "Rischio", `<select data-c="Rischio"${off}>${rischi.map(([v, n]) => `<option value="${esc(v)}"${pulito(r.val.Rischio) === v ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`)}</td>
			<td>${campo(r, "Note", `<textarea data-c="Note" rows="1" maxlength="4000"${off}>${esc(r.val.Note)}</textarea>`)}</td>
			<td class="mt-az">${st.sbloccato && !st.conferma ? (r.eliminata
				? `<button type="button" class="cx-btn cx-btn-outline cx-btn-sm" data-mt="ripristina">Ripristina</button>`
				: `<button type="button" class="mt-cestino" data-mt="elimina" title="${r.orig ? "Elimina la famiglia" : "Togli la riga"}">&#128465;</button>`) : ""}</td>
		</tr>`;
	}

	function disegnaCorpo() {
		const corpo = $("#mt-corpo");
		if (!corpo) return;
		const l = st.righe.filter(r => !r.orig || visibile(r));
		corpo.innerHTML = l.length ? l.map(rigaHtml).join("") : `<tr><td colspan="9" class="cx-muted mt-vuoto">Nessuna famiglia${st.cerca ? " con questa ricerca" : ""}.</td></tr>`;
	}

	function aggiornaRiga(tr) {
		const r = st.righe.find(x => x.id === Number(tr.dataset.id));
		if (!r) return;
		tr.querySelectorAll(".mt-campo[data-campo]").forEach(div => {
			const c = div.dataset.campo;
			const cambiato = r.orig && !uguali(r.val[c], r.orig[c]);
			div.classList.toggle("mt-cambiato", !!cambiato);
			if (cambiato) div.title = "Prima: " + (r.orig[c] || "vuoto"); else div.removeAttribute("title");
		});
		tr.querySelectorAll("input.mt-sett").forEach(i => i.classList.toggle("mt-errore", !settValida(i.value)));
	}

	function payload() {
		const modifiche = [], nuove = [], eliminate = [];
		st.righe.forEach(r => {
			if (!r.orig) {
				if (r.eliminata) return;
				const campi = { Famiglia: pulito(r.val.Famiglia) };
				CAMPI.forEach(c => { if (pulito(r.val[c])) campi[c] = pulito(r.val[c]); });
				nuove.push({ campi });
			} else if (r.eliminata) {
				eliminate.push({ famiglia: r.orig.Famiglia });
			} else {
				const c = cambiati(r);
				if (!c.length) return;
				const prima = {}, dopo = {};
				c.forEach(k => { prima[k] = r.orig[k] ?? null; dopo[k] = pulito(r.val[k]); });
				modifiche.push({ famiglia: r.orig.Famiglia, prima, dopo });
			}
		});
		return { modifiche, nuove, eliminate };
	}

	async function salva() {
		st.salvando = true;
		disegnaBarra();
		try {
			const r = await api("salvaepa", payload());
			if (window.CertificatiDati) delete window.CertificatiDati.epa;
			if (window.CertificatiEpa) window.CertificatiEpa.ricarica();
			st.salvando = false;
			await carica();
			const m = $("#mt-messaggi");
			const testo = `Salvato: ${num(r.modificate)} famiglie modificate, ${num(r.nuove)} nuove, ${num(r.eliminate)} eliminate. I dati sono di nuovo bloccati.`;
			if (m) { m.dataset.esito = `<div class="cx-alert cx-alert-ok">${esc(testo)}</div>`; m.innerHTML = m.dataset.esito; }
			toast("Modifiche salvate nel database.");
		} catch (e) {
			st.salvando = false;
			st.conferma = false;
			disegnaBarra();
			disegnaCorpo();
			const m = $("#mt-messaggi");
			if (m) m.insertAdjacentHTML("afterbegin", `<div class="cx-alert cx-alert-danger">Salvataggio non riuscito, il database non è cambiato: ${esc(e.message)}</div>`);
		}
	}

	function annulla() {
		st.righe = st.righe.filter(r => r.orig).map(r => { const n = nuovaRiga(r.orig); n.id = r.id; return n; });
		st.sbloccato = false;
		st.conferma = false;
		disegna();
	}

	function avvia() {
		const sez = $("#mt-view");
		if (!sez) return;
		sez.addEventListener("click", e => {
			const b = e.target.closest("[data-mt]");
			if (!b || b.disabled) return;
			const az = b.dataset.mt;
			const m = $("#mt-messaggi");
			if (m) delete m.dataset.esito;
			if (az === "sblocca") { st.sbloccato = true; disegna(); }
			else if (az === "annulla") {
				if (riepilogo().tot && !window.confirm("Annullare tutte le modifiche non salvate?")) return;
				annulla();
			}
			else if (az === "aggiungi") {
				const r = nuovaRiga(null);
				st.righe.unshift(r);
				disegnaCorpo();
				disegnaBarra();
				const i = document.querySelector(`#mt-corpo tr[data-id="${r.id}"] input[data-c="Famiglia"]`);
				if (i) i.focus();
			}
			else if (az === "salva") { st.conferma = true; disegnaBarra(); disegnaCorpo(); }
			else if (az === "no") { st.conferma = false; disegnaBarra(); disegnaCorpo(); }
			else if (az === "conferma") salva();
			else if (az === "elimina" || az === "ripristina") {
				const tr = b.closest("tr");
				const r = st.righe.find(x => x.id === Number(tr.dataset.id));
				if (!r) return;
				if (!r.orig) st.righe = st.righe.filter(x => x !== r);
				else r.eliminata = az === "elimina";
				disegnaCorpo();
				disegnaBarra();
			}
		});
		const modifica = e => {
			const el = e.target;
			if (el.id === "mt-cerca") {
				st.cerca = el.value;
				clearTimeout(avvia.t);
				avvia.t = setTimeout(disegnaCorpo, 200);
				return;
			}
			const c = el.dataset && el.dataset.c;
			const tr = el.closest && el.closest("#mt-corpo tr");
			if (!c || !tr || !st.sbloccato) return;
			const r = st.righe.find(x => x.id === Number(tr.dataset.id));
			if (!r) return;
			r.val[c] = el.value;
			aggiornaRiga(tr);
			disegnaBarra(true);
		};
		sez.addEventListener("input", modifica);
		sez.addEventListener("change", modifica);
		sez.addEventListener("focusin", e => { if (e.target.matches("textarea[data-c]")) e.target.rows = 4; });
		sez.addEventListener("focusout", e => { if (e.target.matches("textarea[data-c]")) e.target.rows = 1; });
		window.addEventListener("beforeunload", e => {
			if (st.sbloccato && riepilogo().tot) { e.preventDefault(); e.returnValue = ""; }
		});
	}

	window.CertificatiModifica = {
		mostra() {
			const s = $("#mt-view");
			if (!s) return;
			if (window.PortaleUtente && !window.PortaleUtente.ha(RUOLO)) return;
			s.hidden = false;
			if (!st.caricato) { if (!st.caricando) st.caricando = carica(); }
		},
		nascondi() {
			const s = $("#mt-view");
			if (s) s.hidden = true;
		},
		ricarica() { st.caricato = false; st.caricando = null; }
	};

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
	else avvia();
})();
