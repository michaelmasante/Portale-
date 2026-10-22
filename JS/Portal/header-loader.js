/* ============ Ruoli: chi vede cosa ============
 I ruoli dell'utente arrivano da API/Auth.ashx?action=me (nel database ci sono solo i ruoli).
 Cosa vede ogni ruolo si decide nelle pagine:

   - QUALI RUOLI POSSONO APRIRE UNA PAGINA: nell'<head> della pagina
         <meta name="ruoli" content="Certificati">
     Più ruoli separati da virgola ("Certificati,Safety"): basta averne uno.
     content vuoto = la pagina la vedono tutti gli utenti collegati.
     Chi non ha il ruolo torna alla Home; nella Home la sua tile appare bloccata (Portal.js legge lo stesso meta).
   - un elemento con data-ruoli="Certificati,Safety" si vede solo con almeno uno di quei ruoli;
   - un elemento senza data-ruoli si vede sempre;
   - il ruolo Admin vede tutto.

 Dal JavaScript di una pagina: PortaleUtente.ha("Safety") dopo l'evento "portale:utente"
 (es. document.addEventListener("portale:utente", e => { if (e.detail.ha("Safety")) ... })).

 Limite: il blocco è nel browser. Chi conosce l'indirizzo di un file può comunque scaricarlo
 se ha fatto il login; solo API/GestioneUtenti.ashx controlla il ruolo sul server. */

(function () {
	const ADMIN = "admin";
	const HEADER_CACHE = "portal_header_html_v4"; // cambiarlo quando si modifica Header.html

	const style = document.createElement("style");
	style.textContent = "[data-ruoli]:not(.ruolo-ok){display:none!important}";
	document.head.appendChild(style);

	// Pagina riservata: si nasconde subito, prima che il browser la mostri, finché non si sa se l'utente può vederla
	const pageMeta = document.querySelector('meta[name="ruoli"]');
	const pageRoles = pageMeta ? pageMeta.getAttribute("content") : "";
	const pageRiservata = lista(pageRoles).length > 0;
	if (pageRiservata) document.documentElement.style.visibility = "hidden";

	let utente = null; // risposta di "me", quando arriva

	function lista(text) {
		return String(text || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
	}

	/* true se l'utente ha almeno uno dei ruoli indicati. Elenco vuoto = nessuna restrizione. */
	function ha(ruoliRichiesti) {
		if (!utente) return false;
		const richiesti = lista(ruoliRichiesti);
		if (richiesti.length === 0) return true;
		const mie = (utente.ruoli || []).map(r => String(r).toLowerCase());
		if (mie.includes(ADMIN)) return true;
		return richiesti.some(r => mie.includes(r));
	}

	function applicaRuoli(root) {
		if (!utente) return;
		root.querySelectorAll("[data-ruoli]").forEach(el => {
			el.classList.toggle("ruolo-ok", ha(el.getAttribute("data-ruoli")));
		});
	}

	function goToLogin() {
		window.location.href = "Login.html?ReturnUrl=" + encodeURIComponent(window.location.pathname + window.location.search);
	}

	function iniziali(nome) {
		const parti = String(nome || "").trim().split(/\s+/).filter(Boolean);
		if (parti.length === 0) return "?";
		const a = parti[0].charAt(0);
		const b = parti.length > 1 ? parti[parti.length - 1].charAt(0) : "";
		return (a + b).toUpperCase();
	}

	/* Utente collegato in alto a destra: avatar, nome, ruoli e pulsante "Esci" */
	function fillUserBox() {
		const box = document.getElementById("nav-user");
		if (!box || !utente || box.dataset.ready) return;
		box.dataset.ready = "1";

		const nome = utente.nome || utente.username;
		const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
		setText("nav-user-name", nome);
		setText("nav-user-avatar", iniziali(nome));
		setText("nav-user-roles", (utente.ruoli || []).join(", "));
		box.title = utente.username ? "Collegato come " + utente.username : "";
		box.hidden = false;

		const logout = document.getElementById("nav-logout");
		if (logout) logout.addEventListener("click", function (ev) {
			ev.preventDefault();
			const done = () => { window.location.href = "Login.html"; };
			fetch("API/Auth.ashx?action=logout", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json", "X-Portale": "1" },
				body: "{}"
			}).then(done, done);
		});
	}

	function avvia() {
		fetch("API/Auth.ashx?action=me", { credentials: "same-origin", cache: "no-store" })
			.then(res => res.json())
			.then(data => {
				if (!data.authenticated) return goToLogin();
				utente = data;
				if (pageRiservata && !ha(pageRoles)) {
					window.location.replace("Portale.html");
					return;
				}
				document.documentElement.style.visibility = "";
				applicaRuoli(document);
				fillUserBox();
				window.PortaleUtente = { username: data.username, nome: data.nome, ruoli: data.ruoli || [], ha: ha };
				document.dispatchEvent(new CustomEvent("portale:utente", { detail: window.PortaleUtente }));
			})
			.catch(() => {
				// server non raggiungibile: si vede solo ciò che non richiede ruoli
				if (pageRiservata) window.location.replace("Portale.html");
			});

		/* Header e footer condivisi */
		const headerPlaceholder = document.getElementById("header-placeholder");
		if (headerPlaceholder) {
			const showHeader = html => {
				headerPlaceholder.innerHTML = html;
				applicaRuoli(headerPlaceholder);
				fillUserBox();
			};
			const cachedHeader = sessionStorage.getItem(HEADER_CACHE);
			if (cachedHeader) {
				showHeader(cachedHeader);
			} else {
				fetch("Header.html", { cache: "no-cache" })
					.then(response => {
						if (response.redirected) { goToLogin(); throw new Error("Sessione scaduta"); } // al posto dell'header sarebbe arrivata la pagina di login
						if (!response.ok) throw new Error("Header.html non trovato");
						return response.text();
					})
					.then(html => {
						sessionStorage.setItem(HEADER_CACHE, html);
						showHeader(html);
					})
					.catch(err => console.error("Errore nel caricamento dell'header:", err));
			}
		}

		const footerPlaceholder = document.getElementById("footer-placeholder");
		if (footerPlaceholder) {
			fetch("Footer.html")
				.then(res => {
					if (res.redirected) throw new Error("Sessione scaduta"); // sarebbe arrivata la pagina di login
					return res.text();
				})
				.then(data => {
					footerPlaceholder.innerHTML = data;
					applicaRuoli(footerPlaceholder);
				})
				.catch(err => console.error("Errore nel caricamento del Footer:", err));
		}
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
	else avvia();
})();
