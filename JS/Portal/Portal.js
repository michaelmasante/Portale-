document.addEventListener("DOMContentLoaded", function () {
    const REDIRECTS = {
        Carichi: "http://10.105.206.11/Carichi",
        CertificazioneCarichi: "http://10.105.206.11/CertificazioneCarichi",
        CheckList: "http://10.105.206.11/CheckList",
        Motori: "Motori.html",
        Controlli: "http://10.105.206.11/Controlli",
        Foto: "http://10.105.206.11/Foto",
        Im: "http://10.105.206.11/Im",
        Incompleti: "http://10.105.206.11/Incompleti",
        ITChat: "http://10.105.206.11/ITChat",
        Liv2: "http://10.105.206.11/Liv2",
        Mezzisollevamento: "http://10.105.206.11/Mezzisollevamento",
        Produzione: "http://10.105.206.11/Produzione"
    };

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