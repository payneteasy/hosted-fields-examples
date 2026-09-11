/* The inside of one card field.
 *
 * It talks to the SDK shim in the parent page over postMessage and nothing else: no value ever
 * leaves this origin except as part of a tokenize call. Plain ES5, like the rest of the browser
 * code in this repository.
 */
(() => {
	var params = new URLSearchParams(window.location.search);
	var id = params.get("id") || "";
	var input = document.getElementById("value");

	input.placeholder = params.get("placeholder") || "";

	function send(message) {
		message.hf = true;
		message.id = id;
		// The parent is the merchant page, whose origin we do not know ahead of time. The SDK shim
		// checks our origin on its side, which is the direction that matters.
		window.parent.postMessage(message, "*");
	}

	input.addEventListener("focus", () => {
		send({ type: "focus" });
	});
	input.addEventListener("blur", () => {
		send({ type: "blur" });
	});
	input.addEventListener("input", () => {
		send({ type: "input", filled: input.value.length > 0 });
	});

	/* The style bag is the only way the merchant can reach in here, and the real SDK filters it
     against an allowlist of properties. Applying it is what keeps the seam invisible across a
     theme change. */
	function applyStyle(style) {
		if (!style) {
			return;
		}
		assign(input.style, style.input);
		if (style.placeholder && style.placeholder.color) {
			input.style.setProperty("--placeholder-color", style.placeholder.color);
		}
	}

	function assign(target, source) {
		if (!source) {
			return;
		}
		for (var key in source) {
			if (Object.hasOwn(source, key)) {
				target[key] = source[key];
			}
		}
	}

	window.addEventListener("message", (event) => {
		var data = event.data;
		if (!data || data.hf !== true || data.id !== id) {
			return;
		}

		if (data.type === "style") {
			applyStyle(data.style);
			return;
		}
		if (data.type === "collect") {
			send({ type: "value", value: input.value });
		}
	});

	send({ type: "ready" });
})();
