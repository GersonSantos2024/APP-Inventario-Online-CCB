// Refatoração do JS principal para src/app.js
// Dependências (carregadas via CDN e defer): PapaParse, jsPDF, html5-qrcode

(() => {
    // ==== Variáveis e Estado ==== 
    let appMode = 'desktop';
    let html5QrCode = null;
    let churchesMapping = {};
    let setorMapping = {};
    let churchSectorMapping = {};
    let allInventoryData = [];
    let currentChurchInventory = [];
    let unreadItems = [];
    let currentInputEnabled = false;
    let lastScanTime = 0;
    let audioContext = null;

    // Elementos
    const loginOverlay = document.getElementById('loginOverlay');
    const btnLogin = document.getElementById('btnLogin');
    const sysPassword = document.getElementById('sysPassword');
    const loginError = document.getElementById('loginError');
    const modeOverlay = document.getElementById('modeOverlay');
    const modeButtons = Array.from(document.querySelectorAll('.mode-btn'));
    const appSidebar = document.getElementById('appSidebar');
    const appMain = document.getElementById('appMain');
    const fileIgrejas = document.getElementById('fileIgrejas');
    const fileGeral = document.getElementById('fileGeral');
    const casaOracaoSelect = document.getElementById('casaOracaoSelect');
    const setorAdministrativoSelect = document.getElementById('setorAdministrativoSelect');
    const btnStart = document.getElementById('btnStart');
    const btnFinalize = document.getElementById('btnFinalize');
    const btnExportCsv = document.getElementById('btnExportCsv');
    const bemEscaneado = document.getElementById('bemEscaneado');
    const readerContainer = document.getElementById('reader-container');
    const cameraStatus = document.getElementById('camera-status');

    // Contadores e tabela
    const countTotal = document.getElementById('countTotal');
    const countLocated = document.getElementById('countLocated');
    const countMissing = document.getElementById('countMissing');
    const countUnknown = document.getElementById('countUnknown');
    const tableBody = document.getElementById('tableBody');

    // Inicialização: listeners que devem ser registrados uma vez
    function init() {
        btnLogin.addEventListener('click', checkAccess);
        sysPassword.addEventListener('keydown', function (e) { if (e.key === 'Enter') checkAccess(); });

        modeButtons.forEach(btn => btn.addEventListener('click', () => setAppMode(btn.dataset.mode)));

        fileIgrejas.addEventListener('change', handleFileIgrejas);
        fileGeral.addEventListener('change', handleFileGeral);

        btnStart.addEventListener('click', startInventory);
        btnFinalize.addEventListener('click', finalizeInventory);
        btnExportCsv.addEventListener('click', exportCsv);

        // listener de leitura física - registrado uma vez
        bemEscaneado.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' && currentInputEnabled) {
                processBarcode(this.value);
                this.value = '';
            }
        });

        casaOracaoSelect.addEventListener('change', function () {
            const codigo = this.value;
            const setor = churchSectorMapping[codigo];
            if (setor) setorAdministrativoSelect.value = setor;
        });

        // Restauração de estado (se houver)
        restoreStateFromLocalStorage();
    }

    // ====== Autenticação simples (temporal) ====== 
    function checkAccess() {
        const pwd = sysPassword.value;
        // Mitigação temporária: usar hash armazenado no localStorage (não seguro em produção)
        const storedHash = localStorage.getItem('inventory_pwd_hash');
        if (!storedHash) {
            // Primeiro uso: solicita configurar senha (para não deixar hard-coded)
            const setPwd = prompt('Configure uma senha temporária para este dispositivo (apenas local):');
            if (setPwd && setPwd.length >= 4) {
                localStorage.setItem('inventory_pwd_hash', btoa(setPwd));
                alert('Senha configurada localmente. Use-a para acessar.');
                return;
            } else {
                alert('Senha não configurada. Deve ter ao menos 4 caracteres.');
                return;
            }
        }

        if (btoa(pwd) === storedHash) {
            loginOverlay.style.display = 'none';
            modeOverlay.style.display = 'flex';
            appSidebar.classList.add('unlocked');
            appMain.classList.add('unlocked');
        } else {
            loginError.style.display = 'block';
            sysPassword.value = '';
        }
    }

    // ====== CSV: uso de PapaParse para robustez ======
    function handleFileIgrejas(event) {
        const file = event.target.files[0]; if (!file) return;
        Papa.parse(file, {
            header: false,
            dynamicTyping: false,
            skipEmptyLines: true,
            encoding: 'ISO-8859-1',
            complete: function (results) {
                try {
                    churchesMapping = {};
                    churchSectorMapping = {};
                    setorAdministrativoSelect.innerHTML = '<option value="">Selecione o Setor...</option>';
                    casaOracaoSelect.innerHTML = '<option value="">Selecione a Casa de Oração...</option>';

                    let count = 0;
                    const setoresEncontrados = new Set();
                    results.data.forEach((row, idx) => {
                        // row é um array
                        if (!row || row.length < 2) return;
                        const cols = row.map(c => String(c || '').trim());
                        const codigo = (cols[0] || '').replace(/[^0-9]/g, '');
                        const localidade = cols[1] || '';
                        const setor = (cols[2] || '').toUpperCase();
                        if (!codigo) return;
                        churchesMapping[codigo] = localidade;
                        churchSectorMapping[codigo] = setor;
                        casaOracaoSelect.appendChild(new Option(`${codigo} - ${localidade}`, codigo));
                        if (setor && !setoresEncontrados.has(setor)) {
                            setoresEncontrados.add(setor);
                            setorAdministrativoSelect.appendChild(new Option(setor, setor));
                        }
                        count++;
                    });
                    alert(`${count} Casas de Oração carregadas`);
                } catch (err) { alert('Erro ao carregar arquivo de igrejas: ' + err.message); }
            },
            error: function (err) { alert('Erro PapaParse (igrejas): ' + err.message); }
        });
    }

    function handleFileGeral(event) {
        const file = event.target.files[0]; if (!file) return;
        Papa.parse(file, {
            header: false,
            dynamicTyping: false,
            skipEmptyLines: true,
            encoding: 'ISO-8859-1',
            complete: function (results) {
                try {
                    const rows = results.data;
                    allInventoryData = [];

                    // Tenta detectar cabeçalho nas primeiras linhas
                    let startIndex = 0;
                    let idxCodigo = 0, idxNome = 1, idxDependencia = 2;
                    for (let i = 0; i < Math.min(10, rows.length); i++) {
                        const line = (rows[i] || []).join(' ').toLowerCase();
                        if (line.includes('código') || line.includes('codigo') || line.includes('cod')) {
                            startIndex = i + 1;
                            const headers = rows[i].map(h => String(h || '').replace(/['"]/g, '').trim().toLowerCase());
                            headers.forEach((h, index) => {
                                if (h.includes('cod')) idxCodigo = index;
                                else if (h.includes('nome') || h.includes('descri')) idxNome = index;
                                else if (h.includes('depend') || h.includes('local')) idxDependencia = index;
                            });
                            break;
                        }
                    }

                    for (let r = startIndex; r < rows.length; r++) {
                        const row = rows[r];
                        if (!row || row.length === 0) continue;
                        const cols = row.map(c => String(c || '').trim());
                        const rawCode = cols[idxCodigo] || '';
                        const codigo = rawCode.replace(/[^0-9]/g, '').substring(0, 12);
                        if (codigo) {
                            allInventoryData.push({
                                codigo: codigo,
                                nome: cols[idxNome] || '-',
                                dependencia: cols[idxDependencia] || '-',
                                status: 'Não Localizado',
                                churchCode: 'Desconhecida'
                            });
                        }
                    }

                    if (allInventoryData.length > 0) alert(`Bens carregados: ${allInventoryData.length} itens.`);
                    else alert('Nenhum bem válido encontrado no arquivo CSV!');
                } catch (e) { alert('Erro de arquivo (geral): ' + e.message); }
            },
            error: function (err) { alert('Erro PapaParse (geral): ' + err.message); }
        });
    }

    // ====== Inventário ======
    function setAppMode(mode) {
        appMode = mode;
        modeOverlay.style.display = 'none';
        if (mode === 'mobile') containerLeitorFisicoDisplay(false);
        else containerLeitorFisicoDisplay(true);
    }

    function containerLeitorFisicoDisplay(show) {
        const cont = document.getElementById('containerLeitorFisico');
        if (show) { cont.style.display = 'block'; readerContainer.style.display = 'none'; }
        else { cont.style.display = 'none'; }
    }

    function startInventory() {
        try {
            if (allInventoryData.length === 0) { alert('A Base Geral não foi carregada ou está vazia.'); return; }
            const selectedChurchCode = casaOracaoSelect.value;
            if (!selectedChurchCode) { alert('Por favor, selecione a Casa de Oração.'); return; }

            if (!audioContext) {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (AudioContextClass) audioContext = new AudioContextClass();
            }

            const churchCodes = Object.keys(churchesMapping).sort((a, b) => b.length - a.length);
            allInventoryData.forEach(item => {
                for (let cCode of churchCodes) {
                    if (item.codigo && item.codigo.startsWith(cCode)) {
                        item.churchCode = cCode; break;
                    }
                }
            });

            currentChurchInventory = allInventoryData.filter(item => item.churchCode === selectedChurchCode);
            unreadItems = [];
            currentInputEnabled = true;

            btnStart.disabled = true;
            btnFinalize.disabled = false;
            fileIgrejas.disabled = true;
            fileGeral.disabled = true;
            casaOracaoSelect.disabled = true;
            setorAdministrativoSelect.disabled = true;
            renderTable(); updateCounters();

            if (appMode === 'desktop') {
                bemEscaneado.readOnly = false;
                bemEscaneado.placeholder = 'Escaneie o código aqui...';
                bemEscaneado.focus();
            } else {
                if (typeof Html5Qrcode === 'undefined') throw new Error('Biblioteca da câmera bloqueada ou sem internet.');
                readerContainer.style.display = 'block';
                cameraStatus.innerText = 'Aguardando Câmera...';

                setTimeout(() => { document.getElementById('reader').innerHTML = '';
                    try {
                        html5QrCode = new Html5Qrcode('reader');
                        html5QrCode.start({ facingMode: 'environment' }, { fps: 10 }, (decodedText) => {
                            if (Date.now() - lastScanTime > 1500 && currentInputEnabled) {
                                lastScanTime = Date.now();
                                playBeep();
                                processBarcode(decodedText);
                            }
                        }).then(() => {
                            cameraStatus.innerText = 'Câmera Ativa. Aponte para o Código.';
                            cameraStatus.style.backgroundColor = 'var(--success)';
                        }).catch(err => {
                            cameraStatus.innerText = 'Erro/Permissão Negada!';
                            cameraStatus.style.backgroundColor = 'var(--danger)';
                            alert('Erro de Câmera: ' + err);
                        });
                    } catch (camErr) { alert('Falha interna de Vídeo: ' + camErr.message); }
                }, 400);
            }
        } catch (err) { alert('Erro grave ao iniciar: ' + err.message); }
    }

    function playBeep() {
        try {
            if (!audioContext) return;
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            oscillator.type = 'sine'; oscillator.frequency.value = 1000;
            gainNode.gain.setValueAtTime(1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
            oscillator.connect(gainNode); gainNode.connect(audioContext.destination);
            oscillator.start(); oscillator.stop(audioContext.currentTime + 0.1);
        } catch (e) { console.error('beep error', e); }
    }

    function processBarcode(rawBarcode) {
        if (!rawBarcode) return;
        const formattedBarcode = String(rawBarcode).replace(/[^0-9]/g, '').substring(0, 12);
        let foundInCurrent = false;

        for (let item of currentChurchInventory) {
            if (item.codigo === formattedBarcode) {
                item.status = 'Localizado';
                foundInCurrent = true; break;
            }
        }

        if (!foundInCurrent && !unreadItems.find(item => item.codigo === formattedBarcode)) {
            const foundInGlobal = allInventoryData.find(item => item.codigo === formattedBarcode);
            if (foundInGlobal) {
                const nomeIgrejaAlheia = churchesMapping[foundInGlobal.churchCode] || 'Igreja Desconhecida';
                unreadItems.push({ ...foundInGlobal, status: 'Não Identificado', infoExtra: `Atenção: Este bem é da ${nomeIgrejaAlheia}` });
            } else {
                unreadItems.push({ codigo: formattedBarcode, nome: 'Não consta na Base Geral', dependencia: '-', status: 'Não Identificado', infoExtra: '' });
            }
        }
        renderTable(); updateCounters(); saveStateToLocalStorage();
    }

    function updateCounters() {
        const total = currentChurchInventory.length;
        const located = currentChurchInventory.filter(i => i.status === 'Localizado').length;
        countTotal.innerText = total;
        countLocated.innerText = located;
        countMissing.innerText = total - located;
        countUnknown.innerText = unreadItems.length;
    }

    function sanitizeText(str) {
        if (!str) return '-';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', "/": '&#x2F;' };
        return String(str).replace(/[&<>"'\/]/g, (m) => map[m]);
    }

    function renderTable() {
        tableBody.innerHTML = '';
        const allItems = [...currentChurchInventory, ...unreadItems];
        if (allItems.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;">Nenhum item localizado para esta Casa de Oração.</td></tr>`; return;
        }

        allItems.forEach(item => {
            const badgeClass = item.status === 'Localizado' ? 'bg-success' : item.status === 'Não Localizado' ? 'bg-danger' : 'bg-warning';
            const safeExtra = item.infoExtra ? sanitizeText(item.infoExtra) : '';
            const extraHTML = safeExtra ? `<span class="alerta-ext">${safeExtra}</span>` : '';
            const tr = document.createElement('tr');
            const tdCode = document.createElement('td'); tdCode.innerHTML = `<strong>${sanitizeText(item.codigo)}</strong>`;
            const tdName = document.createElement('td'); tdName.innerHTML = `${sanitizeText(item.nome)} ${extraHTML}`;
            const tdDep = document.createElement('td'); tdDep.innerText = sanitizeText(item.dependencia);
            const tdStatus = document.createElement('td'); tdStatus.innerHTML = `<span class="badge ${badgeClass}">${item.status}</span>`;
            tr.appendChild(tdCode); tr.appendChild(tdName); tr.appendChild(tdDep); tr.appendChild(tdStatus);
            tableBody.appendChild(tr);
        });
    }

    // ====== Export CSV ======
    function exportCsv() {
        const allItems = [...currentChurchInventory, ...unreadItems];
        if (allItems.length === 0) { alert('Nenhum dado para exportar.'); return; }
        const headers = ['codigo', 'nome', 'dependencia', 'status', 'infoExtra'];
        const rows = allItems.map(i => headers.map(h => '"' + String(i[h] || '').replace(/"/g, '""') + '"').join(','));
        const csvContent = headers.join(',') + '\n' + rows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=ISO-8859-1;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'inventario_export.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }

    // ====== Finalizar (PDF) ======
    function finalizeInventory() {
        if (!confirm('Deseja fechar o inventário e baixar o arquivo PDF automaticamente?')) return;
        currentInputEnabled = false;
        if (html5QrCode) {
            try { html5QrCode.stop().then(() => { readerContainer.style.display = 'none'; }).catch(e => { console.warn(e); }); } catch (e) { console.warn(e); }
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        doc.setFontSize(16); doc.setTextColor(42, 157, 143);
        doc.text('Relatório de Inventário - Casa de Oração', 14, 20);

        const invName = document.getElementById('nomeInventariante').value;
        const adminSector = setorAdministrativoSelect.options[setorAdministrativoSelect.selectedIndex]?.text || '';
        const date = document.getElementById('dataInventario').value;
        const churchName = casaOracaoSelect.options[casaOracaoSelect.selectedIndex]?.text || '';

        doc.setFontSize(10); doc.setTextColor(51, 51, 51);
        doc.text(`Inventariante: ${invName}`, 14, 30);
        doc.text(`Setor Adm: ${adminSector}`, 14, 36);
        doc.text(`Local: ${churchName}`, 14, 42);
        doc.text(`Data: ${date}`, 14, 48);

        const allItems = [...currentChurchInventory, ...unreadItems];
        const tableData = allItems.map(item => [item.codigo, item.infoExtra ? `${item.nome}\n\n>> ${item.infoExtra}` : item.nome, item.dependencia, item.status]);

        doc.autoTable({
            startY: 55, head: [["Código", "Nome / Descrição", "Dependência", "Status"]], body: tableData, theme: 'grid',
            headStyles: { fillColor: [42, 157, 143] }, styles: { fontSize: 8 }, columnStyles: { 1: { cellWidth: 80 } },
            didParseCell: function (data) {
                if (data.section === 'body' && data.column.index === 3) {
                    if (data.cell.raw === 'Localizado') data.cell.styles.textColor = [40, 167, 69];
                    else if (data.cell.raw === 'Não Localizado') data.cell.styles.textColor = [220, 53, 69];
                    else if (data.cell.raw === 'Não Identificado') data.cell.styles.textColor = [220, 120, 0];
                }
            }
        });

        const safeChurchName = (churchName || 'inventario').replace(/[^a-zA-Z0-9]/g, '_');
        doc.save(`Inventario_${safeChurchName}.pdf`);
    }

    // ====== Persistência Local (salvar/recuperar) ======
    function saveStateToLocalStorage() {
        try {
            const payload = {
                allInventoryData, currentChurchInventory, unreadItems, churchesMapping, churchSectorMapping
            };
            localStorage.setItem('inventory_state_v1', JSON.stringify(payload));
        } catch (e) { console.warn('Falha ao salvar estado local:', e); }
    }

    function restoreStateFromLocalStorage() {
        try {
            const raw = localStorage.getItem('inventory_state_v1');
            if (!raw) return;
            const obj = JSON.parse(raw);
            if (obj.allInventoryData) allInventoryData = obj.allInventoryData;
            if (obj.currentChurchInventory) currentChurchInventory = obj.currentChurchInventory;
            if (obj.unreadItems) unreadItems = obj.unreadItems;
            if (obj.churchesMapping) churchesMapping = obj.churchesMapping;
            if (obj.churchSectorMapping) churchSectorMapping = obj.churchSectorMapping;
            renderTable(); updateCounters();
        } catch (e) { console.warn('Falha ao restaurar estado local:', e); }
    }

    // Inicializa
    document.addEventListener('DOMContentLoaded', init);
})();
