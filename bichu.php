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
<html lang="pl" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bichu | Wikdra.top</title>
    
    <!-- Tailwind CSS CDN -->
    <script src="https://cdn.tailwindcss.com"></script>
    
    <!-- Alpine.js -->
    <script defer src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js"></script>
    
    <!-- Font Awesome -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    
    <!-- Shared themes CSS -->
    <link rel="stylesheet" href="/themes.css?v=4">
    
    <style>
        [x-cloak] { display: none !important; }
    </style>

    <!-- Theme Helper & Anti-FOUC Script -->
    <script>
        function getCookie(name) {
            const nameEQ = name + "=";
            const ca = document.cookie.split(';');
            for(let i=0; i < ca.length; i++) {
                let c = ca[i].trim();
                if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
            }
            return null;
        }
        function getSystemPreferredThemeAndMode() {
            const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            return {
                theme: isDark ? 'terminal' : 'brutalist',
                mode: isDark ? 'dark' : 'light'
            };
        }
        function getGlobalTheme() {
            let theme = getCookie('global_theme') || localStorage.getItem('global_theme');
            if (theme) return theme;
            return getSystemPreferredThemeAndMode().theme;
        }
        function setGlobalTheme(val) {
            localStorage.setItem('global_theme', val);
            if (window.location.hostname.endsWith('wikdra.top')) {
                // Delete host-specific cookie to prevent shadowing
                document.cookie = "global_theme=;path=/;max-age=0;SameSite=Lax";
                // Set wildcard cookie for subdomain sharing
                document.cookie = "global_theme=" + val + ";path=/;domain=.wikdra.top;max-age=31536000;SameSite=Lax";
            } else {
                document.cookie = "global_theme=" + val + ";path=/;max-age=31536000;SameSite=Lax";
            }
        }
        function getGlobalMode() {
            let mode = getCookie('global_mode') || localStorage.getItem('global_mode');
            if (mode) return mode;
            let hasThemeCookie = getCookie('global_theme') || localStorage.getItem('global_theme');
            if (hasThemeCookie) {
                let theme = getGlobalTheme();
                return (theme === 'brutalist' || theme === 'editorial') ? 'light' : 'dark';
            }
            return getSystemPreferredThemeAndMode().mode;
        }
        function setGlobalMode(val) {
            localStorage.setItem('global_mode', val);
            if (window.location.hostname.endsWith('wikdra.top')) {
                document.cookie = "global_mode=;path=/;max-age=0;SameSite=Lax";
                document.cookie = "global_mode=" + val + ";path=/;domain=.wikdra.top;max-age=31536000;SameSite=Lax";
            } else {
                document.cookie = "global_mode=" + val + ";path=/;max-age=31536000;SameSite=Lax";
            }
        }
        document.documentElement.className = 'theme-' + getGlobalTheme() + ' mode-' + getGlobalMode();
    </script>
</head>
<body x-data="bichuApp()" x-init="init()" :class="'theme-' + currentTheme + ' mode-' + currentMode" class="min-h-screen p-4 md:p-8 transition-colors duration-300 relative">
    
    <!-- Aurora background blobs -->
    <div x-show="currentTheme === 'aurora'" style="display: none;" class="pointer-events-none absolute inset-0 overflow-hidden z-0">
        <!-- Dark Mode Blobs -->
        <template x-if="currentMode === 'dark'">
            <div class="absolute inset-0 pointer-events-none">
                <div class="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-violet-600/15 blur-[120px] animate-pulse"></div>
                <div class="absolute top-1/4 -right-40 h-[600px] w-[600px] rounded-full bg-indigo-500/15 blur-[140px] animate-pulse" style="animation-delay: 1.5s;"></div>
            </div>
        </template>
        <!-- Light Mode Blobs -->
        <template x-if="currentMode === 'light'">
            <div class="absolute inset-0 pointer-events-none">
                <div class="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-violet-300/45 blur-[120px] animate-pulse"></div>
                <div class="absolute top-1/4 -right-40 h-[600px] w-[600px] rounded-full bg-sky-300/40 blur-[140px] animate-pulse" style="animation-delay: 1.5s;"></div>
            </div>
        </template>
    </div>

    <!-- Cyberpunk grid/glow -->
    <div x-show="currentTheme === 'cyberpunk'" style="display: none;" class="pointer-events-none absolute inset-0 overflow-hidden z-0"
         :style="currentMode === 'dark' ? 
                 'background-image: linear-gradient(rgba(217,70,239,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.03) 1px, transparent 1px); background-size: 34px 34px;' : 
                 'background-image: linear-gradient(rgba(217,70,239,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,0.08) 1px, transparent 1px); background-size: 34px 34px;'">
        <div class="absolute inset-x-0 top-0 h-64 bg-gradient-to-b" :class="currentMode === 'dark' ? 'from-fuchsia-600/10 to-transparent' : 'from-sky-500/10 to-transparent'"></div>
    </div>

    <div class="max-w-4xl mx-auto z-10 relative space-y-8 flex flex-col items-center">
        <!-- HEADER -->
        <header class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4 w-full"
                :class="{
                  'border-black border-b-4 pb-6': currentTheme === 'brutalist' && currentMode === 'light',
                  'border-[#bef264] border-b-4 pb-6': currentTheme === 'brutalist' && currentMode === 'dark',
                  'border-white/10': currentTheme === 'cyberpunk' && currentMode === 'dark',
                  'border-sky-200': currentTheme === 'cyberpunk' && currentMode === 'light',
                  'border-emerald-500/20': currentTheme === 'terminal' && currentMode === 'dark',
                  'border-emerald-600/20': currentTheme === 'terminal' && currentMode === 'light',
                  'border-white/10': currentTheme === 'aurora' && currentMode === 'dark',
                  'border-indigo-100': currentTheme === 'aurora' && currentMode === 'light',
                  'border-neutral-200': currentTheme === 'editorial' && currentMode === 'light',
                  'border-neutral-800': currentTheme === 'editorial' && currentMode === 'dark'
                }">
            <div>
                <!-- Brand Title -->
                <a href="/" class="text-3xl font-bold hover:opacity-80 transition flex items-center gap-2"
                   :class="{
                     'text-black uppercase font-black': currentTheme === 'brutalist' && currentMode === 'light',
                     'text-white uppercase font-black': currentTheme === 'brutalist' && currentMode === 'dark',
                     'text-cyan-300 font-mono': currentTheme === 'cyberpunk' && currentMode === 'dark',
                     'text-sky-600 font-mono': currentTheme === 'cyberpunk' && currentMode === 'light',
                     'text-emerald-300 font-mono': currentTheme === 'terminal' && currentMode === 'dark',
                     'text-[#047857] font-mono': currentTheme === 'terminal' && currentMode === 'light',
                     'bg-gradient-to-r from-violet-200 via-indigo-200 to-sky-200 bg-clip-text text-transparent': currentTheme === 'aurora' && currentMode === 'dark',
                     'bg-gradient-to-r from-indigo-600 via-violet-600 to-pink-500 bg-clip-text text-transparent': currentTheme === 'aurora' && currentMode === 'light',
                     'text-neutral-900 font-serif font-semibold': currentTheme === 'editorial' && currentMode === 'light',
                     'text-neutral-200 font-serif font-semibold': currentTheme === 'editorial' && currentMode === 'dark'
                   }">
                    <i class="fas fa-edit"></i> Bichu
                </a>
            </div>
            
            <!-- Back link -->
            <a href="https://wikdra.top" class="text-sm px-4 py-2 border w-fit font-bold flex items-center gap-1.5"
                 :class="{
                   'border-4 border-black bg-white text-black shadow-[2px_2px_0_#000] hover:shadow-[4px_4px_0_#000] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all': currentTheme === 'brutalist' && currentMode === 'light',
                   'border-4 border-[#bef264] bg-zinc-800 text-white shadow-[2px_2px_0_#fff] hover:shadow-[4px_4px_0_#fff] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all': currentTheme === 'brutalist' && currentMode === 'dark',
                   'border-cyan-400/30 bg-black/60 text-cyan-300 font-mono hover:border-fuchsia-400 hover:text-fuchsia-300': currentTheme === 'cyberpunk' && currentMode === 'dark',
                   'border-cyan-400/40 bg-white text-sky-600 font-mono hover:border-fuchsia-400 hover:text-fuchsia-600': currentTheme === 'cyberpunk' && currentMode === 'light',
                   'border-emerald-500/20 text-emerald-400 font-mono hover:bg-emerald-500/10': currentTheme === 'terminal' && currentMode === 'dark',
                   'border-emerald-600/20 bg-[#ecfdf5] text-[#047857] font-mono hover:bg-emerald-100': currentTheme === 'terminal' && currentMode === 'light',
                   'border-white/10 bg-white/[0.04] text-slate-300 rounded-full backdrop-blur-md shadow-sm hover:bg-white/10': currentTheme === 'aurora' && currentMode === 'dark',
                   'border-indigo-100 bg-white/60 text-slate-700 rounded-full backdrop-blur-md shadow-sm hover:bg-white': currentTheme === 'aurora' && currentMode === 'light',
                   'border-neutral-200 text-neutral-800 font-serif hover:bg-neutral-50': currentTheme === 'editorial' && currentMode === 'light',
                   'border-neutral-800 bg-[#1c1c1f] text-neutral-200 font-serif hover:bg-neutral-900': currentTheme === 'editorial' && currentMode === 'dark'
                 }">
                <i class="fas fa-arrow-left"></i> Powrót
            </a>
        </header>

        <main class="w-full relative">
            <!-- View Mode -->
            <div x-show="!editMode" x-cloak 
                 class="panel-card p-8 min-h-[300px] relative group overflow-hidden"
                 :class="{
                   'bg-black/60 backdrop-blur-sm': currentTheme === 'terminal' && currentMode === 'dark',
                   'bg-white/80 backdrop-blur-sm border border-emerald-600/20': currentTheme === 'terminal' && currentMode === 'light'
                 }">
                 
                 <!-- Cyberpunk corners -->
                 <template x-if="currentTheme === 'cyberpunk'">
                     <div class="absolute inset-0 pointer-events-none">
                         <span class="absolute left-0 top-0 h-3 w-3 border-l-2 border-t-2" :class="currentMode === 'dark' ? 'border-cyan-400' : 'border-sky-600'"></span>
                         <span class="absolute right-0 top-0 h-3 w-3 border-r-2 border-t-2" :class="currentMode === 'dark' ? 'border-cyan-400' : 'border-sky-600'"></span>
                         <span class="absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2" :class="currentMode === 'dark' ? 'border-cyan-400' : 'border-sky-600'"></span>
                         <span class="absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2" :class="currentMode === 'dark' ? 'border-cyan-400' : 'border-sky-600'"></span>
                     </div>
                 </template>

                <div class="prose max-w-none whitespace-pre-wrap text-base leading-relaxed" 
                     :class="currentTheme === 'editorial' ? 'font-serif' : (currentTheme === 'terminal' || currentTheme === 'cyberpunk' ? 'font-mono' : 'font-sans')"
                     x-text="content || 'Brak treści...'"></div>
                     
                <button @click="openEditor()" 
                        class="absolute top-4 right-4 opacity-0 group-hover:opacity-100 theme-btn px-4 py-2 text-xs">
                    <i class="fas fa-lock"></i> Edytuj
                </button>
            </div>

            <!-- Edit Mode -->
            <div x-show="editMode" x-cloak 
                 class="panel-card p-8 space-y-6 relative overflow-hidden"
                 :class="{
                   'bg-black/60 backdrop-blur-sm': currentTheme === 'terminal' && currentMode === 'dark',
                   'bg-white/80 backdrop-blur-sm border border-emerald-600/20': currentTheme === 'terminal' && currentMode === 'light'
                 }">
                 
                 <!-- Cyberpunk corners -->
                 <template x-if="currentTheme === 'cyberpunk'">
                     <div class="absolute inset-0 pointer-events-none">
                         <span class="absolute left-0 top-0 h-3 w-3 border-l-2 border-t-2" :class="currentMode === 'dark' ? 'border-cyan-400' : 'border-sky-600'"></span>
                         <span class="absolute right-0 top-0 h-3 w-3 border-r-2 border-t-2" :class="currentMode === 'dark' ? 'border-cyan-400' : 'border-sky-600'"></span>
                         <span class="absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2" :class="currentMode === 'dark' ? 'border-cyan-400' : 'border-sky-600'"></span>
                         <span class="absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2" :class="currentMode === 'dark' ? 'border-cyan-400' : 'border-sky-600'"></span>
                     </div>
                 </template>

                <div class="flex flex-col gap-2">
                    <label class="text-[10px] uppercase font-bold tracking-wider opacity-60">Hasło edycji</label>
                    <input type="password" x-model="password" placeholder="Wpisz hasło..." class="theme-input py-2 px-3 text-sm">
                </div>
                <div class="flex flex-col gap-2">
                    <label class="text-[10px] uppercase font-bold tracking-wider opacity-60">Treść strony</label>
                    <textarea x-model="tempContent" rows="12" class="theme-input py-3 px-4 resize-none font-mono text-sm"></textarea>
                </div>
                <div class="flex gap-4">
                    <button @click="save()" :disabled="saving" class="theme-btn py-3 px-6 text-sm flex-1 flex items-center justify-center gap-2">
                        <i class="fas fa-save" :class="saving && 'animate-spin'"></i> ZAPISZ ZMIANY
                    </button>
                    <button @click="editMode = false" 
                            class="py-3 px-6 text-sm font-bold border transition"
                            :class="{
                              'border-4 border-black bg-white text-black hover:bg-neutral-100 rounded-none': currentTheme === 'brutalist' && currentMode === 'light',
                              'border-4 border-[#bef264] bg-zinc-800 text-white hover:bg-zinc-700 rounded-none': currentTheme === 'brutalist' && currentMode === 'dark',
                              'border border-cyan-400 bg-transparent text-cyan-300 hover:bg-cyan-500/10 rounded-none': currentTheme === 'cyberpunk' && currentMode === 'dark',
                              'border border-cyan-400 bg-white text-sky-600 hover:bg-sky-50 rounded-none': currentTheme === 'cyberpunk' && currentMode === 'light',
                              'border border-emerald-500/30 bg-transparent text-emerald-400 hover:bg-emerald-500/10 rounded': currentTheme === 'terminal' && currentMode === 'dark',
                              'border border-emerald-600/20 bg-[#ecfdf5] text-[#047857] hover:bg-emerald-100 rounded': currentTheme === 'terminal' && currentMode === 'light',
                              'border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10 rounded-xl': currentTheme === 'aurora' && currentMode === 'dark',
                              'border border-indigo-100 bg-white/70 text-slate-700 hover:bg-white rounded-xl': currentTheme === 'aurora' && currentMode === 'light',
                              'border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 rounded-none': currentTheme === 'editorial' && currentMode === 'light',
                              'border border-neutral-800 bg-[#1c1c1f] text-neutral-200 hover:bg-neutral-900 rounded-none': currentTheme === 'editorial' && currentMode === 'dark'
                            }">
                        Anuluj
                    </button>
                </div>
            </div>
        </main>
    </div>

    <!-- GLOBAL FLOATING THEME SWITCHER -->
    <div x-data="{ open: false }" class="fixed bottom-5 right-5 z-50 font-sans">
        <!-- Button -->
        <button @click="open = !open" 
                :class="{
                  'border-4 border-black bg-yellow-300 text-black shadow-[4px_4px_0_#000] hover:shadow-[6px_6px_0_#000]': currentTheme === 'brutalist',
                  'border border-cyan-400 bg-black text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.5)] hover:border-fuchsia-400 hover:text-fuchsia-300': currentTheme === 'cyberpunk' && currentMode === 'dark',
                  'border border-sky-400 bg-white text-sky-600 shadow-[0_0_10px_rgba(14,165,233,0.15)] hover:border-fuchsia-500 hover:text-fuchsia-600': currentTheme === 'cyberpunk' && currentMode === 'light',
                  'border border-emerald-500 bg-black text-emerald-400 hover:bg-emerald-500/10': currentTheme === 'terminal' && currentMode === 'dark',
                  'border border-emerald-600 bg-white text-emerald-600 hover:bg-emerald-50/50': currentTheme === 'terminal' && currentMode === 'light',
                  'bg-white/5 border border-white/10 text-white shadow-lg backdrop-blur-md hover:bg-white/10': currentTheme === 'aurora' && currentMode === 'dark',
                  'bg-white/70 border border-white/60 text-slate-700 shadow-lg backdrop-blur-md hover:bg-white': currentTheme === 'aurora' && currentMode === 'light',
                  'border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50': currentTheme === 'editorial' && currentMode === 'light',
                  'border border-neutral-800 bg-[#121212] text-neutral-200 hover:bg-neutral-900': currentTheme === 'editorial' && currentMode === 'dark'
                }"
                class="flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 focus:outline-none">
            <i class="fas fa-cog text-lg transition-transform duration-500" :class="open ? 'rotate-90' : ''"></i>
        </button>

        <!-- Dropdown Panel -->
        <div x-show="open" 
             @click.away="open = false"
             x-transition:enter="transition ease-out duration-200"
             x-transition:enter-start="opacity-0 scale-95 translate-y-2"
             x-transition:enter-end="opacity-100 scale-100 translate-y-0"
             x-transition:leave="transition ease-in duration-75"
             x-transition:leave-start="opacity-100 scale-100 translate-y-0"
             x-transition:leave-end="opacity-0 scale-95 translate-y-2"
             :class="{
               'border-4 border-black bg-white text-black shadow-[6px_6px_0_#000]': currentTheme === 'brutalist' && currentMode === 'light',
               'border-4 border-[#bef264] bg-[#18181b] text-white shadow-[6px_6px_0_#fff]': currentTheme === 'brutalist' && currentMode === 'dark',
               'border border-cyan-400/80 bg-[#05010f] text-white shadow-[0_0_15px_rgba(34,211,238,0.3)]': currentTheme === 'cyberpunk' && currentMode === 'dark',
               'border border-cyan-400/40 bg-sky-50 text-slate-900 shadow-[0_0_15px_rgba(14,165,233,0.15)]': currentTheme === 'cyberpunk' && currentMode === 'light',
               'border border-emerald-500 bg-black text-emerald-400': currentTheme === 'terminal' && currentMode === 'dark',
               'border border-emerald-600/30 bg-[#ecfdf5] text-[#047857]': currentTheme === 'terminal' && currentMode === 'light',
               'bg-slate-900/90 border border-white/10 text-white shadow-2xl backdrop-blur-xl rounded-2xl': currentTheme === 'aurora' && currentMode === 'dark',
               'bg-white/95 border border-white/60 text-slate-800 shadow-2xl backdrop-blur-xl rounded-2xl': currentTheme === 'aurora' && currentMode === 'light',
               'border border-neutral-200 bg-white text-neutral-900 rounded-md': currentTheme === 'editorial' && currentMode === 'light',
               'border border-neutral-800 bg-[#121212] text-white rounded-md': currentTheme === 'editorial' && currentMode === 'dark'
             }"
             class="absolute bottom-14 right-0 mt-2 w-56 p-3 flex flex-col gap-1.5 focus:outline-none select-none">
             
             <div class="px-2 py-1 text-xs font-bold uppercase tracking-wider opacity-60"
                  :class="currentTheme === 'terminal' || currentTheme === 'cyberpunk' || currentTheme === 'aurora' || (currentTheme === 'editorial' && currentMode === 'dark') || (currentTheme === 'brutalist' && currentMode === 'dark') ? 'text-white/50' : 'text-neutral-500'">
                  Styl strony:
             </div>
             
             <!-- Brutalist -->
             <button @click="currentTheme = 'brutalist'; open = false"
                     :class="currentTheme === 'brutalist' ? 'bg-lime-300 text-black border-2 border-black font-bold shadow-[2px_2px_0_#000]' : (currentTheme === 'cyberpunk' || currentTheme === 'terminal' || (currentTheme === 'editorial' && currentMode === 'dark') || (currentTheme === 'brutalist' && currentMode === 'dark') ? 'hover:bg-white/5 text-neutral-300' : 'hover:bg-neutral-100 text-neutral-700')"
                     class="flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-all duration-150 rounded-lg">
                     <span class="inline-block w-3.5 h-3.5 rounded-full border border-black bg-[#fdf6e3]"></span>
                     Neo-Brutalizm
             </button>
             
             <!-- Cyberpunk -->
             <button @click="currentTheme = 'cyberpunk'; open = false"
                     :class="currentTheme === 'cyberpunk' ? 'bg-fuchsia-500 text-white border border-fuchsia-300 shadow-[0_0_8px_rgba(217,70,239,0.6)] font-bold' : (currentTheme === 'cyberpunk' || currentTheme === 'terminal' || (currentTheme === 'editorial' && currentMode === 'dark') || (currentTheme === 'brutalist' && currentMode === 'dark') ? 'hover:bg-white/5 text-neutral-300' : 'hover:bg-neutral-100 text-slate-700')"
                     class="flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-all duration-150 rounded-lg">
                     <span class="inline-block w-3.5 h-3.5 rounded-full border border-cyan-400 bg-cyan-400 shadow-[0_0_5px_#22d3ee]"></span>
                     Cyber Dashboard
             </button>
             
             <!-- Terminal -->
             <button @click="currentTheme = 'terminal'; open = false"
                     :class="currentTheme === 'terminal' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400 font-bold' : (currentTheme === 'cyberpunk' || currentTheme === 'terminal' || (currentTheme === 'editorial' && currentMode === 'dark') || (currentTheme === 'brutalist' && currentMode === 'dark') ? 'hover:bg-white/5 text-neutral-400' : 'hover:bg-neutral-100 text-slate-700')"
                     class="flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-all duration-150 rounded-lg">
                     <span class="inline-block w-3.5 h-3.5 rounded bg-emerald-500 border border-emerald-400"></span>
                     Dev Terminal
             </button>
             
             <!-- Aurora -->
             <button @click="currentTheme = 'aurora'; open = false"
                     :class="currentTheme === 'aurora' ? 'bg-indigo-600 text-white font-bold' : (currentTheme === 'cyberpunk' || currentTheme === 'terminal' || (currentTheme === 'editorial' && currentMode === 'dark') || (currentTheme === 'brutalist' && currentMode === 'dark') ? 'hover:bg-white/5 text-neutral-300' : 'hover:bg-slate-100 text-slate-700')"
                     class="flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-all duration-150 rounded-lg">
                     <span class="inline-block w-3.5 h-3.5 rounded-full bg-gradient-to-tr from-indigo-500 to-pink-500 shadow"></span>
                     Glassmorphism
             </button>
             
             <!-- Editorial -->
             <button @click="currentTheme = 'editorial'; open = false"
                     :class="currentTheme === 'editorial' ? 'bg-neutral-900 text-white font-bold' : (currentTheme === 'cyberpunk' || currentTheme === 'terminal' || (currentTheme === 'editorial' && currentMode === 'dark') || (currentTheme === 'brutalist' && currentMode === 'dark') ? 'hover:bg-white/5 text-neutral-300' : 'hover:bg-neutral-100 text-neutral-700')"
                     class="flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-all duration-150 rounded-lg">
                     <span class="inline-block w-3.5 h-3.5 rounded-full border border-neutral-300 bg-white shadow-sm"></span>
                     Editorial
             </button>

             <!-- Separator line -->
             <div class="border-t my-1"
                  :class="{
                    'border-black border-t-2': currentTheme === 'brutalist' && currentMode === 'light',
                    'border-[#bef264] border-t-2': currentTheme === 'brutalist' && currentMode === 'dark',
                    'border-white/10': currentTheme === 'cyberpunk' || currentTheme === 'aurora',
                    'border-emerald-500/20': currentTheme === 'terminal',
                    'border-neutral-200': currentTheme === 'editorial' && currentMode === 'light',
                    'border-neutral-800': currentTheme === 'editorial' && currentMode === 'dark'
                  }"></div>

             <div class="px-2 py-1 text-xs font-bold uppercase tracking-wider opacity-60"
                  :class="currentTheme === 'terminal' || currentTheme === 'cyberpunk' || currentTheme === 'aurora' || (currentTheme === 'editorial' && currentMode === 'dark') || (currentTheme === 'brutalist' && currentMode === 'dark') ? 'text-white/50' : 'text-neutral-500'">
                  Tryb:
             </div>
             
             <div class="flex p-0.5"
                  :class="{
                    'border-2 border-black bg-white rounded-none': currentTheme === 'brutalist' && currentMode === 'light',
                    'border-2 border-[#bef264] bg-[#18181b] rounded-none text-white': currentTheme === 'brutalist' && currentMode === 'dark',
                    'border border-cyan-400/50 bg-[#0d081e] text-cyan-300 rounded-md': currentTheme === 'cyberpunk' && currentMode === 'dark',
                    'border border-cyan-400 bg-white text-cyan-500 rounded-md': currentTheme === 'cyberpunk' && currentMode === 'light',
                    'border border-emerald-500/30 bg-black text-emerald-400 rounded': currentTheme === 'terminal' && currentMode === 'dark',
                    'border border-emerald-600/30 bg-white text-emerald-600 rounded': currentTheme === 'terminal' && currentMode === 'light',
                    'border border-white/10 bg-white/[0.04] text-white rounded-xl': currentTheme === 'aurora' && currentMode === 'dark',
                    'border border-white/15 bg-white/70 text-slate-700 rounded-xl': currentTheme === 'aurora' && currentMode === 'light',
                    'border border-neutral-200 bg-neutral-50 rounded-sm': currentTheme === 'editorial' && currentMode === 'light',
                    'border border-neutral-800 bg-[#121212] text-white rounded-sm': currentTheme === 'editorial' && currentMode === 'dark'
                  }">
                 <button @click="currentMode = 'light'"
                         class="flex-1 py-1 text-xs font-bold transition-all duration-150 text-center"
                         :class="{
                           'bg-black text-white rounded-none': currentMode === 'light' && currentTheme === 'brutalist' && currentMode === 'light',
                           'bg-white text-black rounded-none': currentMode === 'light' && currentTheme === 'brutalist' && currentMode === 'dark',
                           'bg-cyan-400 text-black font-bold': currentMode === 'light' && currentTheme === 'cyberpunk',
                           'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 rounded': currentMode === 'light' && currentTheme === 'terminal',
                           'bg-white text-slate-900 rounded-lg shadow-sm': currentMode === 'light' && currentTheme === 'aurora',
                           'bg-neutral-900 text-white': currentMode === 'light' && currentTheme === 'editorial' && currentMode === 'light',
                           'bg-white text-black': currentMode === 'light' && currentTheme === 'editorial' && currentMode === 'dark',
                           'opacity-50 hover:opacity-100': currentMode !== 'light'
                         }">
                     Jasny
                 </button>
                 <button @click="currentMode = 'dark'"
                         class="flex-1 py-1 text-xs font-bold transition-all duration-150 text-center"
                         :class="{
                           'bg-black text-white rounded-none': currentMode === 'dark' && currentTheme === 'brutalist' && currentMode === 'light',
                           'bg-[#bef264] text-black rounded-none': currentMode === 'dark' && currentTheme === 'brutalist' && currentMode === 'dark',
                           'bg-cyan-400 text-black font-bold': currentMode === 'dark' && currentTheme === 'cyberpunk',
                           'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 rounded': currentMode === 'dark' && currentTheme === 'terminal',
                           'bg-white text-slate-900 rounded-lg shadow-sm': currentMode === 'dark' && currentTheme === 'aurora' && currentMode === 'dark',
                           'bg-white text-slate-900 rounded-lg shadow-sm': currentMode === 'dark' && currentTheme === 'aurora' && currentMode === 'light',
                           'bg-neutral-900 text-white': currentMode === 'dark' && currentTheme === 'editorial' && currentMode === 'light',
                           'bg-white text-black': currentMode === 'dark' && currentTheme === 'editorial' && currentMode === 'dark',
                           'opacity-50 hover:opacity-100': currentMode !== 'dark'
                         }">
                     Ciemny
                 </button>
             </div>
        </div>
    </div>

    <script>
        function bichuApp() {
            return {
                content: '',
                tempContent: '',
                password: '',
                editMode: false,
                saving: false,
                currentTheme: getGlobalTheme(),
                currentMode: getGlobalMode(),

                setTheme(val) {
                    this.currentTheme = val;
                    this.currentMode = (val === 'brutalist' || val === 'editorial') ? 'light' : 'dark';
                    setGlobalTheme(val);
                    setGlobalMode(this.currentMode);
                    this.updateRootClasses();
                },

                setMode(val) {
                    this.currentMode = val;
                    setGlobalMode(val);
                    this.updateRootClasses();
                },

                updateRootClasses() {
                    document.documentElement.className = 'theme-' + this.currentTheme + ' mode-' + this.currentMode;
                },

                async init() {
                    this.updateRootClasses();
                    this.$watch('currentTheme', val => this.setTheme(val));
                    this.$watch('currentMode', val => this.setMode(val));

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
