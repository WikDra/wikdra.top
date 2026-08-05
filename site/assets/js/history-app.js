/*!
 * history-app.js — komponent Alpine archiwum historii (history.html).
 * Wymaga: theme.js, solar.js, storage.js, Alpine.
 * Ten sam magazyn i ten sam kontrakt eksportu co panels.html.
 */
(function (global) {
    'use strict';

    var Solar = global.WikdraSolar;
    var Storage = global.WikdraStorage;

    function component() {
        var app = {
            days: {},
            params: Object.assign({}, Solar.DEFAULT_PARAMS),
            searchQuery: '',
            sortBy: 'newest',
            expandedDate: null,
            status: { message: '', kind: 'info' },
            statusTimer: null,

            init: function () {
                var state = Storage.load();
                this.days = state.days;
                this.params = state.params;
                if (state.migrated) {
                    // utrwalamy migrację od razu — inaczej stary format leżałby dalej
                    this.persist();
                    this.setStatus('Historia przeniesiona na format v2 (kopia: solar_history_v1_backup).', 'info');
                }
                if (state.skipped > 0) {
                    this.setStatus('Pominięto ' + state.skipped + ' niepoprawnych wpisów historii.', 'warn');
                }
            },

            setStatus: function (message, kind) {
                this.status = { message: message, kind: kind || 'info' };
                // informacje same znikają, ostrzeżenia i błędy zostają
                if ((kind || 'info') === 'info') {
                    this.statusTimer = setTimeout(function () {
                        this.status = { message: '', kind: 'info' };
                        this.statusTimer = null;
                    }.bind(this), 6000);
                }
            },

            persist: function () {
                var result = Storage.save({ params: this.params, days: this.days });
                if (result.days !== this.days) this.days = result.days;
                if (!result.ok) {
                    this.setStatus('Nie udało się zapisać historii (' + result.error + ').', 'error');
                }
            },

            // ——— widok listy ———

            get dayCount() {
                return Object.keys(this.days).length;
            },
            get filteredDates() {
                var dates = Object.keys(this.days);
                var q = this.searchQuery.trim().toLowerCase();
                if (q) {
                    dates = dates.filter(function (d) { return d.toLowerCase().indexOf(q) !== -1; });
                }
                var days = this.days;
                if (this.sortBy === 'newest') dates.sort().reverse();
                else if (this.sortBy === 'oldest') dates.sort();
                else if (this.sortBy === 'energy_high') dates.sort(function (a, b) { return days[b].energy - days[a].energy; });
                else if (this.sortBy === 'energy_low') dates.sort(function (a, b) { return days[a].energy - days[b].energy; });
                return dates;
            },
            /** Puste bo nic nie ma vs puste bo filtr nic nie zwrócił — to dwa różne komunikaty. */
            get isEmptyOverall() {
                return this.dayCount === 0;
            },
            get isEmptyByFilter() {
                return this.dayCount > 0 && this.filteredDates.length === 0;
            },
            get totalEnergy() {
                var days = this.days;
                return Object.keys(days).reduce(function (acc, d) { return acc + days[d].energy; }, 0).toFixed(2);
            },
            get averageEnergy() {
                var keys = Object.keys(this.days);
                if (keys.length === 0) return '0.00';
                return (parseFloat(this.totalEnergy) / keys.length).toFixed(2);
            },
            get recordEnergy() {
                var days = this.days;
                var keys = Object.keys(days);
                if (keys.length === 0) return { date: '—', energy: '0.00' };
                var best = keys.reduce(function (acc, d) {
                    return days[d].energy > days[acc].energy ? d : acc;
                }, keys[0]);
                return { date: best, energy: days[best].energy.toFixed(2) };
            },

            dayPeak: function (date) {
                var day = this.days[date];
                return day ? day.peak : 0;
            },
            dayLimit: function (date) {
                return Solar.dayLimit(this.days[date], this.params.limit);
            },
            hourRows: function (date) {
                var day = this.days[date];
                if (!day) return [];
                var clip = Solar.clipWatts(day.watts, Solar.dayLimit(day, this.params.limit));
                return clip.times.map(function (time) {
                    return { time: time.split(' ')[1].substring(0, 5), watt: clip.watts[time] };
                });
            },

            toggleExpand: function (date) {
                this.expandedDate = (this.expandedDate === date) ? null : date;
            },

            // ——— modyfikacje ———

            deleteDate: function (date) {
                if (!confirm('Czy na pewno usunąć historię dla dnia ' + date + '?')) return;
                delete this.days[date];
                if (this.expandedDate === date) this.expandedDate = null;
                this.persist();
                this.setStatus('Usunięto dzień ' + date + '.', 'info');
            },

            clearAllHistory: function () {
                if (!confirm('UWAGA: usunąć CAŁĄ zapisaną historię? Operacji nie można cofnąć bez kopii JSON.')) return;
                this.days = {};
                this.expandedDate = null;
                this.persist();
                this.setStatus('Historia wyczyszczona.', 'warn');
            },

            // ——— eksport / import ———

            exportHistory: function () {
                if (this.dayCount === 0) {
                    this.setStatus('Brak danych historii do wyeksportowania.', 'warn');
                    return;
                }
                Storage.downloadJson(
                    Storage.buildExport(this.params, this.days),
                    'solar_history_full_' + Solar.formatLocalDate(new Date()) + '.json'
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
                        this.persist();
                        this.setStatus('Zaimportowano: ' + merged.added + ' nowych dni, ' + merged.updated
                            + ' zaktualizowanych' + (parsed.skipped ? ', pominięto ' + parsed.skipped : '') + '.', 'info');
                    } finally {
                        input.value = '';
                    }
                }.bind(this);
                reader.readAsText(file);
            }
        };

        return Object.assign(app, global.WikdraTheme.alpineMixin());
    }

    document.addEventListener('alpine:init', function () {
        global.Alpine.data('solarHistoryApp', component);
    });
}(window));
