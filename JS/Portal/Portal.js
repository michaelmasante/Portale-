document.addEventListener("DOMContentLoaded", function () {
    const REDIRECTS = {
        Cercavert: "Cercavert.html",
        Certificati: "Certificati.html",
        Prossimamente: "LavoriInCorso.html",
        UnireExcell: "UnireFileExcell.html"
    };
    const PAGE_VERSION = "0.1.0";

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
    document.querySelectorAll("[data-redirect]").forEach(function (el) {
        el.addEventListener("click", function (ev) {
            ev.preventDefault();
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