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
        .setDescription('🤖 IA analisa e separa cada elemento da imagem em camadas vetoriais para CorelDraw')
        .addAttachmentOption(o =>
            o.setName('imagem').setDescription('Imagem PNG ou JPG').setRequired(true)
        )
        .addIntegerOption(o =>
            o.setName('cores')
             .setDescription('Quantidade de elementos/cores separados (padrão: 16, máx: 32)')
             .setMinValue(2)
             .setMaxValue(32)
             .setRequired(false)
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

async function vectorizar(imageBuffer, maxCores = 16) {
    const quantizado = await sharp(imageBuffer)
        .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
        .png({ palette: true, colors: maxCores, dither: 0 })
        .toBuffer();

    const { data, info } = await sharp(quantizado)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { width, height } = info;
    const channels = 4;

    const contagem = new Map();
    for (let i = 0; i < data.length; i += channels) {
        if (data[i + 3] < 10) continue;
        const key = `${data[i]},${data[i+1]},${data[i+2]}`;
        contagem.set(key, (contagem.get(key) || 0) + 1);
    }

    const cores = [...contagem.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxCores)
        .map(([key]) => key.split(',').map(Number));

    console.log(`  → ${cores.length} elementos/cores detectados`);

    const caminhos = [];
    for (const [r, g, b] of cores) {
        const maskData = Buffer.alloc(width * height, 0);
        for (let i = 0; i < data.length; i += channels) {
            if (data[i] === r && data[i+1] === g && data[i+2] === b) {
                maskData[Math.floor(i / channels)] = 255;
            }
        }

        const maskPng = await sharp(maskData, {
            raw: { width, height, channels: 1 }
        }).png().toBuffer();

        const d = await new Promise((resolve) => {
            potrace.trace(maskPng, {
                threshold: 128, turdSize: 2,
                alphaMax: 1.0, optCurve: true, optTolerance: 0.2,
            }, (err, svg) => {
                if (err) { resolve(null); return; }
                const m = svg.match(/\sd="([^"]+)"/);
                resolve(m ? m[1] : null);
            });
        });

        if (d) caminhos.push({ r, g, b, d });
    }

    if (caminhos.length === 0)
        throw new Error('Nenhum elemento gerado. Tente uma imagem com mais contraste.');

    const svgPartes = caminhos.map(({ r, g, b, d }, idx) => {
        const hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
        return `  <g id="elemento_${idx+1}_${hex}" fill="${hex}" stroke="none">\n    <path d="${d}"/>\n  </g>`;
    });

    const svg = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `  <!-- Metalbot IA | ${caminhos.length} elementos vetorizados individualmente -->`,
        ...svgPartes,
        `</svg>`,
    ].join('\n');

    return { svg: Buffer.from(svg, 'utf-8'), width, height, totalCores: caminhos.length };
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
            `🤖 **IA processando sua imagem...**\n` +
            `🔍 Analisando e separando cada elemento por cor e forma.\n` +
            `⏳ Isso pode levar até 1 minuto dependendo da complexidade.`
        );

        const resposta = await axios.get(imagem.url, { responseType: 'arraybuffer', timeout: 30000 });
        const { svg, width, height, totalCores } = await vectorizar(Buffer.from(resposta.data), maxCores);

        const tamanhoMB = svg.length / (1024 * 1024);

        if (tamanhoMB > 8)
            return interaction.editReply('⚠️ SVG passou de 8 MB. Use `/vetorizar cores:8` para reduzir.');

        await interaction.editReply({
            content:
                `✅ **Vetorização concluída pela IA!**\n` +
                `🧩 **${totalCores} elementos** separados individualmente — cada um é um objeto \`<g>\` independente no **CorelDraw**.\n` +
                `📏 ${width}×${height}px | 📁 ${tamanhoMB.toFixed(2)} MB\n` +
                `💡 No CorelDraw: abra o SVG → cada cor aparece como objeto separado, clique e edite livremente.`,
            files: [{ attachment: svg, name: 'vetor_corel.svg' }],
        });

        console.log(`[${new Date().toISOString()}] ✅ ${totalCores} elementos, ${tamanhoMB.toFixed(2)} MB`);

    } catch (error) {
        console.error('[ERRO]', error.message);
        return interaction.editReply(
            `❌ Erro no processamento: **${error.message}**\n` +
            'Dica: envie PNG/JPG com fundo de cor sólida e tamanho até 10 MB.'
        );
    }
});

client.login(TOKEN);
