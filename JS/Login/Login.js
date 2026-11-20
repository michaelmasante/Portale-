document.addEventListener("DOMContentLoaded", function () {
	const API = "API/Auth.ashx";
	const HOME = "Portale.html";

	const message = document.getElementById("login-message");
	const forms = { login: document.getElementById("form-login") };

	function safeTarget(url) {
		if (!url || url.length > 500 || /[\x00-\x1f\\]/.test(url)) return HOME;
		const internal = (url[0] === "/" && url.slice(0, 2) !== "//") || /^[A-Za-z0-9_.-]+\.html(\?\S*)?$/.test(url);
		if (!internal) return HOME;
		const path = url.split(/[?#]/)[0].toLowerCase();
		if (path === "login.html" || path.endsWith("/login.html") || path.includes("/api/")) return HOME;
		return url;
	}
	const target = safeTarget(new URLSearchParams(window.location.search).get("ReturnUrl"));

	// Accesso con Microsoft: si torna alla pagina richiesta
	const ms = document.getElementById("login-microsoft");
	if (ms) ms.href = "API/Entra.ashx?ReturnUrl=" + encodeURIComponent(target);
	const admin = document.getElementById("login-admin");
	if (admin) admin.addEventListener("toggle", () => { if (admin.open) document.getElementById("login-username").focus(); });

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

	document.querySelectorAll(".login-eye").forEach(btn => {
		btn.addEventListener("click", () => {
			const input = document.getElementById(btn.dataset.target);
			const show = input.type === "password";
			input.type = show ? "text" : "password";
			btn.textContent = show ? "Nascondi" : "Mostra";
			btn.setAttribute("aria-label", show ? "Nascondi la password" : "Mostra la password");
		});
	});

	function post(action, data) {
		return fetch(API + "?action=" + action, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json", "X-Portale": "1" },
			body: JSON.stringify(data)
		}).then(res => res.json())
			.catch(() => ({ ok: false, message: "Il servizio di accesso non risponde. Avvisa l'amministratore." }));
	}

	function busy(form, on, label) {
		const btn = form.querySelector(".login-submit");
		if (on) { btn.dataset.label = btn.textContent; btn.textContent = "Attendere..."; }
		else btn.textContent = btn.dataset.label || label;
		btn.disabled = on;
	}

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

	const qs = new URLSearchParams(window.location.search);
	if (qs.get("entra")) {
		const msg = (qs.get("msg") || "Accesso con Microsoft non riuscito.").slice(0, 300);
		showMessage(msg, qs.get("entra") === "attesa" ? "ok" : "error");
	}

	fetch(API + "?action=me", { credentials: "same-origin", cache: "no-store" })
		.then(res => res.json())
		.then(d => { if (d && d.authenticated) window.location.replace(target); })
		.catch(() => {  });
});
