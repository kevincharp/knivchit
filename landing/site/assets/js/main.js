/* Knivchit — comportamiento mínimo de la web: tema, demostración y medida del recuadro. */
(function () {
	"use strict";
	var root = document.documentElement;

	/* Tema: oscuro por defecto (sin atributo) o claro, guardado en localStorage. */
	var buttons = document.querySelectorAll("[data-set-theme]");
	function stored() {
		try { return localStorage.getItem("knivchit-theme"); } catch (e) { return null; }
	}
	function paint(pref) {
		for (var i = 0; i < buttons.length; i++) {
			buttons[i].setAttribute("aria-pressed", String(buttons[i].dataset.setTheme === pref));
		}
	}
	paint(stored() === "light" ? "light" : "dark");
	for (var i = 0; i < buttons.length; i++) {
		buttons[i].addEventListener("click", function () {
			var pref = this.dataset.setTheme;
			try {
				localStorage.setItem("knivchit-theme", pref);
			} catch (e) {}
			root.setAttribute("data-theme", pref);
			paint(pref);
		});
	}

	/* Botones «copiar»: copian el texto del bloque y lo anuncian con un texto (región role=status). */
	var copyBtns = document.querySelectorAll("[data-copy]");
	for (var c = 0; c < copyBtns.length; c++) {
		copyBtns[c].addEventListener("click", function () {
			var btn = this, label = btn.textContent;
			var text = document.getElementById(btn.dataset.copy).textContent;
			var status = btn.parentNode.querySelector("[data-copy-status]");
			function done(msg) {
				btn.textContent = msg; status.textContent = msg;
				setTimeout(function () { btn.textContent = label; status.textContent = ""; }, 2000);
			}
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(text).then(function () { done(btn.dataset.copied); }, function () { done(btn.dataset.failed); });
			} else done(btn.dataset.failed);
		});
	}

	/* Demostración en tres pasos (pestañas accesibles con flechas). */
	var tabs = document.querySelectorAll("[data-steps] [role=tab]");
	var stage = document.getElementById("stage");
	var panel = document.getElementById("stage-panel");
	if (stage && tabs.length) {
		var screen = stage.querySelector("[data-alts]");
		var alts = screen.dataset.alts.split("||");
		function select(n, focus) {
			stage.dataset.step = String(n);
			for (var i = 0; i < tabs.length; i++) {
				var on = i === n - 1;
				tabs[i].setAttribute("aria-selected", String(on));
				tabs[i].tabIndex = on ? 0 : -1;
				if (on) {
					panel.setAttribute("aria-labelledby", tabs[i].id);
					if (focus) tabs[i].focus();
				}
			}
			screen.setAttribute("aria-label", alts[n - 1]);
		}
		select(1, false);
		for (var j = 0; j < tabs.length; j++) {
			tabs[j].addEventListener("click", function () { select(Number(this.dataset.step), false); });
			tabs[j].addEventListener("keydown", function (e) {
				var cur = Number(this.dataset.step), next = 0;
				if (e.key === "ArrowDown" || e.key === "ArrowRight") next = cur % tabs.length + 1;
				else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (cur + tabs.length - 2) % tabs.length + 1;
				else if (e.key === "Home") next = 1;
				else if (e.key === "End") next = tabs.length;
				if (next) { e.preventDefault(); select(next, true); }
			});
		}
	}

	/* El recuadro del héroe muestra su tamaño real, como el del capturador. */
	var sel = document.querySelector("[data-hero-sel]");
	var readout = document.querySelector("[data-readout]");
	if (sel && readout && "ResizeObserver" in window) {
		new ResizeObserver(function () {
			readout.textContent = Math.round(sel.offsetWidth) + " × " + Math.round(sel.offsetHeight);
		}).observe(sel);
	}
})();
