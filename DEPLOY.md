# Deploy na VPS — Gym Paquera (passo a passo)

Guia para **Ubuntu Server 22.04 ou 24.04** (ou similar). Ajuste usuários e caminhos se preferir.

---

## 0. O que você precisa antes

- VPS com IP público e acesso SSH.
- Domínio (opcional no início; sem domínio você testa só por IP, mas **Mercado Pago em produção pede HTTPS e URL pública**).
- Token do **Mercado Pago** (produção ou teste).

---

## 1. Apontar o domínio (DNS)

1. No painel do seu domínio, crie um registro **tipo A**:
   - **Nome / host:** `@` (raiz) ou deixe em branco (depende do provedor).
   - **Valor / destino:** IP público da VPS (ex.: `203.0.113.50`).
2. (Opcional) Para `www`, crie outro **A** com host `www` apontando para o **mesmo IP**.
3. Aguarde a propagação (em geral de minutos a algumas horas). Teste: `ping seusite.com.br`.

---

## 2. Conectar na VPS e atualizar o sistema

```bash
ssh root@SEU_IP
# ou: ssh usuario@SEU_IP
```

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 3. Instalar Node.js (versão 22 ou superior)

O `package.json` pede Node **≥ 22.13**. Usando o repositório oficial NodeSource (exemplo Node 22):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

Precisa mostrar v22.x ou superior.

---

## 4. Instalar Nginx e Certbot (HTTPS)

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

```bash
sudo apt install -y certbot python3-certbot-nginx
```

---

## 5. Criar usuário e pasta da aplicação (recomendado)

Não rode a app como `root` o tempo todo.

```bash
sudo adduser --disabled-password --gecos "" gymapp
sudo mkdir -p /var/www/gympaquera
sudo chown gymapp:gymapp /var/www/gympaquera
```

---

## 6. Enviar o código para a VPS

**Opção A — Git (recomendado)**

Na VPS, como usuário `gymapp`:

```bash
sudo su - gymapp
cd /var/www/gympaquera
git clone https://SEU_REPOSITORIO.git .
# ou: git pull se já clonou antes
```

**Opção B — ZIP da sua máquina**

No seu PC, compacte a pasta do projeto **sem** `node_modules` e **sem** `.env` com segredos. Envie com `scp`:

```bash
scp projeto.zip usuario@SEU_IP:/var/www/gympaquera/
```

Na VPS:

```bash
cd /var/www/gympaquera && unzip projeto.zip
```

---

## 7. Instalar dependências e PM2

Como `gymapp`:

```bash
cd /var/www/gympaquera
npm ci --omit=dev
# se não tiver package-lock.json: npm install --omit=dev
```

Instalar PM2 globalmente (como root ou com sudo):

```bash
sudo npm install -g pm2
```

---

## 8. Arquivo `.env` na VPS

```bash
cd /var/www/gympaquera
cp .env.example .env
nano .env
```

Preencha pelo menos:

| Variável | Exemplo / observação |
|----------|----------------------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `SESSION_SECRET` | Gere com: `openssl rand -hex 32` |
| `APP_PUBLIC_URL` | `https://seudominio.com.br` (sem barra no final) |
| `MERCADOPAGO_ACCESS_TOKEN` | Token do Mercado Pago |
| `MERCADOPAGO_WEBHOOK_URL` | `https://seudominio.com.br/api/payments/webhook` |

Salve (`Ctrl+O`, Enter) e saia (`Ctrl+X`).

Garanta que existam pastas graváveis (o app cria o SQLite e usa `uploads/`):

```bash
mkdir -p /var/www/gympaquera/uploads
chmod 755 /var/www/gympaquera/uploads
```

---

## 9. Subir a aplicação com PM2

Como `gymapp`:

```bash
cd /var/www/gympaquera
pm2 start server.js --name gympaquera
pm2 save
```

Para PM2 iniciar no boot do servidor:

```bash
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u gymapp --hp /home/gymapp
```

(Copie e execute o comando que o PM2 imprimir, se pedir.)

Comandos úteis:

```bash
pm2 logs gympaquera
pm2 restart gympaquera
pm2 status
```

---

## 10. Nginx como proxy (HTTP primeiro)

Crie o site (troque `seudominio.com.br`):

```bash
sudo nano /etc/nginx/sites-available/gympaquera
```

Cole (ajuste `server_name`):

```nginx
server {
    listen 80;
    server_name seusite.com.br www.seusite.com.br;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Ative e teste:

```bash
sudo ln -s /etc/nginx/sites-available/gympaquera /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Abra no navegador: `http://seudominio.com.br` — deve carregar o site (ainda sem cadeado verde).

---

## 11. HTTPS com Let’s Encrypt

```bash
sudo certbot --nginx -d seusite.com.br -d www.seusite.com.br
```

Siga as perguntas (e-mail, aceite de termos). O Certbot ajusta o Nginx para **443**.

Confirme que **`APP_PUBLIC_URL`** no `.env` usa **`https://`**.

```bash
pm2 restart gympaquera
```

---

## 12. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## 13. Mercado Pago

1. No painel do Mercado Pago, cadastre a URL de webhook:  
   `https://seudominio.com.br/api/payments/webhook`
2. Use token de **produção** quando for ao ar de verdade.
3. Faça um pagamento de teste e confira se `premium_until` atualiza no banco / se o chat libera.

---

## 14. Checklist final

- [ ] Site abre em **https://seudominio.com.br**
- [ ] Login e cadastro funcionam
- [ ] Chat / Socket.IO funciona (mensagens em tempo real)
- [ ] `/mypay.html` só com login
- [ ] Pagamento de teste libera mensagens
- [ ] Backup: copiar periodicamente o arquivo **`.db`** e a pasta **`uploads/`**

---

## Problemas comuns

| Sintoma | O que verificar |
|--------|------------------|
| 502 Bad Gateway | PM2 rodando? `pm2 status`. Porta 3000 igual no Nginx? |
| Login não mantém sessão | `NODE_ENV=production`, site em **HTTPS**, cookie `secure` ativo. |
| Webhook MP não atualiza | URL HTTPS pública, firewall não bloqueia POST, token correto. |
| Erro ao instalar `better-sqlite3` | Instale build tools: `sudo apt install -y build-essential python3` |

---

## Atualizar o site depois (novo deploy)

```bash
sudo su - gymapp
cd /var/www/gympaquera
git pull
npm ci --omit=dev
pm2 restart gympaquera
```

**Não apague** o arquivo `.db` nem a pasta `uploads/` em atualizações normais.
