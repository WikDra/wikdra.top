/*!
 * storage.js — magazyn historii solarnej: wersjonowany schemat, migracje,
 * walidacja importu, retencja i obsługa przepełnienia localStorage.
 *
 * Wymaga wcześniejszego załadowania solar.js (obliczenia energii przy migracji).
 *
 * Schemat v2 (klucz localStorage `solar_history`):
 *   { version: 2, days: { "YYYY-MM-DD": {
 *        energy:    number,  // kWh po obcięciu do limitu falownika TEGO dnia
 *        energyRaw: number|null, // kWh wg API, bez obcięcia (do porównania)
 *        peak:      number,  // W, po obcięciu
 *        watts:     { "YYYY-MM-DD HH:MM:SS": number },  // moce surowe
 *        params:    { lat, lon, dec, az, kwp, limit },  // snapshot z chwili zapisu
 *        savedAt:   string   // ISO
 *   } } }
 *
 * Schemat v1 (historyczny): goła mapa data → { energy: "12.34", watts, params }.
 * Migracja jest jednokierunkowa, a surowy v1 jest raz kopiowany do
 * `solar_history_v1_backup`, żeby nic nie przepadło bezpowrotnie.
 *
 * Publiczne API: window.WikdraStorage
 */
(function (global) {
    'use strict';

    var Solar = global.WikdraSolar;

    var KEY_HISTORY = 'solar_history';
    var KEY_PARAMS = 'solar_params';
    var KEY_LAST_UPDATE = 'solar_last_update';
    var KEY_BACKUP_V1 = 'solar_history_v1_backup';
    var SCHEMA_VERSION = 2;
    /** Retencja: ~13 miesięcy. Powyżej i tak nie ma czego porównywać, a rośnie koszt zapisu. */
    var MAX_DAYS = 400;

    function available() {
        try {
            var probe = '__wikdra_probe__';
            global.localStorage.setItem(probe, '1');
            global.localStorage.removeItem(probe);
            return true;
        } catch (e) {
            return false;
        }
    }

    function readRaw(key) {
        try { return global.localStorage.getItem(key); } catch (e) { return null; }
    }

    function safeParse(json, fallback) {
        if (typeof json !== 'string' || json === '') return fallback;
        try {
            var parsed = JSON.parse(json);
            return (parsed === null || parsed === undefined) ? fallback : parsed;
        } catch (e) {
            console.warn('[storage] uszkodzony JSON, używam wartości domyślnej:', e && e.message);
            return fallback;
        }
    }

    function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    /**
     * Waliduje i normalizuje jeden dzień. Zwraca wpis v2 albo null (odrzucony).
     * `fallbackParams` uzupełnia brakujący snapshot (dane v1 bez parametrów).
     */
    function normalizeDay(raw, fallbackParams) {
        if (!isPlainObject(raw)) return null;
        var watts = {};
        if (isPlainObject(raw.watts)) {
            Object.keys(raw.watts).forEach(function (time) {
                if (Solar.parseTimestamp(time) === null) return;
                var v = Solar.toNumber(raw.watts[time], NaN);
                if (isFinite(v) && v >= 0) watts[time] = Math.round(v);
            });
        }
        if (Object.keys(watts).length === 0) return null; // dzień bez mocy godzinowych jest bezużyteczny

        var params = Solar.normalizeParams(isPlainObject(raw.params) ? raw.params : fallbackParams);
        var computed = Solar.computeDay({ watts: watts, params: params }, params.limit);
        var rawEnergy = Solar.toNumber(raw.energyRaw !== undefined ? raw.energyRaw : raw.energy, NaN);

        return {
            energy: computed.energy,
            energyRaw: isFinite(rawEnergy) ? Math.round(rawEnergy * 100) / 100 : null,
            peak: computed.peak,
            watts: watts,
            params: params,
            savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString()
        };
    }

    /** Zostawia najnowsze MAX_DAYS dni. */
    function applyRetention(days) {
        var keys = Object.keys(days).sort();
        if (keys.length <= MAX_DAYS) return { days: days, removed: 0 };
        var keep = keys.slice(keys.length - MAX_DAYS);
        var out = {};
        keep.forEach(function (k) { out[k] = days[k]; });
        return { days: out, removed: keys.length - keep.length };
    }

    /**
     * Wczytuje stan. Zawsze zwraca poprawny obiekt, także gdy localStorage
     * jest niedostępny albo zawiera śmieci.
     */
    function load() {
        var params = Solar.normalizeParams(safeParse(readRaw(KEY_PARAMS), null));
        var rawHistory = safeParse(readRaw(KEY_HISTORY), null);
        var days = {};
        var migrated = false;
        var skipped = 0;

        if (isPlainObject(rawHistory) && Solar.toNumber(rawHistory.version, 0) >= 2) {
            var src = isPlainObject(rawHistory.days) ? rawHistory.days : {};
            Object.keys(src).forEach(function (date) {
                if (!Solar.isValidDateKey(date)) { skipped++; return; }
                var day = normalizeDay(src[date], params);
                if (day) days[date] = day; else skipped++;
            });
        } else if (isPlainObject(rawHistory)) {
            // v1: goła mapa data → wpis
            migrated = true;
            if (readRaw(KEY_BACKUP_V1) === null) {
                try { global.localStorage.setItem(KEY_BACKUP_V1, readRaw(KEY_HISTORY) || ''); } catch (e) { /* brak miejsca — trudno */ }
            }
            Object.keys(rawHistory).forEach(function (date) {
                if (!Solar.isValidDateKey(date)) { skipped++; return; }
                var day = normalizeDay(rawHistory[date], params);
                if (day) days[date] = day; else skipped++;
            });
        }

        var retention = applyRetention(days);
        var lastUpdate = readRaw(KEY_LAST_UPDATE) || 'Nigdy';
        return {
            params: params,
            days: retention.days,
            lastUpdate: lastUpdate,
            migrated: migrated,
            skipped: skipped,
            pruned: retention.removed
        };
    }

    /**
     * Zapis z obsługą przepełnienia: przy QuotaExceededError zwalnia najstarsze
     * dni i ponawia. Zwraca { ok, days, pruned, error }.
     */
    function save(state) {
        if (!available()) {
            return { ok: false, days: state.days, pruned: 0, error: 'localStorage niedostępny' };
        }
        var retention = applyRetention(state.days || {});
        var days = retention.days;
        var pruned = retention.removed;

        try {
            global.localStorage.setItem(KEY_PARAMS, JSON.stringify(Solar.normalizeParams(state.params)));
            if (typeof state.lastUpdate === 'string') {
                global.localStorage.setItem(KEY_LAST_UPDATE, state.lastUpdate);
            }
        } catch (e) { /* parametry są małe; jeśli tu padło, padnie i niżej */ }

        for (var attempt = 0; attempt < 5; attempt++) {
            try {
                global.localStorage.setItem(KEY_HISTORY, JSON.stringify({ version: SCHEMA_VERSION, days: days }));
                return { ok: true, days: days, pruned: pruned, error: null };
            } catch (e) {
                var keys = Object.keys(days).sort();
                if (keys.length <= 1) {
                    return { ok: false, days: days, pruned: pruned, error: e && e.name ? e.name : 'QuotaExceededError' };
                }
                var dropCount = Math.max(1, Math.ceil(keys.length * 0.2));
                var kept = {};
                keys.slice(dropCount).forEach(function (k) { kept[k] = days[k]; });
                days = kept;
                pruned += dropCount;
            }
        }
        return { ok: false, days: days, pruned: pruned, error: 'QuotaExceededError' };
    }

    /**
     * Waliduje plik importu. Przyjmuje v2 ({version,days}), v1 ({history} /
     * {solar_history} / gołą mapę). Odrzuca wpisy niezgodne ze schematem,
     * zamiast wpuszczać je do stanu aplikacji.
     * @returns {{ok: boolean, days: Object, params: Object|null, accepted: number, skipped: number, error: string|null}}
     */
    function parseImport(text, fallbackParams) {
        var parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            return { ok: false, days: {}, params: null, accepted: 0, skipped: 0, error: 'Plik nie jest poprawnym JSON-em.' };
        }
        if (!isPlainObject(parsed)) {
            return { ok: false, days: {}, params: null, accepted: 0, skipped: 0, error: 'Oczekiwano obiektu JSON.' };
        }

        var source = null;
        if (isPlainObject(parsed.days)) source = parsed.days;
        else if (isPlainObject(parsed.history)) source = parsed.history;
        else if (isPlainObject(parsed.solar_history)) source = parsed.solar_history;
        else source = parsed; // goła mapa dat

        var importedParams = isPlainObject(parsed.params) ? Solar.normalizeParams(parsed.params) : null;
        var base = importedParams || Solar.normalizeParams(fallbackParams);

        var days = {};
        var accepted = 0;
        var skipped = 0;
        Object.keys(source).forEach(function (date) {
            if (!Solar.isValidDateKey(date)) { skipped++; return; }
            var day = normalizeDay(source[date], base);
            if (day) { days[date] = day; accepted++; } else { skipped++; }
        });

        if (accepted === 0) {
            return {
                ok: false, days: {}, params: importedParams, accepted: 0, skipped: skipped,
                error: 'Nie znaleziono ani jednego poprawnego dnia (wymagane: klucz "YYYY-MM-DD" i niepuste "watts").'
            };
        }
        return { ok: true, days: days, params: importedParams, accepted: accepted, skipped: skipped, error: null };
    }

    /** Scala dni importowane z bieżącymi (import wygrywa dla tej samej godziny). */
    function mergeDays(current, incoming) {
        var out = {};
        Object.keys(current || {}).forEach(function (d) { out[d] = current[d]; });
        var added = 0;
        var updated = 0;
        Object.keys(incoming || {}).forEach(function (date) {
            if (!out[date]) {
                out[date] = incoming[date];
                added++;
                return;
            }
            var mergedWatts = {};
            Object.keys(out[date].watts || {}).forEach(function (t) { mergedWatts[t] = out[date].watts[t]; });
            Object.keys(incoming[date].watts || {}).forEach(function (t) { mergedWatts[t] = incoming[date].watts[t]; });
            var params = incoming[date].params || out[date].params;
            var recomputed = Solar.computeDay({ watts: mergedWatts, params: params }, params.limit);
            out[date] = {
                energy: recomputed.energy,
                energyRaw: incoming[date].energyRaw !== null ? incoming[date].energyRaw : out[date].energyRaw,
                peak: recomputed.peak,
                watts: mergedWatts,
                params: params,
                savedAt: new Date().toISOString()
            };
            updated++;
        });
        return { days: out, added: added, updated: updated };
    }

    /** Jeden kontrakt eksportu dla panels.html i history.html. */
    function buildExport(params, days) {
        return {
            app: 'wikdra-solar',
            version: SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            params: Solar.normalizeParams(params),
            days: days || {}
        };
    }

    /** Pobranie pliku przez Blob (data-URI wieszało się przy dużej historii). */
    function downloadJson(data, filename) {
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // odroczone zwolnienie — Safari potrzebuje URL-a jeszcze po kliknięciu
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    }

    global.WikdraStorage = {
        SCHEMA_VERSION: SCHEMA_VERSION,
        MAX_DAYS: MAX_DAYS,
        available: available,
        safeParse: safeParse,
        load: load,
        save: save,
        parseImport: parseImport,
        mergeDays: mergeDays,
        normalizeDay: normalizeDay,
        buildExport: buildExport,
        downloadJson: downloadJson
    };
}(window));
