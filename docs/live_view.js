// Live view: replaces the upcoming maps list with the HLTV demo player in player/ (a copy of
// bspbot's build-web folder: bspguy.js, bspguy.wasm, index.html, coi-sw.js).
//
// Served by bspbot's web/serve.py (server_adv.bat), the player gets the stream and fastdl downloads
// through it, so it doesn't need the game server to have a WebSocket relay or CORS headers. Anywhere
// else (GitHub Pages), it connects to the game server directly (see web/README.md in bspbot): files
// come from fastdl, and the stream through the WebServer plugin's relay at <server_url>/hltv, since
// browsers can't open the HLTV port's TCP connection themselves.

var LIVE_SHOWED_MAPS_KEY = "live-view-showed-maps"; // the map list was hidden before the live view opened

function live_session_get(key) {
	try { return sessionStorage.getItem(key); } catch (e) { return null; }
}
function live_session_set(key, val) {
	try {
		if (val === null) sessionStorage.removeItem(key);
		else sessionStorage.setItem(key, val);
	} catch (e) {}
}

// Resolves to true when this page is served by bspbot's web/serve.py (server_adv.bat), which
// proxies the stream and fastdl for the player. It marks its responses with X-Bspguy-Relay.
// Other servers, such as a plain "python -m http.server", don't have the proxy.
var g_live_has_proxy = null;
function live_check_proxy() {
	if (g_live_has_proxy !== null)
		return Promise.resolve(g_live_has_proxy);
	if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname))
		return Promise.resolve(g_live_has_proxy = false);
	return fetch(location.pathname, { method: "HEAD", cache: "no-store" }).then(function(res) {
		return g_live_has_proxy = res.headers.get("X-Bspguy-Relay") === "1";
	}).catch(function() {
		return g_live_has_proxy = false;
	});
}

function live_server_config() {
	let selector = document.getElementById("server_selector");
	return (selector && g_server_configs[selector.value]) || g_server_config;
}

// The admin's password camera button opens the player without connect=1, so it shows its
// Connect dialog (with the server filled in) to enter the stream password instead of using the login.
var g_live_password_mode = false;
var LIVE_ADMIN_ID = 76561197970806204n; // same id hlcoop.js checks in parse_auth

// shows the admin-only buttons when logged in as the admin. Called by parse_auth and finish_logout.
function live_update_admin_buttons() {
	let admin = g_steamid == LIVE_ADMIN_ID;
	document.querySelectorAll(".live_admin_only").forEach(function(el) {
		el.classList.toggle("hidden", !admin);
	});
}

// The player logs in to the stream with the page's token cookie, so watching needs a Steam login.
// A token that hasn't been checked yet (the page is still connecting) gets a chance: the stream
// server checks it too, and the player says so if it's rejected.
function live_logged_in() {
	if (g_steamid > 1)
		return true;
	return g_steamid == 0 && !!getCookie("token"); // 1 = the server rejected the login
}

function live_player_url(hasProxy) {
	let config = live_server_config();
	let params = new URLSearchParams();
	params.set("server", config.hltv_address);
	if (!g_live_password_mode)
		params.set("connect", "1");
	if (!hasProxy) {
		params.set("direct", "1");
		params.set("stream", new URL("hltv", config.server_url).href);
	}
	// the player's testing options (see player/index.html), passed on from the dashboard's address
	let pageParams = new URLSearchParams(window.location.search);
	["lowmem", "reserve"].forEach(function(name) {
		if (pageParams.get(name))
			params.set(name, pageParams.get(name));
	});
	return "player/index.html?" + params.toString();
}

function live_status(text) {
	let status = document.getElementById("live_view_status");
	status.textContent = text;
	status.classList.toggle("hidden", !text);
}

function live_view_is_open() {
	return !document.getElementById("live_view").classList.contains("hidden");
}

function set_live_view_visible(visible) {
	document.getElementById("map_list_container").classList.toggle("live_active", visible);
	document.getElementById("live_view").classList.toggle("hidden", !visible);

	// the camera icons on the current map close the view while it's open, and show a red cross
	document.querySelectorAll(".watch_live_button").forEach(function(el) {
		el.classList.toggle("live_open", visible);
		if (!el.dataset.openTitle)
			el.dataset.openTitle = el.title;
		el.title = visible ? "Close the live view" : el.dataset.openTitle;
	});
}

// hlcoop.js's setup() may still be running (it's async), so this sets the state the same way its
// show/hide buttons do instead of clicking them. setup() calls handle_resize() itself when it finishes.
function set_maps_hidden(hidden) {
	document.getElementById("hide_maps_cb").checked = g_settings.hide_maps = hidden;
	save_settings();
	try {
		handle_resize();
		if (!hidden)
			update_map_data();
	} catch (e) {}
}

//
// The player uses this page's connection to the web server for chat and mutes (WebPlatform.cpp in
// bspbot), so the viewer isn't logged in a second time. Messages are only accepted from the player's
// frame on this origin.
//

var g_live_say_time = 0; // when the player last sent chat, so errors go to its chat instead of a popup

function live_frame_window() {
	let frame = document.querySelector("#live_view_frame_container iframe");
	return frame ? frame.contentWindow : null;
}

function live_post(msg) {
	let win = live_frame_window();
	if (win)
		win.postMessage(msg, location.origin);
}

// called whenever g_mutes or the login changes. null mutes = not logged in, so the player keeps
// its own mutes.
function live_send_mutes() {
	let mutes = null;
	if (g_steamid > 1) {
		mutes = Object.keys(g_mutes).map(function(id) {
			return [id, g_mutes[id]];
		});
	}
	live_post({ type: "bspguy_mutes", mutes: mutes });
}

// Chat translations into the viewer's language, which the player shows in place of the original
// like apply_translations does. items = [[steamid64, original, translation entry], ...] from
// g_translations, or all of them when null.
function live_send_translations(items) {
	if (!items) {
		items = [];
		Object.keys(g_translations).forEach(function(id) {
			Object.keys(g_translations[id]).forEach(function(original) {
				items.push([id, original, g_translations[id][original]]);
			});
		});
	}
	let langName = function(code) {
		return (typeof g_languages !== "undefined" && g_languages[code]) || code || "";
	};
	live_post({ type: "bspguy_translations", items: items.map(function(t) {
		return [String(t[0]), t[1], t[2].translated, langName(t[2].src_lang), langName(t[2].targ_lang)];
	}) });
}

// the Translations chat setting ("auto", "manual" or "disable"). Called by apply_chat_settings.
function live_send_translation_mode() {
	live_post({ type: "bspguy_translation_mode", mode: g_settings.translations });
}

// the text of the web app's popup for a WEBDENY_* reason
function live_deny_text(reason, errorCode) {
	let ids = {};
	ids[WEBDENY_NOT_LOGGED_IN_CHAT] = "popup-text-no-chat";
	ids[WEBDENY_BANNED] = "popup-text-banned";
	ids[WEBDENY_TOO_NEW] = "popup-text-too-new";
	ids[WEBDENY_RATE_LIMITED] = "popup-text-rate-limit";
	ids[WEBDENY_STEAM_ERROR] = "popup-text-steam-error";
	let el = ids[reason] ? document.getElementById(ids[reason]) : null;
	if (!el)
		return "Chat message denied (reason " + reason + ")";
	if (reason == WEBDENY_STEAM_ERROR)
		document.getElementById("popup-error-code").textContent = errorCode;
	return el.textContent.replace(/\s+/g, " ").trim();
}

// WEBMSG_NOT_AUTHED. Returns true if it was about chat the player just sent, which shows it in
// the player's chat instead of the popup.
function live_chat_denied(reason, errorCode) {
	if (!live_frame_window() || Date.now() - g_live_say_time > 10000)
		return false;
	g_live_say_time = 0;
	live_post({ type: "bspguy_error", text: live_deny_text(reason, errorCode) });
	return true;
}

// like send_message, without its input box
function live_say(text) {
	text = String(text).trim();
	if (!text)
		return;
	if (g_steamid <= 1) {
		live_post({ type: "bspguy_error", text: live_deny_text(WEBDENY_NOT_LOGGED_IN_CHAT, 0) });
		return;
	}
	if (!g_socket || g_socket.readyState != WebSocket.OPEN) {
		live_post({ type: "bspguy_error", text: "Failed to send chat message. Not connected." });
		return;
	}
	try {
		g_message_id = (g_message_id + 1) % 65536;
		g_socket.send("say;" + g_message_id + ";" + text);
		g_live_say_time = Date.now();
	} catch (e) {
		live_post({ type: "bspguy_error", text: "Failed to send. " + e });
	}
}

window.addEventListener("message", function(e) {
	if (e.origin !== location.origin || !e.data || e.source !== live_frame_window())
		return;

	if (e.data.type === "bspguy_ready") {
		live_post({ type: "bspguy_maximized", maximized: live_view_is_maximized() });
		live_send_mutes();
		live_send_translation_mode();
		live_send_translations(null);
	}
	else if (e.data.type === "bspguy_mute") {
		// same as handle_mute_toggle: the server toggles the bits and sends the new list
		let id = String(e.data.id);
		let bits = (e.data.bits | 0) & (FL_MUTE_VOICE | FL_MUTE_TEXT | FL_MUTE_SPRAY | FL_MUTE_MODEL);
		if (/^\d+$/.test(id) && bits && g_steamid > 1 && g_socket && g_socket.readyState == WebSocket.OPEN)
			g_socket.send("mute;" + id + ";" + bits);
		else
			live_send_mutes(); // undo the player's change
	}
	else if (e.data.type === "bspguy_say") {
		live_say(e.data.text);
	}
	else if (e.data.type === "bspguy_maximize") {
		set_live_view_maximized(!!e.data.maximized);
	}
});

// fills the page with the player and hides the rest of the dashboard, so the browser doesn't spend
// time drawing it. The player's toolbar has the button for it (bspguy_maximize).
function set_live_view_maximized(maximized) {
	let was_maximized = live_view_is_maximized();
	document.body.classList.toggle("live_maximized", maximized);
	live_post({ type: "bspguy_maximized", maximized: maximized });

	// The phone layout's other panels are hidden while it's maximized, which scrolls the row of
	// panels back to the first, so this goes back to the live view's panel (the last one).
	if (was_maximized && !maximized && g_compact_mode && live_view_is_open()) {
		let container = document.getElementById("content-container");
		container.scrollLeft = container.scrollWidth;
	}
}

function live_view_is_maximized() {
	return document.body.classList.contains("live_maximized");
}

function remove_live_frame() {
	document.querySelectorAll("#live_view_frame_container iframe").forEach(function(frame) {
		frame.remove();
	});
}

// The player used to need the dashboard to be cross-origin isolated, which live-sw.js (a service
// worker) did by adding headers. It doesn't anymore, so a browser that still has the worker loses it.
function live_remove_old_worker() {
	if (!("serviceWorker" in navigator))
		return;
	navigator.serviceWorker.getRegistrations().then(function(regs) {
		regs.forEach(function(reg) {
			let w = reg.active || reg.waiting || reg.installing;
			if (w && /\/live-sw\.js$/.test(new URL(w.scriptURL).pathname))
				reg.unregister();
		});
	}).catch(function() {});
}

function open_live_view() {
	// the live view takes the place of the map list, so that has to be showing (except in the phone
	// layout, where it's a panel of its own)
	if (document.getElementById("hide_maps_cb").checked && !g_compact_mode) {
		live_session_set(LIVE_SHOWED_MAPS_KEY, "1");
		set_maps_hidden(false);
	}

	let was_open = live_view_is_open();
	set_live_view_visible(true);

	// the phone layout swipes to the live view's panel, after the chat
	if (g_compact_mode && !was_open) {
		let container = document.getElementById("content-container");
		requestAnimationFrame(function() {
			container.scrollTo({ left: container.scrollWidth, behavior: "smooth" });
		});
	}
	remove_live_frame();
	live_status("");

	live_check_proxy().then(function(hasProxy) {
		if (!live_view_is_open())
			return; // closed while checking
		remove_live_frame();
		let frame = document.createElement("iframe");
		frame.src = live_player_url(hasProxy);
		frame.allow = "autoplay; fullscreen";
		document.getElementById("live_view_frame_container").appendChild(frame);
	});
}

function close_live_view() {
	set_live_view_maximized(false);
	remove_live_frame();
	set_live_view_visible(false);
	if (live_session_get(LIVE_SHOWED_MAPS_KEY)) {
		live_session_set(LIVE_SHOWED_MAPS_KEY, null);
		set_maps_hidden(true);
	}
}

ready(function() {
	// camera icons on the current map's image. They open the live view, or close it if it's open.
	["watch_live_button", "watch_live_password_button"].forEach(function(id) {
		document.getElementById(id).addEventListener("click", function(e) {
			e.preventDefault(); // the map image is a link to the map's page
			e.stopPropagation();
			if (live_view_is_open()) {
				close_live_view();
				return;
			}
			g_live_password_mode = id.indexOf("password") != -1;
			if (!g_live_password_mode && !live_logged_in()) {
				action_denied_popup(WEBDENY_NOT_LOGGED_IN_LIVE);
				return;
			}
			open_live_view();
		});
	});
	// the cog menu's "Test spectator app": the player in password mode (its Connect dialog), which
	// works while signed out. Reopens it in that mode if the view is already open.
	document.getElementById("test_spectator_button").addEventListener("click", function() {
		g_live_password_mode = true;
		open_live_view();
	});
	document.addEventListener("keydown", function(e) {
		// only reaches here when the player doesn't have focus
		if (e.key == "Escape" && live_view_is_maximized())
			set_live_view_maximized(false);
	});

	document.getElementById("server_selector").addEventListener("change", function() {
		if (live_view_is_open())
			open_live_view(); // reconnect to the new server's stream
	});

	live_remove_old_worker();

	// links and bookmarks from when the open view was marked with ?live=1. The view only opens
	// from the camera button.
	let url = new URL(location.href);
	if (url.searchParams.has("live")) {
		url.searchParams.delete("live");
		history.replaceState(history.state, "", url.toString());
	}

	if (live_session_get(LIVE_SHOWED_MAPS_KEY)) {
		// the page was reloaded with the view open, which showed the hidden map list
		live_session_set(LIVE_SHOWED_MAPS_KEY, null);
		set_maps_hidden(true);
	}
});
