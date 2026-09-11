/* A stand-in for the gateway's Hosted Fields bundle, served from the emulator origin.
 *
 * The contract it has to satisfy is fixed by shared/public/checkout.js and typed in
 * nextjs/src/shared/lib/hosted-fields.d.ts:
 *
 *   window.onHostedFieldsReady(HostedFields)
 *   HostedFields.init({ endpointId, fields, onReady, onToken, onError }) -> { tokenize, setStyle }
 *
 * Each card container gets a real cross-origin iframe from this origin, so the pages' CSP
 * (`frame-src {SDK_ORIGIN}`) is exercised rather than worked around, and the containers keep the
 * promise they make in the markup: they stay empty, and the merchant page cannot read a value.
 *
 * Plain ES5, like everything else served to these pages.
 */
(() => {
	var ORIGIN = (() => {
		var script = document.currentScript;
		var src = script ? script.src : "";
		return src ? new URL(src).origin : window.location.origin;
	})();

	function HostedFieldsInstance(options) {
		this.options = options;
		this.frames = {};
		this.ids = [];
		this.ready = {};
		this.values = {};
		this.collecting = null;
	}

	HostedFieldsInstance.prototype.mount = function () {
		var fields = this.options.fields || {};

		for (var id in fields) {
			if (!Object.hasOwn(fields, id)) {
				continue;
			}
			var container = document.getElementById(id);
			if (!container) {
				continue;
			}

			this.ids.push(id);

			var descriptor = fields[id];
			var frame = document.createElement("iframe");
			frame.title = descriptor.type;
			frame.setAttribute("data-hf-field", id);
			// The container draws the border and the rings; the iframe is only the value.
			frame.style.width = "100%";
			frame.style.height = "100%";
			frame.style.border = "0";
			frame.style.display = "block";
			frame.src =
				ORIGIN +
				"/hf/" +
				encodeURIComponent(descriptor.type) +
				"?id=" +
				encodeURIComponent(id) +
				"&placeholder=" +
				encodeURIComponent(descriptor.placeholder || "");

			container.appendChild(frame);
			this.frames[id] = frame;
		}

		window.addEventListener("message", (event) => {
			this.onMessage(event);
		});
	};

	HostedFieldsInstance.prototype.onMessage = function (event) {
		if (event.origin !== ORIGIN) {
			return;
		}
		var data = event.data;
		if (!data || data.hf !== true || !data.id) {
			return;
		}

		var container = document.getElementById(data.id);

		if (data.type === "ready") {
			this.ready[data.id] = true;
			this.setStyle(
				data.id,
				this.options.fields[data.id] && this.options.fields[data.id].style,
			);
			if (this.allReady() && this.options.onReady) {
				this.options.onReady();
			}
			return;
		}

		/* The SDK owns these classes because :focus-within does not cross an origin boundary. They
       go on with classList so that React, which owns the same element in the Next.js example,
       never sees an attribute it thinks it should rewrite. */
		if (data.type === "focus" && container) {
			container.classList.add("hf-field--focus");
			return;
		}
		if (data.type === "blur" && container) {
			container.classList.remove("hf-field--focus");
			return;
		}
		if (data.type === "input" && container) {
			if (data.filled) {
				container.classList.add("hf-field--filled");
			} else {
				container.classList.remove("hf-field--filled");
			}
			return;
		}
		if (data.type === "value") {
			this.values[data.id] = data.value;
			this.finishCollecting();
		}
	};

	HostedFieldsInstance.prototype.allReady = function () {
		for (var i = 0; i < this.ids.length; i++) {
			if (!this.ready[this.ids[i]]) {
				return false;
			}
		}
		return this.ids.length > 0;
	};

	HostedFieldsInstance.prototype.post = function (id, message) {
		var frame = this.frames[id];
		if (frame && frame.contentWindow) {
			message.hf = true;
			message.id = id;
			frame.contentWindow.postMessage(message, ORIGIN);
		}
	};

	/* Called for all three fields on every theme change. The real SDK filters the bag against an
     allowlist; here it only has to reach the iframe. */
	HostedFieldsInstance.prototype.setStyle = function (id, style) {
		if (!style) {
			return;
		}
		this.post(id, { type: "style", style: style });
	};

	HostedFieldsInstance.prototype.tokenize = function (ephemeralTicket) {
		this.collecting = { ticket: ephemeralTicket, want: this.ids.slice() };
		this.values = {};
		for (var i = 0; i < this.ids.length; i++) {
			this.post(this.ids[i], { type: "collect" });
		}
	};

	HostedFieldsInstance.prototype.finishCollecting = function () {
		var pending = this.collecting;
		if (!pending) {
			return;
		}

		for (var i = 0; i < pending.want.length; i++) {
			if (typeof this.values[pending.want[i]] !== "string") {
				return;
			}
		}
		this.collecting = null;
		fetch(ORIGIN + "/api/v4/tokenize/hosted-fields", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				ephemeralTicket: pending.ticket,
				cardNumber: this.values.cardNumber,
				expiryDate: this.values.expiryDate,
				cvv: this.values.cvv,
			}),
		})
			.then((response) => response.json())
			.then((reply) => {
				if (reply.hostedFieldsToken) {
					this.options.onToken(reply.hostedFieldsToken);
					return;
				}
				this.fail(
					reply.code || 5000,
					reply.message || "tokenization failed",
					reply.payerMessage,
					reply.field,
				);
			})
			.catch((error) => {
				this.fail(5001, error.message, undefined, undefined);
			});
	};

	HostedFieldsInstance.prototype.fail = function (
		code,
		message,
		payerMessage,
		field,
	) {
		if (!this.options.onError) {
			return;
		}
		this.options.onError({
			code: code,
			message: message,
			tip: "emulated by e2e-tests",
			field: field,
			payerMessage: payerMessage,
		});
	};

	var HostedFields = {
		init: (options) => {
			var instance = new HostedFieldsInstance(options);
			instance.mount();
			return {
				tokenize: (ticket) => {
					instance.tokenize(ticket);
				},
				setStyle: (id, style) => {
					instance.setStyle(id, style);
				},
				destroy: () => {},
			};
		},
	};

	window.HostedFields = HostedFields;

	/* checkout.js appends this script tag *before* it assigns window.onHostedFieldsReady, and
     relies on `async` to keep the bundle from running first. The React example assigns it from
     an effect, which can land later still. So wait for the handler rather than assuming it. */
	var waited = 0;
	(function announce() {
		if (typeof window.onHostedFieldsReady === "function") {
			window.onHostedFieldsReady(HostedFields);
			return;
		}
		if (waited > 5000) {
			console.error(
				"[hosted-fields-emulator] window.onHostedFieldsReady was never assigned",
			);
			return;
		}
		waited += 20;
		setTimeout(announce, 20);
	})();
})();
