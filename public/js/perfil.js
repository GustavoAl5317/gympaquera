(function () {
    function notify(msg, type) {
        var t = type || "info";
        if (window.showToast) window.showToast(String(msg), { type: t });
        else alert(msg);
    }

    function closePerfilMobileSidebar() {
        var d = document.getElementById("perfil-sidebar-details");
        if (d && window.matchMedia("(max-width: 899px)").matches) d.open = false;
    }

    var currentUserId = null;
    var chatOtherId = null;
    var chatOtherNickname = null;
    var chatOtherPublicUid = null;
    var peerOtherOnline = false;
    var peerOtherTyping = false;
    var typingClearTimer = null;
    var localTypingStopTimer = null;
    /** slot0–2 para POST /users/me/photos/:slot ao trocar/adicionar foto na galeria */
    var galleryReplaceSlot = null;

    function esc(s) {
        if (s == null) return '';
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function ageFromNascimento(nascimento) {
        if (!nascimento) return null;
        var d = new Date(String(nascimento) + 'T12:00:00');
        if (Number.isNaN(d.getTime())) return null;
        var today = new Date();
        var age = today.getFullYear() - d.getFullYear();
        var m = today.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
        return age;
    }

    function getPanels() {
        return {
            overview: document.getElementById('perfil-overview'),
            display: document.getElementById('display-frame')
        };
    }

    function showProfileShell() {
        var p = getPanels();
        if (p.overview) p.overview.classList.remove('hidden');
        if (p.display) {
            p.display.classList.remove('perfil-display-fill');
            p.display.classList.add('hidden');
            p.display.innerHTML = '';
        }
    }

    function showDynamicShell() {
        var p = getPanels();
        if (p.overview) p.overview.classList.add('hidden');
        if (p.display) p.display.classList.remove('hidden');
    }

    /**
     * @param {object} u user from API
     * @param {{ grid: string, gCount?: string, addBtn?: string, replaceInputId?: string }} cfg element ids
     * @param {'overview'|'edit'} variant empty-state hint
     */
    function populateUserGallery(u, cfg, variant) {
        variant = variant || 'overview';
        var grid = document.getElementById(cfg.grid);
        if (!grid || !u) return;

        var gCount = cfg.gCount ? document.getElementById(cfg.gCount) : null;
        var addBtn = cfg.addBtn ? document.getElementById(cfg.addBtn) : null;
        var replaceInputId = cfg.replaceInputId || 'perfilGalReplaceInput';

        var emptyHint =
            variant === 'edit'
                ? 'Use <strong>Adicionar foto</strong> acima. Você pode enviar até três imagens por vez, que substituirão o álbum anterior.'
                : 'Use <strong>Adicionar foto</strong> acima ou envie até três imagens de uma vez em <strong>Editar perfil</strong>.';

        function bindGaleriaAdd(urlsLen) {
            if (!addBtn) return;
            if (urlsLen >= 3) {
                addBtn.hidden = true;
                addBtn.onclick = null;
                return;
            }
            addBtn.hidden = false;
            addBtn.onclick = function (e) {
                e.preventDefault();
                galleryReplaceSlot = urlsLen;
                var inp = document.getElementById(replaceInputId);
                if (inp) inp.click();
            };
        }

        if (!u.photos || !u.photos.length) {
            grid.classList.remove('has-lead');
            if (gCount) gCount.hidden = true;
            grid.innerHTML =
                '<div class="perfil-gallery-empty" role="status">' +
                '<i class="bi bi-images" aria-hidden="true"></i>' +
                '<p>Nenhuma foto na galeria</p>' +
                '<p class="perfil-gallery-empty-hint">' +
                emptyHint +
                '</p>' +
                '</div>';
            bindGaleriaAdd(0);
            return;
        }

        var urls = u.photos.filter(function (x) {
            return x != null && String(x).trim() !== '';
        });
        if (gCount) {
            gCount.textContent = urls.length + (urls.length === 1 ? ' foto' : ' fotos');
            gCount.hidden = false;
        }
        bindGaleriaAdd(urls.length);
        var useLead = urls.length >= 3;
        grid.classList.toggle('has-lead', useLead);
        grid.innerHTML = urls
            .map(function (src, i) {
                var leadItem = useLead && i === 0 ? ' perfil-gallery-item--lead' : '';
                return (
                    '<div class="perfil-gallery-item' +
                    leadItem +
                    '" data-gal-idx="' +
                    i +
                    '" role="button" tabindex="0" aria-label="Ampliar foto ' +
                    (i + 1) +
                    '">' +
                    '<img src="' +
                    esc(src) +
                    '" alt="" loading="lazy" decoding="async" class="perfil-gallery-thumb">' +
                    '<div class="perfil-gallery-manage">' +
                    '<button type="button" class="perfil-gal-btn perfil-gal-replace" data-slot="' +
                    i +
                    '"><i class="bi bi-arrow-repeat" aria-hidden="true"></i><span>Trocar</span></button>' +
                    '<button type="button" class="perfil-gal-btn perfil-gal-remove" data-slot="' +
                    i +
                    '"><i class="bi bi-trash3" aria-hidden="true"></i><span>Excluir</span></button>' +
                    '</div></div>'
                );
            })
            .join('');
        wirePerfilGalleryLightbox(grid, urls);
        wirePerfilGalleryManage(grid);
    }

    function afterUserPhotosChanged(u) {
        if (!u) return;
        fillPerfilOverview(u);
        if (document.getElementById('editGaleriaGrid')) {
            populateUserGallery(
                u,
                {
                    grid: 'editGaleriaGrid',
                    gCount: 'editGaleriaCount',
                    addBtn: 'editGaleriaAddBtn',
                    replaceInputId: 'perfilGalReplaceInput'
                },
                'edit'
            );
        }
    }

    function fillPerfilOverview(u) {
        if (!u) return;
        var greet = document.getElementById('headerGreeting');
        if (greet) greet.textContent = 'Olá, ' + u.nickname + '!';
        var avLetter = document.getElementById('headerAvatarLetter');
        if (avLetter && u.nickname) {
            avLetter.textContent = String(u.nickname).charAt(0).toUpperCase();
        }

        var age = ageFromNascimento(u.nascimento);
        var titleEl = document.getElementById('profileTitle');
        if (titleEl) {
            var nick = u.nickname || '—';
            titleEl.textContent = age != null ? nick + ', ' + age + ' anos' : nick;
        }

        var gymLoc = document.getElementById('profileGymLoc');
        if (gymLoc) {
            var gymStr = u.gym && String(u.gym).trim() ? String(u.gym) : 'Academia não informada';
            var locStr =
                u.cidade && String(u.cidade).trim()
                    ? String(u.cidade) + (u.estado ? ', ' + String(u.estado) : '')
                    : 'Local não informado';
            gymLoc.textContent = gymStr + ' · ' + locStr;
        }

        var souRow = document.getElementById('profileSouProcuro');
        if (souRow) {
            souRow.innerHTML =
                '<span class="perfil-sou-text">' +
                esc(u.sou) +
                ' · Procura por <strong>' +
                esc(u.procuro) +
                '</strong></span>';
        }

        var locRow = document.getElementById('profileCityState');
        if (locRow) {
            locRow.textContent =
                'Mora em ' + (u.cidade && String(u.cidade).trim() ? String(u.cidade) : '—') + ', ' + (u.estado ? String(u.estado) : '—');
        }

        var cardGym = document.getElementById('digitalCardGym');
        if (cardGym) cardGym.textContent = u.gym || '—';
        var cardMat = document.getElementById('digitalCardMatricula');
        if (cardMat) cardMat.textContent = u.matricula && String(u.matricula).trim() ? u.matricula : '—';

        var uidStr = u.publicUid ? String(u.publicUid) : '—';
        var uidEl = document.getElementById('profilePublicUid');
        if (uidEl) uidEl.textContent = 'Código público · ' + uidStr;

        var img = document.getElementById('profileMainPhoto');
        var ph = document.getElementById('profileMainPhotoPh');
        var first = u.photos && u.photos.length ? u.photos[0] : null;
        if (img && ph) {
            if (first) {
                img.src = first;
                img.alt = 'Foto de perfil';
                img.classList.remove('hidden');
                ph.classList.add('hidden');
            } else {
                img.removeAttribute('src');
                img.classList.add('hidden');
                ph.classList.remove('hidden');
                ph.textContent = u.nickname ? String(u.nickname).charAt(0).toUpperCase() : '?';
            }
        }

        var souIcon = document.getElementById('profileSouIcon');
        if (souIcon) {
            souIcon.className =
                'bi perfil-sou-icon ' +
                (u.sou === 'Mulher'
                    ? 'bi-gender-female'
                    : u.sou === 'Casal'
                      ? 'bi-people'
                      : 'bi-gender-male');
        }

        populateUserGallery(
            u,
            {
                grid: 'galeriaGrid',
                gCount: 'galeriaCount',
                addBtn: 'galeriaAddBtn',
                replaceInputId: 'perfilGalReplaceInput'
            },
            'overview'
        );
    }

    function setSidebarUser(u) {
        var greet = document.getElementById('headerGreeting');
        if (greet && u) greet.textContent = 'Olá, ' + u.nickname + '!';
        var avLetter = document.getElementById('headerAvatarLetter');
        if (avLetter && u && u.nickname) {
            avLetter.textContent = String(u.nickname).charAt(0).toUpperCase();
        }
        var el = document.getElementById('sidebarUser');
        if (el && u) {
            el.innerHTML =
                '<div class="sidebar-user-inner">' +
                '<strong>' + esc(u.nickname) + '</strong>' +
                '<span>' + esc(u.email) + '</span>' +
                '</div>';
        }
    }

    function setActiveNav(key) {
        document.querySelectorAll('.sidebar-item[data-frame]').forEach(function (item) {
            var isActive = item.getAttribute('data-frame') === key;
            item.classList.toggle('active-link', isActive);
            item.classList.toggle('font-semibold', isActive);
            item.classList.toggle('text-gray-800', isActive);
        });
    }

    function wireSidebarNav() {
        document.querySelectorAll('[data-frame]').forEach(function (el) {
            if (el.dataset.navWired === '1') return;
            el.dataset.navWired = '1';
            el.addEventListener('click', function (e) {
                e.preventDefault();
                var k = el.getAttribute('data-frame');
                if (k) loadFrame(k);
            });
        });
        var lo = document.querySelector('[data-action="logout"]');
        if (lo && lo.dataset.navWired !== '1') {
            lo.dataset.navWired = '1';
            lo.addEventListener('click', function (e) {
                e.preventDefault();
                closePerfilMobileSidebar();
                logoutServidor();
            });
        }
    }

    async function requireMe() {
        var data = await api('GET', '/auth/me');
        currentUserId = data.user.id;
        setSidebarUser(data.user);
        return data.user;
    }

    var chatListenerAttached = false;

    function appendMessageBubble(m) {
        var box = document.getElementById('cb');
        if (!box || !m) return;
        var sid = String(m.id);
        if (box.querySelector('[data-msg-id="' + sid + '"]')) return;
        var mine = m.from_user_id === currentUserId;
        var div = document.createElement('div');
        div.setAttribute('data-msg-id', sid);
        div.className = 'msg ' + (mine ? 'sent' : 'received');
        div.textContent = m.body;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    }

    function maybeNotifyIncomingChat(data) {
        var msg = data.message;
        var senderNickname = data.senderNickname || '';
        if (!msg || !currentUserId) return;
        if (msg.from_user_id === currentUserId) return;
        if (msg.to_user_id !== currentUserId && msg.from_user_id !== currentUserId) return;
        var inThread = chatOtherId && (msg.from_user_id === chatOtherId || msg.to_user_id === chatOtherId);
        if (inThread && document.visibilityState === 'visible') return;
        var body = String(msg.body || '').replace(/\s+/g, ' ').trim().slice(0, 180);
        if (document.visibilityState === 'visible' && window.showToast) {
            var preview = (senderNickname ? senderNickname + ': ' : '') + (body || 'Novo chat');
            window.showToast(preview, { type: 'info', duration: 5200 });
            return;
        }
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        var title = senderNickname ? senderNickname + ' · Gym Paquera' : 'Novo chat · Gym Paquera';
        try {
            new Notification(title, {
                body: body || 'Você recebeu algo no chat.',
                tag: 'gym-chat-' + String(msg.from_user_id),
                renotify: true
            });
        } catch (e) {}
    }

    function patchPresenceDot(userId, online) {
        var sid = String(userId);
        document.querySelectorAll('.conv-row[data-other-id="' + sid + '"] .presence-dot').forEach(function (d) {
            d.classList.toggle('on', !!online);
        });
    }

    async function refreshPeerPresence() {
        if (!chatOtherId) return;
        try {
            var pr = await api('GET', '/users/presence?ids=' + chatOtherId);
            var u = pr.users && pr.users[String(chatOtherId)];
            peerOtherOnline = !!(u && u.online);
            patchPresenceDot(chatOtherId, peerOtherOnline);
            updateChatHeader();
        } catch (e) {}
    }

    function registerChatRealtime() {
        if (chatListenerAttached || typeof gymChatConnect !== 'function') return;
        gymChatConnect()
            .then(function () {
                if (chatListenerAttached) return;
                chatListenerAttached = true;
                gymChatOnMessage(function (data) {
                    var msg = data.message;
                    if (!currentUserId || !msg) return;
                    if (msg.from_user_id !== currentUserId && msg.to_user_id !== currentUserId) return;
                    maybeNotifyIncomingChat(data);
                    if (!chatOtherId) return;
                    var inThread = msg.from_user_id === chatOtherId || msg.to_user_id === chatOtherId;
                    if (inThread) appendMessageBubble(msg);
                });
                if (typeof gymChatOnTyping === 'function') {
                    gymChatOnTyping(function (data) {
                        if (!data || data.fromUserId !== chatOtherId) return;
                        if (data.typing) {
                            peerOtherTyping = true;
                            updateChatHeader();
                            clearTimeout(typingClearTimer);
                            typingClearTimer = setTimeout(function () {
                                peerOtherTyping = false;
                                updateChatHeader();
                            }, 2800);
                        } else {
                            peerOtherTyping = false;
                            updateChatHeader();
                        }
                    });
                }
                if (typeof gymChatOnPresence === 'function') {
                    gymChatOnPresence(function (data) {
                        if (!data || data.userId == null) return;
                        patchPresenceDot(data.userId, data.online);
                        if (Number(data.userId) === chatOtherId) {
                            peerOtherOnline = !!data.online;
                            updateChatHeader();
                        }
                    });
                }
            })
            .catch(function (e) {
                console.warn('[chat]', e && e.message ? e.message : e);
            });
    }

    function panelHeader(title, subtitle) {
        return (
            '<header class="panel-header">' +
            '<h1>' + esc(title) + '</h1>' +
            (subtitle ? '<p>' + esc(subtitle) + '</p>' : '') +
            '</header>'
        );
    }

    function renderMeuPerfil(u) {
        var firstPhoto = (u.photos && u.photos.length) ? u.photos[0] : null;
        var avatarBlock = firstPhoto
            ? '<img class="profile-avatar" src="' + esc(firstPhoto) + '" alt="">'
            : '<div class="profile-avatar placeholder" aria-hidden="true">💪</div>';

        var photoStrip = (u.photos && u.photos.length)
            ? u.photos.map(function (src) {
                return '<img src="' + esc(src) + '" alt="Foto do perfil">';
            }).join('')
            : '<p style="color:var(--gray);font-size:0.9rem;">Nenhuma foto no cadastro. Fotos ajudam na busca — você pode recriar a conta ou, no futuro, edição de perfil no servidor.</p>';

        return (
            panelHeader('Meu perfil', 'Seus dados vêm direto do servidor. Mantenha academia e cidade corretas para aparecer nas buscas.') +
            '<div class="profile-hero">' +
            '<div class="profile-avatar-wrap">' + avatarBlock + '</div>' +
            '<div class="profile-hero-text">' +
            '<h2>Olá, ' + esc(u.nickname) + '</h2>' +
            '<span class="badge-id">Seu código público · ' + esc(u.publicUid || '—') + '</span>' +
            '<div class="profile-hero-actions">' +
            '<a class="btn btn-primary" href="mypay.html">Premium</a>' +
            '<button type="button" class="btn btn-ghost" onclick="loadFrame(\'busca\')">Busca por match</button>' +
            '</div></div></div>' +

            '<div class="detail-grid">' +
            '<div class="detail-card"><div class="label">E-mail</div><div class="value">' + esc(u.email) + '</div></div>' +
            '<div class="detail-card"><div class="label">Academia</div><div class="value">' + esc(u.gym) + '</div></div>' +
            '<div class="detail-card"><div class="label">Cidade</div><div class="value">' + esc(u.cidade) + '</div></div>' +
            '<div class="detail-card"><div class="label">Estado</div><div class="value">' + esc(u.estado) + '</div></div>' +
            '<div class="detail-card"><div class="label">Eu sou</div><div class="value">' + esc(u.sou) + '</div></div>' +
            '<div class="detail-card"><div class="label">Procuro</div><div class="value">' + esc(u.procuro) + '</div></div>' +
            '<div class="detail-card"><div class="label">Nascimento</div><div class="value">' + esc(u.nascimento) + '</div></div>' +
            (u.matricula ? '<div class="detail-card"><div class="label">Matrícula / ID</div><div class="value">' + esc(u.matricula) + '</div></div>' : '') +
            '</div>' +

            '<section class="photos-section"><h3>Fotos do shape</h3><div class="photo-strip">' + photoStrip + '</div></section>' +

            '<div class="premium-cta">' +
            '<p><strong>Destaque-se.</strong> A assinatura premium pode incluir benefícios extras quando você configurar pagamentos de verdade.</p>' +
            '<a class="btn btn-primary" href="mypay.html">Ver planos</a>' +
            '</div>'
        );
    }

    var optsEstados =
        '<option value="Acre">Acre</option><option value="Alagoas">Alagoas</option><option value="Amapá">Amapá</option><option value="Amazonas">Amazonas</option>' +
        '<option value="Bahia">Bahia</option><option value="Ceará">Ceará</option><option value="Distrito Federal">Distrito Federal</option><option value="Espírito Santo">Espírito Santo</option>' +
        '<option value="Goiás">Goiás</option><option value="Maranhão">Maranhão</option><option value="Mato Grosso">Mato Grosso</option><option value="Mato Grosso do Sul">Mato Grosso do Sul</option>' +
        '<option value="Minas Gerais">Minas Gerais</option><option value="Pará">Pará</option><option value="Paraíba">Paraíba</option><option value="Paraná">Paraná</option>' +
        '<option value="Pernambuco">Pernambuco</option><option value="Piauí">Piauí</option><option value="Rio de Janeiro">Rio de Janeiro</option><option value="Rio Grande do Norte">Rio Grande do Norte</option>' +
        '<option value="Rio Grande do Sul">Rio Grande do Sul</option><option value="Rondônia">Rondônia</option><option value="Roraima">Roraima</option><option value="Santa Catarina">Santa Catarina</option>' +
        '<option value="São Paulo" selected>São Paulo</option><option value="Sergipe">Sergipe</option><option value="Tocantins">Tocantins</option>';

    function frameBusca() {
        return (
            panelHeader(
                'Busca por match',
                'Nossos filtros usam os dados reais da sua conta. A idade, por exemplo, é baseada na sua data de nascimento para criar conexões mais certeiras. E não se preocupe: seus bloqueios são sempre respeitados.'
            ) +
            '<div class="search-panel">' +
            '<div class="search-grid">' +
            '<div class="field"><label for="buscaProcuro">Procuro por</label>' +
            '<select id="buscaProcuro"><option value="Todos">Todos</option><option value="Mulheres">Mulheres</option><option value="Homens">Homens</option><option value="Casais">Casais</option></select></div>' +
            '<div class="field"><label for="buscaEstado">Estado</label><select id="buscaEstado">' + optsEstados + '</select></div>' +
            '<div class="field full-width"><label for="buscaCidade">Cidade (trecho do nome)</label>' +
            '<input type="text" id="buscaCidade" placeholder="Digite sua cidade"></div>' +
            '<div class="field"><label for="buscaIdadeMin">Idade mínima (opcional, mín. 18)</label>' +
            '<input type="number" id="buscaIdadeMin" min="18" max="120" step="1" placeholder="mín. 18"></div>' +
            '<div class="field"><label for="buscaIdadeMax">Idade máxima (opcional)</label>' +
            '<input type="number" id="buscaIdadeMax" min="18" max="120" placeholder="ex.: 45"></div>' +
            '<button type="button" class="btn btn-primary full-width" id="btnBuscar">Buscar match</button>' +
            '</div></div>' +
            '<div id="results" class="results-grid"></div>'
        );
    }

    function estadoOptionsSelected(current) {
        var list = [
            'Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará', 'Distrito Federal', 'Espírito Santo', 'Goiás', 'Maranhão',
            'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará', 'Paraíba', 'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro',
            'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia', 'Roraima', 'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins'
        ];
        return list
            .map(function (st) {
                return '<option value="' + esc(st) + '"' + (st === current ? ' selected' : '') + '>' + esc(st) + '</option>';
            })
            .join('');
    }

    function frameEditarPerfil(u) {
        return (
            '<div class="edit-profile-page">' +
            panelHeader(
                'Editar perfil',
                'As alterações serão aplicadas à busca, ao cartão digital e à vitrine do seu perfil. Você pode enviar até três imagens por vez, que substituirão o álbum anterior.'
            ) +
            '<div class="edit-profile-card">' +
            '<div class="edit-profile-section">' +
            '<h2 class="edit-profile-section-title">Identidade</h2>' +
            '<div class="edit-profile-grid">' +
            '<div class="edit-field edit-field--full">' +
            '<label for="editNick">Apelido</label>' +
            '<input type="text" id="editNick" maxlength="80" value="' +
            esc(u.nickname) +
            '" placeholder="Como quer ser chamado na plataforma" autocomplete="nickname">' +
            '<span class="edit-hint">Aparece em buscas, no chat e no topo do seu perfil.</span>' +
            '</div>' +
            '<div class="edit-field">' +
            '<label for="editNasc">Data de nascimento</label>' +
            '<input type="date" id="editNasc" value="' +
            esc(u.nascimento || '') +
            '">' +
            '<span class="edit-hint">Usada apenas para calcular idade e filtros.</span>' +
            '</div>' +
            '<div class="edit-field">' +
            '<label for="editSou">Eu sou</label>' +
            '<select id="editSou">' +
            '<option value="Homem"' +
            (u.sou === 'Homem' ? ' selected' : '') +
            '>Homem</option>' +
            '<option value="Mulher"' +
            (u.sou === 'Mulher' ? ' selected' : '') +
            '>Mulher</option>' +
            '<option value="Casal"' +
            (u.sou === 'Casal' ? ' selected' : '') +
            '>Casal</option>' +
            '</select>' +
            '</div>' +
            '<div class="edit-field edit-field--full">' +
            '<label for="editProcuro">Procuro</label>' +
            '<select id="editProcuro">' +
            '<option value="Mulheres"' +
            (u.procuro === 'Mulheres' ? ' selected' : '') +
            '>Mulheres</option>' +
            '<option value="Homens"' +
            (u.procuro === 'Homens' ? ' selected' : '') +
            '>Homens</option>' +
            '<option value="Casais"' +
            (u.procuro === 'Casais' ? ' selected' : '') +
            '>Casais</option>' +
            '</select>' +
            '<span class="edit-hint">Define com quem você quer conectar nas buscas.</span>' +
            '</div>' +
            '</div></div>' +
            '<div class="edit-profile-section">' +
            '<h2 class="edit-profile-section-title">Academia e localização</h2>' +
            '<div class="edit-profile-grid">' +
            '<div class="edit-field edit-field--full">' +
            '<label for="editGym">Academia</label>' +
            '<input type="text" id="editGym" maxlength="120" value="' +
            esc(u.gym) +
            '" placeholder="Nome da academia ou rede">' +
            '</div>' +
            '<div class="edit-field">' +
            '<label for="editMat">Matrícula ou ID</label>' +
            '<input type="text" id="editMat" required value="' +
            esc(u.matricula || '') +
            '" placeholder="Ex.: sócios, matrícula interna">' +
            '</div>' +
            '<div class="edit-field">' +
            '<label for="editEstado">Estado</label>' +
            '<select id="editEstado">' +
            estadoOptionsSelected(u.estado) +
            '</select>' +
            '</div>' +
            '<div class="edit-field edit-field--full">' +
            '<label for="editCidade">Cidade</label>' +
            '<input type="text" id="editCidade" value="' +
            esc(u.cidade) +
            '" placeholder="Cidade onde treina">' +
            '</div>' +
            '</div></div>' +
            '<div class="edit-profile-section">' +
            '<div class="perfil-privacy-box" role="note">' +
            '<p class="perfil-privacy-title">⚠️ Respeite as Regras de Privacidade:</p>' +
            '<p class="perfil-privacy-line">Fotos de rosto ou conteúdo explícito serão removidas automaticamente.</p>' +
            '<p class="perfil-privacy-line">Apenas fotos de treino/shape. Rostos ou conteúdo explícito são proibidos.</p>' +
            '</div>' +
            '<div class="perfil-gallery-card edit-profile-gallery-embed">' +
            '<section class="perfil-gallery-section" aria-label="Fotos do perfil">' +
            '<div class="perfil-gallery-head">' +
            '<h2><i class="bi bi-images"></i> Galeria</h2>' +
            '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">' +
            '<span id="editGaleriaCount" class="perfil-gallery-count" hidden></span>' +
            '<button type="button" id="editGaleriaAddBtn" class="perfil-gallery-add-btn" hidden aria-label="Adicionar foto à galeria">' +
            '<i class="bi bi-plus-lg"></i> Adicionar foto' +
            '</button>' +
            '</div></div>' +
            '<div id="editGaleriaGrid" class="perfil-gallery"></div>' +
            '</section></div>' +
            '</div>' +
            '<div class="edit-profile-actions">' +
            '<button type="button" class="btn btn-primary" id="btnSalvarEdicao">Salvar alterações</button>' +
            '</div>' +
            '</div></div>'
        );
    }

    function frameDenunciar() {
        return (
            panelHeader(
                'Denunciar',
                'Denúncia registrada para análise. Caso possua o código público do perfil (exibido em buscas e favoritos), por favor, informe abaixo.'
            ) +
            '<div class="form-card">' +
            '<div class="alert-banner warn">O uso indevido deste recurso e o envio de denúncias falsas podem levar à suspensão da sua conta.</div>' +
            '<label for="denunciaPublicUid">Código público</label>' +
            '<input type="text" id="denunciaPublicUid" required autocomplete="off" placeholder="6d169bc8-ff95-4842-b0f7-2e261d091c55">' +
            '<label for="denunciaTxt">DESCRIÇÃO</label>' +
            '<p class="form-card-field-hint">Descreva detalhadamente a sua denúncia.</p>' +
            '<textarea id="denunciaTxt" required></textarea>' +
            '<button type="button" class="btn btn-primary" id="btnDenuncia" style="margin-top:18px;width:100%;">Enviar denúncia</button>' +
            '</div>'
        );
    }

    function frameExcluir() {
        return (
            panelHeader(
                'Excluir conta',
                'Esta ação excluirá sua conta, fotos enviadas, favoritos, usuários bloqueados e todo o seu histórico de mensagens.'
            ) +
            '<div class="form-card">' +
            '<div class="alert-banner danger-zone"><strong>Atenção:</strong> As alterações feitas aqui não podem ser desfeitas. Caso queira preservar seu progresso para voltar depois, escolha a opção &quot;Sair&quot; no menu principal.</div>' +
            '<button type="button" class="btn btn-danger" id="btnExcluirConta" style="width:100%;">Excluir conta permanentemente</button>' +
            '</div>'
        );
    }

    function emptyState(icon, title, text, text2) {
        return (
            '<div class="empty-state">' +
            '<div class="empty-icon">' + icon + '</div>' +
            '<h3>' + esc(title) + '</h3>' +
            '<p>' + esc(text) + '</p>' +
            (text2 ? '<p>' + esc(text2) + '</p>' : '') +
            '</div>'
        );
    }

    function wirePerfilGalleryLightbox(grid, urls) {
        var overlay = document.getElementById('perfilLightbox');
        if (!grid || !urls || !urls.length || !overlay) return;
        var imgEl = document.getElementById('perfilLightboxImg');
        var countEl = document.getElementById('perfilLightboxCount');
        var btnClose = document.getElementById('perfilLightboxClose');
        var btnPrev = document.getElementById('perfilLightboxPrev');
        var btnNext = document.getElementById('perfilLightboxNext');
        if (!imgEl || !countEl || !btnClose || !btnPrev || !btnNext) return;

        var idx = 0;
        function sync() {
            idx = ((idx % urls.length) + urls.length) % urls.length;
            imgEl.src = urls[idx];
            imgEl.alt = 'Foto ' + (idx + 1) + ' do perfil';
            countEl.textContent = urls.length === 1 ? '1 foto' : idx + 1 + ' / ' + urls.length;
            var one = urls.length < 2;
            btnPrev.style.visibility = one ? 'hidden' : '';
            btnNext.style.visibility = one ? 'hidden' : '';
        }
        function close() {
            overlay.hidden = true;
            document.body.style.overflow = '';
        }
        function openAt(i) {
            idx = i;
            sync();
            overlay.hidden = false;
            document.body.style.overflow = 'hidden';
        }

        grid.querySelectorAll('.perfil-gallery-item[data-gal-idx]').forEach(function (el) {
            el.onclick = function (e) {
                if (e.target.closest('.perfil-gallery-manage')) return;
                openAt(parseInt(el.getAttribute('data-gal-idx'), 10));
            };
            el.onkeydown = function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (e.target.closest('.perfil-gallery-manage')) return;
                    openAt(parseInt(el.getAttribute('data-gal-idx'), 10));
                }
            };
        });

        btnClose.onclick = close;
        btnPrev.onclick = function () {
            idx--;
            sync();
        };
        btnNext.onclick = function () {
            idx++;
            sync();
        };

        if (overlay.dataset.lbWired !== '1') {
            overlay.dataset.lbWired = '1';
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) close();
            });
            document.addEventListener('keydown', function (e) {
                if (overlay.hidden) return;
                if (e.key === 'Escape') close();
                if (e.key === 'ArrowLeft') {
                    idx--;
                    sync();
                }
                if (e.key === 'ArrowRight') {
                    idx++;
                    sync();
                }
            });
        }
    }

    function wirePerfilGalleryManage(grid) {
        if (!grid) return;
        var inp = document.getElementById('perfilGalReplaceInput');
        grid.querySelectorAll('.perfil-gal-replace').forEach(function (btn) {
            btn.onclick = function (e) {
                e.preventDefault();
                e.stopPropagation();
                galleryReplaceSlot = parseInt(btn.getAttribute('data-slot'), 10);
                if (inp) inp.click();
            };
        });
        grid.querySelectorAll('.perfil-gal-remove').forEach(function (btn) {
            btn.onclick = async function (e) {
                e.preventDefault();
                e.stopPropagation();
                var slot = parseInt(btn.getAttribute('data-slot'), 10);
                if (!confirm('Excluir esta foto do seu perfil?')) return;
                try {
                    await api('DELETE', '/users/me/photos/' + slot);
                    var u = await requireMe();
                    afterUserPhotosChanged(u);
                    notify('Foto removida.', 'success');
                } catch (err) {
                    notify(err.message || String(err), 'error');
                }
            };
        });
    }

    function wireGalleryPhotoInputOnce() {
        var inp = document.getElementById('perfilGalReplaceInput');
        if (!inp || inp.dataset.wired === '1') return;
        inp.dataset.wired = '1';
        inp.addEventListener('change', async function () {
            if (galleryReplaceSlot === null || !inp.files || !inp.files[0]) {
                inp.value = '';
                return;
            }
            var slot = galleryReplaceSlot;
            galleryReplaceSlot = null;
            var fd = new FormData();
            fd.append('photo', inp.files[0]);
            inp.value = '';
            try {
                var r = await fetch('/api/users/me/photos/' + slot, {
                    method: 'POST',
                    body: fd,
                    credentials: 'include'
                });
                var txt = await r.text();
                var js = txt ? JSON.parse(txt) : {};
                if (!r.ok) throw new Error(js.error || 'Erro ao enviar foto.');
                var u = await requireMe();
                afterUserPhotosChanged(u);
                notify('Foto salva.', 'success');
            } catch (err) {
                notify(err.message || String(err), 'error');
            }
        });
    }

    function openProfileViewer(userId) {
        var uid = parseInt(userId, 10);
        if (!uid) return;
        window.location.href = 'usuario.html?id=' + uid;
    }

    window.runBusca = async function runBusca() {
        var el = document.getElementById('results');
        if (!el) return;
        var procuro = document.getElementById('buscaProcuro').value;
        var estado = document.getElementById('buscaEstado').value;
        var cidade = document.getElementById('buscaCidade').value.trim();
        el.innerHTML = '<div class="loading-inline">Buscando perfis…</div>';
        try {
            var q = '?procuro=' + encodeURIComponent(procuro) +
                '&estado=' + encodeURIComponent(estado) +
                '&cidade=' + encodeURIComponent(cidade);
            var elMin = document.getElementById('buscaIdadeMin');
            var elMax = document.getElementById('buscaIdadeMax');
            if (elMin && elMin.value !== '') {
                var vmin = parseInt(elMin.value, 10);
                if (Number.isFinite(vmin) && vmin < 18) {
                    notify('A idade mínima na busca é 18 anos.', 'warning');
                    elMin.value = '18';
                    q += '&minAge=18';
                } else {
                    q += '&minAge=' + encodeURIComponent(elMin.value);
                }
            }
            if (elMax && elMax.value !== '') {
                var vmax = parseInt(elMax.value, 10);
                if (Number.isFinite(vmax) && vmax < 18) {
                    notify('A idade máxima na busca não pode ser menor que 18 anos.', 'warning');
                    elMax.value = '';
                } else {
                    q += '&maxAge=' + encodeURIComponent(elMax.value);
                }
            }
            var data = await api('GET', '/users/search' + q);
            if (!data.results.length) {
                el.innerHTML = emptyState('🔎', 'Nenhum resultado', 'Ajuste estado, cidade ou o tipo em “Procuro por” (incluindo Todos). Lembre-se: só aparecem cadastros reais no servidor.');
                return;
            }
            el.innerHTML = data.results.map(function (p) {
                var media = p.photoUrl
                    ? '<div class="card-media"><img src="' + esc(p.photoUrl) + '" alt=""></div>'
                    : '<div class="card-media"><div class="no-photo">Sem foto</div></div>';
                var favLabel = p.favorited ? '★ Salvo' : '☆ Favoritar';
                var pub = p.publicUid ? String(p.publicUid) : '';
                var codeLine = pub
                    ? '<span style="font-weight:600;color:var(--gray);font-size:0.78rem;display:block;margin-top:4px;word-break:break-all;">Código ' + esc(pub) + '</span>'
                    : '';
                var ageLine =
                    p.age != null
                        ? '<span style="font-size:0.85rem;color:var(--gray);display:block;margin-top:2px;">' + esc(String(p.age)) + ' anos</span>'
                        : '';
                return (
                    '<article class="profile-card">' + media +
                    '<div class="card-body">' +
                    '<div class="card-title">' + esc(p.nickname) + '</div>' + ageLine + codeLine +
                    '<div class="card-meta">' + esc(p.gym) + '<br>' + esc(p.cidade) + ' · ' + esc(p.estado) + '</div>' +
                    '<div class="card-actions">' +
                    '<button type="button" class="btn btn-secondary btn-sm" data-act="profile" data-id="' + esc(String(p.id)) + '">Abrir perfil</button>' +
                    '<button type="button" class="btn btn-primary btn-sm" data-act="fav" data-id="' + esc(String(p.id)) + '">' + favLabel + '</button>' +
                    '<button type="button" class="btn btn-secondary btn-sm" data-act="chat" data-id="' + esc(String(p.id)) + '" data-name="' + esc(p.nickname) + '" data-pub="' + esc(p.publicUid || '') + '">Chat</button>' +
                    '<button type="button" class="btn btn-ghost btn-sm" data-act="block" data-id="' + esc(String(p.id)) + '">Bloquear</button>' +
                    '</div></div></article>'
                );
            }).join('');
            el.querySelectorAll('button[data-act]').forEach(function (btn) {
                btn.onclick = function () {
                    var id = parseInt(btn.getAttribute('data-id'), 10);
                    var act = btn.getAttribute('data-act');
                    if (act === 'fav') toggleFav(id, btn);
                    if (act === 'profile') openProfileViewer(id);
                    if (act === 'chat') {
                        chatOtherNickname = btn.getAttribute('data-name') || null;
                        chatOtherPublicUid = btn.getAttribute('data-pub') || null;
                        openChatFromSearch(id);
                    }
                    if (act === 'block') blockFromSearch(id);
                };
            });
        } catch (e) {
            el.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Erro na busca</h3><p>' + esc(e.message) + '</p></div>';
        }
    };

    async function toggleFav(userId, btn) {
        try {
            var row = await api('GET', '/users/favorites');
            var isFav = row.favorites.some(function (f) { return f.id === userId; });
            if (isFav) {
                await api('DELETE', '/users/favorites/' + userId);
                btn.textContent = '☆ Favoritar';
            } else {
                await api('POST', '/users/favorites/' + userId);
                btn.textContent = '★ Salvo';
            }
        } catch (e) {
            notify(e.message, 'error');
        }
    }

    function openChatFromSearch(userId) {
        chatOtherId = userId;
        loadFrame('mensagens');
    }

    async function blockFromChat() {
        if (!chatOtherId) return;
        if (!confirm('Bloquear esta pessoa? Vocês deixam de conversar e de aparecer um para o outro.')) return;
        try {
            await api('POST', '/users/blocks/' + chatOtherId);
            chatOtherId = null;
            chatOtherNickname = null;
            chatOtherPublicUid = null;
            notify('Usuário bloqueado.', 'success');
            await loadFrame('mensagens');
        } catch (e) {
            notify(e.message, 'error');
        }
    }

    function reportFromChat() {
        if (!chatOtherId) return;
        try {
            if (chatOtherPublicUid) sessionStorage.setItem('denunciaPrefillPublicUid', String(chatOtherPublicUid));
        } catch (e) {}
        loadFrame('denunciar');
    }

    async function blockFromSearch(userId) {
        if (!confirm('Bloquear este usuário? Vocês deixam de se ver na busca e no chat.')) return;
        try {
            await api('POST', '/users/blocks/' + userId);
            notify('Usuário bloqueado.', 'success');
            runBusca();
        } catch (e) {
            notify(e.message, 'error');
        }
    }

    async function refreshFavoritos(container) {
        container.innerHTML = '<div class="loading-inline">Carregando favoritos…</div>';
        try {
            var data = await api('GET', '/users/favorites');
            if (!data.favorites.length) {
                container.innerHTML =
                    panelHeader('Favoritos', 'Perfis que você marcou para acompanhar.') +
                    emptyState('⭐', 'Nenhum favorito ainda', 'Na busca, use “Favoritar” nos cards. Depois você abre o chat daqui.');
                return;
            }
            container.innerHTML =
                panelHeader('Favoritos', 'Contato salvo. Toque para abrir o chat.') +
                '<div class="fav-grid">' +
                data.favorites.map(function (f) {
                    var av = f.photoUrl
                        ? '<img src="' + esc(f.photoUrl) + '" class="fav-img" alt="">'
                        : '<div class="fav-img placeholder-av" aria-hidden="true"></div>';
                    return (
                        '<div class="fav-card">' + av +
                        '<div class="fav-body">' +
                        '<strong>' + esc(f.nickname) + '</strong>' +
                        '<small>' + esc(f.gym) + ' · ' + esc(f.cidade) + '</small>' +
                        '<small style="margin-top:6px;color:var(--primary);font-weight:700;word-break:break-all;">Código ' + esc(f.publicUid || '—') + '</small>' +
                        '</div>' +
                        '<div class="fav-actions">' +
                        '<button type="button" class="btn btn-secondary btn-sm" data-view-profile="' + f.id + '">Abrir perfil</button>' +
                        '<button type="button" class="btn btn-primary btn-sm" data-open-chat="' + f.id + '" data-name="' + esc(f.nickname) + '" data-pub="' + esc(f.publicUid || '') + '">Chat</button>' +
                        '<button type="button" class="btn btn-ghost btn-sm" data-unfav="' + f.id + '">Remover</button>' +
                        '</div></div>'
                    );
                }).join('') +
                '</div>';

            container.querySelectorAll('[data-view-profile]').forEach(function (b) {
                b.onclick = function () {
                    var id = parseInt(b.getAttribute('data-view-profile'), 10);
                    openProfileViewer(id);
                };
            });
            container.querySelectorAll('[data-open-chat]').forEach(function (b) {
                b.onclick = function () {
                    chatOtherId = parseInt(b.getAttribute('data-open-chat'), 10);
                    chatOtherNickname = b.getAttribute('data-name') || null;
                    chatOtherPublicUid = b.getAttribute('data-pub') || null;
                    loadFrame('mensagens');
                };
            });
            container.querySelectorAll('[data-unfav]').forEach(function (b) {
                b.onclick = async function () {
                    var id = parseInt(b.getAttribute('data-unfav'), 10);
                    try {
                        await api('DELETE', '/users/favorites/' + id);
                        refreshFavoritos(container);
                    } catch (e) {
                        notify(e.message, 'error');
                    }
                };
            });
        } catch (e) {
            container.innerHTML = panelHeader('Favoritos', '') + '<div class="empty-state"><h3>Erro</h3><p>' + esc(e.message) + '</p></div>';
        }
    }

    async function refreshBloqueados(container) {
        container.innerHTML = '<div class="loading-inline">Carregando…</div>';
        try {
            var data = await api('GET', '/users/blocks');
            if (!data.blocked.length) {
                container.innerHTML =
                    panelHeader(
                        'Bloqueados',
                        'Contatos bloqueados não aparecem em buscas nem podem enviar mensagens para você.'
                    ) +
                    emptyState(
                        '🛡️',
                        'Lista vazia',
                        'Ao bloquear alguém, essa pessoa não aparecerá nas suas buscas e não poderá te enviar mensagens.',
                        'Se necessário, utilize a opção Bloquear no card do perfil durante a busca.'
                    );
                return;
            }
            container.innerHTML =
                panelHeader(
                    'Bloqueados',
                    data.blocked.length +
                        ' ' +
                        (data.blocked.length === 1 ? 'conta bloqueada' : 'contas bloqueadas') +
                        '. Contatos bloqueados não aparecem em buscas nem podem enviar mensagens para você.'
                ) +
                data.blocked.map(function (u) {
                    return (
                        '<div class="block-card">' +
                        '<div class="who"><strong>' + esc(u.nickname) + '</strong><small>' + esc(u.gym) + '</small></div>' +
                        '<button type="button" class="btn btn-ghost btn-sm" data-unblock="' + u.id + '">Desbloquear</button>' +
                        '</div>'
                    );
                }).join('');
            container.querySelectorAll('[data-unblock]').forEach(function (b) {
                b.onclick = async function () {
                    var id = parseInt(b.getAttribute('data-unblock'), 10);
                    try {
                        await api('DELETE', '/users/blocks/' + id);
                        refreshBloqueados(container);
                    } catch (e) {
                        notify(e.message, 'error');
                    }
                };
            });
        } catch (e) {
            container.innerHTML = panelHeader('Bloqueados', '') + '<div class="empty-state"><h3>Erro</h3><p>' + esc(e.message) + '</p></div>';
        }
    }

    function updateChatHeader() {
        var titleEl = document.getElementById('chatTopTitle');
        var subEl = document.getElementById('chatTopSub');
        var actions = document.getElementById('chatTopActions');
        if (!titleEl) return;
        if (!chatOtherId) {
            titleEl.textContent = 'Suas Mensagens';
            if (subEl) {
                subEl.className = '';
                subEl.textContent =
                    'Selecione uma conversa ao lado ou utilize a busca e os favoritos para iniciar.';
            }
            if (actions) actions.style.display = 'none';
            return;
        }
        var name = chatOtherNickname || ('Usuário #' + chatOtherId);
        titleEl.textContent = name;
        if (subEl) {
            if (peerOtherTyping) {
                subEl.className = 'chat-status-typing';
                subEl.textContent = 'digitando…';
            } else {
                subEl.className = '';
                var h = '';
                if (peerOtherOnline) h += '<span class="chat-status-online">online</span> · ';
                if (chatOtherPublicUid) h += 'Código ' + esc(chatOtherPublicUid) + ' · ';
                h += 'ID #' + chatOtherId;
                subEl.innerHTML = h;
            }
        }
        if (actions) actions.style.display = 'flex';
    }

    async function renderMessagePane() {
        var box = document.getElementById('cb');
        if (!box) return;
        updateChatHeader();
        if (!chatOtherId) {
            var listBody0 = document.getElementById('convListBody');
            var hasConvs = listBody0 && listBody0.querySelectorAll('.conv-row').length > 0;
            if (hasConvs) {
                box.innerHTML =
                    '<div class="empty-state" style="margin:12px;"><div class="empty-icon">💬</div>' +
                    '<h3>Nenhuma conversa selecionada.</h3>' +
                    '<p>Selecione um chat na lista ou use a busca para iniciar uma nova mensagem.</p></div>';
            } else {
                box.innerHTML =
                    '<div class="empty-state" style="margin:12px;"><div class="empty-icon">💬</div><p>Você ainda não tem conversas. Que tal buscar alguém?</p></div>';
            }
            return;
        }
        try {
            var data = await api('GET', '/messages/with/' + chatOtherId);
            box.innerHTML = data.messages.map(function (m) {
                var mine = m.from_user_id === currentUserId;
                return '<div class="msg ' + (mine ? 'sent' : 'received') + '" data-msg-id="' + esc(String(m.id)) + '">' + esc(m.body) + '</div>';
            }).join('');
            box.scrollTop = box.scrollHeight;
            await refreshPeerPresence();
        } catch (e) {
            box.innerHTML = '<div class="empty-state"><p style="color:var(--danger);">' + esc(e.message) + '</p></div>';
        }
    }

    function isPaymentRequiredErr(e) {
        return !!(e && (e.code === 'PAYMENT_REQUIRED' || (e.data && e.data.code === 'PAYMENT_REQUIRED')));
    }

    async function applyMessagingComposerPaywall(meUser) {
        var wall = document.getElementById('chatMessagingPaywall');
        var ta = document.getElementById('mi');
        var btn = document.getElementById('btnSend');
        if (!ta || !btn) return;
        var ok = !!(meUser && meUser.premiumActive);
        if (ok) {
            if (wall) wall.hidden = true;
            ta.disabled = false;
            btn.disabled = false;
            ta.placeholder = 'Escreva no chat…';
            return;
        }
        if (wall) {
            wall.hidden = false;
            wall.innerHTML =
                '<p class="chat-paywall-text"><strong>Plano de Chat</strong> — Escolha um plano (1, 2 ou 3 meses) e pague com segurança no Mercado Pago (Pix, cartão, etc.). Você continua logado.</p>' +
                '<a class="btn btn-primary btn-sm" href="mypay.html">Ir para pagamento</a>';
        }
        ta.disabled = true;
        btn.disabled = true;
        ta.placeholder = 'Para enviar mensagens, ative o seu plano.';
    }

    async function refreshMensagensLayout(container, meUser) {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission().catch(function () {});
        }

        var premiumBannerHtml = '';
        if (meUser && meUser.premiumActive) {
            var untilStr = '';
            if (meUser.premiumUntil) {
                var pd = new Date(meUser.premiumUntil);
                if (!Number.isNaN(pd.getTime())) {
                    untilStr = pd.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
                }
            }
            premiumBannerHtml =
                '<div class="chat-premium-banner" role="status">' +
                '<i class="bi bi-patch-check-fill" aria-hidden="true"></i> ' +
                '<span><strong>Plano ativo</strong>' +
                (untilStr ? ' até ' + esc(untilStr) : '') +
                ' — envio no chat liberado.</span></div>';
        }

        container.innerHTML =
            '<div class="chat-container">' +
            '<div class="chat-sidebar">' +
            '<div class="chat-sidebar-header">Conversas</div>' +
            '<div class="chat-sidebar-body" id="convListBody"></div></div>' +
            '<div class="chat-window">' +
            '<div class="chat-top">' +
            '<div class="chat-top-row">' +
            '<div class="chat-top-text">' +
            '<div id="chatTopTitle">Suas Mensagens</div>' +
            '<span id="chatTopSub"></span></div>' +
            '<div class="chat-top-actions" id="chatTopActions" style="display:none">' +
            '<button type="button" class="btn btn-ghost btn-sm" id="btnChatProfile">Perfil</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="btnChatBlock">Bloquear</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="btnChatReport">Denunciar</button>' +
            '</div></div></div>' +
            premiumBannerHtml +
            '<div class="chat-messages" id="cb"></div>' +
            '<div id="chatMessagingPaywall" class="chat-messaging-paywall" hidden></div>' +
            '<div class="chat-composer">' +
            '<textarea id="mi" rows="1" placeholder="Escreva no chat…" autocomplete="off"></textarea>' +
            '<button type="button" class="btn btn-primary" id="btnSend">Enviar</button>' +
            '</div></div></div>';

        var listBody = document.getElementById('convListBody');
        try {
            var data = await api('GET', '/messages/conversations');
            if (!data.conversations.length) {
                listBody.innerHTML =
                    '<div class="loading-inline" role="status">Você ainda não tem conversas. Que tal buscar alguém?</div>';
            } else {
                data.conversations.forEach(function (c) {
                    var row = document.createElement('div');
                    row.className = 'conv-row' + (c.other_id === chatOtherId ? ' active' : '');
                    row.setAttribute('data-other-id', String(c.other_id));
                    var dotClass = c.other_online ? 'presence-dot on' : 'presence-dot';
                    row.innerHTML =
                        '<span class="' + dotClass + '" aria-hidden="true"></span>' +
                        '<div class="conv-row-main"><strong>' +
                        esc(c.nickname) +
                        '</strong><small>' +
                        esc(c.last_body) +
                        '</small></div>';
                    row.onclick = async function () {
                        peerOtherTyping = false;
                        clearTimeout(typingClearTimer);
                        chatOtherId = c.other_id;
                        chatOtherNickname = c.nickname;
                        chatOtherPublicUid = c.other_public_uid || null;
                        peerOtherOnline = !!c.other_online;
                        listBody.querySelectorAll('.conv-row').forEach(function (r) {
                            r.classList.remove('active');
                        });
                        row.classList.add('active');
                        updateChatHeader();
                        await renderMessagePane();
                    };
                    listBody.appendChild(row);
                });
            }
        } catch (e) {
            listBody.innerHTML = '<div class="loading-inline" style="color:var(--danger);">' + esc(e.message) + '</div>';
        }

        var btnProfile = document.getElementById('btnChatProfile');
        var btnBlock = document.getElementById('btnChatBlock');
        var btnReport = document.getElementById('btnChatReport');
        if (btnProfile) btnProfile.onclick = function () {
            if (chatOtherId) openProfileViewer(chatOtherId);
        };
        if (btnBlock) btnBlock.onclick = function () { blockFromChat(); };
        if (btnReport) btnReport.onclick = function () { reportFromChat(); };

        var ta = document.getElementById('mi');
        if (ta) {
            ta.addEventListener('input', function () {
                if (ta.disabled) return;
                ta.style.height = 'auto';
                ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
                if (typeof gymChatTyping === 'function' && chatOtherId) {
                    gymChatTyping(chatOtherId, true);
                    clearTimeout(localTypingStopTimer);
                    localTypingStopTimer = setTimeout(function () {
                        gymChatTyping(chatOtherId, false);
                    }, 2000);
                }
            });
        }

        document.getElementById('btnSend').onclick = async function () {
            var inp = document.getElementById('mi');
            var text = inp.value.trim();
            if (!chatOtherId || !text) return;
            if (inp.disabled) return;

            function onErr(e) {
                if (isPaymentRequiredErr(e)) {
                    notify(e.message || 'Para enviar mensagens, ative o seu plano.', 'error');
                    applyMessagingComposerPaywall({ premiumActive: false });
                    return;
                }
                notify(e.message || String(e), 'error');
            }

            if (typeof gymChatTyping === 'function' && chatOtherId) {
                gymChatTyping(chatOtherId, false);
            }

            if (typeof gymChatIsOnline === 'function' && gymChatIsOnline()) {
                gymChatSend(chatOtherId, text, function (err) {
                    if (err) {
                        if (isPaymentRequiredErr(err)) {
                            onErr(err);
                            return;
                        }
                        api('POST', '/messages/with/' + chatOtherId, { body: text })
                            .then(function (data) {
                                inp.value = '';
                                inp.style.height = 'auto';
                                if (data.message) appendMessageBubble(data.message);
                            })
                            .catch(onErr);
                        return;
                    }
                    inp.value = '';
                    inp.style.height = 'auto';
                });
                return;
            }

            try {
                var posted = await api('POST', '/messages/with/' + chatOtherId, { body: text });
                inp.value = '';
                inp.style.height = 'auto';
                if (posted.message) appendMessageBubble(posted.message);
            } catch (e) {
                onErr(e);
            }
        };

        document.getElementById('mi').addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                document.getElementById('btnSend').click();
            }
        });

        await applyMessagingComposerPaywall(meUser);
        await renderMessagePane();
    }

    window.loadFrame = async function loadFrame(key) {
        if (key === 'meu-perfil') {
            showProfileShell();
            setActiveNav(key);
            try {
                var u = await requireMe();
                fillPerfilOverview(u);
            } catch (e) {
                window.location.href = 'login.html';
            }
            return;
        }

        var display = document.getElementById('display-frame');
        if (!display) return;
        showDynamicShell();
        display.classList.remove('perfil-display-fill');
        setActiveNav(key);

        if (key === 'busca') {
            display.innerHTML = frameBusca();
            document.getElementById('btnBuscar').onclick = function () { runBusca(); };
            return;
        }

        if (key === 'editar-perfil') {
            display.innerHTML = '<div class="loading-inline">Carregando formulário…</div>';
            try {
                var ue = await requireMe();
                display.innerHTML = frameEditarPerfil(ue);
                populateUserGallery(
                    ue,
                    {
                        grid: 'editGaleriaGrid',
                        gCount: 'editGaleriaCount',
                        addBtn: 'editGaleriaAddBtn',
                        replaceInputId: 'perfilGalReplaceInput'
                    },
                    'edit'
                );
                document.getElementById('btnSalvarEdicao').onclick = async function () {
                    var matriculaVal = document.getElementById('editMat').value.trim();
                    if (!matriculaVal) {
                        notify('Preencha a matrícula ou ID (obrigatório).', 'error');
                        return;
                    }
                    var body = {
                        nickname: document.getElementById('editNick').value.trim(),
                        gym: document.getElementById('editGym').value.trim(),
                        matricula: matriculaVal,
                        estado: document.getElementById('editEstado').value,
                        cidade: document.getElementById('editCidade').value.trim(),
                        sou: document.getElementById('editSou').value,
                        procuro: document.getElementById('editProcuro').value,
                        nascimento: document.getElementById('editNasc').value
                    };
                    try {
                        await api('PATCH', '/users/me', body);
                        await requireMe();
                        await loadFrame('meu-perfil');
                    } catch (err) {
                        notify(err.message || String(err), 'error');
                    }
                };
            } catch (e) {
                display.innerHTML =
                    panelHeader('Editar perfil', '') + '<div class="empty-state"><p>' + esc(e.message) + '</p></div>';
            }
            return;
        }

        if (key === 'favoritos') {
            display.innerHTML = '<div id="favWrap"></div>';
            await refreshFavoritos(document.getElementById('favWrap'));
            return;
        }

        if (key === 'bloquear') {
            display.innerHTML = '<div id="blockWrap"></div>';
            await refreshBloqueados(document.getElementById('blockWrap'));
            return;
        }

        if (key === 'mensagens') {
            var meChat;
            try {
                meChat = await requireMe();
            } catch (e) {
                window.location.href = 'login.html';
                return;
            }
            registerChatRealtime();
            display.innerHTML = '<div id="msgWrap"></div>';
            await refreshMensagensLayout(document.getElementById('msgWrap'), meChat);
            display.classList.add('perfil-display-fill');
            return;
        }

        if (key === 'denunciar') {
            display.innerHTML = frameDenunciar();
            try {
                sessionStorage.removeItem('denunciaPrefillId');
                var prePub = sessionStorage.getItem('denunciaPrefillPublicUid');
                if (prePub) {
                    var pubEl0 = document.getElementById('denunciaPublicUid');
                    if (pubEl0) pubEl0.value = prePub;
                    sessionStorage.removeItem('denunciaPrefillPublicUid');
                }
            } catch (e) {}
            document.getElementById('btnDenuncia').onclick = async function () {
                var txt = document.getElementById('denunciaTxt').value.trim();
                var pubEl = document.getElementById('denunciaPublicUid');
                var codigo = pubEl && pubEl.value ? pubEl.value.trim() : '';
                if (!codigo) {
                    notify('Informe o código público do perfil.', 'warning');
                    return;
                }
                if (!txt) {
                    notify('Preencha a descrição.', 'warning');
                    return;
                }
                var payload = { body: txt, reportedPublicUid: codigo };
                try {
                    await api('POST', '/reports', payload);
                    notify('Denúncia registrada. Nossa equipe recebe um e-mail com os detalhes.', 'success');
                    document.getElementById('denunciaTxt').value = '';
                    if (pubEl) pubEl.value = '';
                } catch (e) {
                    notify(e.message, 'error');
                }
            };
            return;
        }

        if (key === 'excluir') {
            display.innerHTML = frameExcluir();
            document.getElementById('btnExcluirConta').onclick = async function () {
                if (!confirm('Confirma exclusão permanente da conta?')) return;
                try {
                    await api('DELETE', '/users/account');
                    window.location.href = 'login.html';
                } catch (e) {
                    notify(e.message, 'error');
                }
            };
            return;
        }

        display.innerHTML = '<p>Seção em construção.</p>';
    };

    window.logoutServidor = async function logoutServidor() {
        try {
            await api('POST', '/auth/logout');
        } catch (e) {}
        window.location.href = 'login.html';
    };

    function wirePerfilSidebarToggle() {
        var grid = document.querySelector('.perfil-main-grid');
        var btn = document.getElementById('perfilSidebarToggle');
        if (!grid || !btn) return;
        var storageKey = 'gympaquera-perfil-sidebar-expanded';
        function applyCollapsed(collapsed) {
            grid.classList.toggle('perfil-sidebar-collapsed', collapsed);
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            var lab = btn.querySelector('.perfil-sidebar-label');
            if (lab) lab.textContent = collapsed ? 'Expandir' : 'Recolher';
            btn.setAttribute('title', collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral');
            var icon = btn.querySelector('i');
            if (icon) {
                icon.classList.remove('bi-chevron-left', 'bi-chevron-right');
                icon.classList.add(collapsed ? 'bi-chevron-right' : 'bi-chevron-left');
            }
            try {
                localStorage.setItem(storageKey, collapsed ? '0' : '1');
            } catch (e) {}
        }
        try {
            if (localStorage.getItem(storageKey) === '0') {
                applyCollapsed(true);
            }
        } catch (e) {}
        btn.addEventListener('click', function () {
            applyCollapsed(!grid.classList.contains('perfil-sidebar-collapsed'));
        });
    }

    function syncAppViewportHeight() {
        var vv = window.visualViewport;
        var h = vv && vv.height ? vv.height : window.innerHeight;
        if (h > 0) document.documentElement.style.setProperty('--app-vh', h + 'px');
    }

    function syncPerfilSidebarBreakpoint() {
        var d = document.getElementById('perfil-sidebar-details');
        if (!d) return;
        if (window.matchMedia('(min-width: 900px)').matches) d.open = true;
        else d.open = false;
    }

    /** Acompanha maximizar/restaurar janela, redimensionar e barra de endereço no mobile. */
    function wirePerfilResponsiveLayout() {
        var raf = null;
        function tick() {
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(function () {
                raf = null;
                syncAppViewportHeight();
                syncPerfilSidebarBreakpoint();
            });
        }
        syncAppViewportHeight();
        syncPerfilSidebarBreakpoint();
        window.addEventListener('resize', tick, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', tick, { passive: true });
            window.visualViewport.addEventListener('scroll', tick, { passive: true });
        }
        window.addEventListener(
            'orientationchange',
            function () {
                setTimeout(function () {
                    syncAppViewportHeight();
                    syncPerfilSidebarBreakpoint();
                }, 280);
            },
            { passive: true }
        );
    }

    window.bootstrapPerfil = async function bootstrapPerfil() {
        wireSidebarNav();
        wirePerfilSidebarToggle();
        wireGalleryPhotoInputOnce();
        wirePerfilResponsiveLayout();
        try {
            await requireMe();
        } catch (e) {
            window.location.replace('login.html');
            return;
        }
        registerChatRealtime();
        try {
            var qsBoot = new URLSearchParams(window.location.search);
            if (qsBoot.get('frompay') === '1') {
                try {
                    history.replaceState({}, '', 'Perfil.html');
                } catch (eR) {}
                await loadFrame('mensagens');
                notify('Plano ativo! Você já pode usar o chat.', 'success');
                return;
            }
        } catch (ePay) {}
        try {
            var oid = sessionStorage.getItem('openChatWith');
            if (oid) {
                var oname = sessionStorage.getItem('openChatWithName') || '';
                var opub = sessionStorage.getItem('openChatWithPub') || '';
                sessionStorage.removeItem('openChatWith');
                sessionStorage.removeItem('openChatWithName');
                sessionStorage.removeItem('openChatWithPub');
                chatOtherId = parseInt(oid, 10);
                chatOtherNickname = oname || null;
                chatOtherPublicUid = opub || null;
                await loadFrame('mensagens');
                return;
            }
        } catch (e2) {}
        try {
            var qsFrame = new URLSearchParams(window.location.search).get('frame');
            var allowedBootFrames = {
                busca: 1,
                'meu-perfil': 1,
                'editar-perfil': 1,
                favoritos: 1,
                mensagens: 1,
                bloquear: 1,
                denunciar: 1
            };
            if (qsFrame && allowedBootFrames[qsFrame]) {
                try {
                    history.replaceState({}, '', 'Perfil.html');
                } catch (eRf) {}
                await loadFrame(qsFrame);
                return;
            }
        } catch (eFrame) {}
        await loadFrame('meu-perfil');
    };
})();
