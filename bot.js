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
        .setDescription('🤖 IA vetoriza a imagem inteira para CorelDraw')
        .addAttachmentOption(o =>
            o.setName('imagem').setDescription('Imagem PNG ou JPG').setRequired(true)
        )
        .addIntegerOption(o =>
            o.setName('cores')
             .setDescription('Nº de cores (padrão: 8 | menos = mais limpo)')
             .setMinValue(2).setMaxValue(16).setRequired(false)
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

function tokenizarPath(d) {
    const tokens = [];
    const re = /([MmLlCcHhVvSsQqTtAaZz])|([+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?)/g;
    let m;
    while ((m = re.exec(d)) !== null) {
        if (m[1]) tokens.push({ tipo: 'cmd', val: m[1] });
        else      tokens.push({ tipo: 'num', val: parseFloat(m[2]) });
    }
    return tokens;
}

function pathSVGparaEPS(d, alturaTotal) {
    const tokens = tokenizarPath(d);
    const flip   = y => (alturaTotal - y).toFixed(4);
    let ps = '';
    let i  = 0;
    let cx = 0, cy = 0;
    const temNum = () => i < tokens.length && tokens[i].tipo === 'num';
    const n      = () => tokens[i++].val;

    while (i < tokens.length) {
        if (tokens[i].tipo !== 'cmd') { i++; continue; }
        const cmd = tokens[i++].val;
        if (cmd === 'Z' || cmd === 'z') { ps += `closepath\n`; continue; }
        do {
            if (!temNum()) break;
            if      (cmd === 'M') { cx=n(); cy=n(); ps += `${cx.toFixed(4)} ${flip(cy)} moveto\n`; }
            else if (cmd === 'm') { cx+=n(); cy+=n(); ps += `${cx.toFixed(4)} ${flip(cy)} moveto\n`; }
            else if (cmd === 'L') { cx=n(); cy=n(); ps += `${cx.toFixed(4)} ${flip(cy)} lineto\n`; }
            else if (cmd === 'l') { cx+=n(); cy+=n(); ps += `${cx.toFixed(4)} ${flip(cy)} lineto\n`; }
            else if (cmd === 'H') { cx=n(); ps += `${cx.toFixed(4)} ${flip(cy)} lineto\n`; }
            else if (cmd === 'h') { cx+=n(); ps += `${cx.toFixed(4)} ${flip(cy)} lineto\n`; }
            else if (cmd === 'V') { cy=n(); ps += `${cx.toFixed(4)} ${flip(cy)} lineto\n`; }
            else if (cmd === 'v') { cy+=n(); ps += `${cx.toFixed(4)} ${flip(cy)} lineto\n`; }
            else if (cmd === 'C') {
                const x1=n(),y1=n(),x2=n(),y2=n(); cx=n(); cy=n();
                ps += `${x1.toFixed(4)} ${flip(y1)} ${x2.toFixed(4)} ${flip(y2)} ${cx.toFixed(4)} ${flip(cy)} curveto\n`;
            }
            else if (cmd === 'c') {
                const rx1=n(),ry1=n(),rx2=n(),ry2=n(),rdx=n(),rdy=n();
                const ax1=cx+rx1, ay1=cy+ry1, ax2=cx+rx2, ay2=cy+ry2;
                cx+=rdx; cy+=rdy;
                ps += `${ax1.toFixed(4)} ${flip(ay1)} ${ax2.toFixed(4)} ${flip(ay2)} ${cx.toFixed(4)} ${flip(cy)} curveto\n`;
            }
            else { if (temNum()) n(); else break; }
        } while (temNum());
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
        `%%Pages: 1`,
        `%%EndComments`,
        `%%Page: 1 1`,
        `gsave`,
    ];
    for (let idx = 0; idx < caminhos.length; idx++) {
        const { r, g, b, d } = caminhos[idx];
        const ps = pathSVGparaEPS(d, height);
        if (!ps.trim()) continue;
        linhas.push(`% Elemento ${idx + 1}`);
        linhas.push(`gsave`);
        linhas.push(`${(r/255).toFixed(4)} ${(g/255).toFixed(4)} ${(b/255).toFixed(4)} setrgbcolor`);
        linhas.push(`newpath`);
        linhas.push(ps.trim());
        linhas.push(`fill grestore`);
    }
    linhas.push(`grestore`, `showpage`, `%%Trailer`, `%%EOF`);
    return Buffer.from(linhas.join('\n'), 'utf-8');
}

async function vectorizar(imageBuffer, maxCores = 8) {
    // 1. Filtro mediano remove pixel isolado de ruído antes de quantizar
    const preprocessado = await sharp(imageBuffer)
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .median(5)
        .toBuffer();

    // 2. Quantiza em paleta fechada — sem dither para bordas limpas
    const quantizado = await sharp(preprocessado)
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
                threshold:    128,
                blackOnWhite: false,
                turdSize:     40,   // ← remove fragmentos pequenos (era 2, agora 40)
                alphaMax:     1.0,
                optCurve:     true,
                optTolerance: 0.5,  // ← curvas mais suaves
            }, (err, svg) => {
                if (err) { resolve(null); return; }
                const m = svg.match(/d="([^"]+)"/);
                resolve(m ? m[1] : null);
            });
        });

        if (d) caminhos.push({ r, g, b, d });
    }

    if (caminhos.length === 0)
        throw new Error('Nenhum elemento vetorizável. Use imagem com fundo sólido e bom contraste.');

    const svgStr = [
        `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `  <!-- Metalbot IA | ${caminhos.length} cores | Potrace Engine -->`,
        ...caminhos.map(({ r, g, b, d }, idx) => {
            const hex = '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
            return `  <g id="elemento_${idx+1}" fill="${hex}" stroke="none">\n    <path d="${d}"/>\n  </g>`;
        }),
        `</svg>`,
    ].join('\n');

    return {
        svg: Buffer.from(svgStr, 'utf-8'),
        eps: gerarEPS(caminhos, width, height),
        width, height, totalCores: caminhos.length
    };
}

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
    const maxCores = interaction.options.getInteger('cores') || 8;

    const nome = (imagem.name || '').toLowerCase();
    const url  = (imagem.url  || '').toLowerCase().split('?')[0];
    const tipoValido =
        nome.endsWith('.png') || nome.endsWith('.jpg') || nome.endsWith('.jpeg') ||
        url.endsWith('.png')  || url.endsWith('.jpg')  || url.endsWith('.jpeg')  ||
        (imagem.contentType && imagem.contentType.startsWith('image/'));

    if (!tipoValido)
        return interaction.editReply('❌ Formato inválido. Envie apenas **PNG** ou **JPG**.');

    try {
        console.log(`[${new Date().toISOString()}] Vetorizando para ${interaction.user.tag}...`);

        await interaction.editReply(
            `🤖 **IA processando...**\n🔬 Limpando ruído e vetorizando com Potrace.\n⏳ Aguarde.`
        );

        const resposta = await axios.get(imagem.url, { responseType: 'arraybuffer', timeout: 30000 });
        const { svg, eps, width, height, totalCores } = await vectorizar(Buffer.from(resposta.data), maxCores);

        if (svg.length > 8_000_000 || eps.length > 8_000_000)
            return interaction.editReply(`⚠️ Arquivo passou de 8 MB. Use \`/vetorizar cores:4\`.`);

        const nomeBase = (imagem.name || 'imagem').replace(/\.[^.]+$/, '');

        await interaction.editReply({
            content:
                `✅ **Vetorização concluída!**\n` +
                `🎨 **${totalCores} cores** | ${width}×${height}px\n\n` +
                `📄 \`${nomeBase}.svg\` — abre em qualquer editor\n` +
                `🎯 \`${nomeBase}.eps\` — **abre direto no CorelDraw**`,
            files: [
                { attachment: svg, name: `${nomeBase}.svg` },
                { attachment: eps, name: `${nomeBase}.eps` },
            ],
        });

    } catch (error) {
        console.error('[ERRO]', error.message);
        return interaction.editReply(
            `❌ Erro: **${error.message}**\nDica: PNG/JPG com fundo sólido, até 10 MB.`
        );
    }
});

client.login(TOKEN);
