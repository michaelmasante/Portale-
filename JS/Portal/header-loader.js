document.addEventListener("DOMContentLoaded", function () {
	const headerPlaceholder = document.getElementById("header-placeholder");
	if (!headerPlaceholder) return;

	/* Utente collegato: mostra il nome nell'header e gestisce "Esci".
	 Se la sessione è scaduta torna alla pagina di login (e poi di nuovo qui).*/
	function goToLogin() {
		window.location.href = "Login.html?ReturnUrl=" + encodeURIComponent(window.location.pathname + window.location.search);
	}
	function setupUserBox() {
		const box = document.getElementById("nav-user");
		if (!box) return;
		fetch("API/Auth.ashx?action=me", { credentials: "same-origin", cache: "no-store" })
			.then(res => res.json())
			.then(data => {
				if (!data.authenticated) return goToLogin();
				document.getElementById("nav-user-name").textContent = data.nome || data.username;
				box.hidden = false;
			})
			.catch(() => { /* server non raggiungibile: la pagina resta com'è */ });

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

	const cachedHeader = sessionStorage.getItem("portal_header_html_v2"); // v2: la versione con l'utente collegato

	if (cachedHeader) {
		headerPlaceholder.innerHTML = cachedHeader;
		setupUserBox();
	} else {
		fetch("Header.html")
			.then(response => {
				if (response.redirected) { goToLogin(); throw new Error("Sessione scaduta"); } // al posto dell'header sarebbe arrivata la pagina di login
				if (!response.ok) throw new Error("Header.html non trovato");
				return response.text();
			})
			.then(html => {
				sessionStorage.setItem("portal_header_html_v2", html);
				headerPlaceholder.innerHTML = html;
				setupUserBox();
			})
			.catch(err => console.error("Errore nel caricamento dell'header:", err));
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
			})
			.catch(err => console.error("Errore nel caricamento del Footer:", err));
	}
});