/*!
 * panels-app.js — komponent Alpine dashboardu solarnego (panels.html).
 * Wymaga: theme.js, solar.js, storage.js, uPlot, Alpine.
 *
 * Uwaga o strefach czasowych: forecast.solar zwraca znaczniki
 * "YYYY-MM-DD HH:MM:SS" w czasie LOKALNYM instalacji, a grupowanie po dniach
 * bierzemy z klucza API (`watt_hours_day`), nie z przeglądarki. Parsujemy je
 * jako czas lokalny i formatujemy jako czas lokalny — złożenie jest tożsamością,
 * więc godziny wyświetlają się poprawnie niezależnie od strefy przeglądarki.
 */
(function (global) {
    'use strict';

    var Solar = global.WikdraSolar;
    var Storage = global.WikdraStorage;

    var FORECAST_TIMEOUT_MS = 15000;
    var NOMINATIM_MIN_INTERVAL_MS = 1100; // polityka OSM: maks. 1 zapytanie/s
    var GEO_CACHE_KEY = 'solar_geo_cache';
    var GEO_CACHE_MAX = 50;

    var lastGeoRequestAt = 0;

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function readGeoCache() {
        var raw = null;
        try { raw = global.localStorage.getItem(GEO_CACHE_KEY); } catch (e) { /* brak dostępu */ }
        var parsed = Storage.safeParse(raw, {});
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    }

    function writeGeoCache(cache) {
        var keys = Object.keys(cache);
        if (keys.length > GEO_CACHE_MAX) {
            var trimmed = {};
            keys.slice(keys.length - GEO_CACHE_MAX).forEach(function (k) { trimmed[k] = cache[k]; });
            cache = trimmed;
        }
        try { global.localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* trudno */ }
    }

    /** fetch z twardym limitem czasu — bez tego zawieszona sieć blokuje UI na zawsze. */
    function fetchWithTimeout(url, timeoutMs) {
        if (typeof AbortController === 'undefined') return fetch(url);
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        return fetch(url, { signal: controller.signal }).finally(function () { clearTimeout(timer); });
    }

    function component() {
        // UWAGA: getterów (np. selectedDay) nie wolno przekazywać jako ŹRÓDŁA do
        // Object.assign — zostałyby wyliczone i skopiowane jako zwykłe wartości.
        // Dlatego mixin motywu dokładamy do gotowego obiektu, nie odwrotnie.
        var app = {
            loading: false,
            params: Object.assign({}, Solar.DEFAULT_PARAMS),
            days: {},
            selectedDate: '',
            address: '',
            lastUpdate: 'Nigdy',
            status: { message: '', kind: 'info' },
            chart: null,
            resizeScheduled: false,
            statusTimer: null,

            // ——— cykl życia ———

            init: function () {
                var state = Storage.load();
                this.params = state.params;
                this.days = state.days;
                this.lastUpdate = state.lastUpdate;

                if (state.migrated) {
                    // migracja musi zostać utrwalona, inaczej każde wejście na stronę
                    // przelicza stary format od nowa
                    this.persist();
                    this.setStatus('Historia została przeniesiona na nowy format (v2). Kopia starych danych: solar_history_v1_backup.', 'info');
                }
                if (state.skipped > 0) {
                    this.setStatus('Pominięto ' + state.skipped + ' niepoprawnych wpisów historii.', 'warn');
                }

                var dateParam = new URLSearchParams(global.location.search).get('date');
                // Respektujemy ?date= także wtedy, gdy dnia jeszcze nie ma w pamięci —
                // może dopiero przyjść z API. Inaczej link z archiwum cicho wracał na dziś.
                if (dateParam && Solar.isValidDateKey(dateParam)) {
                    this.selectedDate = dateParam;
                } else {
                    this.selectedDate = Solar.formatLocalDate(new Date());
                }

                global.addEventListener('resize', this.onResize.bind(this));
                this.refreshView();
                this.fetchData();
            },

            /** Resize przez requestAnimationFrame — bez tego uPlot przelicza się przy każdym pikselu. */
            onResize: function () {
                if (this.resizeScheduled) return;
                this.resizeScheduled = true;
                global.requestAnimationFrame(function () {
                    this.resizeScheduled = false;
                    var el = document.getElementById('forecastChart');
                    if (this.chart && el) {
                        this.chart.setSize({ width: el.clientWidth, height: el.clientHeight });
                    }
                }.bind(this));
            },

            // ——— stan pochodny ———

            get selectedDay() {
                return this.days[this.selectedDate] || null;
            },
            /** Limit falownika WYBRANEGO dnia (nie bieżący z formularza). */
            get selectedLimit() {
                return Solar.dayLimit(this.selectedDay, this.params.limit);
            },
            get selectedEnergy() {
                return this.selectedDay ? this.selectedDay.energy.toFixed(2) : '0.00';
            },
            get selectedPeak() {
                return this.selectedDay ? this.selectedDay.peak : 0;
            },
            get hourlyRows() {
                var day = this.selectedDay;
                if (!day) return [];
                var limit = this.selectedLimit;
                var clip = Solar.clipWatts(day.watts, limit);
                return clip.times.map(function (time) {
                    return { time: time.split(' ')[1].substring(0, 5), watt: clip.watts[time], limit: limit };
                });
            },
            /** Formularz pokazuje inny limit niż ten, którym policzono wybrany dzień. */
            get limitMismatch() {
                return !!this.selectedDay && Solar.dayLimit(this.selectedDay, 0) !== Number(this.params.limit);
            },
            get sortedDates() {
                return Object.keys(this.days).sort().reverse();
            },
            get dayCount() {
                return Object.keys(this.days).length;
            },

            // ——— komunikaty ———

            setStatus: function (message, kind) {
                this.status = { message: message, kind: kind || 'info' };
                // Informacje same znikają; ostrzeżenia i błędy zostają, dopóki
                // użytkownik czegoś nie zrobi — inaczej banner wisiałby zawsze.
                if (this.statusTimer) { clearTimeout(this.statusTimer); this.statusTimer = null; }
                if ((kind || 'info') === 'info') {
                    this.statusTimer = setTimeout(function () {
                        this.status = { message: '', kind: 'info' };
                        this.statusTimer = null;
                    }.bind(this), 6000);
                }
            },
            clearStatus: function () {
                this.status = { message: '', kind: 'info' };
            },

            // ——— trwałość ———

            persist: function () {
                var result = Storage.save({ params: this.params, days: this.days, lastUpdate: this.lastUpdate });
                if (result.days !== this.days) this.days = result.days;
                if (!result.ok) {
                    this.setStatus('Nie udało się zapisać historii (' + result.error + '). Wyeksportuj dane do pliku.', 'error');
                } else if (result.pruned > 0) {
                    this.setStatus('Usunięto ' + result.pruned + ' najstarszych dni, żeby zmieścić się w pamięci przeglądarki.', 'warn');
                }
            },

            // ——— parametry i walidacja ———

            /** Wywoływane przy zmianie pól formularza: koerzja typów + zakresy. */
            normalizeForm: function () {
                this.params = Solar.normalizeParams(this.params);
            },

            applyLimitToSelectedDay: function () {
                var day = this.selectedDay;
                if (!day) return;
                var params = Object.assign({}, day.params, { limit: Solar.normalizeParams(this.params).limit });
                var recomputed = Solar.computeDay({ watts: day.watts, params: params }, params.limit);
                this.days[this.selectedDate] = Object.assign({}, day, {
                    params: params,
                    energy: recomputed.energy,
                    peak: recomputed.peak
                });
                this.persist();
                this.refreshView();
                this.setStatus('Limit ' + params.limit + ' W zastosowany do dnia ' + this.selectedDate + '.', 'info');
            },

            // ——— sieć ———

            async lookupAddress() {
                var query = this.address.trim();
                if (!query) return;

                var cache = readGeoCache();
                if (cache[query]) {
                    this.params = Solar.normalizeParams(Object.assign({}, this.params, cache[query]));
                    this.persist();
                    this.setStatus('Współrzędne z pamięci lokalnej: ' + this.params.lat + ', ' + this.params.lon, 'info');
                    return;
                }

                this.loading = true;
                this.clearStatus();
                try {
                    // Polityka Nominatim: maks. 1 zapytanie na sekundę z jednego klienta.
                    var wait = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastGeoRequestAt);
                    if (wait > 0) await sleep(wait);
                    lastGeoRequestAt = Date.now();

                    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query);
                    var response = await fetchWithTimeout(url, FORECAST_TIMEOUT_MS);
                    if (!response.ok) {
                        this.setStatus(response.status === 429
                            ? 'Nominatim odrzucił zapytanie (limit 1/s). Spróbuj ponownie za chwilę.'
                            : 'Wyszukiwanie adresu nie powiodło się (HTTP ' + response.status + ').', 'error');
                        return;
                    }
                    var data = await response.json();
                    if (!Array.isArray(data) || data.length === 0) {
                        this.setStatus('Nie znaleziono adresu „' + query + '".', 'warn');
                        return;
                    }
                    var found = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
                    if (!isFinite(found.lat) || !isFinite(found.lon)) {
                        this.setStatus('Nominatim zwrócił nieczytelne współrzędne.', 'error');
                        return;
                    }
                    this.params = Solar.normalizeParams(Object.assign({}, this.params, found));
                    cache[query] = { lat: this.params.lat, lon: this.params.lon };
                    writeGeoCache(cache);
                    this.persist();
                    this.setStatus('Ustawiono współrzędne: ' + this.params.lat + ', ' + this.params.lon, 'info');
                } catch (error) {
                    this.setStatus(error && error.name === 'AbortError'
                        ? 'Wyszukiwanie adresu przerwane (przekroczono czas oczekiwania).'
                        : 'Błąd połączenia z usługą geokodowania.', 'error');
                } finally {
                    this.loading = false;
                }
            },

            async fetchData() {
                this.normalizeForm();
                this.loading = true;
                this.clearStatus();
                var p = this.params;
                var url = 'https://api.forecast.solar/estimate/' + p.lat + '/' + p.lon + '/' + p.dec + '/' + p.az + '/' + p.kwp;
                try {
                    var response = await fetchWithTimeout(url, FORECAST_TIMEOUT_MS);
                    if (!response.ok) {
                        this.setStatus(response.status === 429
                            ? 'forecast.solar: przekroczony limit zapytań (HTTP 429). Dane poniżej są z pamięci lokalnej.'
                            : 'forecast.solar odpowiedział błędem HTTP ' + response.status + '. Pokazuję ostatnie zapisane dane.', 'error');
                        return;
                    }
                    var payload = await response.json();
                    var fresh = Solar.daysFromApiResult(payload && payload.result, this.params);
                    var count = Object.keys(fresh).length;
                    if (count === 0) {
                        this.setStatus('Odpowiedź API nie zawierała danych dziennych.', 'warn');
                        return;
                    }
                    Object.keys(fresh).forEach(function (date) { this.days[date] = fresh[date]; }.bind(this));
                    this.lastUpdate = new Date().toLocaleString('pl-PL');
                    this.persist();
                    this.setStatus('Pobrano prognozę dla ' + count + ' dni.', 'info');
                } catch (error) {
                    this.setStatus(error && error.name === 'AbortError'
                        ? 'Przekroczono czas oczekiwania na forecast.solar. Pokazuję ostatnie zapisane dane.'
                        : 'Brak połączenia z forecast.solar. Pokazuję ostatnie zapisane dane.', 'error');
                } finally {
                    this.loading = false;
                    this.refreshView();
                }
            },

            // ——— wybór dnia ———

            selectDate: function (date) {
                this.selectedDate = date;
                this.refreshView();
            },
            selectDateByDayType: function (dayType) {
                this.selectDate(Solar.dateKeyOffset(dayType === 'tomorrow' ? 1 : 0));
            },
            isDateSelected: function (dayType) {
                return this.selectedDate === Solar.dateKeyOffset(dayType === 'tomorrow' ? 1 : 0);
            },

            refreshView: function () {
                this.$nextTick(function () { this.redrawChart(false); }.bind(this));
            },

            // ——— wykres ———

            chartColors: function () {
                var styles = getComputedStyle(document.documentElement);
                var accent = styles.getPropertyValue('--accent').trim() || '#eab308';
                var accent2 = styles.getPropertyValue('--accent-2').trim() || '#22d3ee';
                var muted = styles.getPropertyValue('--muted').trim() || '#64748b';
                var line = styles.getPropertyValue('--line').trim() || 'rgba(128,128,128,0.2)';
                var font = styles.getPropertyValue('--font-body').trim() || 'sans-serif';
                var isLight = this.mode === 'light';
                return {
                    line: accent,
                    fillTop: accent.charAt(0) === '#' ? accent + '44' : 'rgba(34,211,238,0.25)',
                    grid: line,
                    tick: muted,
                    limit: accent2,
                    font: font,
                    pointFill: accent,
                    pointStroke: isLight ? (this.theme === 'brutalist' ? '#000000' : '#ffffff') : '#000000'
                };
            },

            /**
             * @param {boolean} rebuild wymusza odtworzenie instancji (zmiana motywu).
             * Bez tego aktualizujemy dane przez setData — dużo taniej niż destroy+new.
             */
            redrawChart: function (rebuild) {
                var el = document.getElementById('forecastChart');
                if (!el || typeof global.uPlot === 'undefined') return;

                var day = this.selectedDay;
                var series = day ? Solar.chartSeries(day.watts, this.selectedLimit) : [[], [], []];

                if (series[0].length === 0) {
                    if (this.chart) { this.chart.destroy(); this.chart = null; }
                    return;
                }
                if (this.chart && !rebuild) {
                    this.chart.setData(series);
                    return;
                }
                if (this.chart) { this.chart.destroy(); this.chart = null; }
                this.chart = new global.uPlot(this.chartOptions(el), series, el);
            },

            chartOptions: function (el) {
                var c = this.chartColors();
                return {
                    width: el.clientWidth,
                    height: el.clientHeight,
                    legend: { show: false },
                    scales: { x: { time: true } },
                    cursor: {
                        points: {
                            size: function () { return 9; },
                            width: function () { return 2.5; },
                            stroke: function () { return c.pointStroke; },
                            fill: function () { return c.pointFill; }
                        }
                    },
                    axes: [
                        {
                            stroke: c.tick,
                            font: '11px ' + c.font,
                            grid: { show: false },
                            ticks: { stroke: c.grid },
                            values: function (self, splits) {
                                return splits.map(function (ts) {
                                    var d = new Date(ts * 1000);
                                    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
                                });
                            }
                        },
                        { stroke: c.tick, font: '11px ' + c.font, grid: { stroke: c.grid, width: 1 }, ticks: { stroke: c.grid } }
                    ],
                    plugins: [tooltipPlugin()],
                    series: [
                        {},
                        {
                            label: 'Moc (W)',
                            stroke: c.line,
                            width: 2.5,
                            fill: function (u) {
                                var gradient = u.ctx.createLinearGradient(0, 0, 0, u.bbox.height);
                                gradient.addColorStop(0, c.fillTop);
                                gradient.addColorStop(1, 'transparent');
                                return gradient;
                            },
                            // punkt pod kursorem rysuje cursor.points — nie duplikujemy go w serii
                            points: { show: false }
                        },
                        { label: 'Limit', stroke: c.limit, width: 1.5, dash: [6, 4], points: { show: false } }
                    ]
                };
            },

            // ——— eksport / import ———

            exportHistory: function () {
                if (this.dayCount === 0) {
                    this.setStatus('Brak danych historii do wyeksportowania.', 'warn');
                    return;
                }
                Storage.downloadJson(
                    Storage.buildExport(this.params, this.days),
                    'solar_history_' + Solar.formatLocalDate(new Date()) + '.json'
                );
                this.setStatus('Wyeksportowano ' + this.dayCount + ' dni.', 'info');
            },

            importHistory: function (event) {
                var input = event.target;
                var file = input.files && input.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onerror = function () {
                    this.setStatus('Nie udało się odczytać pliku.', 'error');
                    input.value = '';
                }.bind(this);
                reader.onload = function (e) {
                    try {
                        var parsed = Storage.parseImport(String(e.target.result), this.params);
                        if (!parsed.ok) {
                            this.setStatus('Import odrzucony: ' + parsed.error, 'error');
                            return;
                        }
                        var merged = Storage.mergeDays(this.days, parsed.days);
                        this.days = merged.days;
                        if (parsed.params) this.params = parsed.params;
                        if (!this.days[this.selectedDate]) {
                            var dates = this.sortedDates;
                            if (dates.length > 0) this.selectedDate = dates[0];
                        }
                        this.persist();
                        this.refreshView();
                        this.setStatus('Zaimportowano: ' + merged.added + ' nowych dni, ' + merged.updated
                            + ' zaktualizowanych' + (parsed.skipped ? ', pominięto ' + parsed.skipped : '') + '.', 'info');
                    } finally {
                        input.value = '';
                    }
                }.bind(this);
                reader.readAsText(file);
            }
        };

        return Object.assign(app, global.WikdraTheme.alpineMixin(function () {
            // zmiana motywu = inne kolory wykresu → instancja uPlot do odtworzenia
            this.$nextTick(function () { this.redrawChart(true); }.bind(this));
        }));
    }

    /** Dymek z mocą dla punktu pod kursorem. */
    function tooltipPlugin() {
        var tooltipEl;
        return {
            hooks: {
                init: function (u) {
                    tooltipEl = document.createElement('div');
                    tooltipEl.className = 'uplot-tooltip';
                    tooltipEl.style.display = 'none';
                    tooltipEl.style.position = 'absolute';
                    tooltipEl.style.pointerEvents = 'none';
                    tooltipEl.style.zIndex = '100';
                    u.over.appendChild(tooltipEl);
                },
                setCursor: function (u) {
                    var left = u.cursor.left;
                    var top = u.cursor.top;
                    var idx = u.cursor.idx;
                    if (idx === null || idx === undefined) {
                        tooltipEl.style.display = 'none';
                        return;
                    }
                    var timeSec = u.data[0][idx];
                    var wattVal = u.data[1][idx];
                    var limitVal = u.data[2][idx];
                    if (wattVal === undefined) {
                        tooltipEl.style.display = 'none';
                        return;
                    }
                    var timeStr = new Date(timeSec * 1000).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', hour12: false });
                    tooltipEl.innerHTML = '<div class="uplot-tooltip-time">Godzina ' + timeStr + '</div>'
                        + '<div class="uplot-tooltip-val">Moc: <strong>' + wattVal + ' W</strong></div>'
                        + (wattVal >= limitVal ? '<div class="uplot-tooltip-limit">Limit Falownika</div>' : '');
                    tooltipEl.style.display = 'block';
                    var overRect = u.over.getBoundingClientRect();
                    var x = left + 14;
                    var y = top - 30;
                    if (x + 130 > overRect.width) x = left - 130;
                    if (y < 10) y = top + 15;
                    tooltipEl.style.left = x + 'px';
                    tooltipEl.style.top = y + 'px';
                }
            }
        };
    }

    document.addEventListener('alpine:init', function () {
        global.Alpine.data('solarApp', component);
    });
}(window));
