/*!
 * bichu-app.js — komponent Alpine edytora treści Bichu.
 * Wymaga: theme.js, Alpine.
 */
(function (global) {
    'use strict';

    var MAX_CONTENT_BYTES = 65536; // musi zgadzać się z limitem w bichu.php

    function component() {
        var app = {
            content: '',
            tempContent: '',
            password: '',
            editMode: false,
            saving: false,
            status: { message: '', kind: 'info' },

            setStatus: function (message, kind) {
                this.status = { message: message, kind: kind || 'info' };
            },

            async init() {
                // Treść jest już w dokumencie (render serwerowy) — czytamy ją,
                // żeby nie migotało i żeby nie robić zbędnego zapytania na starcie.
                var seed = document.getElementById('bichu-initial');
                if (seed) {
                    try {
                        var parsed = JSON.parse(seed.textContent || '""');
                        this.content = typeof parsed === 'string' ? parsed : '';
                        return;
                    } catch (e) { /* spadamy do zapytania poniżej */ }
                }
                try {
                    var res = await fetch('?api=1', { cache: 'no-store' });
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    var data = await res.json();
                    this.content = typeof data.content === 'string' ? data.content : '';
                } catch (e) {
                    // init MUSI się zakończyć — inaczej Alpine zostawia komponent w połowie stanu
                    this.setStatus('Nie udało się pobrać treści. Odśwież stronę.', 'error');
                }
            },

            openEditor: function () {
                this.tempContent = this.content;
                this.editMode = true;
                this.setStatus('', 'info');
                this.$nextTick(function () {
                    var el = document.getElementById('bichu-password');
                    if (el) el.focus();
                });
            },

            /** Anulowanie czyści hasło — nie zostawiamy go w pamięci komponentu. */
            cancelEditor: function () {
                this.editMode = false;
                this.password = '';
                this.tempContent = '';
                this.setStatus('', 'info');
                this.$nextTick(function () {
                    var el = document.getElementById('bichu-edit-btn');
                    if (el) el.focus();
                });
            },

            async save() {
                if (!this.password) {
                    this.setStatus('Podaj hasło.', 'warn');
                    return;
                }
                if (new Blob([this.tempContent]).size > MAX_CONTENT_BYTES) {
                    this.setStatus('Treść jest za długa (limit ' + Math.round(MAX_CONTENT_BYTES / 1024) + ' kB).', 'error');
                    return;
                }
                this.saving = true;
                try {
                    var res = await fetch('?api=1', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: this.password, content: this.tempContent })
                    });
                    var data = null;
                    try { data = await res.json(); } catch (e) { data = null; }
                    if (res.ok && data && data.success) {
                        this.content = this.tempContent;
                        this.editMode = false;
                        this.password = '';
                        this.tempContent = '';
                        this.setStatus('Zapisano.', 'info');
                        return;
                    }
                    var message = (data && data.error) ? data.error : 'Zapis nie powiódł się (HTTP ' + res.status + ').';
                    this.setStatus(message, 'error');
                    this.password = '';
                } catch (e) {
                    this.setStatus('Błąd połączenia z serwerem.', 'error');
                } finally {
                    this.saving = false;
                }
            }
        };

        return Object.assign(app, global.WikdraTheme.alpineMixin());
    }

    document.addEventListener('alpine:init', function () {
        global.Alpine.data('bichuApp', component);
    });
}(window));
