/*!
 * index-app.js — komponent Alpine strony głównej (portfolio + metryki VPS).
 * Wymaga: theme.js, Alpine.
 *
 * Metryki: stats.php może zwrócić null dla RAM (gdy kontener nie udostępnia
 * /proc/meminfo) — pokazujemy wtedy „—", nigdy wartości zmyślonej.
 */
(function (global) {
    'use strict';

    var STATS_INTERVAL_MS = 10000;

    function component() {
        var app = {
            stats: { cpu: null, ram: null, disk: null },
            statsError: false,

            get statsList() {
                return [
                    { key: 'cpu', label: 'CPU', value: this.stats.cpu },
                    { key: 'ram', label: 'RAM', value: this.stats.ram },
                    { key: 'disk', label: 'DSK', value: this.stats.disk }
                ];
            },

            /** Tekst dla wartości: liczba w %, albo „—" gdy metryka niedostępna. */
            format: function (value) {
                return (typeof value === 'number' && isFinite(value)) ? Math.round(value) + '%' : '—';
            },
            /** Ile segmentów paska zapalić (null → żaden). */
            segmentOn: function (value, index) {
                return (typeof value === 'number' && isFinite(value)) && value >= index * 10;
            },

            init: function () {
                var load = async function () {
                    try {
                        var res = await fetch('/stats.php', { cache: 'no-store' });
                        if (!res.ok) throw new Error('HTTP ' + res.status);
                        var data = await res.json();
                        this.stats = {
                            cpu: typeof data.cpu === 'number' ? data.cpu : null,
                            ram: typeof data.ram === 'number' ? data.ram : null,
                            disk: typeof data.disk === 'number' ? data.disk : null
                        };
                        this.statsError = false;
                    } catch (e) {
                        this.statsError = true;
                    }
                }.bind(this);
                load();
                setInterval(load, STATS_INTERVAL_MS);
            }
        };

        return Object.assign(app, global.WikdraTheme.alpineMixin());
    }

    document.addEventListener('alpine:init', function () {
        global.Alpine.data('siteApp', component);
    });
}(window));
