<?php
$content_file = 'bichu_content.txt';
$admin_password = 'PoleMarysi123';

// Simple API for AJAX
if (isset($_GET['api'])) {
    header('Content-Type: application/json');
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        if (($data['password'] ?? '') === $admin_password) {
            file_put_contents($content_file, $data['content'] ?? '');
            echo json_encode(['success' => true]);
        } else {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Błędne hasło']);
        }
        exit;
    }
    echo json_encode(['content' => file_exists($content_file) ? file_get_contents($content_file) : '']);
    exit;
}
?>
<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bichu | Wikdra.top</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script defer src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        [x-cloak] { display: none !important; }
        body { background-color: #0f172a; color: #f8fafc; }
        .glass { background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); }
    </style>
</head>
<body x-data="bichuApp()" x-init="init()">
    <div class="min-h-screen p-4 md:p-8 flex flex-col items-center">
        <header class="max-w-4xl w-full mb-8 flex justify-between items-center">
            <h1 class="text-3xl font-bold text-yellow-500 flex items-center gap-2">
                <i class="fas fa-edit"></i> Bichu
            </h1>
            <a href="https://wikdra.top" class="text-slate-400 hover:text-white transition-colors">
                <i class="fas fa-arrow-left"></i> Powrót
            </a>
        </header>

        <main class="max-w-4xl w-full">
            <!-- View Mode -->
            <div x-show="!editMode" x-cloak class="glass p-8 rounded-3xl min-h-[300px] relative group">
                <div class="prose prose-invert max-w-none whitespace-pre-wrap" x-text="content || 'Brak treści...'"></div>
                <button @click="openEditor()" class="absolute top-4 right-4 opacity-0 group-hover:opacity-100 bg-yellow-500 text-slate-900 px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2">
                    <i class="fas fa-lock"></i> Edytuj
                </button>
            </div>

            <!-- Edit Mode -->
            <div x-show="editMode" x-cloak class="glass p-8 rounded-3xl space-y-4">
                <div class="flex flex-col gap-2">
                    <label class="text-xs uppercase text-slate-500 font-bold">Hasło edycji</label>
                    <input type="password" x-model="password" placeholder="Wpisz hasło..." class="bg-slate-800 border-none rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-yellow-500">
                </div>
                <div class="flex flex-col gap-2">
                    <label class="text-xs uppercase text-slate-500 font-bold">Treść strony</label>
                    <textarea x-model="tempContent" rows="12" class="bg-slate-800 border-none rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-yellow-500 resize-none font-mono text-sm"></textarea>
                </div>
                <div class="flex gap-4">
                    <button @click="save()" :disabled="saving" class="flex-1 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-slate-900 font-black py-3 rounded-xl transition-all flex items-center justify-center gap-2">
                        <i class="fas fa-save" :class="saving && 'animate-spin'"></i> ZAPISZ ZMIANY
                    </button>
                    <button @click="editMode = false" class="bg-slate-700 hover:bg-slate-600 px-6 rounded-xl font-bold transition-colors">
                        Anuluj
                    </button>
                </div>
            </div>
        </main>
    </div>

    <script>
        function bichuApp() {
            return {
                content: '',
                tempContent: '',
                password: '',
                editMode: false,
                saving: false,

                async init() {
                    const res = await fetch('?api=1');
                    const data = await res.json();
                    this.content = data.content;
                },

                openEditor() {
                    this.tempContent = this.content;
                    this.editMode = true;
                },

                async save() {
                    if (!this.password) {
                        alert('Podaj hasło!');
                        return;
                    }
                    this.saving = true;
                    try {
                        const res = await fetch('?api=1', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                password: this.password,
                                content: this.tempContent
                            })
                        });
                        if (res.ok) {
                            this.content = this.tempContent;
                            this.editMode = false;
                            this.password = '';
                        } else {
                            const data = await res.json();
                            alert('Błąd: ' + data.error);
                        }
                    } catch (e) {
                        alert('Wystąpił błąd połączenia.');
                    } finally {
                        this.saving = false;
                    }
                }
            }
        }
    </script>
</body>
</html>
