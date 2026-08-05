/*!
 * theme.js — jedyne źródło prawdy dla motywu i trybu (jasny/ciemny).
 *
 * Zastępuje 4 kopie tej samej logiki (index.html, panels.html, history.html, bichu.php)
 * oraz 4 kopie znaczników switchera.
 *
 * Ładowany SYNCHRONICZNIE w <head> przed arkuszem stylów — ustawia
 * data-theme/data-mode na <html> przed pierwszym malowaniem (anti-FOUC).
 * Świadomie NIE jest modułem ES: kolejność wykonania musi być deterministyczna
 * i niezależna od defer/module, a plik jest precache'owany przez Service Workera.
 *
 * Publiczne API: window.WikdraTheme
 *   .themes                 — lista motywów (klucz, nazwa, kolor kropki)
 *   .getTheme() / .getMode()
 *   .apply(theme, mode)     — tylko DOM, bez zapisu
 *   .choose(theme, mode)    — wybór użytkownika: DOM + zapis (cookie + localStorage)
 *   .alpineMixin(onChange)  — fragment stanu dla komponentu Alpine
 *   .mountSwitcher(root?)   — wstawia znaczniki switchera w [data-theme-switcher]
 */
(function (global) {
    'use strict';

    var THEMES = [
        { key: 'brutalist', name: 'Neo-Brutalizm', color: '#eab308' },
        { key: 'cyberpunk', name: 'Cyber Dashboard', color: '#22d3ee' },
        { key: 'terminal', name: 'Dev Terminal', color: '#34d399' },
        { key: 'aurora', name: 'Glassmorphism', color: '#a855f7' },
        { key: 'editorial', name: 'Editorial', color: '#171717' }
    ];
    var THEME_KEYS = THEMES.map(function (t) { return t.key; });
    var MODES = ['light', 'dark'];
    /** Motywy, których naturalnym trybem jest jasny. */
    var LIGHT_FIRST = ['brutalist', 'editorial'];
    var COOKIE_MAX_AGE = 31536000; // 1 rok
    var KEY_THEME = 'global_theme';
    var KEY_MODE = 'global_mode';

    function readCookie(name) {
        var prefix = name + '=';
        var parts = String(document.cookie || '').split(';');
        for (var i = 0; i < parts.length; i++) {
            var c = parts[i].trim();
            if (c.indexOf(prefix) === 0) return decodeURIComponent(c.substring(prefix.length));
        }
        return null;
    }

    /** localStorage bywa niedostępny (tryb prywatny, zablokowane ciasteczka). */
    function readLocal(key) {
        try { return global.localStorage.getItem(key); } catch (e) { return null; }
    }
    function writeLocal(key, val) {
        try { global.localStorage.setItem(key, val); } catch (e) { /* ignorujemy */ }
    }

    function writeCookie(key, val) {
        var base = key + '=' + encodeURIComponent(val) + ';path=/;max-age=' + COOKIE_MAX_AGE + ';SameSite=Lax';
        if (global.location && global.location.hostname && /(^|\.)wikdra\.top$/.test(global.location.hostname)) {
            // wyczyść ewentualne ciasteczko hosta, żeby nie przesłaniało domenowego
            document.cookie = key + '=;path=/;max-age=0;SameSite=Lax';
            document.cookie = base + ';domain=.wikdra.top';
        } else {
            document.cookie = base;
        }
    }

    function isValidTheme(v) { return THEME_KEYS.indexOf(v) !== -1; }
    function isValidMode(v) { return MODES.indexOf(v) !== -1; }

    function systemPreference() {
        var isDark = !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
        return { theme: isDark ? 'terminal' : 'brutalist', mode: isDark ? 'dark' : 'light' };
    }

    /** Czy użytkownik dokonał jawnego wyboru (a nie tylko odziedziczył systemowy)? */
    function hasExplicitChoice() {
        return !!(readCookie(KEY_THEME) || readLocal(KEY_THEME));
    }

    function getTheme() {
        var stored = readCookie(KEY_THEME) || readLocal(KEY_THEME);
        return isValidTheme(stored) ? stored : systemPreference().theme;
    }

    function getMode() {
        var stored = readCookie(KEY_MODE) || readLocal(KEY_MODE);
        if (isValidMode(stored)) return stored;
        if (hasExplicitChoice()) return defaultModeFor(getTheme());
        return systemPreference().mode;
    }

    function defaultModeFor(theme) {
        return LIGHT_FIRST.indexOf(theme) !== -1 ? 'light' : 'dark';
    }

    function apply(theme, mode) {
        var el = document.documentElement;
        el.dataset.theme = isValidTheme(theme) ? theme : systemPreference().theme;
        el.dataset.mode = isValidMode(mode) ? mode : defaultModeFor(el.dataset.theme);
    }

    /** Zapis TYLKO przy jawnym wyborze — inaczej utrwalalibyśmy preferencję systemu. */
    function choose(theme, mode) {
        apply(theme, mode);
        writeLocal(KEY_THEME, document.documentElement.dataset.theme);
        writeLocal(KEY_MODE, document.documentElement.dataset.mode);
        writeCookie(KEY_THEME, document.documentElement.dataset.theme);
        writeCookie(KEY_MODE, document.documentElement.dataset.mode);
    }

    // ——— natychmiastowe ustawienie motywu (przed malowaniem) ———
    apply(getTheme(), getMode());

    // Jeśli nie ma jawnego wyboru, śledź zmianę preferencji systemowej.
    if (global.matchMedia) {
        var mq = global.matchMedia('(prefers-color-scheme: dark)');
        var onChangeSystem = function () {
            if (hasExplicitChoice()) return;
            var pref = systemPreference();
            apply(pref.theme, pref.mode);
            document.dispatchEvent(new CustomEvent('wikdra:theme-changed', { detail: pref }));
        };
        if (mq.addEventListener) mq.addEventListener('change', onChangeSystem);
        else if (mq.addListener) mq.addListener(onChangeSystem);
    }

    /**
     * Fragment stanu dla komponentu Alpine.
     * @param {Function} [onChange] wołane po zmianie motywu (np. przerysowanie wykresu)
     */
    function alpineMixin(onChange) {
        return {
            theme: getTheme(),
            mode: getMode(),
            themes: THEMES,
            setTheme: function (val) {
                this.theme = val;
                this.mode = defaultModeFor(val);
                this.applyTheme();
            },
            setMode: function (val) {
                this.mode = val;
                this.applyTheme();
            },
            applyTheme: function () {
                choose(this.theme, this.mode);
                if (typeof onChange === 'function') onChange.call(this);
            }
        };
    }

    var GEAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
    var SUN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="switcher-dot" style="background:none" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/></svg>';
    var MOON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="switcher-dot" style="background:none" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';

    /**
     * Znaczniki switchera. Zakłada, że w zasięgu Alpine są: themes, theme, mode,
     * setTheme(), setMode() — czyli że komponent strony użył alpineMixin().
     */
    function switcherMarkup() {
        return '' +
            '<div class="switcher" x-data="{ open: false }"' +
            ' @keydown.escape.window="if (open) { open = false; $refs.switcherBtn.focus(); }">' +
            '<button type="button" class="switcher-btn" x-ref="switcherBtn" @click="open = !open"' +
            ' :data-open="open" :aria-expanded="open ? \'true\' : \'false\'" aria-haspopup="true"' +
            ' aria-controls="theme-switcher-panel" aria-label="Zmień motyw strony">' + GEAR_SVG + '</button>' +
            '<div class="switcher-panel" id="theme-switcher-panel" role="group" aria-label="Motyw i tryb"' +
            ' x-show="open" @click.away="open = false" x-transition.origin.top.right style="display: none;">' +
            '<div class="switcher-title">Styl strony:</div>' +
            '<template x-for="t in themes" :key="t.key">' +
            '<button type="button" class="switcher-item" :class="{ \'active\': theme === t.key }"' +
            ' :aria-pressed="theme === t.key ? \'true\' : \'false\'"' +
            ' @click="setTheme(t.key); open = false; $refs.switcherBtn.focus();">' +
            '<span class="switcher-dot" :style="\'background:\' + t.color" aria-hidden="true"></span>' +
            '<span x-text="t.name"></span></button>' +
            '</template>' +
            '<div class="switcher-sep"></div>' +
            '<div class="switcher-title">Tryb:</div>' +
            '<button type="button" class="switcher-item" :class="{ \'active\': mode === \'light\' }"' +
            ' :aria-pressed="mode === \'light\' ? \'true\' : \'false\'"' +
            ' @click="setMode(\'light\'); open = false; $refs.switcherBtn.focus();">' + SUN_SVG + 'Jasny</button>' +
            '<button type="button" class="switcher-item" :class="{ \'active\': mode === \'dark\' }"' +
            ' :aria-pressed="mode === \'dark\' ? \'true\' : \'false\'"' +
            ' @click="setMode(\'dark\'); open = false; $refs.switcherBtn.focus();">' + MOON_SVG + 'Ciemny</button>' +
            '</div></div>';
    }

    /**
     * Wstawia switcher W MIEJSCE znacznika [data-theme-switcher].
     *
     * Placeholder jest ZASTĘPOWANY, a nie wypełniany: gdyby został w drzewie,
     * byłby dodatkowym elementem flex w nagłówku i zmieniałby układ
     * (sprawdzone: nagłówek łamał się na dwie linie, a przycisk spadał do
     * drugiego rzędu). Po zamianie drzewo jest identyczne jak przy znacznikach
     * wpisanych ręcznie.
     *
     * Wołane inline na końcu <body> — czyli PRZED startem Alpine (defer),
     * dzięki czemu Alpine widzi gotowe znaczniki.
     */
    function mountSwitcher(root) {
        var hosts = root ? [root] : Array.prototype.slice.call(document.querySelectorAll('[data-theme-switcher]'));
        hosts.forEach(function (host) {
            var template = document.createElement('template');
            template.innerHTML = switcherMarkup();
            var node = template.content.firstElementChild;
            if (!node) return;
            if (host.parentNode) host.parentNode.replaceChild(node, host);
            else host.appendChild(node);
        });
    }

    global.WikdraTheme = {
        themes: THEMES,
        getTheme: getTheme,
        getMode: getMode,
        defaultModeFor: defaultModeFor,
        apply: apply,
        choose: choose,
        alpineMixin: alpineMixin,
        switcherMarkup: switcherMarkup,
        mountSwitcher: mountSwitcher
    };
}(window));
