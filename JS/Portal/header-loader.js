document.addEventListener("DOMContentLoaded", function () {
	const headerPlaceholder = document.getElementById("header-placeholder");
	if (!headerPlaceholder) return;

	const cachedHeader = sessionStorage.getItem("portal_header_html");

	if (cachedHeader) {
		headerPlaceholder.innerHTML = cachedHeader;
	} else {
		fetch("Header.html")
			.then(response => {
				if (!response.ok) throw new Error("Header.html non trovato");
				return response.text();
			})
			.then(html => {
				sessionStorage.setItem("portal_header_html", html);
				headerPlaceholder.innerHTML = html;
			})
			.catch(err => console.error("Errore nel caricamento dell'header:", err));
	}
	const footerPlaceholder = document.getElementById("footer-placeholder");
	if (footerPlaceholder) {
		fetch("Footer.html")
			.then(res => res.text())
			.then(data => {
				footerPlaceholder.innerHTML = data;
			})
			.catch(err => console.error("Errore nel caricamento del Footer:", err));
	}
});