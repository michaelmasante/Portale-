// Scelta fra i dati di oggi e la fotografia al 31/12 di un anno passato (?anno=XXXX nell'indirizzo)
(function () {
	const API = "API/Certificati.ashx";
	const p = new URLSearchParams(window.location.search);
	const a = /^\d{4}$/.test(p.get("anno") || "") ? Number(p.get("anno")) : null;
	window.CertificatiAnno = { anno: a, q: a ? "&anno=" + a : "" };

	const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

	function vai(anno) {
		const u = new URL(window.location.href);
		if (anno) u.searchParams.set("anno", anno); else u.searchParams.delete("anno");
		window.location.href = u.toString();
	}

	async function avvia() {
		const h1 = document.querySelector("main h1");
		if (!h1) return;
		const barra = document.createElement("div");
		barra.className = "anno-barra";
		barra.innerHTML = `<label for="anno-scelta">Stato dei dati</label>
			<select id="anno-scelta"><option value="">Oggi</option>${a ? `<option value="${a}" selected>31/12/${a}</option>` : ""}</select>
			<span class="anno-nota" id="anno-nota"></span>`;
		h1.insertAdjacentElement("afterend", barra);
		if (a) {
			document.body.classList.add("cert-passato");
			const avviso = document.createElement("div");
			avviso.className = "anno-avviso";
			avviso.innerHTML = `<span>&#128247; Stai guardando la <strong>fotografia al 31/12/${a}</strong>: i dati sono quelli di fine anno e non si possono modificare.</span>
				<button type="button" class="cx-btn cx-btn-outline cx-btn-sm" id="anno-oggi">Torna a oggi</button>`;
			barra.insertAdjacentElement("afterend", avviso);
			avviso.querySelector("#anno-oggi").addEventListener("click", () => vai(null));
		}
		const sel = barra.querySelector("#anno-scelta");
		sel.addEventListener("change", () => vai(sel.value || null));

		const nota = barra.querySelector("#anno-nota");
		try {
			const res = await fetch(API + "?action=anni", { credentials: "same-origin", cache: "no-store" });
			const d = await res.json();
			if (!d || d.ok === false) throw new Error(d && d.message);
			const anni = (d.anni || []).filter(x => x !== a);
			anni.forEach(x => sel.insertAdjacentHTML("beforeend", `<option value="${x}">31/12/${x}</option>`));
			if (!anni.length && !a) {
				sel.disabled = true;
				nota.textContent = `Gli anni passati saranno disponibili da gennaio ${(d.primoAnno || 2026) + 1} (prima fotografia: 31/12/${d.primoAnno || 2026}).`;
			}
		} catch (e) {
			if (!a) sel.disabled = true;
			nota.textContent = "Elenco degli anni non disponibile" + (e && e.message ? ": " + esc(e.message) : ".");
		}
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
	else avvia();
})();
