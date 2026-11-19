// Scheda Per PN Motore: tabellina delle settimane (da quella corrente a +12) con lo stato EPA della famiglia del motore.
// Stesse regole del Tracker EPA (TrackerEpa.js) per leggere stati e settimane.
(function () {
	const SETTIMANE = 13;
	const GIORNO = 86400000;
	const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	const up = v => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();

	function settimanaIso(d) {
		const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
		const g = t.getUTCDay() || 7;
		t.setUTCDate(t.getUTCDate() + 4 - g);
		const inizio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
		return { anno: t.getUTCFullYear(), sett: Math.ceil(((t - inizio) / GIORNO + 1) / 7) };
	}
	function indice(anno, sett) {
		const quattro = Date.UTC(anno, 0, 4);
		const dow = new Date(quattro).getUTCDay() || 7;
		const lunedi = quattro - (dow - 1) * GIORNO + (sett - 1) * 7 * GIORNO;
		return Math.round((lunedi / GIORNO - 4) / 7);
	}
	function daIndice(i) {
		const giovedi = new Date((i * 7 + 4 + 3) * GIORNO);
		return settimanaIso(new Date(giovedi.getUTCFullYear(), giovedi.getUTCMonth(), giovedi.getUTCDate()));
	}
	const cw = w => `CW${String(w.sett).padStart(2, "0")}`;

	let mappa = null, oggi = null, annoBase = null;

	function leggiSettimana(v) {
		const m = up(v).replace(/^CW\s*/, "").match(/^(\d{1,2})(?:\s*\/\s*(\d{4}))?$/);
		if (!m) return null;
		const sett = Number(m[1]);
		if (sett < 1 || sett > 53) return null;
		const anno = m[2] ? Number(m[2]) : annoBase;
		return { anno, sett, i: indice(anno, sett) };
	}

	function tipo(v) {
		const s = up(v);
		if (!s) return "vuota";
		if (s === "APPROVED") return "approvata";
		if (s === "SUBMITTED") return "inviata";
		if (s === "TO BE APPROVED" || s === "PENDING") return "attesa";
		if (s === "TO BE SUBMITTED") return "dafare";
		if (s === "STAND BY") return "standby";
		if (s === "PHASED OUT") return "phased";
		if (s === "NA" || s === "N/A") return "na";
		if (leggiSettimana(s)) return "approvata";
		return "attesa";
	}

	// Stato EPA della famiglia: approvata, submitted, pending, niente, oppure non richiesta
	function statoFamiglia(r) {
		const sub = tipo(r.EpaSottomissione), app = tipo(r.EpaApprovazione);
		const settApp = leggiSettimana(r.EpaApprovazioneSett) || leggiSettimana(r.EpaApprovazione);
		const settSub = leggiSettimana(r.EpaSottomissioneSett);
		if (app === "approvata") return { stato: "approvata", nome: "Approvata", sett: settApp };
		if ([sub, app].some(t => t === "na" || t === "phased" || t === "standby"))
			return { stato: "na", nome: { na: "Non richiesta", phased: "Phased out", standby: "Stand by" }[[sub, app].find(t => t === "na" || t === "phased" || t === "standby")], sett: null };
		if (sub === "inviata" || sub === "approvata" || app === "inviata") return { stato: "submitted", nome: "Submitted", sett: settApp };
		if (app === "attesa" || sub === "attesa") return { stato: "pending", nome: "Pending", sett: settApp || settSub };
		return { stato: "niente", nome: "Non ancora sottomessa", sett: settSub };
	}

	function prepara() {
		const c = window.CertificatiDati || {};
		const epa = c.epa;
		if (!epa || !epa.righe) return false;
		const anno = (window.CertificatiAnno || {}).anno;
		oggi = settimanaIso(anno ? new Date(anno, 11, 31) : new Date());
		const dataFile = epa.ultimo && epa.ultimo.data ? new Date(String(epa.ultimo.data).slice(0, 10)) : null;
		annoBase = dataFile && !isNaN(dataFile) ? dataFile.getFullYear() : oggi.anno;
		const col = epa.colonne || [];
		mappa = new Map();
		epa.righe.forEach(riga => {
			const r = {};
			col.forEach((n, i) => { r[n] = riga[i]; });
			const base = up(r.Famiglia).split(" ")[0];
			if (base && !mappa.has(base)) mappa.set(base, r);
		});
		return true;
	}

	function famigliaUs(v) {
		const m = up(v).match(/(\d{2}\.\d[A-Z0-9]{3})$/);
		return m ? m[1] : "";
	}

	function html(riga) {
		if (!mappa && !prepara()) return "";
		const f = famigliaUs(riga["REF. US FAMILY"]);
		const r = f ? mappa.get(f) : null;
		if (!r) return "";
		const s = statoFamiglia(r);
		const i0 = indice(oggi.anno, oggi.sett);
		const settimane = [];
		for (let k = 0; k < SETTIMANE; k++) settimane.push({ i: i0 + k, w: daIndice(i0 + k) });

		const colore = x => {
			if (s.stato === "approvata") return "ok";
			if (s.stato === "na") return "na";
			if (s.stato === "niente") return "rosso";
			if (!s.sett) return s.stato === "pending" ? "pending" : "blu";
			return x.i <= s.sett.i ? (s.stato === "pending" ? "pending" : "blu") : "rosso";
		};
		const titolo = x => `${cw(x.w)}/${x.w.anno}: ` + ({ ok: "approvata", na: s.nome.toLowerCase(), rosso: s.stato === "niente" ? "nessuna sottomissione" : "oltre la settimana prevista", blu: "submitted", pending: "pending" })[colore(x)];
		const quando = s.stato === "approvata" ? "approvata" : s.stato === "niente" ? "sottomissione prevista" : "approvazione prevista";
		const prevista = s.sett && s.stato !== "na" ? ` · ${quando} ${cw(s.sett)}${s.sett.anno !== oggi.anno ? "/" + s.sett.anno : ""}` : "";
		const ritardo = s.sett && (s.stato === "submitted" || s.stato === "pending") && s.sett.i < i0;

		return `<div class="epa-sett-box">
			<div class="epa-sett-titolo">EPA <strong>${esc(r.Famiglia)}</strong> · <span class="epa-sett-stato epa-sett-stato--${s.stato}${ritardo ? " epa-sett-stato--ritardo" : ""}">${esc(s.nome)}${esc(prevista)}${ritardo ? " (passata)" : ""}</span></div>
			<table class="cert-detail-table epa-sett-table">
				<thead><tr>${settimane.map((x, k) => `<th class="cert-month-col${k === 0 ? " epa-sett-oggi" : ""}" title="${k === 0 ? "Settimana corrente" : ""}">${k === 0 ? `<span class="epa-sett-ora">oggi</span>` : ""}${x.w.sett}</th>`).join("")}</tr></thead>
				<tbody><tr>${settimane.map((x, k) => `<td class="cert-month-col${k === 0 ? " epa-sett-oggi" : ""}" title="${esc(titolo(x))}"><div class="cert-month-bar epa-sett-bar--${colore(x)}"></div></td>`).join("")}</tr></tbody>
			</table>
			<div class="epa-sett-nota">Settimana corrente: <strong>${cw(oggi)}/${oggi.anno}</strong></div>
		</div>`;
	}

	window.CertificatiSettimane = { html, azzera() { mappa = null; } };
})();
