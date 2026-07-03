const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios   = require('axios');
const sharp   = require('sharp');
const potrace = require('potrace');
const http    = require('http');

const TOKEN     = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN)     throw new Error('Faltando variável de ambiente: TOKEN');
if (!CLIENT_ID) throw new Error('Faltando variável de ambiente: CLIENT_ID');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Metalbot Ativo 24/7\n');
}).listen(PORT, () => console.log(`HTTP keepalive na porta ${PORT}`));

const commands = [
    new SlashCommandBuilder()
        .setName('vetorizar')
        .setDescription('🤖 IA separa cada elemento da imagem em camadas vetoriais editáveis no CorelDraw')
        .addAttachmentOption(o =>
            o.setName('imagem').setDescription('Imagem PNG ou JPG').setRequired(true)
        )
        .addIntegerOption(o =>
            o.setName('cores')
             .setDescription('Nº de elementos/cores separados (padrão: 16, máx: 32)')
             .setMinValue(2).setMaxValue(32).setRequired(false)
        )
        .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registrarComandos() {
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Slash commands registrados!');
    } catch (err) {
        console.error('Erro ao registrar commands:', err.message);
    }
}

// ── Conversor SVG path → PostScript (EPS) ─────────────────────────────────────
function pathParaPS(d, height) {
    const tokens = d.match(/[MmLlCcHhVvZz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || [];
    let ps = '';
    let i = 0;
    let cmd = 'M';
    let cx = 0, cy = 0;
    const flip = y => (height - y).toFixed(4);

    while (i < tokens.length) {
        const t = tokens[i];
        if (/[MmLlCcHhVvZz]/.test(t)) { cmd = t; i++; continue; }
        const n = () => parseFloat(tokens[i++]);

        if      (cmd === 'M') { cx = n(); cy = n(); ps += `${cx.toFixed(4)} ${flip(cy)} moveto\n`; cmd = 'L'; }
        else if (cmd === 'm') { cx += n(); cy += n(); ps += `${cx.toFixed(4)} ${flip(cy)} moveto\n`; cmd = 'l'; }
        else if (cmd === 'L') { cx = n(); cy = n(); ps += `${cx.toFixed(4)} ${flip(cy)} lineto\n`; }
        else if (cmd === 'l') { cx += n(); cy += n(); ps += `${cx.toFixed(4)} ${flip(cy)} lineto\n`; }
        else if (cmd === 'H') { cx = n(); ps += `${cx.toFixed(4)} ${flip(cy)} lineto\n`; }
        else if (cmd === 'h') { cx += n(); ps += `${cx.toFixed(4)} ${flip(cy)} lineto\n`; }
        else if (cmd === 'V') { cy = n(); ps += `${cx.toFixed(4)} ${flip(cy)} lineto\n`; }
        else if (cmd === 'v') { cy += n(); ps += `${cx.toFixed(4)} ${flip(cy)} lineto\n`; }
        else if (cmd === 'C') {
            const x1=n(),y1=n(),x2=n(),y2=n(); cx=n(); cy=n();
            ps += `${x1.toFixed(4)} ${flip(y1)} ${x2.toFixed(4)} ${flip(y2)} ${cx.toFixed(4)} ${flip(cy)} curveto\n`;
        }
        else if (cmd === 'c') {
            const x1=cx+n(),y1=cy+n(),x2=cx+n(),y2=cy+n(); cx+=n(); cy+=n();
            ps += `${x1.toFixed(4)} ${flip(y1)} ${x2.toFixed(4)} ${flip(y2)} ${cx.toFixed(4)} ${flip(cy)} curveto\n`;
        }
        else if (cmd === 'Z' || cmd === 'z') { ps += `closepath\n`; }
        else { i++; }
    }
    return ps;
}

function gerarEPS(caminhos, width, height) {
    const linhas = [
        `%!PS-Adobe-3.0 EPSF-3.0`,
        `%%BoundingBox: 0 0 ${Math.ceil(width)} ${Math.ceil(height)}`,
        `%%HiResBoundingBox: 0.000 0.000 ${width.toFixed(3)} ${height.toFixed(3)}`,
        `%%Creator: Metalbot IA - Potrace Engine`,
        `%%Title: Vetor CorelDraw`,
        `%%CreationDate: ${new Date().toISOString()}`,
        `%%Pages: 1`,
        `%%EndComments`,
        `%%Page: 1 1`,
        `gsave`,
    ];

    for (let idx = 0; idx < caminhos.length; idx++) {
        const { r, g, b, d } = caminhos[idx];
        linhas.push(`% --- Elemento ${idx + 1} ---`);
        linhas.push(`gsave`);
        linhas.push(`${(r/255).toFixed(4)} ${(g/255).toFixed(4)} ${(b/255).toFixed(4)} setrgbcolor`);
        linhas.push(`newpath`);
        linhas.push(pathParaPS(d, height).trim());
        linhas.push(`closepath fill`);
        linhas.push(`grestore`);
    }

    linhas.push(`grestore`, `%%Trailer`, `%%EOF`);
    return Buffer.from(linhas.join('\n'), 'utf-8');
}

// ── Engine de vetorização com Potrace ─────────────────────────────────────────
async function vectorizar(imageBuffer, maxCores = 16) {
    const quantizado = await sharp(imageBuffer)
        .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
        .png({ palette: true, colors: maxCores, dither: 0 })
        .toBuffer();

    const { data, info } = await sharp(quantizado).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const CH = 4;

    const contagem = new Map();
    for (let i = 0; i < data.length; i += CH) {
        if (data[i + 3] < 10) continue;
        const key = `${data[i]},${data[i+1]},${data[i+2]}`;
        contagem.set(key, (contagem.get(key) || 0) + 1);
    }

    const cores = [...contagem.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxCores)
        .map(([k]) => k.split(',').map(Number));

    console.log(`  → ${cores.length} elementos detectados`);

    const caminhos = [];
    for (const [r, g, b] of cores) {
        const maskData = Buffer.alloc(width * height, 0);
        for (let i = 0; i < data.length; i += CH) {
            if (data[i] === r && data[i+1] === g && data[i+2] === b)
                maskData[Math.floor(i / CH)] = 255;
        }

        const maskPng = await sharp(maskData, { raw: { width, height, channels: 1 } }).png().toBuffer();

        const d = await new Promise((resolve) => {
            potrace.trace(maskPng, {
                threshold: 128, turdSize: 2, alphaMax: 1.0, optCurve: true, optTolerance: 0.2,
            }, (err, svg) => {
                if (err) { resolve(null); return; }
                const m = svg.match(/\sd="([^"]+)"/);
                resolve(m ? m[1] : null);
            });
        });

        if (d) caminhos.push({ r, g, b, d });
    }

    if (caminhos.length === 0)
        throw new Error('Nenhum elemento vetorizável. Tente uma imagem com mais contraste.');

    const svgPartes = caminhos.map(({ r, g, b, d }, idx) => {
        const hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
        return `  <g id="elemento_${idx+1}_${hex}" fill="${hex}" stroke="none">\n    <path d="${d}"/>\n  </g>`;
    });

    const svg = Buffer.from([
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<!-- Metalbot IA | ${caminhos.length} elementos | Potrace Engine -->`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        ...svgPartes,
        `</svg>`,
    ].join('\n'), 'utf-8');

    const eps = gerarEPS(caminhos, width, height);

    return { svg, eps, width, height, totalCores: caminhos.length };
}

// ── Cliente Discord ────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
    console.log(`✅ Bot logado como: ${client.user.tag}`);
    await registrarComandos();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'vetorizar') return;

    await interaction.deferReply();

    const imagem   = interaction.options.getAttachment('imagem');
    const maxCores = interaction.options.getInteger('cores') || 16;

    const nome = (imagem.name || '').toLowerCase();
    const url  = (imagem.url  || '').toLowerCase().split('?')[0];
    const tipoValido =
        nome.endsWith('.png') || nome.endsWith('.jpg') || nome.endsWith('.jpeg') ||
        url.endsWith('.png')  || url.endsWith('.jpg')  || url.endsWith('.jpeg')  ||
        (imagem.contentType && imagem.contentType.startsWith('image/'));

    if (!tipoValido)
        return interaction.editReply('❌ Formato inválido. Envie apenas **PNG** ou **JPG**.');

    try {
        console.log(`[${new Date().toISOString()}] Vetorizando para ${interaction.user.tag} (${maxCores} elementos)...`);

        await interaction.editReply(
            `🤖 **IA analisando sua imagem...**\n` +
            `🔬 Isolando cada elemento por cor com Potrace Engine.\n` +
            `⏳ Aguarde até 1 minuto.`
        );

        const resposta = await axios.get(imagem.url, { responseType: 'arraybuffer', timeout: 30000 });
        const { svg, eps, width, height, totalCores } = await vectorizar(Buffer.from(resposta.data), maxCores);

        if (svg.length > 8_000_000 || eps.length > 8_000_000)
            return interaction.editReply(`⚠️ Arquivo passou de 8 MB. Use \`/vetorizar cores:8\` para reduzir.`);

        const nomeBase = (imagem.name || 'imagem').replace(/\.[^.]+$/, '');
        const svgMB = (svg.length / 1024 / 1024).toFixed(2);
        const epsMB = (eps.length / 1024 / 1024).toFixed(2);

        await interaction.editReply({
            content:
                `✅ **Vetorização concluída pela IA!**\n` +
                `🧩 **${totalCores} elementos** isolados via **Potrace Engine** | ${width}×${height}px\n\n` +
                `📄 \`${nomeBase}.svg\` — ${svgMB} MB — abre em qualquer editor vetorial\n` +
                `🎯 \`${nomeBase}.eps\` — ${epsMB} MB — **abre direto no CorelDraw**, cada cor = objeto separado e editável`,
            files: [
                { attachment: svg, name: `${nomeBase}.svg` },
                { attachment: eps, name: `${nomeBase}.eps` },
            ],
        });

        console.log(`[${new Date().toISOString()}] ✅ ${totalCores} elementos | SVG ${svgMB}MB | EPS ${epsMB}MB`);

    } catch (error) {
        console.error('[ERRO]', error.message);
        return interaction.editReply(
            `❌ Erro: **${error.message}**\n` +
            `Dica: PNG/JPG com fundo sólido, até 10 MB. Tente \`/vetorizar cores:8\` para imagens complexas.`
        );
    }
});

client.login(TOKEN);
