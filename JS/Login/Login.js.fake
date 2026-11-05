document.addEventListener("DOMContentLoaded", function () {
	const API = "API/Auth.ashx";
	const HOME = "Portale.html";

	const message = document.getElementById("login-message");
	const tabs = [...document.querySelectorAll(".login-tab")];
	const forms = { login: document.getElementById("form-login"), register: document.getElementById("form-register") };

	/* Dove andare dopo l'accesso: ASP.NET manda qui con ?ReturnUrl=/Pagina.html
	 Si accettano solo indirizzi interni al sito (la stessa regola è ripetuta dal server).*/
	function safeTarget(url) {
		if (!url || url.length > 500 || /[\x00-\x1f\\]/.test(url)) return HOME;
		const internal = (url[0] === "/" && url.slice(0, 2) !== "//") || /^[A-Za-z0-9_.-]+\.html(\?\S*)?$/.test(url);
		if (!internal) return HOME;
		const path = url.split(/[?#]/)[0].toLowerCase();
		if (path === "login.html" || path.endsWith("/login.html") || path.includes("/api/")) return HOME;
		return url;
	}
	const target = safeTarget(new URLSearchParams(window.location.search).get("ReturnUrl"));

	/* Già collegato (o login di sviluppo attivo in locale, voce LoginSviluppo nel Web.config): si entra subito */
	fetch(API + "?action=me", { credentials: "same-origin", cache: "no-store" })
		.then(res => res.json())
		.then(d => { if (d.authenticated) window.location.replace(target); })
		.catch(() => { /* resta la pagina di login */ });

	/* ---- messaggi ---- */
	function showMessage(text, kind) {
		message.textContent = text;
		message.className = "login-message " + (kind === "ok" ? "is-ok" : "is-error");
		message.hidden = false;
	}
	function clearMessage() {
		message.hidden = true;
		message.textContent = "";
	}
	function markInvalid(...inputs) {
		document.querySelectorAll(".login-form input").forEach(i => i.classList.remove("is-invalid"));
		inputs.forEach(i => i.classList.add("is-invalid"));
		if (inputs[0]) inputs[0].focus();
	}

	/* ---- schede Accedi / Registrati ---- */
	function showForm(name, focus) {
		tabs.forEach(t => {
			const on = t.dataset.form === name;
			t.classList.toggle("active", on);
			t.setAttribute("aria-selected", on ? "true" : "false");
			t.tabIndex = on ? 0 : -1;
		});
		Object.keys(forms).forEach(k => { forms[k].hidden = k !== name; });
		document.querySelectorAll(".login-form input").forEach(i => i.classList.remove("is-invalid"));
		if (focus !== false) forms[name].querySelector("input").focus();
	}
	tabs.forEach((t, i) => {
		t.addEventListener("click", () => { clearMessage(); showForm(t.dataset.form); });
		t.addEventListener("keydown", e => {
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
			const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
			clearMessage();
			showForm(next.dataset.form, false);
			next.focus();
		});
	});

	/* ---- mostra / nascondi la password ---- */
	document.querySelectorAll(".login-eye").forEach(btn => {
		btn.addEventListener("click", () => {
			const input = document.getElementById(btn.dataset.target);
			const show = input.type === "password";
			input.type = show ? "text" : "password";
			btn.textContent = show ? "Nascondi" : "Mostra";
			btn.setAttribute("aria-label", show ? "Nascondi la password" : "Mostra la password");
		});
	});

	/* ---- chiamata al server ---- */
	function post(action, data) {
		return fetch(API + "?action=" + action, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json", "X-Portale": "1" },
			body: JSON.stringify(data)
		}).then(res => res.json())
			.catch(() => ({ ok: false, message: "Il servizio di accesso non risponde. Avvisa l'amministratore." }));
	}

	/* Disabilita il pulsante mentre si aspetta la risposta */
	function busy(form, on, label) {
		const btn = form.querySelector(".login-submit");
		if (on) { btn.dataset.label = btn.textContent; btn.textContent = "Attendere..."; }
		else btn.textContent = btn.dataset.label || label;
		btn.disabled = on;
	}

	/* ---- Accedi ---- */
	forms.login.addEventListener("submit", e => {
		e.preventDefault();
		clearMessage();
		const user = document.getElementById("login-username");
		const pass = document.getElementById("login-password");
		if (!user.value.trim()) { showMessage("Inserisci il nome utente.", "error"); return markInvalid(user); }
		if (!pass.value) { showMessage("Inserisci la password.", "error"); return markInvalid(pass); }

		busy(forms.login, true);
		post("login", { username: user.value.trim(), password: pass.value, returnUrl: target }).then(d => {
			if (d.ok) {
				window.location.replace(d.redirect || HOME);
				return;
			}
			busy(forms.login, false);
			showMessage(d.message || "Accesso non riuscito.", "error");
			pass.value = "";
			markInvalid(pass);
		});
	});

	/* ---- Registrati ---- */
	forms.register.addEventListener("submit", e => {
		e.preventDefault();
		clearMessage();
		const nome = document.getElementById("reg-nome");
		const user = document.getElementById("reg-username");
		const mail = document.getElementById("reg-email");
		const pass = document.getElementById("reg-password");
		const pass2 = document.getElementById("reg-password2");

		if (nome.value.trim().length < 2) { showMessage("Scrivi nome e cognome.", "error"); return markInvalid(nome); }
		if (!/^[A-Za-z0-9._@-]{3,50}$/.test(user.value.trim())) {
			showMessage("Il nome utente deve avere da 3 a 50 caratteri: lettere, numeri, punto, trattino, trattino basso o @.", "error");
			return markInvalid(user);
		}
		if (mail.value.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.value.trim())) {
			showMessage("L'indirizzo email non è valido.", "error");
			return markInvalid(mail);
		}
		if (pass.value.length < 8) { showMessage("La password deve avere almeno 8 caratteri.", "error"); return markInvalid(pass); }
		if (pass.value !== pass2.value) { showMessage("Le due password non sono uguali.", "error"); return markInvalid(pass2); }

		busy(forms.register, true);
		post("register", { nome: nome.value.trim(), username: user.value.trim(), email: mail.value.trim(), password: pass.value }).then(d => {
			busy(forms.register, false);
			if (!d.ok) {
				showMessage(d.message || "Registrazione non riuscita.", "error");
				return;
			}
			// registrazione fatta: si torna alla scheda Accedi con il nome utente già scritto
			const name = user.value.trim();
			forms.register.reset();
			showForm("login", false);
			document.getElementById("login-username").value = name;
			document.getElementById("login-password").value = "";
			showMessage(d.message || "Registrazione completata.", "ok");
			document.getElementById("login-password").focus();
		});
	});

	/* Chi ha già fatto il login non deve rivedere questa pagina */
	fetch(API + "?action=me", { credentials: "same-origin", cache: "no-store" })
		.then(res => res.json())
		.then(d => { if (d && d.authenticated) window.location.replace(target); })
		.catch(() => { /* server non raggiungibile: si resta qui */ });
});
