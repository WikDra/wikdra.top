/*!
 * solar.js — czyste funkcje obliczeniowe dashboardu solarnego.
 * Bez DOM, bez localStorage, bez fetch — dzięki temu da się je testować i nie
 * powtarzają się między panels.html a history.html.
 *
 * Kluczowa zasada modelu danych:
 *   Każdy zapisany dzień ma WŁASNY snapshot parametrów (w tym `limit` falownika).
 *   Energia i moc szczytowa dnia liczone są limitem TEGO dnia, nigdy bieżącym
 *   ustawieniem formularza — inaczej zmiana limitu zniekształcałaby archiwum.
 *
 * Publiczne API: window.WikdraSolar
 */
(function (global) {
    'use strict';

    /** Domyślne, NIEPRYWATNE parametry: centrum Warszawy. */
    var DEFAULT_PARAMS = { lat: 52.232, lon: 21.008, dec: 30, az: 0, kwp: 8, limit: 5500 };

    /** Zakresy zgodne z API forecast.solar (+ sensowne granice sprzętowe). */
    var RANGES = {
        lat: { min: -90, max: 90 },
        lon: { min: -180, max: 180 },
        dec: { min: 0, max: 90 },
        az: { min: -180, max: 180 },
        kwp: { min: 0.1, max: 1000 },
        limit: { min: 1, max: 1000000 }
    };

    var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

    function isFiniteNumber(v) {
        return typeof v === 'number' && isFinite(v);
    }

    function toNumber(v, fallback) {
        var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
        return isFinite(n) ? n : fallback;
    }

    function clampNumber(v, min, max) {
        return Math.min(Math.max(v, min), max);
    }

    /** Sprowadza dowolne wejście (także stringi z <input>) do poprawnych parametrów. */
    function normalizeParams(input) {
        var src = (input && typeof input === 'object') ? input : {};
        var out = {};
        Object.keys(DEFAULT_PARAMS).forEach(function (key) {
            var n = toNumber(src[key], DEFAULT_PARAMS[key]);
            var r = RANGES[key];
            out[key] = r ? clampNumber(n, r.min, r.max) : n;
        });
        // szerokość/długość: 3 miejsca po przecinku wystarczą (~100 m)
        out.lat = Math.round(out.lat * 1000) / 1000;
        out.lon = Math.round(out.lon * 1000) / 1000;
        out.dec = Math.round(out.dec);
        out.az = Math.round(out.az);
        out.limit = Math.round(out.limit);
        return out;
    }

    function isValidDateKey(key) {
        if (!DATE_RE.test(key)) return false;
        var d = new Date(key + 'T00:00:00');
        return !isNaN(d.getTime());
    }

    /** "YYYY-MM-DD" w strefie lokalnej (bez pułapki toISOString/UTC). */
    function formatLocalDate(d) {
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    function dateKeyOffset(days) {
        var d = new Date();
        d.setDate(d.getDate() + days);
        return formatLocalDate(d);
    }

    /** Timestampy forecast.solar mają format "YYYY-MM-DD HH:MM:SS" (czas lokalny instalacji). */
    function parseTimestamp(str) {
        var t = new Date(String(str).replace(' ', 'T'));
        return isNaN(t.getTime()) ? null : t;
    }

    /** Klucze `watts` posortowane rosnąco po czasie — uPlot wymaga rosnącej osi X. */
    function sortedTimes(watts) {
        if (!watts || typeof watts !== 'object') return [];
        return Object.keys(watts)
            .filter(function (k) { return parseTimestamp(k) !== null && isFiniteNumber(toNumber(watts[k], NaN)); })
            .sort(function (a, b) { return parseTimestamp(a) - parseTimestamp(b); });
    }

    /** Limit falownika dla zapisanego dnia; `fallback` gdy dzień go nie ma (dane v1). */
    function dayLimit(day, fallback) {
        var fromDay = day && day.params ? toNumber(day.params.limit, NaN) : NaN;
        if (isFinite(fromDay) && fromDay > 0) return fromDay;
        var fb = toNumber(fallback, DEFAULT_PARAMS.limit);
        return fb > 0 ? fb : DEFAULT_PARAMS.limit;
    }

    /** Moce po obcięciu do limitu falownika + moc szczytowa (już obcięta). */
    function clipWatts(watts, limit) {
        var times = sortedTimes(watts);
        var clipped = {};
        var peak = 0;
        times.forEach(function (t) {
            var v = Math.max(0, toNumber(watts[t], 0));
            var c = Math.min(v, limit);
            clipped[t] = c;
            if (c > peak) peak = c;
        });
        return { watts: clipped, peak: Math.round(peak), times: times };
    }

    /**
     * Energia dnia [kWh] z obcięciem do limitu falownika.
     * Całkowanie trapezami po realnych znacznikach czasu (forecast.solar zwraca
     * także wpisy o wschodzie/zachodzie, więc odstępy nie są równe).
     */
    function energyFromWatts(watts, limit) {
        var times = sortedTimes(watts);
        if (times.length === 0) return 0;
        if (times.length === 1) return 0;
        var wh = 0;
        for (var i = 1; i < times.length; i++) {
            var t0 = parseTimestamp(times[i - 1]).getTime();
            var t1 = parseTimestamp(times[i]).getTime();
            var hours = (t1 - t0) / 3600000;
            if (!(hours > 0) || hours > 6) continue; // luka w danych — nie interpolujemy
            var w0 = Math.min(Math.max(0, toNumber(watts[times[i - 1]], 0)), limit);
            var w1 = Math.min(Math.max(0, toNumber(watts[times[i]], 0)), limit);
            wh += (w0 + w1) / 2 * hours;
        }
        return Math.round(wh / 1000 * 100) / 100;
    }

    /** Pełne przeliczenie dnia: energia (obcięta), moc szczytowa, moce godzinowe. */
    function computeDay(day, fallbackLimit) {
        var limit = dayLimit(day, fallbackLimit);
        var clip = clipWatts(day && day.watts, limit);
        return {
            limit: limit,
            energy: energyFromWatts(day && day.watts, limit),
            peak: clip.peak,
            watts: clip.watts,
            times: clip.times
        };
    }

    /** Dane dla uPlot: [sekundy, moce obcięte, linia limitu] — X gwarantowanie rosnące. */
    function chartSeries(watts, limit) {
        var times = sortedTimes(watts);
        var xs = [];
        var ys = [];
        var lim = [];
        times.forEach(function (t) {
            xs.push(Math.floor(parseTimestamp(t).getTime() / 1000));
            ys.push(Math.min(Math.max(0, toNumber(watts[t], 0)), limit));
            lim.push(limit);
        });
        return [xs, ys, lim];
    }

    /**
     * Przetwarza odpowiedź forecast.solar (`data.result`) na wpisy dni.
     * @returns {Object} mapa data → wpis dnia w schemacie v2
     */
    function daysFromApiResult(result, params) {
        var out = {};
        if (!result || typeof result !== 'object') return out;
        var watts = result.watts && typeof result.watts === 'object' ? result.watts : {};
        var perDay = result.watt_hours_day && typeof result.watt_hours_day === 'object' ? result.watt_hours_day : {};
        var normalized = normalizeParams(params);
        var savedAt = new Date().toISOString();

        Object.keys(perDay).forEach(function (date) {
            if (!isValidDateKey(date)) return;
            var dayWatts = {};
            Object.keys(watts).forEach(function (time) {
                if (time.indexOf(date) === 0) {
                    var v = toNumber(watts[time], NaN);
                    if (isFinite(v)) dayWatts[time] = Math.max(0, Math.round(v));
                }
            });
            var rawWh = toNumber(perDay[date], NaN);
            out[date] = {
                energy: energyFromWatts(dayWatts, normalized.limit),
                energyRaw: isFinite(rawWh) ? Math.round(rawWh / 1000 * 100) / 100 : null,
                peak: clipWatts(dayWatts, normalized.limit).peak,
                watts: dayWatts,
                params: normalized,
                savedAt: savedAt
            };
        });
        return out;
    }

    global.WikdraSolar = {
        DEFAULT_PARAMS: DEFAULT_PARAMS,
        RANGES: RANGES,
        normalizeParams: normalizeParams,
        isValidDateKey: isValidDateKey,
        formatLocalDate: formatLocalDate,
        dateKeyOffset: dateKeyOffset,
        parseTimestamp: parseTimestamp,
        sortedTimes: sortedTimes,
        dayLimit: dayLimit,
        clipWatts: clipWatts,
        energyFromWatts: energyFromWatts,
        computeDay: computeDay,
        chartSeries: chartSeries,
        daysFromApiResult: daysFromApiResult,
        toNumber: toNumber
    };
}(window));
