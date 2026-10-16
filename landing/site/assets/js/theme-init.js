/* Aplica el tema guardado antes del primer pintado (evita el parpadeo). */
(function () {
	var d = document.documentElement;
	d.classList.add("js");
	try {
		var t = localStorage.getItem("knivchit-theme");
		if (t === "dark" || t === "light") d.setAttribute("data-theme", t);
	} catch (e) {}
})();
