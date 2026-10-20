document.addEventListener("DOMContentLoaded", function () {
    const REDIRECTS = {
        Cercavert: "Cercavert.html",
        Certificati: "Certificati.html",
        Prossimamente: "LavoriInCorso.html",
        UnireExcell: "UnireFileExcell.html"
    };
    const PAGE_VERSION = "0.2.0";

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    /* Caricamento Async del Footer per aggiungere dettagli della pagina*/
    function addVersionToFooter() {
        const placeholder = document.getElementById("footer-placeholder");
        if (!placeholder) return;

        const tryInsert = () => {
            const container = placeholder.querySelector(".footer-container");
            if (!container) return false;
            if (!container.querySelector(".footer-right")) {
                const right = document.createElement("div");
                right.className = "footer-right";
                right.innerHTML = `<span>Versione ${escapeHtml(PAGE_VERSION)}</span>`;
                container.appendChild(right);
            }
            return true;
        };

        if (tryInsert()) return;
        const observer = new MutationObserver(() => { if (tryInsert()) observer.disconnect(); });
        observer.observe(placeholder, { childList: true, subtree: true });
    }
    addVersionToFooter();

    /* Tile bloccate: i ruoli si scrivono SOLO nella pagina di destinazione (<meta name="ruoli" ...>).
       Qui si legge quel meta e, se l'utente non ha il ruolo, la tile diventa grigia con il lucchetto. */
    function ruoliDellaPagina(url) {
        return fetch(url, { credentials: "same-origin", cache: "no-cache" })
            .then(res => (res.ok && !res.redirected) ? res.text() : "")
            .then(html => {
                const meta = new DOMParser().parseFromString(html, "text/html").querySelector('meta[name="ruoli"]');
                return meta ? meta.getAttribute("content") || "" : "";
            })
            .catch(() => "");
    }

    function bloccaTile(el, ruoli) {
        const card = el.closest(".card") || el;
        card.classList.add("tile-bloccata");
        el.setAttribute("aria-disabled", "true");
        el.dataset.bloccata = "1";
        el.title = "Accesso riservato al ruolo: " + ruoli.split(",").map(s => s.trim()).filter(Boolean).join(", ");
    }

    function applicaRuoliTile(utente) {
        const perUrl = {};
        document.querySelectorAll("[data-redirect]").forEach(function (el) {
            const url = REDIRECTS[el.getAttribute("data-redirect")];
            if (!url || url === "#") return;
            (perUrl[url] = perUrl[url] || []).push(el);
        });
        Object.keys(perUrl).forEach(function (url) {
            ruoliDellaPagina(url).then(function (ruoli) {
                if (!utente.ha(ruoli)) perUrl[url].forEach(el => bloccaTile(el, ruoli));
            });
        });
    }

    if (window.PortaleUtente) applicaRuoliTile(window.PortaleUtente);
    else document.addEventListener("portale:utente", e => applicaRuoliTile(e.detail), { once: true });

    document.querySelectorAll("[data-redirect]").forEach(function (el) {
        el.addEventListener("click", function (ev) {
            ev.preventDefault();
            if (el.dataset.bloccata) return; // l'utente non ha il ruolo per questa pagina
            const key = el.getAttribute("data-redirect");
            const url = REDIRECTS[key];
            if (url && url !== "#") {
                window.open(url, '_blank');
            } else {
                console.warn("Nessun redirect configurato per: " + key);
            }
        });
    });
});