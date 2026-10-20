document.addEventListener("DOMContentLoaded", function () {
	/* ============ Ruoli: chi vede cosa ============
	 I ruoli dell'utente arrivano da API/Auth.ashx?action=me (nel database ci sono solo i ruoli).
	 Cosa vede ogni ruolo si decide nelle pagine:

	   - un elemento con data-ruoli="Certificati,Safety" si vede solo con almeno uno di quei ruoli;
	   - una pagina con <meta name="ruoli" content="Certificati"> nell'<head> riporta alla Home chi non ha il ruolo;
	   - un elemento senza data-ruoli si vede sempre;
	   - il ruolo Admin vede tutto.

	 Dal JavaScript di una pagina: PortaleUtente.ha("Safety") dopo l'evento "portale:utente"
	 (es. document.addEventListener("portale:utente", e => { if (e.detail.ha("Safety")) ... })). */

	const ADMIN = "admin";
	const style = document.createElement("style");
	style.textContent = "[data-ruoli]:not(.ruolo-ok){display:none!important}";
	document.head.appendChild(style);

	const pageMeta = document.querySelector('meta[name="ruoli"]');
	if (pageMeta) document.documentElement.style.visibility = "hidden"; // niente contenuto finché non si sa se l'utente può vederla

	let utente = null; // risposta di "me", quando arriva

	function lista(text) {
		return String(text || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
	}
	function ha(ruoliRichiesti) {
		if (!utente) return false;
		const mie = (utente.ruoli || []).map(r => String(r).toLowerCase());
		if (mie.includes(ADMIN)) return true;
		return lista(ruoliRichiesti).some(r => mie.includes(r));
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

	/* Utente collegato: nome nell'header e pulsante "Esci" */
	function fillUserBox() {
		const box = document.getElementById("nav-user");
		if (!box || !utente || box.dataset.ready) return;
		box.dataset.ready = "1";
		document.getElementById("nav-user-name").textContent = utente.nome || utente.username;
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

	fetch("API/Auth.ashx?action=me", { credentials: "same-origin", cache: "no-store" })
		.then(res => res.json())
		.then(data => {
			if (!data.authenticated) return goToLogin();
			utente = data;
			if (pageMeta && !ha(pageMeta.getAttribute("content"))) {
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
			if (pageMeta) window.location.replace("Portale.html");
		});

	/* Header e footer condivisi */
	const headerPlaceholder = document.getElementById("header-placeholder");
	if (headerPlaceholder) {
		const showHeader = html => {
			headerPlaceholder.innerHTML = html;
			applicaRuoli(headerPlaceholder);
			fillUserBox();
		};
		const cachedHeader = sessionStorage.getItem("portal_header_html_v3"); // v3: con il link Gestione utenti
		if (cachedHeader) {
			showHeader(cachedHeader);
		} else {
			fetch("Header.html")
				.then(response => {
					if (response.redirected) { goToLogin(); throw new Error("Sessione scaduta"); } // al posto dell'header sarebbe arrivata la pagina di login
					if (!response.ok) throw new Error("Header.html non trovato");
					return response.text();
				})
				.then(html => {
					sessionStorage.setItem("portal_header_html_v3", html);
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
});
